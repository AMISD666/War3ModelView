import { buildTargetAssetPath, getDirname, isAbsoluteWindowsPath, normalizeWindowsPath } from '../../utils/windowsPath'
import { desktopGateway } from '../../infrastructure/desktop'
import { getTextureCandidatePaths, normalizeTexturePath } from '../../infrastructure/texture'
import { remapTextureRefWithMap } from '../../utils/materialTextureRelations'
import { calculateGeosetExtent, calculateModelExtent } from '../../utils/geometryUtils'
import {
    appendClipboardGlobalSequences,
    buildClipboardGlobalSequencePayload,
    remapGlobalSequenceReferencesInPlace,
} from './globalSequenceClipboard'

type GeosetClipboardPayload = {
    sourceModelPath: string | null
    geosets: any[]
    sourceGeosetIndices: number[]
    geosetAnims?: Record<number, any>
    textures?: Record<number, any>
    materials?: Record<number, any>
    textureAnims?: Record<number, any>
    globalSequences?: Record<number, number>
    resourcePaths?: string[]
}

export type GeosetPasteResult = {
    pasted: boolean
    copiedCount: number
    failed: string[]
    appendedGeosetIndices: number[]
}

const MATERIAL_TEXTURE_REF_KEYS = [
    'TextureID',
    'NormalTextureID',
    'ORMTextureID',
    'EmissiveTextureID',
    'TeamColorTextureID',
    'ReflectionsTextureID',
] as const

const deepClone = <T,>(value: T): T => {
    const sc = (globalThis as { structuredClone?: <U>(input: U) => U }).structuredClone
    if (typeof sc === 'function') return sc(value)
    return JSON.parse(JSON.stringify(value))
}

const collectTextureIdsFromAnimVector = (value: any, ids: Set<number>): void => {
    if (value === undefined || value === null) return
    if (typeof value === 'number') {
        if (value >= 0) ids.add(value)
        return
    }
    if (value && typeof value === 'object' && Array.isArray(value.Keys)) {
        for (const key of value.Keys) {
            const vector = key?.Vector
            const id = ArrayBuffer.isView(vector)
                ? (vector as unknown as ArrayLike<number>)[0]
                : (Array.isArray(vector) ? vector[0] : undefined)
            if (typeof id === 'number' && id >= 0) ids.add(id)
        }
    }
}

const findExistingTextureIndex = (textures: any[], tex: any): number => {
    const image = tex?.Image ?? tex?.image
    const replaceableId = tex?.ReplaceableId ?? tex?.replaceableId
    const wrapW = tex?.WrapWidth ?? tex?.wrapWidth
    const wrapH = tex?.WrapHeight ?? tex?.wrapHeight
    const flags = tex?.Flags ?? tex?.flags

    for (let i = 0; i < textures.length; i += 1) {
        const current = textures[i]
        if (!current) continue
        if (
            (current?.Image ?? current?.image) === image &&
            (current?.ReplaceableId ?? current?.replaceableId) === replaceableId &&
            (current?.WrapWidth ?? current?.wrapWidth) === wrapW &&
            (current?.WrapHeight ?? current?.wrapHeight) === wrapH &&
            (current?.Flags ?? current?.flags) === flags
        ) {
            return i
        }
    }

    return -1
}

const getClipboardTexturePath = (texture: any): string | null => {
    if (!texture || typeof texture !== 'object') return null
    const replaceableId = Number(texture?.ReplaceableId ?? texture?.replaceableId ?? 0)
    if (replaceableId > 0) return null
    const image = texture?.Image ?? texture?.Path ?? texture?.image ?? texture?.path
    if (typeof image !== 'string') return null
    const normalized = normalizeTexturePath(image)
    return normalized || null
}

const collectClipboardResourcePaths = (payload: GeosetClipboardPayload | null | undefined): string[] => {
    if (!payload) return []
    const paths = new Map<string, string>()
    const addPath = (value: unknown) => {
        if (typeof value !== 'string') return
        const normalized = normalizeTexturePath(value)
        if (!normalized) return
        paths.set(normalized.toLowerCase(), normalized)
    }

    Object.values(payload.textures ?? {}).forEach((texture) => addPath(getClipboardTexturePath(texture)))
    ;(payload.resourcePaths ?? []).forEach(addPath)

    return Array.from(paths.values())
}

const copyClipboardAssetsForPaste = async (
    payload: GeosetClipboardPayload | null | undefined,
    targetModelPath: string | null | undefined,
): Promise<Omit<GeosetPasteResult, 'pasted' | 'appendedGeosetIndices'>> => {
    const sourceModelPath = payload?.sourceModelPath ?? null
    if (!sourceModelPath || !targetModelPath || sourceModelPath.startsWith('dropped:') || targetModelPath.startsWith('dropped:')) {
        return { copiedCount: 0, failed: [] }
    }

    const sourceModelDir = getDirname(sourceModelPath)
    const targetModelDir = getDirname(targetModelPath)
    if (!sourceModelDir || !targetModelDir) {
        return { copiedCount: 0, failed: [] }
    }

    const normalizedSourceDir = normalizeWindowsPath(sourceModelDir).replace(/[\\/]+$/, '').toLowerCase()
    const normalizedTargetDir = normalizeWindowsPath(targetModelDir).replace(/[\\/]+$/, '').toLowerCase()
    if (normalizedSourceDir === normalizedTargetDir) {
        return { copiedCount: 0, failed: [] }
    }

    let copiedCount = 0
    const failed: string[] = []
    const copiedTargets = new Set<string>()

    for (const resourcePath of collectClipboardResourcePaths(payload)) {
        const normalizedResourcePath = normalizeTexturePath(resourcePath)
        if (!normalizedResourcePath || isAbsoluteWindowsPath(normalizedResourcePath)) continue

        let sourceAssetPath: string | null = null
        for (const candidate of getTextureCandidatePaths(sourceModelPath, normalizedResourcePath)) {
            if (await desktopGateway.exists(candidate).catch(() => false)) {
                sourceAssetPath = candidate
                break
            }
        }

        if (!sourceAssetPath) continue

        const targetAssetPath = buildTargetAssetPath(targetModelDir, normalizedResourcePath)
        const targetKey = normalizeWindowsPath(targetAssetPath).toLowerCase()
        if (copiedTargets.has(targetKey)) continue
        copiedTargets.add(targetKey)

        try {
            await desktopGateway.createDir(getDirname(targetAssetPath), { recursive: true })
            if (!(await desktopGateway.exists(targetAssetPath).catch(() => false))) {
                const data = await desktopGateway.readFile(sourceAssetPath)
                await desktopGateway.writeFile(targetAssetPath, data)
                copiedCount += 1
            }
        } catch {
            failed.push(normalizedResourcePath)
        }
    }

    return { copiedCount, failed }
}

const createSparseRecord = <T,>(): Record<number, T> => ({})

const collectMaterialDependencies = (
    modelData: any,
    materialId: number,
    payload: {
        textures: Record<number, any>
        materials: Record<number, any>
        textureAnims: Record<number, any>
        resourcePaths: string[]
    },
): void => {
    if (materialId < 0) return
    const material = modelData?.Materials?.[materialId]
    if (!material || payload.materials[materialId] !== undefined) return

    payload.materials[materialId] = material
    const layers = material?.Layers ?? material?.layers
    if (!Array.isArray(layers)) return

    const addResourcePath = (path: any) => {
        if (typeof path !== 'string') return
        const normalized = normalizeTexturePath(path)
        if (!normalized) return
        if (!payload.resourcePaths.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
            payload.resourcePaths.push(normalized)
        }
    }

    for (const layer of layers) {
        for (const key of MATERIAL_TEXTURE_REF_KEYS) {
            const ids = new Set<number>()
            collectTextureIdsFromAnimVector(layer?.[key], ids)
            ids.forEach((textureId) => {
                if (payload.textures[textureId] !== undefined) return
                const texture = modelData?.Textures?.[textureId]
                if (!texture) return
                payload.textures[textureId] = texture
                addResourcePath(getClipboardTexturePath(texture))
            })
        }

        const textureAnimId = layer?.TVertexAnimId ?? layer?.TextureAnimationId ?? layer?.TextureAnimId
        if (typeof textureAnimId === 'number' && textureAnimId >= 0 && payload.textureAnims[textureAnimId] === undefined) {
            const anim = modelData?.TextureAnims?.[textureAnimId]
            if (anim) payload.textureAnims[textureAnimId] = anim
        }
    }
}

const getAllModelNodes = (modelData: any): any[] => [
    ...(Array.isArray(modelData?.Bones) ? modelData.Bones : []),
    ...(Array.isArray(modelData?.Helpers) ? modelData.Helpers : []),
    ...(Array.isArray(modelData?.Lights) ? modelData.Lights : []),
    ...(Array.isArray(modelData?.Attachments) ? modelData.Attachments : []),
    ...(Array.isArray(modelData?.ParticleEmitters) ? modelData.ParticleEmitters : []),
    ...(Array.isArray(modelData?.ParticleEmitters2) ? modelData.ParticleEmitters2 : []),
    ...(Array.isArray(modelData?.RibbonEmitters) ? modelData.RibbonEmitters : []),
    ...(Array.isArray(modelData?.EventObjects) ? modelData.EventObjects : []),
    ...(Array.isArray(modelData?.CollisionShapes) ? modelData.CollisionShapes : []),
]

const remapGeosetGroupsByNodeName = (geoset: any, sourceModelData: any, targetModelData: any): void => {
    if (!Array.isArray(geoset?.Groups)) return

    const sourceIdToName = new Map<number, string>()
    getAllModelNodes(sourceModelData).forEach((node: any) => {
        if (typeof node?.ObjectId === 'number' && typeof node?.Name === 'string') {
            sourceIdToName.set(node.ObjectId, node.Name)
        }
    })

    const targetNameToId = new Map<string, number>()
    getAllModelNodes(targetModelData).forEach((node: any) => {
        if (typeof node?.Name === 'string' && typeof node?.ObjectId === 'number' && !targetNameToId.has(node.Name)) {
            targetNameToId.set(node.Name, node.ObjectId)
        }
    })

    geoset.Groups = geoset.Groups.map((group: unknown) => {
        if (!Array.isArray(group)) return []
        return group.map((objectId) => {
            const name = sourceIdToName.get(Number(objectId))
            if (!name) return 0
            return targetNameToId.get(name) ?? 0
        })
    })
    geoset.TotalGroupsCount = geoset.Groups.reduce((sum: number, group: number[]) => sum + group.length, 0)
}

export const buildGeosetClipboardPayload = (
    sourceModelData: any,
    sourceModelPath: string | null,
    geosetIndices: number[],
): GeosetClipboardPayload | null => {
    if (!sourceModelData || !Array.isArray(sourceModelData.Geosets)) return null

    const normalizedIndices = Array.from(new Set(geosetIndices.filter((index) => Number.isInteger(index) && index >= 0)))
        .filter((index) => index < sourceModelData.Geosets.length)
        .sort((a, b) => a - b)
    if (normalizedIndices.length === 0) return null

    const geosets = normalizedIndices.map((index) => deepClone(sourceModelData.Geosets[index]))
    const textures = createSparseRecord<any>()
    const materials = createSparseRecord<any>()
    const textureAnims = createSparseRecord<any>()
    const geosetAnims = createSparseRecord<any>()
    const resourcePaths: string[] = []

    normalizedIndices.forEach((geosetIndex, clipboardIndex) => {
        const sourceGeoset = sourceModelData.Geosets[geosetIndex]
        const materialId = Number(sourceGeoset?.MaterialID)
        if (Number.isFinite(materialId)) {
            collectMaterialDependencies(sourceModelData, materialId, {
                textures,
                materials,
                textureAnims,
                resourcePaths,
            })
        }

        const sourceAnim = Array.isArray(sourceModelData.GeosetAnims)
            ? sourceModelData.GeosetAnims.find((anim: any) => Number(anim?.GeosetId) === geosetIndex)
            : null
        if (sourceAnim) {
            geosetAnims[clipboardIndex] = deepClone(sourceAnim)
        }
    })

    const globalSequences = buildClipboardGlobalSequencePayload({
        node: { geosets, geosetAnims: Object.values(geosetAnims) },
        modelData: sourceModelData,
        materials,
        textureAnims,
    })

    return {
        sourceModelPath,
        geosets,
        sourceGeosetIndices: normalizedIndices,
        ...(Object.keys(geosetAnims).length > 0 ? { geosetAnims } : {}),
        ...(Object.keys(textures).length > 0 ? { textures } : {}),
        ...(Object.keys(materials).length > 0 ? { materials } : {}),
        ...(Object.keys(textureAnims).length > 0 ? { textureAnims } : {}),
        ...(globalSequences ? { globalSequences } : {}),
        ...(resourcePaths.length > 0 ? { resourcePaths } : {}),
    }
}

export const pasteGeosetClipboardPayload = async (input: {
    payload: GeosetClipboardPayload | null
    targetModelData: any
    targetModelPath: string | null
}): Promise<{ modelData: any; result: GeosetPasteResult }> => {
    const { payload, targetModelData, targetModelPath } = input
    if (!payload || !targetModelData) {
        return {
            modelData: targetModelData,
            result: { pasted: false, copiedCount: 0, failed: [], appendedGeosetIndices: [] },
        }
    }

    const assetCopy = await copyClipboardAssetsForPaste(payload, targetModelPath)
    const nextModelData = deepClone(targetModelData)
    const targetTextures: any[] = Array.isArray(nextModelData.Textures) ? [...nextModelData.Textures] : []
    const targetMaterials: any[] = Array.isArray(nextModelData.Materials) ? [...nextModelData.Materials] : []
    const targetTextureAnims: any[] = Array.isArray(nextModelData.TextureAnims) ? [...nextModelData.TextureAnims] : []
    const targetGeosets: any[] = Array.isArray(nextModelData.Geosets) ? [...nextModelData.Geosets] : []
    const targetGeosetAnims: any[] = Array.isArray(nextModelData.GeosetAnims) ? [...nextModelData.GeosetAnims] : []
    const { globalSequences: targetGlobalSequences, oldToNew: globalSeqOldToNew } = appendClipboardGlobalSequences(
        nextModelData.GlobalSequences,
        payload.globalSequences,
    )

    const texOldToNew = new Map<number, number>()
    const tvOldToNew = new Map<number, number>()
    const matOldToNew = new Map<number, number>()

    if (payload.textureAnims) {
        const ids = Object.keys(payload.textureAnims).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
        for (const oldId of ids) {
            const clonedAnim = deepClone(payload.textureAnims[oldId])
            remapGlobalSequenceReferencesInPlace(clonedAnim, globalSeqOldToNew)
            const newId = targetTextureAnims.length
            targetTextureAnims.push(clonedAnim)
            tvOldToNew.set(oldId, newId)
        }
    }

    if (payload.textures) {
        const ids = Object.keys(payload.textures).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
        for (const oldId of ids) {
            const texture = payload.textures[oldId]
            const existingIndex = findExistingTextureIndex(targetTextures, texture)
            if (existingIndex >= 0) {
                texOldToNew.set(oldId, existingIndex)
            } else {
                const newId = targetTextures.length
                targetTextures.push(deepClone(texture))
                texOldToNew.set(oldId, newId)
            }
        }
    }

    if (payload.materials) {
        const ids = Object.keys(payload.materials).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
        for (const oldId of ids) {
            const material = deepClone(payload.materials[oldId])
            remapGlobalSequenceReferencesInPlace(material, globalSeqOldToNew)
            const layers = material?.Layers ?? material?.layers
            if (Array.isArray(layers)) {
                for (const layer of layers) {
                    for (const key of MATERIAL_TEXTURE_REF_KEYS) {
                        if (layer?.[key] !== undefined) {
                            layer[key] = remapTextureRefWithMap(layer[key], texOldToNew)
                        }
                    }
                    const oldTv = layer?.TVertexAnimId ?? layer?.TextureAnimationId ?? layer?.TextureAnimId
                    if (typeof oldTv === 'number' && tvOldToNew.has(oldTv)) {
                        layer.TVertexAnimId = tvOldToNew.get(oldTv)
                    }
                }
            }
            const newId = targetMaterials.length
            targetMaterials.push(material)
            matOldToNew.set(oldId, newId)
        }
    }

    const sourceModelDataForGroupRemap = {
        ...payload,
        Geosets: payload.geosets,
    }
    const appendedGeosetIndices: number[] = []

    payload.geosets.forEach((sourceGeoset, clipboardIndex) => {
        const geoset = deepClone(sourceGeoset)
        const oldMaterialId = Number(geoset?.MaterialID)
        if (Number.isFinite(oldMaterialId) && matOldToNew.has(oldMaterialId)) {
            geoset.MaterialID = matOldToNew.get(oldMaterialId)
        }
        remapGeosetGroupsByNodeName(geoset, sourceModelDataForGroupRemap, nextModelData)
        calculateGeosetExtent(geoset)
        appendedGeosetIndices.push(targetGeosets.length)
        targetGeosets.push(geoset)

        const sourceAnim = payload.geosetAnims?.[clipboardIndex]
        if (sourceAnim) {
            const clonedAnim = deepClone(sourceAnim)
            clonedAnim.GeosetId = targetGeosets.length - 1
            remapGlobalSequenceReferencesInPlace(clonedAnim, globalSeqOldToNew)
            targetGeosetAnims.push(clonedAnim)
        }
    })

    nextModelData.Textures = targetTextures
    nextModelData.Materials = targetMaterials
    nextModelData.TextureAnims = targetTextureAnims
    nextModelData.Geosets = targetGeosets
    nextModelData.GeosetAnims = targetGeosetAnims
    nextModelData.GlobalSequences = targetGlobalSequences

    if (nextModelData.Model && typeof nextModelData.Model === 'object') {
        nextModelData.Model = {
            ...nextModelData.Model,
            NumGeosets: targetGeosets.length,
            NumGeosetAnims: targetGeosetAnims.length,
        }
    }

    calculateModelExtent(nextModelData)

    return {
        modelData: nextModelData,
        result: {
            pasted: appendedGeosetIndices.length > 0,
            copiedCount: assetCopy.copiedCount,
            failed: assetCopy.failed,
            appendedGeosetIndices,
        },
    }
}
