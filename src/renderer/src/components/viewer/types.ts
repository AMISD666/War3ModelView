/**
 * Shared types for viewer hooks
 */

import { vec3 } from 'gl-matrix'

// Mouse interaction state
export interface MouseState {
    isDragging: boolean
    dragButton: number // 0: Left, 1: Middle, 2: Right
    lastMouseX: number
    lastMouseY: number
    startX: number
    startY: number
    isBoxSelecting: boolean
    isCtrlPressed: boolean
}

// Gizmo axis types
export type GizmoAxis = 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz' | 'center' | null

// Gizmo state
export interface GizmoState {
    activeAxis: GizmoAxis
    isDragging: boolean
    dragStartPos: vec3 | null
}

// Selection box state
export interface SelectionBox {
    x: number
    y: number
    width: number
    height: number
}

// Camera state
export interface CameraState {
    distance: number
    theta: number
    phi: number
    target: Float32Array
}

// Helper: Convert hex color to RGB array with simple caching to avoid per-frame regex
const hexCache: Record<string, [number, number, number]> = {};
export function hexToRgb(hex: string): [number, number, number] {
    if (hexCache[hex]) return hexCache[hex];

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    const rgb: [number, number, number] = result
        ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255]
        : [0.2, 0.2, 0.2];

    // Simple cache - we only expect a few colors (background, vertex, selection, etc.)
    if (Object.keys(hexCache).length < 50) {
        hexCache[hex] = rgb;
    }
    return rgb;
}

// Helper: Check if value is array-like
export function isArrayLike(v: any): boolean {
    return Array.isArray(v) || v instanceof Float32Array || ArrayBuffer.isView(v)
}

// Helper: Convert to array
export function toArray(v: any): number[] {
    return v instanceof Float32Array ? Array.from(v) : v
}

// Helper: Get position from property (handles static or animated values)
export function getPos(prop: any, directProp?: any): [number, number, number] {
    if (directProp && isArrayLike(directProp)) return toArray(directProp) as [number, number, number]
    if (isArrayLike(prop)) return toArray(prop) as [number, number, number]
    if (prop && prop.Keys && prop.Keys.length > 0) {
        const v = prop.Keys[0].Vector
        return v ? toArray(v) as [number, number, number] : [0, 0, 0]
    }
    return [0, 0, 0]
}

// Helper: Get scalar value (static or first key)
export function getVal(prop: any): number {
    if (typeof prop === 'number') return prop
    if (prop && prop.Keys && prop.Keys.length > 0) return prop.Keys[0].Vector[0]
    return 0
}

// Helper: Get vector value
export function getVec(prop: any): [number, number, number] {
    if (prop instanceof Float32Array || Array.isArray(prop)) return [prop[0], prop[1], prop[2]]
    if (prop && prop.Keys && prop.Keys.length > 0) return [prop.Keys[0].Vector[0], prop.Keys[0].Vector[1], prop.Keys[0].Vector[2]]
    return [1, 1, 1]
}
