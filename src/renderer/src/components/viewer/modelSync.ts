/**
 * modelSync - Model data synchronization utilities
 * Handles lightweight sync between store and renderer without full reloads
 */

import { validateAllParticleEmitters } from './particleValidator'

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
    let geosetVertexCountChanged = false
    if (modelData.Geosets && rendererModel.Geosets) {
        for (let i = 0; i < Math.min(modelData.Geosets.length, rendererModel.Geosets.length); i++) {
            if (modelData.Geosets[i]?.MaterialID !== rendererModel.Geosets[i]?.MaterialID) {
                geosetMaterialChanged = true
            }
            // Check for vertex count changes (caused by Split/Weld operations)
            const modelVertexCount = modelData.Geosets[i]?.Vertices?.length || 0
            const rendererVertexCount = rendererModel.Geosets[i]?.Vertices?.length || 0
            if (modelVertexCount !== rendererVertexCount) {
                geosetVertexCountChanged = true
                console.log(`[modelSync] Geoset ${i} vertex count changed: ${rendererVertexCount} -> ${modelVertexCount}`)
            }
        }
    }

    console.log('[modelSync] Change flags:', { geoChanged, textureChanged, materialChanged, particleChanged, geosetMaterialChanged, geosetVertexCountChanged, lightCountChanged })

    // OPTIMIZATION: Geoset structure changes (Split/Weld/Delete) are now handled 
    // by the commands themselves (rebuilding buffers). We can trust the live renderer.
    if (geoChanged) {
        console.log('[modelSync] Geoset count changed, but skipping reload (Trusting Command)')
        // return { needsReload: true, reason: 'Geoset count changed' }
    }

    // OPTIMIZATION: Texture changes are now handled via lightweight sync
    // New textures are loaded via setTextureImage() in the viewer
    if (textureChanged) {
        console.log('[modelSync] Texture count changed, but using lightweight sync')
        // return { needsReload: true, reason: 'Texture count changed' }
    }
    // OPTIMIZATION: Material changes are now handled via lightweight sync
    // syncMaterials() rebuilds the materialLayerTextureID cache
    if (materialChanged) {
        console.log('[modelSync] Material count changed, but using lightweight sync')
        // return { needsReload: true, reason: 'Material count changed' }
    }
    // OPTIMIZATION: Particle changes are now handled via lightweight sync
    // The ParticlesController.syncEmitters() method dynamically adds/removes emitters
    // if (particleChanged) return { needsReload: true, reason: 'Particle count changed' }
    // OPTIMIZATION: Geoset MaterialID changes are now handled via lightweight sync
    // syncMaterials() rebuilds the materialLayerTextureID cache after MaterialID changes
    if (geosetMaterialChanged) {
        console.log('[modelSync] Geoset MaterialID changed, but using lightweight sync')
        // return { needsReload: true, reason: 'Geoset MaterialID changed' }
    }

    if (geosetVertexCountChanged) {
        console.log('[modelSync] Geoset vertex count changed, but skipping reload (Trusting Command)')
        // return { needsReload: true, reason: 'Geoset vertex count changed (Split/Weld)' }
    }
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
    // Validate particles before syncing to prevent rendering crashes
    if (modelData.ParticleEmitters2) {
        validateAllParticleEmitters(modelData)
        const nextEmitters = modelData.ParticleEmitters2
        const currentEmitters = renderer.model.ParticleEmitters2 || []
        if (currentEmitters.length === nextEmitters.length) {
            for (let i = 0; i < nextEmitters.length; i++) {
                Object.assign(currentEmitters[i], nextEmitters[i])
            }
            renderer.model.ParticleEmitters2 = currentEmitters
        } else {
            renderer.model.ParticleEmitters2 = nextEmitters
        }
        console.log('[modelSync] Synced ParticleEmitters2:', renderer.model.ParticleEmitters2.length, 'emitters')
        // ParticlesController.syncEmitters() is called automatically in update()
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
    // Sync nodes to both model and rendererData for particle emitter lookups
    if (modelData.Nodes) {
        renderer.model.Nodes = modelData.Nodes
        // Also update rendererData.nodes for particles to find their node transforms
        if (renderer.modelInstance?.syncNodes) {
            renderer.modelInstance.syncNodes()
            console.log('[modelSync] Called modelInstance.syncNodes() for node updates')
        }
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
    // Sync GlobalSequences frames for new TextureAnimations to work
    if (modelData.GlobalSequences) {
        renderer.model.GlobalSequences = modelData.GlobalSequences
        // Sync the globalSequencesFrames array for new entries
        if (renderer.modelInstance?.syncGlobalSequences) {
            renderer.modelInstance.syncGlobalSequences()
            console.log('[modelSync] Called modelInstance.syncGlobalSequences() for GlobalSequences update')
        }
    }

    // === PIVOT POINTS ===
    if (modelData.PivotPoints) {
        renderer.model.PivotPoints = modelData.PivotPoints
    }

    // === TEXTURE ANIMS ===
    if (modelData.TextureAnims) {
        renderer.model.TextureAnims = modelData.TextureAnims
        // Debug: Log TextureAnims data to help trace sync issues
        console.log('[modelSync] Synced TextureAnims:', modelData.TextureAnims.length, 'anims')
        modelData.TextureAnims.forEach((anim: any, index: number) => {
            const trans = anim.Translation
            const rot = anim.Rotation
            const scale = anim.Scaling
            console.log(`[modelSync] TextureAnim[${index}]:`, {
                hasTranslation: !!trans,
                transGlobalSeqId: trans?.GlobalSeqId,
                transKeysCount: trans?.Keys?.length,
                hasRotation: !!rot,
                rotGlobalSeqId: rot?.GlobalSeqId,
                hasScaling: !!scale,
                scaleGlobalSeqId: scale?.GlobalSeqId
            })
        })
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
