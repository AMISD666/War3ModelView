import type { SelectionId } from '../store/selectionStore'
import type { Geoset } from '../types/geoset'
import type { ModelData } from '../types/model'

const getGeosetMatrixGroup = (geoset: Geoset | null | undefined, vertexIndex: number): number[] => {
    if (!geoset?.VertexGroup || !geoset.Groups) {
        return []
    }

    const matrixGroupIndex = Number(geoset.VertexGroup[vertexIndex])
    if (!Number.isInteger(matrixGroupIndex) || matrixGroupIndex < 0 || matrixGroupIndex >= geoset.Groups.length) {
        return []
    }

    const matrixGroup = geoset.Groups[matrixGroupIndex]
    return Array.isArray(matrixGroup) ? matrixGroup : []
}

export const collectBoundNodeIds = (
    modelData: ModelData | null | undefined,
    selectedVertexIds: SelectionId[]
): number[] => {
    if (!modelData?.Geosets || selectedVertexIds.length === 0) {
        return []
    }

    const collectedIds: number[] = []
    const seenIds = new Set<number>()

    selectedVertexIds.forEach((selection) => {
        const geoset = modelData.Geosets?.[selection.geosetIndex]
        const matrixGroup = getGeosetMatrixGroup(geoset, selection.index)

        matrixGroup.forEach((nodeId) => {
            const normalizedNodeId = Number(nodeId)
            if (!Number.isFinite(normalizedNodeId) || seenIds.has(normalizedNodeId)) {
                return
            }
            seenIds.add(normalizedNodeId)
            collectedIds.push(normalizedNodeId)
        })
    })

    return collectedIds
}
