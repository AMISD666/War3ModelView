import {
    normalizeInterval,
    toFloat32Array,
} from './saveDataCoercion'

export function normalizeModelVersion(data: any): void {
    const rawVersion = typeof data.Version === 'number'
        ? data.Version
        : data.Version?.FormatVersion
    const version = Number(rawVersion)
    data.Version = Number.isFinite(version) && version >= 800
        ? Math.floor(version)
        : 800
}

export function normalizeSequences(data: any): void {
    if (!data.Sequences || !Array.isArray(data.Sequences)) return

    data.Sequences.forEach((seq: any) => {
        seq.Interval = normalizeInterval(seq.Interval)
        if (seq.MinimumExtent && !(seq.MinimumExtent instanceof Float32Array)) {
            seq.MinimumExtent = toFloat32Array(seq.MinimumExtent)
        }
        if (seq.MaximumExtent && !(seq.MaximumExtent instanceof Float32Array)) {
            seq.MaximumExtent = toFloat32Array(seq.MaximumExtent)
        }
        if (!seq.MinimumExtent) seq.MinimumExtent = new Float32Array(3)
        if (!seq.MaximumExtent) seq.MaximumExtent = new Float32Array(3)
        if (seq.BoundsRadius === undefined || seq.BoundsRadius === null) {
            seq.BoundsRadius = 0
        }
        if (seq.MoveSpeed === undefined || seq.MoveSpeed === null) {
            seq.MoveSpeed = 0
        }
        if (seq.Rarity === undefined || seq.Rarity === null) {
            seq.Rarity = 0
        }
        if (seq.NonLooping === undefined || seq.NonLooping === null) {
            seq.NonLooping = false
        } else {
            seq.NonLooping = !!seq.NonLooping
        }
    })
}

export function normalizeModelInfo(data: any): void {
    if (!data.Info || typeof data.Info !== 'object') {
        data.Info = {}
    }

    const legacyModelInfo = data.Model && typeof data.Model === 'object' ? data.Model : {}
    const modelName = typeof data.Info.Name === 'string'
        ? data.Info.Name
        : typeof legacyModelInfo.Name === 'string'
            ? legacyModelInfo.Name
            : ''
    data.Info.Name = modelName

    if (data.Info.MinimumExtent && !(data.Info.MinimumExtent instanceof Float32Array)) {
        data.Info.MinimumExtent = toFloat32Array(data.Info.MinimumExtent)
    } else if (!data.Info.MinimumExtent && legacyModelInfo.MinimumExtent) {
        data.Info.MinimumExtent = toFloat32Array(legacyModelInfo.MinimumExtent)
    }
    if (data.Info.MaximumExtent && !(data.Info.MaximumExtent instanceof Float32Array)) {
        data.Info.MaximumExtent = toFloat32Array(data.Info.MaximumExtent)
    } else if (!data.Info.MaximumExtent && legacyModelInfo.MaximumExtent) {
        data.Info.MaximumExtent = toFloat32Array(legacyModelInfo.MaximumExtent)
    }
    if (!data.Info.MinimumExtent) data.Info.MinimumExtent = new Float32Array(3)
    if (!data.Info.MaximumExtent) data.Info.MaximumExtent = new Float32Array(3)
    if (data.Info.BoundsRadius === undefined || data.Info.BoundsRadius === null) {
        data.Info.BoundsRadius = legacyModelInfo.BoundsRadius ?? 0
    }
    if (data.Info.BlendTime === undefined || data.Info.BlendTime === null) {
        data.Info.BlendTime = legacyModelInfo.BlendTime ?? 0
    }
    data.Info.BoundsRadius = Number.isFinite(Number(data.Info.BoundsRadius))
        ? Number(data.Info.BoundsRadius)
        : 0
    data.Info.BlendTime = Number.isFinite(Number(data.Info.BlendTime))
        ? Math.max(0, Math.floor(Number(data.Info.BlendTime)))
        : 0
}

export function normalizeGlobalSequences(data: any): void {
    if (!data.GlobalSequences || !Array.isArray(data.GlobalSequences)) return

    data.GlobalSequences = data.GlobalSequences.map((value: any) => {
        const rawDuration = typeof value === 'number' ? value : value?.Duration
        const num = Number(rawDuration)
        return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0
    })
}

function normalizeTexturePath(value: any): string {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.join('')
    if (value && typeof value === 'object') {
        return Object.values(value).join('')
    }
    return ''
}

export function normalizeTextures(data: any): void {
    if (!data.Textures || !Array.isArray(data.Textures)) return

    const replaceablePreviewPaths = new Set([
        'ReplaceableTextures\\TeamColor\\TeamColor00.blp',
        'ReplaceableTextures\\TeamGlow\\TeamGlow00.blp',
    ])

    data.Textures.forEach((texture: any) => {
        if (texture.ReplaceableId === undefined || texture.ReplaceableId === null) {
            texture.ReplaceableId = 0
        }
        if (typeof texture.ReplaceableId === 'number' && texture.ReplaceableId < 0) {
            texture.ReplaceableId = 0
        }

        const rawImage = texture.Image ?? texture.Path ?? ''
        const normalizedImage = normalizeTexturePath(rawImage).replace(/\//g, '\\')
        const replaceableId = typeof texture.ReplaceableId === 'number'
            ? texture.ReplaceableId
            : Number(texture.ReplaceableId ?? 0)

        if (replaceableId > 0) {
            const shouldStripPreviewImage =
                normalizedImage.length === 0 ||
                replaceablePreviewPaths.has(normalizedImage)
            texture.Image = shouldStripPreviewImage ? '' : normalizedImage
            texture.Path = texture.Image
        } else {
            texture.Image = normalizedImage
            if (!texture.Path) {
                texture.Path = normalizedImage
            }
        }
        if (texture.Flags === undefined || texture.Flags === null) {
            texture.Flags = 0
        }

        const baseFlags = typeof texture.Flags === 'number' ? texture.Flags : 0
        let flags = baseFlags & ~(1 | 2)
        const applyFlag = (prop: string, bit: number) => {
            if (texture[prop] === true) {
                flags |= bit
            } else if (texture[prop] === false) {
                // Explicitly cleared.
            } else if (baseFlags & bit) {
                flags |= bit
            }
        }
        applyFlag('WrapWidth', 1)
        applyFlag('WrapHeight', 2)
        texture.Flags = flags
    })
}
