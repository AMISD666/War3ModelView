import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parseMDX } from '../vendor/war3-model/dist/war3-model.cjs'

const model = parseMDX(readFileSync('testmodel/SX-wangqishou00.mdx').buffer)
const alphaTrack = model.Materials?.[0]?.Layers?.[0]?.Alpha

if (!alphaTrack || !Array.isArray(alphaTrack.Keys)) {
    throw new Error('Expected material 0 layer 0 Alpha to be an anim track')
}

const parsedKeys = alphaTrack.Keys.map((key) => ({
    frame: key.Frame,
    value: Number(key.Vector?.[0]),
}))

const expectedKeys = [
    { frame: 0, value: 0 },
    { frame: 333, value: 1 },
    { frame: 1374, value: 0.75 },
    { frame: 1899, value: 0 },
]

if (JSON.stringify(parsedKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`Unexpected parsed material Alpha keys: ${JSON.stringify(parsedKeys)}`)
}

const entry = `
    import { cloneAnimVectorForIpc, vectorToPlainArray } from './src/renderer/src/utils/animVectorIpc.ts'

    const makeByteObject = (value) => {
        const bytes = new Uint8Array(new Float32Array([value]).buffer)
        return Object.fromEntries(Array.from(bytes, (byte, index) => [String(index), byte]))
    }

    const restoredOne = vectorToPlainArray(makeByteObject(1), { isInt: false })
    const restoredPoint75 = vectorToPlainArray(makeByteObject(0.75), { isInt: false })

    if (restoredOne.length !== 1 || restoredOne[0] !== 1) {
        throw new Error('Expected byte-object float32 1.0 to restore to [1]')
    }
    if (restoredPoint75.length !== 1 || restoredPoint75[0] !== 0.75) {
        throw new Error('Expected byte-object float32 0.75 to restore to [0.75]')
    }

    const cloned = cloneAnimVectorForIpc({
        LineType: 1,
        GlobalSeqId: null,
        Keys: [
            { Frame: 0, Vector: makeByteObject(0) },
            { Frame: 333, Vector: makeByteObject(1) },
            { Frame: 1374, Vector: makeByteObject(0.75) },
            { Frame: 1899, Vector: makeByteObject(0) },
        ],
    }, { isInt: false })

    const values = cloned.Keys.map((key) => [key.Frame, key.Vector[0]])
    const expected = [[0, 0], [333, 1], [1374, 0.75], [1899, 0]]
    if (JSON.stringify(values) !== JSON.stringify(expected)) {
        throw new Error('Expected cloned material Alpha keys to preserve float values, got ' + JSON.stringify(values))
    }
`

const result = await build({
    stdin: {
        contents: entry,
        resolveDir: process.cwd(),
        sourcefile: 'material-alpha-keyframes-entry.ts',
        loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
})

const bundled = result.outputFiles[0]?.text
if (!bundled) {
    throw new Error('Failed to bundle material alpha keyframe check')
}

await import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`)
console.log(`material-alpha-keyframes ok (${pathToFileURL(process.cwd()).href})`)
