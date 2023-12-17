import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { InputError } from '../errors.ts'
import { parse_unit } from './unit.ts'
import type * as template_input from '../template_input.ts'

abstract class AbstractClipMap<T> extends Map<template_input.ClipID, T> {
  get_or_else(clip_id: template_input.ClipID): T {
    const clip = this.get(clip_id)
    if (!clip) throw new InputError(`Clip ${clip_id} does not exist.`)
    else return clip
  }
}

// Parsed Template
interface MediaClip extends template_input.MediaClip {
  id: template_input.ClipID
  filepath: string
  source_clip: template_input.MediaClip | template_input.FontClip
}
// type Font = NonNullable<template_input.FontClip['font']>
interface Font extends NonNullable<template_input.FontClip['font']> {
  color: string
  outline_color: string
  size: number
  background_radius: number
}
interface FontClip extends template_input.FontClip {
  id: template_input.ClipID
  font: Font
  source_clip: template_input.FontClip
}
type Clip = MediaClip | FontClip
interface Template extends template_input.Template {
  size: NonNullable<Required<template_input.Template['size']>>
  clips: Clip[]
  // clips: (Clip & { id: ClipID; filepath: string })[]
  timeline: { [start_position: string]: (template_input.ClipID | template_input.TimelineEnums)[][] }
  preview: NonNullable<template_input.Template['preview']>
}

function is_media_clip(clip: template_input.Clip): clip is template_input.MediaClip
function is_media_clip(clip: Clip): clip is MediaClip
function is_media_clip(clip: template_input.Clip | Clip): clip is MediaClip | template_input.MediaClip {
  return 'file' in clip
}
function is_font_clip(clip: Clip): clip is FontClip {
  return !is_media_clip(clip)
}

function parse_template(template_input: template_input.Template, cwd: string): Template {
  if (template_input.clips.length === 0) {
    throw new InputError(`template "clips" must have at least one clip present.`)
  }
  const clips: Template['clips'] = []
  for (const i of template_input.clips.keys()) {
    const clip = template_input.clips[i]
    const id = clip.id ?? `CLIP_${i}`
    if (clips.find((c) => c.id === id)) throw new InputError(`Clip id ${id} is defined more than once.`)
    if (clip.trim?.stop && clip.trim?.end) {
      throw new InputError('Clip cannot provide both trim.stop and trim.end')
    } else if (clip.trim?.stop && clip.duration) {
      throw new InputError('Clip cannot provide both trim.stop and duration')
    }

    if (is_media_clip(clip)) {
      const filepath = path.resolve(cwd, clip.file)
      clips.push({ id, filepath, ...clip, source_clip: clip })
    } else {
      // its a font
      clips.push({
        id,
        ...clip,
        font: {
          color: 'white',
          size: 12,
          outline_color: 'black',
          background_radius: 4.3,
          ...clip.font,
        },
        source_clip: clip,
      })
    }
  }
  const timeline = template_input.timeline ?? { '00:00:00': clips.map((clip) => [clip.id]) }

  const first_media_clip = clips.find(is_media_clip)
  const has_non_pixel_unit =
    (template_input.size?.width?.endsWith('%') ?? true)
    && (template_input.size?.height?.endsWith('%') ?? true)
  const relative_to_clip = clips.find((c) => c.id === template_input.size?.relative_to)
  if (relative_to_clip && !is_media_clip(relative_to_clip)) {
    throw new InputError(`Cannot specify a font clip as a relative size source`)
  } else if (has_non_pixel_unit && !first_media_clip) {
    throw new InputError(`If all clips are font clips, a size must be specified using pixel units.`)
  }

  const default_size = {
    width: '100%',
    height: '100%',
    relative_to: first_media_clip?.id ?? '__NEVER_USED_PLACEHOLDER__',
  }
  const size = { ...default_size, ...template_input.size }

  const preview = template_input.preview || '00:00:00'
  return { ...template_input, size, clips, timeline, preview }
}

export { is_media_clip, is_font_clip, parse_template, AbstractClipMap }
export type { MediaClip, FontClip, Font, Clip, Template }
