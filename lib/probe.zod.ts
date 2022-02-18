import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as io from 'https://deno.land/std@0.91.0/io/mod.ts'
import { ProbeError, CommandError } from './errors.ts'
import { AbstractClipMap } from './util.ts'
import { parse_aspect_ratio, parse_ffmpeg_packet } from './parsers/ffmpeg_output.ts'
import { compute_rotated_size } from './geometry.ts'
import type { Context } from './context.ts'
import type * as template from './template_input.zod.ts'
import type { MediaClipParsed } from './parsers/template.zod.ts'
import type { Seconds } from './parsers/duration.ts'

const CLIP_INFO_FILENAME = 'probe_info.json'


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
  timestamp: string
}


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


class ClipInfoMap extends AbstractClipMap<ClipInfo> {
  // The cache key is the filename only
  // That means if the file is overwritten, the cache will not pick up that change
  // So for now, if you edit a file, you restart the watcher
  // This is fair enough since its how most video editors function (and how often are people manipulating source files?)
  // cache keys are filenames, public keys are ids
  private clip_info_cache_map: { [file: string]: ClipInfo } = {}
  private in_flight_info_map: { [file: string]: Promise<ClipInfo> } = {}
  private initialized = false
  private probe_info_filepath

  public constructor(private context: Context) {
    super()
    this.probe_info_filepath = path.resolve(context.output_folder, CLIP_INFO_FILENAME)
  }

  async init() {
    try {
      // we initialize early so we dont accidentally double initialize (especially on startup)
      this.initialized = true
      const json_str = await Deno.readTextFile(this.probe_info_filepath)
      type ClipInfoObject = { [file: string]: ClipInfo }
      const clip_info_object: ClipInfoObject = JSON.parse(json_str)
      for (const file of Object.keys(clip_info_object)) {
        this.clip_info_cache_map[file] = clip_info_object[file]
        // this.set(file, clip_info_object[file])
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound === false) throw e
    }
  }

  public async probe(clip: MediaClipParsed) {
    if (!this.initialized) await this.init()
    const { id, file } = clip
    const stats = await Deno.stat(file)
    // some platforms dont set mtime. We can cross that bridge when we get to it
    if (stats.mtime === null) throw new Error('unexpected null mtime. Cannot infer when files have updated.')
    if (this.clip_info_cache_map[file]) {
      const cached_timestamp = this.clip_info_cache_map[file].timestamp
      if (cached_timestamp === stats.mtime.toString()) {
        this.set(id, this.clip_info_cache_map[file])
        return this.get_or_throw(id)
      }
    }
    if (Object.hasOwn(this.in_flight_info_map, file)) return this.in_flight_info_map[file]
    this.in_flight_info_map[file] = probe(this.context, clip, stats)
    const clip_info = await this.in_flight_info_map[file]
    this.set(id, clip_info)
    this.clip_info_cache_map[file] = clip_info
    delete this.in_flight_info_map[file]
    await Deno.writeTextFile(this.probe_info_filepath, JSON.stringify(this.clip_info_cache_map))
    return clip_info
  }
}

async function probe(context: Context, clip: MediaClipParsed, stats: Deno.FileInfo): Promise<ClipInfo> {
  context.logger.info(`Probing asset ${path.relative(Deno.cwd(), clip.file)}`)
  const { id, file } = clip
  const timestamp = stats.mtime!.toString()

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
    file,
  ])
  const info = JSON.parse(result)
  const video_stream = info.streams.find((s: any) => s.codec_type === 'video')
  const audio_stream = info.streams.find((s: any) => s.codec_type === 'audio')

  if (!video_stream) throw new ProbeError(`Input "${file}" has no video stream`)
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
      filepath: file,
      id,
      width,
      height,
      aspect_ratio,
      has_audio,
      duration,
      framerate,
      timestamp,
    }
  } else {
    const framerate = eval(video_stream.avg_frame_rate)
    // ffprobe's duration is unreliable. The best solutions I have are:
    // 1. ffmpeg guessing: https://stackoverflow.com/a/33115316/3795137
    // 2. ffprobe packets: https://stackoverflow.com/a/33346572/3795137 but this is a ton of output, so were using ffmpeg
    // I picked #2 because #1 is very slow to complete, it has to iterate the whole video, often at regular playback speed
    let packet_str_buffer: string[] = []
    const out = await exec(['ffprobe', '-v', 'error', '-show_packets', '-i', file], (line) => {
      if (line === '[PACKET]') packet_str_buffer = []
      packet_str_buffer.push(line)
    })
    const packet = parse_ffmpeg_packet(packet_str_buffer)
    const duration = parseFloat(packet.dts_time)
    return {
      type: 'video' as const,
      filepath: file,
      id,
      width,
      height,
      aspect_ratio,
      has_audio,
      framerate,
      duration,
      timestamp,
    }
  }
}

export { ClipInfoMap }
