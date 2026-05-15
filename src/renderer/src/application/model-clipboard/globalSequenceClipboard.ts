type ClipboardGlobalSequences = Record<number, number>

const isTrackLike = (value: unknown): value is { Keys?: unknown[]; GlobalSeqId?: unknown } =>
    value !== null
    && typeof value === 'object'
    && Array.isArray((value as { Keys?: unknown[] }).Keys)

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' ? value as Record<string, unknown> : null

export const collectReferencedGlobalSequenceIds = (value: unknown, ids: Set<number>): void => {
    const record = asRecord(value)
    if (!record) return

    if (isTrackLike(record)) {
        const globalSeqId = record.GlobalSeqId
        if (typeof globalSeqId === 'number' && Number.isInteger(globalSeqId) && globalSeqId >= 0) {
            ids.add(globalSeqId)
        }
    }

    for (const nested of Object.values(record)) {
        const nestedRecord = asRecord(nested)
        if (nestedRecord) {
            collectReferencedGlobalSequenceIds(nestedRecord, ids)
            continue
        }

        if (!Array.isArray(nested)) continue
        for (const item of nested) {
            collectReferencedGlobalSequenceIds(item, ids)
        }
    }
}

export const buildClipboardGlobalSequencePayload = (input: {
    node: unknown
    modelData: { GlobalSequences?: unknown[] } | null | undefined
    materials?: Record<number, unknown>
    textureAnims?: Record<number, unknown>
}): ClipboardGlobalSequences | undefined => {
    const ids = new Set<number>()

    collectReferencedGlobalSequenceIds(input.node, ids)
    Object.values(input.materials ?? {}).forEach((material) => collectReferencedGlobalSequenceIds(material, ids))
    Object.values(input.textureAnims ?? {}).forEach((textureAnim) => collectReferencedGlobalSequenceIds(textureAnim, ids))

    if (ids.size === 0) return undefined

    const sourceGlobalSequences = Array.isArray(input.modelData?.GlobalSequences)
        ? input.modelData.GlobalSequences
        : []

    const payload: ClipboardGlobalSequences = {}
    Array.from(ids)
        .sort((a, b) => a - b)
        .forEach((oldId) => {
            const duration = sourceGlobalSequences[oldId]
            if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return
            payload[oldId] = duration
        })

    return Object.keys(payload).length > 0 ? payload : undefined
}

export const appendClipboardGlobalSequences = (
    targetGlobalSequences: unknown,
    clipboardGlobalSequences: ClipboardGlobalSequences | null | undefined,
): { globalSequences: number[]; oldToNew: Map<number, number> } => {
    const nextGlobalSequences = Array.isArray(targetGlobalSequences)
        ? targetGlobalSequences
            .map((value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0))
        : []
    const oldToNew = new Map<number, number>()

    if (!clipboardGlobalSequences) {
        return { globalSequences: nextGlobalSequences, oldToNew }
    }

    Object.keys(clipboardGlobalSequences)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0)
        .sort((a, b) => a - b)
        .forEach((oldId) => {
            if (oldToNew.has(oldId)) return
            const duration = clipboardGlobalSequences[oldId]
            const nextDuration = typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? duration : 0
            const newId = nextGlobalSequences.length
            nextGlobalSequences.push(nextDuration)
            oldToNew.set(oldId, newId)
        })

    return { globalSequences: nextGlobalSequences, oldToNew }
}

export const remapGlobalSequenceReferencesInPlace = (
    value: unknown,
    oldToNew: ReadonlyMap<number, number>,
): void => {
    const record = asRecord(value)
    if (!record) return

    if (isTrackLike(record)) {
        const globalSeqId = record.GlobalSeqId
        if (typeof globalSeqId === 'number' && Number.isInteger(globalSeqId) && globalSeqId >= 0) {
            record.GlobalSeqId = oldToNew.get(globalSeqId) ?? null
        }
    }

    for (const nested of Object.values(record)) {
        const nestedRecord = asRecord(nested)
        if (nestedRecord) {
            remapGlobalSequenceReferencesInPlace(nestedRecord, oldToNew)
            continue
        }

        if (!Array.isArray(nested)) continue
        for (const item of nested) {
            remapGlobalSequenceReferencesInPlace(item, oldToNew)
        }
    }
}
