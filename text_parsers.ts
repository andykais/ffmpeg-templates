import { InputError } from './errors.ts'
import type { TemplateParsed } from './mod.ts'

type Seconds = number

function parse_percentage(percentage: string): number {
  if (percentage.endsWith('%')) {
    const percent = parseFloat(percentage.substr(0, percentage.length - 1))
    if (!Number.isNaN(percent)) {
      return percent / 100
    }
  }
  throw new InputError(`Invalid percentage "${percentage}"`)
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
    if (e instanceof InputError == false) throw e
  }

  try {
    return (post_processors?.pixels ?? (p => p))(parse_pixels(value))
  } catch (e) {
    if (e instanceof InputError == false) throw e
  }
  throw new InputError(`Value "${value}" is neither a percentage or pixels`)
}

// TODO add math expressions. These should be valid:
// "00:00:00,0000"
// "00:00:00.0000"
// "00:00:00.0000 - 00:00:00"
// "00:00:03.0000 - 00:00:01.1 - 00:00:00.5"
// "00:00:03.0000 + {CLIP_0.trim.start}"
const duration_var_regex = /\{[a-zA-Z0-9._-]+\}/
function parse_duration(duration_expr: string, template: TemplateParsed): Seconds {
  try {
    const [duration, operator, expr] = duration_expr
      .trim()
      .split(' ')
      .map(s => s.trim())
    let duration_in_seconds = 0
    if (duration_var_regex.test(duration)) {
      const duration_var = duration.substring(1, duration.length - 1)
      const [clip_id, ...field] = duration_var.split('.')
      const clip = template.clips.find(c => c.id === clip_id)
      if (clip) {
        const duration_field_hopefully = field.reduce((obj: any, key) => obj[key], clip)
        // TODO include probed durations eventually
        if (duration_field_hopefully) {
          duration_in_seconds = parse_duration(duration_field_hopefully, template)
        } else {
          throw new InputError(
            `Invalid duration "${duration}". Specified clip field for clip "${clip_id}" is undefined`
          )
        }
      } else throw new InputError(`Invalid duration "${duration}". Cannot find clip "${clip_id}"`)
    } else {
      const duration_split = duration.split(':')
      if (duration_split.length !== 3) throw new InputError(`Invalid duration "${duration}". Cannot parse`)
      // support vlc millisecond notation as well (00:00:00,000)
      const [hours, minutes, seconds] = duration_split.map(v => parseFloat(v.split(/,|\./).join('.')))
      duration_in_seconds = hours * 60 * 60 + minutes * 60 + seconds
    }
    // const duration_split = duration.split(':')
    // if (duration_split.length !== 3) throw new InputError(`Invalid duration "${duration_expr}". Cannot parse`)

    // // support vlc millisecond notation as well (00:00:00,000)
    // const [hours, minutes, seconds] = duration_split.map(v => parseFloat(v.split(/,|\./).join('.')))
    // const duration_in_seconds = hours * 60 * 60 + minutes * 60 + seconds
    if (operator) {
      if (operator && expr) {
        switch (operator) {
          case '+':
            return duration_in_seconds + parse_duration(expr, template)
          case '-':
            return duration_in_seconds - parse_duration(expr, template)
          case '/':
            return duration_in_seconds / parse_duration(expr, template)
          case '*':
            return duration_in_seconds * parse_duration(expr, template)
          default:
            throw new InputError(
              `Invalid duration "${duration_expr}". Expected "+,-,/,*" where "${operator}" was`
            )
        }
      } else {
        throw new InputError(
          `Invalid duration "${duration_expr}". Expected <duration> <operator> <duration_expr>`
        )
      }
    } else {
      return duration_in_seconds
    }
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
