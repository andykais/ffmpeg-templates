import { parse_template } from './parsers/template.zod.ts'
import { Context } from './context.ts'
import { compute_geometry, compute_background_size, compute_rotated_size } from './geometry.zod.ts'
import { create_text_image } from './canvas/font.zod.ts'
import type * as inputs from './template_input.zod.ts'
import type { ContextOptions } from './context.ts'
import type { OnProgress, FfmpegProgress } from './bindings/ffmpeg.ts'

class FfmpegBuilderBase {
  protected complex_filter_inputs: string[] = []
  protected complex_filter_overlays: string[] = []
  private last_link: string | undefined = undefined
  private audio_links: string[] = []

  public constructor(private context: Context) {}
  public background_cmd(background_width: number, background_height: number, total_duration: number) {
    this.insert_input(`color=s=${background_width}x${background_height}:color=black:duration=${total_duration}`, 'base')
  }

  protected insert_input(filter_input: string, link: string) {
    this.complex_filter_inputs.push(`${filter_input}[${link}]`)
    this.last_link = link
  }
}

class FfmpegVideoBuilder extends FfmpegBuilderBase {}

class FfmpegSampleBuilder extends FfmpegBuilderBase {}


// TODO we might use classes instead of functions.
// That way we can have things like transition_cmd() for sample vs video
async function render(context: Context, ffmpeg_builder: FfmpegBuilderBase) {
  await Deno.mkdir(context.output_folder, { recursive: true })
  const promises = context.template.clips.map(clip => context.clip_info_map.probe(clip))
  await Promise.all(promises)
  const size = compute_background_size(context)
  const text_promises = context.template.captions.map(caption => create_text_image(context, size, caption))
  const text_image_clips = await Promise.all(text_promises)
  const clips = context.template.clips.concat(text_image_clips)
  const { background_width, background_height } = size
  const geometry_info_map = compute_geometry(context, background_width, background_height, clips)

  const total_duration = 0

  ffmpeg_builder.background_cmd(background_width, background_width, total_duration)

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
  const ffmpeg_builder = new FfmpegVideoBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, outputted_files } = result
  context.logger.info(`created "${outputted_files.preview}" at ${template_parsed.preview} out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  return result
}

async function render_sample_frame(template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(template, template_parsed, options)
  const ffmpeg_builder = new FfmpegSampleBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, outputted_files } = result
  context.logger.info(`created "${outputted_files.video}" out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  return result
}

export { render_video, render_sample_frame }
