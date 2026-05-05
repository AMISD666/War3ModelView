import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = path.join(repoRoot, '.tmp', 'fbx-classic-skin-weight-mapping-check')

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

const ids = (influences) => influences.map((item) => item.objectId).join(',')

await rm(tempDir, { recursive: true, force: true })
await mkdir(tempDir, { recursive: true })

const mapperPath = await transpile('src/renderer/src/application/model-import/FbxGeosetMapper.ts')
const { chooseClassicInfluencesForFbxWeights, mapFbxMeshToGeoset } = await import(pathToFileURL(mapperPath))

const moderateBlend = chooseClassicInfluencesForFbxWeights([
    { objectId: 10, weight: 0.7 },
    { objectId: 20, weight: 0.3 },
])
if (ids(moderateBlend) !== '10,20') {
    fail(`Expected 70/30 FBX skin weights to keep both classic matrix influences, got [${ids(moderateBlend)}]`)
}

const highlyDominant = chooseClassicInfluencesForFbxWeights([
    { objectId: 10, weight: 0.9 },
    { objectId: 20, weight: 0.1 },
])
if (ids(highlyDominant) !== '10') {
    fail(`Expected 90/10 FBX skin weights to stay single-bound for classic matrix approximation, got [${ids(highlyDominant)}]`)
}

const duplicateBoneWeights = chooseClassicInfluencesForFbxWeights([
    { objectId: 10, weight: 0.35 },
    { objectId: 20, weight: 0.3 },
    { objectId: 10, weight: 0.35 },
])
if (ids(duplicateBoneWeights) !== '10,20') {
    fail(`Expected duplicate FBX bone weights to merge before classic approximation, got [${ids(duplicateBoneWeights)}]`)
}

const nodeMapping = {
    defaultObjectId: 99,
    objectIdByTypedId: new Map([
        [1001, 10],
        [1002, 20],
        [1003, 30],
    ]),
}
const geoset = mapFbxMeshToGeoset({
    name: 'skin_mapping_check',
    nodeTypedId: 1003,
    meshMaterialSlot: 0,
    materialIndex: 0,
    skinWeightStride: 4,
    vertexCount: 3,
    indexCount: 3,
    vertices: [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
    ],
    normals: [
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
    ],
    uvs: [
        0, 0,
        1, 0,
        0, 1,
    ],
    indices: [0, 1, 2],
    skinWeightCounts: [2, 2, 0],
    skinBoneNodeTypedIds: [
        1001, 1002, 0xFFFFFFFF, 0xFFFFFFFF,
        1001, 1002, 0xFFFFFFFF, 0xFFFFFFFF,
        0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF,
    ],
    skinWeights: [
        0.7, 0.3, 0, 0,
        0.9, 0.1, 0, 0,
        0, 0, 0, 0,
    ],
    minimumExtent: [0, 0, 0],
    maximumExtent: [1, 1, 0],
    boundsRadius: 1,
}, 0, nodeMapping, [])

const groupForVertex = (vertexIndex) => geoset.Groups[geoset.VertexGroup[vertexIndex]].join(',')
if (groupForVertex(0) !== '10,20') {
    fail(`Expected mapped 70/30 vertex group to keep both bones, got [${groupForVertex(0)}]`)
}
if (groupForVertex(1) !== '10') {
    fail(`Expected mapped 90/10 vertex group to use the dominant bone, got [${groupForVertex(1)}]`)
}
if (groupForVertex(2) !== '30') {
    fail(`Expected unweighted vertex to fall back to mesh node binding, got [${groupForVertex(2)}]`)
}

console.log('OK FBX classic skin weight mapping keeps moderate blends instead of collapsing them to one bone.')
