import * as path from '@std/path'
import * as assert from '@std/assert'
import { crypto } from '@std/crypto'
import { encodeHex } from '@std/encoding/hex'

async function md5checksum(file_data: BufferSource) {
  const hash_buffer = await crypto.subtle.digest('MD5', file_data)
  return encodeHex(hash_buffer)
}

const TEST_DIR = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)))

async function assert_file_equals(actual_filepath: string, expected_filepath: string) {
  const actual_file_data = await Deno.readFile(actual_filepath)
  const expected_file_data = await Deno.readFile(expected_filepath)
  // NOTE we do not use assertEquals here because the std lib will check for equality and then perform a diff.
  // We do not need the diff, and it causes issues on CI with memory allocations
  if (actual_file_data.length !== expected_file_data.length) {
    const actual_hash = await md5checksum(actual_file_data)
    const expected_hash = await md5checksum(expected_file_data)
    throw new assert.AssertionError(`Expected file size of ${expected_file_data.length} for ${expected_filepath} does not match actual file size of ${actual_file_data.length} for ${actual_filepath}
Expected MD5 checksum: ${expected_hash}
Actual MD5 checksum:   ${actual_hash}`)

  }
  for (let i = 0; i < expected_file_data.length; i++) {
    const expected_byte = expected_file_data[i]
    const actual_byte = actual_file_data[i]
    if (actual_byte !== expected_byte || !Object.is(actual_byte, expected_byte)) {
      const actual_hash = await md5checksum(actual_file_data)
      const expected_hash = await md5checksum(expected_file_data)
      throw new assert.AssertionError(`Expected file ${expected_filepath} does not match actual file ${actual_filepath} at position ${i}
Expected MD5 checksum: ${expected_hash}
Actual MD5 checksum:   ${actual_hash}`)
    }
  }
}

interface Asserts {
  equals: typeof assert.assertEquals
  file: typeof assert_file_equals
}


const assets_folder = path.join(TEST_DIR, 'resources', 'assets')
const ASSETS = {
  berries_jpg: path.join(assets_folder, '1636302951890.jpg'),
  transparent_leaves_falling_mp4: path.join(assets_folder, 'century-leaf-falling-autumn-maple-leaves-falling-maple-autumn-leaves-falling-autumn-leaves-falling-against-black-background-free-video.mp4'),
  github_icon_png: path.join(assets_folder, 'github_icon.png'),
  bee_flower_mp4: path.join(assets_folder, 'Pexels Videos 2048452.mp4'),
  rainy_street_mp4: path.join(assets_folder, 'Video Of People Waiting For A Taxi On A Rainy Night.mp4'),
}

export interface TestContext {
  test_name: string
  artifacts_folder: string
  fixtures_folder: string
  assets_folder: string
  fonts: { source_code_pro: string }
  assert: Asserts
  assets: typeof ASSETS
}

type TestFunction = (t: TestContext) => Promise<void>

function test(test_name: string, fn: TestFunction, options: {skip?: boolean; only?: boolean} = {}) {
  const artifacts_folder = path.join(TEST_DIR, 'artifacts', test_name)
  const fixtures_folder = path.join(TEST_DIR, 'fixtures', test_name)

  async function refresh_folder(folder: string) {
    await Deno.remove(folder, { recursive: true }).catch(e => {
      if (e instanceof Deno.errors.NotFound) {}
      else throw e
    })
    await Deno.mkdir(folder, { recursive: true })
  }
  async function setup() {
    await refresh_folder(artifacts_folder)
  }


  async function test_function(deno_test_context: Deno.TestContext) {

    const test_context = {
      test_name,
      artifacts_folder,
      fixtures_folder,
      assets_folder,
      fonts: {
        source_code_pro: path.join(assets_folder, 'SourceSansPro-Regular.ttf')
      },
      assets: ASSETS,
      assert: {
        equals: assert.assertEquals,
        file: assert_file_equals,
      }
    }

    await setup()
    await fn(test_context)
  }

  Deno.test({
    name: test_name,
    fn: test_function,
    ignore: options.skip,
    ...options,
  })
}
test.skip = (test_name: string, fn: TestFunction) => test(test_name, fn, {skip: true})
test.only = (test_name: string, fn: TestFunction) => test(test_name, fn, {only: true})

export { test }
