import * as io from 'https://deno.land/std@0.75.0/io/mod.ts'
import * as path from 'https://deno.land/std@0.75.0/path/mod.ts'
import * as errors from './errors.ts'

type Fraction = string
type Pixels = number
type Percentage = number
type Offset = Fraction | Pixels
type Seconds = number
type Duration = string
type Size = Pixels | 'inherit' // inherit the size from the first layer

type Template = {
  size: { width: Size; height: Size }
  layers: {
    video: string
    audio_volume: Percentage
    start_at: Duration
    layout: {
      x?: Offset | { offset?: Offset; align?: 'left' | 'right' | 'center' }
      y?: Offset | { offset?: Offset; align?: 'top' | 'bottom' | 'center' }
      width?: Fraction | Pixels
      height?: Fraction | Pixels
    }
    crop?: {
      left?: Pixels
      right?: Pixels
      top?: Pixels
      bottom?: Pixels
    }
    timeline?: {
      align?: 'start' | 'end' // defaults to 'start'
      offset?: string // defaults to 00:00:00 (TODO accept negative durations: -00:00:01)
      trim?: { start?: 'fit' | string; end?: 'fit' | string }
      duration?: string
    }
  }[]
}

const decoder = new TextDecoder()

function parse_fraction(fraction: string): number {
  const result = fraction.split('/')
  if (result.length !== 2) throw new errors.InputError(`Invalid fraction "${fraction} specified."`)
  const [numerator, denominator] = result.map(v => parseInt(v))
  if (numerator === NaN || denominator === NaN)
    throw new errors.InputError(`Invalid fraction "${fraction} specified."`)
  return numerator / denominator
}

function parse_duration(duration: string, { user_input = true } = {}): Seconds {
  const duration_split = duration.split(':')
  if (duration_split.length !== 3) {
    if (user_input) throw new errors.InputError(`Invalid duration "${duration}". Cannot parse`)
    else throw new Error(`Invalid duration "${duration}". Cannot parse`)
  }
  const [hours, minutes, seconds] = duration_split.map(v => parseFloat(v))
  return hours * 60 * 60 + minutes * 60 + seconds
}

async function parse_template(template_filepath: string): Promise<Template> {
  try {
    const template: Template = JSON.parse(decoder.decode(await Deno.readFile(template_filepath)))
    if (template.layers.length === 0) {
      throw new errors.InputError(`template "layers" must have at least one layer present.`)
    }
    return template
  } catch (e) {
    if (e.name === 'SyntaxError') {
      throw new errors.InputError(`template ${template_filepath} is not valid JSON or YML`)
    } else throw e
  }
}

async function exec(cmd: string[], opts: Partial<Deno.RunOptions> = {}) {
  const proc = Deno.run({ cmd, stdout: 'piped', ...opts })
  const result = await proc.status()
  const output_buffer = opts.stderr === 'piped' ? await proc.stderrOutput() : await proc.output()
  const output = decoder.decode(output_buffer)
  await proc.close()
  if (result.success) {
    return output
  } else {
    throw new errors.CommandError(`Command "${cmd.join(' ')}" failed.\n\n${output}`)
  }
}

type ProbeInfo = { width: number; height: number; has_audio: boolean; duration: Seconds }
async function probe_video(filepath: string): Promise<ProbeInfo> {
  const result = await exec([
    'ffprobe',
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_entries',
    'format=duration',
    filepath,
  ])
  const info = JSON.parse(result)
  const video_stream = info.streams.find((s: any) => s.codec_type === 'video')
  const audio_stream = info.streams.find((s: any) => s.codec_type === 'audio')

  if (!video_stream) throw new errors.ProbeError(`Input "${filepath}" has no video stream`)
  const has_audio = audio_stream !== undefined
  const { width, height } = video_stream

  // ffprobe's duration is unreliable. The best solutions I have are:
  // ffmpeg guessing: https://stackoverflow.com/a/33115316/3795137
  // ffprobe packets: https://stackoverflow.com/a/33346572/3795137 but this is a ton of output, so were using ffmpeg
  const ffmpeg_stats_str = await exec(
    ['ffmpeg', '-v', 'quiet', '-stats', '-i', filepath, '-f', 'null', '-'],
    { stderr: 'piped' }
  )
  // doing this nonsense because this line actually is updated several times (with '\r') so a simple ffmpeg_stats_str.replace(/.*time=(.*?).*/, '$1') will not work
  const duration_str_half = ffmpeg_stats_str.substr(ffmpeg_stats_str.lastIndexOf('time=') + 5)
  const duration_str = duration_str_half.substr(0, duration_str_half.indexOf(' '))
  const duration = parse_duration(duration_str, { user_input: false })
  return { width, height, has_audio, duration }
}

type FfmpegProgress = {
  out_time: Duration
  progress: 'continue' | 'end'
  speed: string
  percentage: Percentage
}
type OnProgress = (progress: FfmpegProgress) => void
async function ffmpeg(
  ffmpeg_cmd: (string | number)[],
  longest_duration: number,
  progress_callback?: OnProgress
) {
  const ffmpeg_safe_cmd = ffmpeg_cmd.map(a => a.toString())
  if (progress_callback) {
    ffmpeg_safe_cmd.push('-progress', 'pipe:1')
    const proc = Deno.run({ cmd: ffmpeg_safe_cmd, stdout: 'piped', stdin: 'inherit' })
    let progress: Partial<FfmpegProgress> = {}
    for await (const line of io.readLines(proc.stdout!)) {
      const [key, value] = line.split('=')
      ;(progress as any)[key] = value
      if (key === 'progress') {
        progress.percentage =
          value === 'end' ? 1 : parse_duration(progress.out_time!) / longest_duration
        progress_callback(progress as FfmpegProgress)
        progress = {}
      }
    }
    const result = await proc.status()
    if (!result.success) {
      throw new errors.CommandError(`Command "${ffmpeg_safe_cmd.join(' ')}" failed.\n\n`)
    }
    await proc.close()
  } else {
    await exec(ffmpeg_safe_cmd)
  }
}

function compute_longest_duration(template: Template, probed_info: ProbeInfo[]): Seconds {
  const every_layer_is_fit = template.layers.every(
    l => l.timeline?.trim?.start === 'fit' || l.timeline?.trim?.end === 'fit'
  )

  let shortest_duration = Infinity
  let longest_duration = 0
  for (const i of template.layers.keys()) {
    const { timeline } = template.layers[i]
    const info = probed_info[i]
    const parsed_offset = timeline?.offset ? parse_duration(timeline.offset) : 0
    const initial_duration = timeline?.duration ? parse_duration(timeline.duration) : info.duration
    let duration = initial_duration + parsed_offset

    if (timeline?.trim?.start === 'fit') {
      // if we are fitting this layer, we dont care how long it is
      if (!every_layer_is_fit) continue
    } else if (timeline?.trim?.start) duration -= parse_duration(timeline.trim.start)

    if (timeline?.trim?.end === 'fit') {
      // if we are fitting this layer, we dont care how long it is
      if (!every_layer_is_fit) continue
    } else if (timeline?.trim?.end) duration -= parse_duration(timeline.trim.end)

    shortest_duration = Math.min(shortest_duration, duration)
    longest_duration = Math.max(longest_duration, duration)
  }

  if (every_layer_is_fit) return shortest_duration
  else return longest_duration
}

function compute_timeline(
  timeline: Template['layers'][0]['timeline'],
  probed_duration: Seconds,
  longest_duration: Seconds
) {
  const { align, offset, trim, duration } = timeline ?? {}

  // let seconds_from_start = 0
  let computed_duration: number = duration ? parse_duration(duration) : probed_duration
  let seconds_from_start = offset ? parse_duration(offset) : 0
  let trim_start = 0

  if (trim?.end === 'fit') {
    if (probed_duration > longest_duration) computed_duration = longest_duration
    if (computed_duration + seconds_from_start > longest_duration) {
      computed_duration -= computed_duration + seconds_from_start - longest_duration
    }
  } else if (trim?.end) computed_duration -= parse_duration(trim.end)

  if (trim?.start === 'fit') {
    if (trim?.end !== 'fit' && probed_duration > longest_duration) {
      trim_start = probed_duration - longest_duration
      computed_duration = longest_duration
    }
    computed_duration -= seconds_from_start
  } else if (trim?.start) {
    trim_start = parse_duration(trim.start)
    computed_duration -= trim_start
  }
  if (align === 'end' && computed_duration < longest_duration) {
    // the align 'end' we ignore is if the longest duration _is_ for this layer
    seconds_from_start += longest_duration - computed_duration
  }

  return { start: seconds_from_start, trim_start, computed_duration }
}

type RenderOptions = {
  render_sample_frame?: Duration
  overwrite?: boolean
  ffmpeg_verbosity?: 'quiet' | 'error' | 'warning' | 'info' | 'debug'
  progress_callback?: OnProgress
}
async function render_video(
  template_filepath: string,
  output_filepath: string,
  options?: RenderOptions
): Promise<Template> {
  const template = await parse_template(template_filepath)

  const ffmpeg_cmd: (string | number)[] = ['ffmpeg', '-v', options?.ffmpeg_verbosity ?? 'info']
  const audio_input_ids: string[] = []

  // prettier-ignore
  const video_filepaths = template.layers.map(l => path.resolve(path.dirname(template_filepath), l.video))
  const probed_info = await Promise.all(video_filepaths.map(probe_video))
  const longest_duration = compute_longest_duration(template, probed_info)

  const background_width =
    template.size.width === 'inherit' ? probed_info[0].width : template.size.width
  const background_height =
    template.size.height === 'inherit' ? probed_info[0].height : template.size.height

  let complex_filter_inputs = `color=s=${background_width}x${background_height}:color=black:duration=${longest_duration}[base];`
  let complex_filters = '[base]'
  for (const i of template.layers.keys()) {
    const info = probed_info[i]
    const video_filepath = video_filepaths[i]
    // console.log({ info })
    const layer = template.layers[i]
    const { layout } = layer
    const video_id = `v_in_${i}`

    const input_width =
      typeof layout?.width === 'string'
        ? parse_fraction(layout.width) * background_width
        : layout?.width
    const input_height =
      typeof layout?.height === 'string'
        ? parse_fraction(layout?.height) * background_height
        : layout?.height
    let width = input_width ?? (input_height ? input_height * (info.width / info.height) : info.width)
    let height = input_height ?? (input_width ? input_width / (info.width / info.height) : info.height)

    const time = compute_timeline(layer.timeline, info.duration, longest_duration)
    // console.log({ time })

    const setpts = `setpts=PTS+${time.start}/TB`
    // NOTE it is intentional that we are using the width and height before they are manipulated by crop
    const vscale = `scale=${width}:${height}`
    const video_input_filters: string[] = [setpts, vscale]

    if (layer.crop && Object.keys(layer.crop).length) {
      const { left, right, top, bottom } = layer.crop
      let x_crop = 0
      let y_crop = 0
      let width_crop = 'in_w'
      let height_crop = 'in_h'
      if (right) {
        width_crop = `in_w - ${right}`
        width -= right
      }
      if (bottom) {
        height_crop = `in_h - ${bottom}`
        height -= bottom
      }
      if (left) {
        x_crop = left
        width -= left
        width_crop = `${width_crop} - ${x_crop}`
      }
      if (top) {
        y_crop = top
        height -= top
        height_crop = `${height_crop} - ${y_crop}`
      }
      const crop = `crop=w=${width_crop}:h=${height_crop}:x=${x_crop}:y=${y_crop}:keep_aspect=1`
      video_input_filters.push(crop)
    }

    let x: string | number = 0
    let y: string | number = 0
    let x_align = 'left'
    let y_align = 'top'
    if (typeof layout?.x === 'object') x = layout.x.offset ?? 0
    else if (typeof layout?.x === 'number') x = layout.x
    if (typeof layout?.y === 'object') y = layout.y.offset ?? 0
    else if (typeof layout?.y === 'number') y = layout.y
    x_align = typeof layout?.x === 'object' ? layout.x.align ?? 'left' : 'left'
    y_align = typeof layout?.y === 'object' ? layout.y.align ?? 'top' : 'top'
    if (typeof layout.x === 'string') x = `(main_w * ${parse_fraction(layout.x)})`
    if (typeof layout.y === 'string') y = `(main_w * ${parse_fraction(layout.y)})`

    switch (x_align) {
      case 'left':
        break
      case 'right':
        x = `main_w - ${width} + ${x}`
        break
      case 'center':
        x = `(main_w / 2) - ${width / 2} + ${x}`
        break
    }
    switch (y_align) {
      case 'top':
        break
      case 'bottom':
        y = `main_h - ${height} + ${y}`
        break
      case 'center':
        y = `(main_h / 2) - ${height / 2} + ${y}`
        break
    }

    complex_filter_inputs += `[${i}:v] ${video_input_filters.join(', ')} [${video_id}];`

    if (!options?.render_sample_frame && info.has_audio) {
      const atrim = `atrim=0:${time.computed_duration}`
      const adelay = `adelay=${time.start * 1000}:all=1`
      const volume = `volume=${layer.audio_volume ?? 1}`
      // TODO use anullsink for audio_volume === 0 to avoid extra processing
      complex_filter_inputs += `[${i}:a] asetpts=PTS-STARTPTS, ${volume}, ${atrim}, ${adelay}[a_in_${i}];`
      audio_input_ids.push(`[a_in_${i}]`)
    }

    ffmpeg_cmd.push('-ss', time.trim_start, '-t', time.computed_duration, '-i', video_filepath)

    const overlay_enable_timespan = `enable='between(t,${time.start},${
      time.start + time.computed_duration
    })'`
    const overlay_filter = `overlay=x=${x}:y=${y}:${overlay_enable_timespan}`
    if (i === 0) {
      complex_filters += `[${video_id}] ${overlay_filter}`
    } else {
      complex_filters += `[v_out_${i - 1}];[v_out_${i - 1}][${video_id}] ${overlay_filter}`
    }
  }
  complex_filters += '[video]'
  ffmpeg_cmd.push('-map', '[video]')

  if (options?.render_sample_frame) {
    // we dont care about audio output for sample frame renders
    if (longest_duration < parse_duration(options.render_sample_frame)) {
      throw new errors.InputError(
        `sample-frame position ${options.render_sample_frame} is greater than duration of the output (${longest_duration})`
      )
    }
    ffmpeg_cmd.push('-ss', options.render_sample_frame, '-vframes', '1')
  } else if (audio_input_ids.length === 0) {
    // do not include audio
  } else if (audio_input_ids.length === 1) {
    ffmpeg_cmd.push('-map', audio_input_ids[0])
  } else {
    const audio_inputs = audio_input_ids.join('')
    complex_filters += `;${audio_inputs} amix=inputs=${audio_input_ids.length} [audio]`
    ffmpeg_cmd.push('-map', '[audio]')
  }

  const complex_filter = `${complex_filter_inputs} ${complex_filters}`
  ffmpeg_cmd.push('-filter_complex', `${complex_filter}`)
  ffmpeg_cmd.push(output_filepath)
  if (options?.overwrite) ffmpeg_cmd.push('-y')

  await ffmpeg(ffmpeg_cmd, longest_duration, options?.progress_callback)
  return template
}

export { render_video }
export type { RenderOptions, FfmpegProgress }
