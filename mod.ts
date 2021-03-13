import * as io from 'https://deno.land/std@0.75.0/io/mod.ts'
import * as fs from 'https://deno.land/std@0.75.0/fs/mod.ts'
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
import type {
  Pixels,
  Percentage,
  Timestamp,
  ClipID,
  TimelineEnums,
  Clip,
  MediaClip,
  FontClip,
  Template,
} from './structs.ts'

type Seconds = number

// Parsed Template
interface MediaClipParsed extends MediaClip {
  id: ClipID
  filepath: string
  source_clip: MediaClip | FontClip
}
type Font = NonNullable<FontClip['font']>
interface FontParsed extends Font {
  color: string
  outline_color: string
  size: number
  background_radius: number
}
interface FontClipParsed extends FontClip {
  id: ClipID
  font: FontParsed
  source_clip: FontClip
}
type ClipParsed = MediaClipParsed | FontClipParsed
interface TemplateParsed extends Template {
  size: NonNullable<Required<Template['size']>>
  clips: ClipParsed[]
  // clips: (Clip & { id: ClipID; filepath: string })[]
  timeline: { [start_position: string]: (ClipID | TimelineEnums)[][] }
  preview: NonNullable<Template['preview']>
}

interface Context {
  template: TemplateParsed
  output_folder: string
}

const decoder = new TextDecoder()

function is_media_clip(clip: Clip): clip is MediaClip
function is_media_clip(clip: ClipParsed): clip is MediaClipParsed
function is_media_clip(clip: Clip | ClipParsed): clip is MediaClipParsed | MediaClip {
  return 'file' in clip
}
function is_font_clip(clip: ClipParsed): clip is FontClipParsed {
  return !is_media_clip(clip)
}

function parse_template(template_input: Template, cwd: string): TemplateParsed {
  if (template_input.clips.length === 0) {
    throw new InputError(`template "clips" must have at least one clip present.`)
  }
  const clips: TemplateParsed['clips'] = []
  for (const i of template_input.clips.keys()) {
    const clip = template_input.clips[i]
    const id = clip.id ?? `CLIP_${i}`
    if (clips.find((c) => c.id === id)) throw new InputError(`Clip id ${id} is defined more than once.`)
    if (clip.trim?.stop && clip.trim?.end) {
      throw new InputError('Clip cannot provide both trim.stop and trim.end')
    } else if (clip.trim?.stop && clip.duration) {
      throw new InputError('Clip cannot provide both trim.stop and duration')
    }

    if (is_media_clip(clip)) {
      const filepath = path.resolve(cwd, clip.file)
      clips.push({ id, filepath, ...clip, source_clip: clip })
    } else {
      // its a font
      clips.push({
        id,
        ...clip,
        font: {
          color: 'white',
          size: 12,
          outline_color: 'black',
          background_radius: 4.3,
          ...clip.font,
        },
        source_clip: clip,
      })
    }
  }
  const timeline = template_input.timeline ?? { '00:00:00': clips.map((clip) => [clip.id]) }

  const first_media_clip = clips.find(is_media_clip)
  const is_pixel_unit = { percentage: () => true, pixels: () => false, undefined: () => true }
  const has_non_pixel_unit =
    parse_unit(template_input.size?.width, is_pixel_unit) &&
    parse_unit(template_input.size?.height, is_pixel_unit)
  const relative_to_clip = clips.find((c) => c.id === template_input.size?.relative_to)
  if (relative_to_clip && !is_media_clip(relative_to_clip)) {
    throw new InputError(`Cannot specify a font clip as a relative size source`)
  } else if (has_non_pixel_unit && !first_media_clip) {
    throw new InputError(`If all clips are font clips, a size must be specified using pixel units.`)
  }

  const default_size = {
    width: '100%',
    height: '100%',
    relative_to: first_media_clip?.id ?? '__NEVER_USED_PLACEHOLDER__',
  }
  const size = { ...default_size, ...template_input.size }

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
    id: string
    filepath: string
    width: number
    height: number
    framerate: number
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
async function probe_clips(
  template: TemplateParsed,
  clips: TemplateParsed['clips'],
  use_cache = true
): Promise<ClipInfoMap> {
  // only probe media clips
  const media_clips = clips.filter(is_media_clip)

  const unique_files = new Set<string>()
  // we only need to probe files once
  const unique_media_clips = media_clips.filter((c) => unique_files.size < unique_files.add(c.filepath).size)

  const probe_clips_promises = unique_media_clips.map(async (clip: MediaClipParsed) => {
    const { id, filepath } = clip
    if (use_cache && clip_info_map_cache[filepath]) return clip_info_map_cache[filepath]
    if (is_media_clip(clip.source_clip)) console.log(`Probing file ${clip.file}`)
    else console.log(`Probing font asset ${clip.file}`)
    const result = await exec([
      'ffprobe',
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_entries',
      'stream=width,height,display_aspect_ratio,codec_type,codec_name,avg_frame_rate:stream_tags=rotate',
      // 'format=duration',
      filepath,
    ])
    const info = JSON.parse(result)
    const video_stream = info.streams.find((s: any) => s.codec_type === 'video')
    const audio_stream = info.streams.find((s: any) => s.codec_type === 'audio')

    if (!video_stream) throw new ProbeError(`Input "${clip.file}" has no video stream`)
    const has_audio = audio_stream !== undefined
    let rotation = video_stream.tags?.rotate ? (parseInt(video_stream.tags?.rotate) * Math.PI) / 180.0 : 0
    let { width, height } = video_stream
    ;({ width, height } = compute_rotated_size({ width, height }, rotation))

    let aspect_ratio = width / height
    if (video_stream.display_aspect_ratio) {
      aspect_ratio = parse_aspect_ratio(video_stream.display_aspect_ratio, rotation)
    }

    if (['mjpeg', 'jpeg', 'jpg', 'png'].includes(video_stream.codec_name)) {
      const duration = NaN
      const framerate = 60
      return {
        type: 'image' as const,
        filepath,
        id,
        width,
        height,
        aspect_ratio,
        has_audio,
        duration,
        framerate,
      }
    } else {
      const framerate = eval(video_stream.avg_frame_rate)
      // ffprobe's duration is unreliable. The best solutions I have are:
      // 1. ffmpeg guessing: https://stackoverflow.com/a/33115316/3795137
      // 2. ffprobe packets: https://stackoverflow.com/a/33346572/3795137 but this is a ton of output, so were using ffmpeg
      // I picked #2 because #1 is very slow to complete, it has to iterate the whole video, often at regular playback speed
      let packet_str_buffer: string[] = []
      const out = await exec(['ffprobe', '-v', 'error', '-show_packets', '-i', filepath], (line) => {
        if (line === '[PACKET]') packet_str_buffer = []
        packet_str_buffer.push(line)
      })
      const packet = parse_ffmpeg_packet(packet_str_buffer)
      const duration = parseFloat(packet.dts_time)
      return {
        type: 'video' as const,
        filepath,
        id,
        width,
        height,
        aspect_ratio,
        has_audio,
        framerate,
        duration,
      }
    }
  })

  const probed_clips = await Promise.all(probe_clips_promises)
  for (const probed_clip of probed_clips) {
    clip_info_map_cache[probed_clip.filepath] = probed_clip
  }
  return media_clips.reduce((acc: ClipInfoMap, clip, i) => {
    const clip_info = clip_info_map_cache[clip.filepath]
    acc[clip.id] = clip_info
    return acc
  }, {})
}

function compute_rotated_size(size: { width: number; height: number }, rotation?: number) {
  if (!rotation) return size
  const radians = (rotation * Math.PI) / 180.0
  const [height, width] = [
    Math.abs(size.width * Math.sin(radians)) + Math.abs(size.height * Math.cos(radians)),
    Math.abs(size.width * Math.cos(radians)) + Math.abs(size.height * Math.sin(radians)),
  ].map(Math.floor)

  return { width, height }
}

function get_clip<T>(clip_map: {[clip_id: string]: T}, clip_id: ClipID) {
  const clip = clip_map[clip_id]
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
      width: number
      height: number
    }
  }
}
function compute_background_size(template: TemplateParsed, clip_info_map: ClipInfoMap) {
  const { size } = template

  const compute_size = () => {
    const info = get_clip(clip_info_map, size.relative_to)
    const { rotate } = template.clips.find((c) => c.id === size.relative_to)!
    return compute_rotated_size(info, rotate)
  }
  const background_width = parse_unit(size.width, {
    percentage: (p) => Math.floor(p * compute_size().width),
  })
  const background_height = parse_unit(size.height, {
    percentage: (p) => Math.floor(p * compute_size().height),
  })
  return { background_width, background_height }
}
function compute_geometry(
  template: TemplateParsed,
  background_width: number,
  background_height: number,
  clip_info_map: ClipInfoMap
) {
  const clip_geometry_map: ClipGeometryMap = {}
  for (const clip of template.clips) {
    const info = get_clip(clip_info_map, clip.id)
    const { layout } = clip

    const input_width = parse_unit(layout?.width, {
      percentage: (p) => p * background_width,
      undefined: () => null,
    })
    const input_height = parse_unit(layout?.height, {
      percentage: (p) => p * background_height,
      undefined: () => null,
    })

    let width = input_width ?? (input_height ? input_height * info.aspect_ratio : info.width)
    let height = input_height ?? (input_width ? input_width / info.aspect_ratio : info.height)

    let scale = { width, height }
    let rotate: ClipGeometryMap['clip-id']['rotate'] = undefined
    if (clip.rotate) {
      // we want scaling to happen before rotation because (on average) we scale down, and if we can scale
      // sooner, then we have less pixels to rotate/crop/etc
      ;({ width, height } = compute_rotated_size({ width, height }, clip.rotate))
      rotate = { degrees: clip.rotate, width, height }
    }

    let crop: ClipGeometryMap[string]['crop']
    if (clip.crop && Object.keys(clip.crop).length) {
      const width_relative_to_crop = width
      const height_relative_to_crop = height
      const { left, right, top, bottom } = clip.crop
      let x_crop = 0
      let y_crop = 0
      let width_crop = scale.width
      let height_crop = scale.height

      if (right) {
        const r = parse_unit(right, { percentage: (p) => p * width_relative_to_crop })
        width_crop = width_crop - r
        width -= r
      }
      if (bottom) {
        const b = parse_unit(bottom, { percentage: (p) => p * height_relative_to_crop })
        height_crop = height_crop - b
        height -= b
      }
      if (left) {
        const l = parse_unit(left, { percentage: (p) => p * width_relative_to_crop })
        x_crop = l
        width -= l
        width_crop = width_crop - x_crop
      }
      if (top) {
        const t = parse_unit(top, { percentage: (p) => p * height_relative_to_crop })
        y_crop = t
        height -= t
        height_crop = height_crop - y_crop
      }
      crop = { width: width_crop, height: height_crop, x: x_crop, y: y_crop }
    }
    let x: string | number = 0
    let y: string | number = 0
    let x_align = 'left'
    let y_align = 'top'
    // if (typeof layout?.x?.offset) x = parse_pixels(layout.x.offset)

    const parse_x = (v: string | undefined) =>
      parse_unit(v, { pixels: (x) => x, percentage: (x) => `(main_w * ${x})`, undefined: () => 0 })
    const parse_y = (v: string | undefined) =>
      parse_unit(v, { pixels: (y) => y, percentage: (y) => `(main_h * ${y})`, undefined: () => 0 })

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
  return clip_geometry_map
}

type ClipZoompanMap = {
  [clip_id: string]: {
    start_at_seconds: number
    end_at_seconds: number

    start_x: number
    start_y: number
    start_zoom: number

    dest_x?: number
    dest_y?: number
    dest_zoom?: number

    x_expression?: string
    y_expression?: string
  }[]
}

function compute_zoompans(
  template: TemplateParsed,
  clip_info_map: ClipInfoMap,
  clip_geometry_map: ClipGeometryMap
) {
  const clip_zoompan_map: ClipZoompanMap = {}
  for (const clip of template.clips) {
    const geometry = get_clip(clip_geometry_map, clip.id)
    const { crop } = geometry
    const info = get_clip(clip_info_map, clip.id)
    clip_zoompan_map[clip.id] = []

    let prev_zoompan = { timestamp_seconds: 0, x_offset: 0, y_offset: 0, zoom: 1 }
    for (const timestamp of Object.keys(clip.zoompan ?? {})) {
      const zoompan = clip.zoompan![timestamp]
      const zoompan_end_at_seconds = parse_duration(timestamp, template)
      const next_prev_zoompan = { ...prev_zoompan, timestamp_seconds: zoompan_end_at_seconds }

      const computed_zoompan: ClipZoompanMap['<clip_id>'][0] = {
        start_at_seconds: prev_zoompan.timestamp_seconds,
        end_at_seconds: zoompan_end_at_seconds,

        start_x: prev_zoompan.x_offset,
        start_y: prev_zoompan.y_offset,
        start_zoom: prev_zoompan.zoom
      }


      if (zoompan.x) {
        // this may change in the future (by adding a pad around images)
        if (!crop) throw new InputError(`Zoompan panning cannot be used without cropping the clip`)
        const max_x_pan_distance = geometry.scale.width - crop.width
        const x_after_pan = prev_zoompan.x_offset + parse_unit(zoompan.x, { percentage: (n) => n * geometry.scale.width })
        computed_zoompan.dest_x = x_after_pan
        if (x_after_pan < 0 || x_after_pan > max_x_pan_distance) throw new InputError(`Zoompan out of bounds. X pan must be between ${0} and ${max_x_pan_distance}. ${timestamp} x input was ${x_after_pan}`)
        next_prev_zoompan.x_offset = x_after_pan

        const n_frames = (computed_zoompan.end_at_seconds - computed_zoompan.start_at_seconds) * info.framerate
        const x_step = (computed_zoompan.dest_x - computed_zoompan.start_x) / n_frames
        console.log({ x_step, from: `(${computed_zoompan.dest_x} - ${computed_zoompan.start_x}) / ${n_frames}` })
        const n_frames_so_far = info.framerate * computed_zoompan.start_at_seconds
        if (computed_zoompan.end_at_seconds === 0) { computed_zoompan.start_x = 0 }
        const x_expression = `(n - ${n_frames_so_far})*${x_step}+${computed_zoompan.start_x}`
        computed_zoompan.x_expression = x_expression
      }
      if (zoompan.y) {
        // this may change in the future (by adding a pad around images)
        if (!crop) throw new InputError(`Zoompan panning cannot be used without cropping the clip`)
        const max_y_pan_distance = geometry.scale.height - crop.height
        const y_after_pan = prev_zoompan.y_offset + parse_unit(zoompan.y, { percentage: (n) => n * geometry.scale.height })
        computed_zoompan.dest_y = y_after_pan
        if (y_after_pan < 0 || y_after_pan > max_y_pan_distance) throw new InputError(`Zoompan out of bounds. y pan must be between ${0} and ${max_y_pan_distance}. ${timestamp} y input was ${y_after_pan}`)
        next_prev_zoompan.y_offset = y_after_pan

        const n_frames = (computed_zoompan.end_at_seconds - computed_zoompan.start_at_seconds) * info.framerate
        const y_step = (computed_zoompan.dest_y - computed_zoompan.start_y) / n_frames
        const n_frames_so_far = info.framerate * computed_zoompan.start_at_seconds
        if (computed_zoompan.end_at_seconds === 0) { computed_zoompan.start_y = 0 }
        const y_eypression = `(n - ${n_frames_so_far})*${y_step}+${computed_zoompan.start_y}`
        computed_zoompan.y_expression = y_eypression
      }
      if (zoompan.zoom) {
        const zoom = parse_percentage(zoompan.zoom)
        computed_zoompan.dest_zoom = zoom
        next_prev_zoompan.zoom = zoom
      }

      prev_zoompan = next_prev_zoompan
      clip_zoompan_map[clip.id].push(computed_zoompan)
    }
    clip_zoompan_map[clip.id].sort((a,b) => a.start_at_seconds - b.start_at_seconds)
  }
  return clip_zoompan_map
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

  const all_clips_trim_to_fit = Object.values(template.timeline).every((layers) =>
    layers.every((layer) =>
      layer
        .filter((id) => id !== TIMELINE_ENUMS.PAD)
        .map((id) => {
          const clip = template.clips.find((c) => c.id === id)
          if (!clip) throw new InputError(`Clip ${id} does not exist.`)
          return clip
        })
        .every((clip) => clip.trim?.start === 'fit' || clip.trim?.end === 'fit')
    )
  )

  function calculate_layer_duration(
    layer_start_position: number,
    layer: ClipID[],
    index: number,
    skip_trim_fit: boolean
  ) {
    let layer_duration = 0
    for (const clip_index of layer.keys()) {
      // start at the specified index
      if (clip_index < index) continue
      if (clip_index > 0) layer_duration += 0.001

      const clip_id = layer[clip_index]
      // PAD does nothing while calculating longest duration
      if (clip_id === TIMELINE_ENUMS.PAD) continue

      const clip = template.clips.find((c) => c.id === clip_id)
      if (clip === undefined)
        throw new InputError(`Clip ${clip_id} does not exist. I cannot be used in the timeline.`)
      const info = get_clip(clip_info_map, clip_id)
      let clip_duration = info.duration

      const { trim } = clip

      if (trim?.stop_at_output) {
        const clip_start_position = layer_start_position + layer_duration
        clip_duration = parse_duration(trim.stop_at_output, template) - clip_start_position
      }

      if (Number.isNaN(clip_duration)) {
        if (clip.duration) clip_duration = parse_duration(clip.duration, template)
        // Images and Fonts have no file duration, so if a manual duration isnt specified, they do nothing
        else continue
      }

      if (Object.keys(trim || {}).filter((k) => ['end', 'stop', 'stop_at_output'].includes(k)).length > 1) {
        throw new InputError(`'end', 'stop', and 'stop_at_output' are mutually exclusive.`)
      }

      if (trim?.start === 'fit') {
      } else if (trim?.start) {
        if (!trim.stop_at_output) clip_duration -= parse_duration(trim.start, template)
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
        if (is_media_clip(clip) && manual_duration > clip_duration)
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

      layer_duration += calculate_layer_duration(start_position_seconds, clips, 0, all_clips_trim_to_fit)
      longest_duration = Math.max(longest_duration, layer_duration)
      shortest_duration = Math.min(shortest_duration, layer_duration)
    }
  }
  const total_duration = all_clips_trim_to_fit ? shortest_duration : longest_duration
  if (total_duration === 0 || Number.isNaN(total_duration)) {
    throw new InputError(
      'Output duration cannot be zero. If all clips are font or image clips, at least one must specify a duration.'
    )
  }

  const layer_ordered_clips: TimelineClip[][] = []
  for (const start_position of Object.keys(timeline)) {
    const start_position_seconds = parse_duration(start_position, template)
    for (const layer_index of timeline[start_position].keys()) {
      const clips = timeline[start_position][layer_index]

      let layer_start_position = start_position_seconds
      for (const clip_index of clips.keys()) {
        if (clip_index > 0) layer_start_position += 0.001
        const clip_id = clips[clip_index]
        if (clip_id === TIMELINE_ENUMS.PAD) {
          const remaining_duration = calculate_layer_duration(
            layer_start_position,
            clips,
            clip_index + 1,
            true
          )
          const seconds_until_complete = total_duration - (layer_start_position + remaining_duration)
          if (math.gt(seconds_until_complete, 0)) layer_start_position += seconds_until_complete
        } else {
          const clip = template.clips.find((c) => c.id === clip_id)!
          const info = get_clip(clip_info_map, clip_id)
          const { trim } = clip
          let clip_duration = info.duration
          if (Number.isNaN(clip_duration)) clip_duration = total_duration
          const speed = clip.speed ? parse_percentage(clip.speed) : 1
          clip_duration *= 1 / speed
          let trim_start = 0

          if (trim?.stop_at_output) {
            const clip_start_position = layer_start_position
            clip_duration = parse_duration(trim.stop_at_output, template) - clip_start_position
          }
          if (trim?.end && trim?.end !== 'fit') {
            clip_duration -= parse_duration(trim.end, template)
          }
          if (trim?.stop) {
            clip_duration = parse_duration(trim.stop, template)
          }
          if (trim?.start && trim?.start !== 'fit') {
            trim_start = parse_duration(trim.start, template)
            if (!trim.stop_at_output) clip_duration -= trim_start
          }

          if (trim?.end === 'fit') {
            const remaining_duration = calculate_layer_duration(
              layer_start_position,
              clips,
              clip_index + 1,
              true
            )
            const seconds_until_complete =
              layer_start_position + clip_duration + remaining_duration - total_duration
            // sometimes we will just skip the clip entirely if theres no room
            if (math.gte(seconds_until_complete, clip_duration)) continue
            if (math.gt(seconds_until_complete, 0)) clip_duration -= seconds_until_complete
          }

          if (trim?.start === 'fit' && trim?.end === 'fit') {
            // do nothing, because we already trimmed the end to fit
          } else if (trim?.start === 'fit') {
            const remaining_duration = calculate_layer_duration(
              layer_start_position,
              clips,
              clip_index + 1,
              true
            )
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

// generate font assets and replace font clips with media clips
async function replace_font_clips_with_image_clips(
  template: TemplateParsed,
  background_width: number,
  background_height: number,
  clip_info_map: ClipInfoMap,
  cwd: string
): Promise<MediaClipParsed[]> {
  const font_clips: FontClipParsed[] = template.clips.filter(is_font_clip)
  const font_assets_path = path.join('/tmp/ffmpeg-templates', cwd, `font_assets/`)
  if (font_clips.length) await Deno.mkdir(font_assets_path, { recursive: true })

  const font_generation_promises: Promise<MediaClipParsed>[] = font_clips.map(
    async (clip: FontClipParsed) => {
      const filename = `${clip.id}.png`
      const filepath = path.join(font_assets_path, filename)
      // we remove the file so we can be certain it was created
      if (await fs.exists(filepath)) await Deno.remove(filepath)

      const width = parse_unit(clip.layout?.width, {
        percentage: (p) => p * background_width,
        undefined: () => null,
      })
      const height = parse_unit(clip.layout?.height, {
        percentage: (p) => p * background_height,
        undefined: () => null,
      })

      let text_type = 'label'
      const size_args = []
      if (width && height) {
        text_type = 'caption'
        size_args.push('-size', `${width}x${height}`)
      } else if (width) {
        text_type = 'caption'
        size_args.push('-size', `${width}x`)
      } else if (height) {
        text_type = 'caption'
        size_args.push('-size', `x${height}`)
      }

      const magick_command = [
        'magick',
        '-background',
        'none',
        '-pointsize',
        clip.font.size.toString(),
        '-gravity',
        'Center',
      ]
      if (clip.font.line_spacing) magick_command.push('-interline-spacing', clip.font.line_spacing.toString())
      if (clip.font.family) magick_command.push('-font', clip.font.family)
      if (clip.font.background_color) magick_command.push('-undercolor', clip.font.background_color)
      if (clip.font.outline_size) {
        magick_command.push(...size_args)
        magick_command.push('-strokewidth', clip.font.outline_size.toString())
        magick_command.push('-stroke', clip.font.outline_color)
        magick_command.push(`${text_type}:${clip.text}`)
      }
      magick_command.push(...size_args)
      magick_command.push('-fill', clip.font.color)
      magick_command.push('-stroke', 'none')
      magick_command.push(`${text_type}:${clip.text}`)
      if (clip.font.outline_size) {
        magick_command.push('-compose', 'over', '-composite')
      }
      if (clip.font.background_color) {
        magick_command.push(
          '-bordercolor',
          'none',
          '-border',
          '12',
          '(',
          '+clone',
          '-morphology',
          'dilate',
          `disk:${clip.font.background_radius}`,
          ')',
          '+swap',
          '-composite'
        )
        // +swap -composite
      }
      // TODO is this unnecessary? It effs with the width and point sizes (since we scale to the specified size)
      // if we do need to re-enable this, we will need a font-specific width param
      // magick_command.push('-trim', '+repage')
      magick_command.push(filepath)
      // console.log(magick_command.join(' '))

      const proc = Deno.run({ cmd: magick_command })
      const result = await proc.status()
      if (!result.success) {
        throw new CommandError(`Command "${magick_command.join(' ')}" failed.\n\n`)
      } else if (!(await fs.exists(filepath))) {
        throw new CommandError(`Command "${magick_command.join(' ')}" failed. No image was produced.\n\n`)
      }
      const { text, font, ...base_clip_params } = clip
      return { ...base_clip_params, filepath, file: filename, audio_volume: 0, source_clip: clip }
    }
  )

  const font_media_clips = await Promise.all(font_generation_promises)
  const font_media_clip_info_map = await probe_clips(template, font_media_clips, false)
  for (const clip of Object.values(font_media_clip_info_map)) {
    clip_info_map[clip.id] = clip
  }
  const clips: MediaClipParsed[] = template.clips.map((clip) => {
    if (is_media_clip(clip)) return clip
    else {
      const res = font_media_clips.find((c) => clip.id === c.id)!
      if (res) return res
      else throw new Error('fatal error. Expected font clip but none found')
    }
  })

  return clips
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
  const ffmpeg_safe_cmd = ffmpeg_cmd.map((a) => a.toString())
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
  ffmpeg_verbosity?: 'quiet' | 'error' | 'warning' | 'info' | 'debug'
  debug_logs?: boolean,
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
  const cwd = options?.cwd ?? Deno.cwd()
  const template = parse_template(template_input, cwd)

  const sample_frame = options?.render_sample_frame ? parse_duration(template.preview, template) : undefined

  const clip_info_map = await probe_clips(template, template.clips)
  const { background_width, background_height } = compute_background_size(template, clip_info_map)
  const clips: MediaClipParsed[] = await replace_font_clips_with_image_clips(
    template,
    background_width,
    background_height,
    clip_info_map,
    cwd
  )
  const clip_geometry_map = compute_geometry(template, background_width, background_height, clip_info_map)
  const clip_zoompan_map = compute_zoompans(template, clip_info_map, clip_geometry_map)
  const { timeline, total_duration } = compute_timeline(template, clip_info_map)

  const complex_filter_inputs = [
    `color=s=${background_width}x${background_height}:color=black:duration=${total_duration}[base]`,
  ]
  const complex_filter_overlays: string[] = []
  const audio_input_ids: string[] = []
  const ffmpeg_cmd: (string | number)[] = ['ffmpeg', '-v', options?.ffmpeg_verbosity ?? 'info']

  // TODO double check that this isnt producing non-error logs on other machines
  ffmpeg_cmd.push('-hwaccel', 'auto')

  let last_clip = undefined
  let input_index = 0

  for (const i of timeline.keys()) {
    const { clip_id, start_at, trim_start, duration, speed } = timeline[i]

    // we dont care about clips that do not involve the sample frame
    if (options?.render_sample_frame && !(start_at <= sample_frame! && start_at + duration >= sample_frame!))
      continue

    const clip = clips.find((c) => c.id === clip_id)!
    const info = clip_info_map[clip_id]
    const geometry = clip_geometry_map[clip_id]
    const zoompans = clip_zoompan_map[clip_id]

    const video_input_filters = []
    if (clip.transition?.fade_in) {
      const transition_duration = parse_duration(clip.transition.fade_in, template)
      video_input_filters.push(`fade=t=in:st=0:d=${transition_duration}:alpha=1`)
    }
    if (clip.transition?.fade_out) {
      const transition_duration = parse_duration(clip.transition.fade_out, template)
      video_input_filters.push(
        `fade=t=out:st=${duration - transition_duration}:d=${transition_duration}:alpha=1`
      )
    }
    const pts_speed = clip.speed ? `${1 / parse_percentage(clip.speed)}*` : ''
    const setpts =
      start_at === 0 || options?.render_sample_frame
        ? `setpts=${pts_speed}PTS-STARTPTS`
        : `setpts=${pts_speed}PTS+${start_at}/TB`
    const vscale = `scale=${geometry.scale.width}:${geometry.scale.height}`

    const framerate = clip.framerate?.fps ?? info.framerate
    if (clip.framerate?.smooth) {
      // TODO only do this if the info.framerate * speed is lower than the framerate.fps
      video_input_filters.push(`minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=${framerate}'`)
      // this is the slowest, but most effective
      // video_input_filters.push(`minterpolate='mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=:fps=${clip.framerate.fps}'`)
      // video_input_filters.push(`minterpolate='mi_mode=blend:fps=${clip.framerate.fps}'`)
    }

    if (clip.speed && parse_percentage(clip.speed) < 1) {
      // TODO drop frames as necessary from the input
    }

    video_input_filters.push(setpts, vscale)
    if (geometry.rotate) {
      const { degrees, width, height } = geometry.rotate
      video_input_filters.push(`rotate=${degrees}*PI/180:fillcolor=black@0:out_w=${width}:out_h=${height}`)
    }
    if (geometry.crop) {
      const { crop } = geometry
      let crop_x = crop.x.toString()

      for (const i of zoompans.keys()) {
        const zoompan = zoompans[i]
        console.log(zoompan)
        if (zoompan.dest_x !== undefined && zoompan.x_expression !== undefined) {
          if (sample_frame !== undefined) {
            if (sample_frame >= zoompan.start_at_seconds && sample_frame < zoompan.end_at_seconds) {
              const n = sample_frame * info.framerate
              crop_x = eval(zoompan.x_expression)
            }
          } else {
            crop_x = `if(between(t, ${zoompan.start_at_seconds}, ${zoompan.end_at_seconds}), ${zoompan.x_expression}, ${crop_x})`
            if (i === zoompans.length - 1) {
              crop_x = `if(gte(t, ${zoompan.end_at_seconds}), ${zoompan.dest_x}, ${crop_x})`
            }
          }
        }
      }

      video_input_filters.push(
        `crop=w=${crop.width}:h=${crop.height}:x='${crop_x}':y=${crop.y}:keep_aspect=1`
      )

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
      ffmpeg_cmd.push('-framerate', framerate, '-loop', 1, '-t', duration, '-i', clip.filepath)
    } else if (info.type === 'video') {
      if (options?.render_sample_frame) {
        const trim_start_for_preview = trim_start + sample_frame! - start_at
        ffmpeg_cmd.push('-ss', trim_start_for_preview, '-t', duration, '-i', clip.filepath)
      } else {
        ffmpeg_cmd.push('-ss', trim_start, '-t', duration, '-i', clip.filepath)
      }
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

  if (sample_frame !== undefined) {
    const origin_size = (background_width * 0.003)
    const arrow_size = (background_width * 0.03) / 15
    const imagemagick_draw_arrows = []
    for (const clip of template.clips) {
      for (const zoompan of clip_zoompan_map[clip.id]) {
        const color = 'hsl(0,   255,   147.5)'
        if (zoompan.start_at_seconds <= sample_frame && zoompan.end_at_seconds > sample_frame) {
          const info = get_clip(clip_info_map, clip.id)
          const n = sample_frame * info.framerate
          const start_x = background_width / 2
          const start_y = background_height / 2
          const dest_x = background_width/2 + (zoompan.dest_x ?? 0) - (zoompan.x_expression ? eval(zoompan.x_expression) : 0)
          const dest_y = (zoompan.y_expression ? eval(zoompan.y_expression) : 0) + background_height/2
          const arrow_angle = Math.atan((dest_x - start_x) / (dest_y - start_y)) * 180.0/Math.PI - 90.0
          const arrow_x = dest_x
          const arrow_y = dest_y
          imagemagick_draw_arrows.push(
            `-draw`,
            `stroke ${color} fill ${color} circle ${start_x},${start_y} ${start_x+origin_size},${start_y+origin_size}`,
            `-draw`,
            `stroke ${color} stroke-linecap round line ${start_x},${start_y} ${dest_x},${dest_y}`,
            `-strokewidth`,
            '10',
            '-draw',
            `stroke ${color} fill ${color}
        translate ${arrow_x},${arrow_y} rotate ${arrow_angle}
        path "M 0,0  l ${-15*arrow_size},${-5*arrow_size}  ${+5*arrow_size},${+5*arrow_size}  ${-5*arrow_size},${+5*arrow_size}  ${+15*arrow_size},${-5*arrow_size} z"`,
          )
        }
      }
    }
    if (imagemagick_draw_arrows.length) {
      const zoompan_assets_path = path.join('/tmp/ffmpeg-templates', cwd)
      const zoompan_filepath = path.join(zoompan_assets_path, 'zoompan.png')
      await Deno.mkdir(zoompan_assets_path, { recursive: true })
      const imagemagick_cmd = [
        'convert',
        '-size',
        `${background_width}x${background_height}`,
        'xc:none',
        '-stroke',
        'black',
        '-strokewidth',
        '6',
        ...imagemagick_draw_arrows,
        zoompan_filepath
      ]
      const proc = Deno.run({ cmd: imagemagick_cmd })
      const result = await proc.status()
      ffmpeg_cmd.push('-framerate', 60, '-loop', 1, '-t', 1, '-i', zoompan_filepath)
      // complex_filter_inputs.push(`[${input_index}:v][v_in_${input_index}]`)
      const overlay_filter = `overlay=x=${0}:y=${0}:eof_action=pass`
      const current_clip = `[v_out_${input_index}]`
      complex_filter_overlays.push(`${last_clip}[${input_index}:v] ${overlay_filter} ${current_clip}`)
      last_clip = current_clip
      input_index++
    }
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
    ffmpeg_cmd.push('-vframes', '1')
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
    // ffmpeg_cmd.push('-vcodec', 'libx264')
    // ffmpeg_cmd.push('-vcodec', 'libx265')
    // ffmpeg_cmd.push('-x265-params', 'log-level=error')
  }
  ffmpeg_cmd.push('-filter_complex', complex_filter.join(';\n'))
  ffmpeg_cmd.push(...map_audio_arg)
  // ffmpeg_cmd.push('-segment_time', '00:00:05', '-f', 'segment', 'output%03d.mp4')
  ffmpeg_cmd.push(output_filepath)
  // overwriting output files is handled in ffmpeg-templates.ts
  // We can just assume by this point the user is sure they want to write to this file
  ffmpeg_cmd.push('-y')
  // console.log(ffmpeg_cmd.join('\n'))
  // replace w/ this when you want to copy the command
  // console.log(ffmpeg_cmd.map((c) => `'${c}'`).join(' '))
  if (options?.debug_logs) await write_cmd_to_file(ffmpeg_cmd, path.parse(output_filepath).dir, 'ffmpeg-debug.sh')

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

async function write_cmd_to_file(cmd: (string | number)[], output_dir: string, filepath: string) {
  console.log(`Saved ffmpeg command to ${filepath}`)
  const debug_filepath = path.join(output_dir, 'debug-ffmpeg.sh')
  const cmd_str = cmd
    .map(c => c.toString())
    .map(c => /[ \/]/.test(c) ? `'${c}'` : c)
    .join(' \\\n  ')

  await Deno.writeTextFile(debug_filepath, cmd_str, { mode: 0o777 })
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
}
