/**
 * Vertex Operations Utility Module
 * 
 * Provides core algorithms for vertex split, weld, copy, paste, and delete operations
 * in 3D geometry editing mode.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeosetData = any

/**
 * Result of a split operation - creates a NEW geoset with extracted faces
 */
export interface SplitResult {
    /** Updated original geoset with extracted faces removed */
    updatedOriginalGeoset: Partial<GeosetData>
    /** New geoset containing the extracted faces */
    newGeoset: Partial<GeosetData>
    /** Indices of faces that were extracted */
    extractedFaceIndices: number[]
}

/**
 * Result of a weld operation - just moves vertices to center point
 */
export interface WeldResult {
    /** Updated geoset with vertices moved to center */
    updatedGeoset: Partial<GeosetData>
    /** The center position where vertices were welded */
    centerPosition: [number, number, number]
}

/**
 * Result of a delete operation
 */
export interface DeleteResult {
    /** Updated geoset with vertices and their faces removed */
    updatedGeoset: Partial<GeosetData>
    /** Number of vertices removed */
    verticesRemoved: number
    /** Number of faces removed */
    facesRemoved: number
}

/**
 * Copy buffer for vertex data
 */
export interface VertexCopyBuffer {
    /** Vertex positions (xyz triplets) */
    vertices: number[]
    /** Normals (xyz triplets) */
    normals: number[]
    /** Vertex groups (indices into Groups array) */
    vertexGroups: number[]
    /** UV coordinates per layer */
    tVertices: number[][]
    /** Face indices (relative to copied vertices) */
    faces: number[]
    /** Source geoset index */
    sourceGeosetIndex: number
    /** Bone groups from source geoset */
    groups: number[][]
}

/**
 * Find all faces that use any of the specified vertices
 * @returns Set of face indices (0-based triangle index)
 */
export function findFacesUsingVertices(faces: Uint16Array | number[], vertexIndices: Set<number>): Set<number> {
    const faceIndices = new Set<number>()
    for (let i = 0; i < faces.length; i += 3) {
        if (vertexIndices.has(faces[i]) || vertexIndices.has(faces[i + 1]) || vertexIndices.has(faces[i + 2])) {
            faceIndices.add(i / 3)
        }
    }
    return faceIndices
}

/**
 * Split: Extract selected vertices and their faces into a NEW geoset
 * AND REMOVE those faces from the original geoset.
 * 
 * @param geoset The original geoset
 * @param vertexIndices Array of vertex indices to extract
 * @param materialId Material ID for the new geoset
 * @returns SplitResult with updatedOriginalGeoset (faces removed) and newGeoset (extracted faces)
 */
export function splitVertices(geoset: GeosetData, vertexIndices: number[], materialId: number = 0): SplitResult {
    const vertexSet = new Set(vertexIndices)

    // Find all faces that use any of the selected vertices
    const facesToExtract = findFacesUsingVertices(geoset.Faces, vertexSet)

    if (facesToExtract.size === 0) {
        // No faces to extract
        return {
            updatedOriginalGeoset: {},
            newGeoset: {},
            extractedFaceIndices: []
        }
    }

    // Collect all vertices used by the faces to extract
    const verticesToExtractSet = new Set<number>()
    for (const faceIdx of facesToExtract) {
        const faceStart = faceIdx * 3
        verticesToExtractSet.add(geoset.Faces[faceStart])
        verticesToExtractSet.add(geoset.Faces[faceStart + 1])
        verticesToExtractSet.add(geoset.Faces[faceStart + 2])
    }

    // Sort vertices for consistent order in new geoset
    const sortedVerticesToExtract = Array.from(verticesToExtractSet).sort((a, b) => a - b)

    // Build vertex index mapping for the NEW geoset (old index -> new index)
    const oldToNewIndex = new Map<number, number>()
    sortedVerticesToExtract.forEach((oldIdx, newIdx) => {
        oldToNewIndex.set(oldIdx, newIdx)
    })

    // === Create NEW GEOSET data ===
    const newVertices: number[] = []
    const newNormals: number[] = []
    const newVertexGroups: number[] = []
    const newTVertices: number[][] = (geoset.TVertices as Float32Array[]).map(() => [])
    const newFaces: number[] = []

    // Copy vertex data to new geoset
    for (const oldIdx of sortedVerticesToExtract) {
        newVertices.push(
            geoset.Vertices[oldIdx * 3],
            geoset.Vertices[oldIdx * 3 + 1],
            geoset.Vertices[oldIdx * 3 + 2]
        )
        newNormals.push(
            geoset.Normals[oldIdx * 3],
            geoset.Normals[oldIdx * 3 + 1],
            geoset.Normals[oldIdx * 3 + 2]
        )
        newVertexGroups.push(geoset.VertexGroup[oldIdx])

        for (let layer = 0; layer < (geoset.TVertices as Float32Array[]).length; layer++) {
            const tv = geoset.TVertices[layer] as Float32Array
            newTVertices[layer].push(tv[oldIdx * 2], tv[oldIdx * 2 + 1])
        }
    }

    // Copy faces to new geoset with remapped indices
    for (const faceIdx of facesToExtract) {
        const faceStart = faceIdx * 3
        newFaces.push(
            oldToNewIndex.get(geoset.Faces[faceStart])!,
            oldToNewIndex.get(geoset.Faces[faceStart + 1])!,
            oldToNewIndex.get(geoset.Faces[faceStart + 2])!
        )
    }

    // === Create UPDATED ORIGINAL GEOSET (faces removed) ===
    // Get remaining faces (not extracted)
    const totalFaces = geoset.Faces.length / 3
    const remainingFaceIndices: number[] = []
    for (let i = 0; i < totalFaces; i++) {
        if (!facesToExtract.has(i)) {
            remainingFaceIndices.push(i)
        }
    }

    // Find vertices that are still used by remaining faces
    const remainingVertexSet = new Set<number>()
    for (const faceIdx of remainingFaceIndices) {
        const faceStart = faceIdx * 3
        remainingVertexSet.add(geoset.Faces[faceStart])
        remainingVertexSet.add(geoset.Faces[faceStart + 1])
        remainingVertexSet.add(geoset.Faces[faceStart + 2])
    }

    // Sort remaining vertices for consistent indexing
    const sortedRemainingVertices = Array.from(remainingVertexSet).sort((a, b) => a - b)

    // Build old -> new index mapping for original geoset
    const oldToRemainingIndex = new Map<number, number>()
    sortedRemainingVertices.forEach((oldIdx, newIdx) => {
        oldToRemainingIndex.set(oldIdx, newIdx)
    })

    // Build updated original geoset data
    const updatedVertices: number[] = []
    const updatedNormals: number[] = []
    const updatedVertexGroups: number[] = []
    const updatedTVertices: number[][] = (geoset.TVertices as Float32Array[]).map(() => [])
    const updatedFaces: number[] = []

    // Copy remaining vertex data
    for (const oldIdx of sortedRemainingVertices) {
        updatedVertices.push(
            geoset.Vertices[oldIdx * 3],
            geoset.Vertices[oldIdx * 3 + 1],
            geoset.Vertices[oldIdx * 3 + 2]
        )
        updatedNormals.push(
            geoset.Normals[oldIdx * 3],
            geoset.Normals[oldIdx * 3 + 1],
            geoset.Normals[oldIdx * 3 + 2]
        )
        updatedVertexGroups.push(geoset.VertexGroup[oldIdx])

        for (let layer = 0; layer < (geoset.TVertices as Float32Array[]).length; layer++) {
            const tv = geoset.TVertices[layer] as Float32Array
            updatedTVertices[layer].push(tv[oldIdx * 2], tv[oldIdx * 2 + 1])
        }
    }

    // Remap remaining faces
    for (const faceIdx of remainingFaceIndices) {
        const faceStart = faceIdx * 3
        updatedFaces.push(
            oldToRemainingIndex.get(geoset.Faces[faceStart])!,
            oldToRemainingIndex.get(geoset.Faces[faceStart + 1])!,
            oldToRemainingIndex.get(geoset.Faces[faceStart + 2])!
        )
    }   return {
        updatedOriginalGeoset: {
            Vertices: new Float32Array(updatedVertices),
            Normals: new Float32Array(updatedNormals),
            VertexGroup: new Uint8Array(updatedVertexGroups),
            Faces: new Uint16Array(updatedFaces),
            TVertices: updatedTVertices.map(tv => new Float32Array(tv)),
            MaterialID: geoset.MaterialID
        },
        newGeoset: {
            Vertices: new Float32Array(newVertices),
            Normals: new Float32Array(newNormals),
            VertexGroup: new Uint8Array(newVertexGroups),
            Faces: new Uint16Array(newFaces),
            TVertices: newTVertices.map(tv => new Float32Array(tv)),
            MaterialID: materialId
        },
        extractedFaceIndices: Array.from(facesToExtract)
    }
}

/**
 * Weld: Move selected vertices to their center point
 * This does NOT delete vertices or merge them - just moves them to the same position.
 * UV coordinates are NOT modified.
 * 
 * @param geoset The geoset to modify
 * @param vertexIndices Array of vertex indices to weld
 * @returns WeldResult with updated geoset and center position
 */
export function weldVertices(geoset: GeosetData, vertexIndices: number[]): WeldResult {
    if (vertexIndices.length < 2) {
        throw new Error('Weld requires at least 2 vertices')
    }

    // Calculate center position
    let centerX = 0, centerY = 0, centerZ = 0
    for (const idx of vertexIndices) {
        centerX += geoset.Vertices[idx * 3]
        centerY += geoset.Vertices[idx * 3 + 1]
        centerZ += geoset.Vertices[idx * 3 + 2]
    }
    centerX /= vertexIndices.length
    centerY /= vertexIndices.length
    centerZ /= vertexIndices.length

    // Create a copy of vertices array and update positions
    const vertices = new Float32Array(geoset.Vertices)
    for (const idx of vertexIndices) {
        vertices[idx * 3] = centerX
        vertices[idx * 3 + 1] = centerY
        vertices[idx * 3 + 2] = centerZ
    }

    // Keep everything else unchanged
    return {
        updatedGeoset: {
            Vertices: vertices
            // Don't modify Normals, TVertices, Faces, etc.
        },
        centerPosition: [centerX, centerY, centerZ]
    }
}

/**
 * Delete: Remove selected vertices and all faces that use them
 * 
 * @param geoset The geoset to modify
 * @param vertexIndices Array of vertex indices to delete
 * @returns DeleteResult with updated geoset
 */
export function deleteVertices(geoset: GeosetData, vertexIndices: number[]): DeleteResult {
    const vertexSet = new Set(vertexIndices)

    // Find faces to remove (any face using a deleted vertex)
    const facesToRemove = findFacesUsingVertices(geoset.Faces, vertexSet)

    // Find vertices still used after face removal
    const remainingFaces: number[] = []
    const usedVertices = new Set<number>()

    for (let i = 0; i < geoset.Faces.length / 3; i++) {
        if (!facesToRemove.has(i)) {
            const faceStart = i * 3
            remainingFaces.push(
                geoset.Faces[faceStart],
                geoset.Faces[faceStart + 1],
                geoset.Faces[faceStart + 2]
            )
            usedVertices.add(geoset.Faces[faceStart])
            usedVertices.add(geoset.Faces[faceStart + 1])
            usedVertices.add(geoset.Faces[faceStart + 2])
        }
    }

    // Build index remap
    const oldToNew = new Map<number, number>()
    let newIndex = 0
    const sortedUsed = Array.from(usedVertices).sort((a, b) => a - b)
    for (const oldIdx of sortedUsed) {
        oldToNew.set(oldIdx, newIndex++)
    }

    // Build new arrays
    const newVertices: number[] = []
    const newNormals: number[] = []
    const newVertexGroups: number[] = []
    const newTVertices: number[][] = (geoset.TVertices as Float32Array[]).map(() => [])

    for (const oldIdx of sortedUsed) {
        newVertices.push(
            geoset.Vertices[oldIdx * 3],
            geoset.Vertices[oldIdx * 3 + 1],
            geoset.Vertices[oldIdx * 3 + 2]
        )
        newNormals.push(
            geoset.Normals[oldIdx * 3],
            geoset.Normals[oldIdx * 3 + 1],
            geoset.Normals[oldIdx * 3 + 2]
        )
        newVertexGroups.push(geoset.VertexGroup[oldIdx])

        for (let layer = 0; layer < (geoset.TVertices as Float32Array[]).length; layer++) {
            const tv = geoset.TVertices[layer] as Float32Array
            newTVertices[layer].push(tv[oldIdx * 2], tv[oldIdx * 2 + 1])
        }
    }

    // Remap face indices
    const newFaces = remainingFaces.map(idx => oldToNew.get(idx)!)

    const vertexCount = geoset.Vertices.length / 3

    return {
        updatedGeoset: {
            Vertices: new Float32Array(newVertices),
            Normals: new Float32Array(newNormals),
            VertexGroup: new Uint8Array(newVertexGroups),
            Faces: new Uint16Array(newFaces),
            TVertices: newTVertices.map(tv => new Float32Array(tv))
        },
        verticesRemoved: vertexCount - sortedUsed.length,
        facesRemoved: facesToRemove.size
    }
}

/**
 * Copy selected vertices and their faces to a buffer
 * 
 * @param geoset The source geoset
 * @param vertexIndices Selected vertex indices
 * @param geosetIndex Source geoset index
 * @returns VertexCopyBuffer
 */
export function copyVertices(geoset: GeosetData, vertexIndices: number[], geosetIndex: number): VertexCopyBuffer {
    const vertexSet = new Set(vertexIndices)

    // Find all faces that use these vertices
    const facesToCopy = findFacesUsingVertices(geoset.Faces, vertexSet)

    // Collect all vertices used by these faces
    const verticesToCopySet = new Set<number>()
    for (const faceIdx of facesToCopy) {
        const faceStart = faceIdx * 3
        verticesToCopySet.add(geoset.Faces[faceStart])
        verticesToCopySet.add(geoset.Faces[faceStart + 1])
        verticesToCopySet.add(geoset.Faces[faceStart + 2])
    }

    // Sort for consistent order
    const sortedVerticesToCopy = Array.from(verticesToCopySet).sort((a, b) => a - b)

    // Build mapping
    const oldToNew = new Map<number, number>()
    sortedVerticesToCopy.forEach((oldIdx, newIdx) => {
        oldToNew.set(oldIdx, newIdx)
    })

    const vertices: number[] = []
    const normals: number[] = []
    const vertexGroups: number[] = []
    const tVertices: number[][] = (geoset.TVertices as Float32Array[]).map(() => [])
    const faces: number[] = []

    for (const oldIdx of sortedVerticesToCopy) {
        vertices.push(
            geoset.Vertices[oldIdx * 3],
            geoset.Vertices[oldIdx * 3 + 1],
            geoset.Vertices[oldIdx * 3 + 2]
        )
        normals.push(
            geoset.Normals[oldIdx * 3],
            geoset.Normals[oldIdx * 3 + 1],
            geoset.Normals[oldIdx * 3 + 2]
        )
        vertexGroups.push(geoset.VertexGroup[oldIdx])

        for (let layer = 0; layer < (geoset.TVertices as Float32Array[]).length; layer++) {
            const tv = geoset.TVertices[layer] as Float32Array
            tVertices[layer].push(tv[oldIdx * 2], tv[oldIdx * 2 + 1])
        }
    }

    for (const faceIdx of facesToCopy) {
        const faceStart = faceIdx * 3
        faces.push(
            oldToNew.get(geoset.Faces[faceStart])!,
            oldToNew.get(geoset.Faces[faceStart + 1])!,
            oldToNew.get(geoset.Faces[faceStart + 2])!
        )
    }

    return {
        vertices,
        normals,
        vertexGroups,
        tVertices,
        faces,
        sourceGeosetIndex: geosetIndex,
        groups: geoset.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]]
    }
}

/**
 * Paste copied vertices into a geoset
 * 
 * @param geoset The target geoset
 * @param buffer The copy buffer
 * @param offset Position offset for pasted vertices
 * @returns Updated geoset with pasted vertices
 */
export function pasteVertices(
    geoset: GeosetData,
    buffer: VertexCopyBuffer,
    offset: [number, number, number] = [10, 0, 0]
): { updatedGeoset: Partial<GeosetData>; newVertexStartIndex: number; newFaceStartIndex: number } {
    const existingVertexCount = geoset.Vertices.length / 3

    // Append vertices with offset
    const newVertices: number[] = Array.from(geoset.Vertices as Float32Array)
    for (let i = 0; i < buffer.vertices.length; i += 3) {
        newVertices.push(
            buffer.vertices[i] + offset[0],
            buffer.vertices[i + 1] + offset[1],
            buffer.vertices[i + 2] + offset[2]
        )
    }

    // Append normals
    const newNormals: number[] = Array.from(geoset.Normals as Float32Array)
    newNormals.push(...buffer.normals)

    // Append vertex groups
    const newVertexGroups: number[] = Array.from(geoset.VertexGroup as Uint8Array)
    newVertexGroups.push(...buffer.vertexGroups)

    // Append UVs
    const newTVertices: number[][] = []
    for (let layer = 0; layer < (geoset.TVertices as Float32Array[]).length; layer++) {
        const existing: number[] = Array.from(geoset.TVertices[layer] as Float32Array)
        if (buffer.tVertices[layer]) {
            existing.push(...buffer.tVertices[layer])
        } else {
            // Fill with zeros if layer doesn't exist in buffer
            for (let i = 0; i < buffer.vertices.length / 3; i++) {
                existing.push(0, 0)
            }
        }
        newTVertices.push(existing)
    }

    // Append faces with offset indices
    const faceCount = geoset.Faces.length / 3
    const newFaces: number[] = Array.from(geoset.Faces as Uint16Array)
    for (const faceIdx of buffer.faces) {
        newFaces.push(faceIdx + existingVertexCount)
    }

    return {
        updatedGeoset: {
            Vertices: new Float32Array(newVertices),
            Normals: new Float32Array(newNormals),
            VertexGroup: new Uint8Array(newVertexGroups),
            Faces: new Uint16Array(newFaces),
            TVertices: newTVertices.map(tv => new Float32Array(tv))
        },
        newVertexStartIndex: existingVertexCount,
        newFaceStartIndex: faceCount
    }
}

/**
 * Copy selected faces directly to a buffer
 * Unlike copyVertices (which expands to complete faces), this takes specific face indices.
 * 
 * @param geoset The source geoset
 * @param faceIndices Selected face indices
 * @param geosetIndex Source geoset index
 * @returns VertexCopyBuffer
 */
export function copyFaces(geoset: GeosetData, faceIndices: number[], geosetIndex: number): VertexCopyBuffer {
    const faceSet = new Set(faceIndices)

    // Collect all vertices used by these faces
    const verticesToCopySet = new Set<number>()

    for (const faceIdx of faceSet) {
        const faceStart = faceIdx * 3
        verticesToCopySet.add(geoset.Faces[faceStart])
        verticesToCopySet.add(geoset.Faces[faceStart + 1])
        verticesToCopySet.add(geoset.Faces[faceStart + 2])
    }

    // Sort for consistent order
    const sortedVerticesToCopy = Array.from(verticesToCopySet).sort((a, b) => a - b)

    // Build mapping
    const oldToNew = new Map<number, number>()
    sortedVerticesToCopy.forEach((oldIdx, newIdx) => {
        oldToNew.set(oldIdx, newIdx)
    })

    const vertices: number[] = []
    const normals: number[] = []
    const vertexGroups: number[] = []
    const tVertices: number[][] = (geoset.TVertices as Float32Array[]).map(() => [])
    const faces: number[] = []

    for (const oldIdx of sortedVerticesToCopy) {
        vertices.push(
            geoset.Vertices[oldIdx * 3],
            geoset.Vertices[oldIdx * 3 + 1],
            geoset.Vertices[oldIdx * 3 + 2]
        )
        normals.push(
            geoset.Normals[oldIdx * 3],
            geoset.Normals[oldIdx * 3 + 1],
            geoset.Normals[oldIdx * 3 + 2]
        )
        vertexGroups.push(geoset.VertexGroup[oldIdx])

        for (let layer = 0; layer < (geoset.TVertices as Float32Array[]).length; layer++) {
            const tv = geoset.TVertices[layer] as Float32Array
            tVertices[layer].push(tv[oldIdx * 2], tv[oldIdx * 2 + 1])
        }
    }

    for (const faceIdx of faceSet) {
        const faceStart = faceIdx * 3
        faces.push(
            oldToNew.get(geoset.Faces[faceStart])!,
            oldToNew.get(geoset.Faces[faceStart + 1])!,
            oldToNew.get(geoset.Faces[faceStart + 2])!
        )
    }

    return {
        vertices,
        normals,
        vertexGroups,
        tVertices,
        faces,
        sourceGeosetIndex: geosetIndex,
        groups: geoset.Groups ? JSON.parse(JSON.stringify(geoset.Groups)) : [[0]]
    }
}
