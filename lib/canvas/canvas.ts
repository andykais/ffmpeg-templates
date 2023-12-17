import { createCanvas } from 'https://deno.land/x/canvas@v1.3.0/mod.ts'
import { ContextExtended } from './round-rect.ts'

const canvas = createCanvas(500, 500)
const context =  canvas.getContext('2d')
const extended_canvas = new ContextExtended(context)

interface FontOptions {
  family?: string
  size?: number
  color?: string
  background_color?: string
  padding?: number
  border_radius?: number
  outline_color?: string
  outline_size?: number
}
// total height is not considered here. We will just overflow that bad boy
/*
 * draw_text takes in some text and wraps the text to fit the specified width.
 * the outputted canvas should be the specified width, and if the text is shorter than the width, it should be centered
 */
async function draw_text(text: string, width: number, options: FontOptions) {
  const  {
    color = 'black',
    family, size = 16,
    padding = 0,
    background_color,
    border_radius = 0,
    outline_size = 0,
    outline_color
  } = options

  context.textAlign = 'left'
  context.textBaseline = 'top'
  if (family) {
    const font = await Deno.readFile(family)
    const font_identifier = new Date().toString()
    canvas.loadFont(font, {
      family: font_identifier
    })
    context.font = `${size}px ${font_identifier}`
  }

  const text_chunks = text.split('\n')
  console.log({text_chunks})
  // let next_whitespace = 0
  // do {
  //   next_whitespace = text.indexOf('\n', next_whitespace)
  //   console.log(next_whitespace)
  // } while (next_whitespace !== -1)

  for (const text_chunk of text_chunks) {
    const metrics = context.measureText(text_chunk)
    console.log({text_chunk})
    let x = 0
    let y = 0

    if (background_color) {
      context.save()
      // context.strokeStyle = 'red'
      context.fillStyle = 'white'
      context.fillRect(0, 0, metrics.width, metrics.fontBoundingBoxAscent + metrics.actualBoundingBoxDescent)
      context.fillStyle = background_color
      // extended_canvas.roundRect(
      //   x,
      //   y,
      //   metrics.width + x + padding * 2,
      //   metrics.fontBoundingBoxAscent + metrics.actualBoundingBoxDescent + padding * 2,
      //   [border_radius]
      // )
     // context.fill()
     context.restore()
    }
    console.log(metrics)
    context.save();
    const text_x = x + padding
    const text_y = y + padding + metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxDescent
    if (outline_color !== undefined) {
      context.strokeStyle = outline_color;
      context.lineWidth = outline_size;
      context.lineJoin="round";
      context.miterLimit=2;
      context.strokeText(text_chunk, text_x, text_y);
    }
    context.fillStyle =  color
    context.fillText(text_chunk, text_x, text_y)
    context.restore();
  }
}

context.fillStyle = 'blue'
context.fillRect(0, 0, canvas.width, canvas.height)
await draw_text('Hello There', canvas.width, {
  family: './fonts/comic-sans/Qdbettercomicsans-jEEeG.ttf',
  // family: './fonts/stick-no-bills/StickNoBills-VariableFont_wght.ttf',
  size: 50,
  background_color: 'white',
  // padding: 10,
  // border_radius: 10,
  // outline_size: 6,
  // outline_color: 'red',
})
Deno.writeFile('canvas.png', await canvas.toBuffer())
