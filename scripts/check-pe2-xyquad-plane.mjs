import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'

const repoRoot = process.cwd()
const particlesPath = path.join(repoRoot, 'vendor/war3-model/renderer/particles.ts')
const source = fs.readFileSync(particlesPath, 'utf8')
const require = createRequire(import.meta.url)

function fail(message) {
    console.error(`[check-pe2-xyquad-plane] ${message}`)
    process.exit(1)
}

const xyQuadBranchMatch = source.match(/if \(hasParticleFlag\(emitter\.props, ParticleEmitter2Flags\.XYQuad\)\) \{([\s\S]*?)\n                \}/)
if (!xyQuadBranchMatch) {
    fail('Could not find the ParticleEmitter2 XYQuad vertex branch.')
}

if (!source.includes('function setXYQuadAxesFromVelocity')) {
    fail('Missing velocity-derived XYQuad axis helper.')
}

if (!source.includes('quadRight: vec3') || !source.includes('quadUp: vec3')) {
    fail('Particle state must store stable XYQuad axes created at spawn time.')
}

if (!source.includes('!isModelSpace && hasParticleFlag(emitter.props, ParticleEmitter2Flags.XYQuad)')) {
    fail('Only world-space XYQuad particles should derive stable axes from particle velocity at spawn time.')
}

if (!source.includes('setXYQuadAxesFromVelocity(particle.speed, particle.quadRight, particle.quadUp)')) {
    fail('World-space XYQuad particles must derive their stable axes from particle velocity at spawn time.')
}

const xyQuadBranch = xyQuadBranchMatch[1]

for (const expected of [
    'const x = this.particleBaseVectors[i][0] * scale',
    'const y = this.particleBaseVectors[i][1] * scale',
    'const isModelSpace = hasParticleFlag(emitter.props, ParticleEmitter2Flags.ModelSpace)',
    'vec3.set(xyQuadLocalOffset, x, y, 0)',
    'mat3.fromMat4(emitterRotationMat3, emitterMatrix)',
    'vec3.transformMat3(xyQuadLocalOffset, xyQuadLocalOffset, emitterRotationMat3)',
    'emitter.headVertices[index * 12 + i * 3 + 2] = xyQuadLocalOffset[2]',
    'emitter.headVertices[index * 12 + i * 3] = particle.quadRight[0] * x + particle.quadUp[0] * y',
    'emitter.headVertices[index * 12 + i * 3 + 1] = particle.quadRight[1] * x + particle.quadUp[1] * y',
    'emitter.headVertices[index * 12 + i * 3 + 2] = 0'
]) {
    if (!xyQuadBranch.includes(expected)) {
        fail(`Missing expected XYQuad plane-preserving statement: ${expected}`)
    }
}

for (const forbidden of [
    'const cosA = Math.cos(particle.angle)',
    'const sinA = Math.sin(particle.angle)'
]) {
    if (xyQuadBranch.includes(forbidden)) {
        fail(`XYQuad head quads must not use random particle angle orientation: ${forbidden}`)
    }
}

const war3 = require(path.join(repoRoot, 'vendor/war3-model/dist/war3-model.cjs'))

function parseMdxFixture(relativePath) {
    const fixturePath = path.join(repoRoot, relativePath)
    if (!fs.existsSync(fixturePath)) {
        return null
    }
    const fixtureBuffer = fs.readFileSync(fixturePath)
    return war3.parseMDX(fixtureBuffer.buffer.slice(
        fixtureBuffer.byteOffset,
        fixtureBuffer.byteOffset + fixtureBuffer.byteLength
    ))
}

const whirlpoolModel = parseMdxFixture('testmodel/7474.mdx')
if (whirlpoolModel) {
    const whirlpoolEmitter = whirlpoolModel.ParticleEmitters2?.find((emitter) => emitter.Name === 'BlizParticle01')
    if (!whirlpoolEmitter) {
        fail('Fixture testmodel/7474.mdx must contain the BlizParticle01 ParticleEmitter2 regression emitter.')
    }

    if ((whirlpoolEmitter.Flags & 1048576) === 0 || (whirlpoolEmitter.Flags & 524288) !== 0) {
        fail('7474 BlizParticle01 must remain a world-space XYQuad emitter.')
    }

    if ((whirlpoolEmitter.FrameFlags & 1) === 0 || (whirlpoolEmitter.FrameFlags & 2) !== 0) {
        fail('7474 BlizParticle01 must remain a Head-only emitter so the regression covers XYQuad head orientation.')
    }

    if (whirlpoolEmitter.Latitude !== 0 || whirlpoolEmitter.Width <= 0 || whirlpoolEmitter.Length <= 0 || whirlpoolEmitter.Speed <= 0) {
        fail('7474 BlizParticle01 must remain a flat moving whirlpool emitter with zero latitude and nonzero size/speed.')
    }
}

const modelSpaceModel = parseMdxFixture('testmodel/nwdg2.mdx')
if (!modelSpaceModel) {
    fail('Missing fixture testmodel/nwdg2.mdx for the model-space XYQuad rotation regression.')
}

const modelSpaceEmitter = modelSpaceModel.ParticleEmitters2?.find((emitter) => emitter.Name === 'BlizParticle01')
const modelSpaceNode = modelSpaceModel.Nodes?.find((node) => node.ObjectId === modelSpaceEmitter?.ObjectId)
if (!modelSpaceEmitter || !modelSpaceNode) {
    fail('Fixture testmodel/nwdg2.mdx must contain the BlizParticle01 ParticleEmitter2 regression emitter and node.')
}

if ((modelSpaceEmitter.Flags & 1048576) === 0 || (modelSpaceEmitter.Flags & 524288) === 0) {
    fail('nwdg2 BlizParticle01 must remain a ModelSpace XYQuad emitter.')
}

if (!modelSpaceNode.Rotation?.Keys?.length) {
    fail('nwdg2 BlizParticle01 must keep rotation keys so the regression covers node-rotated XYQuad planes.')
}

console.log('[check-pe2-xyquad-plane] ok')
