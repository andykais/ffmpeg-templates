import { parse_template } from '../lib/parsers/template.zod.ts'

type IfEquals<T, U, Y=unknown, N=never> =
  (<G>() => G extends T ? 1 : 2) extends
  (<G>() => G extends U ? 1 : 2) ? Y : N;

declare const exact_type: <T, U>(
  draft: T & IfEquals<T, U>,
  expected: U & IfEquals<T, U>
) => IfEquals<T, U>




Deno.test('parse_template', async () => {
  const template = parse_template({
    clips: [{
      id: 'TEST',
      file: './resources/assets/Pexels Videos 2048452.mp4',
      layout: {
        width: '100px',
      },
    },
    {
      file: 'test',
      layout: { x: 'left' },
    }]
  } as any)

  console.log(template)

  const clip = template.clips[0]
  // exact_type(template.clips[0].layout, null) // error
})
