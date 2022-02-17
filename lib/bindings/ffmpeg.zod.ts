import * as io from 'https://deno.land/std@0.91.0/io/mod.ts'
import { InputError, CommandError } from '../errors.ts'
import { parse_duration } from '../parsers/duration.ts'
import type { Context } from '../context.ts'
import type { Timestamp } from '../template_input.ts'

type OnReadLine = (line: string) => void
async function exec(cmd: string[]) {
  const decoder = new TextDecoder()
  const proc = Deno.run({ cmd, stdout: 'piped' })
  const result = await proc.status()
  const output_buffer = await proc.output()
  const output = decoder.decode(output_buffer)
  // await proc.stdout.close()
  // await proc.close()
  if (result.success) {
    return output
  } else {
    throw new CommandError(`Command "${cmd.join(' ')}" failed.\n\n${output}`)
  }
}

type FfmpegProgress = {
  out_time: Timestamp
  progress: 'continue' | 'end'
  speed: string
  percentage: number
}
type OnProgress = (percentage: number) => void
async function ffmpeg(
  context: Context,
  ffmpeg_cmd: (string | number)[],
  longest_duration: number,
) {
  const ffmpeg_safe_cmd = ffmpeg_cmd.map((a) => a.toString())
  // if (context.log_progress) {
  //   ffmpeg_safe_cmd.push('-progress', 'pipe:1')
  //   const proc = Deno.run({ cmd: ffmpeg_safe_cmd, stdout: 'piped', stdin: 'inherit' })
  //   let progress: Partial<FfmpegProgress> = {}
  //   for await (const line of io.readLines(proc.stdout!)) {
  //     const [key, value] = line.split('=')
  //     ;(progress as any)[key] = value
  //     if (key === 'progress') {
  //       const ffmpeg_percentage = parse_duration(progress.out_time!, {} as any) / longest_duration
  //       const percentage = Math.max(0, Math.min(1, ffmpeg_percentage))
  //       // context.log_ffmpeg_progress(percentage)
  //       progress = {}
  //     }
  //   }
  //   const result = await proc.status()
  //   await proc.stdout.close()
  //   await proc.close()
  //   if (!result.success) {
  //     throw new CommandError(`Command "${ffmpeg_safe_cmd.join(' ')}" failed.\n\n`)
  //   }
  // } else {
    await exec(ffmpeg_safe_cmd)
  // }
}

export { ffmpeg }
export type { OnProgress, FfmpegProgress }
