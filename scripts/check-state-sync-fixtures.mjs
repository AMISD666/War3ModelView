import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const requiredFiles = [
    'src/renderer/src/application/commands/CommandBus.ts',
    'src/renderer/src/application/commands/CommandIntegrityGuard.ts',
    'src/renderer/src/application/cache/RevisionedCacheKeys.ts',
    'src/renderer/src/application/cache/CacheRegistry.ts',
    'src/renderer/src/application/render/RendererSyncService.ts',
]

const optionalDocs = [
    'docs/State_Sync_Cache_Redesign_Plan.md',
    'docs/State_Sync_Commit_Integrity_Repair_Plan.md',
]

const fail = (message) => {
    throw new Error(message)
}

for (const relativePath of requiredFiles) {
    if (!existsSync(path.join(repoRoot, relativePath))) {
        fail(`Missing state-sync architecture file: ${relativePath}`)
    }
}

const commandBusSource = await readFile(
    path.join(repoRoot, 'src/renderer/src/application/commands/CommandBus.ts'),
    'utf8',
)

if (!commandBusSource.includes('validateDocumentReferencesAfterCommand')) {
    fail('CommandBus must keep document reference validation after execute/undo/redo')
}

const cacheKeySource = await readFile(
    path.join(repoRoot, 'src/renderer/src/application/cache/RevisionedCacheKeys.ts'),
    'utf8',
)

if (!/revision/i.test(cacheKeySource)) {
    fail('RevisionedCacheKeys must keep revision-aware cache key logic')
}

const materialTextureRelationsSource = await readFile(
    path.join(repoRoot, 'src/renderer/src/utils/materialTextureRelations.ts'),
    'utf8',
)

for (const requiredToken of [
    'remapMaterialsAfterTextureRemoval',
    'remapParticleEmittersAfterTextureRemoval',
    'findSingleRemovedTextureIndex',
]) {
    if (!materialTextureRelationsSource.includes(requiredToken)) {
        fail(`Texture deletion repair must keep ${requiredToken}`)
    }
}

const textureCommandHandlerSource = await readFile(
    path.join(repoRoot, 'src/renderer/src/application/commands/TextureMaterialCommandHandler.ts'),
    'utf8',
)

if (!textureCommandHandlerSource.includes('findSingleRemovedTextureIndex')) {
    fail('Texture collection writes must detect single texture deletion and remap dependent references')
}

if (!textureCommandHandlerSource.includes('particleEmitters2: remapParticleEmittersAfterTextureRemoval')) {
    fail('Texture deletion repair must remap ParticleEmitters2 TextureID references')
}

const toolWindowCommandHandlersSource = await readFile(
    path.join(repoRoot, 'src/renderer/src/application/window-bridge/ToolWindowCommandHandlers.ts'),
    'utf8',
)

if (!toolWindowCommandHandlersSource.includes('currentTextures.length - 1')) {
    fail('Texture manager delete commands must remap from the current main-window document state')
}

if (!toolWindowCommandHandlersSource.includes('setTextureCollection({ textures })')) {
    fail('Texture manager delete commands must use the canonical texture collection remap path')
}

const textureEditorModalSource = await readFile(
    path.join(repoRoot, 'src/renderer/src/components/modals/TextureEditorModal.tsx'),
    'utf8',
)

if (!textureEditorModalSource.includes("stalePolicy: 'warn'")) {
    fail('Texture manager delete commands must tolerate one stale revision so repeated deletes keep working')
}

const modelNodePatchSource = await readFile(
    path.join(repoRoot, 'src/renderer/src/store/modelNodePatch.ts'),
    'utf8',
)

if (!modelNodePatchSource.includes('replaceNodesByObjectId')) {
    fail('Visual data patch must keep store.nodes synchronized with remapped particle emitter arrays')
}

if (!modelNodePatchSource.includes('NodeType.PARTICLE_EMITTER_2')) {
    fail('Visual data patch must synchronize ParticleEmitter2 node TextureID changes')
}

const extractFunctionBody = (source, functionName) => {
    const start = source.indexOf(`export function ${functionName}`)
    if (start < 0) return ''
    const open = source.indexOf('{', start)
    if (open < 0) return ''
    let depth = 0
    for (let index = open; index < source.length; index++) {
        const char = source[index]
        if (char === '{') depth++
        if (char === '}') {
            depth--
            if (depth === 0) return source.slice(open + 1, index)
        }
    }
    return ''
}

const materialRemovalBody = extractFunctionBody(materialTextureRelationsSource, 'remapMaterialsAfterTextureRemoval')
if (!materialRemovalBody.includes('removedIndex, -1')) {
    fail('Deleted material texture references must become None (-1), not the next texture index')
}

const particleRemovalBody = extractFunctionBody(materialTextureRelationsSource, 'remapParticleEmittersAfterTextureRemoval')
if (!particleRemovalBody.includes('removedIndex, -1')) {
    fail('Deleted particle texture references must become None (-1), not the next texture index')
}

for (const relativePath of optionalDocs) {
    if (!existsSync(path.join(repoRoot, relativePath))) {
        console.warn(`SKIP optional local design document was not found: ${relativePath}`)
    }
}

console.log('OK state sync architecture fixtures')
