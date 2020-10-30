class InputError extends Error {
  name = 'InputError'
}

class CommandError extends Error {
  name = 'CommandError'
}

class ProbeError extends Error {
  name = 'ProbeError'
}

export { InputError, CommandError, ProbeError }
