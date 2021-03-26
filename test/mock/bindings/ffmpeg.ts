import { ffmpeg as real_ffmpeg } from '../../../lib/bindings/ffmpeg.ts'

export const ffmpeg: typeof real_ffmpeg = async ()  => {}
export type { OnProgress, FfmpegProgress } from '../../../lib/bindings/ffmpeg.ts'
