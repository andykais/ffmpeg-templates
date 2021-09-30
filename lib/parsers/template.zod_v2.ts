import { z } from 'https://deno.land/x/zod@v3.9.0/mod.ts'
import { Template } from '../template_input.zod.ts'


const DateTimer: z.Schema<z.infer<typeof DateTimer>, z.ZodTypeDef, string> = z.string().transform(() => new Date())


const Id = z.string().regex(/[a-zA-Z0-9-_]/)

const ClipBase = z.object({
  id: Id.optional(),
}).strict()

const MediaClip = ClipBase.extend({
  file: z.string(),
})

const TextClip = ClipBase.extend({
  text: z.string(),
  font: z.object({
    family: z.string(),
  }).strict()
})


const TemplateInput = z.object({
  clips: MediaClip.array().min(1),
})



type ZodInput = z.input<typeof TemplateInput>
type ZodResult = z.infer<typeof TemplateInput>

function zod_parse(zod_input: ZodInput) {
  const result = TemplateInput.parse(zod_input)
  return result
}

function parse_template(template_input: Template): ZodResult {
  return zod_parse(template_input)
}


function fn(arg: { x: number }) {

}

let arg: { x: number; y?: number } = { x: 1, y: 2 }
fn(arg)

export { parse_template }
