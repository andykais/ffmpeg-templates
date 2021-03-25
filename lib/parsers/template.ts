import * as path from 'https://deno.land/std@0.75.0/path/mod.ts'
import { InputError } from '../errors.ts'
import { parse_unit } from './unit.ts'
import type {
  Pixels,
  Percentage,
  Timestamp,
  ClipID,
  TimelineEnums,
  Clip,
  MediaClip,
  FontClip,
  Template,
} from '../template_input.ts'

// Parsed Template
interface MediaClipParsed extends MediaClip {
  id: ClipID
  filepath: string
  source_clip: MediaClip | FontClip
}
type Font = NonNullable<FontClip['font']>
interface FontParsed extends Font {
  color: string
  outline_color: string
  size: number
  background_radius: number
}
interface FontClipParsed extends FontClip {
  id: ClipID
  font: FontParsed
  source_clip: FontClip
}
type ClipParsed = MediaClipParsed | FontClipParsed
interface TemplateParsed extends Template {
  size: NonNullable<Required<Template['size']>>
  clips: ClipParsed[]
  // clips: (Clip & { id: ClipID; filepath: string })[]
  timeline: { [start_position: string]: (ClipID | TimelineEnums)[][] }
  preview: NonNullable<Template['preview']>
}

function is_media_clip(clip: Clip): clip is MediaClip
function is_media_clip(clip: ClipParsed): clip is MediaClipParsed
function is_media_clip(clip: Clip | ClipParsed): clip is MediaClipParsed | MediaClip {
  return 'file' in clip
}
function is_font_clip(clip: ClipParsed): clip is FontClipParsed {
  return !is_media_clip(clip)
}

function parse_template(template_input: Template, cwd: string): TemplateParsed {
  if (template_input.clips.length === 0) {
    throw new InputError(`template "clips" must have at least one clip present.`)
  }
  const clips: TemplateParsed['clips'] = []
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
  const is_pixel_unit = { percentage: () => true, pixels: () => false, undefined: () => true }
  const has_non_pixel_unit =
    parse_unit(template_input.size?.width, is_pixel_unit) &&
    parse_unit(template_input.size?.height, is_pixel_unit)
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

export { is_media_clip, is_font_clip, parse_template }
export type { MediaClipParsed, FontClipParsed, FontParsed, ClipParsed, TemplateParsed }
