type LogLevel = 'error' | 'warn' | 'info'

const LEVEL_MAP = { error: 0, warn: 1, info: 2 }

class Logger {
  private level: number = 0
  // progress bar logging state
  private writing_progress_bar = false
  private queued_progress?: { execution_start_time: number; percentage: number }
  private encoder = new TextEncoder()

  public constructor(level: LogLevel) {
    this.set_level(level)
  }

  public error = (...args: any[]) => this.log('error', args, console.error)
  public warn = (...args: any[]) => this.log('warn', args)
  public info = (...args: any[]) => this.log('info', args)

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
