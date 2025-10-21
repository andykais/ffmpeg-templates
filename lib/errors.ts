class InputError extends Error {
  override name = 'InputError'
}

class CommandError extends Error {
  override name = 'CommandError'
}

class ProbeError extends Error {
  override name = 'ProbeError'
}

export { InputError, CommandError, ProbeError }
