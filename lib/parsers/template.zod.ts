import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { z } from 'https://deno.land/x/zod@v3.21.4/mod.ts'
import * as t from '../template_input.zod.ts'
import * as errors from '../errors.ts'
import { parse_unit } from './unit.ts'
import {exactly} from 'https://esm.sh/@detachhead/ts-helpers@9.0.0-9b4a478c3a63affa1f7f29aeabc2e5f76583ddfc/dist/utilityFunctions/misc'


const ClipId = z.string().regex(/[a-zA-Z0-9-_]/).refine(v => v !== 'BACKGROUND', { message: '"BACKGROUND" is a reserved id.'})
const ClipIdReference = z.string().regex(/[a-zA-Z0-9-_]/)

const Pixels = z.string().regex(/\d+px/)

const Percentage = z.string().regex(/\d+%/)

const Degrees = z.number().min(0).max(360)

const Color = z.string()

const Timestamp = z.string() // I think we will delay parsing this till after we probe files because we need access to full file durations to resolve variables

const KeypointReference = z.object({
  keypoint: z.string(),
  offset: Timestamp.optional(),
})

const DetailedSizeUnit = z.object({
  min: z.union([Pixels, Percentage]).optional(),
  max: z.union([Pixels, Percentage]).optional(),
  value: z.union([Pixels, Percentage]).optional(),
})
  .refine(unit => Object.keys(unit).length > 0, { message: 'size unit must define at least one field (min, max, value)'})
  .refine(unit => {
    const max = parse_unit(unit.max, { undefined: () => Infinity })
    const min = parse_unit(unit.min, { undefined: () => 0 })
    return max > min
  }, { message: 'size unit min must be smaller than size unit max' })
const SizeUnit = z.union([Pixels, Percentage, DetailedSizeUnit]).optional()
const Size = z.object({
  width: SizeUnit.optional(),
  height: SizeUnit.optional(),
  relative_to: ClipIdReference.optional(),
}).strict()

const AlignX = z.union([z.literal('left'), z.literal('right'), z.literal('center')])
const AlignY = z.union([z.literal('top'), z.literal('bottom'), z.literal('center')])
const Layout = Size.extend({
  x: z.union([AlignX, z.object({ offset: z.union([Pixels, Percentage]).default('0px'), align: AlignX.default('left') })]).default('left').transform(val => typeof val === 'object' ?  val : { offset: '0px', align: val }),
  y: z.union([AlignY, z.object({ offset: z.union([Pixels, Percentage]).default('0px'), align: AlignY.default('top') })]).default('top').transform(val => typeof val === 'object' ?  val : { offset: '0px', align: val }),
}).strict()

const ClipLayout = Layout.transform(val => ({
  relative_to: 'BACKGROUND',
  ...val,
}))

const ClipBase = z.object({
  id: ClipId.optional(),
  layout: ClipLayout.default({}),
  crop: ClipLayout.optional(),
  border: z.object({
    radius: Percentage.optional(),
  }).optional(),
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
  keypoints: z.object({
    name: z.string(),
    timestamp: Timestamp,
    allow_trim_start: z.boolean().default(true),
    allow_offset_start: z.boolean().default(true),
  }).strict().array().default([]),
  trim: z.object({
    start: Timestamp.optional(),
    stop: z.union([Timestamp, KeypointReference]).optional(),
    variable_length: z.union([z.literal('start'), z.literal('stop')]).optional(),
  }).strict().optional(),
  duration: z.union([Timestamp, KeypointReference]).optional(),
}).strict()

const MediaClip = ClipBase.extend({
  source: z.string(),
  volume: Percentage.default('100%'),
  chromakey: Color.optional(),
}).strict().transform(val => ({ ...val, type: 'media' as const }))

const CssNumber = z.union([
  z.number(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]).transform(v => {
  if (typeof v === 'number') return {left:v, right: v, top: v, bottom: v}
  else if (v.length === 2) return {top: v[0], bottom: v[0], left: v[1], right: v[1]}
  else if (v.length === 3) return {top: v[0], left: v[1], right: v[1], bottom: v[2]}
  else if (v.length === 4) return {top: v[0], right: v[1], left: v[2], bottom: v[3]}
  else throw new Error(`unexpected css values ${v}`)
})
const TextClip = ClipBase.extend({
  text: z.string(),
  font: z.object({
    family: z.string().optional(),
    size: z.number().default(16),
    color: Color.default('black'),
    border_radius: z.number().min(0).default(0),
    border_size: z.number().min(0).default(0),
    padding: CssNumber.default(0),
    background_color: Color.optional(),
    border_color: Color.default('white'),
    border_style: z.enum(['contour', 'block']).default('block'),
    outline_color: Color.default('gray'),
    outline_size: z.number().min(0).default(0),
    align: z.enum(['left', 'right', 'center']).default('center'),
  }).strict().default({}),
}).strict().transform(val => ({ ...val, type: 'text' as const }))

interface TimelineClipParsed extends Required<Omit<t.TimelineClip, 'next' | 'id'>> {
  id?: t.ClipID
  next: TimelineClipParsed[]
}
// note that we dont appear to have type assertion for lazy types.
// we just have to be certain these types match!
const TimelineClip: z.ZodSchema<TimelineClipParsed, z.ZodTypeDef, t.TimelineClip> = z.lazy(() => z.object({
  id: ClipIdReference,
  offset: z.union([Timestamp, KeypointReference]).default('0'),
  z_index: z.number().default(0),
  next_order: z.union([z.literal('parallel'), z.literal('sequence')]).default('parallel'),
  next: TimelineClip.array().default([]),
}))

const Template = z.object({
  // TODO is this a shared reference?
  // size: z.mer([Size, z.object({ background_color: Color.optional() })]).default({}),
  // Size.and(z.object({ background_color: Color.optional() })).default({}),
  size: Size.merge(z.object({ background_color: Color.optional() })).default({}),

  clips: z.record(ClipId, MediaClip)
    .refine(clips => Object.keys(clips).length > 0, { message: 'clips must contain at least one entry' })
    .transform(clips => {
      return Object.entries(clips).map(([clip_id, clip], i) => {
        clip.id = clip_id
        return clip as MediaClipParsed
      })
    }),

  // captions: TextClip
  //   .array()
  //   .transform(clips => clips.map((val, i) => ({ ...val, id: val.id ?? `TEXT_${i}` })))
  //   .default([]),

  captions: z.record(ClipId, TextClip)
    // .transform(clips => clips.map((val, i) => ({ ...val, id: val.id ?? `TEXT_${i}` })))
    // .default({})
    .transform(clips => {
      return Object.entries(clips)
        .map(([clip_id, clip], i) => {
          clip.id = clip_id
          return clip as TextClipParsed
        })
    })
    .default({}),

  timeline: TimelineClip.array().min(1).optional(),
  preview: Timestamp.default('0'),
}).transform(val => ({
  timeline: val.clips
    .map(c => TimelineClip.parse({ id: c.id }))
    .concat(val.captions.map(c => TimelineClip.parse({ id: c.id }))),
  ...val,
  size: { relative_to: val.clips[0].id, ...val.size, },
}))

// this is a typescript exacty type assertion. It does nothing at runtime
// it ensures that our zod validator and our typescript spec stay in sync
type TemplateInput = t.Template
type ZodTemplateInput = z.input<typeof Template>
exactly({} as ZodTemplateInput, {} as TemplateInput)


function pretty_zod_errors(error: z.ZodError) {
  return error.errors.map(e => {
    const path = e.path.join('.')
    return `  ${path}: ${e.message}`
  }).join('\n')
}

function unflatten(data_structure: Record<string, any>) {
  for (const [key, value] of Object.entries(data_structure)) {
    const is_dot_notation_key = key.includes('.')
    const value_is_object = typeof value === 'object'

    if (is_dot_notation_key) {
      const [parent, ...children] = key.split('.')
      if (children.length) {
        data_structure[parent] = data_structure[parent] ?? {}
        data_structure[parent][children.join('.')] = value
        unflatten(data_structure[parent])
      } else {
        throw new Error('unexpected code path')
      }
      delete data_structure[key]
    } else if (value_is_object){
      unflatten(data_structure[key])
    }
  }

  return data_structure
}


function parse_template(template_input: z.input<typeof Template> | unknown): z.infer<typeof Template> {
  try {
    // unflatten any dot string keys
    unflatten(template_input as Record<string, any>)

    const result = Template.parse(template_input)
    return result
  } catch (e) {
    if (e instanceof z.ZodError) throw new errors.InputError(`Invalid template format:\n${pretty_zod_errors(e)}`)
    else throw e
  
  }
}

export { parse_template }
export type MediaClipParsed = z.infer<typeof MediaClip> & { id: string }
export type TextClipParsed = z.infer<typeof TextClip> & { id: string }
export type TemplateParsed = z.infer<typeof Template>
export type SizeParsed = TemplateParsed['size']
export type LayoutParsed = TemplateParsed['clips'][0]['layout']
export type TimelineParsed = TemplateParsed['timeline']
