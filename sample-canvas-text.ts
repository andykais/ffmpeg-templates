import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { createCanvas } from 'https://deno.land/x/canvas/mod.ts'

const canvas = createCanvas(500, 500)
const context = canvas.getContext('2d')

interface FontOptions {
  family?: string
  size?: number
  background_color?: string
  background_size?: number // or padding
  background_radius?: number // or border_radius
}

async function draw_text(text: string, x: number, y: number, options: FontOptions) {
  const { family, size = 16 } = options
  let font_name = 'Comic Sans'
  if (family) {
    const font_buffer = await Deno.readFile(family)
    canvas.loadFont(font_buffer, {
      family: font_name,
    })
  }

  context.fillStyle = 'white'
  context.fillRect(0, 0, 100, 100)
  context.fillStyle = 'black'
  context.font = `${size}px ${font_name}`
  context.textBaseline = 'top'
  context.fillText(text, x, y)
}

draw_text('hello world', 50, 50, { size: 50, family: './samples/qd-better-comic-sans-font/Qdbettercomicsans-jEEeG.ttf' })

await Deno.writeFile('canvas.png', canvas.toBuffer())
