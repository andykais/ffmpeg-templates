import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.91.0/fs/mod.ts'
import * as flags from 'https://deno.land/std@0.91.0/flags/mod.ts'
import * as yaml from 'https://deno.land/std@0.91.0/encoding/yaml.ts'
import { open } from 'https://deno.land/x/open@v0.0.2/index.ts'
import * as errors from './errors.ts'
import { Context } from './context.ts'
import { render_video, render_sample_frame } from './mod.zod.ts'
import { Logger } from './logger.ts'
import type { TemplateParsed } from './parsers/template.zod.ts'
import type { RenderOptions } from './mod.ts'

type CliArgs = ReturnType<typeof parse_cli_args>
function parse_cli_args(deno_args: string[]) {
  let args = flags.parse(deno_args)
  if (args['develop']) args = { ...args, watch: true, preview: true, open: true }
  const positional_args = args._.map((a) => a.toString())
  const template_filepath = positional_args[0]
  const { dir, name } = path.parse(args.template_filepath)
  let output_folder = path.join(dir, 'ffmpeg-templates-projects', dir, `${name}`)
  if (positional_args[1]) output_folder
  return {
     template_filepath,
     output_folder,
     watch: Boolean(args['watch']),
     preview: Boolean(args['preview']),
     quiet: Boolean(args['quiet']),
     open: Boolean(args['open']),
     debug: Boolean(args['debug']),
  }
}

async function try_render_video({ template_filepath, debug }: CliArgs, context: Context) {
  // create context here, w/ execution time. Move progress callback to logger
}

const placeholder_template = { clips: [], captions: [{ text: 'Loading Preview...' }] }
export default async function (...deno_args: string[]) {
  const args = parse_cli_args(deno_args)
  const cwd = path.resolve(path.dirname(args.template_filepath))
  const context = new Context(placeholder_template, args.output_folder, { cwd, ffmpeg_log_cmd: args.debug })
  if (args.quiet) context.logger.set_level('error')
  await Deno.mkdir(args.output_folder, { recursive: true })
  // const output_locations = get_output_locations(output_folder)
  if (!(await fs.exists(args.template_filepath)))
    throw new errors.InputError(`Template file ${args.template_filepath} does not exist`)
  if (args.preview && args.open) {
    // const result = await render_sample_frame()
    // await create_loading_placeholder_preview(output_locations.rendered_preview)
    // opn(output_locations.rendered_preview)
  }
  await try_render_video(args, context)
}
