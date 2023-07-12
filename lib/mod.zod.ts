import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as errors from './errors.ts'
import { parse_unit } from './parsers/unit.ts'
import { parse_template } from './parsers/template.zod.ts'
import { parse_percentage } from './parsers/unit.ts'
import { parse_duration, fmt_human_readable_duration } from './parsers/duration.zod.ts'
import { InstanceContext, Context } from './context.ts'
import { compute_geometry, compute_size, compute_rotated_size } from './geometry.zod.ts'
import { compute_zoompans } from './zoompan.zod.ts'
import { compute_timeline } from './timeline.zod.ts'
import { create_text_image } from './canvas/font.zod.ts'
import { relative_path } from './util.ts'
import type * as inputs from './template_input.zod.ts'
import type * as parsed from './parsers/template.zod.ts'
import type { TimelineClip } from './timeline.zod.ts'
import type { ComputedGeometry } from './geometry.zod.ts'
import type { ClipInfo } from './probe.zod.ts'
import type { ContextOptions } from './context.ts'
import { ffmpeg } from './bindings/ffmpeg.zod.ts'

import { FfmpegBuilderBase, type ClipBuilderData } from './builder/ffmpeg_base.ts'
import { ClipBuilderBase } from './builder/clip_base.ts'
import { FfmpegVideoBuilder } from './builder/ffmpeg_video.ts'
import { FfmpegSampleBuilder } from './builder/ffmpeg_sample.ts'
import { ClipVideoBuilder } from './builder/clip_video.ts'
import { ClipSampleBuilder } from './builder/clip_sample.ts'



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
  const {total_duration, timeline} = compute_timeline(context)

  // TODO can we reuse a clip_builder here?
  ffmpeg_builder.background_cmd(background_size.width, background_size.height, total_duration, context.template.size.background_color)

  for (const timeline_clip of timeline) {
    const clip = context.get_clip(timeline_clip.clip_id)
    const info = context.clip_info_map.get_or_throw(timeline_clip.clip_id)
    const geometry = geometry_info_map.get_or_throw(clip.id)

    const clip_builder = ffmpeg_builder.clip_builder(clip, info)
    clip_builder
      .geometry(geometry)
      .coordinates(geometry.x, geometry.y)
      .timing(timeline_clip)


    if (clip.chromakey) {
      clip_builder.chromakey(clip.chromakey)
    }

    ffmpeg_builder.clip(clip_builder)
  }


  const ffmpeg_cmd = ffmpeg_builder.build()
  if (context.ffmpeg_log_cmd) ffmpeg_builder.write_ffmpeg_cmd(output.ffmpeg_cmd)

  const pretty_duration = fmt_human_readable_duration(total_duration)
  if (ffmpeg_builder instanceof FfmpegSampleBuilder) {
    const skipped_clips = timeline.length - ffmpeg_builder.clip_count()
    if (skipped_clips) context.logger.info(`Rendering ${pretty_duration} long preview image out of ${ffmpeg_builder.clip_count()} clip(s). Skipping ${timeline.length - ffmpeg_builder.clip_count()} clip(s) not visible in preview timestamp`)
    else context.logger.info(`Rendering ${pretty_duration} long preview image out of ${ffmpeg_builder.clip_count()} clip(s).`)
  } else {
    context.logger.info(`Rendering ${pretty_duration} long video out of ${ffmpeg_builder.clip_count()} clip(s).`)
  }
  await ffmpeg(context, ffmpeg_cmd, total_duration)

  return {
    template: context.template,
    render_data: ffmpeg_builder.serialize(),
    stats: {
      input_clips_count: clips.length,
      timeline_clips_count: timeline.length,
      execution_time: context.execution_time(),
    },
    output,
  }
}

async function render_video(template: inputs.Template | unknown, options: ContextOptions, instance?: InstanceContext) {
  instance ??= new InstanceContext(options)
  const template_parsed = parse_template(template)
  template_parsed.clips.map(c => {
    c.source = path.resolve(options.cwd, c.source)
  })
  const context = new Context(instance, template as inputs.Template, template_parsed, options)
  const ffmpeg_builder = new FfmpegVideoBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, output } = result
  context.logger.info(`created "${relative_path(output.video)}" in ${stats.execution_time.toFixed(1)} seconds.`)

  return result
}

/**
  * @deprecated
  */
async function render_sample_frame(template: inputs.Template | unknown, options: ContextOptions, instance?: InstanceContext) {
  instance ??= new InstanceContext(options)
  const template_parsed = parse_template(template)
  template_parsed.clips.map(c => {
    c.source = path.resolve(options.cwd, c.source)
  })
  const context = new Context(instance, template as inputs.Template, template_parsed, options)
  const ffmpeg_builder = new FfmpegSampleBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, output } = result
  context.logger.info(`created "${relative_path(output.preview)}" at timestamp ${template_parsed.preview} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  // // DEBUG_START
  // await Deno.run({cmd: ['./imgcat.sh', 'ffmpeg-templates-projects/template.zod/text_assets/TEXT_0.png'], })
  // await Deno.run({cmd: ['./imgcat.sh', 'ffmpeg-templates-projects/template.zod/preview.jpg'], })
  // // DEBUG_END

  return result
}

async function render_image(template: inputs.Template, options: ContextOptions, instance?: InstanceContext) {
  return await render_sample_frame(template, options, instance)
}

export { render_video, render_sample_frame, render_image }
export type Template = inputs.Template
