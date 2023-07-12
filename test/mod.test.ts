import ffmpeg_templates from '../lib/cli.zod.ts'
import { render_image, render_video } from '../lib/mod.zod.ts'
import { path } from './tools/deps.ts'
import { test } from './tools/test.ts'


test('width scaling', async t => {
  const template = {
    clips: [
      {
        source: path.join(t.assets_folder, 'Pexels Videos 2048452.mp4')
      },
      {
        source: path.join(t.assets_folder, 'Video Of People Waiting For A Taxi On A Rainy Night.mp4'),
        ['layout.width']: '100%',
      }
    ]
  }

  const { render_data } = await render_video(template, {cwd: Deno.cwd(), output_folder: t.artifacts_folder })
  const { CLIP_0, CLIP_1 } = render_data.clips
  t.assert.equals(CLIP_0.geometry.scale, { width: 1920, height: 1080 })
  t.assert.equals(CLIP_1.probe_info.width, 1840)
  t.assert.equals(CLIP_1.probe_info.height, 1034)
  t.assert.equals(CLIP_1.geometry.scale,  { width: 1920, height: 1078 })
  // width matches CLIP_0, height (almost) keeps the ratio, we round down for ffmpeg
  t.assert.equals(CLIP_1.probe_info.width / CLIP_1.probe_info.height, 1.7794970986460348)
  t.assert.equals(CLIP_1.geometry.scale.width / CLIP_1.geometry.scale.height, 1.7810760667903525)
})

test('render image with zero duration', async t => {
  const template = {
    clips: [
      {
        source: path.join(t.assets_folder, '1636302951890.jpg'),
      },
      {
        source: path.join(t.assets_folder, 'github_icon.png'),
        layout: { width: '25%', x: 'center' as const, y: 'center' as const }
      }
    ]
  }
  const { render_data, output } = await render_image(template, {cwd: Deno.cwd(), output_folder: t.artifacts_folder, ffmpeg_log_cmd: true })
  const rendered_image_data = await Deno.readFile(output.current)
  const fixture_image_data = await Deno.readFile(path.join(t.fixtures_folder, 'preview.jpg'))
  t.assert.equals(fixture_image_data, rendered_image_data)
})

test('timeline all variable length clips', async t => {
  const template = {
    clips: [
      {
        source: path.join(t.assets_folder, 'Pexels Videos 2048452.mp4'),
        trim: { variable_length: 'stop' },
      },
      {
        source: path.join(t.assets_folder, 'Video Of People Waiting For A Taxi On A Rainy Night.mp4'),
        layout: { width: '50%', x: 'center' as const, y: 'center' as const },
        trim: { variable_length: 'stop' },
      }
    ]
  }
  const { render_data, output } = await render_video(template, {cwd: Deno.cwd(), output_folder: t.artifacts_folder, ffmpeg_log_cmd: true })
  const { CLIP_0, CLIP_1 } = render_data.clips
  t.assert.equals(CLIP_0.probe_info.duration, 14.698667)
  t.assert.equals(CLIP_1.probe_info.duration, 14.997333)
  t.assert.equals(render_data.total_duration, 14.698667)
})

test('timeline one variable length clip', async t => {
  const template = {
    clips: [
      {
        source: path.join(t.assets_folder, 'Pexels Videos 2048452.mp4'),
        duration: '00:05',
      },
      {
        source: path.join(t.assets_folder, 'Video Of People Waiting For A Taxi On A Rainy Night.mp4'),
        layout: { width: '50%', x: 'center' as const, y: 'center' as const },
        trim: { variable_length: 'stop' },
      }
    ]
  }
  const { render_data, output } = await render_video(template, {cwd: Deno.cwd(), output_folder: t.artifacts_folder, ffmpeg_log_cmd: true })
  const { CLIP_0, CLIP_1 } = render_data.clips
  t.assert.equals(CLIP_0.probe_info.duration, 14.698667)
  t.assert.equals(CLIP_1.probe_info.duration, 14.997333)
  t.assert.equals(CLIP_0.duration, 5)
  t.assert.equals(CLIP_1.duration, 5)
  t.assert.equals(render_data.total_duration, 5)
})
