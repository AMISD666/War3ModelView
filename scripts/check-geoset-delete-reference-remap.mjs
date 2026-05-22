import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const tempDir = mkdtempSync(join(tmpdir(), 'war3-geoset-delete-remap-'))
const outFile = join(tempDir, 'geosetDeletionReferenceRemap.mjs')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

try {
  await esbuild.build({
    entryPoints: ['src/renderer/src/commands/geosetDeletionReferenceRemap.ts'],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })

  const {
    buildModelDataWithGeosetRemovalReferences,
    remapHiddenGeosetIdsAfterRemovingGeosets,
  } = await import(pathToFileURL(outFile).href)

  const modelData = {
    Model: { NumGeosets: 4, NumGeosetAnims: 4 },
    Info: { NumGeosets: 4, NumGeosetAnims: 4 },
    Geosets: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
    GeosetAnims: [
      { GeosetId: 0 },
      { GeosetId: 1 },
      { GeosetId: 2 },
      { GeosetId: 3 },
    ],
    Bones: [
      { Name: 'kept-before', GeosetId: 0, GeosetAnimId: 0 },
      { Name: 'removed', GeosetId: 1, GeosetAnimId: 1 },
      { Name: 'shifted', GeosetId: 3, GeosetAnimId: 3 },
    ],
    Nodes: [
      { Name: 'node-bone-shifted', GeosetId: 2, GeosetAnimId: 2 },
    ],
  }

  const next = buildModelDataWithGeosetRemovalReferences(
    modelData,
    [modelData.Geosets[0], modelData.Geosets[2], modelData.Geosets[3]],
    [1]
  )

  assert(next.GeosetAnims.length === 3, 'removed geoset anim was not dropped')
  assert(next.GeosetAnims.every((anim, index) => anim.GeosetId === index), 'geoset anim ids are not sequential')
  assert(next.Bones[0].GeosetId === 0 && next.Bones[0].GeosetAnimId === 0, 'unchanged bone refs shifted')
  assert(next.Bones[1].GeosetId === null && next.Bones[1].GeosetAnimId === null, 'removed bone refs were not cleared')
  assert(next.Bones[2].GeosetId === 2 && next.Bones[2].GeosetAnimId === 2, 'later bone refs were not remapped')
  assert(next.Nodes[0].GeosetId === 1 && next.Nodes[0].GeosetAnimId === 1, 'node-level geoset refs were not remapped')
  assert(next.Model.NumGeosets === 3 && next.Model.NumGeosetAnims === 3, 'Model counts were not updated')
  assert(next.Info.NumGeosets === 3 && next.Info.NumGeosetAnims === 3, 'Info counts were not updated')

  const hidden = remapHiddenGeosetIdsAfterRemovingGeosets([0, 1, 3], [1], 3)
  assert(hidden.join(',') === '0,2', 'hidden geoset ids were not remapped')

  console.log('ok - geoset delete remaps geoset anim and node references')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
