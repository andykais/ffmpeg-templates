import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { relative_path } from '../util.ts'
import type * as parsed from '../parsers/template.zod.ts'
import type { ClipInfo } from '../probe.zod.ts'

import { FfmpegBuilderBase, type ClipBuilderData } from './ffmpeg_base.ts'
import { ClipBuilderBase } from './clip_base.ts'
import { ClipVideoBuilder } from './clip_video.ts'

export class FfmpegVideoBuilder extends FfmpegBuilderBase {
  protected get_vframe_flags() { return [] }
  public clip_builder(clip: parsed.MediaClipParsed, info: ClipInfo) { return new ClipVideoBuilder(clip, info) }

  protected input_audio(data: ClipBuilderData, complex_filter_inputs: string[], audio_links: string[], input_index: number) {
    if (data.probe_info.has_audio) {
      complex_filter_inputs.push(`[${input_index}:a] ${data.audio_input_filters.join(', ')} [a_in_${data.id}]`)
      audio_links.push(`[a_in_${data.id}]`)
    }
  }

  protected map_audio(complex_filter: string[]) {
    const map_audio_flags = []
    if (this.audio_links.length === 0) {
      // do not include audio
    } else if (this.audio_links.length === 1) {
      map_audio_flags.push('-map', this.audio_links[0]) 
    } else {
      complex_filter.push(`${this.audio_links.join('')} amix=inputs=${this.audio_links.length} [audio]`)
      map_audio_flags.push('-map', '[audio]')
    }

    return map_audio_flags
  }

  public get_output_file() {
    return path.join(this.context.output_folder, 'output.mp4')
  }
}
