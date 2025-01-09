import * as path from '@std/path'
import * as skia_canvas from '@gfx/canvas'
// @deno-types="@types/culori"
import * as culori from 'culori'
import { compute_size } from '../geometry.ts'
import type { Context } from '../context.ts'
import type { TextClipParsed, MediaClipParsed } from '../parsers/template.ts'

// first in the list gets highest priority
const PRIORITIED_FONT_FAMILIES = [
  'arial',
  'roboto',
  'helevetica',
  'courier',
  'comic sans',
  'verdana',
  'georgia',
  'garamond',
  'trebuchet',
  'calibri',
]


function auto_wrap_text(
  context: Context,
  canvas_context: skia_canvas.CanvasRenderingContext2D,
  text_clip: TextClipParsed
) {
  const max_size = compute_size(context, text_clip.layout)

  const text_lines_wrapped: string[] = []

  for (const line of text_clip.text.split('\n')) {
    let current_line = ''
    const wrapped: string[] = []
    for (const word of line.split(' ')) {
      // Measure the width of the current line plus the word to see if it fits within max_width
      const test_line = current_line ? `${current_line} ${word}` : word;
      const metrics = canvas_context.measureText(test_line);

      if (metrics.width <= max_size.width) {
        // If it fits, add the word to the current line
        current_line = test_line;
      } else {
        // If it doesn't fit, push the current line and start a new line
        if (current_line === '') {
          current_line = ' ' // canvas doesnt play nice with empty strings
        }
        wrapped.push(current_line);
        current_line = word; // Start new line with current word
      }
    }

    // Push the last line if any
    if (current_line) {
      wrapped.push(current_line);
    }

    text_lines_wrapped.push(...wrapped)
  }

  return text_lines_wrapped
}

async function create_text_image(
  context: Context,
  text_clip: TextClipParsed
): Promise<MediaClipParsed> {
  const text_assets_folder = path.join(context.output_folder, 'text_assets')
  await Deno.mkdir(text_assets_folder, { recursive: true })
  const { font } = text_clip
  const { background_color, border_radius, padding } = font
  const padding_horizontal = padding.left + padding.right
  const padding_vertical = padding.top + padding.bottom
  if (padding_horizontal || padding_vertical) {
    throw new Error('unimplemented')
  }

  const {width: max_width, height: max_height} = compute_size(context, text_clip.layout)
  const text_clip_input = context.template_input.captions?.[text_clip.id]
  if (text_clip_input === undefined) throw new Error(`unexpected code path. Input clip ${text_clip.id} does not exist`)

  const CUSTOM_FONT_ALIAS = 'custom-font-alias'
  let font_buffer: Uint8Array | undefined
  if (font.family) {
    const font_path =  path.resolve(context.cwd, font.family)
    font_buffer = await Deno.readFile(font_path)
    skia_canvas.Fonts.register(font_buffer, CUSTOM_FONT_ALIAS)
  }
  const text_color = culori.parse(font.color)
  if (!text_color) {
    throw new Error(`Failed to parse font color ${font.color}`)
  }
  const canvas_instance = skia_canvas.createCanvas(max_width, max_height)
  const canvas_context = canvas_instance.getContext('2d')

  if (font.family) {
    canvas_context.font = `${text_clip.font.size}px ${CUSTOM_FONT_ALIAS}`
  } else {

    const ordered_font_families = skia_canvas.Fonts.families
      .filter(family => PRIORITIED_FONT_FAMILIES.find(f => family.toLowerCase().includes(f)))
      .sort((a, b) => {
        const family_a = a.toLowerCase()
        const family_b = b.toLowerCase()
        const index_a = PRIORITIED_FONT_FAMILIES.findIndex(name => family_a.includes(name))
        const index_b = PRIORITIED_FONT_FAMILIES.findIndex(name => family_b.includes(name))

        if (index_a !== -1 && index_b !== -1) {
          // If both are known strings, sort them based on their order in knownStrings
          if (index_a === index_b) {
            // small little rule, if two fonts share the same family identifier, lets prefer fonts with shorter names, since those are typically the default
            return family_a.length - family_b.length
          }
          return index_a - index_b;
        } else if (index_a !== -1) {
          // If a is a known string and b is not, a should come first
          return -1;
        } else if (index_b !== -1) {
          // If b is a known string and a is not, b should come first
          return 1;
        } else {
          // If neither are known strings, maintain their relative order
          return 0;
        }
      })
    const default_font = ordered_font_families[0]
    canvas_context.font = `${text_clip.font.size}px ${default_font}`
  }

  canvas_context.textAlign = font.align
  // canvas_context.letterSpacing = '10px'
  const metrics = canvas_context.measureText(text_clip.text)
  const formatted_text = auto_wrap_text(context, canvas_context, text_clip)

  if (background_color) {
    let line_height = 0
    canvas_context.fillStyle = background_color
    for (const formatted_line of formatted_text) {
      const metrics = canvas_context.measureText(formatted_line)
      let x = 0
      canvas_context.textAlign = font.align
      if (font.align === 'left') {
        x = 0
      }
      if (font.align === 'right') {
        x = Math.max(max_width - metrics.width, 0)
      }
      if (font.align === 'center') {
        x = (max_width) / 2 - metrics.width / 2
      }
      const y = line_height
      line_height = y + metrics.emHeightAscent
      canvas_context.beginPath()
      canvas_context.roundRect(x, y, metrics.width, metrics.emHeightAscent + metrics.emHeightDescent, border_radius)
      canvas_context.fill()
    }
    canvas_context.beginPath()
  }

  if (font.outline_size) {
    canvas_context.lineWidth = font.outline_size
    canvas_context.strokeStyle = font.outline_color

    let line_height = 0
    for (const formatted_line of formatted_text) {
      const metrics = canvas_context.measureText(formatted_line)
      let x = 0
      canvas_context.textAlign = font.align
      if (font.align === 'left') {
        x = 0
      }
      if (font.align === 'right') {
        x = metrics.width
      }
      if (font.align === 'center') {
        x = (max_width) / 2
      }
      const y = line_height + metrics.emHeightAscent
      line_height = y
      canvas_context.strokeText(formatted_line, x, y)
    }
  }

  canvas_context.lineWidth = font.size
  canvas_context.fillStyle = font.color
  let line_height = 0
  for (const formatted_line of formatted_text) {
    const metrics = canvas_context.measureText(formatted_line)
    let x = 0
    canvas_context.textAlign = font.align
    if (font.align === 'left') {
      x = 0
    }
    if (font.align === 'right') {
      x = metrics.width
    }
    if (font.align === 'center') {
      x = (max_width) / 2
    }
    const y = line_height + metrics.emHeightAscent
    line_height = y
    canvas_context.fillText(formatted_line, x, y)
    canvas_context.stroke()
  }

  const text_image_asset = path.resolve(text_assets_folder, text_clip.id + '.png')
  canvas_instance.save(text_image_asset) // NOTE this is a synchronous file write
  context.logger.info(`Generated text asset for clip ${text_clip.id}`)

  return {
    type: 'media',
    // TODO, internally prefix media clips w/ "clip:" to ensure there are no overwrites with the id here
    id: text_clip.id,
    source: text_image_asset,
    layout: {
      ...text_clip.layout,
      relative_to: text_clip.layout.relative_to ?? text_clip.id,
    },
    duration: text_clip.duration,
    keypoints: [],
    volume: '100%',
    speed: '100%',
  }
}

export { create_text_image }
