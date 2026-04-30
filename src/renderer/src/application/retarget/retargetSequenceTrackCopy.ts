import { deepClone } from '../../utils/modelMerge'

export const NODE_ANIMATION_FIELDS = [
    'Translation',
    'Rotation',
    'Scaling',
    'Visibility',
    'VisibilityAnim',
    'ColorAnim',
    'AlphaAnim',
    'AmbientColorAnim',
    'IntensityAnim',
    'AmbientIntensityAnim',
    'AttenuationStartAnim',
    'AttenuationEndAnim',
    'EmissionRateAnim',
    'LifeSpanAnim',
    'SpeedAnim',
    'VariationAnim',
    'LatitudeAnim',
    'LongitudeAnim',
    'WidthAnim',
    'LengthAnim',
    'GravityAnim',
    'TargetTranslation',
    'EventTrack',
] as const

export const NODE_OPTIONAL_TRACK_FIELDS = [
    'Color',
    'AmbColor',
    'AmbientColor',
    'Alpha',
    'Intensity',
    'AmbIntensity',
    'AmbientIntensity',
    'AttenuationStart',
    'AttenuationEnd',
    'EmissionRate',
    'LifeSpan',
    'Speed',
    'Variation',
    'Latitude',
    'Longitude',
    'Width',
    'Length',
    'Gravity',
] as const

const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object'

const isAnimTrack = (value: unknown): boolean =>
    isObject(value) && Array.isArray((value as { Keys?: unknown }).Keys)

const hasGlobalSequence = (value: unknown): boolean => {
    if (!isObject(value)) return false
    const globalSeqId = (value as any).GlobalSeqId ?? (value as any).GlobalSequenceId
    return globalSeqId !== undefined && globalSeqId !== null && Number(globalSeqId) >= 0
}

const cloneValue = <T,>(value: T): T => deepClone(value)

const normalizeFrame = (frame: unknown): number | null => {
    const value = Number(frame)
    return Number.isFinite(value) ? value : null
}

const shiftFrame = (
    frame: number,
    sourceInterval: [number, number],
    targetInterval: [number, number],
): number => targetInterval[0] + Math.round(frame - sourceInterval[0])

const appendShiftedTrackKeys = (
    targetTrack: unknown,
    sourceTrack: unknown,
    sourceInterval: [number, number],
    targetInterval: [number, number],
): { track: unknown; copiedKeyCount: number } => {
    if (!isAnimTrack(sourceTrack) || hasGlobalSequence(sourceTrack)) {
        return { track: targetTrack, copiedKeyCount: 0 }
    }

    const sourceKeys: Record<string, any>[] = []
    for (const key of (sourceTrack as { Keys: unknown[] }).Keys ?? []) {
        if (!isObject(key)) continue
        const frame = normalizeFrame((key as any).Frame)
        if (frame === null || frame < sourceInterval[0] || frame > sourceInterval[1]) continue
        sourceKeys.push({
            ...cloneValue(key as Record<string, any>),
            Frame: shiftFrame(frame, sourceInterval, targetInterval),
        })
    }

    if (sourceKeys.length === 0) {
        return { track: targetTrack, copiedKeyCount: 0 }
    }

    const baseTrack = isAnimTrack(targetTrack)
        ? cloneValue(targetTrack as Record<string, any>)
        : {
            ...cloneValue(sourceTrack as Record<string, any>),
            Keys: [],
        }
    const existingKeys = Array.isArray((baseTrack as any).Keys) ? (baseTrack as any).Keys : []
    const preservedKeys = existingKeys.filter((key: any) => {
        const frame = normalizeFrame(key?.Frame)
        return frame === null || frame < targetInterval[0] || frame > targetInterval[1]
    })

    const byFrame = new Map<number, Record<string, any>>()
    const mergedKeys = [...preservedKeys.map((key: any) => cloneValue(key)), ...sourceKeys]
    for (const key of mergedKeys) {
        const frame = normalizeFrame(key?.Frame)
        if (frame === null) continue
        byFrame.set(frame, key)
    }
    ;(baseTrack as any).Keys = Array.from(byFrame.values()).sort((a, b) => Number(a.Frame) - Number(b.Frame))

    return {
        track: baseTrack,
        copiedKeyCount: sourceKeys.length,
    }
}

const appendShiftedEventTrackFrames = (
    targetNode: Record<string, any>,
    sourceNode: Record<string, any>,
    field: string,
    sourceInterval: [number, number],
    targetInterval: [number, number],
): number => {
    if (hasGlobalSequence(sourceNode)) return 0
    const sourceTrack = sourceNode[field]
    if (!sourceTrack || typeof sourceTrack.length !== 'number') return 0

    const shiftedFrames: number[] = []
    for (let i = 0; i < sourceTrack.length; i += 1) {
        const frame = normalizeFrame(sourceTrack[i])
        if (frame === null || frame < sourceInterval[0] || frame > sourceInterval[1]) continue
        shiftedFrames.push(shiftFrame(frame, sourceInterval, targetInterval))
    }
    if (shiftedFrames.length === 0) return 0

    const targetTrack = targetNode[field]
    const preservedFrames: number[] = []
    if (targetTrack && typeof targetTrack.length === 'number') {
        for (let i = 0; i < targetTrack.length; i += 1) {
            const frame = normalizeFrame(targetTrack[i])
            if (frame === null || frame < targetInterval[0] || frame > targetInterval[1]) {
                preservedFrames.push(Number(targetTrack[i]))
            }
        }
    }

    targetNode[field] = Array.from(new Set([...preservedFrames, ...shiftedFrames])).sort((a, b) => a - b)
    return shiftedFrames.length
}

const isEventTrackField = (field: string): boolean => field === 'EventTrack' || field === 'EventTrack2'

export const appendShiftedNodeAnimationFields = (
    sourceNode: Record<string, any> | undefined,
    targetNode: Record<string, any>,
    sourceInterval: [number, number],
    targetInterval: [number, number],
    fields: readonly string[] = NODE_ANIMATION_FIELDS,
): number => {
    if (!sourceNode || !targetNode) return 0
    let copied = 0
    for (const field of fields) {
        if (isEventTrackField(field)) {
            copied += appendShiftedEventTrackFrames(targetNode, sourceNode, field, sourceInterval, targetInterval)
            continue
        }
        const result = appendShiftedTrackKeys(targetNode[field], sourceNode[field], sourceInterval, targetInterval)
        if (result.copiedKeyCount > 0) {
            targetNode[field] = result.track
            copied += result.copiedKeyCount
        }
    }
    return copied
}
