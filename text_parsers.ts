import { InputError } from './errors.ts'
import type { TemplateParsed } from './mod.ts'

type Seconds = number

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
    return (post_processors?.percentage ?? (p => p))(parse_percentage(value))
  } catch (e) {
    if (e instanceof UnitError == false) throw e
  }

  try {
    return (post_processors?.pixels ?? (p => p))(parse_pixels(value))
  } catch (e) {
    if (e instanceof UnitError == false) throw e
  }
  throw new InputError(`Value "${value}" is neither a percentage or pixels`)
}

// TODO add math expressions. These should be valid:
// "00:00:00,0000"
// "00:00:00.0000"
// "00:00:00.0000 - 00:00:00"
// "00:00:03.0000 - 00:00:01.1 - 00:00:00.5"
// "00:00:03.0000 + {CLIP_0.trim.start}"
const duration_var_regex = /\{([a-zA-Z0-9._-]+)\}/
const parens_regex = /^\(.*?\)/
function parse_duration(duration_expr: string, template: TemplateParsed): Seconds {
  try {
    let current_duration_expr = duration_expr.trim()
    const [parens_expr] = current_duration_expr.match(parens_regex) ?? [null]
    let duration_lhs: number = -1
    let operator = null
    let expr_rhs: string[] = []
    if (parens_expr) {
      const duration_lhs_expr = current_duration_expr.substring(1, parens_expr.length - 1)
      duration_lhs = parse_duration(duration_lhs_expr, template)
      ;[operator, ...expr_rhs] = current_duration_expr.substr(parens_expr.length).trim().split(' ').map(s => s.trim())
    } else {
      let duration_lhs_expr = ''
      ;[duration_lhs_expr, operator, ...expr_rhs] = current_duration_expr.split(' ').map(s => s.trim())
      const [_,variable_expr] = duration_lhs_expr.match(duration_var_regex) ?? []
      if (variable_expr) {
        const [clip_id, ...fields] = variable_expr.split('.')
        const clip = template.clips.find(c => c.id === clip_id)
        if (clip) {
          const duration_field_hopefully = fields.reduce((obj: any, key) => obj[key], clip)
          if (duration_field_hopefully) duration_lhs = parse_duration(duration_field_hopefully, template)
          else throw new InputError(`Invalid duration "${duration_lhs_expr}". Specified clip field for clip "${clip_id}" is undefined`)
        }
      } else {
        duration_lhs = duration_lhs_expr.split(':').reverse().reduce((acc, s,i) => acc+parseFloat(s)*Math.pow(60,i), 0)
      }
    }
    if (operator) {
      if (operator && expr_rhs.length) {
        switch(operator) {
            case '+':
              return duration_lhs + parse_duration(expr_rhs.join(' '), template)
            case '-':
              return duration_lhs - parse_duration(expr_rhs.join(' '), template)
            case '/':
              return duration_lhs / parse_duration(expr_rhs.join(' '), template)
            case '*':
              return duration_lhs * parse_duration(expr_rhs.join(' '), template)
            default:
              throw new InputError(`Invalid duration "${duration_expr}". Expected "+,-,/,*" where "${operator}" was`)
        }
      } else {
        throw new InputError(`Invalid duration "${duration_expr}". Expected <duration> <operator> <duration_expr>`)
      }
    }

    return duration_lhs
  } catch (e) {
    if (e.name === 'TypeError') {
      throw new InputError(`Invalid duration "${duration_expr}". Cannot parse`)
    } else throw e
  }
}

function parse_aspect_ratio(aspect_ratio: string, rotation?: number) {
  const parts = aspect_ratio.split(':').map(part => parseInt(part))
  if (parts.length !== 2 || parts.some(Number.isNaN))
    throw new Error(`aspect ratio ${aspect_ratio} parsed incorrectly.`)
  let [width, height] = parts
  if (rotation) {
    ;[height, width] = [
      Math.abs(width * Math.sin(rotation)) + Math.abs(height * Math.cos(rotation)),
      Math.abs(width * Math.cos(rotation)) + Math.abs(height * Math.sin(rotation)),
    ].map(Math.floor)
  }
  return width / height
}

function parse_ffmpeg_packet(packet_buffer: string[]) {
  const object: { [key: string]: string } = {}
  for (const line of packet_buffer) {
    const [key, value] = line.split('=')
    object[key] = value
  }
  return object
}

const TIMELINE_ENUMS = {
  PAD: 'PAD',
} as const

export {
  parse_unit,
  parse_percentage,
  parse_pixels,
  parse_duration,
  parse_aspect_ratio,
  parse_ffmpeg_packet,
  TIMELINE_ENUMS,
}
