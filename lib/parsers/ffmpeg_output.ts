function parse_aspect_ratio(aspect_ratio: string, rotation?: number) {
  const parts = aspect_ratio.split(':').map((part) => parseInt(part))
  if (parts.length !== 2 || parts.some(Number.isNaN))
    throw new Error(`aspect ratio ${aspect_ratio} parsed incorrectly.`)
  let [width, height] = parts
  if (rotation) {
    ;[height, width] = [
      Math.abs(width * Math.sin(rotation)) + Math.abs(height * Math.cos(rotation)),
      Math.abs(width * Math.cos(rotation)) + Math.abs(height * Math.sin(rotation)),
    ].map(Math.floor)
  }
  return width / height
}

function parse_ffmpeg_packet(packet_buffer: string[]) {
  const object: { [key: string]: string } = {}
  for (const line of packet_buffer) {
    const [key, value] = line.split('=')
    object[key] = value
  }
  return object
}

export { parse_aspect_ratio, parse_ffmpeg_packet }
