import type { JumpxScalarKeyDto, JumpxStaticSceneResult } from '../../types/jumpxImport'
import type { ModelData, Sequence } from '../../types/model'
import type { ParticleEmitter2Node } from '../../types/node'

type War3Track = {
    LineType: number
    InterpolationType: number
    GlobalSeqId: number | null
    Keys: Array<{ Frame: number; Vector: Float32Array }>
}

const JUMPX_TRACK_LINE_TYPE_DONT_INTERP = 0

const frameToMs = (frame: number, framesPerSecond: number): number =>
    Math.round((Math.max(0, frame) / Math.max(1, framesPerSecond)) * 1000)

const keyFrame = (
    key: { frame: number; timeMs?: number },
    framesPerSecond: number,
    sourceStartFrame: number,
): number => {
    if (Number.isFinite(key.timeMs)) {
        return Math.round(Number(key.timeMs))
    }
    return frameToMs(Number(key.frame) - sourceStartFrame, framesPerSecond)
}

const finite = (value: number | undefined, fallback = 0): number =>
    Number.isFinite(value) ? Number(value) : fallback

const makeTrack = (keys: Array<{ frame: number; value: number }>): War3Track | null => {
    const valuesByFrame = new Map<number, number>()
    for (const key of keys) {
        if (Number.isFinite(key.frame) && Number.isFinite(key.value)) {
            valuesByFrame.set(Math.round(key.frame), key.value)
        }
    }
    const sorted = Array.from(valuesByFrame, ([frame, value]) => ({ frame, value }))
        .sort((a, b) => a.frame - b.frame)
    if (sorted.length === 0) {
        return null
    }
    return {
        LineType: JUMPX_TRACK_LINE_TYPE_DONT_INTERP,
        InterpolationType: JUMPX_TRACK_LINE_TYPE_DONT_INTERP,
        GlobalSeqId: null,
        Keys: sorted.map((key) => ({
            Frame: key.frame,
            Vector: new Float32Array([key.value]),
        })),
    }
}

const referenceParticleName = (name: string): string => name.trim().replace(/\./g, '_')

const sequenceInterval = (sequence: Sequence): [number, number] | null => {
    const start = Number(sequence.Interval?.[0])
    const end = Number(sequence.Interval?.[1])
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null
    }
    return [Math.round(Math.min(start, end)), Math.round(Math.max(start, end))]
}

const sourceEmissionKeys = (
    keys: JumpxScalarKeyDto[],
    framesPerSecond: number,
    sourceStartFrame: number,
): Array<{ frame: number; value: number }> =>
    keys
        .map((sourceKey) => ({
            frame: keyFrame(sourceKey, framesPerSecond, sourceStartFrame),
            value: Math.max(0, finite(sourceKey.value)),
        }))
        .filter((sourceKey) => Number.isFinite(sourceKey.frame) && Number.isFinite(sourceKey.value))
        .sort((a, b) => a.frame - b.frame)

const valueBeforeFrame = (keys: Array<{ frame: number; value: number }>, frame: number): number => {
    let value = 0
    for (const key of keys) {
        if (key.frame >= frame) {
            break
        }
        value = key.value
    }
    return value
}

const addLifecycleWindow = (
    values: Map<number, number>,
    activationFrame: number,
    sourceOffFrame: number,
    sequenceEnd: number,
    emissionRate: number,
    lifeMs: number,
): void => {
    if (activationFrame > sequenceEnd || emissionRate <= 0 || lifeMs <= 0) {
        return
    }

    const onEnd = Math.min(sequenceEnd, sourceOffFrame - 1, activationFrame + lifeMs - 1)
    if (onEnd < activationFrame) {
        return
    }

    values.set(activationFrame, emissionRate)
    values.set(onEnd, emissionRate)

    const offFrame = Math.min(sourceOffFrame, activationFrame + lifeMs)
    if (offFrame <= sequenceEnd) {
        values.set(offFrame, 0)
    }
    values.set(sequenceEnd, 0)
}

const addKeyedLifecycleWindows = (
    values: Map<number, number>,
    keys: Array<{ frame: number; value: number }>,
    sequenceStart: number,
    sequenceEnd: number,
    fallbackRate: number,
    lifeMs: number,
): void => {
    let segmentStart: number | null = null
    let segmentRate = fallbackRate
    let previousValue = valueBeforeFrame(keys, sequenceStart)
    if (previousValue > 0) {
        segmentStart = sequenceStart
        segmentRate = previousValue
    }

    for (const key of keys) {
        if (key.frame < sequenceStart) {
            continue
        }
        if (key.frame > sequenceEnd) {
            break
        }

        if (segmentStart === null && key.value > 0) {
            segmentStart = key.frame
            segmentRate = key.value
        } else if (segmentStart !== null && key.value <= 0) {
            addLifecycleWindow(values, segmentStart, key.frame, sequenceEnd, segmentRate, lifeMs)
            segmentStart = null
            segmentRate = fallbackRate
        }
        previousValue = key.value
    }

    if (segmentStart !== null && previousValue > 0) {
        addLifecycleWindow(values, segmentStart, sequenceEnd + 1, sequenceEnd, segmentRate, lifeMs)
    }
}

const buildLifecycleEmissionTrack = (
    emissionRate: number,
    lifeSpanSeconds: number,
    sequences: Sequence[],
    keys: JumpxScalarKeyDto[],
    framesPerSecond: number,
    sourceStartFrame: number,
): War3Track | null => {
    const rate = Math.max(0, finite(emissionRate))
    const lifeMs = Math.max(0, Math.round(finite(lifeSpanSeconds) * 1000))
    if (rate <= 0 || lifeMs <= 0 || sequences.length === 0) {
        return null
    }

    const keyedEmission = sourceEmissionKeys(keys, framesPerSecond, sourceStartFrame)
    const valuesByFrame = new Map<number, number>()
    for (const sequence of sequences) {
        const interval = sequenceInterval(sequence)
        if (!interval) {
            continue
        }
        const [start, end] = interval
        if (keyedEmission.length > 0) {
            addKeyedLifecycleWindows(valuesByFrame, keyedEmission, start, end, rate, lifeMs)
        } else {
            addLifecycleWindow(valuesByFrame, start, end + 1, end, rate, lifeMs)
        }
    }

    return makeTrack(Array.from(valuesByFrame, ([frame, value]) => ({ frame, value })))
}

export const applyParticleLifecycleEmissionTracks = (
    scene: JumpxStaticSceneResult,
    modelData: ModelData,
    framesPerSecond: number,
    sourceStartFrame: number,
): number => {
    const sequences = modelData.Sequences ?? []
    if (sequences.length === 0 || !modelData.ParticleEmitters2?.length) {
        return 0
    }

    const emittersByName = new Map<string, ParticleEmitter2Node>()
    for (const emitter of modelData.ParticleEmitters2 as ParticleEmitter2Node[]) {
        emittersByName.set(String(emitter.Name ?? ''), emitter)
    }

    let mappedCount = 0
    for (const particle of scene.particles ?? []) {
        const emitter = emittersByName.get(referenceParticleName(particle.name))
        if (!emitter) {
            continue
        }
        const track = buildLifecycleEmissionTrack(
            particle.emissionRate,
            particle.lifeSpan,
            sequences,
            particle.emissionRateKeys ?? [],
            framesPerSecond,
            sourceStartFrame,
        )
        if (!track) {
            continue
        }
        emitter.EmissionRate = track
        mappedCount += track.Keys.length
    }
    return mappedCount
}
