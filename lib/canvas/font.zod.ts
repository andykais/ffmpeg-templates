import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import CanvasKit, { createCanvas } from "https://deno.land/x/canvas@v1.3.0/mod.ts"
import type { Paragraph } from "https://deno.land/x/canvas@v1.3.0/mod.ts"
import * as culori from 'https://deno.land/x/culori@v2.0.3/index.js'
import { parse_unit } from '../parsers/unit.ts'
import type { Context } from '../context.ts'
import type { TextClipParsed } from '../parsers/template.zod.ts'
import { ContextExtended } from './round-rect.ts'

function get_metrics(paragraph: Paragraph) {
  const left = Math.max(...paragraph.getLineMetrics().map(l => l.left))
  const right = paragraph.getLongestLine() + left
  const ascent = Math.max(...paragraph.getLineMetrics().map(l => l.ascent))
  const descent = Math.max(...paragraph.getLineMetrics().map(l => l.descent))
  const height = paragraph.getLineMetrics().reduce((acc, l) => l.height + acc, 0)
  const width = right
  return { ascent, descent, left, right, width, height, paragraph }
}


async function create_text_image(
  context: Context,
  size: {background_width: number, background_height: number},
  text_clip: TextClipParsed
) {
  const text_assets_folder = path.join(context.output_folder, 'text_assets')
  await Deno.mkdir(text_assets_folder, { recursive: true })
  // TODO figure these out in terms of relativity
  const x = 0
  const y = 0
  const implicit_width = text_clip.layout.relative_to === text_clip.id && parse_unit(text_clip.layout.width, { pixels: () => false, percentage: () => true })
  const implicit_height = text_clip.layout.relative_to === text_clip.id && parse_unit(text_clip.layout.height, { pixels: () => false, percentage: () => true })

  const { font } = text_clip
  const { background_color, border_radius, padding } = font
  const padding_horizontal = padding.left + padding.right
  const padding_vertical = padding.top + padding.bottom

  const max_width = parse_unit(text_clip.layout.width, { percentage: (p) => p * size.background_width }) + padding_horizontal
  const max_height = parse_unit(text_clip.layout.height, { percentage: (p) => p * size.background_height }) + padding_vertical
  const text_clip_input = context.template_input.captions?.find((c, i)=> c.id ?? `TEXT_${i}` === text_clip.id)
  if (text_clip_input === undefined) throw new Error(`unexpected code path. Input clip ${text_clip.id} does not exist`)
  const explicitly_set_width = text_clip_input.layout?.width !== undefined
  const explicitly_set_height = text_clip_input?.layout?.height !== undefined
  // TODO canvas width/height should be smarter.
  // [X] width & height should be determined by the actual text size.
  // [X] max_width & max_height should come from layout
  // [X] text overflowing max_width should be wrapped
  // [ ] text overflowing max_height should be cropped (possibly with a real crop, which would allow panning text up)
  let font_mgr = CanvasKit.FontMgr.RefDefault()
  let font_buffer: Uint8Array | undefined
  if (font.family) {
    const font_path =  path.resolve(context.cwd, font.family)
    font_buffer = await Deno.readFile(font_path)
    font_mgr.delete()
    const font_mgr_maybe = CanvasKit.FontMgr.FromData(font_buffer)
    if (font_mgr_maybe === null) throw new Error('unhandled font manager state null')
    font_mgr = font_mgr_maybe
  }
  const text_color: { r: number; g: number; b: number; alpha?: number } = culori.parse(font.color)
  const paraStyle = new CanvasKit.ParagraphStyle({
    textStyle: {
      color: CanvasKit.Color(
        text_color.r * 255,
        text_color.g * 255,
        text_color.b * 255,
        text_color.alpha,
      ),
      fontFamilies: [font_mgr.getFamilyName(0)],
      fontSize: text_clip.font.size,
    },
    textAlign: {
      left: CanvasKit.TextAlign.Left,
      right: CanvasKit.TextAlign.Right,
      center: CanvasKit.TextAlign.Center,
    }[font.align]
  })
  const builder = CanvasKit.ParagraphBuilder.Make(paraStyle, font_mgr)
  builder.addText(text_clip.text)
  const paragraph = builder.build()
  paragraph.layout(max_width)
  const metrics  = get_metrics(paragraph)

  const width = (explicitly_set_width ? max_width : metrics.width) + padding_horizontal
  const height = (explicitly_set_height ? max_height : metrics.height) + padding_vertical
  const canvas = createCanvas(Math.floor(width), Math.floor(height * 2))
  const ctx = canvas.getContext('2d')
  const ctx_extended = new ContextExtended(ctx)

  // To implement a _proper_ border background, we need to reimplement rounded-rect to build one giant single path around the border of all the lines of text.
  // This path will make all the rounding decisions per each corner.
  if (font.border_size) throw new Error('border_size unimplemented')


  const lines_metrics = paragraph.getLineMetrics()
  const border_style: 'contour' | 'block' = 'contour'
  if (background_color) {

    let y = 0
    for (const line_index of lines_metrics.keys()) {
      const line_metrics = lines_metrics[line_index]

      ctx.fillStyle = background_color

      const rounding = {topright: border_radius, bottomright: border_radius, topleft: border_radius, bottomleft: border_radius}

      if (lines_metrics[line_index - 1]) {
        const prev_line_metrics = lines_metrics[line_index - 1]
        if (prev_line_metrics.width === line_metrics.width) rounding.topright = 0
        else if (prev_line_metrics.width >= line_metrics.width + border_radius) rounding.topright = 0
        if (prev_line_metrics.left === line_metrics.left) rounding.topleft = 0
        else if (prev_line_metrics.left <= line_metrics.left - border_radius) rounding.topleft = 0
      }
      if (lines_metrics[line_index + 1]) {
        const next_line_metrics = lines_metrics[line_index + 1]
        if (next_line_metrics.width >= line_metrics.width) rounding.bottomright = 0
        if (next_line_metrics.left <= line_metrics.left) rounding.bottomleft = 0
      }
      const x = line_metrics.left
      ctx_extended.roundRect(
        x,
        y,
        line_metrics.width + padding_horizontal,
        line_metrics.height + padding_vertical,
        [rounding.topleft, rounding.topright, rounding.bottomright, rounding.bottomleft]
      )
      y = line_metrics.baseline + line_metrics.descent
    }
    ctx.fill()
  }
  ;(ctx.canvas as any).drawParagraph(metrics.paragraph, padding.left, padding.top)

  // Welp. This works, but strokeText has different letter spacing than the paragrpah api.
  // What that means is in reality, it looks like shit for most fonts.
  // I opened an issue here https://bugs.chromium.org/p/skia/issues/detail?id=12954
  if (font.outline_size) {
    if (font_buffer) {
      canvas.loadFont(font_buffer, { family: 'custom_font' })
      ctx.font = `${font.size}px custom_font`
    } else {
      ctx.font = `${font.size}px `
    }
    for (const line_metrics of lines_metrics) {
      const line_text = text_clip.text.slice(line_metrics.startIndex, line_metrics.endIndex)
      ctx.lineWidth = font.outline_size
      ctx.strokeStyle = font.outline_color
      const x = line_metrics.left + padding.left
      const y = line_metrics.baseline
      ctx.strokeText(line_text, x, y, line_metrics.width + padding_horizontal)
    }
  }
  const text_image_asset = path.resolve(text_assets_folder, text_clip.id + '.png')
  await Deno.writeFile(text_image_asset, canvas.toBuffer())

  paragraph.delete()
  font_mgr.delete()
}

export { create_text_image }
