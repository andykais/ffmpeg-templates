import * as path from '@std/path'
import * as fs from '@std/fs'
import ffmpeg_templates  from '../lib/cli.ts'
import { render_sample_frame, type Template, type TemplateParsed, type RenderData } from '../lib/mod.ts'
import { test, type TestContext } from './tools/test.ts'


async function rmrf(path: string) {
  try {
    await Deno.remove(path, { recursive: true })
  } catch (e) {
    if (e instanceof Error === false) throw e
    if (e.name !== 'NotFound') throw e
  }
}

// NOTE ffprobe info map cache is shared between tests

async function read_json(filepath: string) {
  return JSON.parse(await Deno.readTextFile(filepath))
}

async function cli_render(t: TestContext, template: Template, args: string[]) {
  const template_filepath = path.join(t.artifacts_folder, `${t.test_name}.yml`)
  const output_folder = path.join(t.artifacts_folder, 'project_output')

  await Deno.writeTextFile(template_filepath, JSON.stringify(template))
  await ffmpeg_templates(template_filepath, output_folder, '--debug', '--quiet', ...args)

  return {
    render_data: await read_json(path.join(output_folder, 'render_data.json')) as RenderData,
    rendered_template: await read_json(path.join(output_folder, 'rendered_template.json')) as TemplateParsed,
    preview_filepath: path.join(output_folder, 'preview.jpg'),
  }
}
async function cli_render_image(t: TestContext, template: Template, timestamp: string = '00:00:00') {
  return await cli_render(t, template, ['--preview', timestamp])
}
async function cli_render_video(t: TestContext, template: Template) {
  return await cli_render(t, template, [])
}


test('dot notation template', async t => {
  const template = {
    clips: [
      {
        source: t.assets.bee_flower_mp4,
      },
      {
        source: t.assets.rainy_street_mp4,
        'layout.width': '75%',
        'layout.x': 'center',
        'layout.y': 'center',
      }
    ],

    timeline: [
      { id: 'CLIP_0' },
      { id: 'CLIP_1', offset: '00:00:04' }
    ],

    preview: '3'
  }
  const output_1 = await cli_render_image(t, template, '00:00:00')
  // dot notation syntax should expand back into full schema syntax in the rendered template
  t.assert.equals(output_1.rendered_template.clips[0].layout, {
    relative_to: 'BACKGROUND',
    x: {align: 'left', offset: '0px'},
    y: {align: 'top', offset: '0px'},
  })
  // since we're here we can also test that previews only render the relevant clips
  t.assert.equals(Object.keys(output_1.render_data.clips), ['CLIP_0'])
  await t.assert.file(output_1.preview_filepath, path.join(t.fixtures_folder, 'preview_at_00:00:03.jpg'))

  template.preview = '5'
  const output_2 = await cli_render_image(t, template, '00:00:00')
  t.assert.equals(Object.keys(output_2.render_data.clips), ['CLIP_0', 'CLIP_1'])
  await t.assert.file(output_1.preview_filepath, path.join(t.fixtures_folder, 'preview_at_00:00:05.jpg'))
})

test('size.background_color', async t => {
  const template = {
    size: { background_color: 'red' },
    clips: [
      {
        source: t.assets.bee_flower_mp4,
        'layout.x': 'center',
        'layout.y': 'center',
        'crop.width': '75%',
        'crop.height': '75%',
      }
    ]
  }
  const output = await cli_render_image(t, template)
  await t.assert.file(output.preview_filepath, path.join(t.fixtures_folder, 'preview.jpg'))
})

test('captions.[].font.outline_style', async t => {
  const template: Template = {
    clips: [
      {
        source: t.assets.bee_flower_mp4,
      }
    ],
    captions: {
      beans: {
        text: 'Beans',
        font: {
          size: 100,
          outline_size: 6,
          outline_color: 'white',
        },
        layout: {x: 'center'}
      }
    }
  }
  const output = await cli_render_image(t, template)
  await t.assert.file(output.preview_filepath, path.join(t.fixtures_folder, 'preview.jpg'))
})

test('preview default clip duration', async t => {
  const template = {
    size: { background_color: 'blue' },
    clips: [
      {
        source: t.assets.berries_jpg,
      },
      {
        source: t.assets.bee_flower_mp4,
        'layout.height': '50%',
        'layout.x': 'center',
        'layout.y': 'center',
        'crop.width': '600px',
        'crop.height': '600px',
      }
    ],
    preview: '5'
  }
  const output = await cli_render_image(t, template)

  t.assert.equals(output.render_data.total_duration, undefined)
  t.assert.equals(output.render_data.clips.CLIP_0.duration, 14.698667)
  t.assert.equals(output.render_data.clips.CLIP_1.duration, 14.698667)

  await t.assert.file(output.preview_filepath, path.join(t.fixtures_folder, 'preview.jpg'))
})

test('clips.[].chromakey', async (t) => {
  const template = {
    size: { background_color: 'blue' },
    clips: [
      {
        source: t.assets.transparent_leaves_falling_mp4,
        'trim.start': '3',
        'chromakey': 'black',
      }
    ]
  }
  const output = await cli_render_image(t, template)
  await t.assert.file(output.preview_filepath, path.join(t.fixtures_folder, 'preview.jpg'))
})

// zoompan is not yet implemented
test.skip('zoompan', async t => {
  const template: Template = {
    size: {
      height: '200%',
      width: '50%',
    },
    clips: [
      {
        source: t.assets.bee_flower_mp4,
        trim: { variable_length: 'stop' },
        crop: { x: 'left', width: '50%' },
        zoompan: [
          { keyframe: '00:00:00', x: '50%' },
          { keyframe: '00:00:10', x: '0px' },
        ]
      },
      {
        source: t.assets.rainy_street_mp4,
        layout: { y: { align: 'bottom' }, height: '50%' },
        trim: { variable_length: 'stop' },
        crop: { x: 'right', width: '50%' },
        zoompan: [
          { keyframe: '00:00:10', x: '50%' },
        ]
      }
    ]
  }
  const output = await cli_render_video(t, template)
})

// skip until set up
test.skip('speed', async t => {
  await rmrf('test/resources/speed')
  await ffmpeg_templates('test/resources/speed.yml', '--debug', '--quiet')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/ffmpeg-templates-projects/test/resources/speed/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/speed/ffmpeg.sh')
  t.assert.equals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})

test('empty preview between clips', async t => {
  const template: Template = {
    clips: [
      {
        source: t.assets.bee_flower_mp4,
        duration: '2'
      },
      {
        source: t.assets.bee_flower_mp4,
        duration: '2'
      }
    ],

    timeline: [
      { id: 'CLIP_0' },
      { id: 'CLIP_1', offset: '00:00:04' }
    ],

    preview: '3'
  }
  const output = await cli_render_image(t, template)
  await t.assert.file(output.preview_filepath, path.join(t.fixtures_folder, 'preview.jpg'))
})
