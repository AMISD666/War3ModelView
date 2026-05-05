import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = path.join(repoRoot, '.tmp', 'sequence-interval-normalization-check')

const fail = (message) => {
    throw new Error(message)
}

await rm(tempDir, { recursive: true, force: true })
await mkdir(tempDir, { recursive: true })

const sourcePath = path.join(repoRoot, 'src/renderer/src/utils/sequenceUtils.ts')
const source = await import('node:fs/promises').then(({ readFile }) => readFile(sourcePath, 'utf8'))
const output = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
    },
}).outputText
const modulePath = path.join(tempDir, 'sequenceUtils.mjs')
await writeFile(modulePath, output)

const { normalizeSequenceInterval, normalizeSequenceForPlayback } = await import(pathToFileURL(modulePath))

const assertInterval = (label, actual, expected) => {
    if (!actual || actual[0] !== expected[0] || actual[1] !== expected[1]) {
        fail(`${label}: expected [${expected.join(', ')}], got ${actual ? `[${actual.join(', ')}]` : String(actual)}`)
    }
}

assertInterval('plain array', normalizeSequenceInterval([1067, 4333]), [1067, 4333])
assertInterval('typed Uint32Array', normalizeSequenceInterval(new Uint32Array([1067, 4333])), [1067, 4333])
assertInterval('msgpack Uint32Array bytes', normalizeSequenceInterval(new Uint8Array(new Uint32Array([1067, 4333]).buffer)), [1067, 4333])

const byteObject = Object.fromEntries(Array.from(new Uint8Array(new Uint32Array([1067, 4333]).buffer), (value, index) => [String(index), value]))
assertInterval('numeric keyed byte object', normalizeSequenceInterval(byteObject), [1067, 4333])

const normalized = normalizeSequenceForPlayback({ Name: '4002_move', Interval: byteObject })
assertInterval('sequence object', normalized.Interval, [1067, 4333])

console.log('OK sequence interval normalization decodes array, typed array, and IPC byte payload forms.')
