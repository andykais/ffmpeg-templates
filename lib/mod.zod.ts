import { parse_template } from './parsers/template.zod.ts'
import { Context } from './context.ts'
import { compute_geometry, compute_background_size, compute_rotated_size } from './geometry.zod.ts'
import { create_text_image } from './canvas/font.zod.ts'
import type * as inputs from './template_input.zod.ts'
import type { ContextOptions } from './context.ts'
import type { OnProgress, FfmpegProgress } from './bindings/ffmpeg.ts'


// TODO we might use classes instead of functions.
// That way we can have things like transition_cmd() for sample vs video
async function render(context: Context, render_sample_frame: boolean) {
  await Deno.mkdir(context.output_folder, { recursive: true })
  const promises = context.template.clips.map(clip => context.clip_info_map.probe(clip))
  await Promise.all(promises)
  const size = compute_background_size(context)
  const text_promises = context.template.captions.map(caption => create_text_image(context, size, caption))
  const text_image_clips = await Promise.all(text_promises)
  const { background_width, background_height } = size

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
  const context = new Context(template, template_parsed, options)
  const result = await render(context, true)
  const { stats, outputted_files } = result
  context.logger.info(`created "${outputted_files.preview}" at ${template_parsed.preview} out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  return result
}

async function render_sample_frame(template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(template, template_parsed, options)
  const result = await render(context, false)
  const { stats, outputted_files } = result
  context.logger.info(`created "${outputted_files.video}" out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  return result
}

export { render_video, render_sample_frame }
