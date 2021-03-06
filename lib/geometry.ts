import { InputError } from './errors.ts'
import { parse_unit } from './parsers/unit.ts'
import { AbstractClipMap } from './parsers/template.ts'
import type { ClipID } from './template_input.ts'
import type * as template_parsed from './parsers/template.ts'
import type { ClipInfoMap } from './probe.ts'

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

function compute_background_size(template: template_parsed.Template, clip_info_map: ClipInfoMap) {
  const { size } = template

  const compute_size = () => {
    const info = clip_info_map.get_or_else(size.relative_to)
    const { rotate } = template.clips.find((c) => c.id === size.relative_to)!
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
  template: template_parsed.Template,
  background_width: number,
  background_height: number,
  clip_info_map: ClipInfoMap
) {
  const clip_geometry_map = new ClipGeometryMap()
  for (const clip of template.clips) {
    const info = clip_info_map.get_or_else(clip.id)
    const { layout } = clip

    const input_width = parse_unit(layout?.width, {
      percentage: (p) => p * background_width,
      undefined: () => null,
    })
    const input_height = parse_unit(layout?.height, {
      percentage: (p) => p * background_height,
      undefined: () => null,
    })

    let width = input_width ?? (input_height ? input_height * info.aspect_ratio : info.width)
    let height = input_height ?? (input_width ? input_width / info.aspect_ratio : info.height)
    // ffmpeg will round down the scale filter, so we need to round down early to avoid "Invalid too big or non positive size for width '...' or height '...'" errors with crops
    ;[width, height] = [width, height].map(Math.floor)

    let scale = { width, height }
    let rotate: ComputedGeometry['rotate'] = undefined
    if (clip.rotate) {
      // we want scaling to happen before rotation because (on average) we scale down, and if we can scale
      // sooner, then we have less pixels to rotate/crop/etc
      ;({ width, height } = compute_rotated_size({ width, height }, clip.rotate))
      rotate = { degrees: clip.rotate, width, height }
    }

    let crop: ComputedGeometry['crop']
    if (clip.crop && Object.keys(clip.crop).length) {
      const width_relative_to_crop = width
      const height_relative_to_crop = height
      const { left, right, top, bottom } = clip.crop
      let x_crop = 0
      let y_crop = 0
      let width_crop = scale.width
      let height_crop = scale.height

      if (right) {
        const r = parse_unit(right, { percentage: (p) => p * width_relative_to_crop })
        width_crop = width_crop - r
        width -= r
      }
      if (bottom) {
        const b = parse_unit(bottom, { percentage: (p) => p * height_relative_to_crop })
        height_crop = height_crop - b
        height -= b
      }
      if (left) {
        const l = parse_unit(left, { percentage: (p) => p * width_relative_to_crop })
        x_crop = l
        width -= l
        width_crop = width_crop - x_crop
      }
      if (top) {
        const t = parse_unit(top, { percentage: (p) => p * height_relative_to_crop })
        y_crop = t
        height -= t
        height_crop = height_crop - y_crop
      }
      crop = { width: width_crop, height: height_crop, x: x_crop, y: y_crop }
    }
    let x: number = 0
    let y: number = 0
    let x_align = 'left'
    let y_align = 'top'
    // if (typeof layout?.x?.offset) x = parse_pixels(layout.x.offset)

    const parse_value = (relative_to: number) => (v: string | undefined) =>
      parse_unit(v, { pixels: (x) => x, percentage: (x) => relative_to * x, undefined: () => 0 })
    const parse_x = parse_value(background_width)
    const parse_y = parse_value(background_height)

    if (typeof layout?.x === 'object') x = parse_x(layout.x.offset)
    else if (typeof layout?.x === 'string') x = parse_x(layout.x)
    x_align = typeof layout?.x === 'object' ? layout.x.align ?? 'left' : 'left'

    if (typeof layout?.y === 'object') y = parse_y(layout.y.offset)
    else if (typeof layout?.y === 'string') y = parse_y(layout.y)
    y_align = typeof layout?.y === 'object' ? layout.y.align ?? 'left' : 'left'

    switch (x_align) {
      case 'left':
        break
      case 'right':
        x = background_width - width + x
        break
      case 'center':
        x = background_width / 2 - width / 2 + x
        break
    }
    switch (y_align) {
      case 'top':
        break
      case 'bottom':
        y = background_height - height + y
        break
      case 'center':
        y = background_height / 2 - height / 2 + y
        break
    }
    clip_geometry_map.set(clip.id, { x, y, width, height, scale, rotate, crop })
  }
  return clip_geometry_map
}

export { compute_rotated_size, compute_background_size, compute_geometry }
export type { ClipGeometryMap }
