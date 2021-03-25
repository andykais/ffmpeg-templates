import * as io from 'https://deno.land/std@0.75.0/io/mod.ts'
import { InputError, CommandError } from '../errors.ts'
import { parse_duration } from '../parsers/duration.ts'
import type { ClipID } from '../template_input.ts'
import type { TemplateParsed } from '../parsers/template.ts'
import type { Timestamp } from '../template_input.ts'

type OnReadLine = (line: string) => void
async function exec(cmd: string[], readline_cb?: OnReadLine) {
  const decoder = new TextDecoder()
  const proc = Deno.run({ cmd, stdout: 'piped' })
  if (readline_cb) {
    for await (const line of io.readLines(proc.stdout)) {
      readline_cb(line)
    }
  }
  const result = await proc.status()
  const output_buffer = await proc.output()
  const output = decoder.decode(output_buffer)
  await proc.close()
  if (result.success) {
    return output
  } else {
    throw new CommandError(`Command "${cmd.join(' ')}" failed.\n\n${output}`)
  }
}

// NOTE atempo cannot exceed the range of 0.5 to 100.0. To get around this, we need to string multiple atempo calls together.
// Example provided here: https://trac.ffmpeg.org/wiki/How%20to%20speed%20up%20/%20slow%20down%20a%20video
function compute_tempo(val: number) {
  const numMultipliers =
    val > 1 ? Math.ceil(Math.log(val) / Math.log(2)) : Math.ceil(Math.log(val) / Math.log(0.5))
  const multVal = Math.pow(Math.E, Math.log(val) / numMultipliers)
  return Array(numMultipliers).fill(`atempo=${multVal}`).join(',')
}

type FfmpegProgress = {
  out_time: Timestamp
  progress: 'continue' | 'end'
  speed: string
  percentage: number
}
type OnProgress = (progress: FfmpegProgress) => void
async function ffmpeg(
  template: TemplateParsed,
  ffmpeg_cmd: (string | number)[],
  longest_duration: number,
  progress_callback?: OnProgress
) {
  const ffmpeg_safe_cmd = ffmpeg_cmd.map((a) => a.toString())
  if (progress_callback) {
    ffmpeg_safe_cmd.push('-progress', 'pipe:1')
    const proc = Deno.run({ cmd: ffmpeg_safe_cmd, stdout: 'piped', stdin: 'inherit' })
    let progress: Partial<FfmpegProgress> = {}
    for await (const line of io.readLines(proc.stdout!)) {
      const [key, value] = line.split('=')
      ;(progress as any)[key] = value
      if (key === 'progress') {
        progress.percentage =
          value === 'end' ? 1 : parse_duration(progress.out_time!, template) / longest_duration
        // sometimes ffmpeg has a negative out_time. I do not know what this means yet
        if (progress.percentage < 0) progress.percentage = 0
        progress_callback(progress as FfmpegProgress)
        progress = {}
      }
    }
    const result = await proc.status()
    if (!result.success) {
      throw new CommandError(`Command "${ffmpeg_safe_cmd.join(' ')}" failed.\n\n`)
    }
    await proc.close()
  } else {
    await exec(ffmpeg_safe_cmd)
  }
}

export { ffmpeg }
export type { OnProgress, FfmpegProgress }
