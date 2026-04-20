import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { useSelectionStore } from '../../store/selectionStore'
import { mergeGeosetMetadata } from './ToolWindowSnapshots'

export interface TextureManagerCommandOptions {
    onTexturesSaved?: () => void
}

export class TextureManagerCommandHandler {
    handle(command: string, payload: unknown, options: TextureManagerCommandOptions = {}): void {
        if (command === 'SAVE_TEXTURES') {
            const textures = (payload as { textures?: unknown } | undefined)?.textures
            if (Array.isArray(textures)) {
                useModelStore.getState().setTextures(textures)
                options.onTexturesSaved?.()
            }
            return
        }

        if (command !== 'EXECUTE_TEXTURE_ACTION') {
            return
        }

        const actionPayload = payload as { action?: string; payload?: any } | undefined
        const action = actionPayload?.action
        const data = actionPayload?.payload

        if (action === 'SAVE_TEXTURES') {
            useModelStore.getState().setTextures(data)
            return
        }

        if (action === 'SAVE_TEXTURES_WITH_MATERIALS') {
            const currentGeosets = useModelStore.getState().modelData?.Geosets
            const mergedGeosets = mergeGeosetMetadata(currentGeosets, data?.geosets)
            useModelStore.getState().setVisualDataPatch({
                Textures: data?.textures || [],
                Materials: Array.isArray(data?.materials) ? data.materials : undefined,
                Geosets: mergedGeosets,
            })
            return
        }

        if (action === 'SET_TEXTURE_SAVE_MODE') {
            useRendererStore.getState().setTextureSaveMode(data?.mode === 'save_as' ? 'save_as' : 'overwrite')
            return
        }

        if (action === 'SET_TEXTURE_SAVE_SUFFIX') {
            const nextSuffix = typeof data?.suffix === 'string' ? data.suffix : ''
            useRendererStore.getState().setTextureSaveSuffix(nextSuffix)
            return
        }

        if (action === 'RELOAD_RENDERER') {
            useModelStore.getState().triggerRendererReload()
        }
    }
}

export class MaterialManagerCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_MATERIAL_ACTION') {
            return
        }

        const actionPayload = payload as { action?: string; payload?: any } | undefined
        const action = actionPayload?.action
        const data = actionPayload?.payload

        if (action === 'SAVE_MATERIALS') {
            const currentGeosets = useModelStore.getState().modelData?.Geosets
            const mergedGeosets = mergeGeosetMetadata(currentGeosets, data?.geosets)
            useModelStore.getState().setMaterialManagerPreview({
                textures: data?.textures,
                materials: data?.materials,
                geosets: mergedGeosets,
            })
            return
        }

        if (action === 'RELOAD_RENDERER') {
            useModelStore.getState().triggerRendererReload()
            return
        }

        if (action === 'SET_SELECTION') {
            if (data && Object.prototype.hasOwnProperty.call(data, 'selectedMaterialIndex')) {
                useSelectionStore.getState().setSelectedMaterialIndex(data.selectedMaterialIndex ?? null)
            }
            if (data && Object.prototype.hasOwnProperty.call(data, 'selectedMaterialLayerIndex')) {
                useSelectionStore.getState().setSelectedMaterialLayerIndex(data.selectedMaterialLayerIndex ?? null)
            }
        }
    }
}

export class GeosetEditorCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_GEOSET_ACTION') {
            return
        }

        const actionPayload = payload as { action?: string; payload?: any } | undefined
        if (actionPayload?.action !== 'SAVE_ALL') {
            return
        }

        const currentGeosets = useModelStore.getState().modelData?.Geosets
        const mergedGeosets = mergeGeosetMetadata(currentGeosets, actionPayload.payload)
        if (mergedGeosets) {
            useModelStore.getState().setGeosets(mergedGeosets)
        }
    }
}

export class GeosetVisibilityCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_VISIBILITY_ACTION') {
            return
        }

        const actionPayload = payload as { action?: string; payload?: any } | undefined
        const action = actionPayload?.action
        const data = actionPayload?.payload

        if (action === 'SAVE_ANIMS') {
            useModelStore.getState().setGeosetAnims(data)
            return
        }

        if (action === 'SET_SEQUENCE') {
            useModelStore.getState().setSequence(data)
            return
        }

        if (action === 'SET_FRAME') {
            useModelStore.getState().setFrame(data)
        }
    }
}

export class GeosetAnimationCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_ANIM_ACTION') {
            return
        }

        const actionPayload = payload as { action?: string; payload?: any } | undefined
        if (actionPayload?.action === 'UPDATE_GEOSET_ANIMS') {
            useModelStore.getState().setGeosetAnims(actionPayload.payload)
        }
    }
}

export class TextureAnimationCommandHandler {
    handle(command: string, payload: unknown): void {
        if (command !== 'EXECUTE_TEXTURE_ANIM_ACTION') {
            return
        }

        const actionPayload = payload as { action?: string; payload?: any } | undefined
        const action = actionPayload?.action
        if (action !== 'ADD' && action !== 'DELETE' && action !== 'UPDATE' && action !== 'TOGGLE_BLOCK' && action !== 'SAVE_ALL') {
            return
        }

        const data = actionPayload?.payload
        const anims = data && typeof data === 'object' && !Array.isArray(data) && data.newAnims
            ? data.newAnims
            : data

        if (Array.isArray(anims)) {
            useModelStore.getState().setTextureAnims(anims)
        } else {
            console.error('[ToolWindowCommandHandlers] Received invalid TextureAnims payload:', data)
        }
    }
}

export const textureManagerCommandHandler = new TextureManagerCommandHandler()
export const materialManagerCommandHandler = new MaterialManagerCommandHandler()
export const geosetEditorCommandHandler = new GeosetEditorCommandHandler()
export const geosetVisibilityCommandHandler = new GeosetVisibilityCommandHandler()
export const geosetAnimationCommandHandler = new GeosetAnimationCommandHandler()
export const textureAnimationCommandHandler = new TextureAnimationCommandHandler()
