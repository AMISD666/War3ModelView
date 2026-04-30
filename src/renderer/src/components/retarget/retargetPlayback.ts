import type { ModelData } from '../../types/model'

export interface RetargetSequenceOption {
    value: number
    label: string
    interval: [number, number]
}

export interface RetargetPlaybackState {
    sequenceIndex: number
    frame: number
    isPlaying: boolean
}

export const TPOSE_SEQUENCE_INDEX = -1

export const createRetargetPlaybackState = (): RetargetPlaybackState => ({
    sequenceIndex: TPOSE_SEQUENCE_INDEX,
    frame: 0,
    isPlaying: false,
})

export const readSequenceInterval = (sequence: unknown): [number, number] | null => {
    const interval = (sequence as any)?.Interval
    if (!interval || typeof interval.length !== 'number' || interval.length < 2) return null
    const start = Number(interval[0])
    const end = Number(interval[1])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
    return [start, end]
}

export const getRetargetSequenceOptions = (modelData: ModelData | null | undefined): RetargetSequenceOption[] => {
    const sequences = Array.isArray((modelData as any)?.Sequences) ? (modelData as any).Sequences : []
    return [
        { value: TPOSE_SEQUENCE_INDEX, label: 'T-Pose', interval: [0, 0] },
        ...sequences.map((sequence: any, index: number) => {
            const interval = readSequenceInterval(sequence) ?? [0, 0]
            const name = String(sequence?.Name ?? `Sequence ${index + 1}`)
            return {
                value: index,
                label: `${name} (${interval[0]}-${interval[1]})`,
                interval,
            }
        }),
    ]
}

export const getPlaybackInterval = (
    options: RetargetSequenceOption[],
    sequenceIndex: number
): [number, number] => options.find((option) => option.value === sequenceIndex)?.interval ?? [0, 0]

export const clampPlaybackFrame = (frame: number, interval: [number, number]): number => {
    const [start, end] = interval
    if (end <= start) return start
    if (!Number.isFinite(frame)) return start
    return Math.max(start, Math.min(end, frame))
}
