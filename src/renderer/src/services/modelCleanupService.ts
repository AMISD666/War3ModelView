/**
 * Model Cleanup Service
 * 提供模型数据清理功能
 */

// war3-model doesn't export type definitions, use any
type Model = any
type Material = any
type Layer = any
type AnimVector = any

export interface CleanupResult {
    success: boolean
    removed: number
    message: string
}

/**
 * 深度比较两个对象是否相等
 */
function deepEqual(a: any, b: any): boolean {
    if (a === b) return true
    if (a == null || b == null) return a === b
    if (typeof a !== typeof b) return false

    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false
        return a.every((val, i) => deepEqual(val, b[i]))
    }

    // TypedArray comparison
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
        const aArr = a as any
        const bArr = b as any
        if (aArr.length !== bArr.length) return false
        for (let i = 0; i < aArr.length; i++) {
            if (aArr[i] !== bArr[i]) return false
        }
        return true
    }

    if (typeof a === 'object') {
        const keysA = Object.keys(a)
        const keysB = Object.keys(b)
        if (keysA.length !== keysB.length) return false
        return keysA.every(key => deepEqual(a[key], b[key]))
    }

    return false
}

/**
 * 比较两个 AnimVector 是否相等
 */
function animVectorEqual(a: AnimVector | number | undefined, b: AnimVector | number | undefined): boolean {
    if (a === b) return true
    if (typeof a === 'number' && typeof b === 'number') return a === b
    if (typeof a !== typeof b) return false
    if (a == null || b == null) return a === b

    const aVec = a as AnimVector
    const bVec = b as AnimVector

    if (aVec.LineType !== bVec.LineType) return false
    if (aVec.GlobalSeqId !== bVec.GlobalSeqId) return false
    if (!aVec.Keys || !bVec.Keys) return aVec.Keys === bVec.Keys
    if (aVec.Keys.length !== bVec.Keys.length) return false

    for (let i = 0; i < aVec.Keys.length; i++) {
        const keyA = aVec.Keys[i]
        const keyB = bVec.Keys[i]
        if (keyA.Frame !== keyB.Frame) return false
        if (!deepEqual(keyA.Vector, keyB.Vector)) return false
        if (!deepEqual(keyA.InTan, keyB.InTan)) return false
        if (!deepEqual(keyA.OutTan, keyB.OutTan)) return false
    }

    return true
}

/**
 * 比较两个 Layer 是否完全相等
 */
function layerEqual(a: Layer, b: Layer): boolean {
    if (a.FilterMode !== b.FilterMode) return false
    if (a.Shading !== b.Shading) return false
    if (a.CoordId !== b.CoordId) return false
    if (a.TVertexAnimId !== b.TVertexAnimId) return false

    if (!animVectorEqual(a.TextureID, b.TextureID)) return false
    if (!animVectorEqual(a.Alpha, b.Alpha)) return false
    if (!animVectorEqual(a.EmissiveGain, b.EmissiveGain)) return false
    if (!animVectorEqual(a.FresnelOpacity, b.FresnelOpacity)) return false
    if (!animVectorEqual(a.FresnelTeamColor, b.FresnelTeamColor)) return false
    if (!deepEqual(a.FresnelColor, b.FresnelColor)) return false

    // Reforged textures
    if (!animVectorEqual(a.NormalTextureID, b.NormalTextureID)) return false
    if (!animVectorEqual(a.ORMTextureID, b.ORMTextureID)) return false
    if (!animVectorEqual(a.EmissiveTextureID, b.EmissiveTextureID)) return false
    if (!animVectorEqual(a.TeamColorTextureID, b.TeamColorTextureID)) return false
    if (!animVectorEqual(a.ReflectionsTextureID, b.ReflectionsTextureID)) return false

    return true
}

/**
 * 比较两个 Material 是否完全相等
 */
function materialEqual(a: Material, b: Material): boolean {
    if (a.PriorityPlane !== b.PriorityPlane) return false
    if (a.RenderMode !== b.RenderMode) return false
    if (a.Shader !== b.Shader) return false

    if (!a.Layers || !b.Layers) return a.Layers === b.Layers
    if (a.Layers.length !== b.Layers.length) return false

    for (let i = 0; i < a.Layers.length; i++) {
        if (!layerEqual(a.Layers[i], b.Layers[i])) return false
    }

    return true
}

/**
 * 功能1: 合并相同的材质
 * 将完全相同的材质合并为一个，并更新所有引用
 */
export function mergeSameMaterials(model: Model): CleanupResult {
    if (!model.Materials || model.Materials.length === 0) {
        return { success: true, removed: 0, message: '没有材质需要合并' }
    }

    const originalCount = model.Materials.length

    // 找出重复的材质，建立映射关系
    // oldIndex -> newIndex (保留的索引)
    const oldToKept = new Map<number, number>()

    for (let i = 0; i < model.Materials.length; i++) {
        let foundDuplicate = false
        for (let j = 0; j < i; j++) {
            if (materialEqual(model.Materials[i], model.Materials[j])) {
                oldToKept.set(i, j)
                foundDuplicate = true
                break
            }
        }
        if (!foundDuplicate) {
            oldToKept.set(i, i)
        }
    }

    // 找出要保留的索引
    const keptIndices = [...new Set(oldToKept.values())].sort((a, b) => a - b)

    if (keptIndices.length === originalCount) {
        return { success: true, removed: 0, message: '没有发现重复的材质' }
    }

    // 创建最终的索引映射 (旧索引 -> 新索引)
    const keptToNew = new Map<number, number>()
    keptIndices.forEach((oldIdx, newIdx) => keptToNew.set(oldIdx, newIdx))

    const oldToNew = new Map<number, number>()
    for (const [oldIdx, keptIdx] of oldToKept.entries()) {
        oldToNew.set(oldIdx, keptToNew.get(keptIdx)!)
    }

    // 更新 Geosets 的 MaterialID
    if (model.Geosets) {
        for (const geoset of model.Geosets) {
            if (geoset.MaterialID !== undefined && oldToNew.has(geoset.MaterialID)) {
                geoset.MaterialID = oldToNew.get(geoset.MaterialID)!
            }
        }
    }

    // 更新 RibbonEmitters 的 MaterialID
    if (model.RibbonEmitters) {
        for (const ribbon of model.RibbonEmitters) {
            if (ribbon.MaterialID !== undefined && oldToNew.has(ribbon.MaterialID)) {
                ribbon.MaterialID = oldToNew.get(ribbon.MaterialID)!
            }
        }
    }

    // 删除重复材质
    model.Materials = keptIndices.map(i => model.Materials[i])

    const removedCount = originalCount - model.Materials.length
    return {
        success: true,
        removed: removedCount,
        message: `已合并 ${removedCount} 个重复材质`
    }
}

/**
 * 功能2: 清理未使用的材质
 */
export function cleanUnusedMaterials(model: Model): CleanupResult {
    if (!model.Materials || model.Materials.length === 0) {
        return { success: true, removed: 0, message: '没有材质需要清理' }
    }

    const originalCount = model.Materials.length

    // 收集所有使用的 MaterialID
    const usedIds = new Set<number>()

    if (model.Geosets) {
        for (const geoset of model.Geosets) {
            if (geoset.MaterialID !== undefined) {
                usedIds.add(geoset.MaterialID)
            }
        }
    }

    if (model.RibbonEmitters) {
        for (const ribbon of model.RibbonEmitters) {
            if (ribbon.MaterialID !== undefined) {
                usedIds.add(ribbon.MaterialID)
            }
        }
    }

    // 如果所有材质都在使用
    if (usedIds.size === originalCount) {
        return { success: true, removed: 0, message: '所有材质都在使用中' }
    }

    // 创建索引映射
    const oldToNew = new Map<number, number>()
    let newIndex = 0
    for (let i = 0; i < originalCount; i++) {
        if (usedIds.has(i)) {
            oldToNew.set(i, newIndex++)
        }
    }

    // 更新引用
    if (model.Geosets) {
        for (const geoset of model.Geosets) {
            if (geoset.MaterialID !== undefined && oldToNew.has(geoset.MaterialID)) {
                geoset.MaterialID = oldToNew.get(geoset.MaterialID)!
            }
        }
    }

    if (model.RibbonEmitters) {
        for (const ribbon of model.RibbonEmitters) {
            if (ribbon.MaterialID !== undefined && oldToNew.has(ribbon.MaterialID)) {
                ribbon.MaterialID = oldToNew.get(ribbon.MaterialID)!
            }
        }
    }

    // 删除未使用的材质
    model.Materials = model.Materials.filter((_: any, i: number) => usedIds.has(i))

    const removedCount = originalCount - model.Materials.length
    return {
        success: true,
        removed: removedCount,
        message: `已清理 ${removedCount} 个未使用的材质`
    }
}

/**
 * 从 AnimVector 或数字中提取所有 TextureID
 */
function collectTextureIdsFromAnimVector(value: AnimVector | number | undefined, ids: Set<number>): void {
    if (value === undefined) return
    if (typeof value === 'number') {
        if (value >= 0) ids.add(value)
        return
    }
    if (value.Keys) {
        for (const key of value.Keys) {
            if (key.Vector && key.Vector[0] !== undefined && key.Vector[0] >= 0) {
                ids.add(key.Vector[0] as number)
            }
        }
    }
}

/**
 * 功能3: 清理未使用的贴图
 */
export function cleanUnusedTextures(model: Model): CleanupResult {
    if (!model.Textures || model.Textures.length === 0) {
        return { success: true, removed: 0, message: '没有贴图需要清理' }
    }

    const originalCount = model.Textures.length

    // 收集所有使用的 TextureID
    const usedIds = new Set<number>()

    // 从材质层收集
    if (model.Materials) {
        for (const material of model.Materials) {
            if (material.Layers) {
                for (const layer of material.Layers) {
                    collectTextureIdsFromAnimVector(layer.TextureID, usedIds)
                    // Reforged 纹理
                    collectTextureIdsFromAnimVector(layer.NormalTextureID, usedIds)
                    collectTextureIdsFromAnimVector(layer.ORMTextureID, usedIds)
                    collectTextureIdsFromAnimVector(layer.EmissiveTextureID, usedIds)
                    collectTextureIdsFromAnimVector(layer.TeamColorTextureID, usedIds)
                    collectTextureIdsFromAnimVector(layer.ReflectionsTextureID, usedIds)
                }
            }
        }
    }

    // 从粒子发射器收集
    if (model.ParticleEmitters2) {
        for (const emitter of model.ParticleEmitters2) {
            if (emitter.TextureID !== undefined && emitter.TextureID >= 0) {
                usedIds.add(emitter.TextureID)
            }
        }
    }

    // 保留替换贴图 (如团队色)
    for (let i = 0; i < model.Textures.length; i++) {
        const tex = model.Textures[i]
        if (tex.ReplaceableId && tex.ReplaceableId > 0) {
            usedIds.add(i)
        }
    }

    // 如果所有贴图都在使用
    if (usedIds.size === originalCount) {
        return { success: true, removed: 0, message: '所有贴图都在使用中' }
    }

    // 创建索引映射
    const oldToNew = new Map<number, number>()
    let newIndex = 0
    for (let i = 0; i < originalCount; i++) {
        if (usedIds.has(i)) {
            oldToNew.set(i, newIndex++)
        }
    }

    // 更新材质层中的 TextureID 引用
    const updateTextureRef = (value: AnimVector | number | undefined): AnimVector | number | undefined => {
        if (value === undefined) return undefined
        if (typeof value === 'number') {
            return oldToNew.has(value) ? oldToNew.get(value)! : value
        }
        // AnimVector
        if (value.Keys) {
            for (const key of value.Keys) {
                if (key.Vector && key.Vector[0] !== undefined) {
                    const oldId = key.Vector[0] as number
                    if (oldToNew.has(oldId)) {
                        (key.Vector as Int32Array)[0] = oldToNew.get(oldId)!
                    }
                }
            }
        }
        return value
    }

    if (model.Materials) {
        for (const material of model.Materials) {
            if (material.Layers) {
                for (const layer of material.Layers) {
                    layer.TextureID = updateTextureRef(layer.TextureID)
                    layer.NormalTextureID = updateTextureRef(layer.NormalTextureID)
                    layer.ORMTextureID = updateTextureRef(layer.ORMTextureID)
                    layer.EmissiveTextureID = updateTextureRef(layer.EmissiveTextureID)
                    layer.TeamColorTextureID = updateTextureRef(layer.TeamColorTextureID)
                    layer.ReflectionsTextureID = updateTextureRef(layer.ReflectionsTextureID)
                }
            }
        }
    }

    // 更新粒子发射器的 TextureID
    if (model.ParticleEmitters2) {
        for (const emitter of model.ParticleEmitters2) {
            if (emitter.TextureID !== undefined && oldToNew.has(emitter.TextureID)) {
                emitter.TextureID = oldToNew.get(emitter.TextureID)!
            }
        }
    }

    // 删除未使用的贴图
    model.Textures = model.Textures.filter((_: any, i: number) => usedIds.has(i))

    const removedCount = originalCount - model.Textures.length
    return {
        success: true,
        removed: removedCount,
        message: `已清理 ${removedCount} 个未使用的贴图`
    }
}
