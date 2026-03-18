import { createBinarySignature } from './cacheKey'

type DecodedTextureImage = ImageData | ImageBitmap

type TextureDecodeCacheEntry = {
  cachedAt: number
  estimatedBytes: number
  image: DecodedTextureImage
}

const MAX_DECODE_CACHE_ENTRIES = 512
const MAX_DECODE_CACHE_BYTES = 192 * 1024 * 1024
const textureDecodeCache = new Map<string, TextureDecodeCacheEntry>()
let textureDecodeCacheBytes = 0

const normalizeAdjustmentsKey = (adjustments: unknown): string => {
  if (!adjustments) {
    return ''
  }

  try {
    return JSON.stringify(adjustments)
  } catch {
    return String(adjustments)
  }
}

const estimateImageBytes = (image: DecodedTextureImage): number => {
  if (image instanceof ImageData) {
    return image.data.byteLength
  }
  return image.width * image.height * 4
}

const touchEntry = (key: string, entry: TextureDecodeCacheEntry) => {
  textureDecodeCache.delete(key)
  textureDecodeCache.set(key, entry)
}

const evictOverflow = () => {
  while (
    textureDecodeCache.size > MAX_DECODE_CACHE_ENTRIES ||
    textureDecodeCacheBytes > MAX_DECODE_CACHE_BYTES
  ) {
    const oldestKey = textureDecodeCache.keys().next().value
    if (!oldestKey) {
      break
    }
    const oldEntry = textureDecodeCache.get(oldestKey)
    if (oldEntry) {
      textureDecodeCacheBytes = Math.max(0, textureDecodeCacheBytes - oldEntry.estimatedBytes)
    }
    textureDecodeCache.delete(oldestKey)
  }
}

export const createTextureDecodeCacheKey = (
  path: string,
  bytes: Uint8Array,
  options?: {
    adjustments?: unknown
    maxDimension?: number
    preferBlpBaseMip?: boolean
  }
): string => {
  return [
    (path || '').toLowerCase(),
    createBinarySignature(bytes),
    options?.maxDimension ?? '',
    options?.preferBlpBaseMip ? 'base' : 'mip',
    normalizeAdjustmentsKey(options?.adjustments)
  ].join('|')
}

export const getCachedDecodedTexture = (key: string): DecodedTextureImage | null => {
  const entry = textureDecodeCache.get(key)
  if (!entry) {
    return null
  }

  touchEntry(key, entry)
  return entry.image
}

export const setCachedDecodedTexture = (key: string, image: DecodedTextureImage): void => {
  const estimatedBytes = estimateImageBytes(image)
  const existing = textureDecodeCache.get(key)
  if (existing) {
    textureDecodeCacheBytes = Math.max(0, textureDecodeCacheBytes - existing.estimatedBytes)
  }

  const entry: TextureDecodeCacheEntry = {
    cachedAt: Date.now(),
    estimatedBytes,
    image
  }

  textureDecodeCache.set(key, entry)
  textureDecodeCacheBytes += estimatedBytes
  touchEntry(key, entry)
  evictOverflow()
}
