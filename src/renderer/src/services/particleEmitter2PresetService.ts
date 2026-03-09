import { invoke } from '@tauri-apps/api/core'
import { exists, mkdir, readDir, readFile, readTextFile, remove, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { decodeTexture, getTextureCandidatePaths, normalizePath, REPLACEABLE_TEXTURES } from '../components/viewer/textureLoader'
import { useModelStore } from '../store/modelStore'
import { NodeType, ParticleEmitter2Node } from '../types/node'

const PRESET_ROOT_DIR = 'particle_emitter2_presets'
const PRESET_MANIFEST_FILE = 'preset.json'
const MODEL_IMPORT_DIR = 'ParticlePresetTextures'

export interface ParticleEmitter2PresetSummary {
    id: string
    name: string
    savedAt: string
}

export interface ParticleEmitter2Preset extends ParticleEmitter2PresetSummary {
    emitter: ParticleEmitter2Node
    texture: {
        fileName: string
        sourceImagePath: string
        texture: Record<string, any>
    } | null
}

interface SaveParticleEmitter2PresetOptions {
    name: string
    emitter: ParticleEmitter2Node
    texture: any | null
    modelPath: string | null
}

interface CreateParticleEmitter2FromPresetOptions {
    presetId: string
    parentId: number
}

const sanitizeSegment = (value: string): string =>
    value
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')

const normalizeWindowsPath = (value: string): string => value.replace(/\//g, '\\')

const getDirname = (value: string): string => {
    const normalized = normalizeWindowsPath(value)
    const idx = normalized.lastIndexOf('\\')
    return idx >= 0 ? normalized.slice(0, idx) : normalized
}

const getFileName = (value: string): string => {
    const normalized = normalizeWindowsPath(value)
    const idx = normalized.lastIndexOf('\\')
    return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

const getFileExtension = (value: string): string => {
    const fileName = getFileName(value)
    const idx = fileName.lastIndexOf('.')
    return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : 'blp'
}

const copyFileByReadWrite = async (sourcePath: string, targetPath: string): Promise<void> => {
    const bytes = await readFile(sourcePath)
    await writeFile(targetPath, bytes)
}

const withoutFileExtension = (value: string): string => {
    const fileName = getFileName(value)
    const idx = fileName.lastIndexOf('.')
    return idx >= 0 ? fileName.slice(0, idx) : fileName
}

const cloneValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const getPresetId = (name: string): string => sanitizeSegment(name) || `preset_${Date.now()}`

const getPresetRoot = async (): Promise<string> => {
    const storageRoot = await invoke<string>('get_app_storage_root_cmd')
    const root = `${storageRoot}\\${PRESET_ROOT_DIR}`
    await mkdir(root, { recursive: true })
    return root
}

const getPresetDir = async (presetId: string): Promise<string> => {
    const root = await getPresetRoot()
    return `${root}\\${presetId}`
}

const resolveTextureImagePath = (texture: any): string | null => {
    const directImage = typeof texture?.Image === 'string' ? texture.Image.trim() : ''
    if (directImage) {
        return normalizePath(directImage)
    }

    const replaceableId = Number(texture?.ReplaceableId ?? 0)
    const replaceablePath = REPLACEABLE_TEXTURES[replaceableId]
    if (replaceablePath) {
        return normalizePath(`ReplaceableTextures\\${replaceablePath}.blp`)
    }

    return null
}

const toUint8ArrayPayload = (payload: any): Uint8Array | null => {
    if (!payload) return null
    if (payload instanceof Uint8Array) return payload
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
    if (Array.isArray(payload)) return Uint8Array.from(payload)
    if (ArrayBuffer.isView(payload)) {
        return new Uint8Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength))
    }
    if (Array.isArray(payload?.data)) return Uint8Array.from(payload.data)
    return null
}

const encodeImageDataToBytes = async (imagePath: string, imageData: ImageData): Promise<Uint8Array> => {
    const format = getFileExtension(imagePath)
    const payload = await invoke<any>('encode_texture_image', {
        rgba: Array.from(imageData.data),
        width: imageData.width,
        height: imageData.height,
        format,
        blpQuality: 90,
    })
    const bytes = toUint8ArrayPayload(payload)
    if (!bytes || bytes.byteLength === 0) {
        throw new Error('编码贴图失败')
    }
    return bytes
}

const findLocalTextureSourcePath = async (imagePath: string, modelPath: string | null): Promise<string | null> => {
    const normalizedImagePath = normalizePath(imagePath)

    if (/^[a-zA-Z]:\\/.test(normalizedImagePath) || normalizedImagePath.startsWith('\\\\')) {
        return (await exists(normalizedImagePath)) ? normalizedImagePath : null
    }

    if (modelPath && !modelPath.startsWith('dropped:')) {
        const candidates = getTextureCandidatePaths(modelPath, normalizedImagePath)
        for (const candidate of candidates) {
            if (await exists(candidate)) {
                return candidate
            }
        }
    }

    return null
}

const buildStoredTexture = (texture: any, fileName: string): Record<string, any> => {
    const storedTexture = cloneValue(texture || {})
    storedTexture.Image = fileName
    storedTexture.ReplaceableId = 0
    delete storedTexture.__editorId
    return storedTexture
}

const exportTextureToPresetDir = async (
    texture: any,
    modelPath: string | null,
    presetDir: string,
): Promise<{ fileName: string; sourceImagePath: string; texture: Record<string, any> }> => {
    const sourceImagePath = resolveTextureImagePath(texture)
    if (!sourceImagePath) {
        throw new Error('当前粒子没有可导出的贴图')
    }

    const baseName = sanitizeSegment(withoutFileExtension(sourceImagePath)) || 'texture'
    const ext = getFileExtension(sourceImagePath)
    const fileName = `${baseName}.${ext}`
    const targetPath = `${presetDir}\\${fileName}`

    const localSourcePath = await findLocalTextureSourcePath(sourceImagePath, modelPath)
    if (localSourcePath) {
        await copyFileByReadWrite(localSourcePath, targetPath)
        return {
            fileName,
            sourceImagePath,
            texture: buildStoredTexture(texture, fileName),
        }
    }

    const decodeResult = await decodeTexture(sourceImagePath, modelPath || '')
    if (!decodeResult.imageData) {
        throw new Error(`无法导出贴图: ${sourceImagePath}`)
    }

    const bytes = await encodeImageDataToBytes(sourceImagePath, decodeResult.imageData)
    await writeFile(targetPath, bytes)

    return {
        fileName,
        sourceImagePath,
        texture: buildStoredTexture(texture, fileName),
    }
}

const readPresetManifest = async (presetId: string): Promise<ParticleEmitter2Preset | null> => {
    try {
        const presetDir = await getPresetDir(presetId)
        const manifestPath = `${presetDir}\\${PRESET_MANIFEST_FILE}`
        const content = await readTextFile(manifestPath)
        const parsed = JSON.parse(content) as ParticleEmitter2Preset
        if (!parsed?.id || !parsed?.name || !parsed?.emitter) {
            return null
        }
        return parsed
    } catch {
        return null
    }
}

const updateCurrentModelTextures = (nextTextures: any[]): void => {
    useModelStore.setState((state: any) => {
        if (!state.modelData) {
            return state
        }

        const nextModelData = {
            ...state.modelData,
            Textures: nextTextures,
        }

        const nextState: Record<string, any> = {
            modelData: nextModelData,
        }

        if (state.activeTabId) {
            nextState.tabs = state.tabs.map((tab: any) => {
                if (tab.id !== state.activeTabId) {
                    return tab
                }
                return {
                    ...tab,
                    snapshot: {
                        ...tab.snapshot,
                        modelData: nextModelData,
                        modelPath: state.modelPath,
                        lastActive: Date.now(),
                    },
                }
            })
        }

        return nextState
    })
}

const syncActiveTabSnapshot = (): void => {
    useModelStore.setState((state: any) => {
        if (!state.activeTabId || !state.modelData) {
            return state
        }

        return {
            tabs: state.tabs.map((tab: any) => {
                if (tab.id !== state.activeTabId) {
                    return tab
                }

                return {
                    ...tab,
                    snapshot: {
                        ...tab.snapshot,
                        modelData: state.modelData,
                        modelPath: state.modelPath,
                        nodes: Array.isArray(state.nodes) ? cloneValue(state.nodes) : [],
                        sequences: Array.isArray(state.sequences) ? cloneValue(state.sequences) : [],
                        currentSequence: state.currentSequence,
                        currentFrame: state.currentFrame,
                        hiddenGeosetIds: Array.isArray(state.hiddenGeosetIds) ? [...state.hiddenGeosetIds] : [],
                        lastActive: Date.now(),
                    },
                }
            }),
        }
    })
}


export const listParticleEmitter2Presets = async (): Promise<ParticleEmitter2PresetSummary[]> => {
    const root = await getPresetRoot()
    const entries = await readDir(root).catch(() => [])
    const manifests = await Promise.all(
        entries
            .filter((entry) => entry.isDirectory && !!entry.name)
            .map((entry) => readPresetManifest(entry.name))
    )

    return manifests
        .filter((preset): preset is ParticleEmitter2Preset => !!preset)
        .map((preset) => ({
            id: preset.id,
            name: preset.name,
            savedAt: preset.savedAt,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export const saveParticleEmitter2Preset = async ({
    name,
    emitter,
    texture,
    modelPath,
}: SaveParticleEmitter2PresetOptions): Promise<ParticleEmitter2Preset> => {
    const trimmedName = name.trim()
    if (!trimmedName) {
        throw new Error('请输入预设名称')
    }

    const presetId = getPresetId(trimmedName)
    const presetDir = await getPresetDir(presetId)
    await remove(presetDir, { recursive: true }).catch(() => {})
    await mkdir(presetDir, { recursive: true })

    const preset: ParticleEmitter2Preset = {
        id: presetId,
        name: trimmedName,
        savedAt: new Date().toISOString(),
        emitter: (() => {
            const storedEmitter = cloneValue(emitter)
            delete (storedEmitter as any).ObjectId
            delete (storedEmitter as any).Parent
            storedEmitter.type = NodeType.PARTICLE_EMITTER_2
            return storedEmitter
        })(),
        texture: texture ? await exportTextureToPresetDir(texture, modelPath, presetDir) : null,
    }

    const manifestPath = `${presetDir}\\${PRESET_MANIFEST_FILE}`
    await writeTextFile(manifestPath, JSON.stringify(preset, null, 2))
    return preset
}

export const createParticleEmitter2FromPreset = async ({
    presetId,
    parentId,
}: CreateParticleEmitter2FromPresetOptions): Promise<{ nodeName: string }> => {
    const preset = await readPresetManifest(presetId)
    if (!preset) {
        throw new Error('未找到粒子预设')
    }

    const store = useModelStore.getState()
    if (!store.modelData) {
        throw new Error('当前没有打开模型')
    }
    if (!store.modelPath || store.modelPath.startsWith('dropped:')) {
        throw new Error('当前模型没有有效磁盘路径，无法复制预设贴图')
    }

    let nextTextureId = -1
    const currentTextures = Array.isArray(store.modelData.Textures) ? [...store.modelData.Textures] : []

    if (preset.texture) {
        const presetDir = await getPresetDir(preset.id)
        const presetTexturePath = `${presetDir}\\${preset.texture.fileName}`
        const targetDirRel = `${MODEL_IMPORT_DIR}\\${sanitizeSegment(preset.id) || sanitizeSegment(preset.name) || 'preset'}`
        const targetDirAbs = `${getDirname(store.modelPath)}\\${targetDirRel}`
        const targetFileName = getFileName(preset.texture.fileName)
        const targetTexturePath = `${targetDirAbs}\\${targetFileName}`
        const targetTextureRelPath = normalizePath(`${targetDirRel}\\${targetFileName}`)

        await mkdir(targetDirAbs, { recursive: true })
        await copyFileByReadWrite(presetTexturePath, targetTexturePath)

        const existingIndex = currentTextures.findIndex((texture: any) =>
            normalizePath(String(texture?.Image || '')) === targetTextureRelPath && Number(texture?.ReplaceableId ?? 0) === 0
        )

        if (existingIndex >= 0) {
            nextTextureId = existingIndex
        } else {
            currentTextures.push({
                ...cloneValue(preset.texture.texture),
                Image: targetTextureRelPath,
                ReplaceableId: 0,
            })
            nextTextureId = currentTextures.length - 1
        }

        updateCurrentModelTextures(currentTextures)
    }

    const nodeName = preset.name.trim() || preset.emitter.Name || 'Preset Particle'
    const presetNode = cloneValue(preset.emitter)
    delete (presetNode as any).ObjectId
    delete (presetNode as any).Parent

    useModelStore.getState().addNode({
        ...presetNode,
        type: NodeType.PARTICLE_EMITTER_2,
        Name: nodeName,
        Parent: parentId,
        TextureID: nextTextureId,
    } as any)

    syncActiveTabSnapshot()

    return { nodeName }
}
