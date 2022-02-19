import { InputError } from '../errors.ts'

type Seconds = number

// TODO we evaluate right to left. We need to evaluate left to right! E.g. 3 - 1 - 2 is 0, not 6!
// TODO add math expressions. These should be valid:
// "00:00:00,0000"
// "00:00:00.0000"
// "00:00:00.0000 - 00:00:00"
// "00:00:03.0000 - 00:00:01.1 - 00:00:00.5"
// "00:00:03.0000 + {CLIP_0.trim.start}"
const duration_var_regex = /\{([a-zA-Z0-9._-]+)\}/
const parens_regex = /^\(.*\)/
function parse_duration(duration_expr: string): Seconds {
  try {
    let current_duration_expr = duration_expr.trim()
    const [parens_expr] = current_duration_expr.match(parens_regex) ?? [null]
    let duration_lhs: number = -1
    let operator = null
    let expr_rhs: string[] = []
    if (parens_expr) {
      const duration_lhs_expr = current_duration_expr.substring(1, parens_expr.length - 1)
      duration_lhs = parse_duration(duration_lhs_expr)
      ;[operator, ...expr_rhs] = current_duration_expr.substr(parens_expr.length).trim().split(' ').map(s => s.trim())
    } else {
      let duration_lhs_expr = ''
      ;[duration_lhs_expr, operator, ...expr_rhs] = current_duration_expr.split(' ').map(s => s.trim())
      const [_,variable_expr] = duration_lhs_expr.match(duration_var_regex) ?? []
      if (variable_expr) {
        throw new InputError('Duration variable syntax is unimplemented.')
      } else {
        duration_lhs = duration_lhs_expr.split(':').reverse().reduce((acc, s,i) => acc+parseFloat(s)*Math.pow(60,i), 0)
      }
    }
    if (operator) {
      if (operator && expr_rhs.length) {
        switch(operator) {
            case '+':
              return duration_lhs + parse_duration(expr_rhs.join(' '))
            case '-':
              return duration_lhs - parse_duration(expr_rhs.join(' ')) 
            case '/':
              return duration_lhs / parse_duration(expr_rhs.join(' '))
            case '*':
              return duration_lhs * parse_duration(expr_rhs.join(' '))
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

export {
  parse_duration,
  parse_aspect_ratio,
  parse_ffmpeg_packet,
}

export type { Seconds }
