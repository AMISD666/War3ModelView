import { vectorToPlainArray } from '../../utils/animVectorIpc'
import { toFloat32Array } from '../../utils/modelUtils'
import { coercePivotFloat3 } from '../../utils/pivotUtils'

export const cloneGeosetAnimVector = (animVector: any, size: number) => {
    if (!animVector || typeof animVector !== 'object') return animVector
    const toArray = (val: any): number[] => {
        const values = vectorToPlainArray(val).slice(0, size)
        if (values.length >= size) return values
        if (values.length > 0) return [...values, ...new Array(size - values.length).fill(0)]
        return new Array(size).fill(0)
    }
    const keys = (animVector.Keys || []).map((k: any) => ({
        Frame: typeof k.Frame === 'number' ? k.Frame : (k.Time ?? 0),
        Vector: toArray(k.Vector),
        InTan: toArray(k.InTan),
        OutTan: toArray(k.OutTan)
    }))
    return {
        LineType: typeof animVector.LineType === 'number' ? animVector.LineType : 0,
        GlobalSeqId: animVector.GlobalSeqId ?? null,
        Keys: keys
    }
}

export const cloneGeosetAnimForEditor = (anim: any): any => {
    const cloned: any = { ...anim }
    if (anim.Color instanceof Float32Array || ArrayBuffer.isView(anim.Color)) {
        const c = coercePivotFloat3(anim.Color as Float32Array | Uint8Array | number[])
        cloned.Color = c ? [c[0], c[1], c[2]] : [1, 1, 1]
    } else if (Array.isArray(anim.Color)) {
        cloned.Color = [...anim.Color]
    } else if (anim.Color && typeof anim.Color === 'object' && Array.isArray((anim.Color as any).Keys)) {
        cloned.Color = cloneGeosetAnimVector(anim.Color, 3)
    } else if (anim.Color && typeof anim.Color === 'object') {
        const c = coercePivotFloat3(anim.Color as Float32Array | Uint8Array | number[])
        const t = c ?? toFloat32Array(anim.Color, 3)
        cloned.Color = [t[0], t[1], t[2]]
    }
    if (anim.Alpha && typeof anim.Alpha === 'object' && 'Keys' in anim.Alpha) {
        cloned.Alpha = cloneGeosetAnimVector(anim.Alpha, 1)
    } else if (typeof anim.Alpha === 'string') {
        cloned.Alpha = parseFloat(anim.Alpha)
    }
    return cloned
}

export const isGeosetAnimDynamic = (prop: any): boolean =>
    prop && typeof prop === 'object' && !Array.isArray(prop) && !(prop instanceof Float32Array) && 'Keys' in prop

export const getGeosetAnimEditorColor = (anim: any): string => {
    if (!anim || anim.Color == null) return '#ffffff'
    const colorData = anim.Color
    if (ArrayBuffer.isView(colorData)) {
        const c = coercePivotFloat3(colorData as Float32Array | Uint8Array | number[])
        if (c) return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
    }
    if (Array.isArray(colorData) && colorData.length >= 3) {
        const r = Number(colorData[0]) || 0
        const g = Number(colorData[1]) || 0
        const b = Number(colorData[2]) || 0
        return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
    }
    return '#ffffff'
}

export const getGeosetAnimEditorAlpha = (anim: any): number => {
    if (!anim) return 1
    if (typeof anim.Alpha === 'number') return anim.Alpha
    return 1
}

export const readGeosetAnimColorVector = (value: any): number[] => {
    if (Array.isArray(value)) return [Number(value[0]), Number(value[1]), Number(value[2])]
    if (value instanceof Float32Array || ArrayBuffer.isView(value)) {
        const c = coercePivotFloat3(value as Float32Array | Uint8Array | number[])
        if (c) return [c[0], c[1], c[2]]
    }
    return [1, 1, 1]
}
