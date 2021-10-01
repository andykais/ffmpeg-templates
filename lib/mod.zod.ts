import * as template_input from './template_input.zod.ts'
import type { Logger } from './logger.ts'
import type { OnProgress, FfmpegProgress } from './bindings/ffmpeg.ts'


interface RenderOptions {
  ffmpeg_verbosity?: 'quiet' | 'error' | 'warning' | 'info' | 'debug'
  debug_logs?: boolean
  progress_callback?: OnProgress
  cwd?: string
}
interface RenderOptionsInternal extends RenderOptions {
  render_sample_frame?: boolean
}

async function render(
  logger: Logger,
  input: template_input.Template,
  output_folder: string,
  options?: RenderOptionsInternal
) {
  return {
    template: '',
    stats: {},
    outputted_files: {
      preview: ''
    }
  }
}

async function render_video(
  logger: Logger,
  input: template_input.Template,
  output_folder: string,
  options?: RenderOptions
) {
  return await render(logger, input, output_folder, options)
}

async function render_sample_frame(
  logger: Logger,
  input: template_input.Template,
  output_folder: string,
  options?: RenderOptions
) {
  return await render(logger, input, output_folder, { ...options, render_sample_frame: true })
}

export { render_video, render_sample_frame }
