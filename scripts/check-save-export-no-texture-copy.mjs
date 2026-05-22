import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')

const read = (relativePath) =>
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

const fail = (message) => {
    throw new Error(message)
}

const saveWorkflow = read('src/renderer/src/application/model-save/SaveCurrentModelWorkflow.ts')
const textureAssets = read('src/renderer/src/application/model-save/TextureSaveAssetService.ts')
const mainLayout = read('src/renderer/src/components/MainLayout.tsx')

if (saveWorkflow.includes('copyReferencedTextures') || mainLayout.includes('copyReferencedTextures')) {
    fail('Save/export workflow must not request referenced texture copying')
}

if (saveWorkflow.includes('copyReferencedTexturesToTarget') || textureAssets.includes('copyReferencedTexturesToTarget')) {
    fail('Save/export asset service must not expose referenced texture copying')
}

if (mainLayout.includes('textureCopyResult')) {
    fail('MainLayout save/export UI must not report texture copy results')
}

console.log('Save/export texture copy check passed')
