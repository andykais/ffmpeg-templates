import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as errors from './errors.ts'
import { Logger } from './logger.ts'
import { ClipInfoMap } from './probe.zod.ts'
import { AbstractClipMap } from './util.ts'
import type { LogLevel } from './logger.ts'
import type * as inputs from './template_input.zod.ts'
import type { TemplateParsed, MediaClipParsed } from './parsers/template.zod.ts'
import type { Keypoints } from './timeline.zod.ts'

interface ContextOptions {
  output_folder: string
  cwd: string
  ffmpeg_log_cmd: boolean
  log_level: LogLevel
}

class ClipMap extends AbstractClipMap<MediaClipParsed> {}

class InstanceContext {
  public logger: Logger
  public clip_info_map: ClipInfoMap
  public output_folder: string
  public output_files: {
    ffmpeg_cmd: string
    preview: string
    video: string
  }
  public cwd: string
  public ffmpeg_log_cmd: boolean
  public ffmpeg_verbosity = 'error'


  public constructor(options: ContextOptions) {
    this.logger = new Logger(options.log_level)
    this.cwd = options.cwd
    this.ffmpeg_log_cmd = options.ffmpeg_log_cmd
    this.output_folder = options.output_folder
    this.output_files = {
      ffmpeg_cmd: path.join(options.output_folder, 'ffmpeg.sh'),
      preview: path.join(options.output_folder, 'preview.jpg'),
      video: path.join(options.output_folder, 'output.mp4'),
    }
    this.clip_info_map = new ClipInfoMap(this)
  }
}

class Context {
  public clip_map: ClipMap
  public background_size: { width: number; height: number; aspect_ratio: number; rotation: number } | undefined
  public execution_start_time: number
  private keypoints: Keypoints

  constructor(private instance: InstanceContext, public template_input: inputs.Template, public template: TemplateParsed, options: ContextOptions) {
    this.execution_start_time = performance.now()
    this.clip_map = new ClipMap()
    this.keypoints = {}
    for (const clip of template.clips) this.clip_map.set(clip.id, clip)
  }

  get logger() { return this.instance.logger }
  get clip_info_map() { return this.instance.clip_info_map }
  get output_folder() { return this.instance.output_folder }
  get output_files() { return this.instance.output_files }
  get cwd() { return this.instance.cwd }
  get ffmpeg_log_cmd() { return this.instance.ffmpeg_log_cmd }
  get ffmpeg_verbosity() { return this.instance.ffmpeg_verbosity }

  get_keypoint(name: string) {
    const timestamp = this.keypoints[name]
    if (timestamp === undefined) throw new errors.InputError(`Keypoint ${name} does not exist. Clip keypoints must be defined before they are referenced.`)
    return timestamp
  }
  set_keypoint(name: string, timestamp: number) {
    this.keypoints[name] = timestamp
  }

  public get_clip_dimensions(clip_id: string) {
    if (clip_id === 'BACKGROUND') return this.get_background_size()
    else {
      const info = this.clip_info_map.get_or_throw(clip_id)
      const clip = this.get_clip(clip_id)
      return {...info, rotation: clip.rotate}
    }
  }

  public set_background_size(size: { width: number; height: number }) {
    this.background_size = {
      ...size,
      aspect_ratio: size.width / size.height,
      rotation: 0,
    }
  }
  public get_background_size() {
    if (this.background_size) return this.background_size
    else throw new Error('invalid use of background size. background_size is unset.')
  }

  public execution_time() {
    const execution_time_seconds = (performance.now() - this.execution_start_time) / 1000
    return execution_time_seconds
  }

  public get_clip(clip_id: string) {
    return this.clip_map.get_or_throw(clip_id)
  }
}

export { InstanceContext, Context }
export type { ContextOptions }
