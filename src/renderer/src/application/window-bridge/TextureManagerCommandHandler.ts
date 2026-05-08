import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { textureMaterialCommandHandler } from '../commands'
import { parseTextureManagerCommandPayload } from './TextureManagerCommandPayload'
import {
    checkCommandRevision,
    cloneToolWindowData,
    markCommandReceived,
    rejectToolWindowCommand,
    type RevisionedToolCommand,
} from './ToolWindowCommandShared'

export interface TextureManagerCommandOptions {
    onTexturesSaved?: () => void
}

const SOURCE = 'TextureManagerCommandHandler'

const patchTextureCollectionItem = (
    textureIndex: number,
    updates: Record<string, unknown>,
): boolean => {
    if (!Number.isInteger(textureIndex) || textureIndex < 0) {
        return false
    }

    const textures = useModelStore.getState().modelData?.Textures
    if (!Array.isArray(textures) || textureIndex >= textures.length) {
        return false
    }

    const currentTexture = textures[textureIndex]
    if (!currentTexture || typeof currentTexture !== 'object' || Array.isArray(currentTexture)) {
        return false
    }

    const nextTextures = cloneToolWindowData(textures)
    nextTextures[textureIndex] = { ...currentTexture, ...updates }
    textureMaterialCommandHandler.setTextureCollection({ textures: nextTextures })
    return true
}

const deleteTextureCollectionItem = (textureIndex: number): boolean => {
    if (!Number.isInteger(textureIndex) || textureIndex < 0) {
        return false
    }

    const textures = useModelStore.getState().modelData?.Textures
    if (!Array.isArray(textures) || textureIndex >= textures.length) {
        return false
    }

    textureMaterialCommandHandler.setTextureCollection({
        textures: textures.filter((_, index) => index !== textureIndex),
    })
    return true
}

const appendTextureCollectionItems = (texturesToAdd: Record<string, unknown>[]): boolean => {
    if (!Array.isArray(texturesToAdd) || texturesToAdd.length === 0) {
        return false
    }

    const textures = useModelStore.getState().modelData?.Textures
    if (!Array.isArray(textures)) {
        return false
    }

    textureMaterialCommandHandler.setTextureCollection({
        textures: [
            ...cloneToolWindowData(textures),
            ...cloneToolWindowData(texturesToAdd),
        ],
    })
    return true
}

export class TextureManagerCommandHandler {
    handle(command: string, payload: unknown, options: TextureManagerCommandOptions = {}): void {
        if (command === 'SAVE_TEXTURES') {
            const textures = (payload as { textures?: unknown } | undefined)?.textures
            if (Array.isArray(textures)) {
                textureMaterialCommandHandler.setTextureCollection({ textures })
                options.onTexturesSaved?.()
            }
            return
        }

        if (command !== 'EXECUTE_TEXTURE_ACTION') {
            return
        }

        const texturePayload = parseTextureManagerCommandPayload(payload)
        const actionPayload = texturePayload.ok ? texturePayload.payload : payload as RevisionedToolCommand | undefined
        markCommandReceived(SOURCE, command, actionPayload)
        if (!checkCommandRevision(SOURCE, actionPayload)) {
            return
        }
        if (!texturePayload.ok) {
            rejectToolWindowCommand(SOURCE, actionPayload, 'invalid_payload')
            console.warn(`[${SOURCE}] Rejected invalid payload`, { reason: texturePayload.reason })
            return
        }

        const { action } = texturePayload.payload
        if (action === 'SAVE_TEXTURES') {
            textureMaterialCommandHandler.setTextureCollection({ textures: texturePayload.payload.payload })
            return
        }
        if (action === 'PATCH_TEXTURE') {
            const { index, updates } = texturePayload.payload.payload
            if (!patchTextureCollectionItem(index, updates)) {
                rejectToolWindowCommand(SOURCE, texturePayload.payload, 'invalid_texture_patch_target')
            }
            return
        }
        if (action === 'DELETE_TEXTURE') {
            const { index } = texturePayload.payload.payload
            if (!deleteTextureCollectionItem(index)) {
                rejectToolWindowCommand(SOURCE, texturePayload.payload, 'invalid_texture_delete_target')
            }
            return
        }
        if (action === 'ADD_TEXTURES') {
            const { textures } = texturePayload.payload.payload
            if (!appendTextureCollectionItems(textures)) {
                rejectToolWindowCommand(SOURCE, texturePayload.payload, 'invalid_texture_add_payload')
            }
            return
        }
        if (action === 'SET_TEXTURE_SAVE_MODE') {
            useRendererStore.getState().setTextureSaveMode(texturePayload.payload.payload.mode)
            return
        }
        if (action === 'SET_TEXTURE_SAVE_SUFFIX') {
            useRendererStore.getState().setTextureSaveSuffix(texturePayload.payload.payload.suffix)
            return
        }
        if (action === 'RELOAD_RENDERER') {
            useModelStore.getState().triggerRendererReload()
        }
    }
}

export const textureManagerCommandHandler = new TextureManagerCommandHandler()
