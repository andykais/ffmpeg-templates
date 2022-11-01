import * as io from 'https://deno.land/std@0.91.0/io/mod.ts'
import { InputError, CommandError } from '../errors.ts'
import { parse_duration } from '../parsers/duration.ts'
import type { Context } from '../context.ts'
import type { Timestamp } from '../template_input.ts'

type OnReadLine = (line: string) => void
async function exec(cmd: string[]) {
  const decoder = new TextDecoder()
  const proc = Deno.run({ cmd, stdout: 'piped', stderr: 'piped' })
  try {
    const result = await proc.status()
    const output_buffer = await proc.output()
    const output = decoder.decode(output_buffer)
    if (result.success) {
      return output
    } else {
      const stderr = decoder.decode(await proc.stderrOutput())
      throw new CommandError(`Command "${cmd.join(' ')}" failed.\n\n${output}\n$${stderr}`)
    }
  } catch (e) {

  } finally {
    proc.stderr.close()
    proc.close()
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
  if (context.logger.can_log('info')) {
    ffmpeg_safe_cmd.push('-progress', 'pipe:1')
    const proc = Deno.run({ cmd: ffmpeg_safe_cmd, stdout: 'piped', stdin: 'inherit' })
    let progress: Partial<FfmpegProgress> = {}
    for await (const line of io.readLines(proc.stdout!)) {
      const split_index = line.indexOf('=')
      const key = line.slice(0, split_index)
      const value = line.slice(split_index + 1)
      // const [key, value] = line.split('=')
      ;(progress as any)[key] = value
      if (key === 'progress') {
        const ffmpeg_percentage = parse_duration(progress.out_time!, {} as any) / longest_duration
        const percentage = Math.max(0, Math.min(1, ffmpeg_percentage))
        await context.logger.progress(context.execution_start_time, percentage)
        progress = {}
      }
    }
    const result = await proc.status()
    await proc.stdout.close()
    await proc.close()
    await context.logger.progress(context.execution_start_time, 1)
    if (result.success === false) {
      throw new CommandError(`Command "${ffmpeg_safe_cmd.join(' ')}" failed.\n\n`)
    }
  } else {
    await exec(ffmpeg_safe_cmd)
  }
}

export { ffmpeg }
export type { OnProgress, FfmpegProgress }
