import { InputError } from './errors.ts'
import { parse_unit, parse_percentage } from './parsers/unit.ts'
import { parse_duration } from './parsers/duration.zod.ts'
import { AbstractClipMap } from './parsers/template.ts'
import type { ClipID } from './template_input.ts'
import type * as template_parsed from './parsers/template.ts'
import type { ClipInfoMap } from './probe.zod.ts'
import type { ClipGeometryMap } from './geometry.zod.ts'
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
  throw new Error('unimplemented')
}

export { compute_zoompans }
export type { ClipZoompansMap }
