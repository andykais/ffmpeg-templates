import { InputError } from './errors.ts'
import * as math from './float_math.ts'
import { is_media_clip } from './parsers/template.ts'
import { parse_percentage } from './parsers/unit.ts'
import { parse_duration } from './parsers/duration.ts'
import { TIMELINE_ENUMS } from './template_input.ts'
import type { ClipID } from './template_input.ts'
import type * as template_parsed from './parsers/template.ts'
import type { ClipInfoMap } from './probe.ts'

interface TimelineClip {
  clip_id: ClipID
  duration: number
  start_at: number
  speed: number
  trim_start: number
}
function compute_timeline(template: template_parsed.Template, clip_info_map: ClipInfoMap) {
  const { timeline } = template

  const all_clips_trim_to_fit = Object.values(template.timeline).every((layers) =>
    layers.every((layer) =>
      layer
        .filter((id) => id !== TIMELINE_ENUMS.PAD)
        .map((id) => {
          const clip = template.clips.find((c) => c.id === id)
          if (!clip) throw new InputError(`Clip ${id} does not exist.`)
          return clip
        })
        .every((clip) => clip.trim?.start === 'fit' || clip.trim?.end === 'fit')
    )
  )

  function calculate_layer_duration(
    layer_start_position: number,
    layer: ClipID[],
    index: number,
    skip_trim_fit: boolean
  ) {
    let layer_duration = 0
    for (const clip_index of layer.keys()) {
      // start at the specified index
      if (clip_index < index) continue
      if (clip_index > 0) layer_duration += 0.001

      const clip_id = layer[clip_index]
      // PAD does nothing while calculating longest duration
      if (clip_id === TIMELINE_ENUMS.PAD) continue

      const clip = template.clips.find((c) => c.id === clip_id)
      if (clip === undefined)
        throw new InputError(`Clip ${clip_id} does not exist. I cannot be used in the timeline.`)
      const info = clip_info_map.get_or_else(clip_id)
      let clip_duration = info.duration

      const { trim } = clip

      if (trim?.stop_at_output) {
        const clip_start_position = layer_start_position + layer_duration
        clip_duration = parse_duration(trim.stop_at_output, template) - clip_start_position
      }

      if (Number.isNaN(clip_duration)) {
        if (clip.duration) clip_duration = parse_duration(clip.duration, template)
        // Images and Fonts have no file duration, so if a manual duration isnt specified, they do nothing
        else continue
      }

      if (Object.keys(trim || {}).filter((k) => ['end', 'stop', 'stop_at_output'].includes(k)).length > 1) {
        throw new InputError(`'end', 'stop', and 'stop_at_output' are mutually exclusive.`)
      }

      if (trim?.start === 'fit') {
      } else if (trim?.start) {
        if (!trim.stop_at_output) clip_duration -= parse_duration(trim.start, template)
      }
      if (trim?.end === 'fit') {
      } else if (trim?.end) clip_duration -= parse_duration(trim.end, template)

      if (trim?.stop) clip_duration -= info.duration - parse_duration(trim.stop, template)
      if (clip.speed) clip_duration *= 1 / parse_percentage(clip.speed)

      if (clip_duration < 0) {
        throw new InputError(
          `Clip ${clip_id} was trimmed ${clip_duration} seconds more than its total duration`
        )
      }
      if (clip.duration) {
        const manual_duration = parse_duration(clip.duration, template)
        if (is_media_clip(clip) && manual_duration > clip_duration)
          throw new InputError(
            `Clip ${clip_id}'s duration (including trimmings) cannot be shorter than the specified duration.`
          )
        else clip_duration = manual_duration
      }
      // we skip the fit trimmed clips _unless_ theyre all fit trimmed
      if ([trim?.start, trim?.end].includes('fit') && !all_clips_trim_to_fit) continue
      layer_duration += clip_duration
    }
    return layer_duration
  }

  let longest_duration = 0
  let shortest_duration = Infinity
  for (const start_position of Object.keys(timeline)) {
    const start_position_seconds = parse_duration(start_position, template)

    for (const clips of Object.values(timeline[start_position])) {
      let layer_duration = start_position_seconds

      layer_duration += calculate_layer_duration(start_position_seconds, clips, 0, all_clips_trim_to_fit)
      longest_duration = Math.max(longest_duration, layer_duration)
      shortest_duration = Math.min(shortest_duration, layer_duration)
    }
  }
  const total_duration = all_clips_trim_to_fit ? shortest_duration : longest_duration
  if (total_duration === 0 || Number.isNaN(total_duration)) {
    throw new InputError(
      'Output duration cannot be zero. If all clips are font or image clips, at least one must specify a duration.'
    )
  }

  const layer_ordered_clips: TimelineClip[][] = []
  for (const start_position of Object.keys(timeline)) {
    const start_position_seconds = parse_duration(start_position, template)
    for (const layer_index of timeline[start_position].keys()) {
      const clips = timeline[start_position][layer_index]

      let layer_start_position = start_position_seconds
      for (const clip_index of clips.keys()) {
        if (clip_index > 0) layer_start_position += 0.001
        const clip_id = clips[clip_index]
        if (clip_id === TIMELINE_ENUMS.PAD) {
          const remaining_duration = calculate_layer_duration(
            layer_start_position,
            clips,
            clip_index + 1,
            true
          )
          const seconds_until_complete = total_duration - (layer_start_position + remaining_duration)
          if (math.gt(seconds_until_complete, 0)) layer_start_position += seconds_until_complete
        } else {
          const clip = template.clips.find((c) => c.id === clip_id)!
          const info = clip_info_map.get_or_else(clip_id)
          const { trim } = clip
          let clip_duration = info.duration
          if (Number.isNaN(clip_duration)) clip_duration = total_duration
          const speed = clip.speed ? parse_percentage(clip.speed) : 1
          clip_duration *= 1 / speed
          let trim_start = 0

          if (trim?.stop_at_output) {
            const clip_start_position = layer_start_position
            clip_duration = parse_duration(trim.stop_at_output, template) - clip_start_position
          }
          if (trim?.end && trim?.end !== 'fit') {
            clip_duration -= parse_duration(trim.end, template)
          }
          if (trim?.stop) {
            clip_duration = parse_duration(trim.stop, template)
          }
          if (trim?.start && trim?.start !== 'fit') {
            trim_start = parse_duration(trim.start, template)
            if (!trim.stop_at_output) clip_duration -= trim_start
          }

          if (trim?.end === 'fit') {
            const remaining_duration = calculate_layer_duration(
              layer_start_position,
              clips,
              clip_index + 1,
              true
            )
            const seconds_until_complete =
              layer_start_position + clip_duration + remaining_duration - total_duration
            // sometimes we will just skip the clip entirely if theres no room
            if (math.gte(seconds_until_complete, clip_duration)) continue
            if (math.gt(seconds_until_complete, 0)) clip_duration -= seconds_until_complete
          }

          if (trim?.start === 'fit' && trim?.end === 'fit') {
            // do nothing, because we already trimmed the end to fit
          } else if (trim?.start === 'fit') {
            const remaining_duration = calculate_layer_duration(
              layer_start_position,
              clips,
              clip_index + 1,
              true
            )
            const seconds_until_complete =
              layer_start_position + clip_duration + remaining_duration - total_duration
            // sometimes we will just skip the clip entirely if theres no room
            if (math.gte(seconds_until_complete, clip_duration)) continue
            if (math.gt(seconds_until_complete, 0)) {
              trim_start = seconds_until_complete
              clip_duration -= seconds_until_complete
            }
          }
          if (clip.duration) {
            const manual_duration = parse_duration(clip.duration, template)
            clip_duration = Math.min(manual_duration * speed, clip_duration)
          }

          layer_ordered_clips[layer_index] = layer_ordered_clips[layer_index] ?? []
          layer_ordered_clips[layer_index].push({
            clip_id: clip_id,
            duration: clip_duration,
            trim_start,
            speed,
            start_at: layer_start_position,
          })
          layer_start_position += clip_duration
        }
      }
    }
  }
  return {
    // flatten the layers and timelines into a single stream of overlays
    // (where the stuff that should appear in the background is first)
    timeline: layer_ordered_clips.reduce((acc: TimelineClip[], layer) => acc.concat(layer), []),
    total_duration,
  }
}

export { compute_timeline }
