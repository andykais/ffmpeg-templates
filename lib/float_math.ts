function gt(a: number, b: number): boolean {
  const diff = a - b
  if (diff > 0) return true
  if (Math.abs(diff) < 1e-12) return true
  else return false
}
function gte(a: number, b: number): boolean {
  const diff = a - b
  if (diff >= 0) return true
  if (Math.abs(diff) < 1e-12) return true
  else return false
}
function lte(a: number, b: number): boolean {
  const diff = b - a
  if (diff >= 0) return true
  if (Math.abs(diff) < 1e-12) return true
  else return false
}

export { gt, gte, lte }
