import * as path from '@std/path'
import * as assert from '@std/assert'


const TEST_DIR = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)))

async function assert_file_equals(actual_filepath: string, expected_filepath: string) {
  const actual_file_data = await Deno.readFile(actual_filepath)
  const expected_file_data = await Deno.readFile(expected_filepath)
  console.log('expected_file_data length:', expected_file_data.length)
  console.log('actual_file_data length:', actual_file_data.length)
  assert.assertEquals(actual_file_data, expected_file_data)
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
