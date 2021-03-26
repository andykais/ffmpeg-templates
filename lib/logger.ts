type LogLevel = 'error' | 'warn' | 'info'

const LEVEL_MAP = { error: 0, warn: 1, info: 2 }

function human_readable_duration(duration_seconds: number): string {
  if (duration_seconds / 60 >= 100) return `${(duration_seconds / 60 / 60).toFixed(1)}h`
  else if (duration_seconds >= 100) return `${(duration_seconds / 60).toFixed(1)}m`
  else return `${duration_seconds.toFixed(0)}s`
}

class Logger {
  private level: number = 0
  // progress bar logging state
  private writing_progress_bar = false
  private queued_progress?: { execution_start_time: number; percentage: number }
  private encoder = new TextEncoder()

  public constructor(level: LogLevel) {
    this.set_level(level)
  }

  public error = this.log('error', console.error)
  public warn = this.log('warn')
  public info = this.log('info')

  // TBD
  public async progress_bar(execution_start_time: number, percentage: number) {
    // let writing_progress_bar = false
    // let queued: { execution_start_time: number; ffmpeg_progress: FfmpegProgress } | null = null
    // async function progress_callback(execution_start_time: number, ffmpeg_progress: FfmpegProgress) {
    if (this.writing_progress_bar) {
      this.queued_progress = { execution_start_time, percentage }
      return
    }
    this.writing_progress_bar = true
    // const { out_time, progress, percentage } = ffmpeg_progress
    const console_width = await Deno.consoleSize(Deno.stdout.rid).columns
    // const unicode_bar = '\u2588'
    const unicode_bar = '#'
    const execution_time_seconds = (performance.now() - execution_start_time) / 1000
    const prefix = `${human_readable_duration(execution_time_seconds).padStart(4)} [`
    const suffix = `] ${(percentage * 100).toFixed(1)}%`
    const total_bar_width = console_width - prefix.length - suffix.length
    const bar = unicode_bar.repeat(Math.min(percentage, 1) * total_bar_width)
    const message = `\r${prefix}${bar.padEnd(total_bar_width, '-')}${suffix}`
    await Deno.writeAll(Deno.stdout, this.encoder.encode(message))
    this.writing_progress_bar = false
    if (this.queued_progress) {
      const { execution_start_time, percentage } = this.queued_progress
      this.queued_progress = undefined
      this.progress_bar(execution_start_time, percentage)
      // }
    }
  }

  public set_level(level: LogLevel) {
    this.level = LEVEL_MAP[level]
  }

  public can_log(level: LogLevel) {
    return this.level >= LEVEL_MAP[level]
  }

  private log(level: LogLevel, writer = console.log) {
    if (this.can_log(level)) return writer
    else return () => {}
  }
}

export { Logger }
