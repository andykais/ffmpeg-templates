import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as errors from './errors.ts'
import { parse_unit } from './parsers/unit.ts'
import { parse_template } from './parsers/template.zod.ts'
import { parse_percentage } from './parsers/unit.ts'
import { parse_duration, fmt_human_readable_duration } from './parsers/duration.zod.ts'
import { InstanceContext, Context } from './context.ts'
import { compute_geometry, compute_size, compute_rotated_size } from './geometry.zod.ts'
import { compute_zoompans } from './zoompan.zod.ts'
import { compute_timeline } from './timeline.zod.ts'
import { create_text_image } from './canvas/font.zod.ts'
import { relative_path } from './util.ts'
import type * as inputs from './template_input.zod.ts'
import type * as parsed from './parsers/template.zod.ts'
import type { TimelineClip } from './timeline.zod.ts'
import type { ComputedGeometry } from './geometry.zod.ts'
import type { ClipInfo } from './probe.zod.ts'
import type { ContextOptions } from './context.ts'
import { ffmpeg } from './bindings/ffmpeg.zod.ts'


interface ClipBuilderData {
  id: string
  file: string
  start_at: number
  trim_start: number
  duration: number
  timeline_data: TimelineClip
  framerate: number
  video_input_filters: string[]
  audio_input_filters: string[]
  overlay_filter: string
  probe_info: ClipInfo
}

abstract class FfmpegBuilderBase {
  protected complex_filter_inputs: string[] = []
  protected complex_filter_overlays: string[] = []
  protected audio_links: string[] = []
  private ffmpeg_inputs: string[] = []
  private last_link: string | undefined = undefined
  private verbosity_flag = 'error'
  private input_index = 0
  private clip_data: object[] = []

  private output_framerate: undefined | number = undefined

  public abstract get_output_file(): string

  protected abstract get_vframe_flags(): string[]

  protected abstract input_audio(data: ClipBuilderData, complex_filter_inputs: string[], audio_links: string[], input_index: number): void

  protected abstract map_audio(complex_filter: string[]): string[]

  public abstract clip_builder(clip: inputs.MediaClip, info: ClipInfo): ClipBuilderBase

  public constructor(protected context: Context) {
    this.verbosity_flag = this.context.ffmpeg_log_cmd ? 'info' : 'error'
  }

  public clip_count() { return this.clip_data.length }

  public background_cmd(background_width: number, background_height: number, total_duration: number, background_color?: string) {
    background_color ??= 'black'
    const link = '[base]'
    const filter_input = `color=s=${background_width}x${background_height}:color=${background_color}:duration=${total_duration}`
    this.complex_filter_inputs.push(`${filter_input}${link}`)
    this.last_link = link
  }

  public clip(clip_builder: ClipBuilderBase) {
    const data = clip_builder.build()
    this.clip_data.push(data)
    switch(data.probe_info.type) {
      case 'video':
        this.ffmpeg_inputs.push(
          '-ss', data.trim_start.toString(),
          '-t', data.duration.toString(),
          '-i', data.file,
        )
        break
      case 'image':
        this.ffmpeg_inputs.push(
          '-framerate', data.framerate.toString(),
          '-loop', '1',
          '-t', data.duration.toString(),
          '-i', data.file
        )
        break
      case 'audio':
        throw new errors.InputError('audio file type unsupported')
      default:
        throw new Error(`unknown clip type ${data.probe_info.type}`)
    }
    const current_link = `[v_out_${data.id}]`
    this.complex_filter_inputs.push(`[${this.input_index}:v] ${data.video_input_filters.join(', ')} [v_in_${data.id}]`)
    this.complex_filter_overlays.push(`${this.last_link}[v_in_${data.id}] ${data.overlay_filter} ${current_link}`)
    this.last_link = current_link

    this.input_audio(data, this.complex_filter_inputs, this.audio_links, this.input_index)

    this.output_framerate = Math.max(this.output_framerate ?? 0, data.framerate)

    this.input_index++
  }

  build() {
    if (this.last_link === undefined) throw new Error('at least one filter must be specified')
    const complex_filter = [...this.complex_filter_inputs, ...this.complex_filter_overlays]

    const map_audio_flags = this.map_audio(complex_filter)

    return [
      'ffmpeg',
      '-loglevel', this.verbosity_flag,
      ...this.ffmpeg_inputs,
      ...this.get_vframe_flags(),
      '-filter_complex', complex_filter.join(';\n'),
      '-r', (this.output_framerate ?? 60).toString(),
      '-map', this.last_link,
      ...map_audio_flags,
      this.get_output_file(),
      '-y'
    ]
  }

  async write_ffmpeg_cmd(filepath: string) {
    const ffmpeg_cmd = this.build()
    const cmd_str = ffmpeg_cmd
      .map((c) => c.toString())
      .map((c) => (/[ \/]/.test(c) ? `"${c}"` : c))
      .join(' \\\n  ')
    await Deno.writeTextFile(filepath, cmd_str, { mode: 0o777 })
    this.context.logger.info(`Saved ffmpeg command to ${relative_path(filepath)}`)
  }
}

class FfmpegVideoBuilder extends FfmpegBuilderBase {
  protected get_vframe_flags() { return [] }
  public clip_builder(clip: parsed.MediaClipParsed, info: ClipInfo) { return new ClipVideoBuilder(clip, info) }

  protected input_audio(data: ClipBuilderData, complex_filter_inputs: string[], audio_links: string[], input_index: number) {
    if (data.probe_info.has_audio) {
      complex_filter_inputs.push(`[${input_index}:a] ${data.audio_input_filters.join(', ')} [a_in_${data.id}]`)
      audio_links.push(`[a_in_${data.id}]`)
    }
  }

  protected map_audio(complex_filter: string[]) {
    const map_audio_flags = []
    if (this.audio_links.length === 0) {
      // do not include audio
    } else if (this.audio_links.length === 1) {
      map_audio_flags.push('-map', this.audio_links[0]) 
    } else {
      complex_filter.push(`${this.audio_links.join('')} amix=inputs=${this.audio_links.length} [audio]`)
      map_audio_flags.push('-map', '[audio]')
    }

    return map_audio_flags
  }

  public get_output_file() {
    return path.join(this.context.output_folder, 'output.mp4')
  }
}

class FfmpegSampleBuilder extends FfmpegBuilderBase {
  protected get_vframe_flags() { return ['-vframes', '1'] }
  protected sample_frame: number

  public constructor(context: Context) {
    super(context)
    this.sample_frame = parse_duration(context, context.template.preview)
  }
  public clip_builder(clip: parsed.MediaClipParsed, info: ClipInfo) { return new ClipSampleBuilder(clip, info, this.sample_frame) }

  protected input_audio(data: ClipBuilderData, complex_filter_inputs: string[], audio_links: string[], input_index: number) {}
  protected map_audio(complex_filter: string[]) { return [] }

  public clip(clip_builder: ClipBuilderBase) {
    const data = clip_builder.build()
    // ignore clips that start after or finish before the preview frame
    // console.log(data.id)
    // console.log('  data.start_at > this.sample_frame', data.start_at > this.sample_frame )
    // console.log('  data.start_at + data.duration < this.sample_frame', data.timeline_data.start_at, data.timeline_data.start_at + data.duration, '<', this.sample_frame, (data.timeline_data.start_at + data.duration) < this.sample_frame)
    const not_present_in_sample_frame = data.timeline_data.start_at > this.sample_frame || (data.timeline_data.start_at + data.duration) < this.sample_frame
    // console.log('not_present_in_sample_frame', not_present_in_sample_frame)
    if (not_present_in_sample_frame) {
      return
    } else {
      return super.clip(clip_builder)
    }
  }

  public get_output_file() {
    return path.join(this.context.output_folder, 'preview.jpg')
  }
}

abstract class ClipBuilderBase {
  protected pts_speed = '1*'
  protected setpts_filter = ''
  protected start_at = 0
  protected clip_trim_start = 0
  protected clip_duration = NaN
  protected timeline_data: TimelineClip = {
    clip_id: '',
    z_index: 0,
    start_at: 0,
    speed: 1,
    trim_start: 0,
    duration: NaN,
  }
  private x = 0
  private y = 0
  private video_input_filters: string[] = []
  private audio_input_filters: string[] = []

  private compute_tempo(val: number) {
    const numMultipliers =
      val > 1 ? Math.ceil(Math.log(val) / Math.log(2)) : Math.ceil(Math.log(val) / Math.log(0.5))
    const multVal = Math.pow(Math.E, Math.log(val) / numMultipliers)
    return Array(numMultipliers).fill(`atempo=${multVal}`).join(',')
  }

  public constructor(protected clip: parsed.MediaClipParsed, protected probe_info: ClipInfo) {
    const volume = parse_unit(clip.volume, {
      percentage: v => v,
      undefined: () => 1,
    })
    this.audio_input_filters.push(
      `asetpts=PTS-STARTPTS`,
      // `atrim=0:${duration * speed}`,
      // `adelay=${start_at * 1000}:all=1`,
      `volume=${volume}`, // TODO use anullsink for audio_volume === 0 to avoid extra processing
    )
  }

  protected get_timing_start_at(timeline_data: TimelineClip) {
    return timeline_data.start_at
  }
  protected get_timing_trim_start(timeline_data: TimelineClip) {
    return timeline_data.trim_start
  }

  public timing(timeline_data: TimelineClip) {
    this.timeline_data = timeline_data
    this.start_at = this.get_timing_start_at(timeline_data)
    this.clip_trim_start = this.get_timing_trim_start(timeline_data)
    this.clip_duration = timeline_data.duration
    this.pts_speed = `${1 / timeline_data.speed}*`

    if (this.start_at === 0) this.setpts_filter = `setpts=${this.pts_speed}PTS-STARTPTS`
    else this.setpts_filter = `setpts=${this.pts_speed}PTS-STARTPTS+${this.start_at}/TB`

    this.audio_input_filters.push(`adelay=${this.start_at * 1000}:all=1`)
    const atempo = this.compute_tempo(timeline_data.speed)
    // a.k.a. speed == 1
    // TODO it seems like theres some weird floating point math happening in some cases
    if (atempo !== '') this.audio_input_filters.push(atempo)
    return this
  }

  public coordinates(x: number, y: number) {
    this.x = x
    this.y = y
    return this
  }
  public scale(scale: { width: number; height: number }) {
    this.video_input_filters.push(`scale=${scale.width}:${scale.height}`)
    return this
  }

  public rotate(rotate: ComputedGeometry['rotate']) {
    if (rotate === undefined) return this
    const { degrees, width, height } = rotate
    this.video_input_filters.push(`rotate=${degrees}*PI/180:fillcolor=black@0:out_w=${width}:out_h=${height}`)
    return this
  }

  public crop(crop: ComputedGeometry['crop']) {
    if (crop === undefined) return this
    // TODO support zoompan
    const crop_x = crop.x
    const crop_y = crop.y
    this.video_input_filters.push(
      `crop=w=${crop.width}:h=${crop.height}:x='${crop_x}':y='${crop_y}':keep_aspect=1`
    )
    return this
  }

  public build(): ClipBuilderData  {
    const video_input_filters = [
      this.setpts_filter,
      ...this.video_input_filters,
    ]

    let framerate = this.probe_info.framerate
    if (this.clip.framerate) {
      const { fps } = this.clip.framerate
      framerate = fps
      if (this.clip.framerate.smooth) {
        video_input_filters.push(`minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`)
        // video_input_filters.push(`minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=${fps}'`)
      } else {
        video_input_filters.push(`fps=${fps}`)
      }
    }
    return {
      id: this.clip.id,
      file: this.clip.file,
      start_at: this.start_at,
      trim_start: this.clip_trim_start,
      duration: this.clip_duration,
      timeline_data: this.timeline_data,
      framerate,
      video_input_filters,
      audio_input_filters: this.audio_input_filters,
      overlay_filter: `overlay=x=${this.x}:y=${this.y}:eof_action=pass`,
      probe_info: this.probe_info,
    }
  }
}

// we _may_ decide to refactor these into ClipVideoBuilder, ClipImageBuilder, ClipAudioBuilder
// and push the sample vs full output logic into the cmd builders above
class ClipVideoBuilder extends ClipBuilderBase {}
class ClipSampleBuilder extends ClipBuilderBase {
  public constructor(clip: parsed.MediaClipParsed, info: ClipInfo, public sample_frame: number) {
    super(clip, info)
  }

  protected get_timing_start_at(timeline_data: TimelineClip) {
    return 0
  }
  protected get_timing_trim_start(timeline_data: TimelineClip) {
    return timeline_data.trim_start + this.sample_frame - timeline_data.start_at
  }
}


// TODO we might use classes instead of functions.
// That way we can have things like transition_cmd() for sample vs video
async function render(context: Context, ffmpeg_builder: FfmpegBuilderBase) {
  const output = {
    ...context.output_files,
    current: ffmpeg_builder.get_output_file(),
  }

  await Deno.mkdir(context.output_folder, { recursive: true })
  await Promise.all(context.template.clips.map(clip => context.clip_info_map.probe(clip)))
  const background_size = compute_size(context, context.template.size)
  context.set_background_size(background_size)
  const text_image_clips = await Promise.all(context.template.captions.map(caption => create_text_image(context, caption)))
  for (const text_clip of text_image_clips) context.clip_map.set(text_clip.id, text_clip)
  await Promise.all(text_image_clips.map(clip => context.clip_info_map.probe(clip)))

  const clips = context.template.clips.concat(text_image_clips)
  const geometry_info_map = compute_geometry(context, clips)
  const {total_duration, timeline} = compute_timeline(context)

  // TODO can we reuse a clip_builder here?
  ffmpeg_builder.background_cmd(background_size.width, background_size.height, total_duration, context.template.size.background_color)

  for (const timeline_clip of timeline) {
    const clip = context.get_clip(timeline_clip.clip_id)
    const info = context.clip_info_map.get_or_throw(timeline_clip.clip_id)
    const geometry = geometry_info_map.get_or_throw(clip.id)

    const clip_builder = ffmpeg_builder.clip_builder(clip, info)
    clip_builder
      .coordinates(geometry.x, geometry.y)
      .scale(geometry.scale)
      .timing(timeline_clip)
      .rotate(geometry.rotate)
      .crop(geometry.crop)

    ffmpeg_builder.clip(clip_builder)
  }


  const ffmpeg_cmd = ffmpeg_builder.build()
  if (context.ffmpeg_log_cmd) ffmpeg_builder.write_ffmpeg_cmd(output.ffmpeg_cmd)

  const pretty_duration = fmt_human_readable_duration(total_duration)
  if (ffmpeg_builder instanceof FfmpegSampleBuilder) {
    const skipped_clips = timeline.length - ffmpeg_builder.clip_count()
    if (skipped_clips) context.logger.info(`Rendering ${pretty_duration} long preview image out of ${ffmpeg_builder.clip_count()} clip(s). Skipping ${timeline.length - ffmpeg_builder.clip_count()} clip(s) not visible in preview timestamp`)
    else context.logger.info(`Rendering ${pretty_duration} long preview image out of ${ffmpeg_builder.clip_count()} clip(s).`)
  } else {
    context.logger.info(`Rendering ${pretty_duration} long video out of ${ffmpeg_builder.clip_count()} clip(s).`)
  }
  await ffmpeg(context, ffmpeg_cmd, total_duration)

  return {
    template: context.template,
    stats: {
      input_clips_count: clips.length,
      timeline_clips_count: timeline.length,
      execution_time: context.execution_time(),
    },
    output,
  }
}

async function render_video(instance: InstanceContext, template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(instance, template, template_parsed, options)
  const ffmpeg_builder = new FfmpegVideoBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, output } = result
  context.logger.info(`created "${relative_path(output.video)}" in ${stats.execution_time.toFixed(1)} seconds.`)

  return result
}

async function render_sample_frame(instance: InstanceContext, template: inputs.Template, options: ContextOptions) {
  const template_parsed = parse_template(template, options)
  const context = new Context(instance, template, template_parsed, options)
  const ffmpeg_builder = new FfmpegSampleBuilder(context)
  const result = await render(context, ffmpeg_builder)
  const { stats, output } = result
  context.logger.info(`created "${relative_path(output.preview)}" at timestamp ${template_parsed.preview} clips in ${stats.execution_time.toFixed(1)} seconds.`)
  // // DEBUG_START
  // await Deno.run({cmd: ['./imgcat.sh', 'ffmpeg-templates-projects/template.zod/text_assets/TEXT_0.png'], })
  // await Deno.run({cmd: ['./imgcat.sh', 'ffmpeg-templates-projects/template.zod/preview.jpg'], })
  // // DEBUG_END

  return result
}

export { render_video, render_sample_frame }
