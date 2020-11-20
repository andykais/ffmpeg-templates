import { InputError } from './errors.ts'

type Seconds = number

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

export { parse_fraction, parse_duration, parse_aspect_ratio, parse_ffmpeg_packet, TIMELINE_ENUMS }
