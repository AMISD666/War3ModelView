import type { DissolveEffectParams } from '../../utils/dissolveEffect'

export type DissolvePointType = 'visible' | 'start' | 'end'

export type DissolveEffectLightPoint = {
    frame: number
    type: DissolvePointType
}

export type DissolveEffectLightCommandPayload = {
    selectedGeosets: number[]
    dissolveTexturePath: string
    dissolvePoints: DissolveEffectLightPoint[]
    saveMode: 'overwrite' | 'saveAs'
}

export type DissolveEffectCoreParams = DissolveEffectParams

const DISSOLVE_POINT_VALUES: Record<DissolvePointType, number> = {
    visible: 1,
    start: 0.75,
    end: 0,
}

const isDissolvePointType = (value: unknown): value is DissolvePointType => (
    value === 'visible' || value === 'start' || value === 'end'
)

const normalizeFrame = (value: unknown): number => {
    const frame = Number(value)
    if (!Number.isFinite(frame)) {
        throw new Error('Dissolve point frame must be a finite number')
    }
    return Math.round(frame)
}

export const normalizeDissolveEffectLightPayload = (
    payload: DissolveEffectLightCommandPayload,
): DissolveEffectCoreParams => {
    if (!Array.isArray(payload.selectedGeosets) || payload.selectedGeosets.length === 0) {
        throw new Error('Dissolve command requires at least one selected geoset')
    }

    const selectedGeosets = payload.selectedGeosets.map((value) => {
        const index = Number(value)
        if (!Number.isInteger(index) || index < 0) {
            throw new Error('Dissolve geoset index must be a non-negative integer')
        }
        return index
    })

    if (typeof payload.dissolveTexturePath !== 'string' || payload.dissolveTexturePath.trim().length === 0) {
        throw new Error('Dissolve command requires a texture path')
    }

    if (payload.saveMode !== 'overwrite' && payload.saveMode !== 'saveAs') {
        throw new Error('Dissolve save mode must be overwrite or saveAs')
    }

    if (!Array.isArray(payload.dissolvePoints) || payload.dissolvePoints.length === 0) {
        throw new Error('Dissolve command requires typed timeline points')
    }

    const dissolvePoints = payload.dissolvePoints
        .map((point) => {
            if (!point || typeof point !== 'object') {
                throw new Error('Dissolve point must be an object')
            }

            if (!isDissolvePointType(point.type)) {
                throw new Error('Dissolve point type must be visible, start, or end')
            }
            return {
                frame: normalizeFrame(point.frame),
                value: DISSOLVE_POINT_VALUES[point.type],
                type: point.type,
            }
        })
        .sort((a, b) => a.frame - b.frame)

    const startPoints = dissolvePoints.filter((point) => point.type === 'start')
    const endPoints = dissolvePoints.filter((point) => point.type === 'end')

    if (startPoints.length === 0 || endPoints.length === 0) {
        throw new Error('Dissolve command requires both start and end points')
    }

    return {
        selectedGeosets,
        dissolveTexturePath: payload.dissolveTexturePath,
        dissolveStartFrame: startPoints[0].frame,
        dissolveEndFrame: endPoints[endPoints.length - 1].frame,
        dissolvePoints,
        seqStart: dissolvePoints[0]?.frame ?? 0,
        seqEnd: dissolvePoints[dissolvePoints.length - 1]?.frame ?? 0,
        saveMode: payload.saveMode,
    }
}
