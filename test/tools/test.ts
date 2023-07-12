import { path, assert } from './deps.ts'


const TEST_DIR = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)))

interface Asserts {
  equals: typeof assert.assertEquals
}

interface TestContext {
  test_name: string
  artifacts_folder: string
  fixtures_folder: string
  assets_folder: string
  assert: Asserts
}

type TestFunction = (t: TestContext) => Promise<void>

function test(test_name: string, fn: TestFunction, options: {skip?: boolean; only?: boolean} = {}) {
  const artifacts_folder = path.join(TEST_DIR, 'artifacts', test_name)
  const fixtures_folder = path.join(TEST_DIR, 'fixtures', test_name)
  const assets_folder = path.join(TEST_DIR, 'resources', 'assets')

  async function setup() {
    await Deno.remove(artifacts_folder, { recursive: true }).catch(e => {
      if (e instanceof Deno.errors.NotFound) {}
      else throw e
    })
    await Deno.mkdir(artifacts_folder, { recursive: true })
  }


  async function test_function(deno_test_context: Deno.TestContext) {

    const test_context = {
      test_name,
      artifacts_folder,
      fixtures_folder,
      assets_folder,
      assert: {
        equals: assert.assertEquals
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
