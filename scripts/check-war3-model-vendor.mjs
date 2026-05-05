import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const defaultSource = resolve(repoRoot, '..', 'war3-model-4.0.0')
const sourceRoot = resolve(process.argv[2] || defaultSource)
const vendorRoot = resolve(repoRoot, 'vendor', 'war3-model')
const excludedDirectories = new Set(['node_modules', 'docs', '.github', '.husky', '.git'])
const excludedFiles = new Set(['.gitignore'])

function shouldSkipDirectory(name) {
    return excludedDirectories.has(name)
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function collectFiles(root) {
    const files = new Map()

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
            if (excludedFiles.has(relativePath)) {
                continue
            }
            files.set(relativePath, sha256(absolutePath))
        }
    }

    visit(root)
    return files
}

function fail(message, mismatches) {
    console.error(message)
    for (const mismatch of mismatches.slice(0, 40)) {
        console.error(`- ${mismatch}`)
    }
    if (mismatches.length > 40) {
        console.error(`... ${mismatches.length - 40} more`)
    }
    process.exit(1)
}

if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new Error(`war3-model 4.0.0 source directory was not found: ${sourceRoot}`)
}

if (!existsSync(vendorRoot) || !statSync(vendorRoot).isDirectory()) {
    throw new Error(`Vendored war3-model directory was not found: ${vendorRoot}`)
}

const sourceFiles = collectFiles(sourceRoot)
const vendorFiles = collectFiles(vendorRoot)
const mismatches = []

for (const [file, sourceHash] of sourceFiles) {
    const vendorHash = vendorFiles.get(file)
    if (!vendorHash) {
        mismatches.push(`missing in vendor: ${file}`)
    } else if (vendorHash !== sourceHash) {
        mismatches.push(`changed: ${file}`)
    }
}

for (const file of vendorFiles.keys()) {
    if (!sourceFiles.has(file)) {
        mismatches.push(`extra in vendor: ${file}`)
    }
}

if (mismatches.length) {
    fail(`Vendored war3-model does not match ${sourceRoot}`, mismatches)
}

console.log(`OK vendored war3-model matches ${sourceRoot}`)
