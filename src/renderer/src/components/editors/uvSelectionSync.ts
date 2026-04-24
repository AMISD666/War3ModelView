import type { SelectionId } from '../../store/selectionStore'

export interface UVSelection {
    geosetIndex: number
    indices: number[]
}

export const buildUVSelectionsFromModelSelection = (
    modelData: any,
    selectedVertexIds: SelectionId[],
    selectedFaceIds: SelectionId[]
): UVSelection[] => {
    const selectionMap = new Map<number, Set<number>>()

    const addVertexIndex = (geosetIndex: number, index: number) => {
        if (!Number.isInteger(geosetIndex) || geosetIndex < 0 || !Number.isInteger(index) || index < 0) {
            return
        }

        const existing = selectionMap.get(geosetIndex)
        if (existing) {
            existing.add(index)
            return
        }

        selectionMap.set(geosetIndex, new Set([index]))
    }

    selectedVertexIds.forEach(({ geosetIndex, index }) => {
        addVertexIndex(geosetIndex, index)
    })

    selectedFaceIds.forEach(({ geosetIndex, index }) => {
        const geoset = modelData?.Geosets?.[geosetIndex]
        const faces = geoset?.Faces
        if (!faces) {
            return
        }

        const faceOffset = index * 3
        addVertexIndex(geosetIndex, Number(faces[faceOffset]))
        addVertexIndex(geosetIndex, Number(faces[faceOffset + 1]))
        addVertexIndex(geosetIndex, Number(faces[faceOffset + 2]))
    })

    return Array.from(selectionMap.entries())
        .sort(([leftGeoset], [rightGeoset]) => leftGeoset - rightGeoset)
        .map(([geosetIndex, indices]) => ({
            geosetIndex,
            indices: Array.from(indices).sort((leftIndex, rightIndex) => leftIndex - rightIndex)
        }))
}

export const filterUVSelectionsByGeosets = (
    selections: UVSelection[],
    visibleGeosetIds: number[]
): UVSelection[] => {
    if (visibleGeosetIds.length === 0) {
        return selections
    }

    const visibleSet = new Set(visibleGeosetIds)
    return selections.filter((selection) => visibleSet.has(selection.geosetIndex))
}

export const areUVSelectionsEqual = (left: UVSelection[], right: UVSelection[]): boolean => {
    if (left.length !== right.length) {
        return false
    }

    for (let selectionIndex = 0; selectionIndex < left.length; selectionIndex++) {
        const leftSelection = left[selectionIndex]
        const rightSelection = right[selectionIndex]
        if (leftSelection.geosetIndex !== rightSelection.geosetIndex) {
            return false
        }

        if (leftSelection.indices.length !== rightSelection.indices.length) {
            return false
        }

        for (let index = 0; index < leftSelection.indices.length; index++) {
            if (leftSelection.indices[index] !== rightSelection.indices[index]) {
                return false
            }
        }
    }

    return true
}

export const collectSelectedGeosetIndices = (
    selectedVertexIds: SelectionId[],
    selectedFaceIds: SelectionId[]
): number[] => {
    const result = new Set<number>()
    selectedVertexIds.forEach(({ geosetIndex }) => {
        if (Number.isInteger(geosetIndex) && geosetIndex >= 0) {
            result.add(geosetIndex)
        }
    })
    selectedFaceIds.forEach(({ geosetIndex }) => {
        if (Number.isInteger(geosetIndex) && geosetIndex >= 0) {
            result.add(geosetIndex)
        }
    })
    return Array.from(result).sort((leftGeoset, rightGeoset) => leftGeoset - rightGeoset)
}
