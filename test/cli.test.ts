import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.91.0/fs/mod.ts'
import ffmpeg_templates from '../lib/cli.ts'
import { render_sample_frame } from '../lib/mod.ts'
import { createHash } from 'https://deno.land/std@0.91.0/hash/mod.ts'
import { assertEquals } from "https://deno.land/std@0.91.0/testing/asserts.ts";


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
  await ffmpeg_templates('test/resources/zoompan.yml', '--debug')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/zoompan/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/zoompan/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})

Deno.test('speed', async () => {
  await rmrf('test/resources/speed')
  await ffmpeg_templates('test/resources/speed.yml', '--debug')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/speed/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/speed/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})

Deno.test('empty preview', async () => {
  await rmrf('test/resources/empty_preview')
  await ffmpeg_templates('test/resources/empty_preview.yml', '--debug', '--preview')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/empty_preview/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/empty_preview/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})
