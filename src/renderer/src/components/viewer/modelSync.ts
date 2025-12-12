/**
 * modelSync - Model data synchronization utilities
 * Handles lightweight sync between store and renderer without full reloads
 */

/**
 * Check if structural changes require a full renderer reload
 */
export function checkForStructuralChanges(
    modelData: any,
    rendererModel: any
): { needsReload: boolean; reason?: string } {
    console.log('[modelSync] checkForStructuralChanges called')
    console.log('[modelSync] modelData counts:', {
        Geosets: modelData.Geosets?.length || 0,
        Textures: modelData.Textures?.length || 0,
        Materials: modelData.Materials?.length || 0,
        ParticleEmitters2: modelData.ParticleEmitters2?.length || 0,
        Lights: modelData.Lights?.length || 0,
        Nodes: modelData.Nodes?.length || 0
    })
    console.log('[modelSync] rendererModel counts:', {
        Geosets: rendererModel.Geosets?.length || 0,
        Textures: rendererModel.Textures?.length || 0,
        Materials: rendererModel.Materials?.length || 0,
        ParticleEmitters2: rendererModel.ParticleEmitters2?.length || 0,
        Lights: rendererModel.Lights?.length || 0,
        Nodes: rendererModel.Nodes?.length || 0
    })

    const geoChanged = (modelData.Geosets?.length || 0) !== (rendererModel.Geosets?.length || 0)
    const textureChanged = (modelData.Textures?.length || 0) !== (rendererModel.Textures?.length || 0)
    const materialChanged = (modelData.Materials?.length || 0) !== (rendererModel.Materials?.length || 0)
    const particleChanged = (modelData.ParticleEmitters2?.length || 0) !== (rendererModel.ParticleEmitters2?.length || 0)
    const lightCountChanged = (modelData.Lights?.length || 0) !== (rendererModel.Lights?.length || 0)

    // Check for MaterialID changes on geosets
    let geosetMaterialChanged = false
    if (modelData.Geosets && rendererModel.Geosets) {
        for (let i = 0; i < Math.min(modelData.Geosets.length, rendererModel.Geosets.length); i++) {
            if (modelData.Geosets[i]?.MaterialID !== rendererModel.Geosets[i]?.MaterialID) {
                geosetMaterialChanged = true
                break
            }
        }
    }

    console.log('[modelSync] Change flags:', { geoChanged, textureChanged, materialChanged, particleChanged, geosetMaterialChanged, lightCountChanged })

    if (geoChanged) return { needsReload: true, reason: 'Geoset count changed' }
    if (textureChanged) return { needsReload: true, reason: 'Texture count changed' }
    if (materialChanged) return { needsReload: true, reason: 'Material count changed' }
    if (particleChanged) return { needsReload: true, reason: 'Particle count changed' }
    if (geosetMaterialChanged) return { needsReload: true, reason: 'Geoset MaterialID changed' }
    if (lightCountChanged) return { needsReload: true, reason: 'Light count changed' }

    console.log('[modelSync] No structural changes, using lightweight sync')
    return { needsReload: false }
}

/**
 * Perform lightweight sync of model data to renderer
 * Updates internal data arrays without recreating the renderer
 */
export function lightweightSync(renderer: any, modelData: any): void {
    if (!renderer?.model || !modelData) return

    // === PARTICLE EMITTERS ===
    if (modelData.ParticleEmitters2) {
        renderer.model.ParticleEmitters2 = modelData.ParticleEmitters2
        console.log('[modelSync] Synced ParticleEmitters2:', modelData.ParticleEmitters2.length, 'emitters')
    }

    // === RIBBON EMITTERS ===
    if (modelData.RibbonEmitters) {
        renderer.model.RibbonEmitters = modelData.RibbonEmitters
    }

    // === LIGHTS ===
    if (modelData.Lights) {
        renderer.model.Lights = modelData.Lights
    }

    // === NODES ===
    if (modelData.Nodes) {
        renderer.model.Nodes = modelData.Nodes
    }

    // === BONES ===
    if (modelData.Bones) {
        renderer.model.Bones = modelData.Bones
    }

    // === HELPERS ===
    if (modelData.Helpers) {
        renderer.model.Helpers = modelData.Helpers
    }

    // === ATTACHMENTS ===
    if (modelData.Attachments) {
        renderer.model.Attachments = modelData.Attachments
    }

    // === COLLISION SHAPES ===
    if (modelData.CollisionShapes) {
        renderer.model.CollisionShapes = modelData.CollisionShapes
    }

    // === CAMERAS ===
    if (modelData.Cameras) {
        renderer.model.Cameras = modelData.Cameras
    }

    // === MATERIALS ===
    if (modelData.Materials) {
        console.log('[modelSync] Syncing materials. Count:', modelData.Materials.length)
        if (modelData.Materials.length > 0) {
            console.log('[modelSync] First material Layers:', modelData.Materials[0]?.Layers?.length || 0)
        }
        renderer.model.Materials = modelData.Materials
    }

    // === GEOSET ANIMS ===
    if (modelData.GeosetAnims) {
        renderer.model.GeosetAnims = modelData.GeosetAnims
    }

    // === SEQUENCES ===
    if (modelData.Sequences) {
        renderer.model.Sequences = modelData.Sequences
    }

    // === GLOBAL SEQUENCES ===
    if (modelData.GlobalSequences) {
        renderer.model.GlobalSequences = modelData.GlobalSequences
    }

    // === PIVOT POINTS ===
    if (modelData.PivotPoints) {
        renderer.model.PivotPoints = modelData.PivotPoints
    }

    // === TEXTURE ANIMS ===
    if (modelData.TextureAnims) {
        renderer.model.TextureAnims = modelData.TextureAnims
    }

    console.log('[modelSync] Lightweight sync complete')
}

/**
 * Sync node data from store to renderer data
 */
export function syncNodeData(renderer: any, storeNodes: any[]): void {
    if (!renderer?.model || !renderer.rendererData?.nodes) return

    // Update raw model nodes
    renderer.model.Nodes = storeNodes

    // Update rendererData.nodes wrappers
    renderer.rendererData.nodes.forEach((wrapper: any) => {
        const storeNode = storeNodes.find((sn: any) => sn.ObjectId === wrapper.node.ObjectId)
        if (storeNode) {
            // Copy updated properties
            Object.assign(wrapper.node, storeNode)
        }
    })
}
