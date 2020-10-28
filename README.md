# ffmpeg-templates

## Development

```bash
deno run --watch --unstable --allow-read --allow-write --allow-run ffmpeg-templates.ts template.json out.jpg --overwrite --render-sample-frame 00:00:05 --watch
```

```bash
deno run --watch --unstable --allow-read --allow-write --allow-run ffmpeg-templates.ts template.json out.mp4 --overwrite
```

## TODO
- [X] fraction support
- [X] audio volume control
- [X] cropping
- [ ] duration control
- [ ] borders
- [ ] yaml template support
