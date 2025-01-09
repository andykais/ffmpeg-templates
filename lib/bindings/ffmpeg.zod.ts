import {readlines} from '../util.ts'
import { InputError, CommandError } from '../errors.ts'
import { parse_duration } from '../parsers/duration.zod.ts'
import type { Context } from '../context.ts'
import type { Timestamp } from '../template_input.zod.ts'

type OnReadLine = (line: string) => void
async function exec(cmd: string[]) {
  const decoder = new TextDecoder()
  // console.log(cmd)
  const proc_cmd = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: 'piped',
    stderr: 'piped',
  })
  try {
    const result = await proc_cmd.output()
    // const output_buffer = await proc.output()
    const output = decoder.decode(result.stdout)
    if (result.success) {
      return output
    } else {
      const stderr = decoder.decode(result.stderr)
      throw new CommandError(`Command "${cmd.join(' ')}" failed.\n\n${output}\n$${stderr}`)
    }
  } catch (e) {
    throw e
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
    const proc_cmd = new Deno.Command(ffmpeg_safe_cmd[0], {
      args: ffmpeg_safe_cmd.slice(1),
      stdout: 'piped',
      stdin: 'inherit',
    })
    const proc = proc_cmd.spawn()
    let progress: Partial<FfmpegProgress> = {}
    for await (const line of readlines(proc.stdout)) {
      const split_index = line.indexOf('=')
      const key = line.slice(0, split_index)
      const value = line.slice(split_index + 1)
      // const [key, value] = line.split('=')
      ;(progress as any)[key] = value
      if (key === 'progress') {
        const ffmpeg_percentage = parse_duration(context, progress.out_time!) / longest_duration
        const percentage = Math.max(0, Math.min(1, ffmpeg_percentage))
        await context.logger.progress(context.execution_start_time, percentage)
        progress = {}
      }
    }
    const result = await proc.status
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
