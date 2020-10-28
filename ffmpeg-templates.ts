import * as flags from 'https://deno.land/std@0.75.0/flags/mod.ts'
// import * as date_fns from 'https://deno.land/x/date_fns@v2.15.0/index.js'

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
type Duration = string

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

type ProbeInfo = { width: number; height: number }
async function probe_video(filepath: string) {
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
  const { width, height } = info.streams[0]
  const has_audio = Boolean(info.streams.find((s: any) => s.codec_type === 'audio'))
  console.log(info)
  // TODO include duration to vet the sample-frame position
  // const duration = date_fns.parse(info.streams[0].tags.DURATION)
  return { filepath, width, height, has_audio }
}

async function render_video(template_filepath: string, output_filepath: string) {
  const template: Template = JSON.parse(decoder.decode(await Deno.readFile(template_filepath)))
  if (template.layers.length === 0) {
    throw new Error(`template "layers" must have at least one layer present.`)
  }

  const ffmpeg_cmd = [
    'ffmpeg',
    // debugging turn off:
    // '-v',
    // 'quiet',
  ]

  const probed_info = await Promise.all(template.layers.map(l => probe_video(l.video)))

  const background_width =
    template.size.width === 'inherit' ? probed_info[0].width : template.size.width
  const background_height =
    template.size.height === 'inherit' ? probed_info[0].height : template.size.height

  let complex_filter_inputs = `color=s=${background_width}x${background_height}:c=black[base];`
  let complex_filter_crops = ''
  let complex_filters = '[base]'
  for (const i of template.layers.keys()) {
    const info = probed_info[i]
    const layer = template.layers[i]

    const { layout } = layer

    const input_id = `v_in_${i}`
    let id = input_id
    // TODO add start_at, respect first layer's video length
    // https://superuser.com/questions/508859/how-can-i-specify-how-long-i-want-an-overlay-on-a-video-to-last-with-ffmpeg
    // let filter = 'crop=100:100:0:0'

    if (layer.crop) {
    }

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
    if (layer.crop) {
      const { left, right, top, bottom } = layer.crop

      const xCrop = left !== undefined ? left : 0
      const yCrop = top !== undefined ? top : 0
      let widthCrop = right !== undefined ? `in_w - ${right}` : 'in_w'
      let heightCrop = bottom !== undefined ? `in_h - ${bottom}` : 'in_h'
      if (xCrop) widthCrop = `${widthCrop} - ${xCrop}`
      if (yCrop) heightCrop = `${heightCrop} - ${yCrop}`
      // console.log('crop', { x, y, height, width })
      const id_cropped = `${id}_crop`

      complex_filter_crops += `[${id}]crop=${widthCrop}:${heightCrop}:${xCrop}:${yCrop}:keep_aspect=1[${id_cropped}];`
      id = id_cropped
      if (left) width -= left
      if (right) width -= right
      if (top) height -= top
      if (bottom) height -= bottom
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
    // complex_filter_inputs += `[${i}] setpts=PTS-STARTPTS, scale=${width_before_crop}:${height_before_crop} [${input_id}];`
    complex_filter_inputs += `[${i}:v] scale=${width_before_crop}:${height_before_crop} [${input_id}];`
    // const filter = `overlay=x=${x}:y=${y}`
    const filter = `overlay=shortest=1:x=${x}:y=${y}`

    ffmpeg_cmd.push('-i', layer.video)
    console.log({ x, y, width, height, info })
    if (i === 0) {
      complex_filters += `[${id}] ${filter}`
    } else {
      complex_filters += `[v_out_${i}];[v_out_${i}][${id}] ${filter}`
    }
  }

  // console.log(probed_info)
  // Deno.exit()
  if (args['render-sample-frame']) {
    ffmpeg_cmd.push('-ss', args['render-sample-frame'], '-vframes', '1')
  } else {
    // we dont care about audio output for layout captures
    const audio_weights = template.layers
      .map(l => (l.audio_volume === undefined ? 1 : l.audio_volume))
      .filter((_, i) => probed_info[i].has_audio)
    console.log({ audio_weights })
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
  // if (args['render-sample-frame']) {
  //   ffmpeg_cmd.push('-c:v', 'mjpeg') // TODO we lost frame capturing?
  // }
  ffmpeg_cmd.push(output_filepath)
  if (args.overwrite) ffmpeg_cmd.push('-y')
  // console.log(ffmpeg_cmd.map(a => `'${a}'`).join(' '))

  // ffmpeg_cmd.push('-abdf')
  await exec(ffmpeg_cmd as string[])
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

await render_video(template_filepath, output_filepath)

if (args.watch) {
  let lock = false
  for await (const event of Deno.watchFs(template_filepath)) {
    if (event.kind === 'modify' && !lock) {
      lock = true
      await render_video(template_filepath, output_filepath)
      lock = false
    }
  }
}
