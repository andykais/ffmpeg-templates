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
- [O] duration control
  - [ ] 'insert after <index>'
  - [ ] ascii timeline chart?
    - [ ] support inserting videos at specific timestamps. (E.g. overlaying clips on a music video)
    - [ ] possibly support arbitrary durations between clips? (this might be covered by the prior)
- [ ] size fractions
- [ ] borders
- [ ] yaml template support

# BUGS
- [ ] we arent trimming properly on the current sample!
