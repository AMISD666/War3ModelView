import { quat } from 'gl-matrix'

export type RotationDisplayMode = 'degrees' | 'quaternion'

export interface KeyframeTextFormatOptions {
    vectorSize: number
    rotationTrack?: boolean
    rotationDisplayMode?: RotationDisplayMode
}

const normalizeAngle360 = (value: number): number => {
    if (!Number.isFinite(value)) return 0
    let normalized = value % 360
    if (normalized < 0) normalized += 360
    if (Math.abs(normalized) < 1e-6 || Math.abs(normalized - 360) < 1e-6) {
        return 0
    }
    return normalized
}

export const isRotationKeyframeTrack = (
    vectorSize: number,
    fieldName?: string,
    title?: string,
): boolean => {
    const lowerField = (fieldName || '').toLowerCase()
    const lowerTitle = (title || '').toLowerCase()

    if (lowerField.includes('rotation')) return true
    if (lowerTitle.includes('rotation')) return true

    return vectorSize === 4
}

export const getDisplayVectorSize = (options: KeyframeTextFormatOptions): number => {
    if (options.rotationTrack && options.rotationDisplayMode === 'degrees') {
        return 3
    }
    return options.vectorSize
}

const quaternionToEulerDegrees = (value: number[]): [number, number, number] => {
    const [x = 0, y = 0, z = 0, w = 1] = value
    const sinrCosp = 2 * (w * x + y * z)
    const cosrCosp = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinrCosp, cosrCosp)

    const sinp = 2 * (w * y - z * x)
    let pitch = 0
    if (Math.abs(sinp) >= 1) pitch = Math.sign(sinp) * Math.PI / 2
    else pitch = Math.asin(sinp)

    const sinyCosp = 2 * (w * z + x * y)
    const cosyCosp = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(sinyCosp, cosyCosp)

    return [
        normalizeAngle360(roll * 180 / Math.PI),
        normalizeAngle360(pitch * 180 / Math.PI),
        normalizeAngle360(yaw * 180 / Math.PI),
    ]
}

const eulerDegreesToQuaternion = (value: number[]): [number, number, number, number] => {
    const next = quat.create()
    quat.fromEuler(next, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
    return [next[0], next[1], next[2], next[3]]
}

const normalizeQuaternionValue = (value: number[]): [number, number, number, number] => {
    const x = Number(value[0] ?? 0)
    const y = Number(value[1] ?? 0)
    const z = Number(value[2] ?? 0)
    const w = Number(value[3] ?? 1)
    const length = Math.hypot(x, y, z, w)
    if (!Number.isFinite(length) || length < 1e-8) {
        return [0, 0, 0, 1]
    }
    return [x / length, y / length, z / length, w / length]
}

const normalizeRotationStorageKeys = (keys: any[]): any[] => {
    if (keys.length === 0) return keys

    const normalized = keys.map((key) => {
        const next = { ...key }
        next.Vector = normalizeQuaternionValue(Array.isArray(key.Vector) ? key.Vector : [])
        if (Array.isArray(key.InTan)) {
            next.InTan = normalizeQuaternionValue(key.InTan)
        }
        if (Array.isArray(key.OutTan)) {
            next.OutTan = normalizeQuaternionValue(key.OutTan)
        }
        return next
    })

    for (let i = 1; i < normalized.length; i += 1) {
        const previous = normalized[i - 1]?.Vector
        const current = normalized[i]?.Vector
        if (!Array.isArray(previous) || !Array.isArray(current) || previous.length < 4 || current.length < 4) {
            continue
        }

        const dot = previous[0] * current[0] + previous[1] * current[1] + previous[2] * current[2] + previous[3] * current[3]
        if (dot >= 0) continue

        normalized[i] = {
            ...normalized[i],
            Vector: current.map((entry) => -entry),
            InTan: Array.isArray(normalized[i].InTan) ? normalized[i].InTan.map((entry: number) => -entry) : normalized[i].InTan,
            OutTan: Array.isArray(normalized[i].OutTan) ? normalized[i].OutTan.map((entry: number) => -entry) : normalized[i].OutTan,
        }
    }

    return normalized
}

const toNumericArray = (value: number | number[] | Float32Array | undefined | null): number[] => {
    if (value === undefined || value === null) return []
    if (typeof value === 'number') return [value]
    if (Array.isArray(value)) return [...value]
    return Array.from(value)
}

export const convertStorageValueToDisplay = (
    value: number | number[] | Float32Array | undefined | null,
    options: KeyframeTextFormatOptions,
): number[] => {
    const raw = toNumericArray(value)
    if (options.rotationTrack && options.rotationDisplayMode === 'degrees') {
        const padded = [...raw]
        while (padded.length < 4) padded.push(padded.length === 3 ? 1 : 0)
        return quaternionToEulerDegrees(padded.slice(0, 4))
    }
    return raw
}

export const convertDisplayValueToStorage = (
    value: number[],
    options: KeyframeTextFormatOptions,
): number[] => {
    if (options.rotationTrack && options.rotationDisplayMode === 'degrees') {
        return eulerDegreesToQuaternion(value)
    }
    return [...value]
}

export const formatKeyframeValue = (
    value: number | number[] | Float32Array | undefined | null,
    options: KeyframeTextFormatOptions,
): string => {
    const displaySize = getDisplayVectorSize(options)
    const converted = convertStorageValueToDisplay(value, options)
    const nums = [...converted]

    while (nums.length < displaySize) nums.push(0)
    const sliced = nums.slice(0, displaySize)

    const parts = sliced.map((entry) => {
        const num = entry ?? 0
        return Number(num.toFixed(6)).toString()
    })

    if (displaySize === 1) return parts[0] || '0'
    return `{ ${parts.join(', ')} }`
}

export const parseKeyframeValue = (
    source: string,
    options: KeyframeTextFormatOptions,
): number[] => {
    const displaySize = getDisplayVectorSize(options)
    const clean = source.replace(/[{}]/g, '').trim()
    const parts = clean.split(/[,\s]+/).filter(Boolean)
    const nums = parts.map((part) => parseFloat(part)).filter((entry) => !Number.isNaN(entry))

    while (nums.length < displaySize) nums.push(0)
    return nums.slice(0, displaySize)
}

export const generateKeyframeText = (
    keys: any[],
    type: number,
    options: KeyframeTextFormatOptions,
): string => {
    return keys.map((key) => {
        const lines = [`${key.Frame}: ${formatKeyframeValue(key.Vector, options)}`]

        if (type > 1) {
            const defaultTan = new Array(getDisplayVectorSize(options)).fill(0)
            lines.push(`  InTan: ${formatKeyframeValue(key.InTan || defaultTan, options)}`)
            lines.push(`  OutTan: ${formatKeyframeValue(key.OutTan || defaultTan, options)}`)
        }

        return lines.join('\n')
    }).join('\n')
}

export const parseKeyframeText = (
    source: string,
    options: KeyframeTextFormatOptions,
): any[] => {
    const displaySize = getDisplayVectorSize(options)
    const lines = source.split('\n')
    const keys: any[] = []
    let currentKey: any = null

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (trimmed.startsWith('InTan:')) {
            if (currentKey) currentKey.InTan = parseKeyframeValue(trimmed.substring(6), options)
            continue
        }

        if (trimmed.startsWith('OutTan:')) {
            if (currentKey) currentKey.OutTan = parseKeyframeValue(trimmed.substring(7), options)
            continue
        }

        const parts = trimmed.split(':')
        if (parts.length < 2) continue

        const frame = parseInt(parts[0], 10)
        if (Number.isNaN(frame)) continue

        const valueText = parts.slice(1).join(':')
        currentKey = {
            Frame: frame,
            Vector: parseKeyframeValue(valueText, options),
            InTan: new Array(displaySize).fill(0),
            OutTan: new Array(displaySize).fill(0),
        }
        keys.push(currentKey)
    }

    return keys.sort((a, b) => a.Frame - b.Frame)
}

export const convertDisplayKeysToStorage = (
    keys: any[],
    options: KeyframeTextFormatOptions,
): any[] => {
    const converted = keys.map((key) => ({
        ...key,
        Vector: convertDisplayValueToStorage(Array.isArray(key.Vector) ? key.Vector : [], options),
        InTan: convertDisplayValueToStorage(Array.isArray(key.InTan) ? key.InTan : [], options),
        OutTan: convertDisplayValueToStorage(Array.isArray(key.OutTan) ? key.OutTan : [], options),
    }))

    if (options.rotationTrack) {
        return normalizeRotationStorageKeys(converted)
    }

    return converted
}
