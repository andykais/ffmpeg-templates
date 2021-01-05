import * as io from 'https://deno.land/std@0.75.0/io/mod.ts'
import * as path from 'https://deno.land/std@0.75.0/path/mod.ts'
import * as math from './float_math.ts'
import { ProbeError, CommandError, InputError } from './errors.ts'
import {
  parse_unit,
  parse_percentage,
  parse_pixels,
  parse_duration,
  parse_aspect_ratio,
  parse_ffmpeg_packet,
} from './text_parsers.ts'
import { TIMELINE_ENUMS } from './structs.ts'
import type { Pixels, Percentage, Timestamp, ClipID, TimelineEnums, Clip, Template } from './structs.ts'

type Seconds = number
// Parsed Template
interface TemplateParsed extends Template {
  size: NonNullable<Required<Template['size']>>
  clips: (Clip & { id: ClipID; filepath: string })[]
  timeline: { [start_position: string]: (ClipID | TimelineEnums)[][] }
  preview: NonNullable<Template['preview']>
}

const decoder = new TextDecoder()

function parse_template(template_input: Template, cwd: string): TemplateParsed {
  if (template_input.clips.length === 0) {
    throw new InputError(`template "clips" must have at least one clip present.`)
  }
  const clips: TemplateParsed['clips'] = []
  for (const i of template_input.clips.keys()) {
    const clip = template_input.clips[i]
    const id = clip.id ?? `CLIP_${i}`
    if (clips.find(c => c.id === id)) throw new InputError(`Clip id ${id} is defined more than once.`)
    const filepath = path.resolve(cwd, clip.file)
    if (clip.trim?.stop && clip.trim?.end) {
      throw new InputError('Clip cannot provide both trim.stop and trim.end')
    } else if (clip.trim?.stop && clip.duration) {
      throw new InputError('Clip cannot provide both trim.stop and duration')
    }
    clips.push({ ...clip, id, filepath })
  }
  const timeline = template_input.timeline ?? { '00:00:00': clips.map(clip => [clip.id]) }
  const default_size: TemplateParsed['size'] = { width: '100%', height: '100%', relative_to: clips[0]?.id }
  const size = {
    ...default_size,
    ...template_input.size,
  }
  const preview = template_input.preview || '00:00:00'
  return { ...template_input, size, clips, timeline, preview }
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
    throw new CommandError(`Command "${cmd.join(' ')}" failed.\n\n${output}`)
  }
}

interface ClipInfoMap {
  [clip_id: string]: {
    width: number
    height: number
    aspect_ratio: number
    has_audio: boolean
    duration: Seconds
    type: 'video' | 'audio' | 'image'
  }
}

// The cache key is the filename only
// That means if the file is overwritten, the cache will not pick up that change
// So for now, if you edit a file, you restart the watcher
// This is fair enough since its how most video editors function (and how often are people manipulating source files?)
const clip_info_map_cache: ClipInfoMap = {}
async function probe_clips(template: TemplateParsed): Promise<ClipInfoMap> {
  const probe_clips_promises = template.clips.map(async clip => {
    if (clip_info_map_cache[clip.filepath]) return clip_info_map_cache[clip.filepath]
    console.log(`Probing file ${clip.file}`)
    const result = await exec([
      'ffprobe',
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_entries',
      'stream=width,height,display_aspect_ratio,codec_type,codec_name:stream_tags=rotate',
      // 'format=duration',
      clip.filepath,
    ])
    const info = JSON.parse(result)
    const video_stream = info.streams.find((s: any) => s.codec_type === 'video')
    const audio_stream = info.streams.find((s: any) => s.codec_type === 'audio')

    if (!video_stream) throw new ProbeError(`Input "${clip.file}" has no video stream`)
    const has_audio = audio_stream !== undefined
    let rotation = video_stream.tags?.rotate ? (parseInt(video_stream.tags?.rotate) * Math.PI) / 180.0 : 0
    let { width, height } = video_stream
    // this is slightly out of order, but its important because geometry should use the expected width & height
    if (clip.rotate) rotation += (clip.rotate * Math.PI) / 180.0
    ;[height, width] = [
      Math.abs(width * Math.sin(rotation)) + Math.abs(height * Math.cos(rotation)),
      Math.abs(width * Math.cos(rotation)) + Math.abs(height * Math.sin(rotation)),
    ].map(Math.floor)

    let aspect_ratio = width / height
    if (video_stream.display_aspect_ratio) {
      aspect_ratio = parse_aspect_ratio(video_stream.display_aspect_ratio, rotation)
    }

    if (['mjpeg', 'jpeg', 'jpg', 'png'].includes(video_stream.codec_name)) {
      if (!clip.duration) throw new InputError(`Cannot specify image clip ${clip.file} without a duration`)
      const duration = parse_duration(clip.duration, template)
      if (clip.trim) {
        throw new InputError(`Cannot use 'trim' with an image clip`)
      }
      return { type: 'image' as const, width, height, aspect_ratio, has_audio, duration }
    } else {
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
      return { type: 'video' as const, width, height, aspect_ratio, has_audio, duration }
    }
  })

  const probed_clips = await Promise.all(probe_clips_promises)
  return probed_clips.reduce((acc: ClipInfoMap, clip_info, i) => {
    clip_info_map_cache[template.clips[i].filepath] = clip_info
    acc[template.clips[i].id] = clip_info
    return acc
  }, {})
}

function get_clip(clip_info_map: ClipInfoMap, clip_id: ClipID) {
  const clip = clip_info_map[clip_id]
  if (!clip) throw new InputError(`Clip ${clip_id} does not exist.`)
  return clip
}

interface ClipGeometryMap {
  [clip_id: string]: {
    x: number | string
    y: number | string
    width: number
    height: number
    scale: { width: number; height: number }
    rotate?: { degrees: number; width: number; height: number }
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

  const background_width = parse_unit(size.width, {
    percentage: p => Math.floor(p * get_clip(clip_info_map, size.relative_to).width),
  })
  const background_height = parse_unit(size.height, {
    percentage: p => Math.floor(p * get_clip(clip_info_map, size.relative_to).height),
  })

  const clip_geometry_map: ClipGeometryMap = {}
  for (const clip of template.clips) {
    const info = get_clip(clip_info_map, clip.id)
    const { layout } = clip

    const input_width = parse_unit(layout?.width, {
      percentage: p => p * background_width,
      undefined: () => null,
    })
    const input_height = parse_unit(layout?.height, {
      percentage: p => p * background_height,
      undefined: () => null,
    })

    let width = input_width ?? (input_height ? input_height * info.aspect_ratio : info.width)
    let height = input_height ?? (input_width ? input_width / info.aspect_ratio : info.height)

    let scale = { width, height }
    let rotate: ClipGeometryMap['clip-id']['rotate'] = undefined
    if (clip.rotate) {
      // we want scaling to happen before rotation because (on average) we scale down, and if we can scale
      // sooner, then we have less pixels to rotate/crop/etc
      const unrotate_for_scale = (-clip.rotate * Math.PI) / 180.0
      const [scale_height, scale_width] = [
        Math.abs(width * Math.sin(unrotate_for_scale)) + Math.abs(height * Math.cos(unrotate_for_scale)),
        Math.abs(width * Math.cos(unrotate_for_scale)) + Math.abs(height * Math.sin(unrotate_for_scale)),
      ].map(Math.floor)
      scale.width = scale_width
      scale.height = scale_height

      rotate = {
        degrees: clip.rotate,
        width: width,
        height: height,
      }
    }

    let crop: ClipGeometryMap[string]['crop']
    if (clip.crop && Object.keys(clip.crop).length) {
      const width_relative_to_crop = width
      const height_relative_to_crop = height
      const { left, right, top, bottom } = clip.crop
      let x_crop = 0
      let y_crop = 0
      let width_crop = 'in_w'
      let height_crop = 'in_h'

      if (right) {
        const r = parse_unit(right, { percentage: p => p * width_relative_to_crop })
        width_crop = `in_w - ${r}`
        width -= r
      }
      if (bottom) {
        const b = parse_unit(bottom, { percentage: p => p * height_relative_to_crop })
        height_crop = `in_h - ${b}`
        height -= b
      }
      if (left) {
        const l = parse_unit(left, { percentage: p => p * width_relative_to_crop })
        x_crop = l
        width -= l
        width_crop = `${width_crop} - ${x_crop}`
      }
      if (top) {
        const t = parse_unit(top, { percentage: p => p * height_relative_to_crop })
        y_crop = t
        height -= t
        height_crop = `${height_crop} - ${y_crop}`
      }
      crop = { width: width_crop, height: height_crop, x: x_crop, y: y_crop }
    }
    let x: string | number = 0
    let y: string | number = 0
    let x_align = 'left'
    let y_align = 'top'
    // if (typeof layout?.x?.offset) x = parse_pixels(layout.x.offset)

    const parse_x = (v: string | undefined) =>
      parse_unit(v, { pixels: x => x, percentage: x => `(main_w * ${x})`, undefined: () => 0 })
    const parse_y = (v: string | undefined) =>
      parse_unit(v, { pixels: y => y, percentage: y => `(main_h * ${y})`, undefined: () => 0 })

    if (typeof layout?.x === 'object') x = parse_x(layout.x.offset)
    else if (typeof layout?.x === 'string') x = parse_x(layout.x)
    x_align = typeof layout?.x === 'object' ? layout.x.align ?? 'left' : 'left'

    if (typeof layout?.y === 'object') y = parse_y(layout.y.offset)
    else if (typeof layout?.y === 'string') y = parse_y(layout.y)
    y_align = typeof layout?.y === 'object' ? layout.y.align ?? 'left' : 'left'

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
    clip_geometry_map[clip.id] = { x, y, width, height, scale, rotate, crop }
  }
  return { background_width, background_height, clip_geometry_map }
}

interface TimelineClip {
  clip_id: ClipID
  duration: number
  start_at: number
  speed: number
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
          if (!clip) throw new InputError(`Clip ${id} does not exist.`)
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
        clip_duration -= parse_duration(trim.start, template)
      }
      if (trim?.end === 'fit') {
      } else if (trim?.end) clip_duration -= parse_duration(trim.end, template)

      if (trim?.stop) clip_duration -= info.duration - parse_duration(trim.stop, template)
      if (clip.speed) clip_duration *= 1 / parse_percentage(clip.speed)

      if (clip_duration < 0) {
        throw new InputError(
          `Clip ${clip_id} was trimmed ${clip_duration} seconds more than its total duration`
        )
      }
      if (clip.duration) {
        const manual_duration = parse_duration(clip.duration, template)
        if (manual_duration > clip_duration)
          throw new InputError(
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
    const start_position_seconds = parse_duration(start_position, template)

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
    const start_position_seconds = parse_duration(start_position, template)
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
          const speed = clip.speed ? parse_percentage(clip.speed) : 1
          clip_duration *= 1 / speed
          let trim_start = 0
          if (trim?.end && trim?.end !== 'fit') {
            clip_duration -= parse_duration(trim.end, template)
          }
          if (trim?.stop) {
            clip_duration = parse_duration(trim.stop, template)
          }
          if (trim?.start && trim?.start !== 'fit') {
            trim_start = parse_duration(trim.start, template)
            clip_duration -= trim_start
          }

          if (trim?.end === 'fit') {
            const remaining_duration = calculate_layer_duration(clips, clip_index + 1, true)
            const seconds_until_complete =
              layer_start_position + clip_duration + remaining_duration - total_duration
            // sometimes we will just skip the clip entirely if theres no room
            if (math.gte(seconds_until_complete, clip_duration)) continue
            if (math.gt(seconds_until_complete, 0)) clip_duration -= seconds_until_complete
          }

          if (trim?.start === 'fit' && trim?.end === 'fit') {
            // do nothing, because we already trimmed the end to fit
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
          }
          if (clip.duration) {
            const manual_duration = parse_duration(clip.duration, template)
            clip_duration = Math.min(manual_duration * speed, clip_duration)
          }

          layer_ordered_clips[layer_index] = layer_ordered_clips[layer_index] ?? []
          layer_ordered_clips[layer_index].push({
            clip_id: clip_id,
            duration: clip_duration,
            trim_start,
            speed,
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

// NOTE atempo cannot exceed the range of 0.5 to 100.0. To get around this, we need to string multiple atempo calls together.
// Example provided here: https://trac.ffmpeg.org/wiki/How%20to%20speed%20up%20/%20slow%20down%20a%20video
function compute_tempo(val: number) {
  const numMultipliers =
    val > 1 ? Math.ceil(Math.log(val) / Math.log(2)) : Math.ceil(Math.log(val) / Math.log(0.5))
  const multVal = Math.pow(Math.E, Math.log(val) / numMultipliers)
  return Array(numMultipliers).fill(`atempo=${multVal}`).join(',')
}

type FfmpegProgress = {
  out_time: Timestamp
  progress: 'continue' | 'end'
  speed: string
  percentage: number
}
type OnProgress = (progress: FfmpegProgress) => void
async function ffmpeg(
  template: TemplateParsed,
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
          value === 'end' ? 1 : parse_duration(progress.out_time!, template) / longest_duration
        // sometimes ffmpeg has a negative out_time. I do not know what this means yet
        if (progress.percentage < 0) progress.percentage = 0
        progress_callback(progress as FfmpegProgress)
        progress = {}
      }
    }
    const result = await proc.status()
    if (!result.success) {
      throw new CommandError(`Command "${ffmpeg_safe_cmd.join(' ')}" failed.\n\n`)
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
  render_sample_frame?: boolean
}
async function render(
  template_input: Template,
  output_filepath: string,
  options?: RenderOptionsInternal
): Promise<{ template: TemplateParsed; rendered_clips_count: number }> {
  const template = parse_template(template_input, options?.cwd ?? Deno.cwd())

  const sample_frame = options?.render_sample_frame ? parse_duration(template.preview, template) : undefined

  const clip_info_map = await probe_clips(template)
  const { background_width, background_height, clip_geometry_map } = compute_geometry(template, clip_info_map)
  const { timeline, total_duration } = compute_timeline(template, clip_info_map)

  const complex_filter_inputs = [
    `color=s=${background_width}x${background_height}:color=black:duration=${total_duration}[base]`,
  ]
  const complex_filter_overlays: string[] = []
  const audio_input_ids: string[] = []
  const ffmpeg_cmd: (string | number)[] = ['ffmpeg', '-v', options?.ffmpeg_verbosity ?? 'info']

  let last_clip = undefined
  let input_index = 0
  for (const i of timeline.keys()) {
    const { clip_id, start_at, trim_start, duration, speed } = timeline[i]

    // we dont care about clips that do not involve the sample frame
    if (options?.render_sample_frame && !(start_at <= sample_frame! && start_at + duration >= sample_frame!))
      continue

    const clip = template.clips.find(c => c.id === clip_id)!
    const info = clip_info_map[clip_id]
    const geometry = clip_geometry_map[clip_id]

    const pts_speed = clip.speed ? `${1 / parse_percentage(clip.speed)}*` : ''
    const setpts =
      start_at === 0 ? `setpts=${pts_speed}PTS-STARTPTS` : `setpts=${pts_speed}PTS+${start_at}/TB`
    const vscale = `scale=${geometry.scale.width}:${geometry.scale.height}`
    const video_input_filters = [setpts, vscale]
    if (geometry.rotate) {
      const { degrees, width, height } = geometry.rotate
      video_input_filters.push(`rotate=${degrees}*PI/180:out_w=${width}:out_h=${height}`)
    }
    if (geometry.crop) {
      const { crop } = geometry
      video_input_filters.push(`crop=w=${crop.width}:h=${crop.height}:x=${crop.x}:y=${crop.y}:keep_aspect=1`)
    }
    complex_filter_inputs.push(`[${input_index}:v] ${video_input_filters.join(', ')} [v_in_${input_index}]`)
    if (!options?.render_sample_frame && info.has_audio) {
      const audio_filters: string[] = [
        `asetpts=PTS-STARTPTS`,
        // `atrim=0:${duration * speed}`,
        `adelay=${start_at * 1000}:all=1`,
        `volume=${clip.audio_volume ?? 1}`, // TODO use anullsink for audio_volume === 0 to avoid extra processing
      ]
      const atempo = compute_tempo(speed)
      // a.k.a. speed == 1
      if (atempo !== '') audio_filters.push(atempo)
      complex_filter_inputs.push(`[${input_index}:a] ${audio_filters.join(', ')}[a_in_${input_index}]`)
      audio_input_ids.push(`[a_in_${input_index}]`)
    }
    if (info.type === 'image') {
      ffmpeg_cmd.push('-framerate', 30, '-loop', 1, '-t', duration, '-i', clip.filepath)
    } else if (info.type === 'video') {
      ffmpeg_cmd.push('-ss', trim_start, '-t', duration, '-i', clip.filepath)
    } else if (info.type === 'audio') {
      throw new Error('unimplemented')
    }

    const overlay_filter = `overlay=x=${geometry.x}:y=${geometry.y}:eof_action=pass`
    const current_clip = `[v_out_${input_index}]`
    if (last_clip) {
      complex_filter_overlays.push(`${last_clip}[v_in_${input_index}] ${overlay_filter} ${current_clip}`)
    } else {
      complex_filter_overlays.push(`[base][v_in_${input_index}] ${overlay_filter} ${current_clip}`)
    }
    last_clip = current_clip
    input_index++
  }
  const complex_filter = [...complex_filter_inputs, ...complex_filter_overlays]
  // we may have an output that is just a black screen
  if (last_clip) ffmpeg_cmd.push('-map', last_clip)

  const map_audio_arg: string[] = []
  if (options?.render_sample_frame) {
    // we dont care about audio output for sample frame renders
    if (total_duration < sample_frame!) {
      throw new InputError(
        `sample-frame position ${template.preview} is greater than duration of the output (${total_duration})`
      )
    }
    ffmpeg_cmd.push('-ss', sample_frame!, '-vframes', '1')
  } else {
    // ffmpeg_cmd.push('-t', total_duration)
    if (audio_input_ids.length === 0) {
      // do not include audio
    } else if (audio_input_ids.length === 1) {
      map_audio_arg.push('-map', audio_input_ids[0])
    } else {
      const audio_inputs = audio_input_ids.join('')
      complex_filter.push(`${audio_inputs} amix=inputs=${audio_input_ids.length} [audio]`)
      map_audio_arg.push('-map', '[audio]')
    }
    ffmpeg_cmd.push('-vcodec', 'libx265')
    ffmpeg_cmd.push('-x265-params', 'log-level=error')
  }
  ffmpeg_cmd.push('-filter_complex', complex_filter.join(';\n'))
  ffmpeg_cmd.push(...map_audio_arg)
  // ffmpeg_cmd.push('-segment_time', '00:00:05', '-f', 'segment', 'output%03d.mp4')
  ffmpeg_cmd.push(output_filepath)
  if (options?.overwrite) ffmpeg_cmd.push('-y')
  // console.log(ffmpeg_cmd.join('\n'))
  // replace w/ this when you want to copy the command
  // console.log(ffmpeg_cmd.map(c => `'${c}'`).join(' '))

  await ffmpeg(template, ffmpeg_cmd, total_duration, options?.progress_callback)

  return { template, rendered_clips_count: input_index }
}

async function render_video(template_input: Template, output_filepath: string, options?: RenderOptions) {
  return await render(template_input, output_filepath, options)
}

async function render_sample_frame(
  template_input: Template,
  output_filepath: string,
  options?: RenderOptions
) {
  return await render(template_input, output_filepath, { ...options, render_sample_frame: true })
}

export { render_video, render_sample_frame }
export type {
  Template,
  TemplateParsed, // internal type
  Clip,
  Pixels,
  Percentage,
  Timestamp,
  ClipID,
  TimelineEnums,
  RenderOptions,
  FfmpegProgress,
  // Seconds,
}
