export const normalizeGeosetIndices = (indices: number[], geosetCount: number): number[] =>
    Array.from(new Set(indices.filter((index) => Number.isInteger(index) && index >= 0 && index < geosetCount)))
        .sort((a, b) => a - b)

export const getAllGeosetIndices = (geosetCount: number): number[] =>
    Array.from({ length: Math.max(0, geosetCount) }, (_, index) => index)

export const isGeosetVisible = (
    geosetIndex: number,
    hiddenGeosetIds: number[],
    forceShowAllGeosets: boolean
): boolean => forceShowAllGeosets || !hiddenGeosetIds.includes(geosetIndex)

export const getHiddenIdsForGeosetToggle = (
    geosetIndex: number,
    geosetCount: number,
    hiddenGeosetIds: number[],
    forceShowAllGeosets: boolean
): number[] => {
    const normalizedHiddenIds = normalizeGeosetIndices(hiddenGeosetIds, geosetCount)
    const currentlyVisible = isGeosetVisible(geosetIndex, normalizedHiddenIds, forceShowAllGeosets)

    if (currentlyVisible) {
        return normalizeGeosetIndices([...normalizedHiddenIds, geosetIndex], geosetCount)
    }

    return normalizedHiddenIds.filter((id) => id !== geosetIndex)
}
