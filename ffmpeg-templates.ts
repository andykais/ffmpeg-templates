import * as path from 'https://deno.land/std@0.75.0/path/mod.ts'
import * as flags from 'https://deno.land/std@0.75.0/flags/mod.ts'
import * as errors from './errors.ts'
import { render_video, RenderOptions, FfmpegProgress } from './mod.ts'

const encoder = new TextEncoder()

function construct_output_filepath(args: flags.Args, template_filepath: string) {
  const { dir, name } = path.parse(template_filepath)
  const render_ext = args['render-sample-frame'] ? '.jpg' : '.mp4'
  return path.join(dir, `${name}${render_ext}`)
}

// TODO make sure this is always the same length?
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
  // avoid progress bar being longer than 100%. We should probably fix the underlying issue of incorrect durations anyways
  const bar = unicode_bar.repeat(Math.min(percentage, 1) * total_bar_width)
  // const message = `${prefix}${bar.padEnd(total_bar_width, '-')}${suffix}`
  const message = `\r${prefix}${bar.padEnd(total_bar_width, '-')}${suffix}`
  Deno.stdout.write(encoder.encode(message))
}

async function try_render_video(template_filepath: string, output_filepath: string) {
  try {
    const execution_start_time = performance.now()
    const options: RenderOptions = {
      render_sample_frame: args['render-sample-frame'],
      overwrite: Boolean(args['overwrite']),
      ffmpeg_verbosity: 'error',
    }
    if (args['verbose']) {
      options.ffmpeg_verbosity = 'info'
    } else {
      options.progress_callback = progress => progress_callback(execution_start_time, progress)
    }
    const template = await render_video(template_filepath, output_filepath, options)
    const execution_time_seconds = (performance.now() - execution_start_time) / 1000
    // prettier-ignore
    console.log(`created ${output_filepath} out of ${template.layers.length} inputs in ${execution_time_seconds.toFixed(1)} seconds.`)
  } catch (e) {
    if (e instanceof errors.InputError) {
      console.error(e)
    } else {
      throw e
    }
  }
}

const args = flags.parse(Deno.args)
if ((args._.length < 1 && args._.length > 2) || args['help']) {
  console.error(`splitscreen-templates v0.1.0

Usage: splitscreen-templates <template> [output_filepath] [options]

OPTIONS:
  --render-sample-frame <timestamp>         Instead of outputting the whole video, output a single frame as a jpg.
                                            Use this flag to set up your layouts and iterate quickly. Note that
                                            you must change <output_filepath> to be an image filename (e.g. frame.jpg).

  --overwrite                               Overwrite an existing output file.

  --watch                                   Run continously when the template file changes. This is most useful
                                            in tandem with --render-sample-frame.

  --verbose                                 Show ffmpeg logging instead of outputting a progress bar.

  --help                                    Print this message.`)
  Deno.exit(args['help'] ? 0 : 1)
}

const positional_args = args._.map(a => a.toString())
const template_filepath = positional_args[0]
const output_filepath = positional_args[1] ?? construct_output_filepath(args, template_filepath)

const output_filepath_is_image = ['.jpg', '.jpeg', '.png'].some(ext => output_filepath.endsWith(ext))
if (args['render-sample-frame'] && !output_filepath_is_image) {
  throw new Error('Invalid commands. <output_filepath> must be a video filename when rendering video output.')
}
if (!args['render-sample-frame'] && output_filepath_is_image) {
  throw new Error('Invalid commands. <output_filepath> must be an video filename.')
}

await try_render_video(template_filepath, output_filepath)

if (args.watch) {
  console.log(`watching ${template_filepath} for changes`)
  let lock = false
  for await (const event of Deno.watchFs(template_filepath)) {
    if (event.kind === 'modify' && !lock) {
      console.log(`template ${template_filepath} was changed. Starting render.`)
      lock = true
      try_render_video(template_filepath, output_filepath).then(() => {
        lock = false
        console.log(`watching ${template_filepath} for changes`)
      })
    }
  }
}
