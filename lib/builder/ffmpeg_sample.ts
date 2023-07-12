import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { parse_duration } from '../parsers/duration.zod.ts'
import { Context } from '../context.ts'
import { relative_path } from '../util.ts'
import type * as inputs from '../template_input.zod.ts'
import type * as parsed from '../parsers/template.zod.ts'
import type { ClipInfo } from '../probe.zod.ts'

import { FfmpegBuilderBase } from './ffmpeg_base.ts'
import { ClipBuilderBase } from './clip_base.ts'
import { type ClipBuilderData } from './ffmpeg_base.ts'
import { ClipSampleBuilder } from './clip_sample.ts'

export class FfmpegSampleBuilder extends FfmpegBuilderBase {
  protected get_vframe_flags() { return ['-vframes', '1'] }
  protected sample_frame: number

  public constructor(context: Context) {
    super(context)
    this.sample_frame = parse_duration(context, context.template.preview)
  }
  public clip_builder(clip: parsed.MediaClipParsed, info: ClipInfo) { return new ClipSampleBuilder(clip, info, this.sample_frame) }

  protected input_audio(data: ClipBuilderData, complex_filter_inputs: string[], audio_links: string[], input_index: number) {}
  protected map_audio(complex_filter: string[]) { return [] }

  public background_cmd(background_width: number, background_height: number, total_duration?: number, background_color?: string) {
    return super.background_cmd(background_width, background_height, undefined, background_color)
  }

  public clip(clip_builder: ClipBuilderBase) {
    const data = clip_builder.build()
    // ignore clips that start after or finish before the preview frame
    // console.log(data.id)
    // console.log('  data.start_at > this.sample_frame', data.start_at > this.sample_frame )
    // console.log('  data.start_at + data.duration < this.sample_frame', data.timeline_data.start_at, data.timeline_data.start_at + data.duration, '<', this.sample_frame, (data.timeline_data.start_at + data.duration) < this.sample_frame)
    const not_present_in_sample_frame = data.timeline_data.start_at > this.sample_frame || (data.timeline_data.start_at + data.duration) < this.sample_frame
    // console.log('not_present_in_sample_frame', not_present_in_sample_frame)
    if (data.duration === 0) {
      return super.clip(clip_builder)
    } else if (not_present_in_sample_frame) {
      return
    } else {
      return super.clip(clip_builder)
    }
  }

  public get_output_file() {
    return path.join(this.context.output_folder, 'preview.jpg')
  }
}
