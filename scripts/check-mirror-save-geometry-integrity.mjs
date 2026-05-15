import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const mirrorSource = read('src/renderer/src/commands/MirrorModelCommand.ts')
if (mirrorSource.includes('getMirrorRootName(') || mirrorSource.includes('MIRROR_ROOT_NAME')) {
    throw new Error('MirrorModelCommand must bake mirror data instead of adding a negative-scale mirror root')
}
if (!mirrorSource.includes('mirrorFlatVec3Array(geoset?.Vertices, scale, pivot)')) {
    throw new Error('MirrorModelCommand must mirror geoset vertices')
}
if (!mirrorSource.includes('mirrorFlatVec3Array(geoset?.Normals, scale)')) {
    throw new Error('MirrorModelCommand must mirror geoset normals')
}
if (!mirrorSource.includes('mirrorTangents(geoset?.Tangents, scale)')) {
    throw new Error('MirrorModelCommand must mirror geoset tangents')
}
if (!mirrorSource.includes('mirrorQuatTrack(node.Rotation, scale)')) {
    throw new Error('MirrorModelCommand must mirror node rotation tracks for animated models')
}
if (!mirrorSource.includes('reverseTriangleWinding(geoset?.Faces)')) {
    throw new Error('MirrorModelCommand must reverse triangle winding for handedness-changing mirrors')
}

const saveMergeSource = read('src/renderer/src/application/model-save/mergeLiveRendererGeometry.ts')
for (const expected of [
    'VertexGroup: cloneArrayLike(documentGeoset?.VertexGroup ?? rendererGeoset.VertexGroup ?? [])',
    'Groups: cloneArrayLike(documentGeoset?.Groups ?? rendererGeoset.Groups ?? [[0]])',
    'next.SkinWeights = cloneArrayLike(documentGeoset?.SkinWeights ?? rendererGeoset.SkinWeights)',
]) {
    if (!saveMergeSource.includes(expected)) {
        throw new Error(`mergeLiveRendererGeometryForSave must preserve document skinning data: ${expected}`)
    }
}

const viewerSource = read('src/renderer/src/components/viewer/ViewerImpl.tsx')
if (!viewerSource.includes('extractNodesFromModel,currentStore.modelData') && !viewerSource.includes('extractNodesFromModel(currentStore.modelData)')) {
    throw new Error('ViewerImpl must fall back to extracting nodes from modelData before syncing node projection')
}
if (!viewerSource.includes('effectiveNodes.length === 0') || !viewerSource.includes('rendererRef.current.model.Nodes.length > 0')) {
    throw new Error('ViewerImpl must not overwrite existing renderer nodes with an empty deferred store node list')
}

console.log('mirror-save-geometry-integrity ok')
