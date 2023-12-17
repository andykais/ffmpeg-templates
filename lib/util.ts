import * as path from 'https://deno.land/std@0.91.0/path/mod.ts'
import { InputError } from './errors.ts'
import type * as template_input from './template_input.zod.ts'


abstract class AbstractClipMap<T> extends Map<template_input.ClipID, T> {
  get_or_throw(clip_id: template_input.ClipID): T {
    const clip = this.get(clip_id)
    if (!clip) throw new InputError(`Clip ${clip_id} does not exist.`)
    else return clip
  }

  get_or_else = this.get_or_throw.bind(this)
}

function relative_path(filepath: string) {
  return path.relative(Deno.cwd(), filepath)
}


export { AbstractClipMap, relative_path }
