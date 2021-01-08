# ffmpeg-templates


## Requirements
- [ffmpeg](https://ffmpeg.org/download.html)
- [deno](https://deno.land) >= 1.5.0

## Installation
```bash
deno install --allow-read --allow-run --unstable -f https://raw.githubusercontent.com/andykais/ffmpeg-templates/main/ffmpeg-templates.ts
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
A video project is defined using a template file like this example one below. Think of this like the video
editor GUI. Full documentation exists [here](https://doc.deno.land/https/raw.githubusercontent.com/andykais/ffmpeg-templates/main/structs.ts#Template)
```yaml
clips:
  # specify clips in an array, the only field necessary is 'file'
  - file: './some-neato-video.mp4'
  - file: './another-clip.mp4'
    # use layout to place the clip somewhere
    layout:
      # lots of fields can accept fractions of the total size of the output
      width: '1/2'
      x:
        # regular integers are also accepted most places (in this case they are pixels)
        offset: 12
        # snap this clip to the lefthand side
        align: 'right'
    # sometimes you may want to crop a clip, this is also optional
    crop:
      left: 50
  - file: './something-really-long.mp4'
    # you can specify an id for the timeline below
    id: 'background-video'

# by default, all clips are started at the same time, but you can use the timeline to change up that order.
# Lets start one video in the background, and then play two other clips on top of it, one after the other.
timeline:
  00:00:00:
    - ['background-video']
    - [CLIP_0, CLIP_1]
```

## Javascript Interface
```ts
import { render_video, render_sample_frame } from 'https://raw.githubusercontent.com/andykais/ffmpeg-templates/main/mod.ts'


const template = {
  clips: [{ file: './input.mp4' }]
}
const output_filepath = 'output.mp4'
const options = { cwd: '~/Projects' }
await render_video(template, output_filepath, options)
```

## Motivation
So why does this exist? There are countless video editors out there, and this little command line program cant
possibly match their feature set, so why use this?

In the end, it comes down to your opinions on GUI programs. I believe that there is a lot less interesting
things that can be done with a traditional video editor. This isn't to say this little program can do more,
but it does open the door for reusability, and automation in ways that a GUI never could. For instance, if I
wanted to truly make a _template_ where one video is swapped out for another, its a single line change in the
template file. Doing the same thing inside a GUI program is not nearly as trivial. It would mean opening a
project file, massaging the new clip to the same shape, size and length as an old clip, and placing it again.

`ffmpeg-templates`
is really just nicer syntax on top of what the ffmpeg program already offers, but it offers an easy to pick up
syntax and schema. Everything that this program can do, is defined in a single [schema file](./structs.ts). No
complicated tutorials, no hidden settings in a application preferences. Its just a bare bones video editor.

## Roadmap
- [X] Cache probed clip information in watch mode
- [ ] Cache trimmed clips in watch mode
- [ ] Support audio only inputs
- [ ] Add `--render-sample-thumbnails [num_thumbnails]` flag as alternative to `--render-sample-frame`
- [ ]  [REJECTED]Make `--render-sample-frame` interactive (e.g., -> moves forward one frame, `<-` backward. `Shift` + `->` Skips ahead 1 second)
- [X] Add trim.stop or a similar word to signify trimming to a 'stop' timestamp (trim.end trims in reverse). A negative duration on trim.end would work as well. 
- [X] Add `clip[].speed` filter (`setpts={speed}*PTS`)
- [ ] Alternatively to implementing more terminal-ui things, we could create a real web page which has the
      preview window and a timeline. All still config driven. The preview window does however let you change
      what timestamp the preview is of
- [X] Replace fractions with percentages. All units are either `10%` or `10px`
- [X] Add `--preview` flag. Opens image previews and uses a field in the template for previews
    - use feh: `feh --image-bg '#1e1c1c' --scale-down --title <window_title> <rendered_frame>`
    - use eog
    - use imagemagick's display: `display -update 1.0 <rendered_frame>`
- [x] Intelligently inspect previews. Only include clips that are relevant to the desired frame.
- [x] support duration expressions like `"00:02:12 - 00:00:03.4"`
- [X] support image inputs
- [X] support font inputs
- [X] add timeline variables
- [X] add rotation clip option
- [ ] durations should support '00:00:00' and '00:00' and '00' and '0'
- [ ] zoompan
  - during previews, arrows should represent where the zoom is going from and going to
  - automatic face tracking option?
- [ ] create placeholder loading image (from imagemagick) that immediately shows up on preview
- [ ] add warning about unused clips in timeline
- [ ] report this one as a bug?
```
  2s [----------------------------------------------] 0.0%error: Uncaught (in promise) Busy: Resource is unavailable because it is in use by a promise
    at processResponse (deno:core/core.js:223:11)
    at Object.jsonOpSync (deno:core/core.js:246:12)
    at Object.consoleSize (deno:runtime/js/40_tty.js:7:17)
    at progress_callback (ffmpeg-templates.ts:60:30)
    at copied_options.progress_callback (ffmpeg-templates.ts:96:54)
    at ffmpeg (mod.ts:508:9)
    at async render (mod.ts:645:3)
    at async render_sample_frame (mod.ts:659:10)
    at async try_render_video (ffmpeg-templates.ts:103:9)
```
- [X] make `YAMLError`s recoverable
- [ ] make background color a parameter
- [ ] add border param
- [X] add transitions
    - [X] cross fade
    - [ ] screen wipe?
- [ ] crop width/height percentage instead of left vs right?
- [ ] input error on `crop <= 0`
- cache some of the font asset creation work
- add `-pix_fmt yuv420p` to get better compatability
- trim.stop_total where stop is performed against _total_ time.
- when showing preview, hint with the next keyframe (not really helpful actually)
- cancel previous render when file is changed
- improve preview time by seeking inputs right to the desired frame. Unsure if there are implications, but it
    should work!
