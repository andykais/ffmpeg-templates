import { InputError } from '../errors.ts'
import type * as inputs from '../template_input.zod.ts'
import type { Context } from '../context.ts'

type Seconds = number

interface CaseLambdas {
  keypoint?: (timestamp: number) => number
  default?: (timestamp: number) => number
}

// TODO we evaluate right to left. We need to evaluate left to right! E.g. 3 - 1 - 2 is 0, not 6!
// TODO add math expressions. These should be valid:
// "00:00:00,0000"
// "00:00:00.0000"
// "00:00:00.0000 - 00:00:00"
// "00:00:03.0000 - 00:00:01.1 - 00:00:00.5"
// "00:00:03.0000 + {CLIP_0.trim.start}"
const duration_var_regex = /\{([a-zA-Z0-9._-]+)\}/
const parens_regex = /^\(.*\)/
function parse_duration_expr(context: Context, duration_expr: string ): Seconds {
  try {
    let current_duration_expr = duration_expr.trim()
    const [parens_expr] = current_duration_expr.match(parens_regex) ?? [null]
    let duration_lhs: number = -1
    let operator = null
    let expr_rhs: string[] = []
    if (parens_expr) {
      const duration_lhs_expr = current_duration_expr.substring(1, parens_expr.length - 1)
      duration_lhs = parse_duration(context, duration_lhs_expr)
      ;[operator, ...expr_rhs] = current_duration_expr.substr(parens_expr.length).trim().split(' ').map(s => s.trim())
    } else {
      let duration_lhs_expr = ''
      ;[duration_lhs_expr, operator, ...expr_rhs] = current_duration_expr.split(' ').map(s => s.trim())
      const [_,variable_expr] = duration_lhs_expr.match(duration_var_regex) ?? []
      if (variable_expr) {
        const [variable_name, ...accessors] = variable_expr.split('.')
        if (variable_name === 'keypoints') {
          if (accessors.length !== 1) throw new InputError('invalid access to keypoint.')
          return context.get_keypoint(accessors[0])
        }
        throw new InputError('Duration variable syntax is unimplemented.')
      } else {
        duration_lhs = duration_lhs_expr.split(':').reverse().reduce((acc, s,i) => acc+parseFloat(s)*Math.pow(60,i), 0)
      }
    }
    if (operator) {
      if (operator && expr_rhs.length) {
        switch(operator) {
            case '+':
              return duration_lhs + parse_duration(context, expr_rhs.join(' '))
            case '-':
              return duration_lhs - parse_duration(context, expr_rhs.join(' ')) 
            case '/':
              return duration_lhs / parse_duration(context, expr_rhs.join(' '))
            case '*':
              return duration_lhs * parse_duration(context, expr_rhs.join(' '))
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

function parse_duration(context: Context, duration_expr: string | inputs.KeypointReference, case_lambdas?: CaseLambdas): Seconds {
  if (typeof duration_expr === 'object') {
    if (case_lambdas?.keypoint === undefined) throw new Error('Keypoints must be supported for this duration parse.')
    const keypoint_timestamp = context.get_keypoint(duration_expr.keypoint)
    const offset = parse_duration_expr(context, duration_expr.offset ?? '0')
    return case_lambdas.keypoint(keypoint_timestamp + offset)
  } else {
    const result = parse_duration_expr(context, duration_expr)
    if (case_lambdas?.default) {
      return case_lambdas.default(result)
    } else {
      return result
    }
  }
}

function fmt_human_readable_duration(seconds: number) {
  let output = seconds
  let unit = 's'
  if (seconds > 60) {
    output = seconds / 60
    unit = 'm'
  }

  return `${output.toFixed(2)}${unit}`
}


export {
  parse_duration,
  // parse_aspect_ratio,
  // parse_ffmpeg_packet,
  fmt_human_readable_duration,
}

export type { Seconds }
