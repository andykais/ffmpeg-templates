import * as path from 'https://deno.land/std@0.75.0/path/mod.ts'
import * as fs from 'https://deno.land/std@0.75.0/fs/mod.ts'
import { createHash } from 'https://deno.land/std@0.75.0/hash/mod.ts'
import { assertEquals } from "https://deno.land/std@0.90.0/testing/asserts.ts";



async function run_cli(...cmd: string[]) {
  const cmd_required_args = cmd.concat(['--quiet'])
  const proc = Deno.run({ cmd: cmd_required_args, stderr: 'piped' })
  const result = await proc.status()
  if (result.code !== 0) {
    const output = new TextDecoder().decode(await proc.stderrOutput())
    throw new Error(`Command ${cmd.join(' ')} failed\n\n${output}`)
  }
  proc.stderr?.close()
  proc.close()
}

async function get_file_md5checksum(path: string) {
  const hash = createHash('md5')
  const file = await Deno.open(path)
  for await (const chunk of Deno.iter(file)) hash.update(chunk)
  Deno.close(file.rid)
  return hash.toString()
}

Deno.test('zoompan', async () => {
  await run_cli('ffmpeg-templates', 'test/resources/zoompan.yml', '--overwrite', '--debug')
  const ffmpeg_cmd = await Deno.readTextFile('test/resources/zoompan/ffmpeg.sh')
  const ffmpeg_cmd_fixture = await Deno.readTextFile('test/fixtures/zoompan/ffmpeg.sh')
  assertEquals(ffmpeg_cmd, ffmpeg_cmd_fixture)
  const md5checksum = await get_file_md5checksum('test/resources/zoompan/ffmpeg.sh')
  // this step is kinda unnecessary, the debug cmd check should cover everything, otherwise we're testing ffmpeg
  assertEquals(md5checksum, 'a1c5189714c424af4f4e6be3748d9413')
})
