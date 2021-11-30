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
  zoompan?: {
    /** The timstamp when the zoom and pan has settled */
    keyframe: Timestamp

    /** A percentage that the clip should be zoomed in or zoomed out */
    zoom?: Percentage

    /** A horizontal pan.
     *   Percentages are relative to the cropped clip. E.g. 50% puts the left side in the center of the screen.
     *   If there is a desire, we could add an `origin: 'center' | 'corner'` field to make the origin variable.
     */
    x?: Percentage | Pixels

    /** A vertical pan.
     *   Percentages are relative to the cropped clip. E.g. 50% puts the top side in the center of the screen.
     */
    y?: Percentage | Pixels
  }[]

  /** Angle at which the clip should be rotated */
  rotate?: Degrees

  /** Speed at which a clip should be played (200% is 2x speed) */
  speed?: Percentage

  /** Set the framerate for the clip */
  framerate?: {

    /** Set the frames per second for the input clip */
    fps: number

    /** smooth: true will interpolate frames that are missing
    * _if_ the desired framerate is higher than the input framerate */
    smooth?: boolean
  }

  /** Effect to transition a clip in or out of the page */
  transition?: { fade_in?: Timestamp; fade_out?: Timestamp }

  /** Trim the duration of a clip */
  trim?: {

    /** Trim time off the start of a clip (similar to -ss argument in ffmpeg) */
    start?: Timestamp

    /** Trim time off the end of a clip (similar to -to argument in ffmpeg) */
    stop?: Timestamp

    /** Trim the video to last until a particular moment of output (TBD if this is the best way to specify a sequence of images going until a certain point) */
    // stop_relative_to_output?: Timestamp

    /**
     * Auto-trim the clip so that it is not longer than the other longest clip
     *  If more than one variable_length clip is used in a sequence on the timeline, only the last clip will have variable length.
     *  If all clips on the timeline have variable length, all clips will share the shortest clip's duration.
     */
    variable_length: 'start' | 'stop'
  }
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

    /** Round the border shape (defaults to zero, no rounding) */
    border_radius?: number

    /** Thickness of the border (defaults to zero, not shown) */
    border_size?: number

    /** Text background color, filling the space inside the border (default is none) */
    background_color?: Color

    /** Hex color code for text outline (default is #000000) */
    outline_color?: Color

    /** Text outline size (default is zero) */
    outline_size?: number
  }

  /**
   * Specify the length a caption should be shown in the render
   *  If not specified, text clip length is essentially the same as `trim: { variable_length: 'end' }`
   */
  duration?: Timestamp
}

/**
 * A MediaClip is any clip which takes in an image, audio or video.
 * Note that an audio file will not allow visual fields like "layout" or "zoompan"
 */
export interface MediaClip extends ClipBase {

  /** Audio volume of the clip, this number is relative to the other clip's volume values. Defaults to 1. */
  volume?: Percentage

  /** File path to the clip. If it is a relative path, it will be relative to the location of the template file */
  file: string
}


export interface TimelineClip {
  /** Clip id that is being added to the timeline */
  id?: string

  /**
   * offset the clip start position by a specified duration. (Maybe we support negative durations too?)
   * default is "0"
   */
  offset?: Timestamp

  /**
   * specify the vertical height of a clip. Think foreground and background
   * default is 0
   */
  z_index?: number

  /** specify whether the next clips will be played one after another or all at the same time
   * @default 'sequence'
   */
  type?: 'parallel' | 'sequence'

  /** Specify list of clips that should appear after the specified clip */
  next?: TimelineClip[]
}


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
  timeline?: TimelineClip[]

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
