import * as flags from 'https://deno.land/std@0.75.0/flags/mod.ts'
import * as errors from './errors.ts'
import { render_video } from './mod.ts'

async function try_render_video(template_filepath: string, output_filepath: string) {
  try {
    console.log('rendering...')
    await render_video(template_filepath, output_filepath, {
      render_sample_frame: args['render-sample-frame'],
      overwrite: Boolean(args['overwrite']),
      ffmpeg_verbosity: args['verbose'] ? 'info' : 'error'
    })
    console.log('ffmpeg command complete.')
  } catch (e) {
    if ([errors.InputError].some(eClass => e instanceof eClass)) {
      console.error(e)
    } else {
      throw e
    }
  }
}

const args = flags.parse(Deno.args)
if (args._.length !== 2) {
  console.error(`splitscreen-templates v0.1.0

Usage: splitscreen-templates <template> <output_filepath> [options]

OPTIONS:
  --render-sample-frame <timestamp>         Instead of outputting the whole video, output a single frame as a jpg.
                                            Use this flag to set up your layouts and iterate quickly. Note that
                                            you must change <output_filepath> to be an image filename (e.g. frame.jpg).

  --overwrite                               Overwrite an existing output file

  --watch                                   Run continously when the template file changes. This is most useful
                                            in tandem with --render-sample-frame

  --verbose                                 Include ffmpeg logging`)
  Deno.exit(1)
}

const [template_filepath, output_filepath] = Deno.args
const output_filepath_is_image = ['.jpg', '.jpeg', '.png'].some(ext =>
  output_filepath.endsWith(ext)
)
if (args['render-sample-frame'] && !output_filepath_is_image) {
  throw new Error(
    'Invalid commands. <output_filepath> must be a video filename when rendering video output.'
  )
}
if (!args['render-sample-frame'] && output_filepath_is_image) {
  throw new Error(
    'Invalid commands. <output_filepath> must be an image filename when using --render-sample-frame.'
  )
}

await try_render_video(template_filepath, output_filepath)

if (args.watch) {
  let lock = false
  for await (const event of Deno.watchFs(template_filepath)) {
    if (event.kind === 'modify' && !lock) {
      lock = true
      try_render_video(template_filepath, output_filepath).then(() => {
        lock = false
      })
    }
  }
}
