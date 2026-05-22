import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const repoRoot = path.resolve(import.meta.dirname, '..')
const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'war3modelview-texture-delete-remap-check-'))
const bundlePath = path.join(distPath, 'texture-delete-remap-check-bundle.mjs')

const fail = (message) => {
    throw new Error(message)
}

await esbuild.build({
    stdin: {
        contents: "export { remapMaterialsAfterTextureRemoval, remapParticleEmittersAfterTextureRemoval } from './src/renderer/src/utils/materialTextureRelations.ts'",
        resolveDir: repoRoot,
        sourcefile: 'texture-delete-remap-check-entry.ts',
        loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundlePath,
    tsconfig: path.join(repoRoot, 'tsconfig.web.json'),
    logLevel: 'silent',
})

const {
    remapMaterialsAfterTextureRemoval,
    remapParticleEmittersAfterTextureRemoval,
} = await import(pathToFileURL(bundlePath).href)

const materials = [{
    Layers: [
        { TextureID: 0, Alpha: 1 },
        {
            TextureID: {
                LineType: 0,
                GlobalSeqId: null,
                Keys: [{ Frame: 0, Vector: [0] }],
            },
        },
    ],
}]

const remappedMaterials = remapMaterialsAfterTextureRemoval(materials, 0, 2)
if (remappedMaterials[0].Layers[0].TextureID !== 0) {
    fail(`Static TextureID should follow the replacement slot, got ${remappedMaterials[0].Layers[0].TextureID}`)
}
if (remappedMaterials[0].Layers[1].TextureID.Keys[0].Vector[0] !== 0) {
    fail(`Animated TextureID should follow the replacement slot, got ${remappedMaterials[0].Layers[1].TextureID.Keys[0].Vector[0]}`)
}

const endRemovalMaterials = remapMaterialsAfterTextureRemoval(materials, 2, 2)
if (endRemovalMaterials[0].Layers[0].TextureID !== 0) {
    fail(`Unrelated TextureID should stay unchanged, got ${endRemovalMaterials[0].Layers[0].TextureID}`)
}

const lastTextureMaterials = remapMaterialsAfterTextureRemoval(materials, 0, 0)
if (lastTextureMaterials[0].Layers[0].TextureID !== -1) {
    fail(`Deleting the last texture should still clear the reference, got ${lastTextureMaterials[0].Layers[0].TextureID}`)
}

const emitters = [{ TextureID: 0 }]
const remappedEmitters = remapParticleEmittersAfterTextureRemoval(emitters, 0, 1)
if (remappedEmitters[0].TextureID !== 0) {
    fail(`Particle TextureID should follow the replacement slot, got ${remappedEmitters[0].TextureID}`)
}

console.log('texture delete remap no-none check passed')
