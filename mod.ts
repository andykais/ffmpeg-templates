import * as io from 'https://deno.land/std@0.75.0/io/mod.ts'
import * as path from 'https://deno.land/std@0.75.0/path/mod.ts'
import * as math from './float_math.ts'
import * as errors from './errors.ts'
import { parse_duration, parse_fraction, parse_ffmpeg_packet } from './text_parsers.ts'
import { TIMELINE_ENUMS } from './structs.ts'
import type {
  Fraction,
  Pixels,
  Percentage,
  Offset,
  Seconds,
  Timestamp,
  ClipID,
  TimelineEnums,
  Size,
  Clip,
  Template,
  TemplateParsed,
} from './structs.ts'

const decoder = new TextDecoder()

function parse_template(template_input: Template, cwd: string): TemplateParsed {
  if (template_input.clips.length === 0) {
    throw new errors.InputError(`template "clips" must have at least one clip present.`)
  }
  const clips: TemplateParsed['clips'] = []
  for (const i of template_input.clips.keys()) {
    const clip = template_input.clips[i]
    const id = clip.id ?? `CLIP_${i}`
    if (clips.find(c => c.id === id)) throw new errors.InputError(`Clip id ${id} is defined more than once.`)
    const filepath = path.resolve(cwd, clip.file)
    clips.push({ ...clip, id, filepath })
  }
  const timeline = template_input.timeline ?? { '00:00:00': clips.map(clip => [clip.id]) }
  const default_size = { fraction: '1/1', of: clips[0]?.id }
  const size = {
    width: template_input.size?.width ?? default_size,
    height: template_input.size?.height ?? default_size,
  }
  return { ...template_input, size, clips, timeline }
}

type OnReadLine = (line: string) => void
async function exec(cmd: string[], readline_cb?: OnReadLine) {
  const proc = Deno.run({ cmd, stdout: 'piped' })
  if (readline_cb) {
    for await (const line of io.readLines(proc.stdout)) {
      readline_cb(line)
    }
  }
  const result = await proc.status()
  const output_buffer = await proc.output()
  const output = decoder.decode(output_buffer)
  await proc.close()
  if (result.success) {
    return output
  } else {
    throw new errors.CommandError(`Command "${cmd.join(' ')}" failed.\n\n${output}`)
  }
}

interface ClipInfoMap {
  [clip_id: string]: {
    width: number
    height: number
    has_audio: boolean
    duration: Seconds
  }
}
async function probe_clips(template: TemplateParsed): Promise<ClipInfoMap> {
  const probe_clips_promises = template.clips.map(async clip => {
    const result = await exec([
      'ffprobe',
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_entries',
      'stream=width,height,codec_type:stream_tags=rotate',
      // 'format=duration',
      clip.filepath,
    ])
    const info = JSON.parse(result)
    const video_stream = info.streams.find((s: any) => s.codec_type === 'video')
    const audio_stream = info.streams.find((s: any) => s.codec_type === 'audio')

    if (!video_stream) throw new errors.ProbeError(`Input "${clip.file}" has no video stream`)
    const has_audio = audio_stream !== undefined
    const rotation = video_stream.tags?.rotate ? (parseInt(video_stream.tags?.rotate) * Math.PI) / 180.0 : 0
    let { width, height } = video_stream
    ;[height, width] = [
      Math.abs(width * Math.sin(rotation)) + Math.abs(height * Math.cos(rotation)),
      Math.abs(width * Math.cos(rotation)) + Math.abs(height * Math.sin(rotation)),
    ].map(Math.floor)

    // ffprobe's duration is unreliable. The best solutions I have are:
    // 1. ffmpeg guessing: https://stackoverflow.com/a/33115316/3795137
    // 2. ffprobe packets: https://stackoverflow.com/a/33346572/3795137 but this is a ton of output, so were using ffmpeg
    // I picked #2 because #1 is very slow to complete, it has to iterate the whole video, often at regular playback speed
    let packet_str_buffer: string[] = []
    const out = await exec(['ffprobe', '-v', 'error', '-show_packets', '-i', clip.filepath], line => {
      if (line === '[PACKET]') packet_str_buffer = []
      packet_str_buffer.push(line)
    })
    const packet = parse_ffmpeg_packet(packet_str_buffer)
    const duration = parseFloat(packet.dts_time)
    return { width, height, has_audio, duration }
  })

  const probed_clips = await Promise.all(probe_clips_promises)
  return probed_clips.reduce((acc: ClipInfoMap, clip_info, i) => {
    acc[template.clips[i].id] = clip_info
    return acc
  }, {})
}

function get_clip(clip_info_map: ClipInfoMap, clip_id: ClipID) {
  const clip = clip_info_map[clip_id]
  if (!clip) throw new errors.InputError(`Clip ${clip_id} does not exist.`)
  return clip
}

interface ClipGeometryMap {
  [clip_id: string]: {
    x: number | string
    y: number | string
    width: number
    height: number
    scale: { width: number; height: number }
    crop?: {
      x: number
      y: number
      width: string
      height: string
    }
  }
}
function compute_geometry(template: TemplateParsed, clip_info_map: ClipInfoMap) {
  const { size } = template
  const background_width =
    typeof size.width === 'number'
      ? size.width
      : parse_fraction(size.width.fraction) * get_clip(clip_info_map, size.width.of).width
  const background_height =
    typeof size.height === 'number'
      ? size.height
      : parse_fraction(size.height.fraction) * get_clip(clip_info_map, size.height.of).height

  const clip_geometry_map: ClipGeometryMap = {}
  for (const clip of template.clips) {
    const info = get_clip(clip_info_map, clip.id)
    const { layout } = clip

    const input_width =
      typeof layout?.width === 'string' ? parse_fraction(layout.width) * background_width : layout?.width
    const input_height =
      typeof layout?.height === 'string' ? parse_fraction(layout?.height) * background_height : layout?.height
    let width = input_width ?? (input_height ? input_height * (info.width / info.height) : info.width)
    let height = input_height ?? (input_width ? input_width / (info.width / info.height) : info.height)

    const scale = { width, height }

    let crop: ClipGeometryMap[string]['crop']
    if (clip.crop && Object.keys(clip.crop).length) {
      const { left, right, top, bottom } = clip.crop
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
      crop = { width: width_crop, height: height_crop, x: x_crop, y: y_crop }
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
    if (typeof layout?.x === 'string') x = `(main_w * ${parse_fraction(layout.x)})`
    if (typeof layout?.y === 'string') y = `(main_w * ${parse_fraction(layout.y)})`

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
    clip_geometry_map[clip.id] = { x, y, width, height, scale, crop }
  }
  return { background_width, background_height, clip_geometry_map }
}

interface TimelineClip {
  clip_id: ClipID
  duration: number
  start_at: number
  trim_start: number
}
function compute_timeline(template: TemplateParsed, clip_info_map: ClipInfoMap) {
  const { timeline } = template

  const all_clips_trim_to_fit = Object.values(template.timeline).every(layers =>
    layers.every(layer =>
      layer
        .filter(id => id !== TIMELINE_ENUMS.PAD)
        .map(id => {
          const clip = template.clips.find(c => c.id === id)
          if (!clip) throw new errors.InputError(`Clip ${id} does not exist.`)
          return clip
        })
        .every(clip => clip.trim?.start === 'fit' || clip.trim?.end === 'fit')
    )
  )

  function calculate_layer_duration(layer: ClipID[], index: number, skip_trim_fit: boolean) {
    let layer_duration = 0
    for (const clip_index of layer.keys()) {
      // start at the specified index
      if (clip_index < index) continue
      const clip_id = layer[clip_index]
      // PAD does nothing while calculating longest duration
      if (clip_id === TIMELINE_ENUMS.PAD) continue

      const info = get_clip(clip_info_map, clip_id)
      const clip = template.clips.find(c => c.id === clip_id)!
      const { trim } = clip

      let clip_duration = info.duration

      if (trim?.start === 'fit') {
      } else if (trim?.start) {
        clip_duration -= parse_duration(trim.start)
      }
      if (trim?.end === 'fit') {
      } else if (trim?.end) clip_duration -= parse_duration(trim.end)

      if (clip_duration < 0) {
        throw new errors.InputError(
          `Clip ${clip_id} was trimmed ${clip_duration} seconds more than its total duration`
        )
      }
      if (clip.duration) {
        const manual_duration = parse_duration(clip.duration)
        if (manual_duration > clip_duration)
          throw new errors.InputError(
            `Clip ${clip_id}'s duration (including trimmings) cannot be shorter than the specified duration.`
          )
        else clip_duration = manual_duration
      }
      // we skip the fit trimmed clips _unless_ theyre all fit trimmed
      if ([trim?.start, trim?.end].includes('fit') && !all_clips_trim_to_fit) continue
      layer_duration += clip_duration
    }
    return layer_duration
  }

  let longest_duration = 0
  let shortest_duration = Infinity
  for (const start_position of Object.keys(timeline)) {
    const start_position_seconds = parse_duration(start_position)

    for (const clips of Object.values(timeline[start_position])) {
      let layer_duration = start_position_seconds

      layer_duration += calculate_layer_duration(clips, 0, all_clips_trim_to_fit)
      longest_duration = Math.max(longest_duration, layer_duration)
      shortest_duration = Math.min(shortest_duration, layer_duration)
    }
  }
  const total_duration = all_clips_trim_to_fit ? shortest_duration : longest_duration

  const layer_ordered_clips: TimelineClip[][] = []
  for (const start_position of Object.keys(timeline)) {
    const start_position_seconds = parse_duration(start_position)
    for (const layer_index of timeline[start_position].keys()) {
      const clips = timeline[start_position][layer_index]

      let layer_start_position = start_position_seconds
      for (const clip_index of clips.keys()) {
        const clip_id = clips[clip_index]
        if (clip_id === TIMELINE_ENUMS.PAD) {
          const remaining_duration = calculate_layer_duration(clips, clip_index + 1, true)
          const seconds_until_complete = total_duration - (layer_start_position + remaining_duration)
          if (math.gt(seconds_until_complete, 0)) layer_start_position += seconds_until_complete
        } else {
          const info = get_clip(clip_info_map, clip_id)
          const clip = template.clips.find(c => c.id === clip_id)!
          const { trim } = clip
          let clip_duration = info.duration
          let trim_start = 0
          if (trim?.end === 'fit') {
            const remaining_duration = calculate_layer_duration(clips, clip_index + 1, true)
            const seconds_until_complete =
              layer_start_position + clip_duration + remaining_duration - total_duration
            // sometimes we will just skip the clip entirely if theres no room
            if (math.gte(seconds_until_complete, clip_duration)) continue
            if (math.gt(seconds_until_complete, 0)) clip_duration -= seconds_until_complete
          } else if (trim?.end) clip_duration -= parse_duration(trim.end)

          if (trim?.start === 'fit' && trim?.end === 'fit') {
          } else if (trim?.start === 'fit') {
            const remaining_duration = calculate_layer_duration(clips, clip_index + 1, true)
            const seconds_until_complete =
              layer_start_position + clip_duration + remaining_duration - total_duration
            // sometimes we will just skip the clip entirely if theres no room
            if (math.gte(seconds_until_complete, clip_duration)) continue
            if (math.gt(seconds_until_complete, 0)) {
              trim_start = seconds_until_complete
              clip_duration -= seconds_until_complete
            }
          } else if (trim?.start) {
            trim_start = parse_duration(trim.start)
            clip_duration -= trim_start
          }
          if (clip.duration) {
            const manual_duration = parse_duration(clip.duration)
            clip_duration = manual_duration
          }

          layer_ordered_clips[layer_index] = layer_ordered_clips[layer_index] ?? []
          layer_ordered_clips[layer_index].push({
            clip_id: clip_id,
            duration: clip_duration,
            trim_start,
            start_at: layer_start_position,
          })
          layer_start_position += clip_duration
        }
      }
    }
  }
  return {
    // flatten the layers and timelines into a single stream of overlays
    // (where the stuff that should appear in the background is first)
    timeline: layer_ordered_clips.reduce((acc: TimelineClip[], layer) => [...acc, ...layer], []),
    total_duration,
  }
}

type FfmpegProgress = {
  out_time: Timestamp
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
        progress.percentage = value === 'end' ? 1 : parse_duration(progress.out_time!) / longest_duration
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

interface RenderOptions {
  overwrite?: boolean
  ffmpeg_verbosity?: 'quiet' | 'error' | 'warning' | 'info' | 'debug'
  progress_callback?: OnProgress
  cwd?: string
}
interface RenderOptionsInternal extends RenderOptions {
  render_sample_frame?: Timestamp
}
async function render(
  template_input: Template,
  output_filepath: string,
  options?: RenderOptionsInternal
): Promise<TemplateParsed> {
  const template = parse_template(template_input, options?.cwd ?? Deno.cwd())

  const clip_info_map = await probe_clips(template)
  const { background_width, background_height, clip_geometry_map } = compute_geometry(template, clip_info_map)
  const { timeline, total_duration } = compute_timeline(template, clip_info_map)

  const complex_filter_inputs = [
    `color=s=${background_width}x${background_height}:color=black:duration=${total_duration}[base]`,
  ]
  const complex_filter_overlays: string[] = []
  const audio_input_ids: string[] = []
  const ffmpeg_cmd: (string | number)[] = ['ffmpeg', '-v', options?.ffmpeg_verbosity ?? 'info']
  for (const i of timeline.keys()) {
    const { clip_id, start_at, trim_start, duration } = timeline[i]
    const clip = template.clips.find(c => c.id === clip_id)!
    const info = clip_info_map[clip_id]
    const geometry = clip_geometry_map[clip_id]

    const setpts = `setpts=PTS+${start_at}/TB`
    const vscale = `scale=${geometry.scale.width}:${geometry.scale.height}`
    const video_input_filters = [setpts, vscale]
    if (geometry.crop) {
      const { crop } = geometry
      video_input_filters.push(`crop=w=${crop.width}:h=${crop.height}:x=${crop.x}:y=${crop.y}:keep_aspect=1`)
    }
    complex_filter_inputs.push(`[${i}:v] ${video_input_filters.join(', ')} [v_in_${i}]`)
    if (!options?.render_sample_frame && info.has_audio) {
      const audio_filters = [
        `asetpts=PTS-STARTPTS`,
        `atrim=0:${duration}`,
        `adelay=${start_at * 1000}:all=1`,
        `volume=${clip.audio_volume ?? 1}`, // TODO use anullsink for audio_volume === 0 to avoid extra processing
      ]
      complex_filter_inputs.push(`[${i}:a] ${audio_filters.join(', ')}[a_in_${i}]`)
      audio_input_ids.push(`[a_in_${i}]`)
    }
    ffmpeg_cmd.push('-ss', trim_start, '-t', duration, '-i', clip.filepath)

    const overlay_enable_timespan = `enable='between(t,${start_at},${start_at + duration})'`
    const overlay_filter = `overlay=x=${geometry.x}:y=${geometry.y}:${overlay_enable_timespan}`
    if (i === 0) {
      complex_filter_overlays.push(`[base][v_in_${i}] ${overlay_filter} [v_out_${i}]`)
    } else {
      complex_filter_overlays.push(`[v_out_${i - 1}][v_in_${i}] ${overlay_filter} [v_out_${i}]`)
    }
  }
  const complex_filter = [...complex_filter_inputs, ...complex_filter_overlays]
  ffmpeg_cmd.push('-map', `[v_out_${timeline.length - 1}]`)

  if (options?.render_sample_frame) {
    // we dont care about audio output for sample frame renders
    if (total_duration < parse_duration(options.render_sample_frame)) {
      throw new errors.InputError(
        `sample-frame position ${options.render_sample_frame} is greater than duration of the output (${total_duration})`
      )
    }
    ffmpeg_cmd.push('-ss', options.render_sample_frame, '-vframes', '1')
  } else if (audio_input_ids.length === 0) {
    // do not include audio
  } else if (audio_input_ids.length === 1) {
    ffmpeg_cmd.push('-map', audio_input_ids[0])
  } else {
    const audio_inputs = audio_input_ids.join('')
    complex_filter.push(`${audio_inputs} amix=inputs=${audio_input_ids.length} [audio]`)
    // complex_filter_overlays.push(`${audio_inputs} amix=inputs=${audio_input_ids.length} [audio]`)
    ffmpeg_cmd.push('-map', '[audio]')
  }
  ffmpeg_cmd.push('-filter_complex', complex_filter.join(';\n'))
  ffmpeg_cmd.push(output_filepath)
  // console.log(ffmpeg_cmd.join('\n'))
  if (options?.overwrite) ffmpeg_cmd.push('-y')

  await ffmpeg(ffmpeg_cmd, total_duration, options?.progress_callback)

  return template
}

async function render_video(
  template_input: Template,
  output_filepath: string,
  options?: RenderOptions
): Promise<TemplateParsed> {
  return await render(template_input, output_filepath, options)
}

async function render_sample_frame(
  template_input: Template,
  output_filepath: string,
  sample_frame_position: Timestamp,
  options?: RenderOptions
): Promise<TemplateParsed> {
  return await render(template_input, output_filepath, {
    ...options,
    render_sample_frame: sample_frame_position,
  })
}

export { render_video, render_sample_frame }
export type {
  Template,
  Clip,
  Size,
  Fraction,
  Pixels,
  Offset,
  Timestamp,
  ClipID,
  TimelineEnums,
  RenderOptions,
  FfmpegProgress,
  // Seconds,
}
