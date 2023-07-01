import type { TimelineClip } from '../timeline.zod.ts'
import type { ClipInfo } from '../probe.zod.ts'
import type * as parsed from '../parsers/template.zod.ts'
import { ClipBuilderBase } from './clip_base.ts'


export class ClipSampleBuilder extends ClipBuilderBase {
  public constructor(clip: parsed.MediaClipParsed, info: ClipInfo, public sample_frame: number) {
    super(clip, info)
  }

  protected get_timing_start_at(timeline_data: TimelineClip) {
    return 0
  }
  protected get_timing_trim_start(timeline_data: TimelineClip) {
    return timeline_data.trim_start + this.sample_frame - timeline_data.start_at
  }
}

