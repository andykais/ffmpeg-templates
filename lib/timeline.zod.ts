import * as errors from './errors.ts'
import { parse_unit } from './parsers/unit.ts'
import { parse_duration } from './parsers/duration.zod.ts'
import type * as inputs from './template_input.zod.ts'
import type * as parsed from './parsers/template.zod.ts'
import type { Context } from './context.ts'


interface TimelineClip {
  clip_id: inputs.ClipID
  z_index: number
  duration: number
  start_at: number
  speed: number
  trim_start: number
}

interface Keypoints {
  [name: string]: number
}

function parse_timeline_clips(
  context: Context,
  timeline_clips: parsed.TimelineParsed,
  keypoints: Keypoints,
  order_type: 'parallel' | 'sequence',
  start_at: number
) {
  let timeline: TimelineClip[] = []
  let total_duration = start_at
  let max_timeline_next_duration = 0

  for (const timeline_clip of timeline_clips) {
    const offset = parse_duration(timeline_clip.offset)
    let clip_start_at = start_at + offset
    let clip_end_at = clip_start_at

    console.log(timeline_clip)
    if (timeline_clip.id !== undefined) {
      const clip = context.get_clip(timeline_clip.id)
      const clip_info = context.clip_info_map.get_or_throw(clip.id)
      let clip_duration = clip_info.duration
      // TODO NaN durations (e.g. images) should default to total duration
      // TODO support text_clip.durations
      if (Number.isNaN(clip_duration)) clip_duration = 1
      console.log('clip_info duration', clip_info.duration)

      const trim = clip.trim ?? {}
      let trim_start = 0
      if (trim.start) trim_start += parse_duration(trim.start)
      clip_duration -= trim_start
      if (trim.stop) clip_duration -= parse_duration(trim.stop)
      clip_end_at += clip_duration
      if (clip_duration < 0) throw new errors.InputError(`Invalid trim on clip ${clip.id}. Clip is not long enough`)

      for (const keypoint of clip.keypoints) {
        const anchored_keypoint = keypoints[keypoint.name]
        if (anchored_keypoint !== undefined) {
          if (anchored_keypoint > clip_start_at) {
            const inc_start_at = (anchored_keypoint - clip_start_at)
            clip_duration -= inc_start_at
            clip_start_at += inc_start_at
            if (clip_duration < 0) throw new errors.InputError(`Invalid keypoint ${keypoint.name} on clip ${clip.id}. Keypoint at ${anchored_keypoint} exceeds clip length of ${clip_duration}`)
          } else {
            throw new errors.InputError(`Invalid keypoint ${keypoint.name} on clip ${clip.id}. Keypoint occurs at ${anchored_keypoint}, clip starts at ${clip_start_at}`)
          }
        }
      }

      if (order_type === 'parallel') total_duration = Math.max(total_duration, clip_end_at)
      else total_duration += clip_end_at

      timeline.push({
        clip_id: timeline_clip.id,
        start_at: clip_start_at,
        z_index: timeline_clip.z_index,
        trim_start,
        duration: clip_duration,
        speed: parse_unit(clip.speed),
      })
    }


    // (slight optimization)
    if (timeline_clip.next.length > 0) {
      const next_timeline = parse_timeline_clips(context, timeline_clip.next, keypoints, timeline_clip.next_order, clip_end_at)
      timeline = timeline.concat(next_timeline.timeline)
      max_timeline_next_duration = Math.max(max_timeline_next_duration, next_timeline.total_duration)
      // total_duration += total_duration
    }

    if (order_type === 'sequence') start_at = clip_end_at
  }
  total_duration += max_timeline_next_duration
  return { timeline, total_duration }
}

function compute_timeline(context: Context) {
  const keypoints: Keypoints = {}
  const { total_duration, timeline } = parse_timeline_clips(context, context.template.timeline, keypoints, 'parallel', 0)

  timeline.sort((a, b) => a.z_index - b.z_index)
  console.log(timeline)
  return { total_duration, timeline }
}

export { compute_timeline }
export type { TimelineClip }
