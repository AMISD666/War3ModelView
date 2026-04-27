import { createBinarySignature } from './cacheKey'
import { RevisionedMemoryCache, type CacheDependencyToken } from '../../application/cache'

type DecodedTextureImage = ImageData | ImageBitmap

const MAX_DECODE_CACHE_ENTRIES = 512
const MAX_DECODE_CACHE_BYTES = 192 * 1024 * 1024
const TEXTURE_DECODE_CACHE_DECODER_VERSION = 'v2'
const textureDecodeCache = new RevisionedMemoryCache<DecodedTextureImage>({
  namespace: 'textureDecode',
  maxEntries: MAX_DECODE_CACHE_ENTRIES,
  maxBytes: MAX_DECODE_CACHE_BYTES,
})

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

export const createTextureDecodeCacheKey = (
  path: string,
  bytes: Uint8Array,
  options?: {
    adjustments?: unknown
    maxDimension?: number
    preferBlpBaseMip?: boolean
    forceOpaqueAlpha?: boolean
  }
): string => {
  return [
    TEXTURE_DECODE_CACHE_DECODER_VERSION,
    (path || '').toLowerCase(),
    createBinarySignature(bytes),
    options?.maxDimension ?? '',
    options?.preferBlpBaseMip ? 'base' : 'mip',
    options?.forceOpaqueAlpha ? 'opaque' : 'source-alpha',
    normalizeAdjustmentsKey(options?.adjustments)
  ].join('|')
}

export const createTextureDecodeCacheDependencies = (
  path: string,
  bytes: Uint8Array,
  options?: {
    adjustments?: unknown
    maxDimension?: number
    preferBlpBaseMip?: boolean
    forceOpaqueAlpha?: boolean
  }
): CacheDependencyToken[] => [
  { kind: 'decoderVersion', value: TEXTURE_DECODE_CACHE_DECODER_VERSION },
  { kind: 'fileFingerprint', value: createBinarySignature(bytes), label: (path || '').toLowerCase() },
  { kind: 'previewOptions', value: options?.maxDimension ?? null, label: 'maxDimension' },
  { kind: 'previewOptions', value: options?.preferBlpBaseMip ? 'base' : 'mip', label: 'mipSelection' },
  { kind: 'previewOptions', value: options?.forceOpaqueAlpha ? 'opaque' : 'source-alpha', label: 'alphaMode' },
  { kind: 'previewOptions', value: normalizeAdjustmentsKey(options?.adjustments), label: 'adjustments' },
]

export const getCachedDecodedTexture = (key: string): DecodedTextureImage | null => {
  const entry = textureDecodeCache.getEntry(key)
  if (!entry.found) {
    return null
  }

  return entry.value
}

export const setCachedDecodedTexture = (
  key: string,
  image: DecodedTextureImage,
  dependsOn: CacheDependencyToken[] = []
): void => {
  const estimatedBytes = estimateImageBytes(image)
  textureDecodeCache.set(key, image, {
    estimatedBytes,
    dependsOn,
  })
}
