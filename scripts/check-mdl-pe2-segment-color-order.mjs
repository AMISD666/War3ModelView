import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_053_s03_2_03_skin10_zhibao1.mdx')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-mdl-pe2-color-check-'))
const bundlePath = path.join(distPath, 'mdl-pe2-color-check-bundle.mjs')

const fail = (message) => {
    throw new Error(message)
}

const toArrayBuffer = (bytes) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

const equalVector3 = (a, b) =>
    a && b &&
    Math.abs(a[0] - b[0]) < 0.00001 &&
    Math.abs(a[1] - b[1]) < 0.00001 &&
    Math.abs(a[2] - b[2]) < 0.00001

const hasNonGraySegmentColor = (emitter) =>
    emitter.SegmentColor?.some((color) => Math.abs(color[0] - color[2]) > 0.00001)

await esbuild.build({
    stdin: {
        contents: [
            "export { parse as parseMDX } from './vendor/war3-model/mdx/parse.ts'",
            "export { parse as parseMDL } from './vendor/war3-model/mdl/parse.ts'",
            "export { generate as generateMDL } from './vendor/war3-model/mdl/generate.ts'",
        ].join('\n'),
        resolveDir: repoRoot,
        sourcefile: 'mdl-pe2-segment-color-check-entry.ts',
        loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    tsconfig: path.join(repoRoot, 'tsconfig.web.json'),
    logLevel: 'silent',
})

const { parseMDX, parseMDL, generateMDL } = await import(pathToFileURL(bundlePath).href)
const sourceModel = parseMDX(toArrayBuffer(fs.readFileSync(fixturePath)))
const sourceEmitter = sourceModel.ParticleEmitters2.find(hasNonGraySegmentColor)
if (!sourceEmitter) {
    fail(`Missing colored ParticleEmitter2 in ${fixturePath}`)
}

const mdlText = generateMDL(sourceModel)
const reparsedModel = parseMDL(mdlText)
const reparsedEmitter = reparsedModel.ParticleEmitters2.find((emitter) => emitter.ObjectId === sourceEmitter.ObjectId)
if (!reparsedEmitter) {
    fail(`Missing reparsed ParticleEmitter2 ObjectId=${sourceEmitter.ObjectId}`)
}

for (let i = 0; i < 3; ++i) {
    const sourceColor = sourceEmitter.SegmentColor[i]
    const reparsedColor = reparsedEmitter.SegmentColor[i]
    if (!equalVector3(sourceColor, reparsedColor)) {
        fail(
            `ParticleEmitter2 ${sourceEmitter.Name} SegmentColor[${i}] channel order changed: ` +
            `source=${Array.from(sourceColor)} reparsed=${reparsedColor ? Array.from(reparsedColor) : 'missing'}`
        )
    }

    const swappedSourceColor = [sourceColor[2], sourceColor[1], sourceColor[0]]
    if (equalVector3(reparsedColor, swappedSourceColor)) {
        fail(`ParticleEmitter2 ${sourceEmitter.Name} SegmentColor[${i}] was written with reversed R/B order`)
    }
}

console.log('MDL ParticleEmitter2 SegmentColor order check passed')
