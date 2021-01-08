const TIMELINE_ENUMS = {
  PAD: 'PAD',
} as const

/**
 * A percentage is formatted like so:
 * "50%"
 */
type Percentage = string

/**
 * A pixel is formatted like so:
 * "10px"
 */
type Pixels = string

/**
 * Angle degrees
 */
type Degrees = number

/**
 * Hexidecimal color
 * "#000000"
 */
type HexColor = string

/**
 * A hour, minute, second timestamp formatted like so:
 * 00:00:05 or 01:23:02.75
 */
type Timestamp = string
// TODO replace the above with this definition. It is more precise, but currently yields the following error
// error: RangeError: Maximum call stack size exceeded
// type Timestamp = `${number}:${number}:${number}`

/**
 * A timestamp that is relative to the end of a time period
 */
type ReverseTimestamp = `-${Timestamp}`

/**
 * Id of a clip. Ids are either manually specified or are inserted with the convention "CLIP_<index>"
 */
type ClipID = string

/**
 * Specal keys that can be used on the timeline. Currently the only available enum is 'PAD', which will start
 * a clip at the last possible moment so that it finishes with the last played clip.
 */
type TimelineEnums = typeof TIMELINE_ENUMS[keyof typeof TIMELINE_ENUMS]

interface ClipBase {
  /** Defaults to CLIP_<index> */
  id?: ClipID
  /**
   * Layout defines the geometry of a clip in the final render. E.g. its size and location
   * X and Y offsets are relative to their alignment, they can be positive or negative.
   * The default alignments for X and Y are 'left' and 'top' respectively
   */
  layout?: {
    x?: Percentage | Pixels | { offset?: Pixels; align?: 'left' | 'right' | 'center' }
    y?: Percentage | Pixels | { offset?: Pixels; align?: 'top' | 'bottom' | 'center' }
    width?: Percentage | Pixels
    height?: Percentage | Pixels
  }
  /** Crop will trim edges of a clip accordingly. layout alignment will respect the crop */
  crop?: {
    left?: Pixels
    right?: Pixels
    top?: Pixels
    bottom?: Pixels
  }

  rotate?: Degrees
  /**
   * Trim how long a clip lasts, trimming from either the beginning of a clip, or the end.
   * The special value 'fit' will automatically trim a clip the length of the final render
   * Note that 'end', 'stop', and 'stop_at_output' are mutually exclusive
   */
  trim?: {
    /** Trim the start of a clip */
    start?: 'fit' | Timestamp
    /** Trim the end of a clip (subtract from the end) */
    end?: 'fit' | Timestamp
    /** Trim at to a specific time in the clip */
    stop?: Timestamp
    /** Trim at to a specific time in the output */
    stop_at_output?: Timestamp }
  /** Specify the length of a clip exactly */
  duration?: Timestamp
  /** Increase or decrease the playback speed */
  speed: Percentage
  /** Effect to transition a clip in or out of the page */
  transition?: { fade_in?: Timestamp; fade_out?: Timestamp }
}

interface MediaClip extends ClipBase {
  /** File path to the clip. If it is a relative path, it will be relative to the location of the template file */
  file: string
  /** Audio volume of the clip, this number is relative to the other clip's audio_volume values. Defaults to 1. */
  audio_volume: number
}

interface FontClip extends ClipBase {
  /** Text to be displayed */
  text: string

  /** Hex color code for font (default is #00000) */
  font_color?: HexColor

  /** Hex color code for font outline (default is #000000) */
  font_outline_color?: HexColor

  /** Text outline size (default is zero) */
  font_outline_size?: number

  /** Font size (default is 12) */
  font_size?: number

  /** File path to a ttf file for the font */
  font: string

  /** Font background color (default is none) */
  font_background?: HexColor
}

type Clip = MediaClip | FontClip

interface Template {
  /**
   * defaults to { width: '100%', height: '100%', relative_to: 'CLIP_0' }
   */
  size?: { width?: Pixels | Percentage; height?: Pixels | Percentage; relative_to: ClipID }
  /**
   * A list of clips that are available to the timline
   *
   */
  clips: Clip[]
  /**
   * Specify when clips are played and which should be layered on top of others using this field.
   * The default timeline starts all the clips at the same time. E.g.
   * {"00:00:00": [["CLIP_0", "CLIP_1", ...]]}
   */
  timeline?: { [start_position: string]: (ClipID | TimelineEnums)[][] }

  /**
   * Preview at a position
   * Used with the --preview flag
   */
  preview: Timestamp
  // TODO add this after the max call stack bug is fixed
  // preview: Timestamp | ReverseTimestamp
}

export { TIMELINE_ENUMS }
export type { Percentage, Pixels, Timestamp, ClipID, TimelineEnums, MediaClip, FontClip, Clip, Template }
