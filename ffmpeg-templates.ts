import * as flags from 'https://deno.land/std@0.75.0/flags/mod.ts'

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
  if (result.length !== 2) throw new Error(`Invalid fraction "${fraction} specified."`)
  const [numerator, denominator] = result.map(v => parseInt(v))
  if (numerator === NaN || denominator === NaN)
    throw new Error(`Invalid fraction "${fraction} specified."`)
  return numerator / denominator
}

function parse_duration(duration: string): Seconds {
  const duration_split = duration.split(':')
  if (duration_split.length !== 3) throw new Error(`Invalid duration "${duration}". Cannot parse`)
  const [hours, minutes, seconds] = duration_split.map(v => parseFloat(v))
  return hours * 60 * 60 + minutes * 60 + seconds
}

async function exec(cmd: string[]) {
  const proc = Deno.run({ cmd, stdout: 'piped', stdin: 'piped' })
  const result = await proc.status()
  const output = decoder.decode(await proc.output())
  if (result.success) {
    return output
  } else {
    throw new Error(`Command "${cmd.join(' ')}" failed.\n\n${output}`)
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

  if (!video_stream) throw new Error(`ProbeError: input "${filepath}" has no video stream`)
  const has_audio = audio_stream !== undefined
  const { width, height } = video_stream

  const duration = parseFloat(info.format.duration)
  if (duration === NaN)
    throw new Error(`ProbeError: ffprobe could not compute duration on input "${filepath}"`)
  return { width, height, has_audio, duration }
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

  let seconds_from_start = offset ? parse_duration(offset) : 0
  let computed_duration: number = duration ? parse_duration(duration) : probed_duration
  let trim_end = 0
  let trim_start = 0
  if (trim?.end === 'fit') {
    if (probed_duration > longest_duration) computed_duration = longest_duration
    computed_duration -= seconds_from_start
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

  return { start: seconds_from_start, trim_start, computed_duration }
}

async function render_video(template_filepath: string, output_filepath: string) {
  const template: Template = JSON.parse(decoder.decode(await Deno.readFile(template_filepath)))
  if (template.layers.length === 0) {
    throw new Error(`template "layers" must have at least one layer present.`)
  }

  const ffmpeg_cmd: (string | number)[] = [
    'ffmpeg',
    // debugging turn off:
    '-v',
    'error',
  ]
  const audio_input_ids: string[] = []

  const probed_info = await Promise.all(template.layers.map(l => probe_video(l.video)))
  const longest_duration = compute_longest_duration(template, probed_info)

  const background_width =
    template.size.width === 'inherit' ? probed_info[0].width : template.size.width
  const background_height =
    template.size.height === 'inherit' ? probed_info[0].height : template.size.height

  let complex_filter_inputs = `color=s=${background_width}x${background_height}:c=black:d=${longest_duration}[base];`
  let complex_filters = '[base]'
  for (const i of template.layers.keys()) {
    const info = probed_info[i]
    const layer = template.layers[i]
    const { layout } = layer
    const video_id = `v_in_${i}`

    const widthInput =
      typeof layout?.width === 'string'
        ? parse_fraction(layout.width) * background_width
        : layout?.width
    const heightInput =
      typeof layout?.height === 'string'
        ? parse_fraction(layout?.height) * background_height
        : layout?.height
    let width = widthInput
      ? widthInput
      : heightInput
      ? heightInput * (info.width / info.height)
      : info.width
    let height = heightInput
      ? heightInput
      : widthInput
      ? widthInput / (info.width / info.height)
      : info.height

    const time = compute_timeline(layer.timeline, info.duration, longest_duration)

    const setpts = `setpts=PTS+${time.start}/TB`
    // NOTE it is intentional that we are using the width and height before they are manipulated by crop
    const vscale = `scale=${width}:${height}`
    const video_input_filters: string[] = [setpts, vscale]

    if (layer.crop && Object.keys(layer.crop).length) {
      const { left, right, top, bottom } = layer.crop

      let xCrop = 0
      let yCrop = 0
      let widthCrop = 'in_w'
      let heightCrop = 'in_h'
      if (right) {
        widthCrop = `in_w - ${right}`
        width -= right
      }
      if (bottom) {
        heightCrop = `in_h - ${bottom}`
        height -= bottom
      }
      if (left) {
        xCrop = left
        width -= left
        widthCrop = `${widthCrop} - ${xCrop}`
      }
      if (top) {
        yCrop = top
        height -= top
        heightCrop = `${heightCrop} - ${yCrop}`
      }
      const crop = `crop=w=${widthCrop}:h=${heightCrop}:x=${xCrop}:y=${yCrop}:keep_aspect=1`
      video_input_filters.push(crop)
    }

    let x: string | number = 0
    let y: string | number = 0
    let xAlign = 'left'
    let yAlign = 'top'
    if (typeof layout?.x === 'object') x = layout.x.offset ?? 0
    else if (typeof layout?.x === 'number') x = layout.x
    if (typeof layout?.y === 'object') y = layout.y.offset ?? 0
    else if (typeof layout?.y === 'number') y = layout.y
    xAlign = typeof layout?.x === 'object' ? layout.x.align ?? 'left' : 'left'
    yAlign = typeof layout?.y === 'object' ? layout.y.align ?? 'top' : 'top'

    if (typeof x === 'string') {
      const fraction = parse_fraction(x)
      x = `(main_w * ${fraction})`
    } else if (x < 0) {
      x = background_width + x
    }
    switch (xAlign) {
      case 'left':
        break
      case 'right':
        x = `main_w - ${width} + ${x}`
        break
      case 'center':
        x = `(main_w / 2) - ${width / 2} + ${x}`
        break
    }
    if (typeof y === 'string') {
      const fraction = parse_fraction(y)
      y = `(main_w * ${fraction})`
    } else if (y < 0) {
      y = background_height + y
    }
    switch (yAlign) {
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

    const atrim = `atrim=0:${time.computed_duration}`
    const adelay = `adelay=${time.start * 1000}:all=1`
    const volume = `volume=${layer.audio_volume ?? 0}`
    // TODO use anullsink for audio_volume === 0 to avoid extra processing
    complex_filter_inputs += `[${i}:a] asetpts=PTS-STARTPTS, ${volume}, ${atrim}, ${adelay}[a_in_${i}];`
    audio_input_ids.push(`[a_in_${i}]`)

    ffmpeg_cmd.push('-ss', time.trim_start, '-t', time.computed_duration, '-i', layer.video)

    let overlay_filter = `overlay=x=${x}:y=${y}:enable='between(t,${time.start},${
      time.start + time.computed_duration
    })'`
    if (i === 0) {
      complex_filters += `[${video_id}] ${overlay_filter}`
    } else {
      complex_filters += `[v_out_${i - 1}];[v_out_${i - 1}][${video_id}] ${overlay_filter}`
    }
  }
  complex_filters += '[video]'
  ffmpeg_cmd.push('-map', '[video]')

  if (args['render-sample-frame']) {
    if (longest_duration < parse_duration(args['render-sample-frame'])) {
      throw new Error(
        `InputError: sample-frame position ${args['render-sample-frame']} is greater than duration of the output (${longest_duration})`
      )
    }
    ffmpeg_cmd.push('-ss', args['render-sample-frame'], '-vframes', '1')
  } else {
    // we dont care about audio output for sample frame renders
    const audio_inputs = audio_input_ids.join('')
    complex_filters += `;${audio_inputs} amix=inputs=2 [audio]`
    ffmpeg_cmd.push('-map', '[audio]')
  }

  const complex_filter = `${complex_filter_inputs} ${complex_filters}`
  ffmpeg_cmd.push('-filter_complex', `${complex_filter}`)
  ffmpeg_cmd.push(output_filepath)
  if (args.overwrite) ffmpeg_cmd.push('-y')

  await exec(ffmpeg_cmd as string[])
}

async function try_render_video(template_filepath: string, output_filepath: string) {
  try {
    console.log('rendering...')
    await render_video(template_filepath, output_filepath)
    console.log('ffmpeg command complete.')
  } catch (e) {
    // TODO bubble up unexpected errors
    console.error(e)
  }
}

const args = flags.parse(Deno.args)
if (args._.length !== 2) {
  console.error(`splitscreen-templates v0.1.0

Usage: splitscreen-templates <template> <output_filepath> [options]

OPTIONS:
  --render-sample-frame <timestamp>         Instead of outputting the whole video, output a single frame as a jpg.
                                            Use this flag to set up your layouts and iterate quickly. Note that
                                            you must change <output_filepath> to be an image filename (e.g. frame.jpg).

  --overwrite                               Overwrite an existing output file

  --watch                                   Run continously when the template file changes. This is most useful
                                            in tandem with --render-sample-frame`)
  Deno.exit(1)
}

const [template_filepath, output_filepath] = Deno.args
const output_filepath_is_image = ['.jpg', '.jpeg', '.png'].some(ext =>
  output_filepath.endsWith(ext)
)
if (args['render-sample-frame'] && !output_filepath_is_image) {
  throw new Error(
    'Invalid commands. <output_filepath> must be a video filename when rendering video output.'
  )
}
if (!args['render-sample-frame'] && output_filepath_is_image) {
  throw new Error(
    'Invalid commands. <output_filepath> must be an image filename when using --render-sample-frame.'
  )
}

await try_render_video(template_filepath, output_filepath)

if (args.watch) {
  let lock = false
  for await (const event of Deno.watchFs(template_filepath)) {
    if (event.kind === 'modify' && !lock) {
      lock = true
      try_render_video(template_filepath, output_filepath).then(() => {
        lock = false
      })
    }
  }
}
