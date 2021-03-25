import { InputError } from './errors.ts'
import { parse_unit, parse_percentage } from './parsers/unit.ts'
import { parse_duration, } from './parsers/duration.ts'
import type { ClipID } from './template_input.ts'
import type { TemplateParsed } from './parsers/template.ts'
import type { ClipInfoMap } from './probe.ts'
import type { ClipGeometryMap } from './geometry.ts'

type ClipZoompanMap = {
  [clip_id: string]: {
    start_at_seconds: number
    end_at_seconds: number

    start_x: number
    start_y: number
    start_zoom: number

    dest_x?: number
    dest_y?: number
    dest_zoom?: number

    x_expression?: string
    y_expression?: string
  }[]
}

// TODO consolidate
function get_clip<T>(clip_map: { [clip_id: string]: T }, clip_id: ClipID) {
  const clip = clip_map[clip_id]
  if (!clip) throw new InputError(`Clip ${clip_id} does not exist.`)
  return clip
}

function compute_zoompans(
  template: TemplateParsed,
  clip_info_map: ClipInfoMap,
  clip_geometry_map: ClipGeometryMap
) {
  const clip_zoompan_map: ClipZoompanMap = {}
  for (const clip of template.clips) {
    const geometry = get_clip(clip_geometry_map, clip.id)
    const { crop } = geometry
    const info = get_clip(clip_info_map, clip.id)
    clip_zoompan_map[clip.id] = []

    let prev_zoompan = { timestamp_seconds: 0, x_offset: 0, y_offset: 0, zoom: 1 }
    for (const timestamp of Object.keys(clip.zoompan ?? {})) {
      const zoompan = clip.zoompan![timestamp]
      const zoompan_end_at_seconds = parse_duration(timestamp, template)
      const next_prev_zoompan = { ...prev_zoompan, timestamp_seconds: zoompan_end_at_seconds }

      const computed_zoompan: ClipZoompanMap['<clip_id>'][0] = {
        start_at_seconds: prev_zoompan.timestamp_seconds,
        end_at_seconds: zoompan_end_at_seconds,

        start_x: prev_zoompan.x_offset,
        start_y: prev_zoompan.y_offset,
        start_zoom: prev_zoompan.zoom,
      }

      if (zoompan.x) {
        // this may change in the future (by adding a pad around images)
        if (!crop) throw new InputError(`Zoompan panning cannot be used without cropping the clip`)
        const max_x_pan_distance = geometry.scale.width - crop.width
        const x_after_pan =
          prev_zoompan.x_offset + parse_unit(zoompan.x, { percentage: (n) => n * geometry.scale.width })
        computed_zoompan.dest_x = x_after_pan
        if (x_after_pan < 0 || x_after_pan > max_x_pan_distance)
          throw new InputError(
            `Zoompan out of bounds. X pan must be between ${0} and ${max_x_pan_distance}. ${timestamp} x input was ${x_after_pan}`
          )
        next_prev_zoompan.x_offset = x_after_pan

        const n_frames =
          (computed_zoompan.end_at_seconds - computed_zoompan.start_at_seconds) * info.framerate
        const x_step = (computed_zoompan.dest_x - computed_zoompan.start_x) / n_frames
        const n_frames_so_far = info.framerate * computed_zoompan.start_at_seconds
        if (computed_zoompan.end_at_seconds === 0) {
          computed_zoompan.start_x = 0
        }
        const x_expression = `(n - ${n_frames_so_far})*${x_step}+${computed_zoompan.start_x}`
        computed_zoompan.x_expression = x_expression
      }
      if (zoompan.y) {
        // this may change in the future (by adding a pad around images)
        if (!crop) throw new InputError(`Zoompan panning cannot be used without cropping the clip`)
        const max_y_pan_distance = geometry.scale.height - crop.height
        const y_after_pan =
          prev_zoompan.y_offset + parse_unit(zoompan.y, { percentage: (n) => n * geometry.scale.height })
        computed_zoompan.dest_y = y_after_pan
        if (y_after_pan < 0 || y_after_pan > max_y_pan_distance)
          throw new InputError(
            `Zoompan out of bounds. y pan must be between ${0} and ${max_y_pan_distance}. ${timestamp} y input was ${y_after_pan}`
          )
        next_prev_zoompan.y_offset = y_after_pan

        const n_frames =
          (computed_zoompan.end_at_seconds - computed_zoompan.start_at_seconds) * info.framerate
        const y_step = (computed_zoompan.dest_y - computed_zoompan.start_y) / n_frames
        const n_frames_so_far = info.framerate * computed_zoompan.start_at_seconds
        if (computed_zoompan.end_at_seconds === 0) {
          computed_zoompan.start_y = 0
        }
        const y_eypression = `(n - ${n_frames_so_far})*${y_step}+${computed_zoompan.start_y}`
        computed_zoompan.y_expression = y_eypression
      }
      if (zoompan.zoom) {
        const zoom = parse_percentage(zoompan.zoom)
        computed_zoompan.dest_zoom = zoom
        next_prev_zoompan.zoom = zoom
      }

      prev_zoompan = next_prev_zoompan
      clip_zoompan_map[clip.id].push(computed_zoompan)
    }
    clip_zoompan_map[clip.id].sort((a, b) => a.start_at_seconds - b.start_at_seconds)
  }
  return clip_zoompan_map
}

export { compute_zoompans }

export type { ClipZoompanMap }
