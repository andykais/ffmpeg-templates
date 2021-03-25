import { InputError } from '../errors.ts'
import type { TemplateParsed } from './template.ts'

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

function parse_unit<T = number, U = number, V = number>(
  value: string | undefined,
  post_processors?: { percentage?: (p: number) => T; pixels?: (p: number) => U; undefined?: () => V }
) {
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
