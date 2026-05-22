const cloneDeep = <T>(value: T): T => {
    if (ArrayBuffer.isView(value)) {
        const Ctor = (value as any).constructor
        return new Ctor(value as any) as T
    }
    if (Array.isArray(value)) {
        return value.map((item) => cloneDeep(item)) as T
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, any>).map(([key, nestedValue]) => [key, cloneDeep(nestedValue)])
        ) as T
    }
    return value
}

export const cloneGeosetAnims = (geosetAnims: readonly any[] | null | undefined): any[] =>
    Array.isArray(geosetAnims) ? geosetAnims.map((anim) => cloneDeep(anim)) : []

export const remapGeosetAnimsAfterRemovingGeosets = (
    geosetAnims: readonly any[] | null | undefined,
    removedGeosetIndices: readonly number[]
): any[] => {
    return remapGeosetAnimsWithIndexMapAfterRemovingGeosets(geosetAnims, removedGeosetIndices).geosetAnims
}

export const remapGeosetAnimsWithIndexMapAfterRemovingGeosets = (
    geosetAnims: readonly any[] | null | undefined,
    removedGeosetIndices: readonly number[]
): { geosetAnims: any[]; geosetAnimIndexMap: Map<number, number> } => {
    const removedIndices = Array.from(
        new Set(removedGeosetIndices.filter((index) => Number.isInteger(index) && index >= 0))
    ).sort((a, b) => a - b)

    if (removedIndices.length === 0) {
        const geosetAnimsSnapshot = cloneGeosetAnims(geosetAnims)
        return {
            geosetAnims: geosetAnimsSnapshot,
            geosetAnimIndexMap: new Map(geosetAnimsSnapshot.map((_anim, index) => [index, index]))
        }
    }

    const removedSet = new Set(removedIndices)
    const usedGeosetIds = new Set<number>()
    const nextGeosetAnims: any[] = []
    const geosetAnimIndexMap = new Map<number, number>()

    for (const [oldIndex, anim] of cloneGeosetAnims(geosetAnims).entries()) {
        const geosetId = anim?.GeosetId
        if (typeof geosetId !== 'number' || geosetId < 0) {
            geosetAnimIndexMap.set(oldIndex, nextGeosetAnims.length)
            nextGeosetAnims.push(anim)
            continue
        }

        if (removedSet.has(geosetId)) {
            continue
        }

        const removedBefore = removedIndices.reduce((count, removedIndex) => (
            removedIndex < geosetId ? count + 1 : count
        ), 0)
        const nextGeosetId = geosetId - removedBefore
        if (usedGeosetIds.has(nextGeosetId)) {
            continue
        }
        usedGeosetIds.add(nextGeosetId)
        geosetAnimIndexMap.set(oldIndex, nextGeosetAnims.length)
        nextGeosetAnims.push({
            ...anim,
            GeosetId: nextGeosetId
        })
    }

    return { geosetAnims: nextGeosetAnims, geosetAnimIndexMap }
}

export const syncRendererGeosetAnims = (renderer: any, geosetAnims: readonly any[]): any[] => {
    const nextGeosetAnims = cloneGeosetAnims(geosetAnims)
    if (!renderer?.model) return nextGeosetAnims

    renderer.model.GeosetAnims = nextGeosetAnims
    if (renderer.model.Info && typeof renderer.model.Info === 'object') {
        renderer.model.Info.NumGeosetAnims = nextGeosetAnims.length
    }
    renderer.modelInstance?.syncGeosetAnims?.()
    return nextGeosetAnims
}
