import type { TimelineClip } from '../timeline.ts'
import type { ClipInfo } from '../probe.ts'
import type * as parsed from '../parsers/template.ts'
import { ClipBuilderBase } from './clip_base.ts'


export class ClipSampleBuilder extends ClipBuilderBase {
  public constructor(clip: parsed.MediaClipParsed, info: ClipInfo, public sample_frame: number) {
    super(clip, info)
  }

  protected override get_timing_start_at(timeline_data: TimelineClip) {
    return 0
  }
  protected override get_timing_trim_start(timeline_data: TimelineClip) {
    return timeline_data.trim_start + this.sample_frame - timeline_data.start_at
  }
}

