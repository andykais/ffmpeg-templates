# ffmpeg-templates


## Requirements
- [ffmpeg](https://ffmpeg.org/download.html)
- [deno](https://deno.land) >= 1.5.0

## Installation
```bash
deno install --allow-read --allow-run --unstable -f ffmpeg-templates.ts
```

## Usage
```
ffmpeg-templates v0.1.0

Usage: ffmpeg-templates <template_filepath> [<output_filepath>] [options]

ARGS:
  <template_filepath>                       Path to a YAML or JSON template file which defines the structure of
                                            the outputted video

  <output_filepath>                         The file that will be outputted by ffmpeg. When not specified, a
                                            file will be created adjacent to the template ending in .mp4 or .jpg
                                            depending on whether --render-sample-frame is present or not.

OPTIONS:
  --render-sample-frame <timestamp>         Instead of outputting the whole video, output a single frame as a jpg.
                                            Use this flag to set up your layouts and iterate quickly. Note that you
                                            must change <output_filepath> to be an image filename (e.g. sample.jpg).

  --overwrite                               Overwrite an existing output file.

  --watch                                   Run continously when the template file changes. This is most useful
                                            in tandem with --render-sample-frame.

  --verbose                                 Show ffmpeg logging instead of outputting a progress bar.

  --help                                    Print this message.
```

## Examples
```bash
# create a video from a template
ffmpeg-templates template.yml output.mp4

# render a single frame from the output at the specified timestamp
# and continuously re-render when the template file is changed
ffmpeg-templates template.yml output.jpg --render-sample-frame 00:00:03 --watch
```

## Template Syntax
- [size]()
- [clips]()
- [timeline]()


## Roadmap
- [X] fraction support
- [X] audio volume control
- [X] cropping
- [O] duration control
  - [X] 'insert after <index>'
  - [o] ascii timeline chart?
    - [X] support inserting videos at specific timestamps. (E.g. overlaying clips on a music video)
    - [ ] possibly support arbitrary durations between clips? (this might be covered by the prior)
- [X] size fractions
- [ ] borders
- [X] yaml template support

