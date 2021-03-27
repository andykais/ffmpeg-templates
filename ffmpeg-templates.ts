import * as flags from 'https://deno.land/std@0.75.0/flags/mod.ts'
import ffmpeg_templates from './lib/cli.ts'


const VERSION = 'v0.2.0'


const args = flags.parse(Deno.args)
if (args._.length < 1 || args._.length > 2 || args['help']) {
  console.error(`ffmpeg-templates ${VERSION}

Usage: ffmpeg-templates <template_filepath> [<output_folder>] [options]

ARGS:
  <template_filepath>                       Path to a YAML or JSON template file which defines the structure of
                                            the outputted video

  <output_folder>                           The folder in which the output and generated assets will be saved to.
                                            When not specified, a folder will be created adjacent to the template.

OPTIONS:
  --preview                                 Instead of outputting the whole video, output a single frame as a jpg.
                                            Use this flag to set up your layouts and iterate quickly.

  --open                                    Open the outputted file after it is rendered.

  --watch                                   Run continously when the template file changes. This is most useful
                                            in tandem with --preview.

  --develop                                 Alias for running "--watch --preview --open"

  --quiet                                   Do not print a progress bar

  --debug                                   Write debug information to a file

  --help                                    Print this message.`)
  Deno.exit(args['help'] ? 0 : 1)
}
await ffmpeg_templates(...Deno.args)
