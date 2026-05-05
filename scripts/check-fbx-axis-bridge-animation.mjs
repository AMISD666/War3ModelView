import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = path.join(repoRoot, '.tmp', 'fbx-axis-bridge-animation-check')

const fail = (message) => {
    throw new Error(message)
}

const transpile = async (relativePath) => {
    const sourcePath = path.join(repoRoot, relativePath)
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(sourcePath, 'utf8'))
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText
    const outputPath = path.join(tempDir, path.basename(relativePath).replace(/\.ts$/, '.mjs'))
    await writeFile(outputPath, output)
    return outputPath
}

const quatX90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
const quatNegX90 = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]
const identityQuat = [0, 0, 0, 1]
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const x90Matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
const translatedBindMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]

const makeNode = (typedId, parentTypedId, isBone, localRotation, restWorldMatrix) => ({
    typedId,
    parentTypedId,
    name: `node_${typedId}`,
    isBone,
    localTranslation: [0, 0, 0],
    localRotation,
    localScale: [1, 1, 1],
    worldTranslation: [0, 0, 0],
    restTranslation: [0, 0, 0],
    restWorldMatrix,
})

await rm(tempDir, { recursive: true, force: true })
await mkdir(tempDir, { recursive: true })

const transformsPath = await transpile('src/renderer/src/application/model-import/FbxAnimationTransforms.ts')
const { buildWar3DeltaTracksForStack } = await import(pathToFileURL(transformsPath))

const importedBone = {
    ObjectId: 0,
    Name: 'Bip001',
    Parent: -1,
    PivotPoint: [0, 0, 0],
}
const tracksByTypedId = buildWar3DeltaTracksForStack(
    [
        makeNode(1, undefined, false, quatX90, x90Matrix),
        makeNode(2, 1, false, identityQuat, x90Matrix),
        makeNode(3, 2, true, identityQuat, x90Matrix),
    ],
    {
        name: 'idle',
        timeBegin: 0,
        timeEnd: 2,
        playbackDuration: 2,
        bakedNodes: [
            {
                nodeTypedId: 2,
                constantTranslation: true,
                constantRotation: true,
                constantScale: true,
                translationKeys: [
                    { timeSeconds: 0, value: [0, 0, 0], flags: 0 },
                    { timeSeconds: 2, value: [0, 0, 0], flags: 0 },
                ],
                rotationKeys: [
                    { timeSeconds: 0, value: quatNegX90, flags: 0 },
                    { timeSeconds: 2, value: quatNegX90, flags: 0 },
                ],
                scaleKeys: [
                    { timeSeconds: 0, value: [1, 1, 1], flags: 0 },
                    { timeSeconds: 2, value: [1, 1, 1], flags: 0 },
                ],
            },
            {
                nodeTypedId: 3,
                constantTranslation: true,
                constantRotation: true,
                constantScale: true,
                translationKeys: [{ timeSeconds: 0, value: [0, 0, 0], flags: 0 }],
                rotationKeys: [{ timeSeconds: 0, value: identityQuat, flags: 0 }],
                scaleKeys: [{ timeSeconds: 0, value: [1, 1, 1], flags: 0 }],
            },
        ],
    },
    0,
    {
        nodes: [importedBone],
        objectIdByTypedId: new Map([[3, 0]]),
    },
)

const boneTracks = tracksByTypedId.get(3)
const rotation = Array.from(boneTracks?.rotation?.Keys?.[0]?.Vector ?? [])
if (rotation.length !== 4) {
    fail('Expected imported bone to receive a rotation key')
}
const identityDot = Math.abs(rotation[3])
if (identityDot < 0.9999) {
    fail(`Expected unmapped static FBX axis bridge to be ignored for bone delta, got rotation [${rotation.join(', ')}]`)
}

const currentPoseTracksByTypedId = buildWar3DeltaTracksForStack(
    [
        makeNode(1, undefined, false, identityQuat, identityMatrix),
        makeNode(2, 1, true, identityQuat, translatedBindMatrix),
    ],
    {
        name: 'idle',
        timeBegin: 0,
        timeEnd: 2,
        playbackDuration: 2,
        bakedNodes: [{
            nodeTypedId: 2,
            constantTranslation: true,
            constantRotation: true,
            constantScale: true,
            translationKeys: [{ timeSeconds: 0, value: [0, 0, 0], flags: 0 }],
            rotationKeys: [{ timeSeconds: 0, value: identityQuat, flags: 0 }],
            scaleKeys: [{ timeSeconds: 0, value: [1, 1, 1], flags: 0 }],
        }],
    },
    0,
    {
        nodes: [{ ObjectId: 0, Name: 'current_pose_bone', Parent: -1, PivotPoint: [0, 0, 0] }],
        objectIdByTypedId: new Map([[2, 0]]),
    },
)
const translation = Array.from(currentPoseTracksByTypedId.get(2)?.translation?.Keys?.[0]?.Vector ?? [])
const translationLength = Math.hypot(...translation)
if (translationLength > 0.0001) {
    fail(`Expected FBX animation base to use current pose, not bind pose matrix, got translation [${translation.join(', ')}]`)
}

console.log('OK FBX static axis bridge and bind-pose offsets do not leak into War3 bone deltas.')
