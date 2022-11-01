import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.91.0/fs/mod.ts'
import ffmpeg_templates from '../lib/cli.zod.ts'
import { render_sample_frame } from '../lib/mod.zod.ts'
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

// NOTE ffprobe info map cache is shared between tests

Deno.test('zoompan', async () => {
  await rmrf('test/resources/zoompan')
  await ffmpeg_templates('test/resources/zoompan.yml', '--debug', '--quiet')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/ffmpeg-templates-projects/test/resources/zoompan/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/zoompan/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})

Deno.test('speed', async () => {
  await rmrf('test/resources/speed')
  await ffmpeg_templates('test/resources/speed.yml', '--debug', '--quiet')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/ffmpeg-templates-projects/test/resources/speed/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/speed/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})

Deno.test({
  name: 'empty preview',
  fn: async () => {
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
  },
  // only: true
})
