import { z } from 'https://deno.land/x/zod@v3.9.0/mod.ts'
import * as t from '../template_input.zod.ts'
import { assert } from '../type-equality.ts'


const ClipId = z.string().regex(/[a-zA-Z0-9-_]/)

const Pixels = z.string().regex(/\d+px/)

const Percentage = z.string().regex(/\d+%/)

const Degrees = z.number().min(0).max(360)

const Color = z.string()

const Timestamp = z.string() // I think we will delay parsing this till after we probe files because we need access to full file durations to resolve variables

const Size = z.object({
  width: z.union([Pixels, Percentage]).default('100%'),
  height: z.union([Pixels, Percentage]).default('100%'),
  relative_to: ClipId.optional(),
}).strict()

const AlignX = z.union([z.literal('left'), z.literal('right'), z.literal('center')])
const AlignY = z.union([z.literal('top'), z.literal('bottom'), z.literal('center')])
const Layout = Size.extend({
  x: z.union([AlignX, z.object({ offset: z.union([Pixels, Percentage]).default('0px'), align: AlignX.default('left') })]).default('left').transform(val => typeof val === 'object' ?  val : { offset: '0px', align: val }),
  y: z.union([AlignY, z.object({ offset: z.union([Pixels, Percentage]).default('0px'), align: AlignY.default('top') })]).default('top').transform(val => typeof val === 'object' ?  val : { offset: '0px', align: val }),
}).strict()

const ClipBase = z.object({
  id: ClipId.optional(),
  layout: Layout.default({}),
  crop: Layout.optional(),
  zoompan: z.object({
    keyframe: Timestamp,
    zoom: Percentage.optional(),
    x: z.union([Pixels, Percentage]).optional(),
    y: z.union([Pixels, Percentage]).optional(),
  }).strict().array().optional(),
  rotate: Degrees.optional(),
  speed: Percentage.default('100%'),
  framerate: z.object({
    fps: z.number().min(0),
    smooth: z.boolean().default(false),
  }).strict().optional(),
  transition: z.object({
    fade_in: Timestamp.optional(),
    fade_out: Timestamp.optional(),
  }).strict().optional(),
  trim: z.object({
    start: Timestamp.optional(),
    stop: Timestamp.optional(),
    variable_length: z.union([z.literal('start'), z.literal('stop')]),
  }).strict().optional(),
}).strict()

const MediaClip = ClipBase.extend({
  file: z.string(),
  volume: Percentage.default('100%'),
}).strict().transform(val => ({ ...val, type: 'media' as const }))

const TextClip = ClipBase.extend({
  text: z.string(),
  font: z.object({
    family: z.string().optional(),
    size: z.number().default(16),
    color: Color.default('black'),
    border_radius: z.number().min(0).default(0),
    padding: z.number().min(0).default(0),
    background_color: Color.default('black'),
    outline_color: Color.default('black'),
    outline_size: z.number().default(0),
  }).strict().optional(),

  duration: Timestamp.optional(),
}).strict().transform(val => ({ ...val, type: 'text' as const }))

const TimelineClip: z.ZodSchema<t.TimelineClip> = z.lazy(() => z.object({
  id: ClipId.optional(),
  offset: Timestamp.default('0'),
  z_index: z.number().default(0),
  type: z.union([z.literal('parallel'), z.literal('sequence')]).default('parallel'),
  next: TimelineClip.array().default([]),
}))

const Template = z.object({
  size: Size.default({}),
  clips: MediaClip
    .array()
    .min(1)
    .transform(clips => clips.map((val, i) => ({id: `CLIP_${i}`, ...val})))
    .refine(clips => new Set(clips.map(c => c.id)).size === clips.length, { message: 'No duplicate clip ids allowed.' }),
  captions: TextClip.array().default([]),
  timeline: TimelineClip.array().min(1).optional(),
  preview: Timestamp.optional(),
}).transform(val => ({
  timeline: val.clips.map(c => TimelineClip.parse({ id: c.id })),
  ...val,
  size: { relative_to: val.clips[0].id, ...val.size, },
}))

// this is a typescript exacty type assertion. It does nothing at runtime
assert({} as z.input<typeof Template>, {} as t.Template)

export { Template }
