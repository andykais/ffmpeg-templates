import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.91.0/fs/mod.ts'
import * as flags from 'https://deno.land/std@0.91.0/flags/mod.ts'
import * as yaml from 'https://deno.land/std@0.91.0/encoding/yaml.ts'
import { opn } from "https://denopkg.com/hashrock/deno-opn/opn.ts";
import * as errors from './errors.ts'
import { Logger } from './logger.ts'
import { render_video, render_sample_frame, get_output_locations } from './mod.ts'
import type { Template, RenderOptions, FfmpegProgress } from './mod.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// TODO DRY this up when fonts are added to clips
async function create_loading_placeholder_preview(output_path: string) {
  const proc = Deno.run({
    cmd: [
      'magick',
      '-size',
      '500x500',
      'xc:',
      '-gravity',
      'Center',
      '-pointsize',
      '24',
      '-annotate',
      '0',
      'Loading Preview...',
      output_path,
    ],
  })
  await Deno.mkdir(path.dirname(output_path), { recursive: true })
  const result = await proc.status()
  if (result.code !== 0) {
    // console.error(await proc.output())
    throw new Error('Magick exception')
  }
  return proc
}

function construct_output_folder(args: flags.Args, template_filepath: string) {
  const { dir, name } = path.parse(template_filepath)
  const render_ext = args['preview'] ? '.jpg' : '.mp4'
  return path.join(dir, 'ffmpeg-templates-projects', dir, `${name}`)
}

function human_readable_duration(duration_seconds: number): string {
  if (duration_seconds / 60 >= 100) return `${(duration_seconds / 60 / 60).toFixed(1)}h`
  else if (duration_seconds >= 100) return `${(duration_seconds / 60).toFixed(1)}m`
  else return `${duration_seconds.toFixed(0)}s`
}

let writing_progress_bar = false
let queued_progress: { execution_start_time: number; percentage: number } | null = null
async function progress_callback(execution_start_time: number, percentage: number) {
  if (writing_progress_bar) {
    queued_progress = { execution_start_time, percentage }
    return
  }
  writing_progress_bar = true
  const console_width = await Deno.consoleSize(Deno.stdout.rid).columns
  // const unicode_bar = '\u2588'
  const unicode_bar = '#'
  const execution_time_seconds = (performance.now() - execution_start_time) / 1000
  const prefix = `${human_readable_duration(execution_time_seconds).padStart(4)} [`
  const suffix = `] ${(percentage * 100).toFixed(1)}%`
  const total_bar_width = console_width - prefix.length - suffix.length
  const bar = unicode_bar.repeat(Math.min(percentage, 1) * total_bar_width)
  const message = `\r${prefix}${bar.padEnd(total_bar_width, '-')}${suffix}`
  await Deno.writeAll(Deno.stdout, encoder.encode(message))
  writing_progress_bar = false
  if (queued_progress) {
    const args = queued_progress
    queued_progress = null
    progress_callback(args.execution_start_time, args.percentage)
  }
}

async function read_template(template_filepath: string): Promise<Template> {
  const file_contents = decoder.decode(await Deno.readFile(template_filepath))
  let error_messages = []
  try {
    const template: Template = JSON.parse(file_contents)
    return template
  } catch (e) {
    if (e.name !== 'SyntaxError') throw e
    error_messages.push(e.toString())
  }
  try {
    const template: Template = yaml.parse(file_contents) as any
    return template
  } catch (e) {
    if (!['SyntaxError', 'YAMLError'].includes(e.name)) throw e
    error_messages.push(e.toString())
  }
  throw new errors.InputError(`template ${template_filepath} is not valid JSON or YAML\n${error_messages.join('\n')}`)
}

async function try_render_video(
  args: flags.Args,
  logger: Logger,
  template_filepath: string,
  output_folder: string,
  options: RenderOptions
) {
  try {
    options = { ...options }
    const execution_start_time = performance.now()
    if (args['verbose']) {
      options.ffmpeg_verbosity = 'info'
    } else if (!args['quiet']) {
      options.progress_callback = (progress) => progress_callback(execution_start_time, progress)
    }
    const template_input = await read_template(template_filepath)
    const { template, rendered_clips_count } = args['preview']
      ? await render_sample_frame(logger, template_input, output_folder, options)
      : await render_video(logger, template_input, output_folder, options)
    const execution_time_seconds = (performance.now() - execution_start_time) / 1000

    if (!args['preview'] && args['open']) {
      // TODO we cannot open a video renders because deno exits. We need to run a detached process
      // the deno feature is not shipped yet: https://github.com/denoland/deno/issues/5501
    }
    const output_locations = get_output_locations(output_folder)
    if (args['preview']) {
      // prettier-ignore
      logger.info(`created "${output_locations.rendered_preview}" at ${template.preview} out of ${rendered_clips_count} clips in ${execution_time_seconds.toFixed(1)} seconds.`)
    } else {
      // prettier-ignore
      logger.info(`created "${output_locations.rendered_video}" out of ${rendered_clips_count} clips in ${execution_time_seconds.toFixed(1)} seconds.`)
    }
  } catch (e) {
    if (e instanceof errors.InputError) {
      console.error(e)
    } else {
      throw e
    }
  }
}

export default async function (...deno_args: string[]) {
  let args = flags.parse(deno_args)
  if (args['develop']) args = { ...args, watch: true, preview: true, open: true }
  const logger = new Logger('info')
  if (args['quiet']) logger.set_level('error')
  const positional_args = args._.map((a) => a.toString())
  const template_filepath = positional_args[0]
  const output_folder = positional_args[1] ?? construct_output_folder(args, template_filepath)
  await Deno.mkdir(output_folder, { recursive: true })
  const options: RenderOptions = {
    ffmpeg_verbosity: 'error',
    cwd: path.resolve(path.dirname(template_filepath)),
    debug_logs: args['debug'],
  }
  const output_locations = get_output_locations(output_folder)

  if (!(await fs.exists(template_filepath)))
    throw new errors.InputError(`Template file ${template_filepath} does not exist`)
  if (args['preview'] && args['open']) {
    await create_loading_placeholder_preview(output_locations.rendered_preview)
    opn(output_locations.rendered_preview)
  }
  await try_render_video(args, logger, template_filepath, output_folder, options)

  if (args.watch) {
    logger.info(`watching ${template_filepath} for changes`)
    let lock = false
    for await (const event of Deno.watchFs(template_filepath)) {
      if (event.kind === 'modify' && !lock) {
        lock = true
        setTimeout(() => {
          logger.info(`template ${template_filepath} was changed. Starting render.`)
          try_render_video(args, logger, template_filepath, output_folder, options).then(() => {
            lock = false
            logger.info(`watching ${template_filepath} for changes`)
          })
          // assume that all file modifications are completed in 50ms
        }, 50)
      }
    }
  }
}
