const MAX_SIGNATURE_SAMPLES = 4096
const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619

export const createBinarySignature = (bytes: Uint8Array): string => {
  const length = bytes.byteLength
  if (length <= 0) {
    return '0:0'
  }

  const sampleCount = Math.min(MAX_SIGNATURE_SAMPLES, length)
  const step = Math.max(1, Math.floor(length / sampleCount))
  let hash = FNV_OFFSET_BASIS >>> 0

  for (let i = 0; i < length; i += step) {
    hash ^= bytes[i]
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }

  hash ^= bytes[length - 1]
  hash = Math.imul(hash, FNV_PRIME) >>> 0

  return `${length.toString(16)}:${hash.toString(16)}`
}
