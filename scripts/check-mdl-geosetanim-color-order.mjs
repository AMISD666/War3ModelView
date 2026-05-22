import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_053_s03_2_03_skin10_zhibao1.mdx')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-mdl-geosetanim-color-check-'))
const bundlePath = path.join(distPath, 'mdl-geosetanim-color-check-bundle.mjs')

const fail = (message) => {
    throw new Error(message)
}

const toArrayBuffer = (bytes) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

const firstColorVector = (color) => {
    if (color instanceof Float32Array) return color
    if (color?.Keys?.[0]?.Vector) return color.Keys[0].Vector
    return null
}

const equalVector3 = (a, b) =>
    a && b &&
    Math.abs(a[0] - b[0]) < 0.00001 &&
    Math.abs(a[1] - b[1]) < 0.00001 &&
    Math.abs(a[2] - b[2]) < 0.00001

await esbuild.build({
    stdin: {
        contents: [
            "export { parse as parseMDX } from './vendor/war3-model/mdx/parse.ts'",
            "export { parse as parseMDL } from './vendor/war3-model/mdl/parse.ts'",
            "export { generate as generateMDL } from './vendor/war3-model/mdl/generate.ts'",
        ].join('\n'),
        resolveDir: repoRoot,
        sourcefile: 'mdl-geosetanim-color-check-entry.ts',
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
const sourceAnim = sourceModel.GeosetAnims.find((anim) => firstColorVector(anim.Color))
if (!sourceAnim) {
    fail(`Missing colored GeosetAnim in ${fixturePath}`)
}

const sourceColor = firstColorVector(sourceAnim.Color)
const mdlText = generateMDL(sourceModel)
const reparsedModel = parseMDL(mdlText)
const reparsedAnim = reparsedModel.GeosetAnims.find((anim) => anim.GeosetId === sourceAnim.GeosetId)
const reparsedColor = firstColorVector(reparsedAnim?.Color)

if (!equalVector3(sourceColor, reparsedColor)) {
    fail(
        `GeosetAnim ${sourceAnim.GeosetId} color channel order changed: ` +
        `source=${Array.from(sourceColor)} reparsed=${reparsedColor ? Array.from(reparsedColor) : 'missing'}`
    )
}

const swappedSourceColor = [sourceColor[2], sourceColor[1], sourceColor[0]]
if (equalVector3(reparsedColor, swappedSourceColor)) {
    fail(`GeosetAnim ${sourceAnim.GeosetId} color was written with reversed R/B order`)
}

console.log('MDL GeosetAnim color order check passed')
