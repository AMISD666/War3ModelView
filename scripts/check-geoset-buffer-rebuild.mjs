import { readFileSync } from 'node:fs'

const checks = [
  {
    file: 'vendor/war3-model/renderer/modelResourceManager.ts',
    needle: 'public rebuildGeosetBuffers(model: Model, softwareSkinning = false): void',
    message: 'ModelResourceManager exposes full geoset buffer rebuild',
  },
  {
    file: 'vendor/war3-model/renderer/modelResourceManager.ts',
    needle: 'gl.bufferData(gl.ARRAY_BUFFER, newTVertices, gl.DYNAMIC_DRAW);',
    message: 'UV buffer updates allocate for the current payload size',
  },
  {
    file: 'vendor/war3-model/renderer/modelRenderer.ts',
    needle: 'public rebuildGeosetBuffers(): void',
    message: 'ModelRenderer refreshes local buffer references after rebuild',
  },
  {
    file: 'src/renderer/src/commands/DeleteFacesCommand.ts',
    needle: 'rebuildWar3GeosetBuffers(this.renderer)',
    message: 'Deleting all faces from a geoset rebuilds shifted buffers',
  },
  {
    file: 'src/renderer/src/commands/DeleteVerticesCommand.ts',
    needle: 'this.renderer.model.Geosets.splice(this.geosetIndex, 1)\n            rebuildWar3GeosetBuffers(this.renderer)',
    message: 'Deleting all vertices/faces from a geoset rebuilds shifted buffers',
  },
  {
    file: 'src/renderer/src/commands/DeleteVerticesCommand.ts',
    needle: 'this.renderer.model.Geosets.splice(this.geosetIndex, 0, cloneGeosetSnapshot(this.originalGeosetSnapshot))\n            rebuildWar3GeosetBuffers(this.renderer)',
    message: 'Undoing removed geoset insertion rebuilds shifted buffers',
  },
  {
    file: 'src/renderer/src/commands/DeleteFacesCommand.ts',
    needle: 'this.renderer.model.Geosets = this.originalGeosetsSnapshot.map((geoset) => cloneDeep(geoset))\n        rebuildWar3GeosetBuffers(this.renderer)',
    message: 'Undoing face deletion restores geoset buffers before lightweight sync',
  },
]

const failures = checks.filter(({ file, needle, message }) => {
  const text = readFileSync(file, 'utf8')
  const ok = text.includes(needle)
  console.log(`${ok ? 'ok' : 'missing'} - ${message}`)
  return !ok
})

if (failures.length > 0) {
  console.error(`Geoset buffer rebuild check failed: ${failures.length} missing invariant(s).`)
  process.exit(1)
}
