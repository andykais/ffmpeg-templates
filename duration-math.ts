import { parse_duration } from './text_parsers.ts'

if (Deno.args.length !== 2) {
  console.error(`Usage: duration-math <duration> <duration>`)
  Deno.exit(1)
}

const duration_a = parse_duration(Deno.args[0])
const duration_b = parse_duration(Deno.args[1])

const result = duration_a - duration_b
let result_in_seconds = result

const hours = Math.floor(result_in_seconds / (60 * 60))
result_in_seconds -= hours * (60 * 60)
const minutes = Math.floor(result_in_seconds / 60)
result_in_seconds -= minutes * 60
const seconds = result_in_seconds

const hours_str = hours.toString().padStart(2, '0')
const minutes_str = minutes.toString().padStart(2, '0')
const seconds_str = seconds.toString().padStart(2, '0')
let formatted_output = `${hours_str}:${minutes_str}:${seconds_str}`

console.log(duration_a, '+', duration_b, '=', formatted_output)
