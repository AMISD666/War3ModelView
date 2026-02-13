import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { Typography, Select, message, InputNumber, Button, ColorPicker } from 'antd'
import { quat, vec3 } from 'gl-matrix'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { useHistoryStore } from '../../store/historyStore'
import { SetNodeParentCommand } from '../../commands/SetNodeParentCommand'
import { useCommandManager } from '../../utils/CommandManager'
import KeyframeEditor from '../editors/KeyframeEditor'

const { Text } = Typography

// --- 转换工具函数 ---

/**
 * 四元数转欧拉角 (弧度 -> 度)
 */
function quatToEuler(q: number[] | Float32Array): [number, number, number] {
    const [x, y, z, w] = q
    const sinr_cosp = 2 * (w * x + y * z)
    const cosr_cosp = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinr_cosp, cosr_cosp)

    const sinp = 2 * (w * y - z * x)
    let pitch: number
    if (Math.abs(sinp) >= 1) pitch = Math.sign(sinp) * Math.PI / 2
    else pitch = Math.asin(sinp)

    const siny_cosp = 2 * (w * z + x * y)
    const cosy_cosp = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(siny_cosp, cosy_cosp)

    return [roll * 180 / Math.PI, pitch * 180 / Math.PI, yaw * 180 / Math.PI]
}

/**
 * 欧拉角转四元数 (度 -> 弧度 -> 四元数)
 */
function eulerToQuat(euler: [number, number, number]): [number, number, number, number] {
    const [rx, ry, rz] = euler.map(v => v * Math.PI / 180)
    const c1 = Math.cos(rx / 2), s1 = Math.sin(rx / 2)
    const c2 = Math.cos(ry / 2), s2 = Math.sin(ry / 2)
    const c3 = Math.cos(rz / 2), s3 = Math.sin(rz / 2)

    return [
        s1 * c2 * c3 + c1 * s2 * s3, // x
        c1 * s2 * c3 - s1 * c2 * s3, // y
        c1 * c2 * s3 + s1 * s2 * c3, // z
        c1 * c2 * c3 - s1 * s2 * s3  // w
    ]
}

/**
 * Convert World Space delta to Local Space delta
 * Uses the inverse of the parent's rotation matrix to transform the delta
 */
function worldDeltaToLocalDelta(renderer: any, nodeId: number, worldDelta: [number, number, number]): [number, number, number] {
    if (!renderer || !renderer.rendererData || !renderer.rendererData.nodes) {
        return worldDelta
    }

    const nodes = renderer.rendererData.nodes
    const nodeWrapper = nodes.find((n: any) => n.node && n.node.ObjectId === nodeId)

    if (!nodeWrapper || !nodeWrapper.node) return worldDelta

    const parentId = nodeWrapper.node.Parent
    if (parentId === undefined || parentId === -1) {
        return worldDelta
    }

    const parentWrapper = nodes.find((n: any) => n.node && n.node.ObjectId === parentId)
    if (!parentWrapper || !parentWrapper.matrix) {
        return worldDelta
    }

    const parentMat = parentWrapper.matrix
    const invRotation = [
        parentMat[0], parentMat[4], parentMat[8], 0,
        parentMat[1], parentMat[5], parentMat[9], 0,
        parentMat[2], parentMat[6], parentMat[10], 0,
        0, 0, 0, 1
    ]

    const localDelta = vec3.create()
    vec3.transformMat4(localDelta, vec3.fromValues(worldDelta[0], worldDelta[1], worldDelta[2]), invRotation as any)

    return [localDelta[0], localDelta[1], localDelta[2]]
}

// --- 插值函数 ---

const toArray = (v: any, size: number): number[] => {
    if (!v) return size === 4 ? [0, 0, 0, 1] : (size === 3 ? [0, 0, 0] : [])
    if (Array.isArray(v)) return [...v]
    if (v.length !== undefined) return Array.from(v) as number[]
    return size === 4 ? [0, 0, 0, 1] : (size === 3 ? [0, 0, 0] : [])
}

const interpolateTranslation = (keys: any[], frame: number): number[] => {
    if (!keys || keys.length === 0) return [0, 0, 0]
    const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

    if (frame <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector, 3)
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector, 3)

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
            const from = toArray(sortedKeys[i].Vector, 3)
            const to = toArray(sortedKeys[i + 1].Vector, 3)
            return from.map((v, idx) => v + (to[idx] - v) * t)
        }
    }
    return [0, 0, 0]
}

const interpolateRotation = (keys: any[], frame: number): number[] => {
    if (!keys || keys.length === 0) return [0, 0, 0, 1]
    const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

    if (frame <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector, 4)
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector, 4)

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
            const from = quat.fromValues(sortedKeys[i].Vector[0], sortedKeys[i].Vector[1], sortedKeys[i].Vector[2], sortedKeys[i].Vector[3])
            const to = quat.fromValues(sortedKeys[i + 1].Vector[0], sortedKeys[i + 1].Vector[1], sortedKeys[i + 1].Vector[2], sortedKeys[i + 1].Vector[3])
            const out = quat.create()
            quat.slerp(out, from, to, t)
            return Array.from(out)
        }
    }
    return [0, 0, 0, 1]
}

const interpolateScaling = (keys: any[], frame: number): number[] => {
    if (!keys || keys.length === 0) return [1, 1, 1]
    const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

    if (frame <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector, 3)
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector, 3)

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
            const from = toArray(sortedKeys[i].Vector, 3)
            const to = toArray(sortedKeys[i + 1].Vector, 3)
            return from.map((v, idx) => v + (to[idx] - v) * t)
        }
    }
    return [1, 1, 1]
}

const isAnimTrack = (value: any): value is { Keys: any[]; LineType?: number; GlobalSeqId?: number | null } => {
    return !!value && typeof value === 'object' && Array.isArray(value.Keys)
}

const deepClone = <T,>(value: T): T => {
    const cloneFn = (globalThis as any).structuredClone
    if (typeof cloneFn === 'function') return cloneFn(value)
    return JSON.parse(JSON.stringify(value))
}

const normalizeScalarKeys = (keys: any[]): any[] => {
    if (!Array.isArray(keys)) return []
    return keys
        .map((key) => {
            const frame = typeof key?.Frame === 'number' ? key.Frame : Number(key?.Time ?? 0)
            const raw = ArrayBuffer.isView(key?.Vector) ? Array.from(key.Vector as ArrayLike<number>) : key?.Vector
            const value = Array.isArray(raw) ? Number(raw[0] ?? 0) : Number(raw ?? 0)
            return {
                Frame: Number.isFinite(frame) ? Math.round(frame) : 0,
                Vector: [Number.isFinite(value) ? value : 0],
                InTan: [0],
                OutTan: [0]
            }
        })
        .sort((a, b) => a.Frame - b.Frame)
}

const normalizeColorKeys = (keys: any[]): any[] => {
    if (!Array.isArray(keys)) return []
    return keys
        .map((key) => {
            const frame = typeof key?.Frame === 'number' ? key.Frame : Number(key?.Time ?? 0)
            const raw = ArrayBuffer.isView(key?.Vector) ? Array.from(key.Vector as ArrayLike<number>) : key?.Vector
            const vector = Array.isArray(raw) ? raw : [1, 1, 1]
            return {
                Frame: Number.isFinite(frame) ? Math.round(frame) : 0,
                Vector: [
                    Number(vector[0] ?? 1),
                    Number(vector[1] ?? 1),
                    Number(vector[2] ?? 1)
                ],
                InTan: [0, 0, 0],
                OutTan: [0, 0, 0]
            }
        })
        .sort((a, b) => a.Frame - b.Frame)
}

const upsertScalarKey = (keys: any[], frame: number, value: number) => {
    const next = normalizeScalarKeys(keys)
    const f = Math.round(frame)
    const index = next.findIndex((key) => key.Frame === f)
    const newKey = { Frame: f, Vector: [value], InTan: [0], OutTan: [0] }
    if (index >= 0) next[index] = newKey
    else next.push(newKey)
    next.sort((a, b) => a.Frame - b.Frame)
    return next
}

const upsertColorKey = (keys: any[], frame: number, color: [number, number, number]) => {
    const next = normalizeColorKeys(keys)
    const f = Math.round(frame)
    const index = next.findIndex((key) => key.Frame === f)
    const newKey = { Frame: f, Vector: [color[0], color[1], color[2]], InTan: [0, 0, 0], OutTan: [0, 0, 0] }
    if (index >= 0) next[index] = newKey
    else next.push(newKey)
    next.sort((a, b) => a.Frame - b.Frame)
    return next
}

const removeKeyByFrame = (keys: any[], frame: number, size: 1 | 3) => {
    const normalized = size === 1 ? normalizeScalarKeys(keys) : normalizeColorKeys(keys)
    const f = Math.round(frame)
    return normalized.filter((key) => key.Frame !== f)
}

const sampleScalarTrack = (track: any, frame: number, fallback = 1) => {
    if (!isAnimTrack(track) || track.Keys.length === 0) return fallback
    const keys = normalizeScalarKeys(track.Keys)
    if (keys.length === 0) return fallback
    if (frame <= keys[0].Frame) return Number(keys[0].Vector?.[0] ?? fallback)
    if (frame >= keys[keys.length - 1].Frame) return Number(keys[keys.length - 1].Vector?.[0] ?? fallback)
    for (let i = 0; i < keys.length - 1; i++) {
        const left = keys[i]
        const right = keys[i + 1]
        if (frame >= left.Frame && frame <= right.Frame) {
            const span = right.Frame - left.Frame
            if (span <= 0) return Number(left.Vector?.[0] ?? fallback)
            const t = (frame - left.Frame) / span
            const lv = Number(left.Vector?.[0] ?? fallback)
            const rv = Number(right.Vector?.[0] ?? fallback)
            return lv + (rv - lv) * t
        }
    }
    return fallback
}

const sampleColorTrack = (track: any, frame: number, fallback: [number, number, number]): [number, number, number] => {
    if (!isAnimTrack(track) || track.Keys.length === 0) return fallback
    const keys = normalizeColorKeys(track.Keys)
    if (keys.length === 0) return fallback
    if (frame <= keys[0].Frame) return [keys[0].Vector[0], keys[0].Vector[1], keys[0].Vector[2]]
    if (frame >= keys[keys.length - 1].Frame) return [keys[keys.length - 1].Vector[0], keys[keys.length - 1].Vector[1], keys[keys.length - 1].Vector[2]]
    for (let i = 0; i < keys.length - 1; i++) {
        const left = keys[i]
        const right = keys[i + 1]
        if (frame >= left.Frame && frame <= right.Frame) {
            const span = right.Frame - left.Frame
            if (span <= 0) return [left.Vector[0], left.Vector[1], left.Vector[2]]
            const t = (frame - left.Frame) / span
            return [
                left.Vector[0] + (right.Vector[0] - left.Vector[0]) * t,
                left.Vector[1] + (right.Vector[1] - left.Vector[1]) * t,
                left.Vector[2] + (right.Vector[2] - left.Vector[2]) * t
            ]
        }
    }
    return fallback
}

const clamp01 = (value: number, fallback = 1) => {
    const safe = Number.isFinite(value) ? value : fallback
    return Math.max(0, Math.min(1, safe))
}

const parseColorToNormalized = (
    color: any,
    fallback: [number, number, number]
): [number, number, number] => {
    if (color?.toRgb && typeof color.toRgb === 'function') {
        const rgb = color.toRgb()
        return [
            clamp01((rgb?.r ?? fallback[0] * 255) / 255),
            clamp01((rgb?.g ?? fallback[1] * 255) / 255),
            clamp01((rgb?.b ?? fallback[2] * 255) / 255)
        ]
    }

    if (Array.isArray(color) && color.length >= 3) {
        return [
            clamp01(Number(color[0] ?? fallback[0])),
            clamp01(Number(color[1] ?? fallback[1])),
            clamp01(Number(color[2] ?? fallback[2]))
        ]
    }

    if (typeof color === 'string') {
        const value = color.trim().toLowerCase()
        if (/^#([0-9a-f]{6})$/.test(value)) {
            const r = parseInt(value.slice(1, 3), 16) / 255
            const g = parseInt(value.slice(3, 5), 16) / 255
            const b = parseInt(value.slice(5, 7), 16) / 255
            return [clamp01(r), clamp01(g), clamp01(b)]
        }
        if (/^#([0-9a-f]{3})$/.test(value)) {
            const r = parseInt(value[1] + value[1], 16) / 255
            const g = parseInt(value[2] + value[2], 16) / 255
            const b = parseInt(value[3] + value[3], 16) / 255
            return [clamp01(r), clamp01(g), clamp01(b)]
        }
    }

    if (color && typeof color === 'object') {
        const rr = Number(color.r)
        const gg = Number(color.g)
        const bb = Number(color.b)
        if (Number.isFinite(rr) && Number.isFinite(gg) && Number.isFinite(bb)) {
            const is255Scale = rr > 1 || gg > 1 || bb > 1
            if (is255Scale) {
                return [clamp01(rr / 255), clamp01(gg / 255), clamp01(bb / 255)]
            }
            return [clamp01(rr), clamp01(gg), clamp01(bb)]
        }
    }

    return [...fallback]
}

/**
 * 骨骼参数面板 - 显示选中骨骼的 T/R/S 信息和绑定骨骼列表
 */
const BoneParameterPanel: React.FC = () => {
    const {
        selectedNodeIds,
        selectNodes,
        selectedVertexIds,
        multiMoveMode,
        setMultiMoveMode,
        animationSubMode,
        pickedGeosetIndex
    } = useSelectionStore()

    const nodes = useModelStore(state => state.nodes)
    const modelData = useModelStore(state => state.modelData)
    const currentFrame = useModelStore(state => state.currentFrame)
    const selectedGeosetIndex = useModelStore(state => state.selectedGeosetIndex)
    const selectedGeosetIndices = useModelStore(state => state.selectedGeosetIndices)
    const setSelectedGeosetIndex = useModelStore(state => state.setSelectedGeosetIndex)
    const setSelectedGeosetIndices = useModelStore(state => state.setSelectedGeosetIndices)
    const setGeosetAnims = useModelStore(state => state.setGeosetAnims)

    const renderer = useRendererStore(state => state.renderer)
    const { executeCommand } = useCommandManager()
    const [translationSpace, setTranslationSpace] = useState<'world' | 'local'>('world')
    const [worldTick, setWorldTick] = useState(0)
    const [geosetAlphaInput, setGeosetAlphaInput] = useState<number>(1)
    const [geosetColorInput, setGeosetColorInput] = useState<[number, number, number]>([1, 1, 1])
    const [editingGeosetField, setEditingGeosetField] = useState<'Alpha' | 'Color' | null>(null)
    const [isGeosetEditorOpen, setIsGeosetEditorOpen] = useState(false)

    // 选中的单个骨骼
    const selectedNode = selectedNodeIds.length === 1
        ? nodes.find((n: any) => n.ObjectId === selectedNodeIds[0])
        : null

    // 计算骨骼绑定的顶点数
    const boneVertexCount = useMemo(() => {
        if (!modelData || !modelData.Geosets || selectedNodeIds.length !== 1) return 0
        const boneId = selectedNodeIds[0]
        let count = 0
        modelData.Geosets.forEach((geoset: any) => {
            if (!geoset.VertexGroup || !geoset.Groups) return
            geoset.VertexGroup.forEach((groupIdx: number) => {
                const group = geoset.Groups[groupIdx]
                if (group && Array.isArray(group) && group.includes(boneId)) count++
            })
        })
        return count
    }, [modelData, selectedNodeIds])

    // 计算当前选中顶点绑定的骨骼
    const boundBones = useMemo(() => {
        if (!modelData || !modelData.Geosets || selectedVertexIds.length === 0) return []
        const boneMap = new Map<number, string>()
        selectedVertexIds.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (!geoset || !geoset.VertexGroup || !geoset.Groups) return
            const matrixGroupIndex = geoset.VertexGroup[sel.index]
            if (matrixGroupIndex === undefined || matrixGroupIndex < 0 || matrixGroupIndex >= geoset.Groups.length) return
            const matrixGroup = geoset.Groups[matrixGroupIndex] as any
            if (matrixGroup && Array.isArray(matrixGroup)) {
                matrixGroup.forEach((nodeIndex: number) => {
                    const node = nodes.find((n: any) => n.ObjectId === nodeIndex)
                    if (node) boneMap.set(nodeIndex, node.Name)
                })
            }
        })
        return Array.from(boneMap.entries()).map(([index, name]) => ({ index, name }))
    }, [modelData, nodes, selectedVertexIds])

    const geosetIds = useMemo(() => {
        const geosets = (modelData as any)?.Geosets
        if (!Array.isArray(geosets)) return []
        return geosets.map((_: any, index: number) => index)
    }, [modelData])

    const selectedGeosetIds = useMemo(() => {
        const fromMulti = selectedGeosetIndices.filter((id) => geosetIds.includes(id))
        if (fromMulti.length > 0) return fromMulti
        if (selectedGeosetIndex !== null && geosetIds.includes(selectedGeosetIndex)) return [selectedGeosetIndex]
        if (pickedGeosetIndex !== null && geosetIds.includes(pickedGeosetIndex)) return [pickedGeosetIndex]
        return geosetIds.length > 0 ? [geosetIds[0]] : []
    }, [selectedGeosetIndices, selectedGeosetIndex, pickedGeosetIndex, geosetIds])

    useEffect(() => {
        if (animationSubMode !== 'keyframe') return
        if (pickedGeosetIndex === null || pickedGeosetIndex < 0) return
        if (!geosetIds.includes(pickedGeosetIndex)) return
        if (!selectedGeosetIds.includes(pickedGeosetIndex)) {
            setSelectedGeosetIndices([pickedGeosetIndex])
        }
    }, [animationSubMode, pickedGeosetIndex, geosetIds, selectedGeosetIds, setSelectedGeosetIndices])

    useEffect(() => {
        if (animationSubMode !== 'keyframe') return
        if (geosetIds.length === 0) return
        if (selectedGeosetIds.length === 0) {
            setSelectedGeosetIndices([geosetIds[0]])
        }
    }, [animationSubMode, geosetIds, selectedGeosetIds, setSelectedGeosetIndices])

    useEffect(() => {
        if (selectedGeosetIds.length === 0) {
            if (selectedGeosetIndex !== null) setSelectedGeosetIndex(null)
            return
        }
        if (selectedGeosetIndex !== selectedGeosetIds[0]) {
            setSelectedGeosetIndex(selectedGeosetIds[0])
        }
    }, [selectedGeosetIds, selectedGeosetIndex, setSelectedGeosetIndex])

    const activeGeosetId = selectedGeosetIds.length > 0 ? selectedGeosetIds[0] : null

    const geosetAnimIndex = useMemo(() => {
        if (activeGeosetId === null) return -1
        const anims = (modelData as any)?.GeosetAnims
        if (!Array.isArray(anims)) return -1
        return anims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(activeGeosetId))
    }, [modelData, activeGeosetId])

    const activeGeosetAnim = useMemo(() => {
        if (geosetAnimIndex < 0) return null
        const anims = (modelData as any)?.GeosetAnims
        if (!Array.isArray(anims)) return null
        return anims[geosetAnimIndex] || null
    }, [modelData, geosetAnimIndex])

    const currentGeosetAlpha = useMemo(() => {
        if (!activeGeosetAnim) return 1
        if (isAnimTrack(activeGeosetAnim.Alpha)) {
            return sampleScalarTrack(activeGeosetAnim.Alpha, currentFrame, 1)
        }
        if (typeof activeGeosetAnim.Alpha === 'number') return activeGeosetAnim.Alpha
        return 1
    }, [activeGeosetAnim, currentFrame])

    const currentGeosetColor = useMemo<[number, number, number]>(() => {
        if (!activeGeosetAnim) return [1, 1, 1]
        if (isAnimTrack(activeGeosetAnim.Color)) {
            return sampleColorTrack(activeGeosetAnim.Color, currentFrame, [1, 1, 1])
        }
        if (Array.isArray(activeGeosetAnim.Color)) {
            return [
                Number(activeGeosetAnim.Color[0] ?? 1),
                Number(activeGeosetAnim.Color[1] ?? 1),
                Number(activeGeosetAnim.Color[2] ?? 1)
            ]
        }
        if (ArrayBuffer.isView(activeGeosetAnim.Color)) {
            const arr = Array.from(activeGeosetAnim.Color as ArrayLike<number>)
            return [Number(arr[0] ?? 1), Number(arr[1] ?? 1), Number(arr[2] ?? 1)]
        }
        return [1, 1, 1]
    }, [activeGeosetAnim, currentFrame])

    const hasExactGeosetAlphaKey = useMemo(() => {
        if (!activeGeosetAnim || !isAnimTrack(activeGeosetAnim.Alpha)) return false
        const frame = Math.round(currentFrame)
        return normalizeScalarKeys(activeGeosetAnim.Alpha.Keys).some((key) => key.Frame === frame)
    }, [activeGeosetAnim, currentFrame])

    const hasExactGeosetColorKey = useMemo(() => {
        if (!activeGeosetAnim || !isAnimTrack(activeGeosetAnim.Color)) return false
        const frame = Math.round(currentFrame)
        return normalizeColorKeys(activeGeosetAnim.Color.Keys).some((key) => key.Frame === frame)
    }, [activeGeosetAnim, currentFrame])

    useEffect(() => {
        setGeosetAlphaInput(Number(currentGeosetAlpha.toFixed(3)))
    }, [currentGeosetAlpha, activeGeosetId])

    useEffect(() => {
        setGeosetColorInput([currentGeosetColor[0], currentGeosetColor[1], currentGeosetColor[2]])
    }, [currentGeosetColor, activeGeosetId])

    // 插值数据
    const translationLocal = useMemo(() => {
        if (!selectedNode) return [0, 0, 0]
        return interpolateTranslation(selectedNode.Translation?.Keys, currentFrame)
    }, [selectedNode, currentFrame])

    const rotation = useMemo(() => {
        if (!selectedNode) return [0, 0, 0, 1]
        return interpolateRotation(selectedNode.Rotation?.Keys, currentFrame)
    }, [selectedNode, currentFrame])

    const scaling = useMemo(() => {
        if (!selectedNode) return [1, 1, 1]
        return interpolateScaling(selectedNode.Scaling?.Keys, currentFrame)
    }, [selectedNode, currentFrame])

    const euler = useMemo(() => quatToEuler(rotation), [rotation])

    const translationWorld = useMemo(() => {
        if (!selectedNode) return [0, 0, 0]
        const worldPos = (window as any)._selectedBoneWorldPos
        if (worldPos && Array.isArray(worldPos) && worldPos.length === 3) {
            return worldPos as [number, number, number]
        }
        return translationLocal as [number, number, number]
    }, [selectedNode, translationLocal, worldTick])

    const translationDisplay = translationSpace === 'world' ? translationWorld : translationLocal

    // 精确关键帧检查
    const hasExactKey = useCallback((propName: string) => {
        const node = selectedNode as any
        if (!node || !node[propName]?.Keys) return false
        const frame = Math.round(currentFrame)
        return node[propName].Keys.some((k: any) => Math.abs(k.Frame - frame) < 0.1)
    }, [selectedNode, currentFrame])

    // Refs
    const transRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const rotRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const scaleRefs = useRef<{ x: HTMLInputElement | null, y: HTMLInputElement | null, z: HTMLInputElement | null }>({ x: null, y: null, z: null })
    const isEditingRef = useRef(false)

    // 同步到输入框
    useEffect(() => {
        if (isEditingRef.current) return
        if (transRefs.current.x) transRefs.current.x.value = (translationDisplay[0] || 0).toFixed(5)
        if (transRefs.current.y) transRefs.current.y.value = (translationDisplay[1] || 0).toFixed(5)
        if (transRefs.current.z) transRefs.current.z.value = (translationDisplay[2] || 0).toFixed(5)

        if (rotRefs.current.x) rotRefs.current.x.value = (euler[0] || 0).toFixed(2)
        if (rotRefs.current.y) rotRefs.current.y.value = (euler[1] || 0).toFixed(2)
        if (rotRefs.current.z) rotRefs.current.z.value = (euler[2] || 0).toFixed(2)

        if (scaleRefs.current.x) scaleRefs.current.x.value = (scaling[0] || 0).toFixed(5)
        if (scaleRefs.current.y) scaleRefs.current.y.value = (scaling[1] || 0).toFixed(5)
        if (scaleRefs.current.z) scaleRefs.current.z.value = (scaling[2] || 0).toFixed(5)
    }, [translationDisplay, euler, scaling])

    useEffect(() => {
        if (!renderer || selectedNodeIds.length === 0) return
        if (translationSpace !== 'world') return
        renderer.update(0)
        setWorldTick((tick) => tick + 1)
    }, [renderer, selectedNodeIds, currentFrame, translationSpace])

    const handleFocus = useCallback(() => { isEditingRef.current = true }, [])

    // 核心提交逻辑
    const commitProp = useCallback((propName: 'Translation' | 'Rotation' | 'Scaling', newVector: number[]) => {
        if (!selectedNode) return
        const nodeId = selectedNode.ObjectId
        const frame = Math.round(currentFrame)
        const { nodes, updateNodeSilent } = useModelStore.getState()
        const storeNode = nodes.find(n => n.ObjectId === nodeId) as any
        if (!storeNode) return

        const existingProp = storeNode[propName] || { Keys: [], InterpolationType: 1 }
        const keys = [...(existingProp.Keys || [])]
        const idx = keys.findIndex(k => Math.abs(k.Frame - frame) < 0.1)

        let newKey: any = { Frame: frame, Vector: newVector }
        const interpolationType = existingProp.InterpolationType || 1
        if (interpolationType > 1) {
            if (idx >= 0) {
                const old = keys[idx]
                if (old.InTan) newKey.InTan = [...old.InTan]
                else newKey.InTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0]
                if (old.OutTan) newKey.OutTan = [...old.OutTan]
                else newKey.OutTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0]
            } else {
                newKey.InTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0]
                newKey.OutTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0]
            }
        }

        if (idx >= 0) keys[idx] = newKey
        else { keys.push(newKey); keys.sort((a, b) => a.Frame - b.Frame) }

        updateNodeSilent(nodeId, { [propName]: { ...existingProp, Keys: keys } })
        if (renderer?.model?.Nodes) {
            const rNode = renderer.model.Nodes.find((n: any) => n.ObjectId === nodeId) as any
            if (rNode) rNode[propName] = { ...existingProp, Keys: keys }
        }
        message.success(`已更新 ${propName} 关键帧 (帧 ${frame})`)
    }, [selectedNode, currentFrame, renderer])

    const handleCommitTrans = () => {
        const val: [number, number, number] = [
            parseFloat(transRefs.current.x?.value || '0') || 0,
            parseFloat(transRefs.current.y?.value || '0') || 0,
            parseFloat(transRefs.current.z?.value || '0') || 0
        ]
        if (translationSpace === 'world' && selectedNode) {
            const currentWorld = translationDisplay
            const worldDelta: [number, number, number] = [
                val[0] - (currentWorld[0] || 0),
                val[1] - (currentWorld[1] || 0),
                val[2] - (currentWorld[2] || 0)
            ]
            const localDelta = worldDeltaToLocalDelta(renderer, selectedNode.ObjectId, worldDelta)
            const newLocal: [number, number, number] = [
                translationLocal[0] + localDelta[0],
                translationLocal[1] + localDelta[1],
                translationLocal[2] + localDelta[2]
            ]
            commitProp('Translation', newLocal)
        } else {
            commitProp('Translation', val)
        }
        isEditingRef.current = false
    }

    const handleCommitRot = () => {
        const e: [number, number, number] = [
            parseFloat(rotRefs.current.x?.value || '0') || 0,
            parseFloat(rotRefs.current.y?.value || '0') || 0,
            parseFloat(rotRefs.current.z?.value || '0') || 0
        ]
        const q = eulerToQuat(e)
        commitProp('Rotation', q)
        isEditingRef.current = false
    }

    const handleCommitScale = () => {
        const val: [number, number, number] = [
            parseFloat(scaleRefs.current.x?.value || '1') || 1,
            parseFloat(scaleRefs.current.y?.value || '1') || 1,
            parseFloat(scaleRefs.current.z?.value || '1') || 1
        ]
        commitProp('Scaling', val)
        isEditingRef.current = false
    }



    const handleParentChange = (value: number | undefined) => {
        if (!renderer || !selectedNode) return
        executeCommand(new SetNodeParentCommand(renderer, selectedNode.ObjectId, value))
        message.success('已修改父节点')
    }

    const availableParents = useMemo(() => {
        if (!selectedNode) return []
        const descendantIds = new Set<number>([selectedNode.ObjectId])
        const stack = [selectedNode.ObjectId]
        while (stack.length > 0) {
            const curr = stack.pop()!
            nodes.filter(n => n.Parent === curr).forEach(c => {
                if (!descendantIds.has(c.ObjectId)) { descendantIds.add(c.ObjectId); stack.push(c.ObjectId) }
            })
        }
        return nodes.filter(n => !descendantIds.has(n.ObjectId)).map(n => ({ label: `${n.Name} (${n.ObjectId})`, value: n.ObjectId }))
    }, [nodes, selectedNode])

    const commitGeosetAnims = useCallback((historyName: string, updater: (nextAnims: any[]) => void) => {
        if (!modelData) return
        const oldAnims = deepClone((modelData as any).GeosetAnims || [])
        const nextAnims = deepClone(oldAnims)
        updater(nextAnims)

        useHistoryStore.getState().push({
            name: historyName,
            undo: () => setGeosetAnims(deepClone(oldAnims)),
            redo: () => setGeosetAnims(deepClone(nextAnims))
        })

        setGeosetAnims(nextAnims)
    }, [modelData, setGeosetAnims])

    const handleInsertGeosetAlphaKey = useCallback(() => {
        if (selectedGeosetIds.length === 0) return
        const frame = Math.round(currentFrame)
        const alpha = Math.max(0, Math.min(1, Number(geosetAlphaInput)))
        commitGeosetAnims(`Geoset Alpha Key x${selectedGeosetIds.length}`, (nextAnims) => {
            selectedGeosetIds.forEach((geosetId) => {
                let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) {
                    nextAnims.push({ GeosetId: geosetId, Alpha: 1, Color: [1, 1, 1], Flags: 0, UseColor: true, DropShadow: false })
                    index = nextAnims.length - 1
                }
                const currentAnim = { ...nextAnims[index] }
                const track = isAnimTrack(currentAnim.Alpha)
                    ? { ...currentAnim.Alpha, Keys: normalizeScalarKeys(currentAnim.Alpha.Keys) }
                    : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
                track.Keys = upsertScalarKey(track.Keys, 0, 1)
                track.Keys = upsertScalarKey(track.Keys, frame, alpha)
                currentAnim.Alpha = track
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, currentFrame, geosetAlphaInput, commitGeosetAnims])

    const handleDeleteGeosetAlphaKey = useCallback(() => {
        if (selectedGeosetIds.length === 0) return
        const frame = Math.round(currentFrame)
        commitGeosetAnims(`Delete Geoset Alpha Key x${selectedGeosetIds.length}`, (nextAnims) => {
            selectedGeosetIds.forEach((geosetId) => {
                const index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) return
                const currentAnim = { ...nextAnims[index] }
                const track = isAnimTrack(currentAnim.Alpha)
                    ? { ...currentAnim.Alpha, Keys: normalizeScalarKeys(currentAnim.Alpha.Keys) }
                    : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
                track.Keys = removeKeyByFrame(track.Keys, frame, 1)
                track.Keys = upsertScalarKey(track.Keys, 0, 1)
                currentAnim.Alpha = track
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, currentFrame, commitGeosetAnims])

    const handleInsertGeosetColorKey = useCallback(() => {
        if (selectedGeosetIds.length === 0) return
        const frame = Math.round(currentFrame)
        const color: [number, number, number] = [
            Math.max(0, Math.min(1, Number(geosetColorInput[0] ?? 1))),
            Math.max(0, Math.min(1, Number(geosetColorInput[1] ?? 1))),
            Math.max(0, Math.min(1, Number(geosetColorInput[2] ?? 1)))
        ]
        commitGeosetAnims(`Geoset Color Key x${selectedGeosetIds.length}`, (nextAnims) => {
            selectedGeosetIds.forEach((geosetId) => {
                let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) {
                    nextAnims.push({ GeosetId: geosetId, Alpha: 1, Color: [1, 1, 1], Flags: 0, UseColor: true, DropShadow: false })
                    index = nextAnims.length - 1
                }
                const currentAnim = { ...nextAnims[index], UseColor: true }
                const track = isAnimTrack(currentAnim.Color)
                    ? { ...currentAnim.Color, Keys: normalizeColorKeys(currentAnim.Color.Keys) }
                    : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
                track.Keys = upsertColorKey(track.Keys, frame, color)
                currentAnim.Color = track
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, currentFrame, geosetColorInput, commitGeosetAnims])

    const handleDeleteGeosetColorKey = useCallback(() => {
        if (selectedGeosetIds.length === 0) return
        const frame = Math.round(currentFrame)
        commitGeosetAnims(`Delete Geoset Color Key x${selectedGeosetIds.length}`, (nextAnims) => {
            selectedGeosetIds.forEach((geosetId) => {
                const index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) return
                const currentAnim = { ...nextAnims[index] }
                const track = isAnimTrack(currentAnim.Color)
                    ? { ...currentAnim.Color, Keys: normalizeColorKeys(currentAnim.Color.Keys) }
                    : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
                track.Keys = removeKeyByFrame(track.Keys, frame, 3)
                currentAnim.Color = track.Keys.length > 0 ? track : [1, 1, 1]
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, currentFrame, commitGeosetAnims])

    const applyStaticAlphaToTracklessGeosets = useCallback((alpha: number) => {
        if (selectedGeosetIds.length === 0) return
        const anims = (modelData as any)?.GeosetAnims
        const targets = selectedGeosetIds.filter((geosetId) => {
            if (!Array.isArray(anims)) return true
            const anim = anims.find((item: any) => Number(item?.GeosetId) === Number(geosetId))
            return !isAnimTrack(anim?.Alpha)
        })
        if (targets.length === 0) return

        commitGeosetAnims(`Set Geoset Static Alpha x${targets.length}`, (nextAnims) => {
            targets.forEach((geosetId) => {
                let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) {
                    nextAnims.push({ GeosetId: geosetId, Alpha: 1, Color: [1, 1, 1], Flags: 0, UseColor: true, DropShadow: false })
                    index = nextAnims.length - 1
                }
                const currentAnim = { ...nextAnims[index] }
                currentAnim.Alpha = alpha
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, modelData, commitGeosetAnims])

    const applyStaticColorToTracklessGeosets = useCallback((color: [number, number, number]) => {
        if (selectedGeosetIds.length === 0) return
        const anims = (modelData as any)?.GeosetAnims
        const targets = selectedGeosetIds.filter((geosetId) => {
            if (!Array.isArray(anims)) return true
            const anim = anims.find((item: any) => Number(item?.GeosetId) === Number(geosetId))
            return !isAnimTrack(anim?.Color)
        })
        if (targets.length === 0) return

        commitGeosetAnims(`Set Geoset Static Color x${targets.length}`, (nextAnims) => {
            targets.forEach((geosetId) => {
                let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) {
                    nextAnims.push({ GeosetId: geosetId, Alpha: 1, Color: [1, 1, 1], Flags: 0, UseColor: true, DropShadow: false })
                    index = nextAnims.length - 1
                }
                const currentAnim = { ...nextAnims[index], UseColor: true }
                currentAnim.Color = [color[0], color[1], color[2]]
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, modelData, commitGeosetAnims])

    const handleGeosetAlphaInputChange = useCallback((value: number | null) => {
        const alpha = Math.max(0, Math.min(1, Number(value ?? 1)))
        setGeosetAlphaInput(alpha)
        applyStaticAlphaToTracklessGeosets(alpha)
    }, [applyStaticAlphaToTracklessGeosets])

    const handleGeosetColorInputChange = useCallback((color: any) => {
        setGeosetColorInput((prev) => parseColorToNormalized(color, prev))
    }, [])

    const handleGeosetColorInputChangeComplete = useCallback((color: any) => {
        const nextColor = parseColorToNormalized(color, geosetColorInput)
        setGeosetColorInput(nextColor)
        applyStaticColorToTracklessGeosets(nextColor)
    }, [geosetColorInput, applyStaticColorToTracklessGeosets])

    const handleSaveGeosetKeyframeEditor = useCallback((animVector: any) => {
        if (!editingGeosetField || activeGeosetId === null) {
            setIsGeosetEditorOpen(false)
            return
        }
        const frame = Math.round(currentFrame)
        commitGeosetAnims(`Edit Geoset ${activeGeosetId} ${editingGeosetField}`, (nextAnims) => {
            let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(activeGeosetId))
            if (index < 0) {
                nextAnims.push({ GeosetId: activeGeosetId, Alpha: 1, Color: [1, 1, 1], Flags: 0, UseColor: true, DropShadow: false })
                index = nextAnims.length - 1
            }
            const currentAnim = { ...nextAnims[index] }
            if (editingGeosetField === 'Alpha') {
                const keys = upsertScalarKey(normalizeScalarKeys(animVector?.Keys || []), 0, 1)
                currentAnim.Alpha = {
                    LineType: typeof animVector?.LineType === 'number' ? animVector.LineType : 1,
                    GlobalSeqId: animVector?.GlobalSeqId ?? null,
                    Keys: keys.length > 0 ? keys : upsertScalarKey([], frame, 1)
                }
            } else {
                const keys = normalizeColorKeys(animVector?.Keys || [])
                currentAnim.Color = {
                    LineType: typeof animVector?.LineType === 'number' ? animVector.LineType : 1,
                    GlobalSeqId: animVector?.GlobalSeqId ?? null,
                    Keys: keys
                }
                currentAnim.UseColor = true
            }
            nextAnims[index] = currentAnim
        })
        setIsGeosetEditorOpen(false)
    }, [editingGeosetField, activeGeosetId, currentFrame, commitGeosetAnims])

    const geosetEditorData = useMemo(() => {
        if (!editingGeosetField) return null
        if (editingGeosetField === 'Alpha') {
            if (isAnimTrack(activeGeosetAnim?.Alpha)) return activeGeosetAnim?.Alpha
            return {
                LineType: 1,
                GlobalSeqId: null,
                Keys: [{ Frame: 0, Vector: [currentGeosetAlpha], InTan: [0], OutTan: [0] }]
            }
        }
        if (isAnimTrack(activeGeosetAnim?.Color)) return activeGeosetAnim?.Color
        return {
            LineType: 1,
            GlobalSeqId: null,
            Keys: [{ Frame: 0, Vector: [...currentGeosetColor], InTan: [0, 0, 0], OutTan: [0, 0, 0] }]
        }
    }, [editingGeosetField, activeGeosetAnim, currentGeosetAlpha, currentGeosetColor])

    const isKeyframeCompact = animationSubMode === 'keyframe'
    const compactUi = {
        statPadding: isKeyframeCompact ? '6px 8px' : '8px 10px',
        statFontSize: isKeyframeCompact ? '10px' : '11px',
        sectionPadding: isKeyframeCompact ? '8px' : '10px',
        sectionTitleSize: isKeyframeCompact ? '12px' : '13px',
        toggleGap: isKeyframeCompact ? 4 : 6,
        toggleFontSize: isKeyframeCompact ? 10 : 11,
        togglePadding: isKeyframeCompact ? '1px 6px' : '2px 6px',
        topGap: isKeyframeCompact ? 8 : 10,
        nodeNameMarginBottom: isKeyframeCompact ? 8 : 12,
        nodeNameFontSize: isKeyframeCompact ? '11px' : '12px',
        groupMarginBottom: isKeyframeCompact ? 8 : 12,
        groupTopMargin: isKeyframeCompact ? 2 : 4,
        fieldFontSize: isKeyframeCompact ? '10px' : '11px',
        axisFontSize: isKeyframeCompact ? '10px' : '11px',
        axisMarginRight: isKeyframeCompact ? 6 : 8,
        inputMarginBottom: isKeyframeCompact ? 2 : 4,
        inputPadding: isKeyframeCompact ? '2px 6px' : '4px 8px',
        inputFontSize: isKeyframeCompact ? '11px' : '12px',
        interpSelectWidth: isKeyframeCompact ? 64 : 70,
        parentMarginBottom: isKeyframeCompact ? 8 : 10,
        controlMarginTop: isKeyframeCompact ? 2 : 4,
        geosetRowGap: isKeyframeCompact ? 4 : 6
    }

    // --- 渲染部分 ---

    // 输入行渲染，支持禁用状态
    const renderInputRow = (label: string, refs: any, axis: 'x' | 'y' | 'z', color: string, onCommit: () => void, disabled?: boolean) => (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: compactUi.inputMarginBottom }}>
            <span style={{ color: disabled ? '#555' : color, marginRight: compactUi.axisMarginRight, fontSize: compactUi.axisFontSize, width: 12 }}>{axis.toUpperCase()}</span>
            <input
                ref={el => refs.current[axis] = el}
                type="number"
                step="0.1"
                disabled={disabled}
                onFocus={handleFocus}
                onBlur={onCommit}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onCommit() }}
                style={{
                    flex: 1,
                    background: disabled ? '#252525' : '#1f1f1f',
                    border: disabled ? '1px solid #333' : '1px solid #444',
                    borderRadius: 4,
                    color: disabled ? '#555' : '#fff',
                    padding: compactUi.inputPadding,
                    fontSize: compactUi.inputFontSize,
                    outline: 'none',
                    cursor: disabled ? 'not-allowed' : 'text'
                }}
            />
        </div>
    )

    // 是否禁用输入（未选中单个骨骼时）
    const isInputDisabled = !selectedNode
    const globalSequences = (modelData as any)?.GlobalSequences || []

    return (
        <>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#2b2b2b', color: '#eee' }}>
            {/* 统计信息 */}
            <div style={{ padding: compactUi.statPadding, borderBottom: '1px solid #444', backgroundColor: '#333' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compactUi.statFontSize }}>
                    <span style={{ color: '#aaa' }}>选中顶点: <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{selectedVertexIds.length}</span></span>
                    {selectedNodeIds.length === 1 && <span style={{ color: '#aaa' }}>骨骼绑定: <span style={{ color: '#1890ff', fontWeight: 'bold' }}>{boneVertexCount}</span></span>}
                </div>
            </div>

            {/* 骨骼参数 */}
            <div style={{ padding: compactUi.sectionPadding, borderBottom: '1px solid #444' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong style={{ color: '#fff', fontSize: compactUi.sectionTitleSize }}>骨骼参数</Text>
                    <div style={{ display: 'flex', gap: compactUi.toggleGap }}>
                        <button
                            type="button"
                            onClick={() => setTranslationSpace('world')}
                            style={{
                                background: translationSpace === 'world' ? '#1890ff' : '#1f1f1f',
                                border: '1px solid #3a3a3a',
                                color: translationSpace === 'world' ? '#fff' : '#aaa',
                                fontSize: compactUi.toggleFontSize,
                                padding: compactUi.togglePadding,
                                borderRadius: 4,
                                cursor: 'pointer'
                            }}
                        >
                            {"\u4e16\u754c"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setTranslationSpace('local')}
                            style={{
                                background: translationSpace === 'local' ? '#1890ff' : '#1f1f1f',
                                border: '1px solid #3a3a3a',
                                color: translationSpace === 'local' ? '#fff' : '#aaa',
                                fontSize: compactUi.toggleFontSize,
                                padding: compactUi.togglePadding,
                                borderRadius: 4,
                                cursor: 'pointer'
                            }}
                        >
                            {"\u76f8\u5bf9"}
                        </button>
                    </div>
                </div>

                <div style={{ marginTop: compactUi.topGap }}>
                    {/* 骨骼名称 */}
                    <div style={{ marginBottom: compactUi.nodeNameMarginBottom, color: selectedNode ? '#aaa' : '#555', fontSize: compactUi.nodeNameFontSize }}>
                        {selectedNode ? `${selectedNode.Name} (${selectedNode.type})` : (
                            selectedNodeIds.length === 0 ? '未选择骨骼' : `已选择 ${selectedNodeIds.length} 个骨骼`
                        )}
                    </div>

                    {/* Translation */}
                    <div style={{ marginBottom: compactUi.groupMarginBottom }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: isInputDisabled ? '#555' : '#888', fontSize: compactUi.fieldFontSize }}>位移 (Translation) {selectedNode && hasExactKey('Translation') && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}</Text>
                            <Select
                                size="small"
                                value={selectedNode?.Translation?.InterpolationType ?? 1}
                                disabled={isInputDisabled}
                                onChange={(val) => {
                                    if (!selectedNode) return
                                    const node = selectedNode as any
                                    const { updateNodeSilent } = useModelStore.getState()
                                    updateNodeSilent(node.ObjectId, { Translation: { ...(node.Translation || { Keys: [] }), InterpolationType: val } })
                                    if (renderer) renderer.update(0)
                                }}
                                style={{ width: compactUi.interpSelectWidth, fontSize: '10px' }}
                                dropdownStyle={{ minWidth: 80 }}
                            >
                                <Select.Option value={0}>无</Select.Option>
                                <Select.Option value={1}>线性</Select.Option>
                                <Select.Option value={2}>平滑</Select.Option>
                                <Select.Option value={3}>贝塞尔</Select.Option>
                            </Select>
                        </div>
                        <div style={{ marginTop: compactUi.groupTopMargin }}>
                            {renderInputRow('X', transRefs, 'x', '#ff4d4f', handleCommitTrans, isInputDisabled)}
                            {renderInputRow('Y', transRefs, 'y', '#52c41a', handleCommitTrans, isInputDisabled)}
                            {renderInputRow('Z', transRefs, 'z', '#1890ff', handleCommitTrans, isInputDisabled)}
                        </div>
                    </div>

                    {/* Rotation */}
                    <div style={{ marginBottom: compactUi.groupMarginBottom }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: isInputDisabled ? '#555' : '#888', fontSize: compactUi.fieldFontSize }}>旋转 (Rotation) {selectedNode && hasExactKey('Rotation') && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}</Text>
                            <Select
                                size="small"
                                value={selectedNode?.Rotation?.InterpolationType ?? 1}
                                disabled={isInputDisabled}
                                onChange={(val) => {
                                    if (!selectedNode) return
                                    const node = selectedNode as any
                                    const { updateNodeSilent } = useModelStore.getState()
                                    updateNodeSilent(node.ObjectId, { Rotation: { ...(node.Rotation || { Keys: [] }), InterpolationType: val } })
                                    if (renderer) renderer.update(0)
                                }}
                                style={{ width: compactUi.interpSelectWidth, fontSize: '10px' }}
                                dropdownStyle={{ minWidth: 80 }}
                            >
                                <Select.Option value={0}>无</Select.Option>
                                <Select.Option value={1}>线性</Select.Option>
                                <Select.Option value={2}>平滑</Select.Option>
                                <Select.Option value={3}>贝塞尔</Select.Option>
                            </Select>
                        </div>
                        <div style={{ marginTop: compactUi.groupTopMargin }}>
                            {renderInputRow('X', rotRefs, 'x', '#ff4d4f', handleCommitRot, isInputDisabled)}
                            {renderInputRow('Y', rotRefs, 'y', '#52c41a', handleCommitRot, isInputDisabled)}
                            {renderInputRow('Z', rotRefs, 'z', '#1890ff', handleCommitRot, isInputDisabled)}
                        </div>
                    </div>

                    {/* Scaling */}
                    <div style={{ marginBottom: compactUi.groupMarginBottom }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: isInputDisabled ? '#555' : '#888', fontSize: compactUi.fieldFontSize }}>缩放 (Scaling) {selectedNode && hasExactKey('Scaling') && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}</Text>
                            <Select
                                size="small"
                                value={selectedNode?.Scaling?.InterpolationType ?? 1}
                                disabled={isInputDisabled}
                                onChange={(val) => {
                                    if (!selectedNode) return
                                    const node = selectedNode as any
                                    const { updateNodeSilent } = useModelStore.getState()
                                    updateNodeSilent(node.ObjectId, { Scaling: { ...(node.Scaling || { Keys: [] }), InterpolationType: val } })
                                    if (renderer) renderer.update(0)
                                }}
                                style={{ width: compactUi.interpSelectWidth, fontSize: '10px' }}
                                dropdownStyle={{ minWidth: 80 }}
                            >
                                <Select.Option value={0}>无</Select.Option>
                                <Select.Option value={1}>线性</Select.Option>
                                <Select.Option value={2}>平滑</Select.Option>
                                <Select.Option value={3}>贝塞尔</Select.Option>
                            </Select>
                        </div>
                        <div style={{ marginTop: compactUi.groupTopMargin }}>
                            {renderInputRow('X', scaleRefs, 'x', '#ff4d4f', handleCommitScale, isInputDisabled)}
                            {renderInputRow('Y', scaleRefs, 'y', '#52c41a', handleCommitScale, isInputDisabled)}
                            {renderInputRow('Z', scaleRefs, 'z', '#1890ff', handleCommitScale, isInputDisabled)}
                        </div>
                    </div>

                    {/* 父节点 */}
                    <div style={{ marginBottom: compactUi.parentMarginBottom }}>
                        <Text style={{ color: isInputDisabled ? '#555' : '#888', fontSize: compactUi.fieldFontSize }}>父节点</Text>
                        <Select
                            style={{ width: '100%', marginTop: compactUi.controlMarginTop }}
                            size="small"
                            placeholder="无父节点"
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            value={selectedNode?.Parent === -1 ? undefined : selectedNode?.Parent}
                            onChange={handleParentChange}
                            options={availableParents}
                            disabled={isInputDisabled || !renderer}
                        />
                    </div>

                    {animationSubMode === 'keyframe' && (
                        <div style={{ marginBottom: compactUi.groupMarginBottom, paddingTop: 6, borderTop: '1px solid #3a3a3a' }}>
                            <Text strong style={{ color: '#fff', fontSize: compactUi.sectionTitleSize }}>多边形组关键帧</Text>

                            <div style={{ marginTop: compactUi.controlMarginTop }}>
                                <Text style={{ color: '#888', fontSize: compactUi.fieldFontSize }}>多边形组（已选 {selectedGeosetIds.length}）</Text>
                                <Select
                                    size="small"
                                    style={{ width: '100%', marginTop: compactUi.controlMarginTop }}
                                    mode="multiple"
                                    maxTagCount={3}
                                    value={selectedGeosetIds}
                                    options={geosetIds.map((id) => ({ label: `Geoset ${id}`, value: id }))}
                                    onChange={(values) => setSelectedGeosetIndices(values as number[])}
                                    placeholder="无可用多边形组"
                                />
                            </div>

                            <div style={{ marginTop: compactUi.geosetRowGap }}>
                                <Text style={{ color: '#888', fontSize: compactUi.fieldFontSize }}>
                                    透明度 {hasExactGeosetAlphaKey && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}
                                </Text>
                                <div style={{ display: 'flex', gap: 6, marginTop: compactUi.controlMarginTop }}>
                                    <InputNumber
                                        size="small"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={geosetAlphaInput}
                                        onChange={handleGeosetAlphaInputChange}
                                        style={{ flex: 1 }}
                                    />
                                    <Button size="small" onClick={handleInsertGeosetAlphaKey} disabled={selectedGeosetIds.length === 0} style={{ backgroundColor: '#333', borderColor: '#555', color: '#ddd' }}>K透明度</Button>
                                    <Button size="small" onClick={handleDeleteGeosetAlphaKey} disabled={selectedGeosetIds.length === 0} style={{ backgroundColor: '#333', borderColor: '#555', color: '#ddd' }}>删帧</Button>
                                </div>
                            </div>

                            <div style={{ marginTop: compactUi.geosetRowGap }}>
                                <Text style={{ color: '#888', fontSize: compactUi.fieldFontSize }}>
                                    颜色 {hasExactGeosetColorKey && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}
                                </Text>
                                <div style={{ display: 'flex', gap: 6, marginTop: compactUi.controlMarginTop }}>
                                    <ColorPicker
                                        size="small"
                                        showText={false}
                                        format="rgb"
                                        value={`rgb(${Math.round((geosetColorInput[0] ?? 1) * 255)}, ${Math.round((geosetColorInput[1] ?? 1) * 255)}, ${Math.round((geosetColorInput[2] ?? 1) * 255)})`}
                                        onChange={handleGeosetColorInputChange}
                                        onChangeComplete={handleGeosetColorInputChangeComplete}
                                    />
                                    <Button size="small" onClick={handleInsertGeosetColorKey} disabled={selectedGeosetIds.length === 0} style={{ backgroundColor: '#333', borderColor: '#555', color: '#ddd' }}>K颜色</Button>
                                    <Button size="small" onClick={handleDeleteGeosetColorKey} disabled={selectedGeosetIds.length === 0} style={{ backgroundColor: '#333', borderColor: '#555', color: '#ddd' }}>删帧</Button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 6, marginTop: compactUi.geosetRowGap }}>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setEditingGeosetField('Alpha')
                                        setIsGeosetEditorOpen(true)
                                    }}
                                    disabled={selectedGeosetIds.length !== 1}
                                    style={{ backgroundColor: '#333', borderColor: '#555', color: '#ddd' }}
                                >
                                    编辑透明度轨道
                                </Button>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setEditingGeosetField('Color')
                                        setIsGeosetEditorOpen(true)
                                    }}
                                    disabled={selectedGeosetIds.length !== 1}
                                    style={{ backgroundColor: '#333', borderColor: '#555', color: '#ddd' }}
                                >
                                    编辑颜色轨道
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>


            {/* 绑定骨骼列表 - 仅在绑定模式显示 */}
            {animationSubMode === 'binding' && (
                <div style={{ flex: 1, overflow: 'auto', padding: '10px' }}>
                    <Text strong style={{ color: '#fff', fontSize: '13px' }}>绑定骨骼 ({boundBones.length})</Text>
                    {boundBones.length === 0 ? (
                        <div style={{ marginTop: 10, color: '#666', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>未选择顶点或无绑定</div>
                    ) : (
                        <div style={{ marginTop: 10 }}>
                            {boundBones.map(bone => (
                                <div key={bone.index} onClick={() => selectNodes([bone.index])}
                                    style={{
                                        padding: '6px 8px', cursor: 'pointer', fontSize: '12px', marginBottom: 2, borderRadius: 2, display: 'flex', alignItems: 'center',
                                        backgroundColor: selectedNodeIds.includes(bone.index) ? 'rgba(24, 144, 255, 0.3)' : 'transparent',
                                        border: selectedNodeIds.includes(bone.index) ? '1px solid #1890ff' : '1px solid transparent',
                                    }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', marginRight: 8, display: 'inline-block', backgroundColor: selectedNodeIds.includes(bone.index) ? '#1890ff' : '#52c41a' }} />
                                    {bone.name}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            </div>

            <KeyframeEditor
                visible={isGeosetEditorOpen}
                onCancel={() => setIsGeosetEditorOpen(false)}
                onOk={handleSaveGeosetKeyframeEditor}
                initialData={geosetEditorData}
                title={editingGeosetField === 'Color' ? '多边形组颜色关键帧' : '多边形组透明度关键帧'}
                vectorSize={editingGeosetField === 'Color' ? 3 : 1}
                globalSequences={globalSequences}
                fieldName={editingGeosetField || undefined}
            />
        </>
    )
}

export default React.memo(BoneParameterPanel)
