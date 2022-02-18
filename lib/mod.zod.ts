import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { parse_template } from './parsers/template.zod.ts'
import { parse_percentage } from './parsers/unit.ts'
import { Context } from './context.ts'
import { compute_geometry, compute_size, compute_rotated_size } from './geometry.zod.ts'
import { create_text_image } from './canvas/font.zod.ts'
import { relative_path } from './util.ts'
import type * as inputs from './template_input.zod.ts'
import type { ComputedGeometry } from './geometry.zod.ts'
import type { ContextOptions } from './context.ts'
import { ffmpeg } from './bindings/ffmpeg.zod.ts'
import type { OnProgress, FfmpegProgress } from './bindings/ffmpeg.ts'

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
  public abstract clip_builder(clip: inputs.MediaClip): ClipBuilderBase

  public constructor(protected context: Context) {
    this.verbosity_flag = this.context.ffmpeg_log_cmd ? 'info' : 'error'
  }

  public background_cmd(background_width: number, background_height: number, total_duration: number) {
    const link = '[base]'
    const filter_input = `color=s=${background_width}x${background_height}:color=black:duration=${total_duration}`
    this.complex_filter_inputs.push(`${filter_input}${link}`)
    this.last_link = link
  }

  public clip(clip_builder: ClipBuilderBase) {
    const data = clip_builder.build()
    this.ffmpeg_inputs.push(data.file)
    const current_link = `[v_out_${data.id}]`
    this.complex_filter_inputs.push(`[${this.input_index}:v] ${data.video_input_filters.join(', ')} [v_in_${data.id}]`)
    this.complex_filter_overlays.push(`${this.last_link}[v_in_${data.id}] ${data.overlay_filter} ${current_link}`)
    this.last_link = current_link
    this.input_index++
  }
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

  async write_ffmpeg_cmd(filepath: string) {
    const ffmpeg_cmd = this.build()
    const cmd_str = ffmpeg_cmd
      .map((c) => c.toString())
      .map((c) => (/[ \/]/.test(c) ? `"${c}"` : c))
      .join(' \\\n  ')
    await Deno.writeTextFile(filepath, cmd_str, { mode: 0o777 })
    this.context.logger.info(`Saved ffmpeg command to ${relative_path(filepath)}`)
  }
}

class FfmpegVideoBuilder extends FfmpegBuilderBase {
  protected get_vframe_flags() { return [] }
  public clip_builder(clip: inputs.MediaClip) { return new ClipVideoBuilder(clip) }

  public get_output_file() {
    return path.join(this.context.output_folder, 'output.mp4')
  }
}

class FfmpegSampleBuilder extends FfmpegBuilderBase {
  protected get_vframe_flags() { return ['-vframes', '1'] }
  public clip_builder(clip: inputs.MediaClip) { return new ClipSampleBuilder(clip) }

  public get_output_file() {
    return path.join(this.context.output_folder, 'preview.jpg')
  }
}

abstract class ClipBuilderBase {
  protected pts_speed = ''
  protected start_at = 0
  private x = 0
  private y = 0
  private video_input_filters: string[] = []

  protected abstract setpts_filter(): string

  public constructor(private clip: inputs.MediaClip) {}

  public speed(percentage: string) {
    this.pts_speed = `${1 / parse_percentage(percentage)}*`
    return this
  }
  public start_time(start_at_seconds: number) {
    this.start_at = start_at_seconds
    return this
  }
  public coordinates(x: number, y: number) {
    this.x = x
    this.y = y
    return this
  }
  public scale(scale: { width: number; height: number }) {
    this.video_input_filters.push(`scale=${scale.width}:${scale.height}`)
    return this
  }

  public rotate(rotate: ComputedGeometry['rotate']) {
    if (rotate === undefined) return this
    const { degrees, width, height } = rotate
    this.video_input_filters.push(`rotate=${degrees}*PI/180:fillcolor=black@0:out_w=${width}:out_h=${height}`)
    return this
  }

  public crop(crop: ComputedGeometry['crop']) {
    if (crop === undefined) return this
    console.log('crop', crop)
    // TODO support zoompan
    const crop_x = crop.x
    const crop_y = crop.y
    this.video_input_filters.push(
      `crop=w=${crop.width}:h=${crop.height}:x='${crop_x}':y='${crop_y}':keep_aspect=1`
    )
    return this
  }

  public build()  {
    const video_input_filters = [
      this.setpts_filter(),
      ...this.video_input_filters,
    ]
    return {
      id: this.clip.id,
      file: this.clip.file,
      video_input_filters,
      overlay_filter: `overlay=x=${this.x}:y=${this.y}:eof_action=pass`,
    }
  }
}

class ClipVideoBuilder extends ClipBuilderBase {
  protected setpts_filter() {
    if (this.start_at === 0) return `setpts=${this.pts_speed}PTS-STARTPTS`
    else return `setpts=${this.pts_speed}PTS-STARTPTS+${this.start_at}/TB`
  }
}

class ClipSampleBuilder extends ClipBuilderBase {
  protected setpts_filter() {
    return `setpts=${this.pts_speed}PTS-STARTPTS`
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
  await Promise.all(context.template.clips.map(clip => context.clip_info_map.probe(clip)))
  const background_size = compute_size(context, context.template.size)
  context.set_background_size(background_size)
  const text_image_clips = await Promise.all(context.template.captions.map(caption => create_text_image(context, caption)))
  for (const text_clip of text_image_clips) context.clip_map.set(text_clip.id, text_clip)
  await Promise.all(text_image_clips.map(clip => context.clip_info_map.probe(clip)))

  const clips = context.template.clips.concat(text_image_clips)
  const geometry_info_map = compute_geometry(context, clips)
  // const {total_duration, timeline} = compute_timeline(context, clips)
  const total_duration = 1

  // TODO can we reuse a clip_builder here?
  ffmpeg_builder.background_cmd(background_size.width, background_size.height, total_duration)

  for (const clip of clips) {
    const geometry = geometry_info_map.get_or_throw(clip.id)
    const clip_builder = ffmpeg_builder.clip_builder(clip)
    clip_builder
      .coordinates(geometry.x, geometry.y)
      .scale(geometry.scale)
      .speed(clip.speed)
      .start_time(0)
      .rotate(geometry.rotate)
      .crop(geometry.crop)

    ffmpeg_builder.clip(clip_builder)
  }


  const ffmpeg_cmd = ffmpeg_builder.build()
  console.log(ffmpeg_cmd)
  if (context.ffmpeg_log_cmd) ffmpeg_builder.write_ffmpeg_cmd(output.ffmpeg_cmd)

  context.logger.info(`Rendering ${total_duration}s long output`)
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
  context.logger.info(`created "${relative_path(output.video)}" out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)

  return result
}

async function render_sample_frame(template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(template, template_parsed, options)
  const ffmpeg_builder = new FfmpegSampleBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, output } = result
  context.logger.info(`created "${relative_path(output.preview)}" at ${template_parsed.preview} out of ${stats.clips_count} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  // // DEBUG_START
  // await Deno.run({cmd: ['./imgcat.sh', 'ffmpeg-templates-projects/template.zod/text_assets/TEXT_0.png'], })
  // await Deno.run({cmd: ['./imgcat.sh', 'ffmpeg-templates-projects/template.zod/preview.jpg'], })
  // // DEBUG_END

  return result
}

export { render_video, render_sample_frame }
