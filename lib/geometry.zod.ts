import { InputError } from './errors.ts'
import { parse_unit } from './parsers/unit.ts'
import { AbstractClipMap } from './util.ts'
import type { Context } from './context.ts'
import type { TemplateParsed, MediaClipParsed, LayoutParsed, SizeParsed } from './parsers/template.zod.ts'

interface ComputedGeometry {
  x: number
  y: number
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

  const info = context.clip_info_map.get_or_throw(size.relative_to)
  const { rotate } = context.get_clip(size.relative_to)
  const relative_to_dimensions = compute_rotated_size(info, rotate)

  const background_width = parse_unit(size.width, {
    percentage: (p) => Math.floor(p * relative_to_dimensions.width),
    undefined: ()  => relative_to_dimensions.width
  })
  const background_height = parse_unit(size.height, {
    percentage: (p) => Math.floor(p * relative_to_dimensions.height),
    undefined: ()  => relative_to_dimensions.height
  })
  return { width: background_width, height: background_height }
}


function compute_size(context: Context, size: SizeParsed, aspect_ratio?: number, default_size?: { width: number; height: number }) {
  const info = context.get_clip_dimensions(size.relative_to)
  const relative_to_dimensions = compute_rotated_size(info, info.rotation)
  default_size = default_size ?? {width: info.width, height: info.height}

  const input_width = parse_unit(size.width, {
    percentage: (p) => Math.floor(p * info.width),
    undefined: () => null
  })
  const input_height = parse_unit(size.height, {
    percentage: (p) => Math.floor(p * info.height),
    undefined: () => null
  })
  let width = input_width ?? ((input_height && aspect_ratio) ? input_height * aspect_ratio : default_size.width)
  let height = input_height ?? ((input_width && aspect_ratio) ? input_width / aspect_ratio : default_size.height)
  // ffmpeg will round down the scale filter, so we need to round down early to avoid "Invalid too big or non positive size for width '...' or height '...'" errors with crops
  ;[width, height] = [width, height].map(Math.floor)
  return { width, height }
}


function compute_layout_coordinates(context: Context, layout: LayoutParsed, scale: {width: number; height: number}) {
  const relative_to = context.get_clip_dimensions(layout.relative_to)
  const parse_offset = (relative_to: number, offset: string) => parse_unit(offset, {
    percentage: p => p * relative_to
  })
  let x = parse_offset(relative_to.width, layout.x.offset)
  let y = parse_offset(relative_to.height, layout.y.offset)

  switch (layout.x.align) {
    case 'left':
      break
    case 'right':
      x = relative_to.width - scale.width + x
      break
    case 'center':
      x = relative_to.width / 2 - scale.width / 2 + x
      break
  }
  switch (layout.y.align) {
    case 'top':
      break
    case 'bottom':
      y = relative_to.height - scale.height + y
      break
    case 'center':
      y = relative_to.height / 2 - scale.height / 2 + y
      break
  }
  return { x ,y }
}

function compute_geometry(
  context: Context,
  clips: MediaClipParsed[]
) {
  const clip_geometry_map = new ClipGeometryMap()
  for (const clip of clips) {
    const clip_info = context.clip_info_map.get_or_throw(clip.id)
    const { layout, } = clip

    let {width, height} = compute_size(context, layout, clip_info.aspect_ratio, clip_info)
    let rotate: ComputedGeometry['rotate'] = undefined
    if (clip.rotate) {
      // we want scaling to happen before rotation because (on average) we scale down, and if we can scale
      // sooner, then we have less pixels to rotate/crop/etc
      ;({ width, height } = compute_rotated_size({ width, height }, clip.rotate))
      rotate = { degrees: clip.rotate, width, height }
    }

    const parse_offset = (relative_to: number, offset: string) => parse_unit(offset, {
      percentage: p => p * relative_to
    })
    let crop: ComputedGeometry['crop']
    if (clip.crop && Object.keys(clip.crop).length) {
      // NOTE crop x & y are only  relative themselves. It doesnt make a ton of sense to make these relative to anything else,
      // even though it makes sense to let width/height be relative to other things
      // let crop_size = compute_size(context, clip.crop, clip_info.aspect_ratio)

      // NOTE relative size is _correct_ for relative to itself,
      // but it will be wrong if it is relative to another clip whose scale has changed.
      // to fix this, geometry will need to keep a stateful dimensions map similar to how timeline variable_length clips work
      const relative_size = clip.crop.relative_to === clip.id
        ? {width, height}
        : context.get_clip_dimensions(clip.crop.relative_to)

      const parse_dimension = (relative_side: number, default_side: number, side?: string) => parse_unit(side, {
        percentage: (p) => Math.floor(p * relative_side),
        undefined: () => default_side
      })
      const crop_size = {
        width: parse_dimension(relative_size.width, width, clip.crop.width),
        height: parse_dimension(relative_size.height, height, clip.crop.height),
      }
      // if (width > crop_size.width) 
      // if (width < crop_size.width) throw new InputError(`Invalid clip on clip ${clip.id}. Cannot specify a layout width (${width}) smaller than a crop width (${crop_size.width})`)
      // if (height < crop_size.height) throw new InputError(`Invalid clip on clip ${clip.id}. Cannot specify a layout height (${height}) smaller than a crop height (${crop_size.height})`)

      let x = parse_offset(crop_size.width, clip.crop.x.offset)
      let y = parse_offset(crop_size.height, clip.crop.y.offset)
      switch (clip.crop.x.align) {
        case 'left':
          break
        case 'right':
          x = width - crop_size.width + x
          // x = relative_to.width - scale.width + x
          break
        case 'center':
          x = width / 2 - crop_size.width / 2 + x
          break
      }
      switch (clip.crop.y.align) {
        case 'top':
          break
        case 'bottom':
          y = height - crop_size.height + y
          break
        case 'center':
          y = height / 2 - crop_size.height / 2 + y
          break
      }
      if ((x + crop_size.width) > width) throw new InputError(`Invalid crop offset. Crop x position (${x}) cannot exceed crop width (${crop_size.width}) - max scale (${width})`)
      if ((y + crop_size.height) > height) throw new InputError(`Invalid crop offset. Crop x position (${y}) cannot exceed crop height (${crop_size.height}) - max scale (${height})`)
      crop = {
        x,
        y,
        ...crop_size
      }
      // width += (width - crop_size.width)
    }

    const relative_to = context.get_clip_dimensions(layout.relative_to)
    let x = parse_offset(relative_to.width, layout.x.offset)
    let y = parse_offset(relative_to.height, layout.y.offset)

    const crop_size = crop ?? {width, height}
    switch (layout.x.align) {
      case 'left':
        break
      case 'right':
        x = relative_to.width - (crop_size.width + x)
        break
      case 'center':
        x = relative_to.width / 2 - (crop_size.width / 2 + x)
        break
    }
    switch (layout.y.align) {
      case 'top':
        break
      case 'bottom':
        y = relative_to.height - crop_size.height + y
        break
      case 'center':
        y = relative_to.height / 2 - crop_size.height / 2 + y
        break
    }

    if (crop && crop.width > width) throw new InputError(`Invalid crop for clip ${clip.id}. Crop width (${crop.width}) cannot exceed layout width (${width})`)
    if (crop && crop.height > height) throw new InputError(`Invalid crop for clip ${clip.id}. Crop height (${crop.height}) cannot exceed layout height (${height})`)
    const geometry = {
      x,
      y,
      scale: { width, height },
      rotate,
      crop,
    }

    clip_geometry_map.set(clip.id, geometry)
  }

  return clip_geometry_map
}












export { compute_rotated_size, compute_size, compute_background_size, compute_geometry }
export type { ClipGeometryMap, ComputedGeometry }
