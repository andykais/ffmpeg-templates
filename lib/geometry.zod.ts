import { InputError } from './errors.ts'
import { parse_unit } from './parsers/unit.ts'
import { AbstractClipMap } from './util.ts'
import type { Context } from './context.ts'
import type { TemplateParsed, MediaClipParsed } from './parsers/template.zod.ts'

interface ComputedGeometry {
  x: number | string
  y: number | string
  width: number
  height: number
  scale: { width: number; height: number }
  rotate?: { degrees: number; width: number; height: number }
  crop?: {
    x: number
    y: number
    width: number
    height: number
  }
}
class ClipGeometryMap extends AbstractClipMap<ComputedGeometry> {}

function compute_rotated_size(size: { width: number; height: number }, rotation?: number) {
  if (!rotation) return size
  const radians = (rotation * Math.PI) / 180.0
  const [height, width] = [
    Math.abs(size.width * Math.sin(radians)) + Math.abs(size.height * Math.cos(radians)),
    Math.abs(size.width * Math.cos(radians)) + Math.abs(size.height * Math.sin(radians)),
  ].map(Math.floor)

  return { width, height }
}

function compute_background_size(context: Context) {
  const { size } = context.template

  const compute_size = () => {
    const info = context.clip_info_map.get_or_throw(size.relative_to)
    const { rotate } = context.get_clip(size.relative_to)
    return compute_rotated_size(info, rotate)
  }
  const background_width = parse_unit(size.width, {
    percentage: (p) => Math.floor(p * compute_size().width),
  })
  const background_height = parse_unit(size.height, {
    percentage: (p) => Math.floor(p * compute_size().height),
  })
  return { background_width, background_height }
}







function compute_geometry(
  context: Context,
  background_width: number,
  background_height: number,
  clips: MediaClipParsed[]
) {
  const clip_geometry_map = new ClipGeometryMap()
  for (const clip of clips) {
    const geometry = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      scale: { width: 1, height: 1 },
      rotate: undefined,
      crop: undefined
    }

    clip_geometry_map.set(clip.id, geometry)
  }

  return clip_geometry_map
}












export { compute_rotated_size, compute_background_size, compute_geometry }
export type { ClipGeometryMap }
