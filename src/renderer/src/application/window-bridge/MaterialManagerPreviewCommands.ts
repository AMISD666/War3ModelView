import { useModelStore } from '../../store/modelStore'
import { remapGeosetsAfterMaterialRemoval, remapRibbonEmittersAfterMaterialRemoval } from '../../utils/materialTextureRelations'
import { textureMaterialCommandHandler } from '../commands'
import { cloneToolWindowData } from './ToolWindowCommandShared'

const setPreviewMaterials = (materials: unknown[], state = useModelStore.getState()): void => {
    textureMaterialCommandHandler.setMaterialManagerPreview({
        preview: {
            textures: state.materialManagerPreview?.textures ?? state.modelData?.Textures ?? [],
            materials,
            geosets: state.materialManagerPreview?.geosets,
            ribbonEmitters: state.materialManagerPreview?.ribbonEmitters,
        },
    })
}

export const patchMaterialPreview = (
    materialIndex: number,
    updates: Record<string, unknown>,
): boolean => {
    if (!Number.isInteger(materialIndex) || materialIndex < 0) {
        return false
    }

    const state = useModelStore.getState()
    const sourceMaterials = state.materialManagerPreview?.materials ?? state.modelData?.Materials
    if (!Array.isArray(sourceMaterials)) {
        return false
    }

    const materials = cloneToolWindowData(sourceMaterials)
    const material = materials[materialIndex]
    if (!material || typeof material !== 'object' || Array.isArray(material)) {
        return false
    }

    materials[materialIndex] = { ...material, ...updates }
    setPreviewMaterials(materials, state)
    return true
}

export const patchMaterialLayerPreview = (
    materialIndex: number,
    layerIndex: number,
    updates: Record<string, unknown>,
): boolean => {
    if (!Number.isInteger(materialIndex) || !Number.isInteger(layerIndex) || materialIndex < 0 || layerIndex < 0) {
        return false
    }

    const state = useModelStore.getState()
    const sourceMaterials = state.materialManagerPreview?.materials ?? state.modelData?.Materials
    if (!Array.isArray(sourceMaterials)) {
        return false
    }

    const materials = cloneToolWindowData(sourceMaterials)
    const material = materials[materialIndex]
    const layers = Array.isArray(material?.Layers) ? [...material.Layers] : []
    if (!material || layerIndex >= layers.length) {
        return false
    }

    const nextLayer = { ...layers[layerIndex], ...updates }
    if (Object.prototype.hasOwnProperty.call(updates, 'TVertexAnimId')) {
        delete nextLayer.TextureAnimationId
        delete nextLayer.TextureAnimId
    }
    layers[layerIndex] = nextLayer
    materials[materialIndex] = { ...material, Layers: layers }
    setPreviewMaterials(materials, state)
    return true
}

export const addMaterialLayerPreview = (
    materialIndex: number,
    layer: Record<string, unknown>,
): boolean => {
    if (!Number.isInteger(materialIndex) || materialIndex < 0) {
        return false
    }

    const state = useModelStore.getState()
    const sourceMaterials = state.materialManagerPreview?.materials ?? state.modelData?.Materials
    if (!Array.isArray(sourceMaterials)) {
        return false
    }

    const materials = cloneToolWindowData(sourceMaterials)
    const material = materials[materialIndex]
    if (!material || typeof material !== 'object' || Array.isArray(material)) {
        return false
    }

    const layers = Array.isArray(material.Layers) ? [...material.Layers] : []
    materials[materialIndex] = { ...material, Layers: [...layers, layer] }
    setPreviewMaterials(materials, state)
    return true
}

export const deleteMaterialLayerPreview = (
    materialIndex: number,
    layerIndex: number,
): boolean => {
    if (!Number.isInteger(materialIndex) || !Number.isInteger(layerIndex) || materialIndex < 0 || layerIndex < 0) {
        return false
    }

    const state = useModelStore.getState()
    const sourceMaterials = state.materialManagerPreview?.materials ?? state.modelData?.Materials
    if (!Array.isArray(sourceMaterials)) {
        return false
    }

    const materials = cloneToolWindowData(sourceMaterials)
    const material = materials[materialIndex]
    const layers = Array.isArray(material?.Layers) ? [...material.Layers] : []
    if (!material || layerIndex >= layers.length) {
        return false
    }

    materials[materialIndex] = {
        ...material,
        Layers: layers.filter((_, index) => index !== layerIndex),
    }
    setPreviewMaterials(materials, state)
    return true
}

export const moveMaterialLayerPreview = (
    materialIndex: number,
    fromIndex: number,
    toIndex: number,
): boolean => {
    if (
        !Number.isInteger(materialIndex)
        || !Number.isInteger(fromIndex)
        || !Number.isInteger(toIndex)
        || materialIndex < 0
        || fromIndex < 0
        || toIndex < 0
        || fromIndex === toIndex
    ) {
        return false
    }

    const state = useModelStore.getState()
    const sourceMaterials = state.materialManagerPreview?.materials ?? state.modelData?.Materials
    if (!Array.isArray(sourceMaterials)) {
        return false
    }

    const materials = cloneToolWindowData(sourceMaterials)
    const material = materials[materialIndex]
    const layers = Array.isArray(material?.Layers) ? [...material.Layers] : []
    if (!material || fromIndex >= layers.length || toIndex >= layers.length) {
        return false
    }

    const [moved] = layers.splice(fromIndex, 1)
    layers.splice(toIndex, 0, moved)
    materials[materialIndex] = { ...material, Layers: layers }
    setPreviewMaterials(materials, state)
    return true
}

export const addMaterialPreview = (
    material: Record<string, unknown>,
): boolean => {
    if (!material || typeof material !== 'object' || Array.isArray(material)) {
        return false
    }

    const state = useModelStore.getState()
    const sourceMaterials = state.materialManagerPreview?.materials ?? state.modelData?.Materials
    if (!Array.isArray(sourceMaterials)) {
        return false
    }

    setPreviewMaterials([...cloneToolWindowData(sourceMaterials), cloneToolWindowData(material)], state)
    return true
}

export const deleteMaterialPreview = (
    materialIndex: number,
): boolean => {
    if (!Number.isInteger(materialIndex) || materialIndex < 0) {
        return false
    }

    const state = useModelStore.getState()
    const sourceMaterials = state.materialManagerPreview?.materials ?? state.modelData?.Materials
    if (!Array.isArray(sourceMaterials) || materialIndex >= sourceMaterials.length) {
        return false
    }

    const materials = cloneToolWindowData(sourceMaterials).filter((_, index) => index !== materialIndex)
    const nextMaterialCount = materials.length
    const geosets = remapGeosetsAfterMaterialRemoval(
        state.materialManagerPreview?.geosets ?? state.modelData?.Geosets,
        materialIndex,
        nextMaterialCount,
    )
    const ribbonEmitters = remapRibbonEmittersAfterMaterialRemoval(
        state.materialManagerPreview?.ribbonEmitters ?? state.modelData?.RibbonEmitters,
        materialIndex,
        nextMaterialCount,
    )

    textureMaterialCommandHandler.setMaterialManagerPreview({
        preview: {
            textures: state.materialManagerPreview?.textures ?? state.modelData?.Textures ?? [],
            materials,
            geosets,
            ribbonEmitters,
        },
    })
    return true
}
