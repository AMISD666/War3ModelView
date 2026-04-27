export type CacheDependencyKind =
    | 'documentRevision'
    | 'assetRevision'
    | 'fileFingerprint'
    | 'mpqRevision'
    | 'decoderVersion'
    | 'textureSignature'
    | 'previewOptions'

export interface CacheDependencyToken {
    kind: CacheDependencyKind
    value: string | number | boolean | null
    label?: string
}

export interface CacheEntryMeta {
    namespace: string
    key: string
    createdAt: number
    lastAccessedAt: number
    estimatedBytes?: number
    dependsOn: CacheDependencyToken[]
}

export interface RevisionedMemoryCacheOptions {
    namespace: string
    maxEntries: number
    maxBytes?: number
}

export interface CacheWriteMeta {
    estimatedBytes?: number
    dependsOn?: CacheDependencyToken[]
}

export interface CacheLookup<TValue> {
    found: boolean
    value: TValue | null
    meta: CacheEntryMeta | null
}

interface CacheEntry<TValue> {
    value: TValue
    meta: CacheEntryMeta
}

export class RevisionedMemoryCache<TValue> {
    private readonly entries = new Map<string, CacheEntry<TValue>>()
    private totalEstimatedBytes = 0

    constructor(private readonly options: RevisionedMemoryCacheOptions) {}

    get namespace(): string {
        return this.options.namespace
    }

    get size(): number {
        return this.entries.size
    }

    get estimatedBytes(): number {
        return this.totalEstimatedBytes
    }

    getEntry(key: string): CacheLookup<TValue> {
        const entry = this.entries.get(key)
        if (!entry) {
            return { found: false, value: null, meta: null }
        }

        entry.meta.lastAccessedAt = Date.now()
        this.entries.delete(key)
        this.entries.set(key, entry)
        return { found: true, value: entry.value, meta: { ...entry.meta, dependsOn: [...entry.meta.dependsOn] } }
    }

    set(key: string, value: TValue, meta: CacheWriteMeta = {}): void {
        const existing = this.entries.get(key)
        if (existing) {
            this.totalEstimatedBytes = Math.max(0, this.totalEstimatedBytes - (existing.meta.estimatedBytes ?? 0))
            this.entries.delete(key)
        }

        const now = Date.now()
        const entry: CacheEntry<TValue> = {
            value,
            meta: {
                namespace: this.options.namespace,
                key,
                createdAt: now,
                lastAccessedAt: now,
                estimatedBytes: meta.estimatedBytes,
                dependsOn: meta.dependsOn ? [...meta.dependsOn] : [],
            },
        }

        this.entries.set(key, entry)
        this.totalEstimatedBytes += meta.estimatedBytes ?? 0
        this.evictOverflow()
    }

    delete(key: string): boolean {
        const entry = this.entries.get(key)
        if (!entry) {
            return false
        }

        this.totalEstimatedBytes = Math.max(0, this.totalEstimatedBytes - (entry.meta.estimatedBytes ?? 0))
        return this.entries.delete(key)
    }

    clear(): void {
        this.entries.clear()
        this.totalEstimatedBytes = 0
    }

    snapshot(): CacheEntryMeta[] {
        return Array.from(this.entries.values(), entry => ({
            ...entry.meta,
            dependsOn: [...entry.meta.dependsOn],
        }))
    }

    private evictOverflow(): void {
        while (
            this.entries.size > this.options.maxEntries ||
            (this.options.maxBytes !== undefined && this.totalEstimatedBytes > this.options.maxBytes)
        ) {
            const oldestKey = this.entries.keys().next().value
            if (typeof oldestKey !== 'string') {
                break
            }
            this.delete(oldestKey)
        }
    }
}
