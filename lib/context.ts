import { Logger } from './logger.ts'
import type { LogLevel } from './logger.ts'
import type { TemplateParsed } from './parsers/template.zod.ts'


interface ContextOptions {
  output_folder: string
  cwd: string
  ffmpeg_log_cmd: boolean
  log_level: LogLevel
}

class Context {
  public logger: Logger
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
  }

  public execution_time() {
    const execution_time_seconds = (performance.now() - this.execution_start_time) / 1000
    return execution_time_seconds
  }
}

export { Context }
export type { ContextOptions }
