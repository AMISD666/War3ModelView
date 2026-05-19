export type MaterialTrackField = 'TextureID' | 'Alpha'

export const getMaterialTrackEditorTitle = (field: MaterialTrackField): string => (
    field === 'TextureID' ? '编辑材质贴图 ID 关键帧' : '编辑材质透明度关键帧'
)

export const getMaterialTrackFieldName = (
    field: MaterialTrackField,
    materialIndex: number,
    layerIndex: number
): string => `${field}_${materialIndex}_${layerIndex}`

const isFiniteFrame = (value: unknown): value is number => (
    typeof value === 'number' && Number.isFinite(value)
)

const getSequenceStartFrames = (sequences: unknown): number[] => {
    if (!Array.isArray(sequences)) {
        return []
    }

    return sequences
        .map((sequence) => {
            const interval = (sequence as { Interval?: unknown })?.Interval
            if (!Array.isArray(interval) || interval.length < 2) {
                return null
            }
            const start = Number(interval[0])
            const end = Number(interval[1])
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
                return null
            }
            return Math.round(start)
        })
        .filter((frame): frame is number => frame !== null)
}

export const createStaticMaterialScalarTrack = (
    value: number,
    sequences: unknown,
    interpolationType = 0
) => {
    const safeValue = Number.isFinite(value) ? value : 1
    const frames = Array.from(new Set([0, ...getSequenceStartFrames(sequences)]))
        .filter(isFiniteFrame)
        .sort((a, b) => a - b)

    return {
        Keys: frames.map((frame) => ({
            Frame: frame,
            Vector: [safeValue],
            InTan: [0],
            OutTan: [0],
        })),
        LineType: interpolationType,
        InterpolationType: interpolationType,
        GlobalSeqId: null,
    }
}
