const TIMELINE_ENUMS = {
  PAD: 'PAD',
} as const

type Fraction = string
type Pixels = number
type Percentage = number
type Offset = Fraction | Pixels
type Seconds = number
type Timestamp = string
type ClipID = string
type TimelineEnums = typeof TIMELINE_ENUMS[keyof typeof TIMELINE_ENUMS]

interface Clip {
  /** Defaults to CLIP_<index> */
  id?: ClipID
  /** File path to the clip. If it is a relative path, it will be relative to the location of the template file */
  file: string
  /** Audio volume of the clip, this number is relative to the other clip's audio_volume values */
  audio_volume: number
  /** Layout defines the geometry of a clip in the final render. E.g. its size and location */
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
  clips: Clip[]

  timeline?: { [start_position: string]: (ClipID | TimelineEnums)[][] }
}

// Parsed Template
interface TemplateParsed extends Template {
  size: { width: Size; height: Size }
  clips: (Clip & { id: ClipID; filepath: string })[]
  timeline: { [start_position: string]: (ClipID | TimelineEnums)[][] }
}

export { TIMELINE_ENUMS }
export type {
  Fraction,
  Pixels,
  Percentage,
  Offset,
  Seconds,
  Timestamp,
  ClipID,
  TimelineEnums,
  Size,
  Clip,
  Template,
  // parsed template exports
  TemplateParsed,
}
