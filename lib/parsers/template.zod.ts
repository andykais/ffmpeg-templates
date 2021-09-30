import { z } from 'https://deno.land/x/zod@v3.8.0/mod.ts'
import type * as template_refactor_just_to_get_it_compiling from './template.zod_v2.ts'
import type * as t from '../template_input.ts'

/* Enums */
const ALIGN_X = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
} as const

const ALIGN_Y = {
  TOP: 'top',
  CENTER: 'center',
  BOTTOM: 'bottom',
} as const

const CLIP_TYPES = {
  MEDIA: 'media',
  TEXT: 'text',
} as const

/* Validators */
const Id = z.string()
// we can in the future include a duration parser here, but it cannot fully parse yet because we need stateful parsing ()
const Duration = z.string()

const Pixels = z.string().regex(/\d+px/)
const parse_pixels = (str: string) => parseFloat(str.slice(0, -2))

const Percentage = z.string().regex(/\d+%/)
const parse_percentage = (relative_to: number) => (str: string) => parseFloat(str.slice(0, -1)) / 100 * relative_to

const PixelPercentage = z.union([Pixels, Percentage])

const Degrees = z.number()

const AlignX = z.union([z.literal(ALIGN_X.LEFT), z.literal(ALIGN_X.RIGHT), z.literal(ALIGN_X.CENTER)])
const AlignY = z.union([z.literal(ALIGN_Y.TOP), z.literal(ALIGN_Y.CENTER), z.literal(ALIGN_Y.BOTTOM)])

// const Layout: z.ZodSchema<t.ClipBase['layout']> = z.object({
const Layout = z.object({
  y: z.union([
    PixelPercentage,
    AlignY,
    z.object({
      offset: PixelPercentage,
      align: AlignY
    }),
    // TODO aligns need to be transformed
  ]).default('0px').transform(val => typeof val === 'object' ? val : { offset: val, align: ALIGN_Y.TOP }),

  x: z.union([
    PixelPercentage,
    AlignX,
    z.object({
      offset: PixelPercentage,
      align: AlignX,
    }),
  ]).default('0px').transform(val => typeof val === 'object' ? val : { offset: val, align: ALIGN_X.LEFT }),

  width: PixelPercentage.default('100%'),
  height: PixelPercentage.default('100%'),

  relative_to: Id.optional(),
}).strict()

const ClipBase = z.object({
  id: Id.optional(),
}).strict()

// a media clip could be audio, image or video. Until we probe the file, we dont know though
const MediaClip = ClipBase.extend({
  file: z.string(),
  speed: Percentage.default('100%').transform(parse_percentage(1)),
  volume: Percentage.default('100%').transform(parse_percentage(1)),
  trim: z.object({ start: Duration.optional(), stop: Duration.optional() }).default({}),
  layout: Layout.default({}),
  crop: Layout.default({}),
  rotate: Degrees.optional().transform(r => r ?? null),
}).transform(clip => ({ ...clip, type: CLIP_TYPES.MEDIA }))

const TextClip = ClipBase.extend({
  text: z.string(),
  layout: Layout.default({}),
}).transform(clip => ({ ...clip, type: CLIP_TYPES.TEXT }))

const Clip = z.union([MediaClip, TextClip])


interface TimelineItem {
  clip: {
    id: string
    start?: string
    stop?: string
    relative_to_prev?: boolean // note that `stop` would be the same as duration when `relative_to_prev: true`
  }
  next?: TimelineItem[]
}

const TimelineClip = z.object({
  id: Id,
  start: Duration.optional(),
  stop: Duration.optional(),
})

const TimelineItem: z.ZodSchema<TimelineItem> = z.lazy(() =>
  z.object({
    clip: TimelineClip,
    next: TimelineItem.array().default([])
  })
)

const Template = z.object({
  size: z.object({
    width: PixelPercentage.default('100%'),
    height: PixelPercentage.default('100%'),
    relative_to: Id.optional(),
  }).default({}),

  clips: Clip
    .array()
    .nonempty()
    .transform(clips => clips.map((c, i) => ({id: `CLIP_${i}`, ...c})))
    .refine(clips => new Set(clips.map(c => c.id)).size === clips.length, { message: 'No duplicate clip ids allowed.' }),

  z_index: Id.array().default([]),

  timeline: z.object({
    clip: TimelineClip.extend({ start: Duration }),
    next: TimelineClip,
  }).array().optional(),

  preview: Duration.optional(),
}).strict().transform(template => ({
  timeline: template.clips.map(c => ({ clip: { id: c.id, start: '0', stop: null } })),
  ...template,
  size: {
    relative_to: template.clips[0].id,
    ...template.size,
  },
  z_index: template.z_index
    .concat(template.clips.map(c => c.id)
    .filter(id => template.z_index.indexOf(id) === -1))
}))

type ZodTemplate = z.input<typeof Template>
type ZodResult = z.infer<typeof Template>

function parse_template(template_input: ZodTemplate): ZodResult {
  const result = Template.parse(template_input)
  return result
}

export { parse_template }
