type MutableRecord = Record<string, unknown>

const asRecord = (value: unknown): MutableRecord | null =>
    value != null && typeof value === 'object' ? value as MutableRecord : null

const normalizeParticleEmitter2Head = (emitter: MutableRecord): void => {
    const baseFrameFlags = typeof emitter.FrameFlags === 'number' ? emitter.FrameFlags & 0x3 : 0
    const tail = emitter.Tail === true || (emitter.Tail !== false && (baseFrameFlags & 2) !== 0)
    const frameFlags = 1 | (tail ? 2 : 0)
    emitter.FrameFlags = frameFlags
    emitter.Head = true
    emitter.Tail = tail
}

export const normalizeParticleEmitter2HeadFlags = (modelData: unknown): void => {
    const model = asRecord(modelData)
    const emitters = Array.isArray(model?.ParticleEmitters2) ? model.ParticleEmitters2 : []
    for (const emitterValue of emitters) {
        const emitter = asRecord(emitterValue)
        if (emitter) {
            normalizeParticleEmitter2Head(emitter)
        }
    }
}
