import * as path from 'https://deno.land/std@0.75.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.75.0/fs/mod.ts'
import * as flags from 'https://deno.land/std@0.75.0/flags/mod.ts'
import * as yaml from 'https://deno.land/std@0.75.0/encoding/yaml.ts'
import * as errors from './errors.ts'
import { render_video, render_sample_frame } from './mod.ts'
import type { Template, RenderOptions, FfmpegProgress } from './mod.ts'

const VERSION = 'v0.1.0'

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
  const result = await proc.status()
  if (result.code !== 0) {
    // console.error(await proc.output())
    throw new Error('Magick exception')
  }
  return proc
}
function open(filename: string) {
  // TODO handle windows & mac platforms
  // (or wait for the `open` program to be ported to deno https://github.com/sindresorhus/open/issues/212)
  const proc = Deno.run({ cmd: ['xdg-open', filename] })
  return proc
}

function construct_output_filepath(args: flags.Args, template_filepath: string) {
  const { dir, name } = path.parse(template_filepath)
  const render_ext = args['preview'] ? '.jpg' : '.mp4'
  return path.join(dir, `${name}${render_ext}`)
}

function human_readable_duration(duration_seconds: number): string {
  if (duration_seconds / 60 >= 100) return `${(duration_seconds / 60 / 60).toFixed(1)}h`
  else if (duration_seconds >= 100) return `${(duration_seconds / 60).toFixed(1)}m`
  else return `${duration_seconds.toFixed(0)}s`
}

function progress_callback(execution_start_time: number, ffmpeg_progress: FfmpegProgress) {
  const { out_time, progress, percentage } = ffmpeg_progress
  const console_width = Deno.consoleSize(Deno.stdout.rid).columns
  // const unicode_bar = '\u2588'
  const unicode_bar = '#'
  const execution_time_seconds = (performance.now() - execution_start_time) / 1000
  const prefix = `${human_readable_duration(execution_time_seconds).padStart(4)} [`
  const suffix = `] ${(percentage * 100).toFixed(1)}%`
  const total_bar_width = console_width - prefix.length - suffix.length
  const bar = unicode_bar.repeat(Math.min(percentage, 1) * total_bar_width)
  const message = `\r${prefix}${bar.padEnd(total_bar_width, '-')}${suffix}`
  Deno.stdout.write(encoder.encode(message))
}

async function read_template(template_filepath: string): Promise<Template> {
  const file_contents = decoder.decode(await Deno.readFile(template_filepath))
  try {
    const template: Template = JSON.parse(file_contents)
    return template
  } catch (e) {
    if (e.name !== 'SyntaxError') throw e
  }
  try {
    const template: Template = yaml.parse(file_contents) as any
    return template
  } catch (e) {
    if (e.name !== 'SyntaxError') throw e
  }
  throw new errors.InputError(`template ${template_filepath} is not valid JSON or YAML`)
}

async function try_render_video(template_filepath: string, output_filepath: string, options: RenderOptions) {
  try {
    const copied_options = { ...options }
    const execution_start_time = performance.now()
    if (args['verbose']) {
      copied_options.ffmpeg_verbosity = 'info'
    } else if (args['quiet']) {
    } else {
      copied_options.progress_callback = progress => progress_callback(execution_start_time, progress)
    }
    if (!options.overwrite && (await fs.exists(output_filepath))) {
      throw new Error(`Output file ${output_filepath} exists. Use the --overwrite flag to overwrite it.`)
    }
    const template_input = await read_template(template_filepath)
    const rendered_clips_count = args['preview']
      ? await render_sample_frame(template_input, output_filepath, copied_options)
      : await render_video(template_input, output_filepath, copied_options)
    const execution_time_seconds = (performance.now() - execution_start_time) / 1000

    if (!args['preview'] && args['open']) {
      // TODO we cannot open a video renders because deno exits. We need to run a detached process
      // the deno feature is not shipped yet: https://github.com/denoland/deno/issues/5501
    }
    // prettier-ignore
    console.log(`created ${output_filepath} out of ${rendered_clips_count} clips in ${execution_time_seconds.toFixed(1)} seconds.`)
  } catch (e) {
    if (e instanceof errors.InputError) {
      console.error(e)
    } else {
      throw e
    }
  }
}

const args = flags.parse(Deno.args)
if (args._.length < 1 || args._.length > 2 || args['help']) {
  console.error(`ffmpeg-templates ${VERSION}

Usage: ffmpeg-templates <template_filepath> [<output_filepath>] [options]

ARGS:
  <template_filepath>                       Path to a YAML or JSON template file which defines the structure of
                                            the outputted video

  <output_filepath>                         The file that will be outputted by ffmpeg. When not specified, a
                                            file will be created adjacent to the template ending in .mp4.

OPTIONS:
  --preview                                 Instead of outputting the whole video, output a single frame as a jpg.
                                            Use this flag to set up your layouts and iterate quickly.

  --open                                    Open the outputted file after it is rendered.

  --overwrite                               Overwrite an existing output file.

  --watch                                   Run continously when the template file changes. This is most useful
                                            in tandem with --preview.

  --verbose                                 Show ffmpeg logging instead of outputting a progress bar.

  --quiet                                   Do not log anything

  --help                                    Print this message.`)
  Deno.exit(args['help'] ? 0 : 1)
}

const positional_args = args._.map(a => a.toString())
const template_filepath = positional_args[0]
const output_filepath = positional_args[1] ?? construct_output_filepath(args, template_filepath)
const options: RenderOptions = {
  overwrite: Boolean(args['overwrite']),
  ffmpeg_verbosity: 'error',
  cwd: path.resolve(path.dirname(template_filepath)),
}

const output_filepath_is_image = ['.jpg', '.jpeg', '.png'].some(ext => output_filepath.endsWith(ext))
if (args['preview'] && !output_filepath_is_image) {
  throw new Error('Invalid commands. <output_filepath> must be a video filename when rendering video output.')
}
if (!args['preview'] && output_filepath_is_image) {
  throw new Error('Invalid commands. <output_filepath> must be an video filename.')
}

if (args['preview'] && args['open']) {
  await create_loading_placeholder_preview(output_filepath)
  open(output_filepath)
}
await try_render_video(template_filepath, output_filepath, options)

if (args.watch) {
  const watch_options = { ...options, overwrite: true }
  console.log(`watching ${template_filepath} for changes`)
  let lock = false
  for await (const event of Deno.watchFs(template_filepath)) {
    if (event.kind === 'modify' && !lock) {
      lock = true
      setTimeout(() => {
        console.log(`template ${template_filepath} was changed. Starting render.`)
        try_render_video(template_filepath, output_filepath, watch_options).then(() => {
          lock = false
          console.log(`watching ${template_filepath} for changes`)
        })
        // assume that all file modifications are completed in 50ms
      }, 50)
    }
  }
}
