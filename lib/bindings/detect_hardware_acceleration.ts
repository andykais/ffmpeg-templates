async function exec(...cmd: string[]) {
  const decoder = new TextDecoder()
  const proc = Deno.run({ cmd, stdout: 'piped' })
  const status = await proc.status()
  const stdout = await proc.output()
  proc.close()
  const output = decoder.decode(stdout)
  if (status.code !== 0) throw new Error(`CommandError: ${output}`)
  else return output
}

const QSV_FFMPEG_ARGS = { input_decoder: [], filter: [], video_encoder: ['-codec:v', 'h264_qsv'] }
// const QSV_FFMPEG_ARGS = { input_decoder: [], filter: ['-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw'], video_encoder: ['-codec:v', 'h264_qsv'] }
const GPU_HARDWARE_ACCELERATION_MAP = {
  intel: [{ requires: { device: 'qsv', video_encoder: 'h264_qsv' }, ffmpeg_args: QSV_FFMPEG_ARGS }],
  nvidia: [],
  amd: [],
}

function get_gpu_type(graphics_card: string): 'intel' | 'nvidia' | 'amd' | undefined {
  const graphics_card_lowercase = graphics_card.toLowerCase()
  const is_type = (names: string[]) => names.some((name) => graphics_card_lowercase.includes(name))
  if (is_type(['intel', 'i965'])) return 'intel'
  if (is_type(['amd', 'mesa'])) return 'amd'
  if (is_type(['nvidia'])) return 'nvidia'
}

async function get_available_ffmpeg_hw_devices(): Promise<string[]> {
  const output = await exec('ffmpeg', '-v', 'error', '-init_hw_device', 'list')
  return output.trim().split('\n').slice(1)
}

async function get_available_ffmpeg_hw_video_encoders(): Promise<string[]> {
  const output = await exec('ffmpeg', '-v', 'error', '-encoders')
  return output.split('\n').filter(s => s.startsWith(' V.....')).map(s => s.split(' ')[2]).slice(1)
}

interface FfmpegHWAccelArgs {
  input_decoder: string[]
  filter: string[]
  video_encoder: string[]
}
async function get_hardware_acceleration_options(): Promise<FfmpegHWAccelArgs | undefined> {
  const gpu_adapter = await navigator.gpu.requestAdapter()
  if (!gpu_adapter) return undefined
  const graphics_card: string = gpu_adapter.name
  const gpu_type = get_gpu_type(graphics_card)
  if (!gpu_type) return undefined
  const gpu_type_hw_accel_options = GPU_HARDWARE_ACCELERATION_MAP[gpu_type]

  const [devices, encoders] = await Promise.all([
    get_available_ffmpeg_hw_devices(),
    get_available_ffmpeg_hw_video_encoders(),
  ])

  for (const { requires, ffmpeg_args } of gpu_type_hw_accel_options) {
    if (devices.includes(requires.device) && encoders.includes(requires.video_encoder)) return ffmpeg_args
  }
}


export { get_hardware_acceleration_options }
