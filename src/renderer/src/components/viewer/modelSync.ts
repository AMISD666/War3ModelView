/**
 * modelSync - Model data synchronization utilities
 * Handles lightweight sync between store and renderer without full reloads
 */

import { validateAllParticleEmitters } from './particleValidator'
import {
    buildMaterialLayerTopologySignature,
    buildTextureDefinitionSignature
} from '../../utils/materialTextureRelations'

/**
 * Check if structural changes require a full renderer reload
 */
export function checkForStructuralChanges(
    modelData: any,
    rendererModel: any
): { needsReload: boolean; reason?: string } {  const geoChanged = (modelData.Geosets?.length || 0) !== (rendererModel.Geosets?.length || 0)
    const textureChanged = buildTextureDefinitionSignature(modelData.Textures) !== buildTextureDefinitionSignature(rendererModel.Textures)
    const materialChanged = (modelData.Materials?.length || 0) !== (rendererModel.Materials?.length || 0)
    const materialTopologyChanged = buildMaterialLayerTopologySignature(modelData.Materials) !== buildMaterialLayerTopologySignature(rendererModel.Materials)
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
                geosetVertexCountChanged = true            }
        }
    }    // OPTIMIZATION: Geoset structure changes (Split/Weld/Delete) are now handled 
    // by the commands themselves (rebuilding buffers). We can trust the live renderer.
    if (geoChanged) {        // return { needsReload: true, reason: 'Geoset count changed' }
    }

    if (textureChanged) {    }
    if (materialChanged) {
        return { needsReload: true, reason: 'Material count changed' }
    }
    if (materialTopologyChanged) {
        return { needsReload: true, reason: 'Material layer topology changed' }
    }
    // OPTIMIZATION: Particle changes are now handled via lightweight sync
    // The ParticlesController.syncEmitters() method dynamically adds/removes emitters
    // if (particleChanged) return { needsReload: true, reason: 'Particle count changed' }
    // OPTIMIZATION: Geoset MaterialID changes are now handled via lightweight sync
    // syncMaterials() rebuilds the materialLayerTextureID cache after MaterialID changes
    if (geosetMaterialChanged) {
        // return { needsReload: true, reason: 'Geoset MaterialID changed' }
    }

    if (geosetVertexCountChanged) {
        // return { needsReload: true, reason: 'Geoset vertex count changed (Split/Weld)' }
    }
    if (lightCountChanged) return { needsReload: true, reason: 'Light count changed' }
    return { needsReload: false }
}

/**
 * 按 ObjectId 将 next 合并进 current，保持数组槽位与渲染器初次加载时一致。
 * modelData 里 PE2 可能被按 ObjectId 排序，而 MDX 解析顺序不同；若按下标 Object.assign 会错配发射器（颜色/速度/重力错乱或粒子消失）。
 */
export function syncParticleEmitters2InPlace(currentEmitters: any[], nextEmitters: any[]): void {
    if (currentEmitters.length !== nextEmitters.length) return
    const nextById = new Map<number, any>()
    for (const e of nextEmitters) {
        if (e && typeof e.ObjectId === 'number' && !Number.isNaN(e.ObjectId)) {
            nextById.set(e.ObjectId, e)
        }
    }
    for (let i = 0; i < currentEmitters.length; i++) {
        const em = currentEmitters[i]
        const oid = em?.ObjectId
        const next = typeof oid === 'number' ? nextById.get(oid) : undefined
        if (!next) continue
        Object.assign(em, next)
        const anim = em.VisibilityAnim
        if (anim != null && typeof anim === 'object' && anim.Keys != null) {
            const v = em.Visibility
            if (v == null || typeof v === 'number') {
                em.Visibility = anim
            }
        }
    }
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
            syncParticleEmitters2InPlace(currentEmitters, nextEmitters)
            renderer.model.ParticleEmitters2 = currentEmitters
        } else {
            renderer.model.ParticleEmitters2 = nextEmitters
        }        // ParticlesController.syncEmitters() is called automatically in update()
    }

    // === RIBBON EMITTERS ===
    if (modelData.RibbonEmitters) {
        renderer.model.RibbonEmitters = modelData.RibbonEmitters
        if (renderer.modelInstance?.ribbonsController?.syncEmitters) {
            renderer.modelInstance.ribbonsController.syncEmitters()
        }
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
            renderer.modelInstance.syncNodes()        }
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
    if (modelData.Materials) {        if (modelData.Materials.length > 0) {        }
        renderer.model.Materials = modelData.Materials
        if (renderer.modelInstance?.syncMaterials) {
            renderer.modelInstance.syncMaterials()
        }
        if (renderer.modelInstance?.ribbonsController?.syncEmitters) {
            renderer.modelInstance.ribbonsController.syncEmitters()
        }
    }

    // === GEOSET ANIMS ===
    if (modelData.GeosetAnims) {
        renderer.model.GeosetAnims = modelData.GeosetAnims
        if ((renderer as any).modelInstance && typeof (renderer as any).modelInstance.syncMaterials === 'function') {
            (renderer as any).modelInstance.syncMaterials()
        }
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
            renderer.modelInstance.syncGlobalSequences()        }
    }

    // === PIVOT POINTS ===
    if (modelData.PivotPoints) {
        renderer.model.PivotPoints = modelData.PivotPoints
    }

    // === TEXTURE ANIMS ===
    if (modelData.TextureAnims) {
        renderer.model.TextureAnims = modelData.TextureAnims
        modelData.TextureAnims.forEach((anim: any, index: number) => {
            const trans = anim.Translation
            const rot = anim.Rotation
            const scale = anim.Scaling
            void trans
            void rot
            void scale
            void index
        })
    }
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
