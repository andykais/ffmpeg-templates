import { Logger } from './logger.ts'
import type * as inputs from './template_input.ts'


class Context {
  public logger: Logger
  public output_folder: string
  public cwd: string
  public ffmpeg_log_cmd: boolean
  public ffmpeg_verbosity = 'error'

  constructor(public template: inputs.Template, output_folder: string, options: { cwd: string; ffmpeg_log_cmd: boolean }) {
    this.output_folder = output_folder
    this.logger = new Logger('info')
    this.cwd = options.cwd
    this.ffmpeg_log_cmd = options.ffmpeg_log_cmd
  }
}

export { Context }
