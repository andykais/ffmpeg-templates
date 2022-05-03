import * as path from 'https://deno.land/std@0.134.0/path/mod.ts'
import { serve } from "https://deno.land/std@0.134.0/http/server.ts";
import type { InstanceContext } from '../context.ts'


async function read_html() {
  console.log(import.meta.url)
  const index_filepath = path.join(path.basename(import.meta.url), 'index.html')
  return await Deno.readTextFile(index_filepath)
}

type RouteFn = () => Promise<Response>
const build_routes = (routes: {[url: string]: RouteFn}) => {
  const patterns: URLPattern[] = []
  const fns: RouteFn[] = []

  let index = 0
  for (const [route, fn] of Object.entries(routes)) {
    patterns.push(new URLPattern({ pathname: route }))
    fns.push(fn)
    index++
  }

  return async (request: Request) => {
    for (const index of patterns.keys()) {
      const pattern = patterns[index]
      if (pattern.exec(request.url)) {
        const fn = fns[index]
        return await fn()
      }
    }
    const url_parts = new URL(request.url)
    return new Response(`Page ${url_parts.pathname} not found`, { status: 404 })
  }
}

const router = build_routes({
  '/': async () => {
    const html = await read_html()
    return new Response(html)
  },
  '/preview.jpg': async () => {
    return new Response('preview.jpg')
  },
  '/sse': async () => {
    return new Response('tbd')
  }
})


class PreviewServer {
  public constructor(private instance: InstanceContext, private port: number = 8080) {
  }

  public async start() {
    const server_promise = serve(this.request_handler, { port: this.port })
    this.instance.logger.info('launching preview server')

    this.instance.logger.info(`  local:   http://localhost:${this.port}`)
    // this.instance.logger.info(`  network: http://xxxx:${this.port}`)
    await server_promise
  }

  public notify(event: string, data: any) {

  }

  private request_handler = async (request: Request): Promise<Response> => {
    return await router(request)

//     switch(request.url) {
//       case '/':
//         const html = await read_html()
//         return new Response(html)
//         break
//       case '/preview.jpg':
//         break
//       case '/sse':
//         break
//       default:
//         return new Response(`Page '${request.url}' not found`, { status: 404 })
//     }
//     return new Response('hello world')
  }
}

export { PreviewServer }
