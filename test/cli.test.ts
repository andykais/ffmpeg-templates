import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.91.0/fs/mod.ts'
import ffmpeg_templates  from '../lib/cli.zod.ts'
import { render_sample_frame } from '../lib/mod.zod.ts'
import { type Template } from '../lib/template_input.zod.ts'
import { createHash } from 'https://deno.land/std@0.91.0/hash/mod.ts'
import { assertEquals } from "https://deno.land/std@0.97.0/testing/asserts.ts";


async function rmrf(path: string) {
  try {
    await Deno.remove(path, { recursive: true })
  } catch (e) {
    if (e.name !== 'NotFound') throw e
  }
}

async function assert_file_md5(path: string, md5checksum: string) {
  const hash = createHash('md5')
  const file = await Deno.open(path)
  for await (const chunk of Deno.iter(file)) hash.update(chunk)
  Deno.close(file.rid)
  assertEquals(hash.toString(), md5checksum)

}


interface TestContext {
  test_name: string
}
type TestFunction = (t: TestContext) => Promise<void>
function test(test_name: string, fn: TestFunction, options: {skip?: boolean; only?: boolean} = {}) {
  const t = { test_name }
  Deno.test({
    name: test_name,
    fn: () => fn(t),
    ignore: options.skip,
    ...options,
  })
}
test.skip = (test_name: string, fn: TestFunction) => test(test_name, fn, {skip: true})
test.only = (test_name: string, fn: TestFunction) => test(test_name, fn, {only: true})

// NOTE ffprobe info map cache is shared between tests


test('dot notation template', async () => {
  const template = {
    clips: [
      {
        file: './assets/Pexels Videos 2048452.mp4'
      },
      {
        file: './assets/Video Of People Waiting For A Taxi On A Rainy Night.mp4',
        ['layout.width']: '100%',
      }
    ]
  }
    const template_filepath = 'test/resources/dot_notation_template.yml'
    await Deno.writeTextFile(template_filepath, JSON.stringify(template))
    await ffmpeg_templates(template_filepath, '--debug', '--quiet', '--preview')
    const rendered_template = JSON.parse(await Deno.readTextFile('ffmpeg-templates-projects/dot_notation_template/rendered_template.json'))
    assertEquals(rendered_template, {
    clips: [
      {
        file: template.clips[0].file,
      },
      {
        file: template.clips[1].file,
        layout: {
          width: '100%'
        }
      }
    ]
  })
})

test('size.background_color', async () => {
  const template = {
    size: { background_color: 'red' },
    clips: [
      {
        file: './assets/Pexels Videos 2048452.mp4',
        'layout.x': 'center',
        'layout.y': 'center',
        'crop.width': '75%',
        'crop.height': '75%',
      }
    ]
  }
  const template_filepath = 'test/resources/size.background_color.yml'
  await Deno.writeTextFile(template_filepath, JSON.stringify(template))
  await ffmpeg_templates(template_filepath, '--debug', '--quiet', '--preview')
  const rendered_template = JSON.parse(await Deno.readTextFile('ffmpeg-templates-projects/size.background_color/rendered_template.json'))
})

test('captions.[].font.outline_style', async () => {
  const template = {
    size: { background_color: 'red' },
    clips: [
      {
        file: './assets/Pexels Videos 2048452.mp4',
        'layout.x': 'center',
        'layout.y': 'center',
        'crop.width': '75%',
        'crop.height': '75%',
      }
    ]
  }
  const template_filepath = 'test/resources/size.background_color.yml'
  await Deno.writeTextFile(template_filepath, JSON.stringify(template))
  await ffmpeg_templates(template_filepath, '--debug', '--quiet', '--preview')
  const rendered_template = JSON.parse(await Deno.readTextFile('ffmpeg-templates-projects/size.background_color/rendered_template.json'))
})

test('preview default clip duration', async t => {
  const template = {
    size: { background_color: 'blue' },
    clips: [
      {
        file: './assets/1636302951890.jpg',
      },
      {
        file: './assets/Pexels Videos 2048452.mp4',
        // 'layout.width': '75%',
        'layout.height': '50%',
        'layout.x': 'center',
        'layout.y': 'center',
        'crop.width': '600px',
        'crop.height': '600px',
      }
    ],
    preview: '5'
  }
  const template_filepath = `test/resources/${t.test_name}.yml`
  await Deno.writeTextFile(template_filepath, JSON.stringify(template))
  await ffmpeg_templates(template_filepath, '--debug', '--quiet', '--preview')
  const rendered_template = JSON.parse(await Deno.readTextFile(`ffmpeg-templates-projects/${t.test_name}/rendered_template.json`))
})

test('clips.[].chromakey', async (t) => {
  const template = {
    size: { background_color: 'blue' },
    clips: [
      {
        file: './assets/century-leaf-falling-autumn-maple-leaves-falling-maple-autumn-leaves-falling-autumn-leaves-falling-against-black-background-free-video.mp4',
        'trim.start': '3',
        'chromakey': 'black',
      }
    ]
  }
  const template_filepath = `test/resources/${t.test_name}.yml`
  await Deno.writeTextFile(template_filepath, JSON.stringify(template))
  await ffmpeg_templates(template_filepath, '--debug', '--quiet', '--preview')
  const rendered_template = JSON.parse(await Deno.readTextFile(`ffmpeg-templates-projects/${t.test_name}/rendered_template.json`))
})

test('zoompan', async () => {
  await rmrf('test/resources/zoompan')
  await ffmpeg_templates('test/resources/zoompan.yml', '--debug', '--quiet')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/ffmpeg-templates-projects/test/resources/zoompan/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/zoompan/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})

// skip until set up
test.skip('speed', async () => {
  await rmrf('test/resources/speed')
  await ffmpeg_templates('test/resources/speed.yml', '--debug', '--quiet')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/ffmpeg-templates-projects/test/resources/speed/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/speed/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})

test('empty preview',async () => {
    await rmrf('test/resources/empty_preview')
    await ffmpeg_templates('test/resources/empty_preview.yml', '--debug', '--quiet', '--preview')
    const ffmpeg_instructions = {
      loglevel: 'error',
      vframes: 1,
      inputs: {
        i: 'video.mp4',
        crop: {
          w:100,
          h:200,
          x:'x',
          y:'y',
          keep_aspect:1
        }
      }
    }
    const ffmpeg_cmd = await Deno.readTextFile('test/resources/ffmpeg-templates-projects/test/resources/empty_preview/ffmpeg.sh')
    console.log(ffmpeg_cmd)
    const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/empty_preview/ffmpeg.sh')
    console.log(ffmpeg_cmd_fixture)
    assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})
