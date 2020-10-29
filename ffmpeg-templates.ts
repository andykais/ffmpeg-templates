import * as flags from 'https://deno.land/std@0.75.0/flags/mod.ts'

type Alignment = 'center' | 'topleft' | 'bottomright'
type Fraction = string
type Pixels = number
type Percentage = number
type Offset =
  | Fraction // TODO parse strings as fractions (e.g. 1/4 means a quarter of the screen)
  // | 'auto' // auto usually means 'to fit' unless both axis have 'auto', then we center it
  // | 'fit'
  // | 'fill'
  | Pixels // TODO negative numbers are allowed and translate to 'main_w - ${right}' or 'main_h - ${bottom}'
type Seconds = number
type Duration = string

type Timestamp = string

type Size =
  | 'inherit' // inherit the size from the first layer
  | Pixels

type Template = {
  size: { width: Size; height: Size }
  layers: {
    video: string
    audio_volume: Percentage
    start_at: Duration
    layout: {
      x: Offset | { offset?: Offset; align?: 'left' | 'right' | 'center' }
      y: Offset | { offset?: Offset; align?: 'top' | 'bottom' | 'center' }
      width: Fraction | Pixels
      height: Fraction | Pixels
    }
    crop?: {
      left?: Pixels
      right?: Pixels
      top?: Pixels
      bottom?: Pixels
    }
    timeline?: {
      align?: 'start' | 'end' // defaults to 'start'
      offset?: string // defaults to 00:00:00 (also accepts negative durations: -00:00:01)
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
    'quiet',
    '-print_format',
    'json',
    '-show_streams',
    filepath,
  ])
  const info = JSON.parse(result)
  const video_stream = info.streams.find((s: any) => s.codec_type === 'video')
  const audio_stream = info.streams.find((s: any) => s.codec_type === 'audio')

  if (!video_stream) throw new Error(`ProbeError: input "${filepath}" has no video stream`)
  const has_audio = audio_stream !== undefined
  const { width, height } = video_stream

  // throw new Error('e')
  // TODO include duration to vet the sample-frame position
  const duration = parse_duration(video_stream.tags.DURATION)
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
    let duration = info.duration + parsed_offset

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
  const { align, offset, trim, duration } = timeline || {}

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
    // '-v',
    // 'quiet',
  ]

  const probed_info = await Promise.all(template.layers.map(l => probe_video(l.video)))
  console.log(probed_info)
  // Deno.exit()
  const longest_duration = compute_longest_duration(template, probed_info)

  const background_width =
    template.size.width === 'inherit' ? probed_info[0].width : template.size.width
  const background_height =
    template.size.height === 'inherit' ? probed_info[0].height : template.size.height

  let complex_filter_inputs = `color=s=${background_width}x${background_height}:c=black:d=${longest_duration}[base];`
  let complex_filter_crops = ''
  let complex_filters = '[base]'
  for (const i of template.layers.keys()) {
    const info = probed_info[i]
    const layer = template.layers[i]

    const { layout } = layer

    const input_id = `v_in_${i}`
    let id = input_id

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
    const width_before_crop = width
    const height_before_crop = height

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
      const id_cropped = `${id}_crop`

      complex_filter_crops += `[${id}]crop=w=${widthCrop}:h=${heightCrop}:x=${xCrop}:y=${yCrop}:keep_aspect=1[${id_cropped}];`
      id = id_cropped
    }

    let x =
      typeof layout?.x === 'object' ? layout.x.offset || 0 : layout?.x === undefined ? 0 : layout.x
    let y =
      typeof layout?.y === 'object' ? layout.y.offset || 0 : layout?.y === undefined ? 0 : layout.y
    let xAlign = typeof layout?.x === 'object' ? layout.x.align : 'left'
    let yAlign = typeof layout?.y === 'object' ? layout.y.align : 'top'

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
        x = `${background_width} - ${width} + ${x}`
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
        y = `${background_height} - ${height} + ${y}`
        break
      case 'center':
        // y = `${y} - ${height / 2}`
        y = `(main_h / 2) - ${height / 2} + ${y}`
        break
    }
    const time = compute_timeline(layer.timeline, info.duration, longest_duration)
    console.log({ time })

    complex_filter_inputs += `[${i}] setpts=PTS+${time.start}/TB, scale=${width_before_crop}:${height_before_crop} [${input_id}];`
    ffmpeg_cmd.push('-ss', time.trim_start, '-t', time.computed_duration)

    const filter = `overlay=x=${x}:y=${y}:enable='between(t,${time.start},${time.computed_duration})'`

    ffmpeg_cmd.push('-i', layer.video)
    // console.log({ x, y, width, height, info })
    if (i === 0) {
      complex_filters += `[${id}] ${filter}`
    } else {
      complex_filters += `[v_out_${i}];[v_out_${i}][${id}] ${filter}`
    }
  }

  if (args['render-sample-frame']) {
    ffmpeg_cmd.push('-ss', args['render-sample-frame'], '-vframes', '1')
  } else {
    // we dont care about audio output for layout captures
    const audio_weights = template.layers
      .map(l => (l.audio_volume === undefined ? 1 : l.audio_volume))
      .filter((_, i) => probed_info[i].has_audio)
    // console.log({ audio_weights })
    const no_audio = audio_weights.every(w => w === 0)

    if (no_audio) {
      ffmpeg_cmd.push('-an')
    } else {
      complex_filters += `;amix=inputs=${
        audio_weights.length
      }:duration=first:dropout_transition=1:weights=${audio_weights.join(' ')}`
    }
  }

  const complex_filter = `${complex_filter_inputs} ${complex_filter_crops} ${complex_filters}`
  ffmpeg_cmd.push('-filter_complex', `${complex_filter}`)
  ffmpeg_cmd.push(output_filepath)
  if (args.overwrite) ffmpeg_cmd.push('-y')

  // console.log(ffmpeg_cmd.map(a => `'${a}'`).join(' '))
  await exec(ffmpeg_cmd as string[])
  console.log('ffmpeg command complete.')
}

async function try_render_video(template_filepath: string, output_filepath: string) {
  try {
    await render_video(template_filepath, output_filepath)
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
