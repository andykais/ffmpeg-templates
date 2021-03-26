import * as path from 'https://deno.land/std@0.75.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.75.0/fs/mod.ts'
import ffmpeg_templates from '../lib/cli.ts'
import { createHash } from 'https://deno.land/std@0.75.0/hash/mod.ts'
import { assertEquals } from "https://deno.land/std@0.90.0/testing/asserts.ts";



async function assert_file_md5(path: string, md5checksum: string) {
  const hash = createHash('md5')
  const file = await Deno.open(path)
  for await (const chunk of Deno.iter(file)) hash.update(chunk)
  Deno.close(file.rid)
  assertEquals(hash.toString(), md5checksum)

}

Deno.test('zoompan', async () => {
  await Deno.remove('test/resources/zoompan/ffmpeg.sh')
  await ffmpeg_templates('test/resources/zoompan.yml', '--overwrite', '--debug')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/zoompan/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/zoompan/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})

Deno.test('speed', async () => {
  await Deno.remove('test/resources/speed/ffmpeg.sh')
  await ffmpeg_templates('test/resources/speed.yml', '--overwrite', '--debug')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/speed/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/speed/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
})
