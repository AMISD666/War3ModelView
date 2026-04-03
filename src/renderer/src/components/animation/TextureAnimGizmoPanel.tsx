import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Select, Tooltip, Typography } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import {
    CheckOutlined,
    DragOutlined,
    ExpandOutlined,
    PlusOutlined,
    RotateRightOutlined
} from '@ant-design/icons'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useHistoryStore } from '../../store/historyStore'
import { listen } from '@tauri-apps/api/event'
import { windowManager } from '../../utils/WindowManager'
import { GlobalSequenceSelect } from '../common/GlobalSequenceSelect'
import RightFloatingPanelShell from './RightFloatingPanelShell'
import { invokeReadMpqFile } from '../../utils/mpqPerf'

const { Text } = Typography

type GizmoMode = 'translate' | 'rotate' | 'scale'
type GizmoAxis = 'x' | 'y' | 'xy' | null
const CANVAS_W = 280
const CANVAS_H = 280
const BASE_UNIT_SCALE = 120
const ORIGIN_PADDING_X = 28
const ORIGIN_PADDING_Y = 24
const GIZMO_AXIS_LENGTH = 56
const GIZMO_XY_BOX_SIZE = 12
const GIZMO_XY_BOX_OFFSET = 14

const INTERPOLATION_OPTIONS = [
    { label: 'None', value: 0 },
    { label: 'Linear', value: 1 },
    { label: 'Hermite', value: 2 },
    { label: 'Bezier', value: 3 }
]

const deepClone = <T,>(value: T): T => {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
}

const toVec = (input: any, size: number, fallback: number[]) => {
    const out = Array.isArray(input) ? [...input] : []
    while (out.length < size) out.push(fallback[out.length] ?? 0)
    return out.slice(0, size)
}

const isTrack = (value: any): value is { Keys: any[] } => !!value && typeof value === 'object' && Array.isArray(value.Keys)

const sampleTrack = (track: any, frame: number, fallback: number[]) => {
    if (!isTrack(track) || track.Keys.length === 0) return [...fallback]
    const keys = [...track.Keys].sort((a: any, b: any) => Number(a.Frame) - Number(b.Frame))
    if (frame <= keys[0].Frame) return toVec(keys[0].Vector, fallback.length, fallback)
    if (frame >= keys[keys.length - 1].Frame) return toVec(keys[keys.length - 1].Vector, fallback.length, fallback)
    for (let i = 0; i < keys.length - 1; i++) {
        const a = keys[i]
        const b = keys[i + 1]
        if (frame >= a.Frame && frame <= b.Frame) {
            const span = Number(b.Frame) - Number(a.Frame)
            if (span <= 0) return toVec(a.Vector, fallback.length, fallback)
            const t = (frame - Number(a.Frame)) / span
            const av = toVec(a.Vector, fallback.length, fallback)
            const bv = toVec(b.Vector, fallback.length, fallback)
            return av.map((v, idx) => v + (bv[idx] - v) * t)
        }
    }
    return [...fallback]
}

const degToRad = (deg: number) => deg * Math.PI / 180
const radToDeg = (rad: number) => rad * 180 / Math.PI

const quatToDegZ = (vec: number[]) => {
    if (vec.length >= 4) {
        const z = Number(vec[2] ?? 0)
        const w = Number(vec[3] ?? 1)
        return radToDeg(2 * Math.atan2(z, w))
    }
    return Number(vec[0] ?? 0)
}

const degToRotationVector = (deg: number, useQuat: boolean): number[] => {
    if (!useQuat) return [deg]
    const half = degToRad(deg) * 0.5
    return [0, 0, Math.sin(half), Math.cos(half)]
}

const toUint8Array = (payload: any): Uint8Array | null => {
    if (!payload) return null
    if (payload instanceof Uint8Array) return payload
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
    if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
    if (Array.isArray(payload)) return new Uint8Array(payload)
    return null
}

const toArrayBuffer = (payload: any): ArrayBuffer | null => {
    const bytes = toUint8Array(payload)
    if (!bytes) return null
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

const imageDataToDataUrl = (imageData: ImageData): string | null => {
    const canvas = document.createElement('canvas')
    canvas.width = imageData.width
    canvas.height = imageData.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL()
}

const sampleTextureIdFromLayer = (layer: any, frame: number): number | null => {
    const textureId = layer?.TextureID ?? layer?.TextureId
    if (typeof textureId === 'number' && Number.isFinite(textureId)) {
        return Math.round(textureId)
    }
    if (isTrack(textureId)) {
        const sampled = sampleTrack(textureId, frame, [0])
        const id = Number(sampled[0] ?? 0)
        return Number.isFinite(id) ? Math.round(id) : null
    }
    return null
}

const findTexturePathForTextureAnim = (modelData: any, textureAnimIndex: number, frame: number): string | null => {
    const materials = Array.isArray(modelData?.Materials) ? modelData.Materials : []
    const textures = Array.isArray(modelData?.Textures) ? modelData.Textures : []
    for (const material of materials) {
        const layers = Array.isArray(material?.Layers) ? material.Layers : []
        for (const layer of layers) {
            const tvId = layer?.TVertexAnimId ?? layer?.TextureAnimationId ?? layer?.TextureAnimId
            if (Number(tvId) !== textureAnimIndex) continue
            const textureId = sampleTextureIdFromLayer(layer, frame)
            if (textureId === null || textureId < 0 || textureId >= textures.length) continue
            const imagePath = textures[textureId]?.Image
            if (typeof imagePath === 'string' && imagePath.length > 0) {
                return imagePath
            }
        }
    }
    return null
}

type FormState = {
    tx: number
    ty: number
    rot: number
    sx: number
    sy: number
}

type DragState = {
    active: boolean
    button: 0 | 2
    mode: GizmoMode
    axis: GizmoAxis
    startForm: FormState
    startAngle: number
    startPointerWorld: { x: number; y: number }
    startPointerCanvas: { x: number; y: number }
    startPivotWorld: { x: number; y: number }
    startPivotCanvas: { x: number; y: number }
    startViewOffset: { x: number; y: number }
    startScaleRadius: number
}

type DragHud = {
    x: number
    y: number
    text: string
}

const TextureAnimGizmoPanel: React.FC = () => {
    const { modelData, modelPath, currentFrame, setTextureAnims } = useModelStore()
    const { selectedTextureAnimIndex, setSelectedTextureAnimIndex, timelineKeyframeDisplayMode } = useSelectionStore()
    const textureAnims = Array.isArray((modelData as any)?.TextureAnims) ? ((modelData as any).TextureAnims as any[]) : []
    const frame = Math.round(currentFrame)

    const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate')
    const [form, setForm] = useState<FormState>({ tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 })
    const [zoom, setZoom] = useState(1)
    const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 })
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null)
    const [hoverAxis, setHoverAxis] = useState<GizmoAxis>(null)
    const [activeAxis, setActiveAxis] = useState<GizmoAxis>(null)
    const [liveDelta, setLiveDelta] = useState({ x: 0, y: 0 })
    const [dragHud, setDragHud] = useState<DragHud | null>(null)
    const [panelCollapsed, setPanelCollapsed] = useState(true)

    useEffect(() => {
        setPanelCollapsed(timelineKeyframeDisplayMode !== 'textureAnim')
    }, [timelineKeyframeDisplayMode])
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    const dragRef = useRef<DragState>({
        active: false,
        button: 0,
        mode: 'translate',
        axis: null,
        startForm: { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1 },
        startAngle: 0,
        startPointerWorld: { x: 0, y: 0 },
        startPointerCanvas: { x: 0, y: 0 },
        startPivotWorld: { x: 0, y: 0 },
        startPivotCanvas: { x: 0, y: 0 },
        startViewOffset: { x: 0, y: 0 },
        startScaleRadius: 1
    })

    const currentAnim = (typeof selectedTextureAnimIndex === 'number' && selectedTextureAnimIndex >= 0 && selectedTextureAnimIndex < textureAnims.length)
        ? textureAnims[selectedTextureAnimIndex]
        : null

    useEffect(() => {
        if (textureAnims.length === 0) {
            if (selectedTextureAnimIndex !== null) setSelectedTextureAnimIndex(null)
            return
        }
        if (
            selectedTextureAnimIndex === null ||
            selectedTextureAnimIndex < 0 ||
            selectedTextureAnimIndex >= textureAnims.length
        ) {
            setSelectedTextureAnimIndex(0)
        }
    }, [textureAnims.length, selectedTextureAnimIndex, setSelectedTextureAnimIndex])

    const sampled = useMemo(() => {
        if (!currentAnim) return { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1], useQuat: true }
        const t = sampleTrack(currentAnim.Translation, frame, [0, 0, 0])
        const r = sampleTrack(currentAnim.Rotation, frame, [0, 0, 0, 1])
        const s = sampleTrack(currentAnim.Scaling, frame, [1, 1, 1])
        const useQuat = Array.isArray(r) && r.length >= 4
        return { t, r, s, useQuat }
    }, [currentAnim, frame])

    useEffect(() => {
        setForm({
            tx: Number((sampled.t[0] ?? 0).toFixed(4)),
            ty: Number((sampled.t[1] ?? 0).toFixed(4)),
            rot: Number(quatToDegZ(sampled.r).toFixed(2)),
            sx: Number((sampled.s[0] ?? 1).toFixed(4)),
            sy: Number((sampled.s[1] ?? 1).toFixed(4))
        })
    }, [sampled])

    useEffect(() => {
        setLiveDelta({ x: 0, y: 0 })
        setActiveAxis(null)
        setDragHud(null)
    }, [gizmoMode])

    const previewTexturePath = useMemo(() => {
        if (!modelData || selectedTextureAnimIndex === null || selectedTextureAnimIndex < 0) return null
        return findTexturePathForTextureAnim(modelData as any, selectedTextureAnimIndex, frame)
    }, [modelData, selectedTextureAnimIndex, frame])

    useEffect(() => {
        let canceled = false

        const loadPreview = async () => {
            if (!previewTexturePath) {
                setPreviewUrl(null)
                return
            }

            const candidates = modelPath
                ? getTextureCandidatePaths(modelPath, previewTexturePath)
                : [previewTexturePath]

            for (const candidate of candidates) {
                try {
                    const bytes = await readFile(candidate)
                    const imageData = decodeTextureData(bytes.buffer, previewTexturePath)
                    const url = imageData ? imageDataToDataUrl(imageData) : null
                    if (url) {
                        if (!canceled) setPreviewUrl(url)
                        return
                    }
                } catch {
                    // Try next candidate.
                }
            }

            try {
                const mpqData = await invokeReadMpqFile<Uint8Array>(normalizePath(previewTexturePath), 'TextureAnimGizmoPanel.preview')
                const buffer = toArrayBuffer(mpqData)
                if (buffer && buffer.byteLength > 0) {
                    const imageData = decodeTextureData(buffer, previewTexturePath)
                    const url = imageData ? imageDataToDataUrl(imageData) : null
                    if (!canceled) setPreviewUrl(url)
                    return
                }
            } catch {
                // Ignore MPQ load errors.
            }

            if (!canceled) setPreviewUrl(null)
        }

        loadPreview()
        return () => { canceled = true }
    }, [previewTexturePath, modelPath])

    useEffect(() => {
        if (!previewUrl) {
            setPreviewImage(null)
            return
        }
        const img = new Image()
        img.onload = () => setPreviewImage(img)
        img.onerror = () => setPreviewImage(null)
        img.src = previewUrl
    }, [previewUrl])

    const upsertTrackKey = useCallback((track: any, vector: number[]) => {
        if (!isTrack(track)) {
            track = { InterpolationType: 1, GlobalSeqId: -1, Keys: [] }
        }
        const idx = track.Keys.findIndex((k: any) => Number(k.Frame) === frame)
        const key = { Frame: frame, Vector: [...vector] }
        if (idx >= 0) track.Keys[idx] = key
        else {
            track.Keys.push(key)
            track.Keys.sort((a: any, b: any) => Number(a.Frame) - Number(b.Frame))
        }
        return track
    }, [frame])

    const commitForm = useCallback((next: FormState, historyName: string, scope: GizmoMode | 'all' = 'all') => {
        if (selectedTextureAnimIndex === null || selectedTextureAnimIndex < 0) return
        const oldAnims = deepClone(textureAnims)
        const newAnims = deepClone(textureAnims)
        if (!newAnims[selectedTextureAnimIndex]) newAnims[selectedTextureAnimIndex] = {}
        const anim = newAnims[selectedTextureAnimIndex]

        let changed = false
        if (scope === 'all' || scope === 'translate') {
            const t = [next.tx, next.ty, Number(sampled.t[2] ?? 0)]
            anim.Translation = upsertTrackKey(anim.Translation, t)
            changed = true
        }
        if (scope === 'all' || scope === 'rotate') {
            const r = degToRotationVector(next.rot, sampled.useQuat)
            anim.Rotation = upsertTrackKey(anim.Rotation, r)
            changed = true
        }
        if (scope === 'all' || scope === 'scale') {
            const s = [Math.max(0.0001, next.sx), Math.max(0.0001, next.sy), Number(sampled.s[2] ?? 1)]
            anim.Scaling = upsertTrackKey(anim.Scaling, s)
            changed = true
        }

        if (!changed) return

        useHistoryStore.getState().push({
            name: historyName,
            undo: () => setTextureAnims(deepClone(oldAnims)),
            redo: () => setTextureAnims(deepClone(newAnims))
        })
        setTextureAnims(newAnims)
    }, [selectedTextureAnimIndex, textureAnims, sampled, upsertTrackKey, setTextureAnims])

    const unitScale = BASE_UNIT_SCALE * zoom

    const getOrigin = useCallback(() => ({
        x: ORIGIN_PADDING_X + viewOffset.x,
        y: CANVAS_H - ORIGIN_PADDING_Y + viewOffset.y
    }), [viewOffset.x, viewOffset.y])

    const worldToCanvas = useCallback((x: number, y: number) => {
        const o = getOrigin()
        return { x: o.x + x * unitScale, y: o.y - y * unitScale }
    }, [getOrigin, unitScale])

    const canvasToWorld = useCallback((x: number, y: number) => {
        const o = getOrigin()
        return { x: (x - o.x) / unitScale, y: (o.y - y) / unitScale }
    }, [getOrigin, unitScale])

    const transformedQuad = useMemo(() => {
        const rad = degToRad(form.rot)
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        // Rotate around image center (0.5, 0.5) in UV space
        const cx = 0.5
        const cy = 0.5
        return [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1]
        ].map(([x, y]) => {
            const sx = x * form.sx
            const sy = y * form.sy
            // Translate to center, rotate, translate back
            const dx = sx - cx * form.sx
            const dy = sy - cy * form.sy
            const rx = dx * cos - dy * sin + cx * form.sx + form.tx
            const ry = dx * sin + dy * cos + cy * form.sy + form.ty
            return { x: rx, y: ry }
        })
    }, [form])

    const textureCenterWorld = useMemo(() => {
        // Center of the image in world space (0.5, 0.5 in UV scaled by sx, sy then translated)
        return {
            x: form.tx + 0.5 * form.sx,
            y: form.ty + 0.5 * form.sy
        }
    }, [form])

    const detectAxisAtCanvasPos = useCallback((x: number, y: number): GizmoAxis => {
        const pivot = worldToCanvas(textureCenterWorld.x, textureCenterWorld.y)

        if (gizmoMode === 'rotate') {
            // Circle hit-test for rotation
            const radius = GIZMO_AXIS_LENGTH * 0.85
            const dist = Math.hypot(x - pivot.x, y - pivot.y)
            if (Math.abs(dist - radius) < 10) return 'xy'
            return null
        }

        if (y >= pivot.y - 8 && y <= pivot.y + 8 && x >= pivot.x && x <= pivot.x + GIZMO_AXIS_LENGTH) return 'x'
        if (x >= pivot.x - 8 && x <= pivot.x + 8 && y >= pivot.y - GIZMO_AXIS_LENGTH && y <= pivot.y) return 'y'

        const boxLeft = pivot.x + GIZMO_XY_BOX_OFFSET
        const boxRight = boxLeft + GIZMO_XY_BOX_SIZE
        const boxTop = pivot.y - GIZMO_XY_BOX_OFFSET - GIZMO_XY_BOX_SIZE
        const boxBottom = boxTop + GIZMO_XY_BOX_SIZE
        if (x >= boxLeft && x <= boxRight && y >= boxTop && y <= boxBottom) return 'xy'

        return null
    }, [worldToCanvas, textureCenterWorld.x, textureCenterWorld.y, gizmoMode])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
        ctx.fillStyle = '#171717'
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

        ctx.strokeStyle = '#242424'
        ctx.lineWidth = 1
        for (let gx = -1; gx <= 4; gx++) {
            const p0 = worldToCanvas(gx * 0.25, -1)
            const p1 = worldToCanvas(gx * 0.25, 2)
            ctx.beginPath()
            ctx.moveTo(p0.x, p0.y)
            ctx.lineTo(p1.x, p1.y)
            ctx.stroke()
        }
        for (let gy = -1; gy <= 4; gy++) {
            const p0 = worldToCanvas(-1, gy * 0.25)
            const p1 = worldToCanvas(3, gy * 0.25)
            ctx.beginPath()
            ctx.moveTo(p0.x, p0.y)
            ctx.lineTo(p1.x, p1.y)
            ctx.stroke()
        }

        const origin = worldToCanvas(0, 0)
        const x1 = worldToCanvas(1.4, 0)
        const y1 = worldToCanvas(0, 1.4)
        ctx.strokeStyle = '#505050'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(origin.x, origin.y)
        ctx.lineTo(x1.x, x1.y)
        ctx.moveTo(origin.x, origin.y)
        ctx.lineTo(y1.x, y1.y)
        ctx.stroke()

        const defaultSquare = [
            worldToCanvas(0, 0),
            worldToCanvas(1, 0),
            worldToCanvas(1, 1),
            worldToCanvas(0, 1)
        ]
        ctx.strokeStyle = '#666'
        ctx.beginPath()
        ctx.moveTo(defaultSquare[0].x, defaultSquare[0].y)
        defaultSquare.slice(1).forEach((p) => ctx.lineTo(p.x, p.y))
        ctx.closePath()
        ctx.stroke()

        if (previewImage) {
            const rad = degToRad(form.rot)
            const cos = Math.cos(rad)
            const sin = Math.sin(rad)
            const o = getOrigin()

            // Pivot is at image center (0.5, 0.5) in UV space
            const pivotWX = form.tx + 0.5 * form.sx
            const pivotWY = form.ty + 0.5 * form.sy
            const pivotCanvas = worldToCanvas(pivotWX, pivotWY)

            ctx.save()
            ctx.translate(pivotCanvas.x, pivotCanvas.y)
            ctx.rotate(-rad) // canvas Y is flipped
            ctx.scale(unitScale * form.sx, -unitScale * form.sy)
            ctx.globalAlpha = 0.92
            ctx.imageSmoothingEnabled = true
            ctx.drawImage(previewImage, -0.5, -0.5, 1, 1)
            ctx.restore()
        }

        const points = transformedQuad.map((p) => worldToCanvas(p.x, p.y))
        ctx.strokeStyle = '#40a9ff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y))
        ctx.closePath()
        ctx.stroke()

        const pivot = worldToCanvas(textureCenterWorld.x, textureCenterWorld.y)
        const xActive = activeAxis === 'x' || hoverAxis === 'x'
        const yActive = activeAxis === 'y' || hoverAxis === 'y'
        const xyActive = activeAxis === 'xy' || hoverAxis === 'xy'

        if (gizmoMode === 'rotate') {
            // 旋转模式：画圆环
            const radius = GIZMO_AXIS_LENGTH * 0.85
            const isActive = xActive || yActive || xyActive
            ctx.lineWidth = isActive ? 3 : 2
            ctx.strokeStyle = isActive ? '#80d8ff' : '#40a9ff'
            ctx.beginPath()
            ctx.arc(pivot.x, pivot.y, radius, 0, Math.PI * 2)
            ctx.stroke()
            // 圆环上的小标记
            ctx.fillStyle = isActive ? '#80d8ff' : '#40a9ff'
            ctx.beginPath()
            ctx.arc(pivot.x + radius, pivot.y, 3, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            ctx.arc(pivot.x, pivot.y - radius, 3, 0, Math.PI * 2)
            ctx.fill()
            // 中心点
            ctx.fillStyle = '#fff'
            ctx.beginPath()
            ctx.arc(pivot.x, pivot.y, 2.5, 0, Math.PI * 2)
            ctx.fill()
        } else {
            // 位移/缩放模式：画轴线
            ctx.lineWidth = 2
            ctx.strokeStyle = xActive ? '#ff8a8a' : '#ff4d4f'
            ctx.beginPath()
            ctx.moveTo(pivot.x, pivot.y)
            ctx.lineTo(pivot.x + GIZMO_AXIS_LENGTH, pivot.y)
            ctx.stroke()
            // X 轴箭头
            ctx.fillStyle = xActive ? '#ff8a8a' : '#ff4d4f'
            ctx.beginPath()
            ctx.moveTo(pivot.x + GIZMO_AXIS_LENGTH, pivot.y)
            ctx.lineTo(pivot.x + GIZMO_AXIS_LENGTH - 6, pivot.y - 3)
            ctx.lineTo(pivot.x + GIZMO_AXIS_LENGTH - 6, pivot.y + 3)
            ctx.fill()

            ctx.strokeStyle = yActive ? '#95f19e' : '#52c41a'
            ctx.beginPath()
            ctx.moveTo(pivot.x, pivot.y)
            ctx.lineTo(pivot.x, pivot.y - GIZMO_AXIS_LENGTH)
            ctx.stroke()
            // Y 轴箭头
            ctx.fillStyle = yActive ? '#95f19e' : '#52c41a'
            ctx.beginPath()
            ctx.moveTo(pivot.x, pivot.y - GIZMO_AXIS_LENGTH)
            ctx.lineTo(pivot.x - 3, pivot.y - GIZMO_AXIS_LENGTH + 6)
            ctx.lineTo(pivot.x + 3, pivot.y - GIZMO_AXIS_LENGTH + 6)
            ctx.fill()

            // XY 联动手柄：偏移小方块，避免吞掉单轴命中
            const boxX = pivot.x + GIZMO_XY_BOX_OFFSET
            const boxY = pivot.y - GIZMO_XY_BOX_OFFSET - GIZMO_XY_BOX_SIZE
            ctx.fillStyle = xyActive ? 'rgba(255, 214, 102, 0.45)' : 'rgba(250, 173, 20, 0.25)'
            ctx.strokeStyle = xyActive ? '#ffd666' : '#faad14'
            ctx.lineWidth = 1.5
            ctx.fillRect(boxX, boxY, GIZMO_XY_BOX_SIZE, GIZMO_XY_BOX_SIZE)
            ctx.strokeRect(boxX, boxY, GIZMO_XY_BOX_SIZE, GIZMO_XY_BOX_SIZE)
        }
    }, [form, transformedQuad, worldToCanvas, previewImage, getOrigin, unitScale, activeAxis, hoverAxis, textureCenterWorld.x, textureCenterWorld.y, gizmoMode])

    const ensureSelection = useCallback(() => {
        if (textureAnims.length === 0) return false
        if (selectedTextureAnimIndex === null || selectedTextureAnimIndex < 0 || selectedTextureAnimIndex >= textureAnims.length) {
            setSelectedTextureAnimIndex(0)
            return false
        }
        return true
    }, [textureAnims.length, selectedTextureAnimIndex, setSelectedTextureAnimIndex])

    const onCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!ensureSelection()) return

        if (e.button === 2) {
            dragRef.current.active = true
            dragRef.current.button = 2
            dragRef.current.mode = gizmoMode
            dragRef.current.axis = null
            dragRef.current.startPointerCanvas = { x: e.clientX, y: e.clientY }
            dragRef.current.startViewOffset = { ...viewOffset }
            return
        }
        if (e.button !== 0) return

        const rect = e.currentTarget.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const mouse = canvasToWorld(cx, cy)
        const axis = detectAxisAtCanvasPos(cx, cy) ?? 'xy'

        dragRef.current.active = true
        dragRef.current.button = 0
        dragRef.current.mode = gizmoMode
        dragRef.current.axis = axis
        dragRef.current.startForm = { ...form }
        dragRef.current.startPointerCanvas = { x: cx, y: cy }
        dragRef.current.startPivotWorld = { x: textureCenterWorld.x, y: textureCenterWorld.y }
        dragRef.current.startPivotCanvas = worldToCanvas(textureCenterWorld.x, textureCenterWorld.y)
        dragRef.current.startAngle = Math.atan2(mouse.y - textureCenterWorld.y, mouse.x - textureCenterWorld.x)
        dragRef.current.startPointerWorld = { x: mouse.x, y: mouse.y }
        dragRef.current.startScaleRadius = Math.max(
            0.0001,
            Math.hypot(mouse.x - textureCenterWorld.x, mouse.y - textureCenterWorld.y)
        )
        setActiveAxis(axis)
        setLiveDelta({ x: 0, y: 0 })
        setDragHud(null)
    }, [ensureSelection, gizmoMode, viewOffset, canvasToWorld, detectAxisAtCanvasPos, form, textureCenterWorld.x, textureCenterWorld.y, worldToCanvas])

    const onCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top

        if (!dragRef.current.active) {
            setHoverAxis(detectAxisAtCanvasPos(cx, cy))
            return
        }

        if (dragRef.current.button === 2) {
            const dx = e.clientX - dragRef.current.startPointerCanvas.x
            const dy = e.clientY - dragRef.current.startPointerCanvas.y
            setViewOffset({
                x: dragRef.current.startViewOffset.x + dx,
                y: dragRef.current.startViewOffset.y + dy
            })
            setDragHud({
                x: cx + 12,
                y: cy + 12,
                text: `画布平移 X:${dx.toFixed(0)}  Y:${dy.toFixed(0)}`
            })
            return
        }

        const mouse = canvasToWorld(cx, cy)
        const start = dragRef.current.startForm
        const axis = dragRef.current.axis ?? 'xy'

        if (dragRef.current.mode === 'translate') {
            const dx = mouse.x - dragRef.current.startPointerWorld.x
            const dy = mouse.y - dragRef.current.startPointerWorld.y
            const tx = axis === 'y' ? start.tx : start.tx + dx
            const ty = axis === 'x' ? start.ty : start.ty + dy
            setForm((prev) => ({ ...prev, tx: Number(tx.toFixed(4)), ty: Number(ty.toFixed(4)) }))
            const deltaX = Number((tx - start.tx).toFixed(4))
            const deltaY = Number((ty - start.ty).toFixed(4))
            setLiveDelta({ x: deltaX, y: deltaY })
            setDragHud({
                x: cx + 12,
                y: cy + 12,
                text: `位移 ΔX:${deltaX.toFixed(4)}  ΔY:${deltaY.toFixed(4)}`
            })
            return
        }

        if (dragRef.current.mode === 'rotate') {
            const pivot = dragRef.current.startPivotWorld
            const nowAngle = Math.atan2(mouse.y - pivot.y, mouse.x - pivot.x)
            const deltaDeg = radToDeg(nowAngle - dragRef.current.startAngle)
            const rot = start.rot + deltaDeg
            setForm((prev) => ({ ...prev, rot: Number(rot.toFixed(2)) }))
            const deltaAngle = Number(deltaDeg.toFixed(2))
            setLiveDelta({ x: deltaAngle, y: deltaAngle })
            setDragHud({
                x: cx + 12,
                y: cy + 12,
                text: `旋转 Δ角度:${deltaAngle.toFixed(2)}°`
            })
            return
        }

        if (dragRef.current.mode === 'scale') {
            const sensitivity = 0.006
            const startPointerCanvas = dragRef.current.startPointerCanvas
            const startPivotCanvas = dragRef.current.startPivotCanvas
            let deltaPx = 0
            if (axis === 'x') {
                deltaPx = cx - startPointerCanvas.x
            } else if (axis === 'y') {
                deltaPx = startPointerCanvas.y - cy
            } else {
                const startVecX = startPointerCanvas.x - startPivotCanvas.x
                const startVecY = startPointerCanvas.y - startPivotCanvas.y
                const startLen = Math.max(0.0001, Math.hypot(startVecX, startVecY))
                const dirX = startVecX / startLen
                const dirY = startVecY / startLen

                const currentVecX = cx - startPivotCanvas.x
                const currentVecY = cy - startPivotCanvas.y
                const currentProjection = currentVecX * dirX + currentVecY * dirY
                deltaPx = currentProjection - startLen
            }

            const factor = Math.max(0.0001, Math.min(100, Math.exp(deltaPx * sensitivity)))
            // Single-axis: only affect the dragged axis; xy: affect both
            const sx = axis === 'y' ? start.sx : Math.max(0.0001, start.sx * factor)
            const sy = axis === 'x' ? start.sy : Math.max(0.0001, start.sy * factor)
            setForm((prev) => ({ ...prev, sx: Number(sx.toFixed(4)), sy: Number(sy.toFixed(4)) }))
            const deltaX = Number((sx - start.sx).toFixed(4))
            const deltaY = Number((sy - start.sy).toFixed(4))
            setLiveDelta({ x: deltaX, y: deltaY })
            setDragHud({
                x: cx + 12,
                y: cy + 12,
                text: axis === 'xy'
                    ? `缩放 倍率:${factor.toFixed(4)}  ΔX:${deltaX.toFixed(4)}  ΔY:${deltaY.toFixed(4)}`
                    : `缩放${axis.toUpperCase()} 倍率:${factor.toFixed(4)}  Δ${axis.toUpperCase()}:${(axis === 'x' ? deltaX : deltaY).toFixed(4)}`
            })
        }
    }, [canvasToWorld, detectAxisAtCanvasPos])

    const onCanvasMouseUp = useCallback(() => {
        if (!dragRef.current.active) return
        const wasTransformDrag = dragRef.current.button === 0
        const mode = dragRef.current.mode
        dragRef.current.active = false
        setActiveAxis(null)
        setDragHud(null)
        if (wasTransformDrag) {
            commitForm(form, '贴图动画轴变换', mode)
        }
    }, [commitForm, form])

    const onCanvasWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top

        const worldBefore = canvasToWorld(mx, my)
        const nextZoom = Math.max(0.25, Math.min(8, zoom * (e.deltaY < 0 ? 1.1 : 0.9)))
        const nextUnit = BASE_UNIT_SCALE * nextZoom

        const nextOffsetX = mx - ORIGIN_PADDING_X - worldBefore.x * nextUnit
        const nextOffsetY = my - (CANVAS_H - ORIGIN_PADDING_Y) + worldBefore.y * nextUnit

        setZoom(nextZoom)
        setViewOffset({ x: nextOffsetX, y: nextOffsetY })
    }, [zoom, canvasToWorld])

    const addTextureAnim = useCallback(() => {
        const oldAnims = deepClone(textureAnims)
        const newAnims = [...deepClone(textureAnims), {}]
        useHistoryStore.getState().push({
            name: '新建贴图动画',
            undo: () => setTextureAnims(deepClone(oldAnims)),
            redo: () => setTextureAnims(deepClone(newAnims))
        })
        setTextureAnims(newAnims)
        setSelectedTextureAnimIndex(newAnims.length - 1)
    }, [textureAnims, setTextureAnims, setSelectedTextureAnimIndex])

    const activeTrackMeta = useMemo(() => {
        const modeLabel = gizmoMode === 'translate'
            ? '位移'
            : gizmoMode === 'rotate'
                ? '旋转'
                : '缩放'
        const trackName = gizmoMode === 'translate'
            ? 'Translation'
            : gizmoMode === 'rotate'
                ? 'Rotation'
                : 'Scaling'
        const track = currentAnim?.[trackName]
        const globalSeqId = typeof track?.GlobalSeqId === 'number' ? track.GlobalSeqId : -1
        const interpolationType = typeof track?.InterpolationType === 'number' ? track.InterpolationType : 1
        return {
            modeLabel,
            trackName,
            globalSeqId,
            interpolationType
        }
    }, [gizmoMode, currentAnim])


    const updateTrackMeta = useCallback((patch: { GlobalSeqId?: number; InterpolationType?: number }) => {
        if (
            selectedTextureAnimIndex === null ||
            selectedTextureAnimIndex < 0 ||
            selectedTextureAnimIndex >= textureAnims.length
        ) return
        const oldAnims = deepClone(textureAnims)
        const newAnims = deepClone(textureAnims)
        if (!newAnims[selectedTextureAnimIndex]) newAnims[selectedTextureAnimIndex] = {}
        const anim = newAnims[selectedTextureAnimIndex]
        const oldTrack = anim[activeTrackMeta.trackName]
        const oldGlobalSeqId = typeof oldTrack?.GlobalSeqId === 'number' ? oldTrack.GlobalSeqId : -1
        const oldInterpolationType = typeof oldTrack?.InterpolationType === 'number' ? oldTrack.InterpolationType : 1

        const track = isTrack(oldTrack)
            ? oldTrack
            : { InterpolationType: oldInterpolationType, GlobalSeqId: oldGlobalSeqId, Keys: [] as any[] }
        const nextGlobalSeqId = patch.GlobalSeqId ?? oldGlobalSeqId
        const nextInterpolationType = patch.InterpolationType ?? oldInterpolationType

        if (nextGlobalSeqId === oldGlobalSeqId && nextInterpolationType === oldInterpolationType) return

        track.GlobalSeqId = nextGlobalSeqId
        track.InterpolationType = nextInterpolationType
        anim[activeTrackMeta.trackName] = track

        useHistoryStore.getState().push({
            name: `修改贴图动画${activeTrackMeta.modeLabel}轨道属性`,
            undo: () => setTextureAnims(deepClone(oldAnims)),
            redo: () => setTextureAnims(deepClone(newAnims))
        })
        setTextureAnims(newAnims)
    }, [selectedTextureAnimIndex, textureAnims, activeTrackMeta.trackName, activeTrackMeta.modeLabel, setTextureAnims])

    const currentTrackEditorData = useMemo(() => {
        const track = currentAnim?.[activeTrackMeta.trackName]
        if (isTrack(track)) return track
        return {
            Keys: [{ Frame: 0, Vector: activeTrackMeta.trackName === 'Rotation' ? [0, 0, 0, 1] : [0, 0, 0] }],
            LineType: activeTrackMeta.interpolationType,
            InterpolationType: activeTrackMeta.interpolationType,
            GlobalSeqId: activeTrackMeta.globalSeqId === -1 ? null : activeTrackMeta.globalSeqId
        }
    }, [currentAnim, activeTrackMeta.trackName, activeTrackMeta.interpolationType, activeTrackMeta.globalSeqId])

    const trackEditorVectorSize = useMemo(() => {
        if (activeTrackMeta.trackName === 'Translation') return 3
        if (activeTrackMeta.trackName === 'Scaling') return 3
        return sampled.useQuat ? 4 : 1
    }, [activeTrackMeta.trackName, sampled.useQuat])

    const openTrackEditorFromGlobalSeq = useCallback(() => {
        if (!ensureSelection()) return

        const payload = {
            callerId: 'TextureAnimGizmoPanel',
            initialData: currentTrackEditorData,
            title: `编辑关键帧: ${activeTrackMeta.trackName}`,
            vectorSize: trackEditorVectorSize,
            globalSequences: Array.isArray((modelData as any)?.GlobalSequences)
                ? (modelData as any).GlobalSequences.map((g: any) => (typeof g === 'number' ? g : g?.Duration)).filter((v: any) => typeof v === 'number')
                : [],
            sequences: (modelData as any)?.Sequences || [],
            fieldName: activeTrackMeta.trackName
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
        payload.targetWindowId = windowId;

        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload);
    }, [ensureSelection, currentTrackEditorData, activeTrackMeta, trackEditorVectorSize, modelData])

    const handleSaveTrackEditor = useCallback((animVector: any) => {
        if (
            selectedTextureAnimIndex === null ||
            selectedTextureAnimIndex < 0 ||
            selectedTextureAnimIndex >= textureAnims.length
        ) return

        const oldAnims = deepClone(textureAnims)
        const newAnims = deepClone(textureAnims)
        if (!newAnims[selectedTextureAnimIndex]) newAnims[selectedTextureAnimIndex] = {}
        const anim = newAnims[selectedTextureAnimIndex]
        const oldTrack = anim[activeTrackMeta.trackName]
        const prevInterpolation = typeof oldTrack?.InterpolationType === 'number' ? oldTrack.InterpolationType : 1
        const prevGlobalSeqId = typeof oldTrack?.GlobalSeqId === 'number' ? oldTrack.GlobalSeqId : -1

        const nextLineType = typeof animVector?.LineType === 'number'
            ? animVector.LineType
            : (typeof animVector?.InterpolationType === 'number' ? animVector.InterpolationType : prevInterpolation)
        const rawGlobalSeqId = animVector?.GlobalSeqId
        const nextGlobalSeqId = typeof rawGlobalSeqId === 'number'
            ? rawGlobalSeqId
            : (rawGlobalSeqId === null ? -1 : prevGlobalSeqId)

        anim[activeTrackMeta.trackName] = {
            ...(isTrack(oldTrack) ? oldTrack : { Keys: [] }),
            Keys: Array.isArray(animVector?.Keys) ? animVector.Keys : [],
            LineType: nextLineType,
            InterpolationType: nextLineType,
            GlobalSeqId: nextGlobalSeqId
        }

        useHistoryStore.getState().push({
            name: `编辑贴图动画${activeTrackMeta.modeLabel}TXT关键帧`,
            undo: () => setTextureAnims(deepClone(oldAnims)),
            redo: () => setTextureAnims(deepClone(newAnims))
        })
        setTextureAnims(newAnims)
    }, [selectedTextureAnimIndex, textureAnims, activeTrackMeta.trackName, activeTrackMeta.modeLabel, setTextureAnims])

    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any;
            if (payload && payload.callerId === 'TextureAnimGizmoPanel') {
                handleSaveTrackEditor(payload.data);
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [handleSaveTrackEditor]);

    const inputX = useMemo(() => {
        if (gizmoMode === 'translate') return form.tx
        if (gizmoMode === 'rotate') return form.rot
        return form.sx
    }, [gizmoMode, form])

    const inputY = useMemo(() => {
        if (gizmoMode === 'translate') return form.ty
        if (gizmoMode === 'rotate') return liveDelta.y
        return form.sy
    }, [gizmoMode, form, liveDelta.y])

    const onChangeInputX = (v: number | null) => {
        const n = Number(v ?? 0)
        if (gizmoMode === 'translate') setForm((prev) => ({ ...prev, tx: n }))
        else if (gizmoMode === 'rotate') setForm((prev) => ({ ...prev, rot: n }))
        else setForm((prev) => ({ ...prev, sx: Math.max(0.0001, n) }))
    }

    const onChangeInputY = (v: number | null) => {
        if (gizmoMode === 'rotate') return
        const n = Number(v ?? 0)
        if (gizmoMode === 'translate') setForm((prev) => ({ ...prev, ty: n }))
        else setForm((prev) => ({ ...prev, sy: Math.max(0.0001, n) }))
    }

    return (
        <RightFloatingPanelShell
            title="贴图动画"
            status={
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Select
                        size="small"
                        style={{ width: 100 }}
                        value={selectedTextureAnimIndex ?? undefined}
                        onChange={(v) => setSelectedTextureAnimIndex(v)}
                        placeholder="选择..."
                        options={textureAnims.map((_, i) => ({ label: `动画 ${i}`, value: i }))}
                    />
                    <Tooltip title="新建贴图动画">
                        <Button size="small" type="text" icon={<PlusOutlined />} onClick={addTextureAnim} style={{ padding: 0, width: 20, height: 20, color: '#ccc' }} />
                    </Tooltip>
                </div>
            }
            collapsed={panelCollapsed}
            onToggleCollapse={() => setPanelCollapsed(!panelCollapsed)}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Mode Select & Action */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                        <Tooltip title="位移">
                            <Button size="small" type={gizmoMode === 'translate' ? 'primary' : 'default'} icon={<DragOutlined />} onClick={() => setGizmoMode('translate')} />
                        </Tooltip>
                        <Tooltip title="旋转">
                            <Button size="small" type={gizmoMode === 'rotate' ? 'primary' : 'default'} icon={<RotateRightOutlined />} onClick={() => setGizmoMode('rotate')} />
                        </Tooltip>
                        <Tooltip title="缩放">
                            <Button size="small" type={gizmoMode === 'scale' ? 'primary' : 'default'} icon={<ExpandOutlined />} onClick={() => setGizmoMode('scale')} />
                        </Tooltip>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Button
                            size="small"
                            onClick={openTrackEditorFromGlobalSeq}
                            style={{ fontSize: 11, color: '#1890ff', borderColor: '#1890ff', background: 'transparent' }}
                        >
                            动画编辑
                        </Button>
                        <Button
                            size="small"
                            onClick={() => commitForm(form, '写入贴图动画关键帧', gizmoMode)}
                            style={{ background: '#333', borderColor: '#444', color: '#ddd' }}
                        >
                            K帧
                        </Button>
                    </div>
                </div>

                {/* Canvas Area */}
                <div style={{ position: 'relative', background: '#111', borderRadius: 4, overflow: 'hidden', border: '1px solid #333' }}>
                    <canvas
                        ref={canvasRef}
                        width={CANVAS_W}
                        height={CANVAS_H}
                        style={{
                            width: '100%',
                            height: CANVAS_H,
                            display: 'block',
                            cursor: dragRef.current.active
                                ? 'grabbing'
                                : (hoverAxis ? 'grab' : 'crosshair')
                        }}
                        onMouseDown={onCanvasMouseDown}
                        onMouseMove={onCanvasMouseMove}
                        onMouseUp={onCanvasMouseUp}
                        onMouseLeave={onCanvasMouseUp}
                        onWheel={onCanvasWheel}
                        onContextMenu={(e) => e.preventDefault()}
                    />
                    {dragHud && (
                        <div
                            style={{
                                position: 'absolute',
                                left: dragHud.x,
                                top: dragHud.y,
                                background: 'rgba(0,0,0,0.85)',
                                border: '1px solid #444',
                                color: '#fff',
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 10,
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                                zIndex: 10,
                                boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                            }}
                        >
                            {dragHud.text}
                        </div>
                    )}
                </div>

                {/* Parameters Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 50px 1fr', gap: 8, alignItems: 'center' }}>
                    <Text style={{ color: '#888', fontSize: 11 }}>X轴</Text>
                    <InputNumber size="small" value={inputX} onChange={onChangeInputX} style={{ width: '100%' }} />
                    <Text style={{ color: '#888', fontSize: 11 }}>Y轴</Text>
                    <InputNumber size="small" value={inputY} onChange={onChangeInputY} disabled={gizmoMode === 'rotate'} style={{ width: '100%' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr 50px 120px', gap: 8, alignItems: 'center' }}>
                    <Text style={{ color: '#888', fontSize: 11 }}>全局序列</Text>
                    <GlobalSequenceSelect
                        size="small"
                        style={{ width: '100%' }}
                        value={activeTrackMeta.globalSeqId === -1 ? null : activeTrackMeta.globalSeqId}
                        onChange={(value) => updateTrackMeta({ GlobalSeqId: value ?? -1 })}
                    />
                    <Text style={{ color: '#888', fontSize: 11 }}>插值类型</Text>
                    <Select
                        size="small"
                        value={activeTrackMeta.interpolationType}
                        options={INTERPOLATION_OPTIONS}
                        onChange={(value) => updateTrackMeta({ InterpolationType: Number(value) })}
                    />
                </div>
            </div>
        </RightFloatingPanelShell>
    )
}

export default React.memo(TextureAnimGizmoPanel)
