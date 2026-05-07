export const MAX_SAFE_GEOSET_VERTICES = 4000

type NumericArray = ArrayLike<number>
type MutableGeoset = Record<string, unknown>
type NumericArrayCtor<T extends NumericArray> = new (source: ArrayLike<number>) => T
type Vec2 = [number, number]
type Vec3 = [number, number, number]

type SplitChunk = {
    faceIndices: number[]
    vertexIndices: Set<number>
}

const isTypedArray = (value: unknown): value is NumericArray =>
    ArrayBuffer.isView(value)

const isFiniteNumericValue = (value: unknown): boolean =>
    Number.isFinite(Number(value))

const isVec2 = (value: unknown): value is Vec2 =>
    Array.isArray(value) && value.length >= 2 && isFiniteNumericValue(value[0]) && isFiniteNumericValue(value[1])

const isVec3 = (value: unknown): value is Vec3 =>
    Array.isArray(value) && value.length >= 3 && isFiniteNumericValue(value[0]) && isFiniteNumericValue(value[1]) && isFiniteNumericValue(value[2])

const isVec2Array = (value: unknown): value is Vec2[] =>
    Array.isArray(value) && value.length > 0 && isVec2(value[0])

const isVec3Array = (value: unknown): value is Vec3[] =>
    Array.isArray(value) && value.length > 0 && isVec3(value[0])

const cloneTypedArray = <T extends ArrayLike<number>>(value: T | undefined | null): T | null => {
    if (!value) return null
    const Ctor = value.constructor as NumericArrayCtor<T>
    return new Ctor(value) as T
}

const cloneArrayData = (value: unknown): unknown[] =>
    structuredClone(value) as unknown[]

const toNumericArray = (value: unknown): NumericArray | undefined => {
    if (ArrayBuffer.isView(value)) return value as unknown as NumericArray
    if (Array.isArray(value) && !Array.isArray(value[0])) return value as NumericArray
    return undefined
}

const toNumericArrays = (value: unknown): NumericArray[] =>
    Array.isArray(value) ? value.map((item) => toNumericArray(item) ?? []) : []

const cloneJsonValue = (value: unknown): unknown =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value))

const cloneVertexData = (value: unknown, fallback: NumericArray): unknown => {
    if (ArrayBuffer.isView(value)) return cloneTypedArray(value as unknown as NumericArray)
    if (Array.isArray(value)) return cloneArrayData(value)
    return fallback
}

export const cloneGeoset = (geoset: MutableGeoset | null | undefined): MutableGeoset => ({
    ...geoset,
    Vertices: cloneVertexData(geoset?.Vertices, new Float32Array()),
    Normals: cloneVertexData(geoset?.Normals, new Float32Array()),
    VertexGroup: cloneTypedArray(toNumericArray(geoset?.VertexGroup)) ?? new Uint8Array(),
    Faces: cloneTypedArray(toNumericArray(geoset?.Faces)) ?? new Uint16Array(),
    TVertices: Array.isArray(geoset?.TVertices)
        ? geoset.TVertices.map((tv) => cloneVertexData(tv, new Float32Array()))
        : [],
    Tangents: cloneTypedArray(toNumericArray(geoset?.Tangents)),
    SkinWeights: cloneTypedArray(toNumericArray(geoset?.SkinWeights)),
    Groups: geoset?.Groups ? cloneJsonValue(geoset.Groups) : [[0]],
    MinimumExtent: Array.isArray(geoset?.MinimumExtent) ? [...geoset.MinimumExtent] : geoset?.MinimumExtent,
    MaximumExtent: Array.isArray(geoset?.MaximumExtent) ? [...geoset.MaximumExtent] : geoset?.MaximumExtent,
    Anims: geoset?.Anims ? cloneJsonValue(geoset.Anims) : geoset?.Anims
})

export const cloneGeosets = (geosets: MutableGeoset[]): MutableGeoset[] => geosets.map((geoset) => cloneGeoset(geoset))

export const getGeosetVertexCount = (geoset: MutableGeoset | null | undefined): number => {
    if (isVec3Array(geoset?.Vertices)) return geoset.Vertices.length
    return Math.floor((toNumericArray(geoset?.Vertices)?.length || 0) / 3)
}

const getFaceCount = (geoset: MutableGeoset | null | undefined): number =>
    Math.floor((toNumericArray(geoset?.Faces)?.length || 0) / 3)

const getFaceVertexIndices = (faces: NumericArray, faceIndex: number): [number, number, number] => {
    const base = faceIndex * 3
    return [Number(faces[base]), Number(faces[base + 1]), Number(faces[base + 2])]
}

const getValidFaceVertices = (geoset: MutableGeoset, faceIndex: number, vertexCount: number): number[] => {
    const faces = toNumericArray(geoset.Faces)
    if (!faces) return []
    const [i0, i1, i2] = getFaceVertexIndices(faces, faceIndex)
    return [i0, i1, i2].filter((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)
}

const buildFaceChunks = (sourceGeoset: MutableGeoset, maxVertices: number, vertexCount: number): SplitChunk[] => {
    const faceCount = getFaceCount(sourceGeoset)
    if (faceCount <= 0) return []

    const chunks: SplitChunk[] = []
    let currentFaces: number[] = []
    let currentVertices = new Set<number>()

    const flushChunk = () => {
        if (currentFaces.length === 0) return
        chunks.push({
            faceIndices: currentFaces,
            vertexIndices: new Set(currentVertices)
        })
        currentFaces = []
        currentVertices = new Set<number>()
    }

    for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
        const faceVertices = getValidFaceVertices(sourceGeoset, faceIndex, vertexCount)
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
    return chunks
}

const appendUnreferencedVertices = (chunks: SplitChunk[], vertexCount: number, maxVertices: number): void => {
    const assignedVertices = new Set<number>()
    for (const chunk of chunks) {
        for (const vertexIndex of chunk.vertexIndices) {
            assignedVertices.add(vertexIndex)
        }
    }

    let targetChunk = chunks.find((chunk) => chunk.vertexIndices.size < maxVertices)
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
        if (assignedVertices.has(vertexIndex)) continue
        if (!targetChunk || targetChunk.vertexIndices.size >= maxVertices) {
            targetChunk = { faceIndices: [], vertexIndices: new Set<number>() }
            chunks.push(targetChunk)
        }
        targetChunk.vertexIndices.add(vertexIndex)
    }
}

const readNumber = (values: ArrayLike<number> | undefined, index: number, fallback: number): number => {
    const value = values?.[index]
    return Number.isFinite(Number(value)) ? Number(value) : fallback
}

const readVec3 = (value: unknown, index: number, fallback: Vec3): Vec3 => {
    if (isVec3Array(value)) {
        const source = value[index]
        return [
            Number(source?.[0] ?? fallback[0]),
            Number(source?.[1] ?? fallback[1]),
            Number(source?.[2] ?? fallback[2]),
        ]
    }
    const flat = toNumericArray(value)
    return [
        readNumber(flat, index * 3, fallback[0]),
        readNumber(flat, index * 3 + 1, fallback[1]),
        readNumber(flat, index * 3 + 2, fallback[2]),
    ]
}

const readVec2 = (value: unknown, index: number, fallback: Vec2): Vec2 => {
    if (isVec2Array(value)) {
        const source = value[index]
        return [
            Number(source?.[0] ?? fallback[0]),
            Number(source?.[1] ?? fallback[1]),
        ]
    }
    const flat = toNumericArray(value)
    return [
        readNumber(flat, index * 2, fallback[0]),
        readNumber(flat, index * 2 + 1, fallback[1]),
    ]
}

const buildVec3Output = (source: unknown, values: number[]): unknown => {
    if (isVec3Array(source)) {
        const result: Vec3[] = []
        for (let i = 0; i + 2 < values.length; i += 3) {
            result.push([values[i], values[i + 1], values[i + 2]])
        }
        return result
    }
    return ArrayBuffer.isView(source) ? new Float32Array(values) : values
}

const buildVec2Output = (source: unknown, values: number[]): unknown => {
    if (isVec2Array(source)) {
        const result: Vec2[] = []
        for (let i = 0; i + 1 < values.length; i += 2) {
            result.push([values[i], values[i + 1]])
        }
        return result
    }
    return ArrayBuffer.isView(source) ? new Float32Array(values) : values
}

const getVertexGroupCtor = (sourceVertexGroup: unknown, vertexGroups: number[]) => {
    const maxVertexGroup = vertexGroups.reduce((max, value) => Math.max(max, Number(value) || 0), 0)
    if (sourceVertexGroup instanceof Uint16Array || maxVertexGroup > 255) return Uint16Array
    if (sourceVertexGroup instanceof Uint8Array) return Uint8Array
    return Uint8Array
}

const buildGeosetFromChunk = (sourceGeoset: MutableGeoset, chunk: SplitChunk): MutableGeoset => {
    const orderedVertices = Array.from(chunk.vertexIndices).sort((a, b) => a - b)
    const oldToNewIndex = new Map<number, number>()
    orderedVertices.forEach((oldIndex, newIndex) => oldToNewIndex.set(oldIndex, newIndex))

    const sourceVertexGroup = toNumericArray(sourceGeoset.VertexGroup)
    const sourceTangents = toNumericArray(sourceGeoset.Tangents)
    const sourceSkinWeights = toNumericArray(sourceGeoset.SkinWeights)
    const sourceTVertices = Array.isArray(sourceGeoset.TVertices) ? sourceGeoset.TVertices : []

    const vertices: number[] = []
    const normals: number[] = []
    const vertexGroups: number[] = []
    const tVertices: number[][] = sourceTVertices.map(() => [])
    const tangents: number[] = []
    const skinWeights: number[] = []
    const remappedFaces: number[] = []

    for (const oldIndex of orderedVertices) {
        vertices.push(...readVec3(sourceGeoset.Vertices, oldIndex, [0, 0, 0]))

        normals.push(...readVec3(sourceGeoset.Normals, oldIndex, [0, 0, 1]))

        vertexGroups.push(readNumber(sourceVertexGroup, oldIndex, 0))

        for (let layer = 0; layer < tVertices.length; layer++) {
            tVertices[layer].push(...readVec2(sourceTVertices[layer], oldIndex, [0, 0]))
        }

        if (sourceTangents) {
            tangents.push(
                readNumber(sourceTangents, oldIndex * 4, 0),
                readNumber(sourceTangents, oldIndex * 4 + 1, 0),
                readNumber(sourceTangents, oldIndex * 4 + 2, 0),
                readNumber(sourceTangents, oldIndex * 4 + 3, 1)
            )
        }

        if (sourceSkinWeights) {
            for (let offset = 0; offset < 8; offset++) {
                skinWeights.push(readNumber(sourceSkinWeights, oldIndex * 8 + offset, 0))
            }
        }
    }

    for (const faceIndex of chunk.faceIndices) {
        const faces = toNumericArray(sourceGeoset.Faces)
        if (!faces) continue
        const [i0, i1, i2] = getFaceVertexIndices(faces, faceIndex)
        const n0 = oldToNewIndex.get(i0)
        const n1 = oldToNewIndex.get(i1)
        const n2 = oldToNewIndex.get(i2)
        if (n0 === undefined || n1 === undefined || n2 === undefined) continue
        remappedFaces.push(n0, n1, n2)
    }

    const vertexGroupCtor = getVertexGroupCtor(sourceGeoset.VertexGroup, vertexGroups)
    const faceCtor = orderedVertices.length > 65535 ? Uint32Array : Uint16Array

    return {
        ...cloneGeoset(sourceGeoset),
        Vertices: buildVec3Output(sourceGeoset.Vertices, vertices),
        Normals: buildVec3Output(sourceGeoset.Normals, normals),
        VertexGroup: new vertexGroupCtor(vertexGroups),
        Faces: new faceCtor(remappedFaces),
        TVertices: tVertices.map((tv, index) => buildVec2Output(sourceTVertices[index], tv)),
        Tangents: isTypedArray(sourceTangents) ? new Float32Array(tangents) : undefined,
        SkinWeights: isTypedArray(sourceSkinWeights) ? new Uint8Array(skinWeights) : undefined,
    }
}

export const splitGeosetByVertexLimit = (sourceGeoset: MutableGeoset, maxVertices = MAX_SAFE_GEOSET_VERTICES): MutableGeoset[] => {
    const vertexCount = getGeosetVertexCount(sourceGeoset)
    if (vertexCount <= maxVertices) return [cloneGeoset(sourceGeoset)]

    const chunks = buildFaceChunks(sourceGeoset, maxVertices, vertexCount)
    appendUnreferencedVertices(chunks, vertexCount, maxVertices)

    if (chunks.length <= 1) return [cloneGeoset(sourceGeoset)]
    return chunks.map((chunk) => buildGeosetFromChunk(sourceGeoset, chunk))
}
