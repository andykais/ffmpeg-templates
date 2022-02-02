import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import CanvasKit, { createCanvas } from "https://deno.land/x/canvas@v1.3.0/mod.ts"
import type { Paragraph } from "https://deno.land/x/canvas@v1.3.0/mod.ts"
import { parse_unit } from '../parsers/unit.ts'
import type { Context } from '../context.ts'
import type { TextClipParsed } from '../parsers/template.zod.ts'
import { ContextExtended } from './round-rect.ts'

function measure_text(text_clip: TextClipParsed, font_buffer?: Uint8Array) {
  const fontMgr = font_buffer ? CanvasKit.FontMgr.FromData(font_buffer) : CanvasKit.FontMgr.RefDefault()
  if (fontMgr === null)  throw new Error('idk why but fontMgr is null')
  const paraStyle = new CanvasKit.ParagraphStyle({
    textStyle: {
      color: CanvasKit.BLACK,
      fontFamilies: [fontMgr.getFamilyName(0)],
      fontSize: text_clip.font.size,
    },
  })
  const builder = CanvasKit.ParagraphBuilder.Make(paraStyle, fontMgr)
  builder.addText(text_clip.text)
  const paragraph = builder.build()
  paragraph.layout(Infinity)
  const left = Math.max(...paragraph.getLineMetrics().map(l => l.left))
  const right = paragraph.getLongestLine() + left
  const ascent = Math.max(...paragraph.getLineMetrics().map(l => l.ascent))
  const descent = Math.max(...paragraph.getLineMetrics().map(l => l.descent))
  const height = ascent + descent
  const width = right
  const metrics = { ascent, descent, left, right, width, height, paragraph }
  // paragraph.delete()
  fontMgr.delete()
  return metrics
}

function get_metrics(paragraph: Paragraph) {
  const left = Math.max(...paragraph.getLineMetrics().map(l => l.left))
  const right = paragraph.getLongestLine() + left
  const ascent = Math.max(...paragraph.getLineMetrics().map(l => l.ascent))
  const descent = Math.max(...paragraph.getLineMetrics().map(l => l.descent))
  const height = ascent + descent
  const width = right
  return { ascent, descent, left, right, width, height, paragraph }
}


async function create_text_image_backup(
  context: Context,
  size: {background_width: number, background_height: number},
  text_clip: TextClipParsed
) {
  const x = 0
  const y = 0
  const width = parse_unit(text_clip.layout.width, { percentage: (p) => p * size.background_width })
  const height = parse_unit(text_clip.layout.height, { percentage: (p) => p * size.background_height })
  // TODO canvas width/height should be smarter.
  // width & height should be determined by the actual text size.
  // max_width & max_height should come from layout
  // text overflowing max_width should be wrapped
  // text overflowing max_height should be cropped (possibly with a real crop, which would allow panning text up)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  const text_assets_folder = path.join(context.output_folder, 'text_assets')
  await Deno.mkdir(text_assets_folder, { recursive: true })

  let font_buffer: Uint8Array | undefined
  let font_mgr = CanvasKit.FontMgr.RefDefault()
  const { font } = text_clip
  const { family } = text_clip.font
  if (family) {
    const font_path =  path.resolve(context.cwd, family)
    font_buffer = await Deno.readFile(font_path)
    canvas.loadFont(font_buffer, {family: 'nonce'})
    ctx.font = `${font.size}px nonce`
  } else {
    const system_font_family = ctx.font.split(' ')[1]
    ctx.font = `${font.size}px ${system_font_family}` // TODO how to get the builtin font name?
  }
  const metrics = measure_text(text_clip, font_buffer)
  // TODO this should fill the stroked border, not just a rectangle
  if (font.background_color) {
    ctx.fillStyle = font.background_color
    ctx.fillRect(0, 0, metrics.width, metrics.height)
    // ctx.fillRect(x - metrics.left, y - metrics.ascent, metrics.width, metrics.height)
  }
  ;(ctx.canvas as any).drawParagraph(metrics.paragraph, 0, 0)
  // ctx.fillStyle = 'black'
  // ctx.fillText(text_clip.text, x + metrics.left, y + metrics.ascent)
  const text_image_asset = path.resolve(text_assets_folder, text_clip.id + '.png')
  await Deno.writeFile(text_image_asset, canvas.toBuffer())

  // debug only
  // await Deno.run({ cmd: ['./imgcat.sh', text_image_asset] }).status()
  // console.log('done')
  // console.log({ family, metrics })
}

async function create_text_image(
  context: Context,
  size: {background_width: number, background_height: number},
  text_clip: TextClipParsed
) {
  const text_assets_folder = path.join(context.output_folder, 'text_assets')
  await Deno.mkdir(text_assets_folder, { recursive: true })
  const x = 0
  const y = 0
  const implicit_width = text_clip.layout.relative_to === text_clip.id && parse_unit(text_clip.layout.width, { pixels: () => false, percentage: () => true })
  const implicit_height = text_clip.layout.relative_to === text_clip.id && parse_unit(text_clip.layout.height, { pixels: () => false, percentage: () => true })

  const max_width = parse_unit(text_clip.layout.width, { percentage: (p) => p * size.background_width })
  const max_height = parse_unit(text_clip.layout.height, { percentage: (p) => p * size.background_height })
  const text_clip_input = context.template_input.captions?.find((c, i)=> c.id ?? `TEXT_${i}` === text_clip.id)
  if (text_clip_input === undefined) throw new Error(`unexpected code path. Input clip ${text_clip.id} does not exist`)
  const explicitly_set_width = text_clip_input.layout?.width !== undefined
  const explicitly_set_height = text_clip_input?.layout?.height !== undefined
  // TODO canvas width/height should be smarter.
  // width & height should be determined by the actual text size.
  // max_width & max_height should come from layout
  // text overflowing max_width should be wrapped
  // text overflowing max_height should be cropped (possibly with a real crop, which would allow panning text up)
  let font_mgr = CanvasKit.FontMgr.RefDefault()
  const { font } = text_clip
  if (font.family) {
    const font_path =  path.resolve(context.cwd, font.family)
    const font_buffer = await Deno.readFile(font_path)
    font_mgr.delete()
    const font_mgr_maybe = CanvasKit.FontMgr.FromData(font_buffer)
    if (font_mgr_maybe === null) throw new Error('unhandled font manager state null')
    font_mgr = font_mgr_maybe
  }
  const paraStyle = new CanvasKit.ParagraphStyle({
    textStyle: {
      color: CanvasKit.BLACK,
      fontFamilies: [font_mgr.getFamilyName(0)],
      fontSize: text_clip.font.size,
    },
  })
  const builder = CanvasKit.ParagraphBuilder.Make(paraStyle, font_mgr)
  builder.addText(text_clip.text)
  const paragraph = builder.build()
  paragraph.layout(max_width)
  const metrics  = get_metrics(paragraph)

  const width = explicitly_set_width ? max_width : metrics.width
  const height = explicitly_set_height ? max_height : metrics.height
  console.log({ width, height })
  const canvas = createCanvas(Math.floor(width), Math.floor(height))
  const ctx = canvas.getContext('2d')
  const ctx_extended = new ContextExtended(ctx)

  if (font.background_color) {
    console.log('background color')
    if (font.border_radius) {
      console.log('radius')
      ctx.save()
      // context.strokeStyle = 'red'
      // context.fillRect(0, 0, metrics.width, metrics.fontBoundingBoxAscent + metrics.actualBoundingBoxDescent)
      ctx.fillStyle = font.background_color
      const x = 0
      const y = 0
      const padding = 0
      ctx_extended.roundRect(
        x,
        y,
        metrics.width + x + padding * 2,
        metrics.height + padding * 2,
        [font.border_radius]
      )
     ctx.fill()
     ctx.restore()
    } else {
      console.log('no radius')
      ctx.fillStyle = font.background_color
      ctx.fillRect(0, 0, metrics.width, metrics.height)
    }
  }
  ;(ctx.canvas as any).drawParagraph(metrics.paragraph, 0, 0)
  const text_image_asset = path.resolve(text_assets_folder, text_clip.id + '.png')
  await Deno.writeFile(text_image_asset, canvas.toBuffer())

  // debug only
  // await Deno.run({ cmd: ['./imgcat.sh', text_image_asset] }).status()
  paragraph.delete()
  font_mgr.delete()
}

export { create_text_image }
