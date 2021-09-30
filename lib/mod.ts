import * as io from 'https://deno.land/std@0.91.0/io/mod.ts'
import * as fs from 'https://deno.land/std@0.91.0/fs/mod.ts'
import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as math from './float_math.ts'
import { ProbeError, CommandError, InputError } from './errors.ts'
import { parse_duration } from './parsers/duration.ts'
import { parse_percentage } from './parsers/unit.ts'
import { parse_template } from './parsers/template.ts'
import { probe_clips } from './probe.ts'
import { compute_geometry, compute_background_size, compute_rotated_size } from './geometry.ts'
import { compute_zoompans } from './zoompan.ts'
import { compute_timeline } from './timeline.ts'
import { replace_font_clips_with_image_clips } from './font.ts'
import { ffmpeg } from './bindings/ffmpeg.ts'
import { get_hardware_acceleration_options } from './bindings/detect_hardware_acceleration.ts'
import type { Logger } from './logger.ts'
import type * as template_input from './template_input.ts'
import type * as template_parsed from './parsers/template.ts'
import type { ClipGeometryMap } from './geometry.ts'
import type { ClipInfoMap } from './probe.ts'
import type { OnProgress, FfmpegProgress } from './bindings/ffmpeg.ts'

const decoder = new TextDecoder()

interface OutputLocations {
  rendered_preview: string
  rendered_video: string
  generated_text_folder: string
  generated_zoompan_preview: string
  debug_ffmpeg: string
}

function get_output_locations(output_folder: string): OutputLocations {
  return {
    rendered_preview: path.join(output_folder, 'preview.jpg'),
    rendered_video: path.join(output_folder, 'output.mp4'),
    generated_text_folder: path.join(output_folder, 'text_clips/'),
    generated_zoompan_preview: path.join(output_folder, 'zoompan.jpg'),
    debug_ffmpeg: path.join(output_folder, 'ffmpeg.sh'),
  }
}

// NOTE atempo cannot exceed the range of 0.5 to 100.0. To get around this, we need to string multiple atempo calls together.
// Example provided here: https://trac.ffmpeg.org/wiki/How%20to%20speed%20up%20/%20slow%20down%20a%20video
function compute_tempo(val: number) {
  const numMultipliers =
    val > 1 ? Math.ceil(Math.log(val) / Math.log(2)) : Math.ceil(Math.log(val) / Math.log(0.5))
  const multVal = Math.pow(Math.E, Math.log(val) / numMultipliers)
  return Array(numMultipliers).fill(`atempo=${multVal}`).join(',')
}

interface RenderOptions {
  ffmpeg_verbosity?: 'quiet' | 'error' | 'warning' | 'info' | 'debug'
  debug_logs?: boolean
  progress_callback?: OnProgress
  cwd?: string
}
interface RenderOptionsInternal extends RenderOptions {
  render_sample_frame?: boolean
}
async function render(
  logger: Logger,
  input: template_input.Template,
  output_folder: string,
  options?: RenderOptionsInternal
): Promise<{ template: template_parsed.Template; rendered_clips_count: number }> {
  const cwd = options?.cwd ?? Deno.cwd()
  const template = parse_template(input, cwd)
  const output_locations = get_output_locations(output_folder)

  const sample_frame = options?.render_sample_frame ? parse_duration(template.preview, template) : undefined

  const [clip_info_map] = await Promise.all([
    //   get_hardware_acceleration_options(),
    probe_clips(logger, template, template.clips),
    Deno.mkdir(output_folder, { recursive: true }),
  ])
  const { background_width, background_height } = compute_background_size(template, clip_info_map)
  const clips: template_parsed.MediaClip[] = await replace_font_clips_with_image_clips(
    logger,
    template,
    background_width,
    background_height,
    clip_info_map,
    cwd
  )
  const clip_geometry_map = compute_geometry(template, background_width, background_height, clip_info_map)
  const clip_zoompan_map = compute_zoompans(template, clip_info_map, clip_geometry_map)
  const { timeline, total_duration } = compute_timeline(template, clip_info_map)
  if (sample_frame === undefined)
  logger.info(`Rendering ${total_duration}s long output`)

  const complex_filter_inputs = [
    `color=s=${background_width}x${background_height}:color=black:duration=${total_duration}[base]`,
  ]
  const complex_filter_overlays: string[] = []
  const audio_input_ids: string[] = []
  const ffmpeg_cmd: (string | number)[] = ['ffmpeg', '-v', options?.ffmpeg_verbosity ?? 'info']

  let last_clip = '[base]'
  let input_index = 0

  for (const i of timeline.keys()) {
    const { clip_id, start_at, trim_start, duration, speed } = timeline[i]

    // we dont care about clips that do not involve the sample frame
    if (options?.render_sample_frame && !(start_at <= sample_frame! && start_at + duration >= sample_frame!))
      continue

    const clip = clips.find((c) => c.id === clip_id)!
    const info = clip_info_map.get_or_else(clip_id)
    const geometry = clip_geometry_map.get_or_else(clip_id)
    const zoompans = clip_zoompan_map.get_or_else(clip_id)

    const video_input_filters = []
    if (!options?.render_sample_frame) {
      // TODO we should show a half-transitioned video if we can in the preview. It may require previews
      // coming from a result rather than shifting everything. Or just adding a psuedo fade filter for
      // previews
      if (clip.transition?.fade_in) {
        const transition_duration = parse_duration(clip.transition.fade_in, template)
        video_input_filters.push(`fade=t=in:st=0:d=${transition_duration}:alpha=1`)
      }
      if (clip.transition?.fade_out) {
        const transition_duration = parse_duration(clip.transition.fade_out, template)
        video_input_filters.push(
          `fade=t=out:st=${duration - transition_duration}:d=${transition_duration}:alpha=1`
        )
      }
    }
    const pts_speed = clip.speed ? `${1 / parse_percentage(clip.speed)}*` : ''
    const setpts =
      start_at === 0 || options?.render_sample_frame
        ? `setpts=${pts_speed}PTS-STARTPTS`
        : `setpts=${pts_speed}PTS+${start_at}/TB`
    const vscale = `scale=${geometry.scale.width}:${geometry.scale.height}`

    const framerate = clip.framerate?.fps ?? info.framerate
    if (clip.framerate?.smooth) {
      // TODO only do this if the info.framerate * speed is lower than the framerate.fps
      video_input_filters.push(`minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=${framerate}'`)
      // this is the slowest, but most effective
      // video_input_filters.push(`minterpolate='mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=:fps=${clip.framerate.fps}'`)
      // video_input_filters.push(`minterpolate='mi_mode=blend:fps=${clip.framerate.fps}'`)
    }

    if (clip.speed && parse_percentage(clip.speed) < 1) {
      // TODO drop frames as necessary from the input
    }

    video_input_filters.push(setpts, vscale)
    if (geometry.rotate) {
      const { degrees, width, height } = geometry.rotate
      video_input_filters.push(`rotate=${degrees}*PI/180:fillcolor=black@0:out_w=${width}:out_h=${height}`)
    }
    if (geometry.crop) {
      const { crop } = geometry
      let crop_x = crop.x.toString()
      let crop_y = crop.y.toString()

      for (const i of zoompans.keys()) {
        const zoompan = zoompans[i]
        if (zoompan.dest_x !== undefined && zoompan.x_expression !== undefined) {
          crop_x = `if(between(t, ${zoompan.start_at_seconds}, ${zoompan.end_at_seconds}), ${zoompan.x_expression}, ${crop_x})`
          if (i === zoompans.length - 1) {
            crop_x = `if(gte(t, ${zoompan.end_at_seconds}), ${zoompan.dest_x}, ${crop_x})`
          }
        }
        if (zoompan.dest_y !== undefined && zoompan.y_expression !== undefined) {
          crop_y = `if(between(t, ${zoompan.start_at_seconds}, ${zoompan.end_at_seconds}), ${zoompan.y_expression}, ${crop_y})`
          if (i === zoompans.length - 1) {
            crop_y = `if(gte(t, ${zoompan.end_at_seconds}), ${zoompan.dest_y}, ${crop_y})`
          }
        }
      }
      function eval_in_context(t: number, crop_expr: string) {
        const n = t * info.framerate
        const eval_expr = crop_expr.replace(/if/g, 'if_eval')
        const between = (t: number, start: number, stop: number) => t >= start && t <= stop
        const if_eval = (expr: string, then_ret: string, else_ret: string) => eval(expr) ? then_ret : else_ret
        const gte = (t: number, start: number) => t >= start
        return eval(eval_expr)
      }
      if (sample_frame !== undefined) {
        crop_x = eval_in_context(sample_frame, crop_x)
        crop_y = eval_in_context(sample_frame, crop_y)
      }

      video_input_filters.push(
        `crop=w=${crop.width}:h=${crop.height}:x='${crop_x}':y='${crop.y}':keep_aspect=1`
      )
    }

    complex_filter_inputs.push(`[${input_index}:v] ${video_input_filters.join(', ')} [v_in_${input_index}]`)
    if (!options?.render_sample_frame && info.has_audio) {
      const audio_filters: string[] = [
        `asetpts=PTS-STARTPTS`,
        // `atrim=0:${duration * speed}`,
        `adelay=${start_at * 1000}:all=1`,
        `volume=${clip.audio_volume ?? 1}`, // TODO use anullsink for audio_volume === 0 to avoid extra processing
      ]
      const atempo = compute_tempo(speed)
      // a.k.a. speed == 1
      if (atempo !== '') audio_filters.push(atempo)
      if (clip.transition?.fade_in) {
        const transition_duration = parse_duration(clip.transition.fade_in, template)
        audio_filters.push(`afade=t=in:st=${start_at}:d=${transition_duration}`)
      }
      if (clip.transition?.fade_out) {
        const transition_duration = parse_duration(clip.transition.fade_out, template)
        audio_filters.push(`afade=t=out:st=${start_at + (duration - transition_duration)}:d=${transition_duration}`)
      }
      complex_filter_inputs.push(`[${input_index}:a] ${audio_filters.join(', ')}[a_in_${input_index}]`)
      audio_input_ids.push(`[a_in_${input_index}]`)
    }
    if (info.type === 'image') {
      ffmpeg_cmd.push('-framerate', framerate, '-loop', 1, '-t', duration, '-i', clip.filepath)
    } else if (info.type === 'video') {
      // if (hw_accel_options) ffmpeg_cmd.push(...hw_accel_options.input_decoder)

      if (options?.render_sample_frame) {
        const trim_start_for_preview = trim_start + sample_frame! - start_at
        ffmpeg_cmd.push('-ss', trim_start_for_preview, '-t', duration, '-i', clip.filepath)
      } else {
        ffmpeg_cmd.push('-ss', trim_start, '-t', duration * speed, '-i', clip.filepath)
      }
    } else if (info.type === 'audio') {
      throw new Error('unimplemented')
    }

    const overlay_filter = `overlay=x=${geometry.x}:y=${geometry.y}:eof_action=pass`
    const current_clip = `[v_out_${input_index}]`
    // if (last_clip) {
    complex_filter_overlays.push(`${last_clip}[v_in_${input_index}] ${overlay_filter} ${current_clip}`)
    // } else {
    //   complex_filter_overlays.push(`[base][v_in_${input_index}] ${overlay_filter} ${current_clip}`)
    // }
    last_clip = current_clip
    input_index++
  }

  if (sample_frame !== undefined) {
    const origin_size = background_width * 0.003
    const arrow_size = (background_width * 0.03) / 15
    const imagemagick_draw_arrows = []
    for (const clip of template.clips) {
      for (const zoompan of clip_zoompan_map.get_or_else(clip.id)) {
        const color = 'hsl(0,   255,   147.5)'
        if (zoompan.start_at_seconds <= sample_frame && zoompan.end_at_seconds > sample_frame) {
          const info = clip_info_map.get_or_else(clip.id)
          const n = sample_frame * info.framerate
          const start_x = background_width / 2
          const start_y = background_height / 2
          const dest_x =
            background_width / 2 +
            (zoompan.dest_x ?? 0) -
            (zoompan.x_expression ? eval(zoompan.x_expression) : 0)
          const dest_y = (zoompan.y_expression ? eval(zoompan.y_expression) : 0) + background_height / 2
          const arrow_angle = (Math.atan((dest_x - start_x) / (dest_y - start_y)) * 180.0) / Math.PI - 90.0
          const arrow_x = dest_x
          const arrow_y = dest_y
          imagemagick_draw_arrows.push(
            `-draw`,
            `stroke ${color} fill ${color} circle ${start_x},${start_y} ${start_x + origin_size},${
              start_y + origin_size
            }`,
            `-draw`,
            `stroke ${color} stroke-linecap round line ${start_x},${start_y} ${dest_x},${dest_y}`,
            `-strokewidth`,
            '10',
            '-draw',
            `stroke ${color} fill ${color}
        translate ${arrow_x},${arrow_y} rotate ${arrow_angle}
        path "M 0,0  l ${-15 * arrow_size},${-5 * arrow_size}  ${+5 * arrow_size},${+5 * arrow_size}  ${
              -5 * arrow_size
            },${+5 * arrow_size}  ${+15 * arrow_size},${-5 * arrow_size} z"`
          )
        }
      }
    }
    if (imagemagick_draw_arrows.length) {
      const zoompan_assets_path = path.join('/tmp/ffmpeg-templates', cwd)
      const zoompan_filepath = path.join(zoompan_assets_path, 'zoompan.png')
      await Deno.mkdir(zoompan_assets_path, { recursive: true })
      const imagemagick_cmd = [
        'convert',
        '-size',
        `${background_width}x${background_height}`,
        'xc:none',
        '-stroke',
        'black',
        '-strokewidth',
        '6',
        ...imagemagick_draw_arrows,
        zoompan_filepath,
      ]
      const proc = Deno.run({ cmd: imagemagick_cmd })
      const result = await proc.status()
      ffmpeg_cmd.push('-framerate', 60, '-loop', 1, '-t', 1, '-i', zoompan_filepath)
      // complex_filter_inputs.push(`[${input_index}:v][v_in_${input_index}]`)
      const overlay_filter = `overlay=x=${0}:y=${0}:eof_action=pass`
      const current_clip = `[v_out_${input_index}]`
      complex_filter_overlays.push(`${last_clip}[${input_index}:v] ${overlay_filter} ${current_clip}`)
      last_clip = current_clip
      input_index++
    }
  }

  const complex_filter = [...complex_filter_inputs, ...complex_filter_overlays]

  const map_audio_arg: string[] = []
  if (options?.render_sample_frame) {
    // we dont care about audio output for sample frame renders
    if (total_duration < sample_frame!) {
      throw new InputError(
        `sample-frame position ${template.preview} is greater than duration of the output (${total_duration})`
      )
    }
    ffmpeg_cmd.push('-vframes', '1')
  } else {
    // ffmpeg_cmd.push('-t', total_duration)
    if (audio_input_ids.length === 0) {
      // do not include audio
    } else if (audio_input_ids.length === 1) {
      map_audio_arg.push('-map', audio_input_ids[0])
    } else {
      const audio_inputs = audio_input_ids.join('')
      complex_filter.push(`${audio_inputs} amix=inputs=${audio_input_ids.length} [audio]`)
      map_audio_arg.push('-map', '[audio]')
    }
    // ffmpeg_cmd.push('-vcodec', 'libx264')
    // ffmpeg_cmd.push('-vcodec', 'libx265')
    // ffmpeg_cmd.push('-x265-params', 'log-level=error')
  }
  // if (hw_accel_options) ffmpeg_cmd.push(...hw_accel_options.filter)
  ffmpeg_cmd.push('-filter_complex', complex_filter.join(';\n'))
  ffmpeg_cmd.push(...map_audio_arg)
  // we may have an output that is just a black screen
  ffmpeg_cmd.push('-map', last_clip)

  // TODO find out what framerates/widths/heights it supports. Also find out why some videos get worse quality
  // using the hardware accelerated codec. Maybe its a crf quality arg problem
  // if (hw_accel_options && !options?.render_sample_frame) ffmpeg_cmd.push(...hw_accel_options.video_encoder)


  // TODO double check that this isnt producing non-error logs on other machines
  // hwaccel cannot be applied when there are no inputs
  // if (last_clip !== '[base]') ffmpeg_cmd.push('-hwaccel', 'auto')
  // ffmpeg_cmd.push('-filter_hw_device', 'auto')

  // ffmpeg_cmd.push('-segment_time', '00:00:05', '-f', 'segment', 'output%03d.mp4')
  ffmpeg_cmd.push(
    options?.render_sample_frame ? output_locations.rendered_preview : output_locations.rendered_video
  )
  // overwriting output files is handled in ffmpeg-templates.ts
  // We can just assume by this point the user is sure they want to write to this file
  ffmpeg_cmd.push('-y')
  if (options?.debug_logs) await write_cmd_to_file(logger, ffmpeg_cmd, output_locations.debug_ffmpeg)

  await ffmpeg(template, ffmpeg_cmd, total_duration, options?.progress_callback)

  return { template, rendered_clips_count: input_index }
}

async function render_video(
  logger: Logger,
  input: template_input.Template,
  output_folder: string,
  options?: RenderOptions
) {
  return await render(logger, input, output_folder, options)
}

async function render_sample_frame(
  logger: Logger,
  input: template_input.Template,
  output_folder: string,
  options?: RenderOptions
) {
  return await render(logger, input, output_folder, { ...options, render_sample_frame: true })
}

async function write_cmd_to_file(logger: Logger, cmd: (string | number)[], filepath: string) {
  const cmd_str = cmd
    .map((c) => c.toString())
    .map((c) => (/[ \/]/.test(c) ? `"${c}"` : c))
    .join(' \\\n  ')

  await Deno.writeTextFile(filepath, cmd_str, { mode: 0o777 })
  logger.info(`Saved ffmpeg command to ${filepath}`)
}

export { render_video, render_sample_frame, get_output_locations }
export * from './template_input.ts'
export type Template = template_parsed.Template
export type {
  // Template,
  // TemplateParsed, // internal type
  // Clip,
  // Pixels,
  // Percentage,
  // Timestamp,
  // ClipID,
  // TimelineEnums,
  RenderOptions,
  FfmpegProgress,
}
