export const MATERIAL_TEXTURE_REF_KEYS = [
    'TextureID',
    'NormalTextureID',
    'ORMTextureID',
    'EmissiveTextureID',
    'TeamColorTextureID',
    'ReflectionsTextureID',
] as const

export function cloneStructured<T>(value: T): T {
    try {
        return structuredClone(value)
    } catch {
        return JSON.parse(JSON.stringify(value))
    }
}

export function remapTextureRefWithMap(value: any, oldToNew: Map<number, number>): any {
    if (value === undefined || value === null) return value

    if (typeof value === 'number') {
        return oldToNew.has(value) ? oldToNew.get(value)! : value
    }

    if (typeof value === 'object' && Array.isArray(value.Keys)) {
        const clonedValue = cloneStructured(value)
        clonedValue.Keys = clonedValue.Keys.map((key: any) => {
            const nextKey = cloneStructured(key)
            const vector = nextKey?.Vector
            const oldId = ArrayBuffer.isView(vector) ? vector[0] : (Array.isArray(vector) ? vector[0] : undefined)
            if (typeof oldId !== 'number' || !oldToNew.has(oldId)) {
                return nextKey
            }
            const nextId = oldToNew.get(oldId)!
            if (ArrayBuffer.isView(vector)) {
                vector[0] = nextId
            } else if (Array.isArray(vector)) {
                vector[0] = nextId
            }
            return nextKey
        })
        return clonedValue
    }

    return value
}

export function remapTextureRefAfterRemoval(value: any, removedIndex: number, fallbackIndex: number): any {
    if (value === undefined || value === null) return value

    if (typeof value === 'number') {
        if (value === removedIndex) return fallbackIndex
        if (value > removedIndex) return value - 1
        return value
    }

    if (typeof value === 'object' && Array.isArray(value.Keys)) {
        const clonedValue = cloneStructured(value)
        clonedValue.Keys = clonedValue.Keys.map((key: any) => {
            if (!key?.Vector || key.Vector[0] === undefined) {
                return key
            }
            const nextKey = cloneStructured(key)
            const nextVector = ArrayBuffer.isView(nextKey.Vector)
                ? Array.from(nextKey.Vector as ArrayLike<number>)
                : Array.isArray(nextKey.Vector)
                    ? [...nextKey.Vector]
                    : [nextKey.Vector[0]]
            nextVector[0] = remapTextureRefAfterRemoval(nextVector[0], removedIndex, fallbackIndex)
            nextKey.Vector = nextVector
            return nextKey
        })
        return clonedValue
    }

    return value
}

export function remapMaterialsAfterTextureRemoval(materials: any[], removedIndex: number, nextTextureCount: number): any[] {
    const fallbackIndex = nextTextureCount > 0
        ? Math.min(removedIndex, nextTextureCount - 1)
        : 0

    return (Array.isArray(materials) ? materials : []).map((material: any) => {
        const nextMaterial = cloneStructured(material)
        if (!Array.isArray(nextMaterial?.Layers)) {
            return nextMaterial
        }

        nextMaterial.Layers = nextMaterial.Layers.map((layer: any) => {
            const nextLayer = cloneStructured(layer)
            for (const key of MATERIAL_TEXTURE_REF_KEYS) {
                if (nextLayer?.[key] !== undefined) {
                    nextLayer[key] = remapTextureRefAfterRemoval(nextLayer[key], removedIndex, fallbackIndex)
                }
            }
            return nextLayer
        })

        return nextMaterial
    })
}

export function buildTextureDefinitionSignature(textures: any[] | undefined | null): string {
    if (!Array.isArray(textures)) return '[]'
    return JSON.stringify(textures.map((texture) => ({
        image: texture?.Image ?? '',
        replaceableId: texture?.ReplaceableId ?? 0,
        flags: texture?.Flags ?? 0,
    })))
}

export function buildMaterialLayerTopologySignature(materials: any[] | undefined | null): string {
    if (!Array.isArray(materials)) return '[]'
    return JSON.stringify(materials.map((material) => ({
        priorityPlane: material?.PriorityPlane ?? 0,
        renderMode: material?.RenderMode ?? 0,
        layerCount: Array.isArray(material?.Layers) ? material.Layers.length : 0,
        layers: (Array.isArray(material?.Layers) ? material.Layers : []).map((layer: any) => ({
            textureMode: typeof layer?.TextureID === 'object' ? 'anim' : 'static',
            extraTextureModes: MATERIAL_TEXTURE_REF_KEYS.slice(1).map((key) => typeof layer?.[key] === 'object' ? 'anim' : 'static'),
            hasAlphaAnim: typeof layer?.Alpha === 'object',
            hasTextureAnim: layer?.TVertexAnimId !== undefined && layer?.TVertexAnimId !== null,
        })),
    })))
}
