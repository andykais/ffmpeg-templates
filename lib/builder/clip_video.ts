import { ClipBuilderBase } from './clip_base.ts'

// we _may_ decide to refactor these into ClipVideoBuilder, ClipImageBuilder, ClipAudioBuilder
// and push the sample vs full output logic into the cmd builders above
export class ClipVideoBuilder extends ClipBuilderBase {}
