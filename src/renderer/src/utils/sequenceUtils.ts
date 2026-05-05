const toFiniteNumber = (value: unknown, fallback: number): number => {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? numeric : fallback
}

const looksLikeUint32Bytes = (values: unknown[]): values is number[] =>
    values.length >= 8
    && values.length % 4 === 0
    && values.every((value) => {
        const numeric = Number(value)
        return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255
    })

const decodeUint32ByteValues = (values: unknown[]): number[] | null => {
    if (!looksLikeUint32Bytes(values)) return null

    const decoded: number[] = []
    for (let offset = 0; offset + 3 < values.length; offset += 4) {
        decoded.push(
            (
                Number(values[offset])
                | (Number(values[offset + 1]) << 8)
                | (Number(values[offset + 2]) << 16)
                | (Number(values[offset + 3]) << 24)
            ) >>> 0
        )
    }
    return decoded.length >= 2 ? decoded : null
}

const sequenceIntervalValues = (interval: unknown): unknown[] | null => {
    if (!interval) return null
    if (Array.isArray(interval)) return interval
    if (ArrayBuffer.isView(interval)) {
        const values = Array.from(interval as unknown as ArrayLike<unknown>)
        return decodeUint32ByteValues(values) ?? values
    }
    if (
        typeof interval === 'object'
        && 'length' in interval
        && typeof (interval as { length?: unknown }).length === 'number'
    ) {
        const values = Array.from(interval as unknown as ArrayLike<unknown>)
        return decodeUint32ByteValues(values) ?? values
    }
    if (typeof interval === 'object') {
        const keyed = interval as Record<string, unknown>
        if ('0' in keyed || '1' in keyed) {
            const numericKeys = Object.keys(keyed)
                .map(Number)
                .filter(Number.isInteger)
                .filter((key) => key >= 0)
                .sort((left, right) => left - right)
            const values = numericKeys.map((key) => keyed[String(key)])
            return decodeUint32ByteValues(values) ?? values.slice(0, 2)
        }
    }
    return null
}

export const normalizeSequenceInterval = (interval: unknown): [number, number] | null => {
    const rawValues = sequenceIntervalValues(interval)
    const values = rawValues ? decodeUint32ByteValues(rawValues) ?? rawValues : null
    if (!values || values.length < 2) return null

    const start = toFiniteNumber(values[0], 0)
    const end = toFiniteNumber(values[1], start)
    return [start, end]
}

export const normalizeSequenceForPlayback = <T extends Record<string, unknown>>(sequence: T): T => {
    const interval = normalizeSequenceInterval(sequence.Interval)
    return interval ? { ...sequence, Interval: interval } : { ...sequence }
}

export const normalizeSequencesForPlayback = <T extends Record<string, unknown>>(sequences: T[]): T[] =>
    sequences.map(normalizeSequenceForPlayback)

export const getSequenceStartFrame = (sequence: unknown): number => {
    if (!sequence || typeof sequence !== 'object') return 0
    const interval = normalizeSequenceInterval((sequence as { Interval?: unknown }).Interval)
    return interval ? interval[0] : 0
}
