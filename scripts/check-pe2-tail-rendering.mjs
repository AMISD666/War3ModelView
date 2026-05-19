import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const particlesPath = path.join(repoRoot, 'vendor/war3-model/renderer/particles.ts')
const source = fs.readFileSync(particlesPath, 'utf8')

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message)
    }
}

assert(
    source.includes('function getParticleEmitter2FrameFlags'),
    'PE2 renderer must use a centralized FrameFlags reader',
)
assert(
    source.includes("if (frameFlags === 0)") &&
    source.includes('return ParticleEmitter2FramesFlags.Head'),
    'PE2 renderer must treat parser-native FrameFlags=0 as Head unless UI booleans override it',
)
assert(
    source.includes("typeof explicitHead === 'boolean' || typeof explicitTail === 'boolean'"),
    'PE2 renderer must let explicit UI Head/Tail booleans override parser FrameFlags',
)
assert(
    !source.includes('FrameFlags || 1'),
    'PE2 renderer must not coerce explicit FrameFlags=0 back to Head',
)
assert(
    source.includes('resetEmitterFrameBuffers'),
    'PE2 renderer must rebuild frame buffers when Head/Tail mode changes',
)
assert(
    /frameFlagsChanged[\s\S]{0,240}resetEmitterFrameBuffers/.test(source),
    'PE2 renderer does not reset buffers after a Head/Tail FrameFlags change',
)
assert(
    source.includes('vec3.transformMat3(particleWorldSpeed, particle.speed, emitterRotationMat3)'),
    'PE2 tail geometry must transform ModelSpace particle velocity into world space before rendering',
)
assert(
    source.includes('vec3.scale(tailPos, particleWorldSpeed, -tailLength)'),
    'PE2 tail length must use the full world velocity vector scaled by TailLength',
)
assert(
    /const tailLength = Number\.isFinite\(tailLengthValue\)[\s\S]{0,80}\? tailLengthValue[\s\S]{0,80}: 0/.test(source),
    'PE2 tail geometry must preserve finite negative TailLength values',
)
assert(
    source.includes('vec3.scale(tailCross, tailCross, scale)'),
    'PE2 tail width must still use particle segment scale',
)
assert(
    source.includes('vec3.transformQuat(tailViewDirection, tailViewDirection, this.rendererData.cameraQuat)') &&
    source.includes('vec3.cross(tailCross, tailViewDirection, tailDirection)'),
    'PE2 tail billboard width must follow the reference camera-Z cross tail-direction path',
)
assert(
    source.includes('vec3.set(tailFallbackAxis, 1, 0, 0)') &&
    source.includes('vec3.set(tailFallbackAxis, 0, 1, 0)') &&
    /vec3\.cross\(tailCross, tailFallbackAxis, tailDirection\)/.test(source),
    'PE2 tail billboard width must fall back when camera axis and tail direction are parallel',
)
assert(
    !source.includes('Math.abs(firstScale) < 0.01') &&
    !source.includes('Math.abs(secondScale) < 0.01'),
    'PE2 renderer must preserve zero ParticleScaling values so Tail particles can taper like the game',
)
assert(
    !source.includes('tailPos[0] = -particle.speed[0] * emitter.props.TailLength'),
    'PE2 tail geometry must not scale directly by raw particle speed',
)
assert(
    !source.includes('vec3.copy(tailViewDirection, this.rendererData.cameraPos)') &&
    !source.includes('vec3.sub(tailViewDirection, this.rendererData.cameraPos, particleWorldPos)'),
    'PE2 tail billboard width must not use a camera-position vector for the reference camera-Z normal',
)
assert(
    source.includes('tailFallbackAxis'),
    'PE2 tail geometry needs a fallback cross axis for zero or parallel directions',
)

console.log('pe2 tail rendering checks ok')
