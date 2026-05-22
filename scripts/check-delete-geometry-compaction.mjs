import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const tempDir = mkdtempSync(join(tmpdir(), 'war3-delete-geometry-'))
const outFile = join(tempDir, 'vertexOperations.mjs')

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const buildLargeSkinnedGeoset = () => {
  const vertexCount = 65538
  const vertices = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const tVertices = new Float32Array(vertexCount * 2)
  const vertexGroup = new Uint8Array(vertexCount)
  const skinWeights = new Uint8Array(vertexCount * 8)
  const faces = new Uint32Array((vertexCount - 2) * 3)

  for (let i = 0; i < vertexCount; i += 1) {
    vertices[i * 3] = i
    normals[i * 3 + 2] = 1
    tVertices[i * 2] = i % 2
    tVertices[i * 2 + 1] = (i + 1) % 2

    const skinBase = i * 8
    skinWeights[skinBase] = i % 251
    skinWeights[skinBase + 1] = (i + 1) % 251
    skinWeights[skinBase + 2] = (i + 2) % 251
    skinWeights[skinBase + 3] = (i + 3) % 251
    skinWeights[skinBase + 4] = 100
    skinWeights[skinBase + 5] = 80
    skinWeights[skinBase + 6] = 50
    skinWeights[skinBase + 7] = 25
  }

  for (let face = 0; face < vertexCount - 2; face += 1) {
    const offset = face * 3
    faces[offset] = face
    faces[offset + 1] = face + 1
    faces[offset + 2] = face + 2
  }

  return {
    Vertices: vertices,
    Normals: normals,
    TVertices: [tVertices],
    VertexGroup: vertexGroup,
    Faces: faces,
    SkinWeights: skinWeights,
    Groups: [[0]],
    MaterialID: 0,
    SelectionGroup: 0,
    Unselectable: false,
  }
}

try {
  await esbuild.build({
    entryPoints: ['src/renderer/src/utils/vertexOperations.ts'],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })

  const { deleteFaces, deleteVertices } = await import(pathToFileURL(outFile).href)

  for (const [label, runDelete] of [
    ['deleteFaces', (geoset) => deleteFaces(geoset, [0])],
    ['deleteVertices', (geoset) => deleteVertices(geoset, [0])],
  ]) {
    const result = runDelete(buildLargeSkinnedGeoset())
    const geoset = result.updatedGeoset
    const vertexCount = geoset.Vertices.length / 3
    const lastFaceOffset = geoset.Faces.length - 3

    assert(geoset.Faces instanceof Uint32Array, `${label}: compacted high-index faces must stay Uint32Array`)
    assert(geoset.Faces[lastFaceOffset + 2] === 65536, `${label}: final face index was truncated`)
    assert(vertexCount === 65537, `${label}: unexpected compacted vertex count ${vertexCount}`)
    assert(geoset.SkinWeights.length === vertexCount * 8, `${label}: SkinWeights lost its 8-value stride`)
    assert(geoset.SkinWeights[0] === 1, `${label}: first copied SkinWeights entry should come from old vertex 1`)
    assert(geoset.SkinWeights[7] === 25, `${label}: first copied SkinWeights stride is incomplete`)
  }

  console.log('ok - delete geometry compaction preserves wide face indices and skinned vertex stride')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
