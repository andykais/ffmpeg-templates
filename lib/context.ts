import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { Logger } from './logger.ts'
import { ClipInfoMap } from './probe.zod.ts'
import { AbstractClipMap } from './util.ts'
import type { LogLevel } from './logger.ts'
import type * as inputs from './template_input.zod.ts'
import type { TemplateParsed, MediaClipParsed } from './parsers/template.zod.ts'

interface ContextOptions {
  output_folder: string
  cwd: string
  ffmpeg_log_cmd: boolean
  log_level: LogLevel
}

class ClipMap extends AbstractClipMap<MediaClipParsed> {}

class Context {
  public logger: Logger
  public clip_info_map: ClipInfoMap
  public clip_map: ClipMap
  public output_folder: string
  public output_files: {
    ffmpeg_cmd: string
    preview: string
    video: string
  }
  public cwd: string
  public ffmpeg_log_cmd: boolean
  public ffmpeg_verbosity = 'error'
  public background_size: { width: number; height: number; aspect_ratio: number; rotation: number } | undefined
  private execution_start_time: number

  constructor(public template_input: inputs.Template, public template: TemplateParsed, options: ContextOptions) {
    this.execution_start_time = performance.now()
    this.output_folder = options.output_folder
    this.logger = new Logger(options.log_level)
    this.cwd = options.cwd
    this.ffmpeg_log_cmd = options.ffmpeg_log_cmd
    this.clip_map = new ClipMap()
    for (const clip of template.clips) this.clip_map.set(clip.id, clip)
    this.clip_info_map = new ClipInfoMap(this)
    this.output_files = {
      ffmpeg_cmd: path.join(this.output_folder, 'ffmpeg.sh'),
      preview: path.join(this.output_folder, 'preview.jpg'),
      video: path.join(this.output_folder, 'output.mp4'),
    }
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

export { Context }
export type { ContextOptions }
