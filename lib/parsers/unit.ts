import type { DetailedSizeUnit } from '../template_input.zod.ts'
import { InputError } from '../errors.ts'

class UnitError extends InputError {}
function parse_percentage(percentage: string): number {
  if (percentage.endsWith('%')) {
    const percent = parseFloat(percentage.substr(0, percentage.length - 1))
    if (!Number.isNaN(percent)) {
      return percent / 100
    }
  }
  throw new UnitError(`Invalid percentage "${percentage}"`)
}

function parse_pixels(pixels: string): number {
  if (pixels.endsWith('px')) {
    const pixels_number = parseFloat(pixels.substr(0, pixels.length - 2))
    if (!Number.isNaN(pixels_number)) {
      return pixels_number
    }
  }
  throw new InputError(`Invalid pixels value "${pixels}"`)
}

// interface ParseUnitHandlers {
//   percentage?: (p: number) => number
//   pixels?: (p: number) => U; undefined?: () => number
//   undefined?: () => number
// }

// function parse_unit(
//   value: string | undefined,
//   post_processors?: ParseUnitHandlers 
// ) {
function parse_unit<T extends number, U extends number, W extends number, X extends number, V = number>(
  value: string | DetailedSizeUnit | undefined,
  post_processors?: {
    percentage?: (p: number) => T;
    pixels?: (p: number) => U;
    undefined?: () => V;
    min?: (p: number) => W;
    max?: (p: number) => X;
  }
): T | U | V | number {
  if (typeof value === 'object') {
    const unit_value = parse_unit(value.value, post_processors)
    const detailed_processors = {...post_processors, undefined: () => undefined}
    const min_value = parse_unit(value.min, detailed_processors)
    const max_value = parse_unit(value.max, detailed_processors)

    if (min_value) post_processors?.min!(min_value)
    if (max_value) post_processors?.max!(max_value)
    return unit_value
    // if (min_value > max_value) {
    //   throw new Error('Max value cannot be smaller than min value')
    // }
    // if (unit_value) {
    //   return Math.max(min_value, Math.min(max_value, unit_value))
    // } else if (Number.isFinite(max_value)) {
    //   return post_processors!.min!(max_value)
    // } else if (min_value !== 0) {
    //   return post_processors!.min!(min_value)
    //   // return min_value
    // }
    // throw new Error('unexpected code path. All {min, max, value} fields are undefined')
  }

  if (value === undefined || value === '') {
    if (post_processors?.undefined) return post_processors.undefined()
    else throw new InputError('Value must be defined')
  }
  try {
    return (post_processors?.percentage ?? ((p) => p))(parse_percentage(value))
  } catch (e) {
    if (e instanceof UnitError == false) throw e
  }

  try {
    return (post_processors?.pixels ?? ((p) => p))(parse_pixels(value))
  } catch (e) {
    if (e instanceof UnitError == false) throw e
  }
  throw new InputError(`Value "${value}" is neither a percentage or pixels`)
}

export { parse_unit, parse_percentage, parse_pixels }
