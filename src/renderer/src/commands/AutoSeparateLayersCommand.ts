import { Command } from '../utils/CommandManager'
import { extractNodesFromModel, useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { ModelData } from '../types/model'

const MAX_SAFE_GEOSET_VERTICES = 4000

type AutoSeparateLayersResult = {
    sourceGeosetCount: number
    resultGeosetCount: number
    changedGeosetCount: number
}

const cloneTypedArray = <T extends ArrayLike<number>>(value: T | undefined | null): T | null => {
    if (!value) return null
    const Ctor = (value as any).constructor
    return new Ctor(value) as T
}

const cloneGeoset = (geoset: any) => ({
    ...geoset,
    Vertices: cloneTypedArray(geoset?.Vertices) ?? new Float32Array(),
    Normals: cloneTypedArray(geoset?.Normals) ?? new Float32Array(),
    VertexGroup: cloneTypedArray(geoset?.VertexGroup) ?? new Uint8Array(),
    Faces: cloneTypedArray(geoset?.Faces) ?? new Uint16Array(),
    TVertices: Array.isArray(geoset?.TVertices)
        ? geoset.TVertices.map((tv: Float32Array | number[]) => cloneTypedArray(tv) ?? new Float32Array())
        : [],
    Tangents: cloneTypedArray(geoset?.Tangents),
    SkinWeights: cloneTypedArray(geoset?.SkinWeights),
    Groups: geoset?.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]],
    MinimumExtent: Array.isArray(geoset?.MinimumExtent) ? [...geoset.MinimumExtent] : geoset?.MinimumExtent,
    MaximumExtent: Array.isArray(geoset?.MaximumExtent) ? [...geoset.MaximumExtent] : geoset?.MaximumExtent,
    Anims: geoset?.Anims ? JSON.parse(JSON.stringify(geoset.Anims)) : geoset?.Anims
})

const cloneGeosets = (geosets: any[]) => geosets.map((geoset) => cloneGeoset(geoset))

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

const cloneGeosetAnim = (anim: any) => cloneDeep(anim)

const cloneGeosetAnims = (geosetAnims: any[]) => geosetAnims.map((anim) => cloneGeosetAnim(anim))

const remapGeosetAnims = (geosetAnims: any[], geosetIndexMap: number[][]): any[] => {
    const nextGeosetAnims: any[] = []

    for (const anim of geosetAnims) {
        const sourceGeosetId = typeof anim?.GeosetId === 'number' ? anim.GeosetId : null
        if (sourceGeosetId === null || sourceGeosetId < 0 || sourceGeosetId >= geosetIndexMap.length) {
            nextGeosetAnims.push(cloneGeosetAnim(anim))
            continue
        }

        const mappedGeosetIds = geosetIndexMap[sourceGeosetId] || []
        if (mappedGeosetIds.length === 0) {
            continue
        }

        for (const mappedGeosetId of mappedGeosetIds) {
            nextGeosetAnims.push({
                ...cloneGeosetAnim(anim),
                GeosetId: mappedGeosetId
            })
        }
    }

    return nextGeosetAnims
}

const updateHeaderCounts = (modelData: any, geosetsCount: number, geosetAnimsCount: number) => {
    if (!modelData || typeof modelData !== 'object') return
    if (!modelData.Model || typeof modelData.Model !== 'object') return
    modelData.Model = {
        ...modelData.Model,
        NumGeosets: geosetsCount,
        NumGeosetAnims: geosetAnimsCount
    }
}

const getFaceVertexIndices = (faces: Uint16Array | number[], faceIndex: number): [number, number, number] => {
    const base = faceIndex * 3
    return [Number(faces[base]), Number(faces[base + 1]), Number(faces[base + 2])]
}

const toGroupsMatrix = (groups: any): number[][] => {
    if (!Array.isArray(groups)) return []
    return groups.map((group: any) => {
        if (Array.isArray(group)) return group.map((value) => Number(value) || 0)
        if (group && Array.isArray(group.matrices)) return group.matrices.map((value: any) => Number(value) || 0)
        return []
    })
}

const compactGroups = (vertexGroupValues: number[], sourceGroups: any) => {
    const groups = toGroupsMatrix(sourceGroups)
    const used = new Set<number>()
    for (const value of vertexGroupValues) {
        used.add(Number(value) || 0)
    }

    const sorted = Array.from(used.values()).sort((a, b) => a - b)
    const remap = new Map<number, number>()
    sorted.forEach((oldId, newId) => remap.set(oldId, newId))

    const compactedVertexGroup = vertexGroupValues.map((value) => remap.get(Number(value) || 0) ?? 0)
    const compactedGroups = sorted.map((oldId) => {
        const source = groups[oldId]
        return Array.isArray(source) ? [...source] : []
    })

    return {
        vertexGroup: compactedVertexGroup,
        groups: compactedGroups,
        totalGroupsCount: compactedGroups.reduce((sum, group) => sum + group.length, 0)
    }
}

const buildGeosetFromFaces = (sourceGeoset: any, faceIndices: number[]): any => {
    const usedVertices = new Set<number>()
    for (const faceIndex of faceIndices) {
        const [i0, i1, i2] = getFaceVertexIndices(sourceGeoset.Faces, faceIndex)
        usedVertices.add(i0)
        usedVertices.add(i1)
        usedVertices.add(i2)
    }

    const orderedVertices = Array.from(usedVertices).sort((a, b) => a - b)
    const oldToNewIndex = new Map<number, number>()
    orderedVertices.forEach((oldIndex, newIndex) => oldToNewIndex.set(oldIndex, newIndex))

    const vertices: number[] = []
    const normals: number[] = []
    const vertexGroups: number[] = []
    const tVertices: number[][] = Array.isArray(sourceGeoset.TVertices)
        ? sourceGeoset.TVertices.map(() => [])
        : []
    const tangents: number[] = []
    const skinWeights: number[] = []
    const remappedFaces: number[] = []

    for (const oldIndex of orderedVertices) {
        vertices.push(
            sourceGeoset.Vertices[oldIndex * 3],
            sourceGeoset.Vertices[oldIndex * 3 + 1],
            sourceGeoset.Vertices[oldIndex * 3 + 2]
        )

        normals.push(
            sourceGeoset.Normals[oldIndex * 3],
            sourceGeoset.Normals[oldIndex * 3 + 1],
            sourceGeoset.Normals[oldIndex * 3 + 2]
        )

        vertexGroups.push(sourceGeoset.VertexGroup[oldIndex])

        for (let layer = 0; layer < tVertices.length; layer++) {
            const tv = sourceGeoset.TVertices[layer]
            tVertices[layer].push(tv[oldIndex * 2], tv[oldIndex * 2 + 1])
        }

        if (sourceGeoset.Tangents) {
            tangents.push(
                sourceGeoset.Tangents[oldIndex * 4],
                sourceGeoset.Tangents[oldIndex * 4 + 1],
                sourceGeoset.Tangents[oldIndex * 4 + 2],
                sourceGeoset.Tangents[oldIndex * 4 + 3]
            )
        }

        if (sourceGeoset.SkinWeights) {
            for (let offset = 0; offset < 8; offset++) {
                skinWeights.push(sourceGeoset.SkinWeights[oldIndex * 8 + offset])
            }
        }
    }

    for (const faceIndex of faceIndices) {
        const [i0, i1, i2] = getFaceVertexIndices(sourceGeoset.Faces, faceIndex)
        remappedFaces.push(
            oldToNewIndex.get(i0) as number,
            oldToNewIndex.get(i1) as number,
            oldToNewIndex.get(i2) as number
        )
    }

    const maxVertexGroup = vertexGroups.reduce((max, value) => Math.max(max, Number(value) || 0), 0)
    const vertexGroupCtor =
        sourceGeoset.VertexGroup?.constructor === Uint16Array || maxVertexGroup > 255
            ? Uint16Array
            : (sourceGeoset.VertexGroup?.constructor || Uint8Array)
    const preservedGroups = sourceGeoset?.Groups ? JSON.parse(JSON.stringify(sourceGeoset.Groups)) : [[0]]
    const preservedTotalGroupsCount =
        typeof sourceGeoset?.TotalGroupsCount === 'number'
            ? sourceGeoset.TotalGroupsCount
            : preservedGroups.reduce((sum: number, group: any) => sum + (Array.isArray(group) ? group.length : 0), 0)

    return {
        ...cloneGeoset(sourceGeoset),
        Vertices: new Float32Array(vertices),
        Normals: new Float32Array(normals),
        VertexGroup: new vertexGroupCtor(vertexGroups),
        Faces: new Uint16Array(remappedFaces),
        TVertices: tVertices.map((tv) => new Float32Array(tv)),
        Tangents: sourceGeoset.Tangents ? new Float32Array(tangents) : undefined,
        SkinWeights: sourceGeoset.SkinWeights ? new Uint8Array(skinWeights) : undefined,
        Groups: preservedGroups,
        TotalGroupsCount: preservedTotalGroupsCount
    }
}

const splitGeosetByFaceOrder = (sourceGeoset: any, maxVertices: number): any[] => {
    const vertexCount = Math.floor((sourceGeoset?.Vertices?.length || 0) / 3)
    if (vertexCount <= maxVertices) return [cloneGeoset(sourceGeoset)]

    const faceCount = Math.floor((sourceGeoset?.Faces?.length || 0) / 3)
    if (faceCount <= 0) return [cloneGeoset(sourceGeoset)]

    const chunks: number[][] = []
    let currentFaces: number[] = []
    let currentVertices = new Set<number>()

    const flushChunk = () => {
        if (currentFaces.length === 0) return
        chunks.push(currentFaces)
        currentFaces = []
        currentVertices = new Set<number>()
    }

    for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
        const [i0, i1, i2] = getFaceVertexIndices(sourceGeoset.Faces, faceIndex)
        const faceVertices = [i0, i1, i2]
        const nextVertices = new Set(currentVertices)
        for (const vertexIndex of faceVertices) {
            nextVertices.add(vertexIndex)
        }

        if (currentFaces.length > 0 && nextVertices.size > maxVertices) {
            flushChunk()
            for (const vertexIndex of faceVertices) {
                currentVertices.add(vertexIndex)
            }
            currentFaces.push(faceIndex)
            continue
        }

        currentVertices = nextVertices
        currentFaces.push(faceIndex)
    }

    flushChunk()

    if (chunks.length <= 1) return [cloneGeoset(sourceGeoset)]
    return chunks.map((faceIndices) => buildGeosetFromFaces(sourceGeoset, faceIndices))
}

export class AutoSeparateLayersCommand implements Command {
    name = 'Auto Separate Layers'

    private renderer: any
    private originalGeosetsSnapshot: any[] | null = null
    private originalGeosetAnimsSnapshot: any[] | null = null
    private separatedGeosetsSnapshot: any[] | null = null
    private separatedGeosetAnimsSnapshot: any[] | null = null
    public lastResult: AutoSeparateLayersResult | null = null

    constructor(renderer: any) {
        this.renderer = renderer
    }

    execute(): void {
        const modelStore = useModelStore.getState()
        const sourceGeosets = modelStore.modelData?.Geosets as any[] | undefined
        const sourceGeosetAnims = (modelStore.modelData?.GeosetAnims as any[] | undefined) || []
        if (!sourceGeosets) return

        if (this.separatedGeosetsSnapshot && this.separatedGeosetAnimsSnapshot) {
            this.lastResult = {
                sourceGeosetCount: this.originalGeosetsSnapshot?.length || this.separatedGeosetsSnapshot.length,
                resultGeosetCount: this.separatedGeosetsSnapshot.length,
                changedGeosetCount: Math.max(0, this.separatedGeosetsSnapshot.length - (this.originalGeosetsSnapshot?.length || 0))
            }
            useSelectionStore.getState().clearAllSelections()
            this.syncToStore(this.separatedGeosetsSnapshot, this.separatedGeosetAnimsSnapshot)
            return
        }

        this.originalGeosetsSnapshot = cloneGeosets(sourceGeosets)
        this.originalGeosetAnimsSnapshot = cloneGeosetAnims(sourceGeosetAnims)

        const nextGeosets: any[] = []
        const geosetIndexMap: number[][] = []
        let changedGeosetCount = 0
        for (const [sourceGeosetIndex, geoset] of this.originalGeosetsSnapshot.entries()) {
            const splitGeosets = splitGeosetByFaceOrder(geoset, MAX_SAFE_GEOSET_VERTICES)
            if (splitGeosets.length > 1) {
                changedGeosetCount++
            }
            geosetIndexMap[sourceGeosetIndex] = []
            for (const splitGeoset of splitGeosets) {
                geosetIndexMap[sourceGeosetIndex].push(nextGeosets.length)
                nextGeosets.push(splitGeoset)
            }
        }

        const nextGeosetAnims = remapGeosetAnims(this.originalGeosetAnimsSnapshot, geosetIndexMap)

        this.separatedGeosetsSnapshot = cloneGeosets(nextGeosets)
        this.separatedGeosetAnimsSnapshot = cloneGeosetAnims(nextGeosetAnims)
        this.lastResult = {
            sourceGeosetCount: this.originalGeosetsSnapshot.length,
            resultGeosetCount: nextGeosets.length,
            changedGeosetCount
        }
        useSelectionStore.getState().clearAllSelections()
        this.syncToStore(this.separatedGeosetsSnapshot, this.separatedGeosetAnimsSnapshot)
    }

    undo(): void {
        if (!this.originalGeosetsSnapshot || !this.originalGeosetAnimsSnapshot) return
        this.syncToStore(this.originalGeosetsSnapshot, this.originalGeosetAnimsSnapshot)
    }

    private syncToStore(geosetsSnapshot: any[], geosetAnimsSnapshot: any[]): void {
        useModelStore.setState((state) => {
            if (!state.modelData) {
                return state
            }

            const nextModelData = {
                ...state.modelData,
                Geosets: cloneGeosets(geosetsSnapshot) as any,
                GeosetAnims: cloneGeosetAnims(geosetAnimsSnapshot) as any,
                __forceFullReload: true
            } as ModelData & { __forceFullReload?: boolean }

            updateHeaderCounts(nextModelData, nextModelData.Geosets?.length || 0, nextModelData.GeosetAnims?.length || 0)

            const nextNodes = extractNodesFromModel(nextModelData as ModelData)
            const nextGeosetCount = nextModelData.Geosets?.length || 0
            const validHiddenGeosetIds = (state.hiddenGeosetIds || []).filter(
                (index) => index >= 0 && index < nextGeosetCount
            )

            return {
                modelData: nextModelData,
                nodes: nextNodes,
                hiddenGeosetIds: validHiddenGeosetIds,
                selectedGeosetIndex: null,
                selectedGeosetIndices: [],
                rendererReloadTrigger: state.rendererReloadTrigger + 1
            }
        })
    }
}



