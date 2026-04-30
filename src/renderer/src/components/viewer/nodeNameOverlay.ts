import { mat4, vec3 } from 'gl-matrix'
import type { NodeNameDisplayMode } from '../../store/rendererStore'

export interface NodeScreenLabel {
    id: number
    name: string
    x: number
    y: number
}

export interface NodeWrapperLike {
    node?: {
        ObjectId?: number
        Name?: string
        PivotPoint?: ArrayLike<number>
    }
    matrix?: mat4 | ArrayLike<number>
}

export const readNodePivot = (value: unknown): vec3 | null => {
    const source = (Array.isArray(value) || ArrayBuffer.isView(value)) ? value as ArrayLike<number> : null
    if (!source || source.length < 3) return null
    const x = Number(source[0])
    const y = Number(source[1])
    const z = Number(source[2])
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? vec3.fromValues(x, y, z) : null
}

export const createNodeScreenLabels = (
    nodeWrappers: NodeWrapperLike[],
    mvMatrix: mat4,
    pMatrix: mat4,
    canvas: HTMLCanvasElement,
    resolvePivot: (nodeWrapper: NodeWrapperLike) => ArrayLike<number> | null = (nodeWrapper) => readNodePivot(nodeWrapper.node?.PivotPoint)
): NodeScreenLabel[] => {
    const mvp = mat4.create()
    mat4.multiply(mvp, pMatrix, mvMatrix)
    const worldPos = vec3.create()
    const projected = vec3.create()
    const width = canvas.width || canvas.clientWidth || 1
    const height = canvas.height || canvas.clientHeight || 1
    const labels: NodeScreenLabel[] = []

    for (const nodeWrapper of nodeWrappers) {
        const node = nodeWrapper?.node
        const id = Number(node?.ObjectId)
        if (!Number.isFinite(id)) continue
        const pivot = resolvePivot(nodeWrapper)
        if (!pivot || !nodeWrapper.matrix) continue
        vec3.transformMat4(worldPos, pivot as any, nodeWrapper.matrix as any)
        vec3.transformMat4(projected, worldPos, mvp)
        const x = ((projected[0] + 1) / 2) * width
        const y = ((1 - projected[1]) / 2) * height
        if (Number.isFinite(x) && Number.isFinite(y)) {
            labels.push({ id, name: String(node?.Name || `#${id}`), x, y })
        }
    }
    return labels
}

export const findClosestNodeLabel = (
    labels: NodeScreenLabel[],
    x: number,
    y: number,
    radius = 18
): NodeScreenLabel | null => {
    let best: { label: NodeScreenLabel; distance: number } | null = null
    for (const label of labels) {
        const distance = Math.hypot(label.x - x, label.y - y)
        if (distance <= radius && (!best || distance < best.distance)) {
            best = { label, distance }
        }
    }
    return best?.label ?? null
}

export const drawNodeNameOverlay = (
    overlay: HTMLCanvasElement | null,
    labels: NodeScreenLabel[],
    mode: NodeNameDisplayMode,
    selectedNodeIds: number[],
    hoveredNodeId: number | null
): void => {
    const ctx = overlay?.getContext('2d')
    if (!overlay || !ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    if (mode === 'hidden') return

    const selected = new Set(selectedNodeIds)
    const visibleLabels = mode === 'all'
        ? labels
        : labels.filter((label) => selected.has(label.id) || label.id === hoveredNodeId)
    if (visibleLabels.length === 0) return

    const dpr = window.devicePixelRatio || 1
    ctx.font = `${12 * dpr}px Segoe UI, Microsoft YaHei, sans-serif`
    ctx.textBaseline = 'bottom'
    ctx.lineWidth = 4 * dpr
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)'
    ctx.fillStyle = '#e8f2ff'

    for (const label of visibleLabels) {
        const text = label.name
        const x = label.x + 10 * dpr
        const y = label.y - 8 * dpr
        ctx.strokeText(text, x, y)
        ctx.fillText(text, x, y)
    }
}
