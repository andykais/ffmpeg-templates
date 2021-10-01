/**
 * Id of a clip. Clip ids characters are limited to [a-zA-Z0-9_-]
 */
export type ClipID = string

/**
 * A percentage is formatted like so:
 * "50%"
 */
export type Percentage = string //`${string}%`

/**
 * A pixel is formatted like so:
 * "10px"
 */
export type Pixels = string //`${string}px`

/**
 * A degree is formatted like so:
 * ("0" - "360")
 */
export type Degrees = number

/**
 * A color can be a hexidecimal value or a simple identifiable color:
 * "#FFFFFF" or "black"
 */
export type Color = string

/**
 * A hour, minute, second timestamp formatted like so:
 * "00:00:05" or "01:23:02.75"
 *
 * Timestamps can also include references to other timestamps defined in the template:
 * "{CLIP_1} - 5"
 */
export type Timestamp = string

export interface Size {
 width?: Pixels | Percentage
 height?: Pixels | Percentage
 relative_to?: ClipID
}

type AlignX = 'left' | 'right' | 'center'
type AlignY = 'top' | 'bottom' | 'center'

export interface Layout extends Size {
  x?: AlignX | { offset?: Percentage | Pixels; align?: AlignX }
  y?: AlignY | { offset?: Percentage | Pixels; align?: AlignY }
}

export interface ClipBase {
  /** Defaults to CLIP_<index> for media clips and TEXT_<index> for text clips */
  id?: ClipID

  /**
   * Layout defines the geometry of a clip in the final render. E.g. its size and location
   * X and Y offsets are relative to their alignment, they can be positive or negative.
   * The default alignments for X and Y are 'left' and 'top' respectively
   */
  layout?: Layout

  /**
   * Crop will trim edges of a clip accordingly. Layout alignment will respect the crop
   */
  crop?: Layout

  /** Zoom and pan a clip */
  // zoompan?: {
  //   [timestamp: string]: {
  //     zoom?: Percentage
  //     x?: Percentage | Pixels
  //     y?: Percentage | Pixels
  //   }
  // }

  /** Angle at which the clip should be rotated */
  rotate?: Degrees
}

/**
 * A font clip is a clip which takes in text, and fields configuring the displayed font.
 * Behind the scenes ffmpeg-templates generates a png for the font and then includes that in the ffmpeg render
 * pipeline.
 */
export interface TextClip extends ClipBase {
  /** Text to be displayed */
  text: string

  /** Text specific properties */
  font?: {
    /** File path to a ttf or otf file for the font */
    family?: string

    /** Font size (default is 12) */
    size?: number

    /** Hex color code for text (default is #00000) */
    color?: Color

    /** Round the background shape (defaults to zero, no rounding) */
    border_radius?: number

    /** Add extra width and height to the background color. Text will be centered inside it */
    padding?: number

    /** Text background color (default is none) */
    background_color?: Color

    /** Hex color code for text outline (default is #000000) */
    outline_color?: Color

    /** Text outline size (default is zero) */
    outline_size?: number
  }
}

/**
 * A MediaClip is any clip which takes in an image, audio or video.
 * Note that an audio file will not allow visual fields like "layout" or "zoompan"
 */
export interface MediaClip extends ClipBase {
  /** Audio volume of the clip, this number is relative to the other clip's volume values. Defaults to 1. */
  volume?: number
  /** File path to the clip. If it is a relative path, it will be relative to the location of the template file */
  file: string
}


export interface TimelineClip {
  id: string
  /**
   * offset the clip start position by a specified duration. (Maybe we support negative durations too?)
   * default is "0"
   */
  offset?: Timestamp

  /** trim works very similar to clips trim, except that we can specify 'fit' instead of a duration. */
  trim_to_fit: 'start' | 'end'

  /**
   * specify the vertical height of a clip. Think foreground and background
   * default is 0
   */
  z_index?: number

  /** Specify list of clips that should appear after the specified clip */
  next?: TimelineItem[]
}

export interface TimelineSequence {
  /** Specify a list of timeline items that should occur sequentially one after another */
  sequence: TimelineItem
  /** specify the vertical height of a clip. Think foreground and background */
  z_index?: number
}

export type TimelineItem = TimelineClip | TimelineSequence


export interface Template {
  /**
   * Size of the output clip. defaults to { width: '100%', height: '100%', relative_to: 'CLIP_0' }
   */
  size?: Size

  /**
   * A list of clips that are available to the timeline
   */
  clips: MediaClip[]

  /**
   * A list of text captions that are available to the timeline
   */
  captions?: TextClip[]

  /**
   * Specify when clips are played and which should be layered on top of others using this field.
   * The default timeline starts all the clips at the same time. E.g.
   * [{ id: "CLIP_0", offset: "0" }, { id: "CLIP_1", offset: "0" }, ...]
   */
  // timeline?: TimelineItem[]

  /**
   * Preview the rendered output at a position. Used with the --preview flag.
   */
  preview?: Timestamp
}


// const template: Template = {
//   clips: [
//     { id: 'VERTICAL', file: 'phone-video.mp4' },
//     { id: 'SPLIT_L',  file: 'splitscreen.mp4' },
//     { id: 'SPLIT_R',  file: 'splitscreen.mp4' },
//   ],

//   timeline: [
//     { id: 'VERTICAL', trim: { end: 'fit' }, z_index: 1 },
//     { id: 'CLIP_L',   trim: { end: 'fit' }, },
//     { id: 'CLIP_R',   trim: { end: 'fit' }, },
//   ]
// }
