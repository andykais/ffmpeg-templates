import { render_image, render_video } from '../lib/mod.ts'
import { path } from './tools/deps.ts'
import { test } from './tools/test.ts'

test('caption word wrapping', async t => {
  const template = {
    clips: {
      background_image: {
        source: path.join(t.assets_folder, '1636302951890.jpg'),
      }
    },

    'captions.CENTER_TEXT.text': 'Boy do I sure love Beans. Black beans, Kidney beans, coffee beans, you name it.\n Testing words that exceed the width:\n\nSupercalifragilisticexpialidocious',
    'captions.CENTER_TEXT.font.color': 'white',
    'captions.CENTER_TEXT.font.size': 75,
    'captions.CENTER_TEXT.layout.x': 'center',
    'captions.CENTER_TEXT.layout.y': 'center',
    'captions.CENTER_TEXT.layout.width': '600px',
  }
  const { output } = await render_image(template, {cwd: Deno.cwd(), output_folder: t.artifacts_folder, debug: true })
  await t.assert.file(output.current, path.join(t.fixtures_folder, 'preview.jpg'))
})

test('font outline', async t => {
  const template = {
    clips: {
      background_image: {
        source: path.join(t.assets_folder, '1636302951890.jpg'),
      }
    },

    'captions.CENTER_TEXT.text': 'Boy do I sure love Beans.',
    'captions.CENTER_TEXT.font.color': 'white',
    'captions.CENTER_TEXT.font.size': 75,
    'captions.CENTER_TEXT.font.outline_size': 9,
    'captions.CENTER_TEXT.font.outline_color': 'black',
    'captions.CENTER_TEXT.layout.x': 'center',
    'captions.CENTER_TEXT.layout.y': 'center',
    'captions.CENTER_TEXT.layout.width': '600px',
  }
  const { output } = await render_image(template, {cwd: Deno.cwd(), output_folder: t.artifacts_folder, debug: true })
  await t.assert.file(output.current, path.join(t.fixtures_folder, 'preview.jpg'))
})

test('font background', async t => {
  const template = {
    clips: {
      background_image: {
        source: path.join(t.assets_folder, '1636302951890.jpg'),
      }
    },

    'captions.CENTER_TEXT.text': 'Boy do I sure love Beans.',
    'captions.CENTER_TEXT.font.color': 'white',
    'captions.CENTER_TEXT.font.size': 75,
    'captions.CENTER_TEXT.font.outline_size': 9,
    'captions.CENTER_TEXT.font.outline_color': 'black',
    'captions.CENTER_TEXT.font.background_color': 'hsl(10, 75%, 50%)',
    'captions.CENTER_TEXT.font.border_radius': 10,
    'captions.CENTER_TEXT.layout.x': 'center',
    'captions.CENTER_TEXT.layout.y': 'center',
    'captions.CENTER_TEXT.layout.width': '600px',
  }
  const { output } = await render_image(template, {cwd: Deno.cwd(), output_folder: t.artifacts_folder, debug: true })
  await t.assert.file(output.current, path.join(t.fixtures_folder, 'preview.jpg'))
})

test('dot notation only caption', async t => {
  const template = {
    clips: {
      background_image: {
        source: path.join(t.assets_folder, '1636302951890.jpg'),
      }
    },

    'captions.CENTER_TEXT.text': 'Beans',
    'captions.CENTER_TEXT.font.color': 'white',
    'captions.CENTER_TEXT.font.size': 100,
    'captions.CENTER_TEXT.font.align': 'center',
    'captions.CENTER_TEXT.layout.x': 'center',
    'captions.CENTER_TEXT.layout.y': 'center',
  }
  const { render_data, output } = await render_image(template, {cwd: Deno.cwd(), output_folder: t.artifacts_folder, debug: true })
  await t.assert.file(output.current, path.join(t.fixtures_folder, 'preview.jpg'))
})

