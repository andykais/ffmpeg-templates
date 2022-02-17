import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { parse_template } from './parsers/template.zod.ts'
import { Context } from './context.ts'
import { compute_geometry, compute_background_size, compute_rotated_size } from './geometry.zod.ts'
import { create_text_image } from './canvas/font.zod.ts'
import type * as inputs from './template_input.zod.ts'
import type { ContextOptions } from './context.ts'
import { ffmpeg } from './bindings/ffmpeg.zod.ts'
import type { OnProgress, FfmpegProgress } from './bindings/ffmpeg.ts'

async function write_cmd_to_file(context: Context, ffmpeg_cmd: string[], filepath: string) {
  const cmd_str = ffmpeg_cmd
    .map((c) => c.toString())
    .map((c) => (/[ \/]/.test(c) ? `"${c}"` : c))
    .join(' \\\n  ')
  await Deno.writeTextFile(filepath, cmd_str, { mode: 0o777 })
  context.logger.info(`Saved ffmpeg command to ${filepath}`)
}

abstract class FfmpegBuilderBase {
  protected complex_filter_inputs: string[] = []
  protected complex_filter_overlays: string[] = []
  private ffmpeg_inputs: string[] = []
  private last_link: string | undefined = undefined
  private audio_links: string[] = []
  private verbosity_flag = 'error'
  private input_index = 0

  public abstract get_output_file(): string
  protected abstract get_vframe_flags(): string[]

  public constructor(protected context: Context) {
    this.verbosity_flag = this.context.ffmpeg_log_cmd ? 'info' : 'error'
  }

  public background_cmd(background_width: number, background_height: number, total_duration: number) {
    const link = '[base]'
    const filter_input = `color=s=${background_width}x${background_height}:color=black:duration=${total_duration}`
    this.complex_filter_inputs.push(`${filter_input}${link}`)
    this.last_link = link
  }

  public clip(clip: inputs.MediaClip, video_input_filters: string[]) {
    const overlay_filter = `overlay=x=${0}:y=${0}:eof_action=pass`
    this.ffmpeg_inputs.push(clip.file)
    const current_link = `[v_out_${clip.id}]`
    this.complex_filter_inputs.push(`[${this.input_index}:v] ${video_input_filters.join(', ')} [v_in_${clip.id}]`)
    this.complex_filter_overlays.push(`${this.last_link}[v_in_${clip.id}] ${overlay_filter} ${current_link}`)
    this.last_link = current_link
    this.input_index++
  }

  // protected insert_input(filter_input: string, link: string) {
  //   this.complex_filter_inputs.push(`${filter_input}[${link}]`)
  //   this.last_link = link
  // }

  build() {
    if (this.last_link === undefined) throw new Error('at least one filter must be specified')
    const complex_filter = [...this.complex_filter_inputs, ...this.complex_filter_overlays]
    return [
      'ffmpeg',
      '-v', this.verbosity_flag,
      // '-ss', '0','-t','0',
      // '-i', this.ffmpeg_inputs[0],
      ...this.ffmpeg_inputs.map(file => ['-i', file]).flat(),
      ...this.get_vframe_flags(),
      '-filter_complex', complex_filter.join(';\n'),
      '-map', this.last_link,
      // '-filter_complex', '[0]',
      // '-map', '[v_out]',
      this.get_output_file(),
      '-y'
    ]
  }
}

class FfmpegVideoBuilder extends FfmpegBuilderBase {
  protected get_vframe_flags() { return [] }
  public get_output_file() {
    return path.join(this.context.output_folder, 'output.mp4')
  }
}

class FfmpegSampleBuilder extends FfmpegBuilderBase {
  protected get_vframe_flags() { return ['-vframes', '1'] }
  public get_output_file() {
    return path.join(this.context.output_folder, 'preview.jpg')
  }
}


// TODO we might use classes instead of functions.
// That way we can have things like transition_cmd() for sample vs video
async function render(context: Context, ffmpeg_builder: FfmpegBuilderBase) {
  const output = {
    ...context.output_files,
    current: ffmpeg_builder.get_output_file(),
  }

  await Deno.mkdir(context.output_folder, { recursive: true })
  const promises = context.template.clips.map(clip => context.clip_info_map.probe(clip))
  await Promise.all(promises)
  const size = compute_background_size(context)
  const text_promises = context.template.captions.map(caption => create_text_image(context, size, caption))
  const text_image_clips = await Promise.all(text_promises)
  const clips = context.template.clips.concat(text_image_clips)
  const { background_width, background_height } = size
  const geometry_info_map = compute_geometry(context, background_width, background_height, clips)
  // const {total_duration, timeline} = compute_timeline(context, clips)
  const total_duration = 1

  // TODO can we reuse a clip_builder here?
  ffmpeg_builder.background_cmd(background_width, background_width, total_duration)

  for (const clip of clips) {
    ffmpeg_builder.clip(
      clip,
      ['crop=w=100'],
    )
  }


  const ffmpeg_cmd = ffmpeg_builder.build()
  console.log(ffmpeg_cmd)
  // if (context.ffmpeg_log_cmd) write_cmd_to_file(context, ffmpeg_cmd, output.ffmpeg_cmd)
  if (true) write_cmd_to_file(context, ffmpeg_cmd, output.ffmpeg_cmd)

  await ffmpeg(context, ffmpeg_cmd, total_duration)

  return {
    template: context.template,
    stats: {
      clips_count: 0,
      execution_time: context.execution_time(),
    },
    output,
  }
}

async function render_video(template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(template, template_parsed, options)
  const ffmpeg_builder = new FfmpegVideoBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, output } = result
  context.logger.info(`created "${output.video}" at ${template_parsed.preview} out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)

  return result
}

async function render_sample_frame(template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(template, template_parsed, options)
  const ffmpeg_builder = new FfmpegSampleBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, output } = result
  context.logger.info(`created "${output.preview}" out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  // // DEBUG_START
  // await Deno.run({cmd: ['./imgcat.sh', 'ffmpeg-templates-projects/template.zod/text_assets/TEXT_0.png'], })
  await Deno.run({cmd: ['./imgcat.sh', 'ffmpeg-templates-projects/template.zod/preview.jpg'], })
  // // DEBUG_END

  return result
}

export { render_video, render_sample_frame }
