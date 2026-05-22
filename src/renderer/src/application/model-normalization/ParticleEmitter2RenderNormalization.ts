type MutableRecord = Record<string, unknown>

const asRecord = (value: unknown): MutableRecord | null =>
    value != null && typeof value === 'object' ? value as MutableRecord : null

const finiteNumber = (value: unknown, fallback: number): number => {
    const next = Number(value)
    return Number.isFinite(next) ? next : fallback
}

const positiveInteger = (value: unknown, fallback: number): number =>
    Math.max(1, Math.trunc(finiteNumber(value, fallback)))

const nonNegativeInteger = (value: unknown, fallback: number): number =>
    Math.max(0, Math.trunc(finiteNumber(value, fallback)))

const getIndexedValue = (value: unknown, index: number): unknown => {
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        return (value as ArrayLike<unknown>)[index]
    }
    const record = asRecord(value)
    return record?.[String(index)]
}

const normalizeUvAnim = (value: unknown, fallback: unknown): [number, number, number] => [
    nonNegativeInteger(getIndexedValue(value, 0), nonNegativeInteger(getIndexedValue(fallback, 0), 0)),
    nonNegativeInteger(getIndexedValue(value, 1), nonNegativeInteger(getIndexedValue(fallback, 1), 0)),
    positiveInteger(getIndexedValue(value, 2), positiveInteger(getIndexedValue(fallback, 2), 1)),
]

export const normalizeParticleEmitter2RenderFields = (emitterValue: unknown): void => {
    const emitter = asRecord(emitterValue)
    if (!emitter) return

    emitter.Rows = positiveInteger(emitter.Rows, 1)
    emitter.Columns = positiveInteger(emitter.Columns, 1)
    emitter.TailLength = finiteNumber(emitter.TailLength, 0)
    emitter.Time = finiteNumber(emitter.Time, 0.5)
    emitter.LifeSpan = Math.max(0.001, finiteNumber(emitter.LifeSpan, 1))

    emitter.LifeSpanUVAnim = normalizeUvAnim(emitter.LifeSpanUVAnim, [0, 0, 1])
    emitter.DecayUVAnim = normalizeUvAnim(emitter.DecayUVAnim, [0, 0, 1])
    emitter.TailUVAnim = normalizeUvAnim(emitter.TailUVAnim, [0, 0, 1])
    emitter.TailDecayUVAnim = normalizeUvAnim(emitter.TailDecayUVAnim, [0, 0, 1])

    const baseFrameFlags = typeof emitter.FrameFlags === 'number' && Number.isFinite(emitter.FrameFlags)
        ? emitter.FrameFlags & 0x3
        : 0
    const tailEnabled = emitter.Tail === true || (emitter.Tail !== false && (baseFrameFlags & 2) !== 0)
    emitter.FrameFlags = 1 | (tailEnabled ? 2 : 0)
    emitter.Head = true
    emitter.Tail = tailEnabled
}

