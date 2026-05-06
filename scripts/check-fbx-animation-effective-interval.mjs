import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = path.join(repoRoot, '.tmp', 'fbx-animation-effective-interval-check')

const fail = (message) => {
    throw new Error(message)
}

const transpile = async (relativePath, replacements = []) => {
    const sourcePath = path.join(repoRoot, relativePath)
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(sourcePath, 'utf8'))
    let output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText
    for (const [from, to] of replacements) {
        output = output.replace(from, to)
    }
    const outputPath = path.join(tempDir, path.basename(relativePath).replace(/\.ts$/, '.mjs'))
    await writeFile(outputPath, output)
    return outputPath
}

await rm(tempDir, { recursive: true, force: true })
await mkdir(tempDir, { recursive: true })

await transpile('src/renderer/src/application/model-import/FbxAnimationSampling.ts')
await transpile(
    'src/renderer/src/application/model-import/FbxAnimationTransforms.ts',
    [[/from '\.\/FbxAnimationSampling'/g, "from './FbxAnimationSampling.mjs'"]],
)
const mapperPath = await transpile(
    'src/renderer/src/application/model-import/FbxAnimationMapper.ts',
    [
        [/from '\.\/FbxAnimationTransforms'/g, "from './FbxAnimationTransforms.mjs'"],
        [/from '\.\/FbxAnimationSampling'/g, "from './FbxAnimationSampling.mjs'"],
    ],
)

const { applyFbxAnimationTracks } = await import(pathToFileURL(mapperPath))

const makeNode = (typedId) => ({
    typedId,
    name: `node_${typedId}`,
    localTranslation: [0, 0, 0],
    localRotation: [0, 0, 0, 1],
    localScale: [1, 1, 1],
    restWorldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
})

const makeStack = (name, playbackDuration, keyedEnd) => ({
    name,
    timeBegin: 0,
    timeEnd: playbackDuration,
    playbackDuration,
    bakedNodes: [{
        nodeTypedId: 1,
        translationKeys: [
            { timeSeconds: 0, value: [0, 0, 0], flags: 0 },
            { timeSeconds: keyedEnd, value: [1, 0, 0], flags: 0 },
        ],
        rotationKeys: [],
        scaleKeys: [],
    }],
})

const modelData = {
    Model: {
        MinimumExtent: [0, 0, 0],
        MaximumExtent: [1, 1, 1],
        BoundsRadius: 1,
    },
    Sequences: [],
}
const node = {
    ObjectId: 0,
    Name: 'node_1',
    Parent: -1,
    PivotPoint: [0, 0, 0],
}
const scene = {
    nodes: [makeNode(1)],
    animationStacks: [
        makeStack('4002_special3', 0.967, 0.967),
        makeStack('4002_move', 0.967, 0.633),
    ],
}

const mappedKeyCount = applyFbxAnimationTracks(scene, modelData, {
    nodes: [node],
    objectIdByTypedId: new Map([[1, 0]]),
})

const move = modelData.Sequences[1]
if (!move) {
    fail('Expected imported 4002_move sequence')
}
if (move.Interval[0] !== 1067 || move.Interval[1] !== 1700) {
    fail(`Expected 4002_move interval [1067, 1700], got [${move.Interval.join(', ')}]`)
}
const translationKeys = node.Translation?.Keys ?? []
if (!translationKeys.some((key) => key.Frame === 1700)) {
    fail('Expected mapped node track to contain the final real key at frame 1700')
}
if (translationKeys.some((key) => key.Frame === 2034)) {
    fail('Importer should not synthesize a trailing empty key at frame 2034')
}
if (mappedKeyCount <= 0) {
    fail('Expected animation tracks to be mapped')
}

const sparseNode = {
    ObjectId: 0,
    Name: 'node_1',
    Parent: -1,
    PivotPoint: [0, 0, 0],
}
const sparseLongNode = {
    ObjectId: 1,
    Name: 'node_2',
    Parent: -1,
    PivotPoint: [0, 0, 0],
}
const sparseModelData = {
    Model: modelData.Model,
    Sequences: [],
}
const sparseScene = {
    nodes: [makeNode(1), makeNode(2)],
    animationStacks: [{
        name: 'move',
        timeBegin: 0,
        timeEnd: 3.033,
        playbackDuration: 3.033,
        bakedNodes: [
            {
                nodeTypedId: 1,
                translationKeys: [
                    { timeSeconds: 0, value: [0, 0, 0], flags: 0 },
                    { timeSeconds: 1.033, value: [1, 0, 0], flags: 0 },
                ],
                rotationKeys: [],
                scaleKeys: [],
            },
            {
                nodeTypedId: 2,
                translationKeys: [
                    { timeSeconds: 0, value: [0, 0, 0], flags: 0 },
                    { timeSeconds: 1.033, value: [1, 0, 0], flags: 0 },
                    { timeSeconds: 3.033, value: [1, 0, 0], flags: 0 },
                ],
                rotationKeys: [],
                scaleKeys: [],
            },
        ],
    }],
}

applyFbxAnimationTracks(sparseScene, sparseModelData, {
    nodes: [sparseNode, sparseLongNode],
    objectIdByTypedId: new Map([[1, 0], [2, 1]]),
})

const sparseTranslationFrames = sparseNode.Translation?.Keys.map((key) => key.Frame) ?? []
if (sparseTranslationFrames.includes(3033)) {
    fail(`Expected trailing static frames to be trimmed from sparse mapped node, got [${sparseTranslationFrames.join(', ')}]`)
}
if (sparseModelData.Sequences[0].Interval[1] !== 1033) {
    fail(`Expected sequence duration to be clipped to the last frame with real motion, got ${sparseModelData.Sequences[0].Interval[1]}`)
}

console.log('OK FBX animation sequence interval clips empty playback tails and trailing static sampled poses.')
