import type { Seconds } from './mod.ts'
import { InputError } from './errors.ts'

function parse_fraction(fraction: string): number {
  const result = fraction.split('/')
  if (result.length !== 2) throw new InputError(`Invalid fraction "${fraction} specified."`)
  const [numerator, denominator] = result.map(v => parseInt(v))
  if (numerator === NaN || denominator === NaN)
    throw new InputError(`Invalid fraction "${fraction} specified."`)
  return numerator / denominator
}

function parse_duration(duration: string, { user_input = true } = {}): Seconds {
  const duration_split = duration.split(':')
  if (duration_split.length !== 3) {
    if (user_input) throw new InputError(`Invalid duration "${duration}". Cannot parse`)
    else throw new Error(`Invalid duration "${duration}". Cannot parse`)
  }
  const [hours, minutes, seconds] = duration_split.map(v => parseFloat(v))
  return hours * 60 * 60 + minutes * 60 + seconds
}

const TIMELINE_ENUMS = {
  PAD: 'PAD',
} as const
const duration = `[0-9]{2}:[0-9]{2}:[0-9]{2}(.[0-9]+)?`
const layer_id = `[A-Za-z0-9_-]+`
const dot = `[.]*`
const line_by_line_re = new RegExp(`${dot}\[${dot}(${layer_id}|${duration})${dot}\]${dot}`, 'gy')
type LayerID = string
type Timeline = (LayerID | keyof typeof TIMELINE_ENUMS | Seconds)[]
function parse_timeline_dsl(timeline_str: string) {
  return timeline_str
    .trim()
    .split('\n')
    .map(line => line.trim())
    .map((line, i) => {
      const match = line.matchAll(line_by_line_re)
      if (match === null) throw new Error(`Timeline parse failed at line ${i + 1}`)
      let covered_line_length = 0
      const clips = [...match].map((m, j) => {
        if (m[0] === undefined) throw new InputError(`Timeline parse failed at line ${i + 1}, clip ${j + 1}`)
        if (m[1] === undefined) throw new InputError(`Timeline parse failed at line ${i + 1}, clip ${j + 1}`)
        covered_line_length += m[0].length
        return m[1]
      })
      if (covered_line_length !== line.length) throw new InputError(`Timeline parse failed at line ${i + 1}`)
      return clips
    })
    .map(clips =>
      clips.map(clip => {
        try {
          return parse_duration(clip)
        } catch (e) {
          // if we cant parse it as a duration, assume it is a layer id
          if (e instanceof InputError) return clip
          else throw e
        }
      })
    )
}

// const res = parse_timeline_dsl(`
// [PAD][00:00:05][LAYER_0]
// [LAYER_1...............]
// ..[PAD][00:00:05.40..]..[LAYER_0]  
// [LAYER_1..............]

// `)
// console.log(res)

export { parse_fraction, parse_duration, parse_timeline_dsl, TIMELINE_ENUMS }
