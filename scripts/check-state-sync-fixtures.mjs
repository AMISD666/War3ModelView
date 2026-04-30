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

for (const relativePath of optionalDocs) {
    if (!existsSync(path.join(repoRoot, relativePath))) {
        console.warn(`SKIP optional local design document was not found: ${relativePath}`)
    }
}

console.log('OK state sync architecture fixtures')
