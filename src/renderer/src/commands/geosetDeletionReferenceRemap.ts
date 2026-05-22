import { remapGeosetAnimsWithIndexMapAfterRemovingGeosets } from './geosetAnimRemap'

type MutableRecord = Record<string, unknown>

const asMutableRecord = (value: unknown): MutableRecord | null =>
    value !== null && typeof value === 'object' ? value as MutableRecord : null

export const normalizeRemovedGeosetIndices = (removedGeosetIndices: readonly number[]): number[] =>
    Array.from(
        new Set(removedGeosetIndices.filter((index) => Number.isInteger(index) && index >= 0))
    ).sort((a, b) => a - b)

export const remapRemovedGeosetIndex = (
    index: unknown,
    removedGeosetIndices: readonly number[],
    nextGeosetCount: number
): number | null | undefined => {
    if (index === null || index === undefined) return index as null | undefined
    if (!Number.isInteger(index) || (index as number) < 0) return null
    if (removedGeosetIndices.includes(index as number)) return null
    const removedBefore = removedGeosetIndices.reduce((count, removedIndex) => (
        removedIndex < (index as number) ? count + 1 : count
    ), 0)
    const nextIndex = (index as number) - removedBefore
    return nextIndex >= 0 && nextIndex < nextGeosetCount ? nextIndex : null
}

export const remapHiddenGeosetIdsAfterRemovingGeosets = (
    hiddenGeosetIds: readonly number[],
    removedGeosetIndices: readonly number[],
    nextGeosetCount: number
): number[] =>
    hiddenGeosetIds
        .map((index) => remapRemovedGeosetIndex(index, removedGeosetIndices, nextGeosetCount))
        .filter((index): index is number => Number.isInteger(index))

const setModelCount = (container: unknown, key: string, value: number): void => {
    const record = asMutableRecord(container)
    if (record) record[key] = value
}

const remapBoneReferences = (
    nodes: unknown,
    removedGeosetIndices: readonly number[],
    nextGeosetCount: number,
    geosetAnimIndexMap: Map<number, number>
): unknown => {
    if (!Array.isArray(nodes)) return nodes

    return nodes.map((node) => {
        const record = asMutableRecord(node)
        if (!record) return node
        if (!('GeosetId' in record) && !('GeosetAnimId' in record)) return node

        const nextNode: MutableRecord = { ...record }
        if ('GeosetId' in nextNode) {
            nextNode.GeosetId = remapRemovedGeosetIndex(nextNode.GeosetId, removedGeosetIndices, nextGeosetCount)
        }
        if ('GeosetAnimId' in nextNode && nextNode.GeosetAnimId !== null && nextNode.GeosetAnimId !== undefined) {
            nextNode.GeosetAnimId = geosetAnimIndexMap.get(nextNode.GeosetAnimId as number) ?? null
        }
        return nextNode
    })
}

export const buildModelDataWithGeosetRemovalReferences = <T,>(
    modelData: T,
    nextGeosets: unknown[],
    removedGeosetIndices: readonly number[]
): T => {
    const sortedRemovedIndices = normalizeRemovedGeosetIndices(removedGeosetIndices)
    const source = asMutableRecord(modelData)
    if (!source) return modelData

    const { geosetAnims, geosetAnimIndexMap } = remapGeosetAnimsWithIndexMapAfterRemovingGeosets(
        Array.isArray(source.GeosetAnims) ? source.GeosetAnims : [],
        sortedRemovedIndices
    )
    const nextModelData = structuredClone({
        ...source,
        Geosets: nextGeosets,
        GeosetAnims: geosetAnims,
    }) as MutableRecord

    const nextGeosetCount = nextGeosets.length
    setModelCount(nextModelData.Model, 'NumGeosets', nextGeosetCount)
    setModelCount(nextModelData.Model, 'NumGeosetAnims', geosetAnims.length)
    setModelCount(nextModelData.Info, 'NumGeosets', nextGeosetCount)
    setModelCount(nextModelData.Info, 'NumGeosetAnims', geosetAnims.length)

    nextModelData.Bones = remapBoneReferences(
        nextModelData.Bones,
        sortedRemovedIndices,
        nextGeosetCount,
        geosetAnimIndexMap
    )
    nextModelData.Nodes = remapBoneReferences(
        nextModelData.Nodes,
        sortedRemovedIndices,
        nextGeosetCount,
        geosetAnimIndexMap
    )

    return nextModelData as T
}
