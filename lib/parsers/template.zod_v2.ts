import { z } from 'https://deno.land/x/zod@v3.9.0/mod.ts'
import * as t from '../template_input.zod.ts'
import { assert } from '../../type-equality.ts'


const Id = z.string().regex(/[a-zA-Z0-9-_]/)

const Pixels = z.string().regex(/\d+px/)

const Percentage = z.string().regex(/\d+%/)

const Degrees = z.number().min(0).max(360)

const Color = z.string()

const Timestamp = z.string() // I think we will delay parsing this till after we probe files because we need access to full file durations to resolve variables

const Size = z.object({
  width: z.union([Pixels, Percentage]).optional(),
  height: z.union([Pixels, Percentage]).optional(),
  relative_to: Id.optional(),
})

const AlignX = z.union([z.literal('left'), z.literal('right'), z.literal('center')])
const AlignY = z.union([z.literal('top'), z.literal('bottom'), z.literal('center')])
const Layout = Size.extend({
  x: z.union([AlignX, z.object({ offset: z.union([Pixels, Percentage]).optional(), align: AlignX.optional() })]).optional(),
  y: z.union([AlignY, z.object({ offset: z.union([Pixels, Percentage]).optional(), align: AlignY.optional() })]).optional(),
})

const ClipBase = z.object({
  id: Id.optional(),
  layout: Layout.optional(),
  crop: Layout.optional(),
  rotate: Degrees.optional(),
}).strict()

const MediaClip = ClipBase.extend({
  file: z.string(),
  volume: z.number().min(0).optional(),
})

const TextClip = ClipBase.extend({
  text: z.string(),
  font: z.object({
    family: z.string().optional(),
    size: z.number().optional(),
    color: Color.optional(),
    border_radius: z.number().min(0).optional(),
    padding: z.number().min(0).optional(),
    background_color: Color.optional(),
    outline_color: Color.optional(),
    outline_size: z.number().optional(),
  }).strict().optional()
})

const Template = z.object({
  size: Size.optional(),
  clips: MediaClip.array().min(1),
  captions: TextClip.array().min(1).optional(),
  preview: Timestamp.optional(),
})

// this is a typescript exacty type assertion. It does nothing at runtime
assert({} as z.input<typeof Template>, {} as t.Template)
