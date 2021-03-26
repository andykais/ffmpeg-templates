import * as io from 'https://deno.land/std@0.75.0/io/mod.ts'
import { ProbeError, CommandError } from './errors.ts'
import { parse_aspect_ratio, parse_ffmpeg_packet } from './parsers/ffmpeg_output.ts'
import { is_media_clip, AbstractClipMap } from './parsers/template.ts'
import { compute_rotated_size } from './geometry.ts'
import type * as template_parsed from './parsers/template.ts'
import type { Seconds } from './parsers/duration.ts'

interface ClipInfo {
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

class ClipInfoMap extends AbstractClipMap<ClipInfo> {}

type OnReadLine = (line: string) => void
async function exec(cmd: string[], readline_cb?: OnReadLine) {
  const decoder = new TextDecoder()
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

class ClipZoompansMap extends AbstractClipMap<ClipInfo> {}

// The cache key is the filename only
// That means if the file is overwritten, the cache will not pick up that change
// So for now, if you edit a file, you restart the watcher
// This is fair enough since its how most video editors function (and how often are people manipulating source files?)
const clip_info_map_cache = new ClipInfoMap()
async function probe_clips(
  template: template_parsed.Template,
  clips: template_parsed.Template['clips'],
  use_cache = true
): Promise<ClipInfoMap> {
  // only probe media clips
  const media_clips = clips.filter(is_media_clip)

  const unique_files = new Set<string>()
  // we only need to probe files once
  const unique_media_clips = media_clips.filter((c) => unique_files.size < unique_files.add(c.filepath).size)

  const probe_clips_promises = unique_media_clips.map(async (clip: template_parsed.MediaClip) => {
    const { id, filepath } = clip
    if (use_cache && clip_info_map_cache.has(filepath)) return clip_info_map_cache.get_or_else(filepath)
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
    clip_info_map_cache.set(probed_clip.filepath, probed_clip)
  }
  return media_clips.reduce((acc: ClipInfoMap, clip, i) => {
    const clip_info = clip_info_map_cache.get_or_else(clip.filepath)
    acc.set(clip.id, clip_info)
    return acc
  }, new ClipInfoMap())
}

export { probe_clips }
export type { ClipInfoMap }
