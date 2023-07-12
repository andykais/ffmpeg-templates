import * as errors from '../errors.ts'
import { Context } from '../context.ts'
import { relative_path } from '../util.ts'
import type * as inputs from '../template_input.zod.ts'
import type * as parsed from '../parsers/template.zod.ts'
import type { TimelineClip } from '../timeline.zod.ts'
import type { ComputedGeometry } from '../geometry.zod.ts'
import type { ClipInfo } from '../probe.zod.ts'

import { ClipBuilderBase } from './clip_base.ts'

export interface ClipBuilderData {
  id: string
  source: string
  start_at: number
  trim_start: number
  duration: number
  timeline_data: TimelineClip
  framerate: number
  video_input_filters: string[]
  audio_input_filters: string[]
  overlay_filter: string
  probe_info: ClipInfo
  geometry: ComputedGeometry
}

interface FfmpegInstructions {
  total_duration: number | undefined
  clips: Record<string, ClipBuilderData>
}

export abstract class FfmpegBuilderBase {
  protected complex_filter_inputs: string[] = []
  protected complex_filter_overlays: string[] = []
  protected audio_links: string[] = []
  private ffmpeg_inputs: string[] = []
  private last_link: string | undefined = undefined
  private verbosity_flag = 'error'
  private input_index = 0
  private clip_data: ClipBuilderData[] = []
  private total_duration: number | undefined = undefined

  private output_framerate: undefined | number = undefined

  public abstract get_output_file(): string

  protected abstract get_vframe_flags(): string[]

  protected abstract input_audio(data: ClipBuilderData, complex_filter_inputs: string[], audio_links: string[], input_index: number): void

  protected abstract map_audio(complex_filter: string[]): string[]

  public abstract clip_builder(clip: inputs.MediaClip, info: ClipInfo): ClipBuilderBase

  public serialize() {
    return {
      total_duration: this.total_duration,
      clips: this.clip_data.reduce((record, clip) => {
        record[clip.id] = clip
        return record
      }, {} as Record<string, ClipBuilderData>)
    }
  }

  public constructor(protected context: Context) {
    this.verbosity_flag = this.context.ffmpeg_log_cmd ? 'info' : 'error'
  }

  public clip_count() { return this.clip_data.length }

  public background_cmd(background_width: number, background_height: number, total_duration?: number, background_color?: string) {
    background_color ??= 'black'
    const link = '[base]'
    const filter_inputs = [
      `color=s=${background_width}x${background_height}`,
      `color=${background_color}`,
    ]
    this.total_duration = total_duration
    if (total_duration !== undefined) filter_inputs.push(`duration=${total_duration}`)
    // const filter_input = `color=s=${background_width}x${background_height}:color=${background_color}:duration=${total_duration}`
    this.complex_filter_inputs.push(`${filter_inputs.join(':')}${link}`)
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
          '-i', data.source,
        )
        break
      case 'image':
        this.ffmpeg_inputs.push(
          '-framerate', data.framerate.toString(),
          '-loop', '1',
          '-t', data.duration.toString(),
          '-i', data.source
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
