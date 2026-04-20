type LengthLike = {
    length: number
}

type MutableGeoset = {
    Vertices?: LengthLike
    Faces?: LengthLike
    Normals?: LengthLike
    TVertices?: unknown
    Anims?: unknown[]
    VertexGroup?: unknown
    Groups?: unknown
}

type MutablePreparedModel = {
    Geosets?: MutableGeoset[]
}

const hasItems = (value: unknown): value is LengthLike =>
    value != null && typeof (value as LengthLike).length === 'number' && (value as LengthLike).length > 0

const asRecord = (value: unknown): Record<string, unknown> =>
    value != null && typeof value === 'object' ? value as Record<string, unknown> : {}

const getArray = (record: Record<string, unknown>, key: string): unknown[] =>
    Array.isArray(record[key]) ? record[key] as unknown[] : []

const getLength = (value: unknown): number =>
    value != null && typeof (value as LengthLike).length === 'number' ? (value as LengthLike).length : 0

const getIndexedValue = (value: unknown, index: number): unknown =>
    value != null && (Array.isArray(value) || ArrayBuffer.isView(value))
        ? (value as Record<number, unknown>)[index]
        : undefined

const getNodeArrays = (data: Record<string, unknown>): Record<string, unknown>[] => [
    ...getArray(data, 'Bones'),
    ...getArray(data, 'Lights'),
    ...getArray(data, 'Helpers'),
    ...getArray(data, 'Attachments'),
    ...getArray(data, 'ParticleEmitters'),
    ...getArray(data, 'ParticleEmitters2'),
    ...getArray(data, 'RibbonEmitters'),
    ...getArray(data, 'EventObjects'),
    ...getArray(data, 'CollisionShapes'),
    ...getArray(data, 'ParticleEmitterPopcorns'),
].map(asRecord)

export const cleanupInvalidGeosets = (preparedData: MutablePreparedModel): void => {
    if (!preparedData.Geosets) return

    const originalCount = preparedData.Geosets.length

    preparedData.Geosets = preparedData.Geosets.filter((geoset, index) => {
        const hasVertices = hasItems(geoset.Vertices)
        const hasFaces = hasItems(geoset.Faces)
        const hasNormals = hasItems(geoset.Normals)
        const hasTv = Array.isArray(geoset.TVertices) && geoset.TVertices.length > 0

        const isValid = hasVertices && hasFaces && hasNormals && hasTv

        if (!isValid) {
            console.warn(
                `[ModelSavePreparation] Removing invalid Geoset ${index}: vertices=${geoset.Vertices?.length || 0}, faces=${geoset.Faces?.length || 0}, normals=${geoset.Normals?.length || 0}, tverts=${Array.isArray(geoset.TVertices) ? geoset.TVertices.length : 0}`
            )
        }
        return isValid
    })

    preparedData.Geosets.forEach((geoset) => {
        if (!geoset.Anims) {
            geoset.Anims = []
        }
        if (!geoset.VertexGroup) {
            geoset.VertexGroup = new Uint8Array(Math.floor((geoset.Vertices?.length || 0) / 3))
        }
        if (!geoset.Groups) {
            geoset.Groups = [[0]]
        }
    })

    if (preparedData.Geosets.length !== originalCount) {
        // Kept as an explicit branch for future telemetry without changing save behavior.
    }
}

export const validateModelData = (modelData: unknown): string[] => {
    const errors: string[] = []
    const data = asRecord(modelData)

    if (!modelData) {
        errors.push('Model data is null or undefined')
        return errors
    }

    if (typeof data.Version !== 'number' || data.Version < 800) {
        errors.push(`Invalid model Version=${data.Version}; classic export requires version 800 or higher`)
    }

    const allNodeArrays = getNodeArrays(data)
    const objectIds = allNodeArrays.map((node) => node.ObjectId)
    const uniqueIds = new Set(objectIds)
    if (uniqueIds.size !== objectIds.length) {
        errors.push(`Duplicate ObjectIds detected: ${objectIds.length} nodes but only ${uniqueIds.size} unique IDs`)
    }

    const sortedIds = [...uniqueIds].filter((id): id is number => typeof id === 'number').sort((a, b) => a - b)
    for (let i = 0; i < sortedIds.length; i++) {
        if (sortedIds[i] !== i) {
            errors.push(`ObjectId sequence has gaps: expected ${i}, found ${sortedIds[i]}`)
            break
        }
    }

    const validIds = new Set<number>(sortedIds)
    validIds.add(-1)
    for (const node of allNodeArrays) {
        const parent = node.Parent
        if (parent !== undefined && parent !== null && (!Number.isInteger(parent) || !validIds.has(parent as number))) {
            errors.push(`Node "${String(node.Name)}" (ObjectId=${String(node.ObjectId)}) has invalid Parent=${String(parent)}`)
        }
    }

    const pivotPoints = getArray(data, 'PivotPoints')
    const expectedPivotCount = sortedIds.length > 0 ? sortedIds[sortedIds.length - 1] + 1 : 0
    const actualPivotCount = pivotPoints.length
    if (actualPivotCount !== expectedPivotCount) {
        errors.push(`PivotPoints count mismatch: expected ${expectedPivotCount}, found ${actualPivotCount}`)
    }

    const typeOrder = [
        'Bone',
        'Light',
        'Helper',
        'Attachment',
        'ParticleEmitter',
        'ParticleEmitter2',
        'RibbonEmitter',
        'EventObject',
        'CollisionShape',
        'ParticleEmitterPopcorn',
    ]
    let lastObjectId = -1
    for (const typeName of typeOrder) {
        const arrayName = typeName === 'Bone' ? 'Bones' :
            typeName === 'Light' ? 'Lights' :
                typeName === 'Helper' ? 'Helpers' :
                    typeName === 'Attachment' ? 'Attachments' :
                        typeName === 'ParticleEmitter' ? 'ParticleEmitters' :
                            typeName === 'ParticleEmitter2' ? 'ParticleEmitters2' :
                                typeName === 'RibbonEmitter' ? 'RibbonEmitters' :
                                    typeName === 'EventObject' ? 'EventObjects' :
                                        typeName === 'CollisionShape' ? 'CollisionShapes' :
                                            'ParticleEmitterPopcorns'

        const nodes = getArray(data, arrayName).map(asRecord)
        for (const node of nodes) {
            const objectId = typeof node.ObjectId === 'number' ? node.ObjectId : lastObjectId
            lastObjectId = Math.max(lastObjectId, objectId)
        }
    }

    for (const node of allNodeArrays) {
        if (node.ObjectId === undefined || node.ObjectId === null) {
            errors.push(`Node "${String(node.Name)}" is missing ObjectId`)
        }
        const objectId = typeof node.ObjectId === 'number' ? node.ObjectId : -1
        if (!node.PivotPoint && !pivotPoints[objectId]) {
            errors.push(`Node "${String(node.Name)}" (ObjectId=${String(node.ObjectId)}) is missing PivotPoint`)
        }
    }

    const geosets = getArray(data, 'Geosets').map(asRecord)
    for (let i = 0; i < geosets.length; i++) {
        const geoset = geosets[i]
        const verticesLength = getLength(geoset.Vertices)
        const facesLength = getLength(geoset.Faces)
        const vertexGroupLength = getLength(geoset.VertexGroup)

        if (verticesLength === 0) {
            errors.push(`Geoset ${i} has no vertices`)
        }
        if (facesLength === 0) {
            errors.push(`Geoset ${i} has no faces`)
        }
        const vertexCount = Math.floor(verticesLength / 3)
        if (verticesLength > 0 && verticesLength % 3 !== 0) {
            errors.push(`Geoset ${i} vertex buffer length is not divisible by 3`)
        }
        if (facesLength > 0 && facesLength % 3 !== 0) {
            errors.push(`Geoset ${i} face index count is not divisible by 3`)
        }
        if (vertexGroupLength > 0 && vertexGroupLength !== vertexCount) {
            errors.push(`Geoset ${i} VertexGroup length mismatch (expected ${vertexCount}, found ${vertexGroupLength})`)
        }

        const groups = Array.isArray(geoset.Groups) ? geoset.Groups : []
        if (groups.length > 256) {
            errors.push(`Geoset ${i} has ${groups.length} matrix groups; MDX800 supports at most 256`)
        }
        if (groups.length > 0 && vertexGroupLength > 0) {
            const maxGroupIndex = groups.length - 1
            for (let v = 0; v < vertexGroupLength; v++) {
                const groupIndex = getIndexedValue(geoset.VertexGroup, v)
                if (typeof groupIndex === 'number' && groupIndex > maxGroupIndex) {
                    errors.push(`Geoset ${i} VertexGroup index out of range at vertex ${v}`)
                    break
                }
            }
        }

        if (typeof geoset.MaterialID === 'number') {
            const materialCount = getArray(data, 'Materials').length
            if (materialCount > 0 && (geoset.MaterialID < 0 || geoset.MaterialID >= materialCount)) {
                errors.push(`Geoset ${i} MaterialID out of range`)
            }
        }

        for (let g = 0; g < groups.length; g++) {
            const group = groups[g]
            if (!Array.isArray(group)) continue
            for (const boneId of group) {
                if (typeof boneId === 'number' && !validIds.has(boneId) && boneId !== -1) {
                    errors.push(`Geoset ${i} Group ${g} references invalid bone ObjectId=${boneId}`)
                }
            }
        }
    }

    getArray(data, 'Textures').map(asRecord).forEach((texture, index) => {
        const image = typeof texture.Image === 'string' ? texture.Image : ''
        const replaceableId = Number(texture.ReplaceableId ?? 0)
        if ((!image || image.trim() === '') && replaceableId === 0) {
            errors.push(`Texture ${index} has empty Image path (Image="${String(texture.Image ?? '')}", Path="${String(texture.Path ?? '')}")`)
        }
    })

    getArray(data, 'Sequences').map(asRecord).forEach((sequence, index) => {
        const interval = sequence.Interval
        if (!interval || getLength(interval) !== 2) {
            errors.push(`Sequence ${index} "${String(sequence.Name || '')}" has invalid Interval`)
            return
        }
        const start = Number(getIndexedValue(interval, 0))
        const end = Number(getIndexedValue(interval, 1))
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            errors.push(`Sequence ${index} "${String(sequence.Name || '')}" Interval has non-numeric values`)
        } else if (start > end) {
            errors.push(`Sequence ${index} "${String(sequence.Name || '')}" Interval start > end`)
        }
    })

    return errors
}

