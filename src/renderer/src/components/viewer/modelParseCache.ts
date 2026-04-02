import { createBinarySignature } from './cacheKey'

type ParsedModelCacheEntry = {
  cachedAt: number
  model: any
}

const MAX_PARSED_MODEL_ENTRIES = 8
const parsedModelCache = new Map<string, ParsedModelCacheEntry>()

const cloneModel = <T>(model: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(model)
  }
  return JSON.parse(JSON.stringify(model)) as T
}

const touchEntry = (key: string, entry: ParsedModelCacheEntry) => {
  parsedModelCache.delete(key)
  parsedModelCache.set(key, entry)
}

const evictOverflow = () => {
  while (parsedModelCache.size > MAX_PARSED_MODEL_ENTRIES) {
    const oldestKey = parsedModelCache.keys().next().value
    if (!oldestKey) {
      break
    }
    parsedModelCache.delete(oldestKey)
  }
}

export const createModelParseCacheKey = (path: string, bytes: Uint8Array): string => {
  return `${(path || '').toLowerCase()}|${createBinarySignature(bytes)}`
}

export const getCachedParsedModel = (key: string): any | null => {
  const entry = parsedModelCache.get(key)
  if (!entry) {
    return null
  }

  touchEntry(key, entry)
  return cloneModel(entry.model)
}

export const setCachedParsedModel = (key: string, model: any): void => {
  // 必须深拷贝后再缓存：onModelLoaded / store 会原地修改同一份解析结果，若缓存引用则「关标签未保存再打开」会读到被污染的对象
  const entry: ParsedModelCacheEntry = {
    cachedAt: Date.now(),
    model: cloneModel(model)
  }

  parsedModelCache.set(key, entry)
  touchEntry(key, entry)
  evictOverflow()
}
