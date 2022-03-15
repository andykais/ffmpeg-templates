import { fmt_human_readable_duration } from './parsers/duration.zod.ts'

type LogLevel = 'error' | 'warn' | 'info'

const LEVEL_MAP = { error: 0, warn: 1, info: 2 }

class Logger {
  private level: number = 0
  // progress bar logging state
  // private writing_progress_bar = false
  // private queued_progress?: { execution_start_time: number; percentage: number }
  private encoder = new TextEncoder()

  public constructor(level: LogLevel) {
    this.set_level(level)
  }

  public error = (...args: any[]) => this.log('error', args, console.error)
  public warn = (...args: any[]) => this.log('warn', args)
  public info = (...args: any[]) => this.log('info', args)

  private writing_progress_bar = false
  private queued_progress: { execution_start_time: number; percentage: number } | null = null
  public async progress(execution_start_time: number, percentage: number) {
    if (this.writing_progress_bar) {
      this.queued_progress = { execution_start_time, percentage }
      return
    }
    this.writing_progress_bar = true
    const console_width = await Deno.consoleSize(Deno.stdout.rid).columns
    // const unicode_bar = '\u2588'
    const unicode_bar = '#'
    const execution_time_seconds = (performance.now() - execution_start_time) / 1000
    const prefix = `${fmt_human_readable_duration(execution_time_seconds).padStart(4)} [`
    const suffix = `] ${(percentage * 100).toFixed(1)}%`
    const total_bar_width = console_width - prefix.length - suffix.length
    const bar = unicode_bar.repeat(Math.min(percentage, 1) * total_bar_width)
    const message = `\r${prefix}${bar.padEnd(total_bar_width, '-')}${suffix}`
    await Deno.writeAll(Deno.stdout, this.encoder.encode(message))
    this.writing_progress_bar = false
    if (this.queued_progress) {
      const args = this.queued_progress
      this.queued_progress = null
      this.progress(args.execution_start_time, args.percentage)
    }
  }

  public set_level(level: LogLevel) {
    this.level = LEVEL_MAP[level]
  }

  public can_log(level: LogLevel) {
    return this.level >= LEVEL_MAP[level]
  }

  private log(level: LogLevel, message: any[], writer = console.log) {
    if (this.can_log(level)) writer(...message)
  }
}

export { Logger }
export type { LogLevel }
