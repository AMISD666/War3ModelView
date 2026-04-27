import assert from 'node:assert/strict'

const clone = (value) => {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]))
}

const remapGeosetAnimsAfterRemovingGeosets = (geosetAnims, removedGeosetIndices) => {
  const removedIndices = Array.from(new Set(
    removedGeosetIndices.filter((index) => Number.isInteger(index) && index >= 0),
  )).sort((a, b) => a - b)
  const removedSet = new Set(removedIndices)
  const usedGeosetIds = new Set()
  const nextGeosetAnims = []

  for (const anim of Array.isArray(geosetAnims) ? geosetAnims.map(clone) : []) {
    const geosetId = anim?.GeosetId
    if (typeof geosetId !== 'number' || geosetId < 0) {
      nextGeosetAnims.push(anim)
      continue
    }
    if (removedSet.has(geosetId)) continue

    const removedBefore = removedIndices.reduce(
      (count, removedIndex) => (removedIndex < geosetId ? count + 1 : count),
      0,
    )
    const nextGeosetId = geosetId - removedBefore
    if (usedGeosetIds.has(nextGeosetId)) continue
    usedGeosetIds.add(nextGeosetId)
    nextGeosetAnims.push({ ...anim, GeosetId: nextGeosetId })
  }

  return nextGeosetAnims
}

const buildMaterialLayerTopologySignature = (materials) => JSON.stringify(
  (Array.isArray(materials) ? materials : []).map((material) => ({
    layerCount: Array.isArray(material?.Layers) ? material.Layers.length : 0,
    layers: (Array.isArray(material?.Layers) ? material.Layers : []).map((layer) => ({
      textureMode: typeof layer?.TextureID === 'object' ? 'anim' : 'static',
      hasTextureAnim: layer?.TVertexAnimId !== undefined && layer?.TVertexAnimId !== null,
    })),
  })),
)

const validateMaterialLayerCacheShape = (materials, cache) => {
  if (!Array.isArray(materials) || materials.length === 0) {
    return !Array.isArray(cache) || cache.length === 0
  }
  if (!Array.isArray(cache) || cache.length !== materials.length) return false
  return materials.every((material, materialIndex) => {
    const layerCount = Array.isArray(material?.Layers) ? material.Layers.length : 0
    return Array.isArray(cache[materialIndex]) && cache[materialIndex].length === layerCount
  })
}

const remapTextureRefAfterRemoval = (value, removedIndex, fallbackIndex) => {
  if (value === undefined || value === null) return value
  if (typeof value === 'number') {
    if (value === removedIndex) return fallbackIndex
    if (value > removedIndex) return value - 1
    return value
  }
  if (typeof value === 'object' && Array.isArray(value.Keys)) {
    const clonedValue = clone(value)
    clonedValue.Keys = clonedValue.Keys.map((key) => {
      if (!key?.Vector || key.Vector[0] === undefined) return key
      const nextKey = clone(key)
      nextKey.Vector = [...nextKey.Vector]
      nextKey.Vector[0] = remapTextureRefAfterRemoval(nextKey.Vector[0], removedIndex, fallbackIndex)
      return nextKey
    })
    return clonedValue
  }
  return value
}

const remapMaterialsAfterTextureRemoval = (materials, removedIndex, nextTextureCount) => {
  const fallbackIndex = nextTextureCount > 0 ? Math.min(removedIndex, nextTextureCount - 1) : 0
  const textureKeys = [
    'TextureID',
    'NormalTextureID',
    'ORMTextureID',
    'EmissiveTextureID',
    'TeamColorTextureID',
    'ReflectionsTextureID',
  ]
  return (Array.isArray(materials) ? materials : []).map((material) => {
    const nextMaterial = clone(material)
    nextMaterial.Layers = (Array.isArray(nextMaterial.Layers) ? nextMaterial.Layers : []).map((layer) => {
      const nextLayer = clone(layer)
      for (const key of textureKeys) {
        if (nextLayer[key] !== undefined) {
          nextLayer[key] = remapTextureRefAfterRemoval(nextLayer[key], removedIndex, fallbackIndex)
        }
      }
      return nextLayer
    })
    return nextMaterial
  })
}

const remapParticleEmittersAfterTextureRemoval = (emitters, removedIndex, nextTextureCount) => {
  const fallbackIndex = nextTextureCount > 0 ? Math.min(removedIndex, nextTextureCount - 1) : -1
  return (Array.isArray(emitters) ? emitters : []).map((emitter) => {
    const nextEmitter = clone(emitter)
    const key = nextEmitter.TextureID !== undefined ? 'TextureID' : 'TextureId'
    if (nextEmitter[key] !== undefined) {
      nextEmitter[key] = remapTextureRefAfterRemoval(nextEmitter[key], removedIndex, fallbackIndex)
    }
    return nextEmitter
  })
}

const remapTVertexAnimIdAfterRemoval = (value, removedIndex) => {
  if (value === undefined || value === null) return value
  if (typeof value !== 'number' || !Number.isInteger(value)) return value
  if (value < 0) return null
  if (value === removedIndex) return null
  if (value > removedIndex) return value - 1
  return value
}

const remapMaterialsAfterTextureAnimRemoval = (materials, removedIndex) => (
  (Array.isArray(materials) ? materials : []).map((material) => {
    const nextMaterial = clone(material)
    nextMaterial.Layers = (Array.isArray(nextMaterial.Layers) ? nextMaterial.Layers : []).map((layer) => ({
      ...clone(layer),
      TVertexAnimId: remapTVertexAnimIdAfterRemoval(
        Object.prototype.hasOwnProperty.call(layer, 'TVertexAnimId')
          ? layer.TVertexAnimId
          : (layer.TextureAnimationId ?? layer.TextureAnimId),
        removedIndex,
      ) ?? null,
    }))
    return nextMaterial
  })
)

const createUndoRedoHarness = (initialState) => {
  const harness = {
    state: clone(initialState),
    undoStack: [],
    redoStack: [],
    execute(command) {
      command.execute()
      this.undoStack.push(command)
      this.redoStack = []
    },
    undo() {
      const command = this.undoStack.pop()
      assert.ok(command, 'Fixture harness expected an undoable command')
      command.undo()
      this.redoStack.unshift(command)
    },
    redo() {
      const command = this.redoStack.shift()
      assert.ok(command, 'Fixture harness expected a redoable command')
      command.redo()
      this.undoStack.push(command)
    },
  }
  return harness
}

const createAtomicReplaceCommand = (harness, name, domains, before, after) => {
  const apply = (snapshot) => {
    for (const domain of domains) {
      harness.state[domain] = clone(snapshot[domain])
    }
  }
  return {
    name,
    execute: () => apply(after),
    undo: () => apply(before),
    redo: () => apply(after),
  }
}

const runGeosetDeleteFixture = () => {
  const alphaTrack = {
    LineType: 1,
    GlobalSeqId: null,
    Keys: [
      { Frame: 0, Vector: [1] },
      { Frame: 333, Vector: [0.25] },
      { Frame: 667, Vector: [1] },
    ],
  }
  const geosetAnims = [
    { GeosetId: 2, Alpha: { Keys: [{ Frame: 0, Vector: [1] }] } },
    { GeosetId: 8, Alpha: alphaTrack },
  ]

  const remapped = remapGeosetAnimsAfterRemovingGeosets(geosetAnims, [2])
  assert.equal(remapped.length, 1)
  assert.equal(remapped[0].GeosetId, 7)
  assert.deepEqual(remapped[0].Alpha, alphaTrack)
}

const runMaterialLayerDeleteFixture = () => {
  const beforeMaterials = [{
    Layers: [
      { TextureID: 0, TVertexAnimId: 0 },
      { TextureID: 1, TVertexAnimId: 1 },
    ],
  }]
  const afterMaterials = [{
    Layers: [
      { TextureID: 1, TVertexAnimId: 1 },
    ],
  }]

  assert.notEqual(
    buildMaterialLayerTopologySignature(beforeMaterials),
    buildMaterialLayerTopologySignature(afterMaterials),
  )
  assert.equal(afterMaterials[0].Layers[0].TVertexAnimId, 1)
  assert.equal(validateMaterialLayerCacheShape(afterMaterials, [[1]]), true)
  assert.equal(validateMaterialLayerCacheShape(afterMaterials, [[0, 1]]), false)
}

const runTextureDeleteFixture = () => {
  const materials = [{
    Layers: [
      { TextureID: 2, NormalTextureID: 1 },
      { TextureID: { Keys: [{ Frame: 0, Vector: [3] }, { Frame: 100, Vector: [1] }] } },
    ],
  }]
  const particleEmitters = [{ TextureID: 2 }, { TextureID: 0 }]
  const particleEmitters2 = [{ TextureId: 3 }, { TextureID: 1 }]

  const nextMaterials = remapMaterialsAfterTextureRemoval(materials, 1, 3)
  const nextParticleEmitters = remapParticleEmittersAfterTextureRemoval(particleEmitters, 1, 3)
  const nextParticleEmitters2 = remapParticleEmittersAfterTextureRemoval(particleEmitters2, 1, 3)

  assert.equal(nextMaterials[0].Layers[0].TextureID, 1)
  assert.equal(nextMaterials[0].Layers[0].NormalTextureID, 1)
  assert.equal(nextMaterials[0].Layers[1].TextureID.Keys[0].Vector[0], 2)
  assert.equal(nextMaterials[0].Layers[1].TextureID.Keys[1].Vector[0], 1)
  assert.equal(nextParticleEmitters[0].TextureID, 1)
  assert.equal(nextParticleEmitters[1].TextureID, 0)
  assert.equal(nextParticleEmitters2[0].TextureId, 2)
  assert.equal(nextParticleEmitters2[1].TextureID, 1)
}

const runTextureAnimationDeleteFixture = () => {
  const materials = [{
    Layers: [
      { TextureID: 0, TVertexAnimId: 0 },
      { TextureID: 1, TVertexAnimId: 2 },
      { TextureID: 2, TextureAnimationId: 1 },
    ],
  }]

  const nextMaterials = remapMaterialsAfterTextureAnimRemoval(materials, 1)
  assert.equal(nextMaterials[0].Layers[0].TVertexAnimId, 0)
  assert.equal(nextMaterials[0].Layers[1].TVertexAnimId, 1)
  assert.equal(nextMaterials[0].Layers[2].TVertexAnimId, null)
}

const runAtomicUndoRedoFixture = () => {
  const initialState = {
    Geosets: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
    GeosetAnims: [
      { GeosetId: 2, Alpha: { Keys: [{ Frame: 0, Vector: [1] }] } },
      { GeosetId: 3, Alpha: { Keys: [{ Frame: 0, Vector: [0.5] }] } },
    ],
    Materials: [{
      Layers: [
        { TextureID: 2, TVertexAnimId: 0 },
        { TextureID: { Keys: [{ Frame: 0, Vector: [3] }] }, TVertexAnimId: 2 },
      ],
    }],
    Textures: [{ Image: 'a.blp' }, { Image: 'b.blp' }, { Image: 'c.blp' }, { Image: 'd.blp' }],
    TextureAnims: [{ id: 0 }, { id: 1 }, { id: 2 }],
    ParticleEmitters: [{ TextureID: 2 }],
    ParticleEmitters2: [{ TextureId: 3 }],
  }

  const harness = createUndoRedoHarness(initialState)

  const assertUndoRedoRestores = (message, domains, before, after) => {
    const command = createAtomicReplaceCommand(harness, message, domains, before, after)
    harness.execute(command)
    for (const domain of domains) {
      assert.deepEqual(
        harness.state[domain],
        after[domain],
        `${message}: execute did not apply ${domain}; check the owning command/service`,
      )
    }
    harness.undo()
    for (const domain of domains) {
      assert.deepEqual(
        harness.state[domain],
        before[domain],
        `${message}: undo did not restore ${domain}; check the owning command/service`,
      )
    }
    harness.redo()
    for (const domain of domains) {
      assert.deepEqual(
        harness.state[domain],
        after[domain],
        `${message}: redo did not restore ${domain}; check the owning command/service`,
      )
    }
  }

  const geosetBefore = {
    Geosets: clone(harness.state.Geosets),
    GeosetAnims: clone(harness.state.GeosetAnims),
  }
  const geosetAfter = {
    Geosets: geosetBefore.Geosets.filter((_, index) => index !== 2),
    GeosetAnims: remapGeosetAnimsAfterRemovingGeosets(geosetBefore.GeosetAnims, [2]),
  }
  assertUndoRedoRestores(
    'ModelDocumentCommandHandler.replaceGeosetListAndAnimations',
    ['Geosets', 'GeosetAnims'],
    geosetBefore,
    geosetAfter,
  )

  const textureBefore = {
    Textures: clone(harness.state.Textures),
    Materials: clone(harness.state.Materials),
    ParticleEmitters: clone(harness.state.ParticleEmitters),
    ParticleEmitters2: clone(harness.state.ParticleEmitters2),
  }
  const textureAfter = {
    Textures: textureBefore.Textures.filter((_, index) => index !== 1),
    Materials: remapMaterialsAfterTextureRemoval(textureBefore.Materials, 1, textureBefore.Textures.length - 1),
    ParticleEmitters: remapParticleEmittersAfterTextureRemoval(textureBefore.ParticleEmitters, 1, textureBefore.Textures.length - 1),
    ParticleEmitters2: remapParticleEmittersAfterTextureRemoval(textureBefore.ParticleEmitters2, 1, textureBefore.Textures.length - 1),
  }
  assertUndoRedoRestores(
    'TextureMaterialCommandHandler.setTextureMaterialCollections',
    ['Textures', 'Materials', 'ParticleEmitters', 'ParticleEmitters2'],
    textureBefore,
    textureAfter,
  )

  const textureAnimBefore = {
    TextureAnims: clone(harness.state.TextureAnims),
    Materials: clone(harness.state.Materials),
  }
  const textureAnimAfter = {
    TextureAnims: textureAnimBefore.TextureAnims.filter((_, index) => index !== 1),
    Materials: remapMaterialsAfterTextureAnimRemoval(textureAnimBefore.Materials, 1),
  }
  assertUndoRedoRestores(
    'ModelDocumentCommandHandler.replaceTextureAnimationListAndMaterials',
    ['TextureAnims', 'Materials'],
    textureAnimBefore,
    textureAnimAfter,
  )

  const materialLayerBefore = {
    Materials: clone(harness.state.Materials),
  }
  const materialLayerAfter = {
    Materials: materialLayerBefore.Materials.map((material, materialIndex) => (
      materialIndex === 0
        ? { ...clone(material), Layers: clone(material.Layers).slice(1) }
        : clone(material)
    )),
  }
  assertUndoRedoRestores(
    'Material layer delete material collection commit',
    ['Materials'],
    materialLayerBefore,
    materialLayerAfter,
  )
}

runGeosetDeleteFixture()
runMaterialLayerDeleteFixture()
runTextureDeleteFixture()
runTextureAnimationDeleteFixture()
runAtomicUndoRedoFixture()

console.log('State sync fixtures passed.')
