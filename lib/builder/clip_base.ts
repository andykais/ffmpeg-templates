import { parse_unit } from '../parsers/unit.ts'
import type * as parsed from '../parsers/template.zod.ts'
import type { TimelineClip } from '../timeline.zod.ts'
import type { ComputedGeometry } from '../geometry.zod.ts'
import type { ClipInfo } from '../probe.zod.ts'

import { type ClipBuilderData } from './ffmpeg_base.ts'

export abstract class ClipBuilderBase {
  protected pts_speed = '1*'
  protected setpts_filter = ''
  protected start_at = 0
  protected clip_trim_start = 0
  protected clip_duration = NaN
  protected timeline_data: TimelineClip = {
    clip_id: '',
    z_index: 0,
    start_at: 0,
    speed: 1,
    trim_start: 0,
    duration: NaN,
  }
  private x = 0
  private y = 0
  private video_input_filters: string[] = []
  private audio_input_filters: string[] = []

  private compute_tempo(val: number) {
    const numMultipliers =
      val > 1 ? Math.ceil(Math.log(val) / Math.log(2)) : Math.ceil(Math.log(val) / Math.log(0.5))
    const multVal = Math.pow(Math.E, Math.log(val) / numMultipliers)
    return Array(numMultipliers).fill(`atempo=${multVal}`).join(',')
  }

  public constructor(protected clip: parsed.MediaClipParsed, protected probe_info: ClipInfo) {
    const volume = parse_unit(clip.volume, {
      percentage: v => v,
      undefined: () => 1,
    })
    this.audio_input_filters.push(
      `asetpts=PTS-STARTPTS`,
      // `atrim=0:${duration * speed}`,
      // `adelay=${start_at * 1000}:all=1`,
      `volume=${volume}`, // TODO use anullsink for audio_volume === 0 to avoid extra processing
    )
  }

  protected get_timing_start_at(timeline_data: TimelineClip) {
    return timeline_data.start_at
  }
  protected get_timing_trim_start(timeline_data: TimelineClip) {
    return timeline_data.trim_start
  }

  public timing(timeline_data: TimelineClip) {
    this.timeline_data = timeline_data
    this.start_at = this.get_timing_start_at(timeline_data)
    this.clip_trim_start = this.get_timing_trim_start(timeline_data)
    this.clip_duration = timeline_data.duration
    this.pts_speed = `${1 / timeline_data.speed}*`

    if (this.start_at === 0) this.setpts_filter = `setpts=${this.pts_speed}PTS-STARTPTS`
    else this.setpts_filter = `setpts=${this.pts_speed}PTS-STARTPTS+${this.start_at}/TB`

    this.audio_input_filters.push(`adelay=${this.start_at * 1000}:all=1`)
    const atempo = this.compute_tempo(timeline_data.speed)
    // a.k.a. speed == 1
    // TODO it seems like theres some weird floating point math happening in some cases
    if (atempo !== '') this.audio_input_filters.push(atempo)
    return this
  }

  public coordinates(x: number, y: number) {
    this.x = x
    this.y = y
    return this
  }
  public chromakey(colorkey: string) {
    this.video_input_filters.push(`colorkey=${colorkey}:0.3:`)
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
    // TODO support zoompan
    const crop_x = crop.x
    const crop_y = crop.y
    this.video_input_filters.push(
      `crop=w=${crop.width}:h=${crop.height}:x='${crop_x}':y='${crop_y}':keep_aspect=1`
    )
    return this
  }

  public build(): ClipBuilderData  {
    const video_input_filters = [
      this.setpts_filter,
      ...this.video_input_filters,
    ]

    let framerate = this.probe_info.framerate
    if (this.clip.framerate) {
      const { fps } = this.clip.framerate
      framerate = fps
      if (this.clip.framerate.smooth) {
        video_input_filters.push(`minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`)
        // video_input_filters.push(`minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=${fps}'`)
      } else {
        video_input_filters.push(`fps=${fps}`)
      }
    }
    return {
      id: this.clip.id,
      file: this.clip.file,
      start_at: this.start_at,
      trim_start: this.clip_trim_start,
      duration: this.clip_duration,
      timeline_data: this.timeline_data,
      framerate,
      video_input_filters,
      audio_input_filters: this.audio_input_filters,
      overlay_filter: `overlay=x=${this.x}:y=${this.y}:eof_action=pass`,
      probe_info: this.probe_info,
    }
  }
}
