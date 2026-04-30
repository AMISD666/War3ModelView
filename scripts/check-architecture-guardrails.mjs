import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const toRepoPath = (filePath) => path.relative(repoRoot, filePath).replace(/\\/g, '/')

const fail = (message) => {
    throw new Error(message)
}

const requiredFiles = [
    'AGENTS.md',
    'docs/DEVELOPMENT_RULES.md',
    'scripts/check-architecture-guardrails.mjs',
    'scripts/check-mdx-strict-export.mjs',
    'scripts/check-state-sync-fixtures.mjs',
]

const sourceRoots = [
    'src/renderer/src',
    'src-tauri/src',
    'scripts',
]

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.rs'])

const ignoredDirNames = new Set([
    '.git',
    '.vite',
    'node_modules',
    'target',
    'dist',
    'out',
    'build',
    'release',
])

const frozenBaselines = new Map([
    ['src/renderer/src/components/viewer/ViewerImpl.tsx', 9128],
    ['src/renderer/src/components/animation/Timeline/TimelinePanel.tsx', 3685],
    ['src/renderer/src/store/modelStore.ts', 3620],
    ['src/renderer/src/components/MainLayout.tsx', 2763],
    ['src/renderer/src/utils/modelOptimization.ts', 191],
    ['src/renderer/src/components/modals/TextureEditorModal.tsx', 2158],
    ['src-tauri/src/main.rs', 2076],
    ['src/renderer/src/components/modals/MaterialEditorModal.tsx', 1831],
    ['src/renderer/src/components/editors/UVEditor.tsx', 1724],
    ['src/renderer/src/components/node/ParticleEmitter2Dialog.tsx', 1013],
    ['src/renderer/src/application/model-save/prepareModelDataForSave.ts', 1021],
    ['src/renderer/src/components/viewer/textureLoader.ts', 438],
    ['src/renderer/src/components/node/NodeManagerWindow.tsx', 1014],
    ['src/renderer/src/components/animation/TextureAnimGizmoPanel.tsx', 1210],
    ['src/renderer/src/components/DebugRenderer.ts', 1025],
    ['src/renderer/src/components/editors/KeyframeEditor.tsx', 996],
    ['src/renderer/src/components/GeosetVisibilityPanel.tsx', 922],
    ['src/renderer/src/components/ViewerToolbar.tsx', 890],
    ['src/renderer/src/shortcuts/actions.ts', 850],
])

const architectureViolations = []
const sizeWarnings = []

const assertRequiredFiles = () => {
    for (const relativePath of requiredFiles) {
        if (!existsSync(path.join(repoRoot, relativePath))) {
            architectureViolations.push(`Missing required project rule file: ${relativePath}`)
        }
    }
}

const readPackageJson = async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
    const scripts = packageJson.scripts ?? {}
    for (const [name, command] of Object.entries(scripts)) {
        const match = String(command).match(/node\s+(scripts\/[^\s]+)/)
        if (match && !existsSync(path.join(repoRoot, match[1]))) {
            architectureViolations.push(`package.json script "${name}" points to missing ${match[1]}`)
        }
    }
}

const walk = async (dirPath, files) => {
    if (!existsSync(dirPath)) {
        return
    }

    for (const entry of await readdir(dirPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirNames.has(entry.name)) {
                await walk(path.join(dirPath, entry.name), files)
            }
            continue
        }

        if (!entry.isFile()) {
            continue
        }

        const filePath = path.join(dirPath, entry.name)
        if (sourceExtensions.has(path.extname(filePath))) {
            files.push(filePath)
        }
    }
}

const collectSourceFiles = async () => {
    const files = []
    for (const root of sourceRoots) {
        await walk(path.join(repoRoot, root), files)
    }
    return files
}

const countLines = (text) => {
    if (text.length === 0) {
        return 0
    }
    return text.split(/\r\n|\r|\n/).length
}

const checkFileSize = (relativePath, lineCount) => {
    const baseline = frozenBaselines.get(relativePath)
    if (baseline !== undefined) {
        if (lineCount > baseline) {
            architectureViolations.push(
                `${relativePath} has ${lineCount} lines, above frozen baseline ${baseline}. Extract code before adding more.`,
            )
        }
        return
    }

    const extension = path.extname(relativePath)
    const hardLimit = extension === '.rs' ? 1200 : 1200
    const warningLimit = extension === '.tsx' ? 600 : extension === '.rs' ? 800 : 500

    if (lineCount > hardLimit) {
        architectureViolations.push(
            `${relativePath} has ${lineCount} lines. New non-vendor files must stay below ${hardLimit} lines.`,
        )
    } else if (lineCount > warningLimit) {
        sizeWarnings.push(`${relativePath} has ${lineCount} lines; consider splitting before adding features.`)
    }
}

const checkComponentBoundaries = (relativePath, source) => {
    if (!relativePath.startsWith('src/renderer/src/components/')) {
        return
    }

    const bannedImportPatterns = [
        /from\s+['"]@tauri-apps\/api(?:\/[^'"]*)?['"]/,
        /from\s+['"]@tauri-apps\/plugin-[^'"]+['"]/,
        /from\s+['"][^'"]*vendor\/[^'"]+['"]/,
        /from\s+['"]war3-model\/[^'"]+['"]/,
    ]

    for (const pattern of bannedImportPatterns) {
        if (pattern.test(source)) {
            architectureViolations.push(
                `${relativePath} imports infrastructure/vendor directly. Route through application or infrastructure gateway.`,
            )
            break
        }
    }
}

const checkFiles = async () => {
    const files = await collectSourceFiles()
    for (const filePath of files) {
        const relativePath = toRepoPath(filePath)
        const source = await readFile(filePath, 'utf8')
        checkFileSize(relativePath, countLines(source))
        checkComponentBoundaries(relativePath, source)
    }
}

const main = async () => {
    assertRequiredFiles()
    await readPackageJson()
    await checkFiles()

    if (architectureViolations.length > 0) {
        console.error('Architecture guardrails failed:')
        for (const violation of architectureViolations) {
            console.error(`- ${violation}`)
        }
        process.exitCode = 1
        return
    }

    if (sizeWarnings.length > 0) {
        console.warn('Architecture guardrails warnings:')
        for (const warning of sizeWarnings) {
            console.warn(`- ${warning}`)
        }
    }

    console.log('OK architecture guardrails')
}

await main()
