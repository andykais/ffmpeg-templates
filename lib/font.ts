import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.91.0/fs/mod.ts'
import { CommandError } from './errors.ts'
import { parse_unit } from './parsers/unit.ts'
import { is_font_clip, is_media_clip } from './parsers/template.ts'
import { probe_clips } from './probe.ts'
import type { Logger } from './logger.ts'
import type * as template_parsed from './parsers/template.ts'
import type { ClipInfoMap } from './probe.ts'

// generate font assets and replace font clips with media clips
async function replace_font_clips_with_image_clips(
  logger: Logger,
  template: template_parsed.Template,
  background_width: number,
  background_height: number,
  clip_info_map: ClipInfoMap,
  cwd: string
): Promise<template_parsed.MediaClip[]> {
  const font_clips: template_parsed.FontClip[] = template.clips.filter(is_font_clip)
  const font_assets_path = path.join('/tmp/ffmpeg-templates', cwd, `font_assets/`)
  if (font_clips.length) await Deno.mkdir(font_assets_path, { recursive: true })

  const font_generation_promises: Promise<template_parsed.MediaClip>[] = font_clips.map(
    async (clip: template_parsed.FontClip) => {
      const filename = `${clip.id}.png`
      const filepath = path.join(font_assets_path, filename)
      // we remove the file so we can be certain it was created
      if (await fs.exists(filepath)) await Deno.remove(filepath)

      const width = parse_unit(clip.layout?.width, {
        percentage: (p) => p * background_width,
        undefined: () => null,
      })
      const height = parse_unit(clip.layout?.height, {
        percentage: (p) => p * background_height,
        undefined: () => null,
      })

      let text_type = 'label'
      const size_args = []
      if (width && height) {
        text_type = 'caption'
        size_args.push('-size', `${width}x${height}`)
      } else if (width) {
        text_type = 'caption'
        size_args.push('-size', `${width}x`)
      } else if (height) {
        text_type = 'caption'
        size_args.push('-size', `x${height}`)
      }

      const magick_command = [
        'magick',
        '-background',
        'none',
        '-pointsize',
        clip.font.size.toString(),
        '-gravity',
        'Center',
      ]
      if (clip.font.line_spacing) magick_command.push('-interline-spacing', clip.font.line_spacing.toString())
      if (clip.font.family) magick_command.push('-font', clip.font.family)
      if (clip.font.background_color) magick_command.push('-undercolor', clip.font.background_color)
      if (clip.font.outline_size) {
        magick_command.push(...size_args)
        magick_command.push('-strokewidth', clip.font.outline_size.toString())
        magick_command.push('-stroke', clip.font.outline_color)
        magick_command.push(`${text_type}:${clip.text}`)
      }
      magick_command.push(...size_args)
      magick_command.push('-fill', clip.font.color)
      magick_command.push('-stroke', 'none')
      magick_command.push(`${text_type}:${clip.text}`)
      if (clip.font.outline_size) {
        magick_command.push('-compose', 'over', '-composite')
      }
      if (clip.font.background_color) {
        magick_command.push(
          '-bordercolor',
          'none',
          '-border',
          '12',
        )
        // +swap -composite
        if (clip.font.background_radius) {
          magick_command.push(
            '(',
            '+clone',
            '-morphology',
            'dilate',
            `disk:${clip.font.background_radius}`,
            ')',
            '+swap',
            '-composite'
          )
        }
      }
      // TODO is this unnecessary? It effs with the width and point sizes (since we scale to the specified size)
      // if we do need to re-enable this, we will need a font-specific width param
      // magick_command.push('-trim', '+repage')
      magick_command.push(filepath)
      // console.log(magick_command.join(' '))

      console.log(magick_command.join(' '))
      const proc = Deno.run({ cmd: magick_command })
      const result = await proc.status()
      if (!result.success) {
        throw new CommandError(`Command "${magick_command.join(' ')}" failed.\n\n`)
      } else if (!(await fs.exists(filepath))) {
        throw new CommandError(`Command "${magick_command.join(' ')}" failed. No image was produced.\n\n`)
      }
      const { text, font, ...base_clip_params } = clip
      return { ...base_clip_params, filepath, file: filename, audio_volume: 0, source_clip: clip }
    }
  )

  const font_media_clips = await Promise.all(font_generation_promises)
  const font_media_clip_info_map = await probe_clips(logger, template, font_media_clips, false)
  for (const clip of font_media_clip_info_map.values()) {
    clip_info_map.set(clip.id, clip)
  }
  const clips: template_parsed.MediaClip[] = template.clips.map((clip) => {
    if (is_media_clip(clip)) return clip
    else {
      const res = font_media_clips.find((c) => clip.id === c.id)!
      if (res) return res
      else throw new Error('fatal error. Expected font clip but none found')
    }
  })

  return clips
}

export { replace_font_clips_with_image_clips }
