import { Logger } from './logger.ts'
import { ClipInfoMap } from './probe.zod.ts'
import { AbstractClipMap } from './util.ts'
import type { LogLevel } from './logger.ts'
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
  public cwd: string
  public ffmpeg_log_cmd: boolean
  public ffmpeg_verbosity = 'error'
  private execution_start_time: number

  constructor(public template: TemplateParsed, options: ContextOptions) {
    this.execution_start_time = performance.now()
    this.output_folder = options.output_folder
    this.logger = new Logger(options.log_level)
    this.cwd = options.cwd
    this.ffmpeg_log_cmd = options.ffmpeg_log_cmd
    this.clip_map = new ClipMap()
    for (const clip of template.clips) this.clip_map.set(clip.id, clip)
    this.clip_info_map = new ClipInfoMap(this)
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
