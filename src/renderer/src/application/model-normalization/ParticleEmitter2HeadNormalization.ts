import { normalizeParticleEmitter2RenderFields } from './ParticleEmitter2RenderNormalization'

type MutableRecord = Record<string, unknown>

const asRecord = (value: unknown): MutableRecord | null =>
    value != null && typeof value === 'object' ? value as MutableRecord : null

const normalizeParticleEmitter2Head = (emitter: MutableRecord): void => {
    normalizeParticleEmitter2RenderFields(emitter)
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
