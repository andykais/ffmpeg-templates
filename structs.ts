const TIMELINE_ENUMS = {
  PAD: 'PAD',
} as const

/**
 * A fraction formatted like so:
 * "1/2" or "5/3"
 */
type Fraction = string
/** Pixels of the rendered video */
type Pixels = number
type Offset = Fraction | Pixels
/**
 * A hour, minute, second timestamp formatted like so:
 * 00:00:05 or 01:23:02.75
 */
type Timestamp = string
type ClipID = string
/**
 * Specal keys that can be used on the timeline. Currently the only available enum is 'PAD', which will start
 * a clip at the last possible moment so that it finishes with the last played clip.
 */
type TimelineEnums = typeof TIMELINE_ENUMS[keyof typeof TIMELINE_ENUMS]

interface Clip {
  /** Defaults to CLIP_<index> */
  id?: ClipID
  /** File path to the clip. If it is a relative path, it will be relative to the location of the template file */
  file: string
  /** Audio volume of the clip, this number is relative to the other clip's audio_volume values. Defaults to 1. */
  audio_volume: number
  /**
   * Layout defines the geometry of a clip in the final render. E.g. its size and location
   * X and Y offsets are relative to their alignment, they can be positive or negative.
   * The default alignments for X and Y are 'left' and 'top' respectively
   */
  layout?: {
    x?: Offset | { offset?: Offset; align?: 'left' | 'right' | 'center' }
    y?: Offset | { offset?: Offset; align?: 'top' | 'bottom' | 'center' }
    width?: Fraction | Pixels
    height?: Fraction | Pixels
  }
  /** Crop will trim edges of a clip accordingly. layout alignment will respect the crop */
  crop?: {
    left?: Pixels
    right?: Pixels
    top?: Pixels
    bottom?: Pixels
  }
  /**
   * Trim how long a clip lasts, trimming from either the beginning of a clip, or the end.
   * The special value 'fit' will automatically trim a clip the length of the final render
   */
  trim?: { start?: 'fit' | Timestamp; end?: 'fit' | Timestamp }
  /** Specify the length of a clip exactly */
  duration?: Timestamp
}
type Size = Pixels | { fraction: Fraction; of: ClipID }
interface Template {
  /** defaults to width: { fraction: '1/1', of: `CLIP_0` } */
  size?: { width?: Size; height?: Size }
  /**
   * A list of clips that are available to the timline */
  clips: Clip[]
  /**
   * Specify when clips are played and which should be layered on top of others using this field.
   * The default timeline starts all the clips at the same time. E.g.
   * {"00:00:00": [["CLIP_0", "CLIP_1", ...]]}
   */
  timeline?: { [start_position: string]: (ClipID | TimelineEnums)[][] }
}

export { TIMELINE_ENUMS }
export type {
  Fraction,
  Pixels,
  Offset,
  Timestamp,
  ClipID,
  TimelineEnums,
  Size,
  Clip,
  Template,
}
