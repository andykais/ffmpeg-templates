import { InputError } from './errors.ts'
import { parse_unit, parse_percentage } from './parsers/unit.ts'
import { parse_duration } from './parsers/duration.ts'
import { AbstractClipMap } from './util.ts'
import type { ClipID } from './template_input.ts'
import type { ClipInfoMap } from './probe.ts'
import type { ClipGeometryMap } from './geometry.ts'
import type {Context} from './context.ts'

type ComputedZoompan = {
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
}

class ClipZoompansMap extends AbstractClipMap<ComputedZoompan[]> {}

function compute_zoompans(
  context: Context,
  clip_info_map: ClipInfoMap,
  clip_geometry_map: ClipGeometryMap
): ClipZoompansMap {
  for (const [clip_id, clip] of context.template.clips.entries()) {
    if (clip.zoompan) {
      throw new Error('unimplemented')
    }
  }

  return new ClipZoompansMap()
}

export { compute_zoompans }
export type { ClipZoompansMap }
