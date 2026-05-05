import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultSource = resolve(repoRoot, '..', 'war3-model-4.0.0')
const sourceRoot = resolve(process.argv[2] || defaultSource)
const vendorRoot = resolve(repoRoot, 'vendor', 'war3-model')

const excludedDirectories = new Set(['node_modules', 'docs', '.github', '.husky', '.git'])
const excludedRootFiles = new Set(['.gitignore'])

function assertInsideRepo(path) {
    const relativePath = relative(repoRoot, path)
    if (relativePath.startsWith('..') || relativePath === '' || resolve(path) === repoRoot) {
        throw new Error(`Refusing to modify path outside the repository: ${path}`)
    }
}

function shouldSkipDirectory(name) {
    return excludedDirectories.has(name)
}

function syncDirectory(source, target) {
    mkdirSync(target, { recursive: true })

    const sourceEntries = new Map()
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        if (entry.isDirectory() && shouldSkipDirectory(entry.name)) {
            continue
        }
        if (source === sourceRoot && entry.isFile() && excludedRootFiles.has(entry.name)) {
            continue
        }
        sourceEntries.set(entry.name, entry)
    }

    if (existsSync(target)) {
        for (const entry of readdirSync(target, { withFileTypes: true })) {
            if (!sourceEntries.has(entry.name)) {
                const targetPath = join(target, entry.name)
                assertInsideRepo(targetPath)
                rmSync(targetPath, { recursive: true, force: true })
            }
        }
    }

    for (const [name, entry] of sourceEntries) {
        const sourcePath = join(source, name)
        const targetPath = join(target, name)

        if (entry.isDirectory()) {
            syncDirectory(sourcePath, targetPath)
            continue
        }

        mkdirSync(dirname(targetPath), { recursive: true })
        copyFileSync(sourcePath, targetPath)
    }
}

function findRuntimeFiles(root) {
    const results = []

    function visit(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (!shouldSkipDirectory(entry.name)) {
                    visit(join(dir, entry.name))
                }
                continue
            }

            const absolutePath = join(dir, entry.name)
            const relativePath = relative(root, absolutePath).split(sep).join('/')
            results.push(relativePath)
        }
    }

    visit(root)
    return results.sort()
}

if (!existsSync(sourceRoot)) {
    throw new Error(`war3-model 4.0.0 source directory was not found: ${sourceRoot}`)
}

if (!statSync(sourceRoot).isDirectory()) {
    throw new Error(`war3-model 4.0.0 source path is not a directory: ${sourceRoot}`)
}

if (!existsSync(join(sourceRoot, 'package.json')) || !existsSync(join(sourceRoot, 'renderer', 'particles.ts'))) {
    throw new Error(`Source does not look like a war3-model checkout: ${sourceRoot}`)
}

assertInsideRepo(vendorRoot)
syncDirectory(sourceRoot, vendorRoot)

const files = findRuntimeFiles(vendorRoot)
console.log(`Synced ${files.length} runtime files from ${sourceRoot}`)
console.log(`Target: ${vendorRoot}`)
