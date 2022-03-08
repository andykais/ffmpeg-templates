import * as errors from './errors.ts'
import { parse_unit } from './parsers/unit.ts'
import { parse_duration } from './parsers/duration.zod.ts'
import type * as inputs from './template_input.zod.ts'
import type * as parsed from './parsers/template.zod.ts'
import type { Context } from './context.ts'


interface TimelineClip {
  clip_id: inputs.ClipID
  z_index: number
  duration: number
  start_at: number
  speed: number
  trim_start: number
}

interface Keypoints {
  [name: string]: number
}

interface TimelineTree {
  start_at: number
  node?: {
    clip_id: string
    z_index: number
    duration: number
    trim_start: number
    variable_length: 'start' | 'stop' | undefined
  }
  branches: TimelineTree[]
}

function build_tree(
  context: Context,
  timeline_clip: parsed.TimelineParsed[0],
  keypoints: Keypoints,
  start_at: number,
) {
  let total_duration = start_at
  const offset = parse_duration(timeline_clip.offset)
  let clip_start_at = start_at + offset
  let clip_end_at = clip_start_at

  const timeline_tree: TimelineTree = {
    start_at: clip_start_at,
    node: undefined,
    branches: []
  }

  // skip branches with no nodes
  if (timeline_clip.id !== undefined) {
    const clip = context.get_clip(timeline_clip.id)
    const clip_info = context.clip_info_map.get_or_throw(clip.id)

    const variable_length = clip.trim?.variable_length === undefined
      ? clip_info.type === 'image'
        ? 'stop'
        : undefined
      : clip.trim.variable_length

    let clip_duration = clip_info.duration

    const trim = clip.trim ?? {}

    let trim_start = 0
    if (trim.start) trim_start += parse_duration(trim.start)
    clip_duration -= trim_start

    let trim_stop = 0
    if (trim.stop) clip_duration -= parse_duration(trim.stop)
    clip_end_at += clip_duration
    if (clip_duration < 0) throw new errors.InputError(`Invalid trim on clip ${clip.id}. Clip is not long enough`)

    if (clip.speed !== '100%') {
      throw new Error('unimplemented')
    }

    for (const keypoint of clip.keypoints) {
      const anchored_keypoint = keypoints[keypoint.name]
      if (anchored_keypoint !== undefined) {
        if (anchored_keypoint > clip_start_at) {
          const inc_start_at = (anchored_keypoint - clip_start_at)
          clip_duration -= inc_start_at
          clip_start_at += inc_start_at
          if (clip_duration < 0) throw new errors.InputError(`Invalid keypoint ${keypoint.name} on clip ${clip.id}. Keypoint at ${anchored_keypoint} exceeds clip length of ${clip_duration}`)
        } else {
          // TODO trim a clip's start time that occurs here
          throw new errors.InputError(`Invalid keypoint ${keypoint.name} on clip ${clip.id}. Keypoint occurs at ${anchored_keypoint}, clip starts at ${clip_start_at}`)
        }
      }
    }
    if (clip_duration < 0) throw new errors.InputError(`Invalid trim on clip ${clip.id}. Clip is not long enough`)

    timeline_tree.start_at = clip_start_at
    clip_end_at = clip_start_at + clip_duration
    timeline_tree.node = {
      clip_id: clip.id,
      z_index: timeline_clip.z_index,
      duration: clip_duration,
      trim_start,
      variable_length
    }
  }

  // let start_next_at = timeline_tree.start_at + timeline_tree.;queueMicrotask
  for (const branch of timeline_clip.next) {
    if (branch.next_order === 'sequence') {
      // so this wont work as the schema is implemented. A clip in sequence order with a "next"
      // flag breaks the tree schema. We would need to create another field on the timeline for this
      // TODO
      //
      // timelime: [
      //  {
      //    order_type: 'sequence',
      //    next: [
      //      { id: 'CLIP_1', next: [{ id: 'CLIP_2' }]},
      //      { id: 'CLIP_3' }
      //    ]
      //  }
      // ]
      //
      // ->
      //
      // {
      //   offset: 0,
      //   branches: [
      //    { id: 'CLIP_1', branches: [{ id: 'CLIP_2' }] }
      //    // we will have to get kind of tricky if CLIP_1 is variable_length
      //    { id: 'CLIP_3', offset: <length_of_CLIP_1> },
      //   ]
      // }
      throw new Error('unimplemented')
    }
    const tree_branch = build_tree(context, branch, keypoints, clip_end_at)
    timeline_tree.branches.push(tree_branch)
  }

  return timeline_tree
}

function calculate_min_duration(timeline_tree: TimelineTree) {
  let node_duration = timeline_tree.start_at
  if (timeline_tree.node !== undefined) {
    // skip these for now
    if (timeline_tree.node.variable_length === undefined) {
     node_duration += timeline_tree.node.duration
    }
  }
  // let max_total_duration = timeline_tree.start_at
  // let min_total_duration = timeline_tree.start_at

  const branch_durations: number[] = [0]
  for (const branch of timeline_tree.branches) {
    const total_duration = calculate_min_duration(branch)
    branch_durations.push(total_duration)
  }

  const max_branch_duration = Math.max(...branch_durations)
  const total_duration = max_branch_duration + node_duration
  return total_duration
}

function calculate_timeline_clips(timeline_tree: TimelineTree, total_duration: number): TimelineClip[] {
  const timeline_clips = []

  if (timeline_tree.node) {
    const { node } = timeline_tree
    let duration = node.duration

    if (node.variable_length) {
      const min_duration = Math.max(0, ...timeline_tree.branches.map(calculate_min_duration))
      const possible_duration = total_duration - (timeline_tree.start_at + min_duration)
      duration = Math.min(possible_duration, node.duration)
      // console.log({possible_duration, duration})
    }

    timeline_clips.push({
      start_at: timeline_tree.start_at,
      trim_start: node.trim_start,
      clip_id: node.clip_id,
      z_index: node.z_index,
      duration,
      speed: 1,
    })
  }

  for (const branch of timeline_tree.branches) {
    timeline_clips.push(...calculate_timeline_clips(branch, total_duration))
  }

  return timeline_clips
}

function compute_timeline(context: Context) {
  const keypoints: Keypoints = {}
  const initial_tree_node = {offset:'0', z_index: 0, next_order: 'parallel', next: context.template.timeline} as const
  const timeline_tree = build_tree(context, initial_tree_node, keypoints, 0)
  // console.log('timeline_tree', timeline_tree)
  const total_duration = calculate_min_duration(timeline_tree)
  console.log('total_duration', total_duration)

  const timeline = calculate_timeline_clips(timeline_tree, total_duration)
  console.log('timeline', timeline)

  // const { total_duration: old_total_duration, timeline } = parse_timeline_clips(context, context.template.timeline, keypoints, 'parallel', 0)

  timeline.sort((a, b) => a.z_index - b.z_index)
  return { total_duration, timeline }
}

export { compute_timeline }
export type { TimelineClip }
