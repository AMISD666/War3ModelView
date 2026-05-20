import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { quat, vec3 } from 'gl-matrix'

const repoRoot = path.resolve(import.meta.dirname, '..')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-jumpx-pe2-check-'))
const bundlePath = path.join(distPath, 'jumpx-pe2-check-bundle.mjs')

const fail = (message) => {
    throw new Error(message)
}

const close = (actual, expected, label) => {
    if (Math.abs(actual - expected) > 1e-6) {
        fail(`${label} mismatch: ${actual} vs ${expected}`)
    }
}

const vectorClose = (actual, expected, label) => {
    for (let index = 0; index < expected.length; index += 1) {
        close(actual[index], expected[index], `${label}[${index}]`)
    }
}

const rotateVec3 = (rotation, vector) => {
    const q = quat.fromValues(rotation[0], rotation[1], rotation[2], rotation[3])
    const out = vec3.fromValues(vector[0], vector[1], vector[2])
    vec3.transformQuat(out, out, q)
    return Array.from(out)
}

const buildImportBundle = async () => {
    fs.mkdirSync(distPath, { recursive: true })
    await esbuild.build({
        stdin: {
            contents: "export { mapJumpxParticlesToParticleEmitter2 } from './src/renderer/src/application/model-import/JumpxParticleMapper.ts'",
            resolveDir: repoRoot,
            sourcefile: 'jumpx-pe2-check-entry.ts',
            loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: bundlePath,
        tsconfig: path.join(repoRoot, 'tsconfig.web.json'),
        logLevel: 'silent',
    })
}

const makeParticle = (name, width, height, rows = 1, columns = 1, overrides = {}) => ({
    particleIndex: 0,
    name,
    parentBoneId: 0,
    pivot: [0, 0, 0],
    textureId: 0,
    rawFlags: 0,
    saveFlags: 0,
    rawDataAddr: 0,
    particleFlags: 0,
    blendMode: 0x20000,
    partFlags: 0x8000,
    emissionRate: 1,
    speed: 0,
    speedVariation: 0,
    coneAngle: 0,
    gravity: 0,
    lifeRandom: null,
    lifeSpan: 1,
    width,
    height,
    rows,
    columns,
    priorityPlane: 0,
    startColor: [255, 255, 255],
    midColor: [255, 255, 255],
    endColor: [255, 255, 255],
    alpha: [255, 255, 255],
    particleScaling: [1, 1, 1],
    middleTime: 0.5,
    tailLength: 0,
    normal: [0, 0, 1],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    rotVec: [0, 0, 0],
    rotVel: [0, 0, 0],
    lifeSpanHeadUVAnim: [0, 0, 0],
    decayHeadUVAnim: [0, 0, 0],
    lifeSpanTailUVAnim: [0, 0, 0],
    decayTailUVAnim: [0, 0, 0],
    emissionRateKeys: [],
    visibilityKeys: [],
    ...overrides,
})

const main = async () => {
    await buildImportBundle()
    const { mapJumpxParticlesToParticleEmitter2 } = await import(pathToFileURL(bundlePath).href)
    const particles = [
        makeParticle('part.8huaban', 20.106627, 17.396976, 4, 2),
        makeParticle('part.any_other_plane', 126.422134, 92.530380),
    ]
    const mapped = mapJumpxParticlesToParticleEmitter2(
        particles,
        10,
        { defaultObjectId: 0, objectIdByBoneId: new Map([[0, 0]]) },
        new Map([[0, 0]]),
        [],
    )
    const huaban = mapped.find((particle) => particle.Name === 'part_8huaban')
    const generic = mapped.find((particle) => particle.Name === 'part_any_other_plane')
    if (!huaban || !generic) {
        fail(`Mapped JumpX PE2 names are missing: ${JSON.stringify(mapped.map((particle) => particle.Name))}`)
    }
    close(huaban.Width, 17.396976, 'part.8huaban Width')
    close(huaban.Length, 20.106627, 'part.8huaban Length')
    close(huaban.Rows, 2, 'part.8huaban Rows should use JumpX V cells')
    close(huaban.Columns, 4, 'part.8huaban Columns should use JumpX U cells')
    if (JSON.stringify(huaban.LifeSpanUVAnim) !== JSON.stringify([0, 3, 1])) {
        fail(`part.8huaban life UV sequence should advance across JumpX U cells first: ${JSON.stringify(huaban.LifeSpanUVAnim)}`)
    }
    if (JSON.stringify(huaban.DecayUVAnim) !== JSON.stringify([4, 8, 1])) {
        fail(`part.8huaban decay UV sequence should continue after the first JumpX U row: ${JSON.stringify(huaban.DecayUVAnim)}`)
    }
    close(generic.Width, 92.530380, 'generic JumpX PE2 Width')
    close(generic.Length, 126.422134, 'generic JumpX PE2 Length')
    if (generic.ModelSpace || (generic.Flags & 0x80000) !== 0) {
        fail('JumpX flag 0 particles should stay bone-space in War3 PE2 mapping')
    }
    if (generic.LineEmitter || (generic.Flags & 0x20000) !== 0) {
        fail('JumpX flag 0 particles should not be forced to War3 PE2 LineEmitter')
    }

    const directional = mapJumpxParticlesToParticleEmitter2(
        [
            makeParticle('part.directional', 1, 1, 1, 1, {
                normal: [1, 0, 0],
                xAxis: [0, 0, 1],
                yAxis: [0, -1, 0],
                emissionRateKeys: [{ frame: 10667, value: 1 }],
            }),
        ],
        20,
        { defaultObjectId: 0, objectIdByBoneId: new Map([[0, 0]]) },
        new Map([[0, 0]]),
        [],
    )[0]
    const rotation = Array.from(directional.Rotation.Keys[0].Vector)
    vectorClose(rotateVec3(rotation, [0, 0, 1]), [0, 1, 0], 'JumpX normal should become local +Z emission direction')
    close(directional.Rotation.Keys[0].Frame, 0, 'static PE2 rotation identity guard frame')
    close(directional.Rotation.Keys[1].Frame, 10667, 'static PE2 rotation should be sampleable inside the JumpX sequence')
    close(directional.Translation.Keys[1].Frame, 10667, 'static PE2 translation should be sampleable inside the JumpX sequence')
    console.log('JumpX PE2 width/length mapping check passed')
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
}).finally(() => {
    fs.rmSync(distPath, { recursive: true, force: true })
})
