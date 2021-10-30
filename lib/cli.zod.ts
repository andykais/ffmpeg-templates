import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.91.0/fs/mod.ts'
import * as flags from 'https://deno.land/std@0.91.0/flags/mod.ts'
import * as yaml from 'https://deno.land/std@0.91.0/encoding/yaml.ts'
import { YAMLError } from 'https://deno.land/std@0.91.0/encoding/_yaml/error.ts'
import { open } from 'https://deno.land/x/open@v0.0.2/index.ts'
import * as errors from './errors.ts'
import { render_video, render_sample_frame } from './mod.zod.ts'
import { Logger } from './logger.ts'
import type * as inputs from './template_input.zod.ts'
import type { ContextOptions } from './context.ts'


function parse_cli_args(deno_args: string[]) {
  let args = flags.parse(deno_args)
  if (args['develop']) args = { ...args, watch: true, preview: true, open: true }
  const positional_args = args._.map((a) => a.toString())
  const template_filepath = positional_args[0]
  const { dir, name } = path.parse(template_filepath)
  let output_folder = path.join(dir, 'ffmpeg-templates-projects', `${name}`)
  if (positional_args[1]) output_folder = positional_args[1]
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


async function read_template(template_filepath: string): Promise<inputs.Template> {
  const decoder = new TextDecoder()
  const file_contents = decoder.decode(await Deno.readFile(template_filepath))
  let error_messages = []
  try {
    return yaml.parse(file_contents) as any
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof YAMLError) error_messages.push(e.toString())
    else throw e
  }
  try {
    return JSON.parse(file_contents)
  } catch (e) {
    if (e instanceof SyntaxError) error_messages.push(e.toString())
    else throw e
  }
  throw new errors.InputError(`template ${template_filepath} is not valid JSON or YAML\n${error_messages.join('\n')}`)
}


async function try_render_video(template_filepath: string, sample_frame: boolean, context_options: ContextOptions) {
  // create context here, w/ execution time. Move progress callback to logger
  try {
    const template_input = await read_template(template_filepath)
    return sample_frame
      ? await render_sample_frame(template_input, context_options)
      : await render_video(template_input, context_options)
  } catch(e) {
    if (e instanceof errors.InputError) console.error(e)
    else throw e
  }
}


async function watch(filepath: string, fn: () => Promise<void>) {
  let lock = false
  for await (const event of Deno.watchFs(filepath)) {
    if (event.kind === 'modify' && lock === false) {
      lock = true
      setTimeout(() => {
        fn().then(() => {
          lock = false
        })
      }, 50) // assume that all file modifications are completed in 50ms
    }
    if (event.kind === 'remove') break
  }
  watch(filepath, fn)
}


export default async function (...deno_args: string[]) {
  const args = parse_cli_args(deno_args)
  const { template_filepath } = args
  const cwd = path.resolve(path.dirname(template_filepath))
  const log_level = args.quiet ? 'error' : 'info'
  const context_options: ContextOptions = { output_folder: args.output_folder, cwd, ffmpeg_log_cmd: args.debug, log_level }
  const logger = new Logger(log_level)
  await Deno.mkdir(args.output_folder, { recursive: true })
  // const output_locations = get_output_locations(output_folder)
  if (!(await fs.exists(template_filepath)))
    throw new errors.InputError(`Template file ${template_filepath} does not exist`)
  if (args.preview && args.open) {
    const placeholder_template = { clips: [], captions: [{ text: 'Loading Preview...' }] }
    const result = await render_sample_frame(placeholder_template, context_options)
    open(result.outputted_files.preview)
  }
  await try_render_video(template_filepath, args.preview, context_options)

  if (args.watch) {
    logger.info(`watching ${template_filepath} for changes`)
    await watch(template_filepath, async () => {
      logger.info(`template ${template_filepath} was changed. Starting render.`)
      await try_render_video(template_filepath, args.preview, context_options)
      logger.info(`watching ${template_filepath} for changes`)
    })
  }
}
