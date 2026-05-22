import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = path.resolve(import.meta.dirname, '..')
const fixturePath = path.join(repoRoot, 'testmodel', 'tx_053_s03_2_03_skin10_zhibao1.mdx')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-mdl-geoset-extents-check-'))
const bundlePath = path.join(distPath, 'mdl-geoset-extents-check-bundle.mjs')

const fail = (message) => {
    throw new Error(message)
}

const toArrayBuffer = (bytes) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

await esbuild.build({
    stdin: {
        contents: [
            "export { parse as parseMDX } from './vendor/war3-model/mdx/parse.ts'",
            "export { parse as parseMDL } from './vendor/war3-model/mdl/parse.ts'",
            "export { generate as generateMDL } from './vendor/war3-model/mdl/generate.ts'",
        ].join('\n'),
        resolveDir: repoRoot,
        sourcefile: 'mdl-geoset-extents-check-entry.ts',
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
const sequenceCount = sourceModel.Sequences.length
if (!sequenceCount) {
    fail(`Fixture must have at least one sequence: ${fixturePath}`)
}

const mdlText = generateMDL(sourceModel)
const reparsedModel = parseMDL(mdlText)
reparsedModel.Geosets.forEach((geoset, index) => {
    const animCount = geoset.Anims?.length || 0
    if (animCount !== sequenceCount) {
        fail(`Geoset ${index} has ${animCount} sequence extents, expected ${sequenceCount}`)
    }
})

const firstGeoset = reparsedModel.Geosets[0]
if (!firstGeoset.Anims?.[0]?.MinimumExtent || !firstGeoset.Anims?.[0]?.MaximumExtent) {
    fail('Geoset 0 missing fallback sequence extent values')
}

console.log('MDL geoset sequence extent count check passed')
