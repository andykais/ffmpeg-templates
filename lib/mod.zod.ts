import { parse_template } from './parsers/template.zod.ts'
import { Context } from './context.ts'
import { compute_geometry, compute_background_size, compute_rotated_size } from './geometry.ts'
import type * as inputs from './template_input.zod.ts'
import type { ContextOptions } from './context.ts'
import type { Logger } from './logger.ts'
import type { OnProgress, FfmpegProgress } from './bindings/ffmpeg.ts'


async function render(context: Context, render_sample_frame: boolean) {
  await Deno.mkdir(context.output_folder, { recursive: true })
  const promises = context.template.clips.map(clip => context.clip_info_map.probe(clip))
  const results = await Promise.all(promises)
  // const { background_width, background_height } = compute_background_size(context.template, context.clip_info_map)

  return {
    template: '',
    stats: {
      clips_count: 0,
      execution_time: context.execution_time(),
    },
    outputted_files: {
      preview: '',
      video: '',
    }
  }
}

async function render_video(template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(template_parsed, options)
  const result = await render(context, true)
  const { stats, outputted_files } = result
  context.logger.info(`created "${outputted_files.preview}" at ${template_parsed.preview} out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  return result
}

async function render_sample_frame(template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(template_parsed, options)
  const result = await render(context, false)
  const { stats, outputted_files } = result
  context.logger.info(`created "${outputted_files.video}" out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  return result
}

export { render_video, render_sample_frame }
