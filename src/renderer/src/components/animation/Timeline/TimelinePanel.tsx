import React, { useRef, useEffect, useState, useCallback, useMemo, useLayoutEffect } from 'react'
import { mergeMaterialManagerPreview, useModelStore } from '../../../store/modelStore'
import { useSelectionStore, type KeyframeDisplayMode } from '../../../store/selectionStore'
import { useRendererStore } from '../../../store/rendererStore'
import {
    PlayCircleOutlined,
    PauseCircleOutlined,
    StepBackwardOutlined,
    StepForwardOutlined,
    FastBackwardOutlined,
    FastForwardOutlined,
    ZoomInOutlined,
    ZoomOutOutlined,
    EyeOutlined,
    EyeInvisibleOutlined,
    DownOutlined,
    NodeIndexOutlined
} from '@ant-design/icons'
import { useHistoryStore } from '../../../store/historyStore'
import { Button, Slider, Input, Radio, Tooltip, Modal, Dropdown } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { registerShortcutHandler } from '../../../shortcuts/manager'
import { UpdateKeyframeCommand, KeyframeChange } from '../../../commands/UpdateKeyframeCommand'
import { commandManager } from '../../../utils/CommandManager'

interface TimelinePanelProps {
    isActive?: boolean
}

// Constants
const RULER_HEIGHT = 28
// Track visual settings
const KEYFRAME_SIZE = 10
const SNAP_THRESHOLD_X = 90 // px, fallback snap threshold in X
const MIN_SNAP_THRESHOLD_X = 10 // px, lower bound for dynamic threshold
const MAX_SNAP_THRESHOLD_X = 160 // px, upper bound for dynamic threshold
const CLICK_MOVE_THRESHOLD = 5 // px, max movement to count as click

const LANE_HEIGHT = 14
const LANE_PADDING = 10
const SEQUENCE_TRACK_HEIGHT = 30
const OFFSET_TRANSLATION = 12
const OFFSET_ROTATION = 26
const OFFSET_SCALING = 40
const CONTEXT_MENU_WIDTH = 170
const CONTEXT_MENU_HEIGHT = 160
const MIN_ZOOM_RANGE_PADDING_RATIO = 0.1

const dimHexColor = (hex: string, factor = 0.22) => {
    const normalized = hex.startsWith('#') ? hex.slice(1) : hex
    const expanded = normalized.length === 3
        ? normalized.split('').map((ch) => ch + ch).join('')
        : normalized
    if (expanded.length !== 6) return hex
    const r = parseInt(expanded.slice(0, 2), 16)
    const g = parseInt(expanded.slice(2, 4), 16)
    const b = parseInt(expanded.slice(4, 6), 16)
    if ([r, g, b].some((v) => Number.isNaN(v))) return hex
    const gray = 24
    const mix = (value: number) => Math.max(0, Math.min(255, Math.round(value * factor + gray * (1 - factor))))
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

const makeKeyframeUid = (ownerType: 'node' | 'geoset' | 'textureAnim' | 'materialLayer', ownerId: number, type: string, frame: number) =>
    `${ownerType}-${ownerId}-${type}-${frame}`

const MATERIAL_LAYER_OWNER_MULTIPLIER = 100000

const encodeMaterialLayerOwnerId = (materialIndex: number, layerIndex: number) =>
    materialIndex * MATERIAL_LAYER_OWNER_MULTIPLIER + layerIndex

const decodeMaterialLayerOwnerId = (ownerId: number) => ({
    materialIndex: Math.floor(ownerId / MATERIAL_LAYER_OWNER_MULTIPLIER),
    layerIndex: ownerId % MATERIAL_LAYER_OWNER_MULTIPLIER
})

const PARTICLE_TRACK_INFOS = [
    { type: 'ParticleVisibility', propName: 'Visibility' },
    { type: 'ParticleEmissionRate', propName: 'EmissionRate' },
    { type: 'ParticleSpeed', propName: 'Speed' },
    { type: 'ParticleVariation', propName: 'Variation' },
    { type: 'ParticleLatitude', propName: 'Latitude' },
    { type: 'ParticleLength', propName: 'Length' },
    { type: 'ParticleWidth', propName: 'Width' },
    { type: 'ParticleGravity', propName: 'Gravity' }
] as const

type ParticleTrackType = typeof PARTICLE_TRACK_INFOS[number]['type']
const PARTICLE_KEYFRAME_TYPES = PARTICLE_TRACK_INFOS.map((item) => item.type) as ParticleTrackType[]

const getParticleTrackInfo = (type: string): { type: ParticleTrackType; propName: string; vectorSize: 1 } | null => {
    const hit = PARTICLE_TRACK_INFOS.find((item) => item.type === type)
    if (!hit) return null
    return { type: hit.type, propName: hit.propName, vectorSize: 1 }
}

const isParticleEmitter2Node = (node: any): boolean => {
    const t = String(node?.type ?? '')
    return t === 'ParticleEmitter2'
}

const getNodeTrackPropertyName = (type: string): string => {
    const particleTrack = getParticleTrackInfo(type)
    if (particleTrack) return particleTrack.propName
    return type
}

const cloneNodesForKeyframes = (input: any[]) => {
    if (typeof structuredClone === 'function') {
        return structuredClone(input)
    }
    const toArray = (v: any, size: number) => {
        if (!v) return v
        if (Array.isArray(v)) return [...v]
        if (ArrayBuffer.isView(v)) return Array.from(v as any)
        if (typeof v === 'object') {
            const out = new Array(size)
            for (let i = 0; i < size; i++) {
                out[i] = v[i] ?? 0
            }
            return out
        }
        return v
    }
    const cloneTrack = (track: any, size: number) => {
        if (!track) return track
        const keys = Array.isArray(track.Keys) ? track.Keys.map((k: any) => ({
            ...k,
            Vector: toArray(k.Vector, size),
            InTan: toArray(k.InTan, size),
            OutTan: toArray(k.OutTan, size)
        })) : track.Keys
        return { ...track, Keys: keys }
    }
    const cloneScalarParticleTrack = (node: any, propName: string) => {
        const track = node?.[propName]
        if (!track || typeof track !== 'object' || !Array.isArray(track.Keys)) return track
        return cloneTrack(node[propName], 1)
    }
    return input.map((n: any) => ({
        ...n,
        Translation: cloneTrack(n.Translation, 3),
        Rotation: cloneTrack(n.Rotation, 4),
        Scaling: cloneTrack(n.Scaling, 3),
        Visibility: cloneScalarParticleTrack(n, 'Visibility'),
        EmissionRate: cloneScalarParticleTrack(n, 'EmissionRate'),
        Speed: cloneScalarParticleTrack(n, 'Speed'),
        Variation: cloneScalarParticleTrack(n, 'Variation'),
        Latitude: cloneScalarParticleTrack(n, 'Latitude'),
        Length: cloneScalarParticleTrack(n, 'Length'),
        Width: cloneScalarParticleTrack(n, 'Width'),
        Gravity: cloneScalarParticleTrack(n, 'Gravity')
    }))
}

const isAnimTrack = (value: any): value is { Keys: any[] } => {
    return !!value && typeof value === 'object' && Array.isArray(value.Keys)
}

const getTrackGlobalSeqId = (track: any): number => {
    const raw = track?.GlobalSeqId
    return typeof raw === 'number' ? raw : -1
}

const NODE_KEYFRAME_TYPES = ['Translation', 'Rotation', 'Scaling'] as const
const GEOSET_ANIM_KEYFRAME_TYPES = ['GeosetAlpha', 'GeosetColor'] as const
const MATERIAL_KEYFRAME_TYPES = ['MaterialTextureID', 'MaterialAlpha'] as const
const KEYFRAME_DISPLAY_MODE_ORDER: KeyframeDisplayMode[] = ['node', 'geosetAnim', 'particle', 'textureAnim', 'material']

const KEYFRAME_DISPLAY_MODE_CONFIG: Record<KeyframeDisplayMode, {
    label: string
    tooltip: string
    buttonColor: string
    laneTypes: string[]
}> = {
    node: {
        label: '节点模式',
        tooltip: '关键帧显示: 节点位移/旋转/缩放',
        buttonColor: '#1f4f8f',
        laneTypes: [...NODE_KEYFRAME_TYPES]
    },
    geosetAnim: {
        label: '多边形动画',
        tooltip: '关键帧显示: 多边形动画透明度/颜色',
        buttonColor: '#7a4d10',
        laneTypes: [...GEOSET_ANIM_KEYFRAME_TYPES]
    },
    particle: {
        label: '粒子模式',
        tooltip: '关键帧显示: 粒子参数关键帧（统一轨道）',
        buttonColor: '#3f5f2a',
        laneTypes: [...PARTICLE_KEYFRAME_TYPES]
    },
    textureAnim: {
        label: '贴图动画',
        tooltip: '关键帧显示: 贴图动画参数，可以控制贴图的平移、旋转、缩放',
        buttonColor: '#5a2e70',
        laneTypes: ['TexTranslation', 'TexRotation', 'TexScaling']
    },
    material: {
        label: '材质模式',
        tooltip: '关键帧显示: 材质层透明度与贴图 ID 动态轨道',
        buttonColor: '#7a5d14',
        laneTypes: [...MATERIAL_KEYFRAME_TYPES]
    }
}

const getLaneTypesByMode = (mode: KeyframeDisplayMode): string[] => (
    KEYFRAME_DISPLAY_MODE_CONFIG[mode].laneTypes
)

const isKeyframeTypeVisible = (
    type: string,
    displayMode: KeyframeDisplayMode
) => {
    const laneTypes = getLaneTypesByMode(displayMode)
    return laneTypes.includes(type as typeof laneTypes[number])
}

type LaneMetrics = {
    laneYMap: Record<string, number>
    trackTop: number
    trackBottom: number
    laneGap: number
    effectiveKeyframeSize: number
}

const getLaneMetrics = (displayMode: KeyframeDisplayMode, canvasHeight: number): LaneMetrics => {
    const seqTrackY = canvasHeight - SEQUENCE_TRACK_HEIGHT
    const trackTop = RULER_HEIGHT + LANE_PADDING
    const trackBottom = seqTrackY - LANE_PADDING
    const laneTypes = getLaneTypesByMode(displayMode)
    const fallbackGap = OFFSET_ROTATION - OFFSET_TRANSLATION
    const laneGap = trackBottom > trackTop
        ? (trackBottom - trackTop) / Math.max(1, laneTypes.length - 1)
        : Math.max(1, fallbackGap)
    const laneYMap: Record<string, number> = {}

    if (displayMode === 'particle') {
        const unifiedLaneY = trackBottom > trackTop
            ? trackTop + (trackBottom - trackTop) * 0.5
            : RULER_HEIGHT + OFFSET_TRANSLATION
        laneTypes.forEach((laneType) => {
            laneYMap[laneType] = unifiedLaneY
        })
    } else {
        laneTypes.forEach((laneType, index) => {
            laneYMap[laneType] = trackBottom > trackTop
                ? trackTop + laneGap * index
                : RULER_HEIGHT + OFFSET_TRANSLATION + fallbackGap * index
        })
    }

    const effectiveKeyframeSize = Math.min(
        KEYFRAME_SIZE,
        Math.max(3, Math.floor(laneGap / 2) - 2)
    )

    return {
        laneYMap,
        trackTop,
        trackBottom,
        laneGap,
        effectiveKeyframeSize
    }
}

type KeyframeOwnerType = 'node' | 'geoset' | 'textureAnim' | 'materialLayer'

type TimelineClipboardKeyframe = {
    ownerType: KeyframeOwnerType
    ownerId: number
    type: string
    frame: number
    value: any
    inTan?: any
    outTan?: any
}

type DragKeyframeData = {
    ownerType: KeyframeOwnerType
    ownerId: number
    type: string
    originalFrame: number
    keyIndex: number
}

type TimelineKeyframeData = {
    ownerType: KeyframeOwnerType
    ownerId: number
    type: string
    frame: number
    keyIndex: number
    value: any
    inTan?: any
    outTan?: any
}

const cloneGeosetAnimsForKeyframes = (input: any[]) => {
    if (typeof structuredClone === 'function') {
        return structuredClone(input)
    }
    return input.map((anim: any) => ({
        ...anim,
        Alpha: isAnimTrack(anim?.Alpha)
            ? {
                ...anim.Alpha,
                Keys: anim.Alpha.Keys.map((key: any) => ({
                    ...key,
                    Vector: Array.isArray(key?.Vector) ? [...key.Vector] : key?.Vector,
                    InTan: Array.isArray(key?.InTan) ? [...key.InTan] : key?.InTan,
                    OutTan: Array.isArray(key?.OutTan) ? [...key.OutTan] : key?.OutTan
                }))
            }
            : anim?.Alpha,
        Color: isAnimTrack(anim?.Color)
            ? {
                ...anim.Color,
                Keys: anim.Color.Keys.map((key: any) => ({
                    ...key,
                    Vector: Array.isArray(key?.Vector) ? [...key.Vector] : key?.Vector,
                    InTan: Array.isArray(key?.InTan) ? [...key.InTan] : key?.InTan,
                    OutTan: Array.isArray(key?.OutTan) ? [...key.OutTan] : key?.OutTan
                }))
            }
            : anim?.Color
    }))
}

const getGeosetTrackInfo = (type: string): { propName: 'Alpha' | 'Color'; vectorSize: number } | null => {
    if (type === 'GeosetAlpha') return { propName: 'Alpha', vectorSize: 1 }
    if (type === 'GeosetColor') return { propName: 'Color', vectorSize: 3 }
    return null
}

const TEXTURE_ANIM_TRACK_INFOS = [
    { type: 'TexTranslation', propName: 'Translation', vectorSize: 3 as const, color: '#73d13d' },
    { type: 'TexRotation', propName: 'Rotation', vectorSize: 4 as const, color: '#40a9ff' },
    { type: 'TexScaling', propName: 'Scaling', vectorSize: 3 as const, color: '#ff85c0' }
] as const

type TextureAnimTrackType = typeof TEXTURE_ANIM_TRACK_INFOS[number]['type']

const TEXTURE_ANIM_KEYFRAME_TYPES = TEXTURE_ANIM_TRACK_INFOS.map((item) => item.type) as TextureAnimTrackType[]

const getTextureAnimTrackInfo = (type: string): { propName: 'Translation' | 'Rotation' | 'Scaling'; vectorSize: 3 | 4; color: string } | null => {
    const hit = TEXTURE_ANIM_TRACK_INFOS.find((item) => item.type === type)
    if (!hit) return null
    return { propName: hit.propName, vectorSize: hit.vectorSize, color: hit.color }
}

const MATERIAL_TRACK_INFOS = [
    { type: 'MaterialTextureID', propName: 'TextureID', vectorSize: 1 as const, color: '#faad14' },
    { type: 'MaterialAlpha', propName: 'Alpha', vectorSize: 1 as const, color: '#36cfc9' }
] as const

const getMaterialTrackInfo = (type: string): { propName: 'TextureID' | 'Alpha'; vectorSize: 1; color: string } | null => {
    const hit = MATERIAL_TRACK_INFOS.find((item) => item.type === type)
    if (!hit) return null
    return { propName: hit.propName, vectorSize: hit.vectorSize, color: hit.color }
}

const toVectorArray = (value: any, vectorSize: number, fallback: number[]) => {
    if (Array.isArray(value)) {
        const out = [...value]
        while (out.length < vectorSize) out.push(fallback[out.length] ?? 0)
        return out.slice(0, vectorSize)
    }
    if (ArrayBuffer.isView(value)) {
        const out = Array.from(value as any)
        while (out.length < vectorSize) out.push(fallback[out.length] ?? 0)
        return out.slice(0, vectorSize)
    }
    if (typeof value === 'number') {
        return [value]
    }
    return [...fallback]
}

const cloneTextureAnimsForKeyframes = (input: any[]) => {
    if (typeof structuredClone === 'function') {
        return structuredClone(input)
    }
    return input.map((anim: any) => ({
        ...anim,
        Translation: isAnimTrack(anim?.Translation)
            ? {
                ...anim.Translation,
                Keys: anim.Translation.Keys.map((key: any) => ({
                    ...key,
                    Vector: Array.isArray(key?.Vector) ? [...key.Vector] : key?.Vector,
                    InTan: Array.isArray(key?.InTan) ? [...key.InTan] : key?.InTan,
                    OutTan: Array.isArray(key?.OutTan) ? [...key.OutTan] : key?.OutTan
                }))
            }
            : anim?.Translation,
        Rotation: isAnimTrack(anim?.Rotation)
            ? {
                ...anim.Rotation,
                Keys: anim.Rotation.Keys.map((key: any) => ({
                    ...key,
                    Vector: Array.isArray(key?.Vector) ? [...key.Vector] : key?.Vector,
                    InTan: Array.isArray(key?.InTan) ? [...key.InTan] : key?.InTan,
                    OutTan: Array.isArray(key?.OutTan) ? [...key.OutTan] : key?.OutTan
                }))
            }
            : anim?.Rotation,
        Scaling: isAnimTrack(anim?.Scaling)
            ? {
                ...anim.Scaling,
                Keys: anim.Scaling.Keys.map((key: any) => ({
                    ...key,
                    Vector: Array.isArray(key?.Vector) ? [...key.Vector] : key?.Vector,
                    InTan: Array.isArray(key?.InTan) ? [...key.InTan] : key?.InTan,
                    OutTan: Array.isArray(key?.OutTan) ? [...key.OutTan] : key?.OutTan
                }))
            }
            : anim?.Scaling
    }))
}

const cloneMaterialsForKeyframes = (input: any[]) => {
    if (typeof structuredClone === 'function') {
        return structuredClone(input)
    }
    return input.map((material: any) => ({
        ...material,
        Layers: Array.isArray(material?.Layers)
            ? material.Layers.map((layer: any) => ({
                ...layer,
                TextureID: isAnimTrack(layer?.TextureID)
                    ? {
                        ...layer.TextureID,
                        Keys: layer.TextureID.Keys.map((key: any) => ({
                            ...key,
                            Vector: Array.isArray(key?.Vector) ? [...key.Vector] : key?.Vector,
                            InTan: Array.isArray(key?.InTan) ? [...key.InTan] : key?.InTan,
                            OutTan: Array.isArray(key?.OutTan) ? [...key.OutTan] : key?.OutTan
                        }))
                    }
                    : layer?.TextureID,
                Alpha: isAnimTrack(layer?.Alpha)
                    ? {
                        ...layer.Alpha,
                        Keys: layer.Alpha.Keys.map((key: any) => ({
                            ...key,
                            Vector: Array.isArray(key?.Vector) ? [...key.Vector] : key?.Vector,
                            InTan: Array.isArray(key?.InTan) ? [...key.InTan] : key?.InTan,
                            OutTan: Array.isArray(key?.OutTan) ? [...key.OutTan] : key?.OutTan
                        }))
                    }
                    : layer?.Alpha
            }))
            : material?.Layers
    }))
}

// Singleton loop counter for TimelinePanel (MUST be at module scope, not inside component)
let globalTimelineLoopId = 0

const TimelinePanel: React.FC<TimelinePanelProps> = ({ isActive = true }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const contextMenuRef = useRef<HTMLDivElement>(null)
    const rafRef = useRef<number | null>(null)
    const containerSizeRef = useRef<{ width: number; height: number }>({ width: 400, height: 180 })
    const [containerMeasureTick, setContainerMeasureTick] = useState(0)

    // Stores
    const {
        sequences,
        currentSequence,
        isPlaying,
        playbackSpeed,
        modelData,
        materialManagerPreview,
        nodes: modelNodes,
        selectedGeosetIndex,
        selectedGeosetIndices,
        setPlaying,
        setPlaybackSpeed,
        setFrame,
        setGeosetAnims,
        setTextureAnims,
        setMaterials,
    } = useModelStore()

    const {
        selectedNodeIds,
        pickedGeosetIndex,
        selectedTextureAnimIndex,
        setSelectedTextureAnimIndex,
        selectedMaterialIndex,
        selectedMaterialIndices,
        selectedMaterialLayerIndex,
        setSelectedMaterialIndex,
        setSelectedMaterialIndices,
        setSelectedMaterialLayerIndex,
        timelineKeyframeDisplayMode,
        setTimelineKeyframeDisplayMode,
        timelineGlobalSequenceFilter
    } = useSelectionStore()

    const effectiveModelData = useMemo(
        () => mergeMaterialManagerPreview(modelData, materialManagerPreview),
        [modelData, materialManagerPreview]
    )

    // Derived Global Info
    const globalSequences = useMemo<number[]>(() => {
        const raw = (effectiveModelData as any)?.GlobalSequences
        return Array.isArray(raw)
            ? raw.map((entry: any) => typeof entry === 'number' ? entry : Number(entry?.Duration ?? 0))
            : []
    }, [effectiveModelData])
    const activeGlobalSequenceDuration = typeof timelineGlobalSequenceFilter === 'number' && timelineGlobalSequenceFilter >= 0
        ? Number(globalSequences[timelineGlobalSequenceFilter] ?? 0)
        : null
    const isSequenceOnlyView = timelineGlobalSequenceFilter === -1
    const isSpecificGlobalSequenceView = activeGlobalSequenceDuration !== null
        && Number.isFinite(activeGlobalSequenceDuration)
        && activeGlobalSequenceDuration >= 0
    const allSequencesMax = useMemo(() => {
        if (!sequences || sequences.length === 0) return 1000
        return sequences.reduce((max, s) => Math.max(max, s?.Interval?.[1] ?? 0), 0)
    }, [sequences])

    const isAllSequences = currentSequence < 0

    // Derived Animation Info
    const sequence = currentSequence >= 0 && sequences ? sequences[currentSequence] : null
    const seqStart = isSpecificGlobalSequenceView ? 0 : (isAllSequences ? 0 : (sequence?.Interval?.[0] ?? 0))
    const seqEnd = isSpecificGlobalSequenceView ? activeGlobalSequenceDuration : (isAllSequences ? allSequencesMax : (sequence?.Interval?.[1] ?? 1000))

    // State (Visual)
    const [pixelsPerMs, setPixelsPerMs] = useState(0.1)
    const [scrollX, setScrollX] = useState(0)
    const [displayFrame, setDisplayFrame] = useState(0)
    const [isEditingFrame, setIsEditingFrame] = useState(false)
    const [inputFrameValue, setInputFrameValue] = useState('')
    const [showAllKeyframes, setShowAllKeyframes] = useState(true)
    const [showAllOwnerKeyframes, setShowAllOwnerKeyframes] = useState(true)
    const keyframeDisplayMode = timelineKeyframeDisplayMode
    const currentKeyframeModeConfig = KEYFRAME_DISPLAY_MODE_CONFIG[keyframeDisplayMode]
    const keyframeModeMenuItems = useMemo(() => (
        KEYFRAME_DISPLAY_MODE_ORDER.map(mode => ({
            key: mode,
            label: KEYFRAME_DISPLAY_MODE_CONFIG[mode].label
        }))
    ), [])

    // Missing State from previous error
    const [isDragging, setIsDragging] = useState(false)
    const [dragTargetSequenceIndex, setDragTargetSequenceIndex] = useState<number | null>(null)

    // State (Selection)
    const [selectedKeyframeUids, setSelectedKeyframeUids] = useState<Set<string>>(new Set())
    const [selectionRect, setSelectionRect] = useState<{ startX: number, startY: number, endX: number, endY: number } | null>(null)
    const [hoveredSequenceIndex, setHoveredSequenceIndex] = useState<number | null>(null)
    const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number, selectionCount: number }>({ visible: false, x: 0, y: 0, selectionCount: 0 })
    const blockContextMenuRef = useRef(false)
    const [scalePasteOpen, setScalePasteOpen] = useState(false)
    const [scalePasteMode, setScalePasteMode] = useState<'ratio' | 'range'>('ratio')
    const [scalePastePercent, setScalePastePercent] = useState<number>(100)
    const [scalePasteStart, setScalePasteStart] = useState<number | null>(null)
    const [scalePasteEnd, setScalePasteEnd] = useState<number | null>(null)

    // Clipboard State for Keyframes
    const [clipboardKeyframes, setClipboardKeyframes] = useState<{
        keyframes: TimelineClipboardKeyframe[]
        isCut: boolean
        baseFrame: number
    } | null>(null)

    // Drag Keyframe Preview State
    const [dragKeyframeOffset, setDragKeyframeOffset] = useState<number>(0)
    const [dragKeyframeScale, setDragKeyframeScale] = useState<number | null>(null)
    // Refs for RAF
    const frameRef = useRef(0)
    const pixelsPerMsRef = useRef(pixelsPerMs)
    const scrollXRef = useRef(scrollX)
    const seqStartRef = useRef(seqStart)
    const seqEndRef = useRef(seqEnd)
    const isDraggingRef = useRef(isDragging)
    const activeKeyframesRef = useRef<any[]>([])
    const selectedKeyframeUidsRef = useRef<Set<string>>(new Set())
    const selectionRectRef = useRef<{ startX: number, startY: number, endX: number, endY: number } | null>(null)
    const showAllKeyframesRef = useRef(showAllKeyframes)
    const keyframeDisplayModeRef = useRef<KeyframeDisplayMode>(keyframeDisplayMode)
    const dragKeyframeOffsetRef = useRef(0)
    const dragKeyframeScaleRef = useRef<number | null>(null)
    const isSequenceOnlyViewRef = useRef(isSequenceOnlyView)
    const isSpecificGlobalSequenceViewRef = useRef(isSpecificGlobalSequenceView)
    const showAllOwnerKeyframesRef = useRef(showAllOwnerKeyframes)
    const selectedNodeIdsRef = useRef<number[]>(selectedNodeIds)

    // Interaction Refs
    const interactionRef = useRef({
        mode: 'none' as 'none' | 'scrub' | 'pan' | 'boxSelect' | 'dragSequence' | 'dragSequenceStart' | 'dragSequenceEnd' | 'pendingDragKeyframes' | 'dragKeyframes',
        startX: 0,
        startY: 0,
        lastMouseX: 0,
        initialScrollX: 0,
        dragSequenceIndex: -1,
        initialInterval: [0, 0],
        dragKeyframeStartFrame: 0,
        dragKeyframeData: [] as DragKeyframeData[],
        dragKeyframeMinFrame: 0,
        dragKeyframeMaxFrame: 0,
        dragKeyframeScaleAnchorFrame: 0
    })

    // Sync Refs
    useEffect(() => { pixelsPerMsRef.current = pixelsPerMs }, [pixelsPerMs])
    useEffect(() => { scrollXRef.current = scrollX }, [scrollX])
    useEffect(() => {
        if (isSpecificGlobalSequenceView) {
            seqStartRef.current = 0
            seqEndRef.current = seqEnd
        } else if (isAllSequences) {
            // Use full range only when selecting "all sequences" mode.
            seqStartRef.current = 0
            seqEndRef.current = allSequencesMax
        } else {
            seqStartRef.current = seqStart
            seqEndRef.current = seqEnd
        }
    }, [seqStart, seqEnd, allSequencesMax, isAllSequences, isSpecificGlobalSequenceView])

    useEffect(() => { selectedKeyframeUidsRef.current = selectedKeyframeUids }, [selectedKeyframeUids])
    useEffect(() => { selectionRectRef.current = selectionRect }, [selectionRect])
    useEffect(() => { showAllKeyframesRef.current = showAllKeyframes }, [showAllKeyframes])
    useEffect(() => { keyframeDisplayModeRef.current = keyframeDisplayMode }, [keyframeDisplayMode])
    useEffect(() => { isDraggingRef.current = isDragging }, [isDragging])
    useEffect(() => { dragKeyframeOffsetRef.current = dragKeyframeOffset }, [dragKeyframeOffset])
    useEffect(() => { dragKeyframeScaleRef.current = dragKeyframeScale }, [dragKeyframeScale])
    useEffect(() => { isSequenceOnlyViewRef.current = isSequenceOnlyView }, [isSequenceOnlyView])
    useEffect(() => { isSpecificGlobalSequenceViewRef.current = isSpecificGlobalSequenceView }, [isSpecificGlobalSequenceView])
    useEffect(() => { showAllOwnerKeyframesRef.current = showAllOwnerKeyframes }, [showAllOwnerKeyframes])
    useEffect(() => { selectedNodeIdsRef.current = selectedNodeIds }, [selectedNodeIds])
    useEffect(() => {
        setSelectedKeyframeUids(new Set())
        setSelectionRect(null)
    }, [keyframeDisplayMode])

    useEffect(() => {
        if (keyframeDisplayMode !== 'textureAnim') return
        const textureAnims = Array.isArray((modelData as any)?.TextureAnims)
            ? ((modelData as any).TextureAnims as any[])
            : []
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
    }, [keyframeDisplayMode, modelData, selectedTextureAnimIndex, setSelectedTextureAnimIndex])

    useEffect(() => {
        if (keyframeDisplayMode !== 'material') return
        const materials = Array.isArray((effectiveModelData as any)?.Materials)
            ? ((effectiveModelData as any).Materials as any[])
            : []
        if (materials.length === 0) {
            if (selectedMaterialIndex !== null) setSelectedMaterialIndex(null)
            if (selectedMaterialIndices.length > 0) setSelectedMaterialIndices([])
            if (selectedMaterialLayerIndex !== null) setSelectedMaterialLayerIndex(null)
            return
        }

        const pickedMaterialIndex = (() => {
            const geosets = Array.isArray((effectiveModelData as any)?.Geosets) ? ((effectiveModelData as any).Geosets as any[]) : []
            if (pickedGeosetIndex === null || pickedGeosetIndex < 0 || pickedGeosetIndex >= geosets.length) return null
            const materialId = Number(geosets[pickedGeosetIndex]?.MaterialID)
            return Number.isFinite(materialId) && materialId >= 0 && materialId < materials.length ? materialId : null
        })()

        const nextMaterialIds = selectedMaterialIndices.filter((id) => id >= 0 && id < materials.length)
        if (nextMaterialIds.length === 0) {
            const next = (
                pickedMaterialIndex !== null
                    ? pickedMaterialIndex
                    : (selectedMaterialIndex !== null && selectedMaterialIndex >= 0 && selectedMaterialIndex < materials.length
                        ? selectedMaterialIndex
                        : 0)
            )
            setSelectedMaterialIndices([next])
            if (selectedMaterialIndex !== next) setSelectedMaterialIndex(next)
        } else if (selectedMaterialIndex !== nextMaterialIds[0]) {
            setSelectedMaterialIndex(nextMaterialIds[0])
        }

    }, [
        keyframeDisplayMode,
        effectiveModelData,
        pickedGeosetIndex,
        selectedMaterialIndex,
        selectedMaterialIndices,
        selectedMaterialLayerIndex,
        setSelectedMaterialIndex,
        setSelectedMaterialIndices,
        setSelectedMaterialLayerIndex
    ])

    const matchesTimelineGlobalSequenceFilter = useCallback((track: any) => {
        if (timelineGlobalSequenceFilter === null) return true
        const trackGlobalSeqId = getTrackGlobalSeqId(track)
        if (timelineGlobalSequenceFilter === -1) {
            return trackGlobalSeqId < 0
        }
        return trackGlobalSeqId === timelineGlobalSequenceFilter
    }, [timelineGlobalSequenceFilter])

    const getSelectionSetForKeyframe = useCallback((keyframe: any) => {
        if (!keyframe) return new Set<string>()
        if (!showAllOwnerKeyframes) {
            return new Set([keyframe.uid])
        }
        const grouped = activeKeyframesRef.current.filter((candidate) => {
            if (candidate.frame !== keyframe.frame) return false
            if (candidate.type !== keyframe.type) return false
            if (
                keyframe.ownerType === 'node' &&
                selectedNodeIds.length > 0 &&
                candidate.ownerType === 'node'
            ) {
                return selectedNodeIds.includes(Number(candidate.ownerId))
            }
            return true
        })
        return new Set(grouped.map((candidate) => candidate.uid))
    }, [showAllOwnerKeyframes, selectedNodeIds])



    // Cache active keyframes
    useEffect(() => {
        if (!effectiveModelData) {
            activeKeyframesRef.current = []
            return
        }

        const keyframes: any[] = []
        const geosetSelection = selectedGeosetIndices.length > 0
            ? selectedGeosetIndices
            : (selectedGeosetIndex !== null
                ? [selectedGeosetIndex]
                : (pickedGeosetIndex !== null ? [pickedGeosetIndex] : []))
        const geosetIdsForTimeline = showAllOwnerKeyframes
            ? Array.from(new Set(
                (Array.isArray((modelData as any).GeosetAnims) ? (modelData as any).GeosetAnims : [])
                    .map((anim: any) => Number(anim?.GeosetId))
                    .filter((id: number) => Number.isFinite(id) && id >= 0)
            ))
            : geosetSelection
        const nodeIdsForTimeline = showAllOwnerKeyframes
            ? modelNodes.map((node: any) => Number(node?.ObjectId)).filter((id: number) => Number.isFinite(id))
            : selectedNodeIds
        const particleNodeIdsForTimeline = showAllOwnerKeyframes
            ? modelNodes.filter((node: any) => isParticleEmitter2Node(node)).map((node: any) => Number(node?.ObjectId)).filter((id: number) => Number.isFinite(id))
            : selectedNodeIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        const textureAnimIdsForTimeline = showAllOwnerKeyframes
            ? Array.from({ length: Array.isArray((modelData as any)?.TextureAnims) ? (modelData as any).TextureAnims.length : 0 }, (_, index) => index)
            : ((typeof selectedTextureAnimIndex === 'number' && selectedTextureAnimIndex >= 0) ? [selectedTextureAnimIndex] : [])

        if (keyframeDisplayMode === 'node') {
            nodeIdsForTimeline.forEach(nodeId => {
                const node = modelNodes.find((n: any) => n.ObjectId === nodeId)
                if (!node) return

                const addKeys = (propData: any, type: string, color: string) => {
                    if (propData && Array.isArray(propData.Keys) && matchesTimelineGlobalSequenceFilter(propData)) {
                        propData.Keys.forEach((k: any) => {
                            keyframes.push({
                                frame: k.Frame,
                                ownerType: 'node',
                                ownerId: nodeId,
                                type,
                                uid: makeKeyframeUid('node', nodeId, type, k.Frame),
                                color
                            })
                        })
                    }
                }

                addKeys(node.Translation, 'Translation', '#ff4d4f')
                addKeys(node.Rotation, 'Rotation', '#d3f261')
                addKeys(node.Scaling, 'Scaling', '#1890ff')
            })
        }

        if (keyframeDisplayMode === 'geosetAnim' && geosetIdsForTimeline.length > 0 && Array.isArray((modelData as any).GeosetAnims)) {
            const addGeosetKeys = (geosetId: number, propData: any, type: 'GeosetAlpha' | 'GeosetColor', color: string) => {
                if (!isAnimTrack(propData) || !matchesTimelineGlobalSequenceFilter(propData)) return
                propData.Keys.forEach((k: any) => {
                    keyframes.push({
                        frame: k.Frame,
                        ownerType: 'geoset',
                        ownerId: Number(geosetId),
                        type,
                        uid: makeKeyframeUid('geoset', Number(geosetId), type, k.Frame),
                        color
                    })
                })
            }

            geosetIdsForTimeline.forEach((geosetId) => {
                const geosetAnim = (modelData as any).GeosetAnims.find((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                addGeosetKeys(geosetId, geosetAnim?.Alpha, 'GeosetAlpha', '#fadb14')
                addGeosetKeys(geosetId, geosetAnim?.Color, 'GeosetColor', '#ff85c0')
            })
        }

        if (keyframeDisplayMode === 'particle') {
            particleNodeIdsForTimeline.forEach((nodeId) => {
                const node = modelNodes.find((n: any) => Number(n?.ObjectId) === nodeId)
                if (!node || !isParticleEmitter2Node(node)) return

                PARTICLE_TRACK_INFOS.forEach(({ type, propName }) => {
                    const track = (node as any)[propName]
                    if (!isAnimTrack(track) || !matchesTimelineGlobalSequenceFilter(track)) return
                    track.Keys.forEach((k: any) => {
                        keyframes.push({
                            frame: Number(k.Frame),
                            ownerType: 'node',
                            ownerId: nodeId,
                            type,
                            uid: makeKeyframeUid('node', nodeId, type, Number(k.Frame)),
                            color: '#95de64'
                        })
                    })
                })
            })
        }

        if (keyframeDisplayMode === 'textureAnim') {
            const textureAnims = Array.isArray((modelData as any)?.TextureAnims)
                ? ((modelData as any).TextureAnims as any[])
                : []
            textureAnimIdsForTimeline.forEach((textureAnimId) => {
                if (textureAnimId < 0 || textureAnimId >= textureAnims.length) return
                const anim = textureAnims[textureAnimId]
                TEXTURE_ANIM_TRACK_INFOS.forEach(({ type, propName, color }) => {
                    const track = anim?.[propName]
                    if (!isAnimTrack(track) || !matchesTimelineGlobalSequenceFilter(track)) return
                    track.Keys.forEach((k: any) => {
                        keyframes.push({
                            frame: Number(k.Frame),
                            ownerType: 'textureAnim',
                            ownerId: textureAnimId,
                            type,
                            uid: makeKeyframeUid('textureAnim', textureAnimId, type, Number(k.Frame)),
                            color
                        })
                    })
                })
            })
        }

        if (keyframeDisplayMode === 'material') {
            const materials = Array.isArray((effectiveModelData as any)?.Materials)
                ? ((effectiveModelData as any).Materials as any[])
                : []
            const materialIds = showAllOwnerKeyframes
                ? Array.from({ length: materials.length }, (_, index) => index)
                : (selectedMaterialIndices.length > 0
                ? selectedMaterialIndices
                : (typeof selectedMaterialIndex === 'number' ? [selectedMaterialIndex] : []))
            materialIds.forEach((materialIndex) => {
                if (materialIndex < 0 || materialIndex >= materials.length) return
                const layerIndices = showAllOwnerKeyframes
                    ? Array.from({ length: Array.isArray(materials[materialIndex]?.Layers) ? materials[materialIndex].Layers.length : 0 }, (_, index) => index)
                    : [(
                        typeof selectedMaterialLayerIndex === 'number' &&
                        selectedMaterialLayerIndex >= 0
                    ) ? selectedMaterialLayerIndex : 0]
                layerIndices.forEach((layerIndex) => {
                    const layer = materials[materialIndex]?.Layers?.[layerIndex]
                    const ownerId = encodeMaterialLayerOwnerId(materialIndex, layerIndex)
                    MATERIAL_TRACK_INFOS.forEach(({ type, propName, color }) => {
                        const track = layer?.[propName]
                        if (!isAnimTrack(track) || !matchesTimelineGlobalSequenceFilter(track)) return
                        track.Keys.forEach((k: any) => {
                            keyframes.push({
                                frame: Number(k.Frame),
                                ownerType: 'materialLayer',
                                ownerId,
                                type,
                                uid: makeKeyframeUid('materialLayer', ownerId, type, Number(k.Frame)),
                                color
                            })
                        })
                    })
                })
            })
        }

        activeKeyframesRef.current = keyframes
    }, [
        effectiveModelData,
        selectedNodeIds,
        modelNodes,
        selectedGeosetIndex,
        selectedGeosetIndices,
        pickedGeosetIndex,
        selectedTextureAnimIndex,
        selectedMaterialIndex,
        selectedMaterialIndices,
        selectedMaterialLayerIndex,
        keyframeDisplayMode,
        matchesTimelineGlobalSequenceFilter,
        showAllOwnerKeyframes
    ])

    const didInitialAutoFitRef = useRef(false)

    const fitToCurrentSequenceInterval = useCallback(() => {
        const container = containerRef.current
        if (!container) return false

        const containerWidth = container.clientWidth
        // When the panel is hidden via display:none, width is 0. Don't lock in a bad zoom.
        if (!Number.isFinite(containerWidth) || containerWidth < 20) return false

        const useFullRange = isAllSequences || isSpecificGlobalSequenceView
        const start = useFullRange ? 0 : (sequence?.Interval?.[0] ?? 0)
        const end = isSpecificGlobalSequenceView
            ? seqEnd
            : (useFullRange ? allSequencesMax : (sequence?.Interval?.[1] ?? 1000))
        const duration = Math.max(1, end - start)
        const paddedDuration = isSpecificGlobalSequenceView ? duration : Math.max(100, duration * (1 + MIN_ZOOM_RANGE_PADDING_RATIO))
        const newPixelsPerMs = containerWidth / paddedDuration

        setPixelsPerMs(Math.max(0.01, Math.min(2, newPixelsPerMs)))
        setScrollX(isSpecificGlobalSequenceView ? start : Math.max(0, start - duration * (MIN_ZOOM_RANGE_PADDING_RATIO * 0.5)))
        return true
    }, [sequence, isAllSequences, isSpecificGlobalSequenceView, allSequencesMax, seqEnd])

    const zoomDuration = Math.max(1, seqEnd - seqStart)
    const minPixelsPerMs = useMemo(() => {
        const width = containerSizeRef.current.width
        if (!Number.isFinite(width) || width <= 0) return 0.01
        const paddedZoomDuration = isSpecificGlobalSequenceView
            ? zoomDuration
            : zoomDuration * (1 + MIN_ZOOM_RANGE_PADDING_RATIO)
        return Math.max(0.0005, width / paddedZoomDuration)
    }, [zoomDuration, containerMeasureTick, isSpecificGlobalSequenceView])
    const maxPixelsPerMs = 12

    // Reset the one-time auto-fit when leaving keyframe mode, so re-entering matches the selected sequence.
    useEffect(() => {
        if (!isActive) {
            didInitialAutoFitRef.current = false
        }
    }, [isActive])

    useEffect(() => {
        setPixelsPerMs((current) => Math.max(minPixelsPerMs, Math.min(maxPixelsPerMs, current)))
    }, [minPixelsPerMs])

    // Initial entry into keyframe timeline: fit once to the selected sequence interval (e.g. "Stand").
    useLayoutEffect(() => {
        if (!isActive) return
        if (isDraggingRef.current) return
        if (didInitialAutoFitRef.current) return
        if (fitToCurrentSequenceInterval()) {
            didInitialAutoFitRef.current = true
        }
    }, [isActive, currentSequence, fitToCurrentSequenceInterval, containerMeasureTick])

    // Auto-fit when the timeline source changes (sequence switch or global-sequence filter switch).
    const currentTimelineViewKey = isSpecificGlobalSequenceView
        ? `global:${timelineGlobalSequenceFilter}:${seqEnd}`
        : (isSequenceOnlyView
            ? `sequence:${currentSequence}:${seqStart}:${seqEnd}`
            : `all:${currentSequence}:${allSequencesMax}`)
    const lastTimelineViewKeyRef = useRef(currentTimelineViewKey)
    useEffect(() => {
        const viewChanged = lastTimelineViewKeyRef.current !== currentTimelineViewKey
        lastTimelineViewKeyRef.current = currentTimelineViewKey

        if (!isActive) return
        if (!viewChanged) return
        if (isDraggingRef.current) return

        fitToCurrentSequenceInterval()
        const clampedFrame = Math.max(seqStart, Math.min(seqEnd, Math.round(frameRef.current)))
        frameRef.current = clampedFrame
        setDisplayFrame(clampedFrame)
        setFrame(clampedFrame)
    }, [currentTimelineViewKey, isActive, fitToCurrentSequenceInterval, seqStart, seqEnd, setFrame])

    // Allow external sequence list clicks (including re-click on the same sequence)
    // to force a timeline fit to the current sequence interval.
    useEffect(() => {
        const onForceFit = () => {
            if (!isActive) return
            if (isDraggingRef.current) return
            fitToCurrentSequenceInterval()
        }
        window.addEventListener('timeline-fit-current-sequence', onForceFit)
        return () => {
            window.removeEventListener('timeline-fit-current-sequence', onForceFit)
        }
    }, [isActive, fitToCurrentSequenceInterval])

    // Resize Observer
    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                containerSizeRef.current = {
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
                }
                setContainerMeasureTick((tick) => tick + 1)
            }
        })
        resizeObserver.observe(container)
        containerSizeRef.current = { width: container.clientWidth, height: container.clientHeight }
        setContainerMeasureTick((tick) => tick + 1)
        return () => resizeObserver.disconnect()
    }, [])

    // RAF Loop
    useEffect(() => {
        if (!isActive) {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
            return
        }

        // Singleton Guard
        globalTimelineLoopId++
        const myLoopId = globalTimelineLoopId

        const runState = { shouldRun: true }
        let lastDrawTime = 0
        let lastDisplayUpdate = 0
        const frameInterval = 1000 / 60
        const DISPLAY_UPDATE_INTERVAL = 50

        const animate = (time: number) => {
            // STRONG GUARD
            if (globalTimelineLoopId !== myLoopId) return
            if (!runState.shouldRun) return


            const elapsed = time - lastDrawTime
            if (elapsed >= frameInterval) {
                lastDrawTime = time

                if (!isDraggingRef.current && interactionRef.current.mode !== 'scrub' && interactionRef.current.mode !== 'dragSequence' && interactionRef.current.mode !== 'dragSequenceStart' && interactionRef.current.mode !== 'dragSequenceEnd') {
                    const renderer = useRendererStore.getState().renderer
                    if (renderer && renderer.rendererData && typeof renderer.rendererData.frame === 'number') {
                        frameRef.current = renderer.rendererData.frame
                    } else {
                        frameRef.current = useModelStore.getState().currentFrame
                    }
                }

                draw()

                if (!isEditingFrame && time - lastDisplayUpdate > DISPLAY_UPDATE_INTERVAL) {
                    lastDisplayUpdate = time
                    setDisplayFrame(Math.round(frameRef.current))
                }
            }

            if (runState.shouldRun && globalTimelineLoopId === myLoopId) {
                rafRef.current = requestAnimationFrame(animate)
            }
        }
        rafRef.current = requestAnimationFrame(animate)

        return () => {
            runState.shouldRun = false
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
        }
    }, [isActive, isEditingFrame])

    // Draw Function
    const draw = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const width = containerSizeRef.current.width
        const height = containerSizeRef.current.height

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
        }

        const pxPerMs = pixelsPerMsRef.current
        const scroll = scrollXRef.current
        const start = seqStartRef.current
        const end = seqEndRef.current
        const frame = frameRef.current
        const activeKeyframes = activeKeyframesRef.current
        const selectedUids = selectedKeyframeUidsRef.current
        const selRect = selectionRectRef.current
        const showAll = showAllKeyframesRef.current
        const displayMode = keyframeDisplayModeRef.current
        const sequenceOnlyView = isSequenceOnlyViewRef.current
        const specificGlobalSequenceView = isSpecificGlobalSequenceViewRef.current
        const currentlySelectedNodeIds = selectedNodeIdsRef.current
        const showAllOwners = showAllOwnerKeyframesRef.current

        // Bg
        ctx.fillStyle = '#1e1e1e'
        ctx.fillRect(0, 0, width, height)

        // Ruler Bg
        ctx.fillStyle = '#252526'
        ctx.fillRect(0, 0, width, RULER_HEIGHT)
        ctx.strokeStyle = '#333'
        ctx.beginPath()
        ctx.moveTo(0, RULER_HEIGHT)
        ctx.lineTo(width, RULER_HEIGHT)
        ctx.stroke()

        // Sequence Track Bg (Bottom)
        const seqTrackY = height - SEQUENCE_TRACK_HEIGHT
        const laneMetrics = getLaneMetrics(displayMode, height)
        const laneYMap = laneMetrics.laneYMap
        const trackTop = laneMetrics.trackTop
        const trackBottom = laneMetrics.trackBottom
        const effectiveKeyframeSize = laneMetrics.effectiveKeyframeSize
        ctx.fillStyle = '#202020'
        ctx.fillRect(0, seqTrackY, width, SEQUENCE_TRACK_HEIGHT)
        ctx.strokeStyle = '#333'
        ctx.beginPath()
        ctx.moveTo(0, seqTrackY)
        ctx.lineTo(width, seqTrackY)
        ctx.stroke()

        // Ticks
        const startTime = scroll
        const endTime = scroll + width / pxPerMs

        let tickInterval = 50
        const idealMsPerTick = 100 / pxPerMs
        if (idealMsPerTick > 5000) tickInterval = 5000
        else if (idealMsPerTick > 1000) tickInterval = 1000
        else if (idealMsPerTick > 500) tickInterval = 500
        else if (idealMsPerTick > 200) tickInterval = 200
        else if (idealMsPerTick > 100) tickInterval = 100
        else if (idealMsPerTick > 50) tickInterval = 50
        else if (idealMsPerTick > 20) tickInterval = 20
        else if (idealMsPerTick > 10) tickInterval = 10
        else if (idealMsPerTick > 5) tickInterval = 5
        else if (idealMsPerTick > 2) tickInterval = 2
        else tickInterval = 1

        const firstTick = Math.floor(startTime / tickInterval) * tickInterval
        ctx.font = '10px Microsoft YaHei'
        ctx.textAlign = 'left'

        for (let t = firstTick; t <= endTime; t += tickInterval) {
            const x = (t - scroll) * pxPerMs
            if (x < -20) continue

            // Ruler Line
            ctx.strokeStyle = '#444'
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, RULER_HEIGHT)
            // Grid Line in Track
            ctx.moveTo(x, RULER_HEIGHT)
            ctx.lineTo(x, seqTrackY) // Stop at Sequence Track
            ctx.stroke()

            // Text
            ctx.fillStyle = '#888'
            ctx.fillText(t.toString(), x + 4, 12)
        }

        // Sequence Bounds Highlight (Ruler + Track)
        const startX = (start - scroll) * pxPerMs
        const endX = (end - scroll) * pxPerMs
        if (sequenceOnlyView) {
            ctx.strokeStyle = 'rgba(70, 144, 226, 0.3)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(startX, 0); ctx.lineTo(startX, seqTrackY)
            ctx.moveTo(endX, 0); ctx.lineTo(endX, seqTrackY)
            ctx.stroke()
        }

        // Draw Sequence Markers (Bottom Track)
        const storeSequences = useModelStore.getState().sequences
        /* 
           Draw Markers: Start Triangle, End Triangle.
           Name: Below the markers.
        */
        if (storeSequences && sequenceOnlyView && !specificGlobalSequenceView) {
            ctx.font = '10px Microsoft YaHei' // Smaller font for name
            storeSequences.forEach((seq, idx) => {
                const isCurrent = idx === useModelStore.getState().currentSequence
                if (!showAll && !isCurrent) return

                // Skip if Interval is missing
                if (!seq.Interval || seq.Interval.length < 2) return

                const sx = (seq.Interval[0] - scroll) * pxPerMs
                const ex = (seq.Interval[1] - scroll) * pxPerMs

                if (ex < 0 || sx > width) return

                // Draw Markers at Top of Sequence Track
                const markerY = seqTrackY + 2
                const handleSize = 8

                const isDragStart = interactionRef.current.mode === 'dragSequenceStart' && interactionRef.current.dragSequenceIndex === idx
                const isDragEnd = interactionRef.current.mode === 'dragSequenceEnd' && interactionRef.current.dragSequenceIndex === idx

                // Start Marker (Right pointing or Down pointing triangle?)
                // Let's do Downward pointing triangle at start pos
                ctx.fillStyle = (isCurrent || isDragStart) ? '#1890ff' : '#666'
                ctx.beginPath()
                ctx.moveTo(sx, markerY)
                ctx.lineTo(sx + handleSize, markerY)
                ctx.lineTo(sx, markerY + handleSize)
                ctx.closePath()
                ctx.fill()

                // End Marker
                ctx.fillStyle = (isCurrent || isDragEnd) ? '#1890ff' : '#666'
                ctx.beginPath()
                ctx.moveTo(ex, markerY)
                ctx.lineTo(ex - handleSize, markerY)
                ctx.lineTo(ex, markerY + handleSize)
                ctx.closePath()
                ctx.fill()

                // Name Text - Below markers
                // Centered between markers or below Start? User: "in respective marker's below" (在各自的标记的下面)
                // "Each action's start/end frame has a drag marker, and displayed sequence name is below the respective markers"
                // This might mean: Name under Start Marker, and Name under End Marker?
                // Or just Name in the track. "Below the markers" likely means Y-axis below.
                // Let's put text below the start marker for now, as is typical.

                ctx.textAlign = 'left'
                ctx.fillStyle = isCurrent ? '#eee' : '#666'
                // Draw name below Start Marker
                ctx.fillText(seq.Name, sx, markerY + handleSize + 10)
                // Draw name below End Marker
                ctx.fillText(seq.Name, ex, markerY + handleSize + 10)
            })
        }

        // Draw Keyframes (Track Area with Lanes)
        const dragOffset = dragKeyframeOffsetRef.current
        const dragScale = dragKeyframeScaleRef.current
        const dragAnchor = interactionRef.current.dragKeyframeScaleAnchorFrame

        const drawGroups = new Map<string, {
            drawX: number
            lineTop: number
            lineBottom: number
            hasSelected: boolean
            hasNormal: boolean
            hasDimmed: boolean
            baseColor: string
        }>()

        activeKeyframes.forEach(kf => {
            let drawFrame = kf.frame
            if (!isKeyframeTypeVisible(kf.type, displayMode)) return

            const laneY = laneYMap[kf.type] ?? (RULER_HEIGHT + OFFSET_TRANSLATION)
            const isSelected = selectedUids.has(kf.uid)

            if (isSelected && dragScale !== null) {
                drawFrame = Math.round(dragAnchor + (kf.frame - dragAnchor) * dragScale)
            } else if (isSelected && dragOffset !== 0) {
                drawFrame = kf.frame + dragOffset
            }

            const drawX = (drawFrame - scroll) * pxPerMs
            if (drawX < -10 || drawX > width + 10) return

            const lineTop = displayMode === 'particle'
                ? trackTop
                : laneY - effectiveKeyframeSize
            const lineBottom = displayMode === 'particle'
                ? trackBottom
                : laneY + effectiveKeyframeSize
            const shouldDimForNodeSelection = (
                showAllOwners &&
                displayMode === 'node' &&
                currentlySelectedNodeIds.length > 0 &&
                kf.ownerType === 'node' &&
                !currentlySelectedNodeIds.includes(Number(kf.ownerId))
            )

            const groupKey = `${kf.type}:${drawFrame}`
            const existing = drawGroups.get(groupKey)
            if (existing) {
                existing.hasSelected = existing.hasSelected || isSelected
                existing.hasNormal = existing.hasNormal || (!isSelected && !shouldDimForNodeSelection)
                existing.hasDimmed = existing.hasDimmed || shouldDimForNodeSelection
                return
            }

            drawGroups.set(groupKey, {
                drawX,
                lineTop,
                lineBottom,
                hasSelected: isSelected,
                hasNormal: !isSelected && !shouldDimForNodeSelection,
                hasDimmed: shouldDimForNodeSelection,
                baseColor: kf.color
            })
        })

        drawGroups.forEach((group) => {
            const lineColor = group.hasSelected
                ? '#ffd666'
                : (group.hasNormal ? group.baseColor : dimHexColor(group.baseColor, 0.16))

            if (group.hasSelected) {
                ctx.strokeStyle = '#ffffff'
                ctx.lineWidth = 4
                ctx.beginPath()
                ctx.moveTo(group.drawX, group.lineTop)
                ctx.lineTo(group.drawX, group.lineBottom)
                ctx.stroke()
            }

            ctx.strokeStyle = lineColor
            ctx.lineWidth = group.hasSelected ? 2 : 1.25
            ctx.beginPath()
            ctx.moveTo(group.drawX, group.lineTop)
            ctx.lineTo(group.drawX, group.lineBottom)
            ctx.stroke()
        })

        // Draw Selection Rect
        if (selRect) {
            ctx.strokeStyle = '#1890ff'
            ctx.fillStyle = 'rgba(24, 144, 255, 0.2)'
            const rx = Math.min(selRect.startX, selRect.endX)
            const ry = Math.min(selRect.startY, selRect.endY)
            const rw = Math.abs(selRect.endX - selRect.startX)
            const rh = Math.abs(selRect.endY - selRect.startY)
            ctx.fillRect(rx, ry, rw, rh)
            ctx.strokeRect(rx, ry, rw, rh)
        }

        // Playhead
        const playheadX = (frame - scroll) * pxPerMs

        ctx.strokeStyle = '#ff4444'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(playheadX, 0)
        ctx.lineTo(playheadX, height) // Full height
        ctx.stroke()

        // Playhead handle
        ctx.fillStyle = '#ff4444'
        ctx.beginPath()
        ctx.moveTo(playheadX - 6, 0)
        ctx.lineTo(playheadX + 6, 0)
        ctx.lineTo(playheadX + 6, RULER_HEIGHT / 2)
        ctx.lineTo(playheadX, RULER_HEIGHT - 2)
        ctx.lineTo(playheadX - 6, RULER_HEIGHT / 2)
        ctx.closePath()
        ctx.fill()
    }, [sequences]) // Added sequences dependency

    // Interaction Handlers
    const getKeyframeAtPos = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top // Relative Y

        const pxPerMs = pixelsPerMsRef.current
        const scroll = scrollXRef.current
        const displayMode = keyframeDisplayModeRef.current
        const laneMetrics = getLaneMetrics(displayMode, canvas.height)
        const laneYMap = laneMetrics.laneYMap
        const yThreshold = Math.max(8, laneMetrics.effectiveKeyframeSize + 4)

        const visibleKeyframes = activeKeyframesRef.current.filter((kf) =>
            isKeyframeTypeVisible(kf.type, displayMode)
        )
        if (visibleKeyframes.length === 0) return null

        // Build unique screen-space keyframe columns and find neighbors around click X.
        const keyframeXs = Array.from(new Set(
            visibleKeyframes
                .map((kf) => (kf.frame - scroll) * pxPerMs)
                .filter((kx) => Number.isFinite(kx))
        )).sort((a, b) => a - b)

        const getDynamicSnapThreshold = () => {
            if (keyframeXs.length === 0) return SNAP_THRESHOLD_X

            let left = 0
            let right = keyframeXs.length
            while (left < right) {
                const mid = (left + right) >> 1
                if (keyframeXs[mid] < x) left = mid + 1
                else right = mid
            }

            const prevX = left > 0 ? keyframeXs[left - 1] : null
            const nextX = left < keyframeXs.length ? keyframeXs[left] : null

            if (prevX !== null && nextX !== null) {
                const localGap = Math.abs(nextX - prevX)
                const halfGap = localGap > 0 ? localGap * 0.5 : MIN_SNAP_THRESHOLD_X
                return Math.max(MIN_SNAP_THRESHOLD_X, Math.min(MAX_SNAP_THRESHOLD_X, halfGap))
            }

            if (prevX !== null) {
                const prev2X = left > 1 ? keyframeXs[left - 2] : null
                const edgeGap = prev2X !== null ? Math.abs(prevX - prev2X) : SNAP_THRESHOLD_X
                const halfGap = edgeGap > 0 ? edgeGap * 0.5 : SNAP_THRESHOLD_X
                return Math.max(MIN_SNAP_THRESHOLD_X, Math.min(MAX_SNAP_THRESHOLD_X, halfGap))
            }

            if (nextX !== null) {
                const next2X = left + 1 < keyframeXs.length ? keyframeXs[left + 1] : null
                const edgeGap = next2X !== null ? Math.abs(next2X - nextX) : SNAP_THRESHOLD_X
                const halfGap = edgeGap > 0 ? edgeGap * 0.5 : SNAP_THRESHOLD_X
                return Math.max(MIN_SNAP_THRESHOLD_X, Math.min(MAX_SNAP_THRESHOLD_X, halfGap))
            }

            return SNAP_THRESHOLD_X
        }

        const dynamicThreshold = getDynamicSnapThreshold()
        let found: any = null
        let minScore = Number.POSITIVE_INFINITY

        visibleKeyframes.forEach((kf) => {
            const kx = (kf.frame - scroll) * pxPerMs
            const xDist = Math.abs(kx - x)
            if (xDist > dynamicThreshold) return

            const laneY = laneYMap[kf.type] ?? (RULER_HEIGHT + OFFSET_TRANSLATION)
            let yDist = 0
            if (displayMode === 'particle') {
                if (y < laneMetrics.trackTop) yDist = laneMetrics.trackTop - y
                else if (y > laneMetrics.trackBottom) yDist = y - laneMetrics.trackBottom
            } else {
                yDist = Math.abs(y - laneY)
            }

            if (yDist > yThreshold) return

            const score = xDist + yDist * 0.9
            if (score < minScore) {
                minScore = score
                found = kf
            }
        })
        return found
    }

    // NEW Hit Test for Start/End Markers
    const getSequenceHandleAtPos = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top

        const height = canvas.height
        const seqTrackY = height - SEQUENCE_TRACK_HEIGHT

        if (y < seqTrackY) return null // Only check bottom track

        const pxPerMs = pixelsPerMsRef.current
        const scroll = scrollXRef.current
        const sequences = useModelStore.getState().sequences
        const currentIdx = useModelStore.getState().currentSequence

        if (!sequences || currentIdx < 0) return null

        // Only check current sequence handles
        const seq = sequences[currentIdx]
        if (!seq?.Interval || seq.Interval.length < 2) return null

        const sx = (seq.Interval[0] - scroll) * pxPerMs
        const ex = (seq.Interval[1] - scroll) * pxPerMs

        const HIT_RADIUS = 10
        const handleSize = 8
        // Marker is [sx, seqTrackY+2] -> [sx+8, seqTrackY+2] ...

        // Start: sx is left edge
        if (x >= sx - 4 && x <= sx + handleSize + 4) return { type: 'start', index: currentIdx }

        // End: ex is right edge
        if (x >= ex - handleSize - 4 && x <= ex + 4) return { type: 'end', index: currentIdx }

        return null
    }

    const mouseToFrame = (clientX: number) => {
        const canvas = canvasRef.current
        if (!canvas) return 0
        const rect = canvas.getBoundingClientRect()
        const x = clientX - rect.left
        return scrollXRef.current + x / pixelsPerMsRef.current
    }

    const updateFrame = (targetFrame: number) => {
        const clamped = Math.max(seqStartRef.current, Math.min(seqEndRef.current, Math.round(targetFrame)))
        frameRef.current = clamped

        // Keep store frame in sync while scrubbing.
        // IMPORTANT: don't directly push renderer.frame/update(0) here.
        // Viewer owns paused-frame simulation (including ribbon rewind/rebuild logic).
        // Writing renderer.frame in Timeline bypasses that path and causes scrub desync.
        const modelState = useModelStore.getState()
        if (Math.abs((modelState.currentFrame ?? 0) - clamped) > 0.1) {
            modelState.setFrame(clamped)
        }
    }

    const confirmScrub = useCallback(() => {
        const clampedFrame = frameRef.current
        setFrame(clampedFrame)
    }, [setFrame])

    // ================== KEYFRAME OPERATIONS ==================
    const insertKeyframesForSelectedNodes = useCallback(() => {
        const { mainMode, animationSubMode, selectedNodeIds } = useSelectionStore.getState()
        if (mainMode !== 'animation' || animationSubMode !== 'keyframe') return false
        if (selectedNodeIds.length === 0) return false

        const { currentFrame, nodes } = useModelStore.getState()
        const renderer = useRendererStore.getState().renderer
        const frame = Math.round(currentFrame)

        const toArray = (v: any, fallback: number[]) => {
            if (!v) return fallback
            if (typeof v.length === 'number' && v.length === 0) return fallback
            const arr = Array.isArray(v) ? [...v] : Array.from(v) as number[]
            return arr.length > 0 ? arr : fallback
        }

        const interpolateValue = (keys: any[] | undefined, frameVal: number, defaultVal: number[]) => {
            if (!keys || keys.length === 0) return defaultVal
            const filteredKeys = keys.filter((k: any) => !k?._isPreviewKey)
            if (filteredKeys.length === 0) return defaultVal
            const sortedKeys = [...filteredKeys].sort((a: any, b: any) => a.Frame - b.Frame)
            if (frameVal <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector, defaultVal)
            if (frameVal >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector, defaultVal)
            for (let i = 0; i < sortedKeys.length - 1; i++) {
                if (frameVal >= sortedKeys[i].Frame && frameVal <= sortedKeys[i + 1].Frame) {
                    const t = (frameVal - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
                    const from = toArray(sortedKeys[i].Vector, defaultVal)
                    const to = toArray(sortedKeys[i + 1].Vector, defaultVal)
                    return from.map((v, idx) => v + (to[idx] - v) * t)
                }
            }
            return defaultVal
        }

        const isSameVec = (a: number[] | null, b: number[] | null, eps = 1e-4) => {
            if (!a || !b || a.length !== b.length) return false
            for (let i = 0; i < a.length; i++) {
                if (Math.abs(a[i] - b[i]) > eps) return false
            }
            return true
        }

        const changes: KeyframeChange[] = []

        const addChange = (node: any, propertyName: 'Translation' | 'Rotation' | 'Scaling', defaultVal: number[]) => {
            const prop = node[propertyName]
            const keys = prop?.Keys
            const existingKey = Array.isArray(keys)
                ? keys.find((k: any) => Math.abs(k.Frame - frame) < 0.1)
                : undefined
            const oldValue = existingKey?.Vector ? toArray(existingKey.Vector, defaultVal) : null
            const newValue = existingKey?.Vector
                ? toArray(existingKey.Vector, defaultVal)
                : interpolateValue(keys, frame, defaultVal)
            if (oldValue && isSameVec(oldValue, newValue)) return
            changes.push({
                nodeId: node.ObjectId,
                propertyName,
                frame,
                oldValue,
                newValue
            })
        }

        selectedNodeIds.forEach((nodeId) => {
            const node = nodes.find((n: any) => n.ObjectId === nodeId)
            if (!node) return
            addChange(node, 'Translation', [0, 0, 0])
            addChange(node, 'Rotation', [0, 0, 0, 1])
            addChange(node, 'Scaling', [1, 1, 1])
        })

        if (changes.length === 0) return false
        const cmd = new UpdateKeyframeCommand(renderer, changes)
        commandManager.execute(cmd)
        return true
    }, [])

    const applyKeyframeSnapshots = useCallback((
        nodesSnapshot: any[],
        geosetAnimsSnapshot: any[],
        textureAnimsSnapshot: any[],
        materialsSnapshot: any[],
        options?: { nodeChanged?: boolean; geosetChanged?: boolean; textureChanged?: boolean; materialChanged?: boolean }
    ) => {
        const replaceNodes = useModelStore.getState().replaceNodes
        const nodeChanged = options?.nodeChanged ?? true
        const geosetChanged = options?.geosetChanged ?? true
        const textureChanged = options?.textureChanged ?? true
        const materialChanged = options?.materialChanged ?? true

        if (nodeChanged && geosetChanged && textureChanged && materialChanged) {
            replaceNodes(nodesSnapshot, { triggerReload: false })
            setGeosetAnims(geosetAnimsSnapshot)
            setTextureAnims(textureAnimsSnapshot)
            setMaterials(materialsSnapshot)
            return
        }
        if (nodeChanged && !geosetChanged && !textureChanged && !materialChanged) {
            replaceNodes(nodesSnapshot)
            return
        }
        if (!nodeChanged && geosetChanged && !textureChanged && !materialChanged) {
            setGeosetAnims(geosetAnimsSnapshot)
            return
        }
        if (!nodeChanged && !geosetChanged && textureChanged && !materialChanged) {
            setTextureAnims(textureAnimsSnapshot)
            return
        }
        if (!nodeChanged && !geosetChanged && !textureChanged && materialChanged) {
            setMaterials(materialsSnapshot)
            return
        }
        if (nodeChanged) {
            replaceNodes(nodesSnapshot, { triggerReload: false })
        }
        if (geosetChanged) {
            setGeosetAnims(geosetAnimsSnapshot)
        }
        if (textureChanged) {
            setTextureAnims(textureAnimsSnapshot)
        }
        if (materialChanged) {
            setMaterials(materialsSnapshot)
        }
    }, [setGeosetAnims, setMaterials, setTextureAnims])

    // Helper: Get keyframe data for selected UIDs
    const getSelectedKeyframeData = useCallback(() => {
        const result: TimelineKeyframeData[] = []
        const state = useModelStore.getState()
        const mergedModelData = mergeMaterialManagerPreview(state.modelData as any, state.materialManagerPreview as any)
        const nodes = state.nodes as any[]
        const geosetAnims = Array.isArray((mergedModelData as any)?.GeosetAnims)
            ? ((mergedModelData as any).GeosetAnims as any[])
            : []
        const textureAnims = Array.isArray((mergedModelData as any)?.TextureAnims)
            ? ((mergedModelData as any).TextureAnims as any[])
            : []
        const materials = Array.isArray((mergedModelData as any)?.Materials)
            ? ((mergedModelData as any).Materials as any[])
            : []

        activeKeyframesRef.current.forEach((kf) => {
            if (!selectedKeyframeUids.has(kf.uid)) return

            if (kf.ownerType === 'node') {
                const node = nodes.find((n: any) => n.ObjectId === kf.ownerId)
                if (!node) return

                const propData = node[getNodeTrackPropertyName(kf.type)]
                if (!isAnimTrack(propData)) return

                const keyIndex = propData.Keys.findIndex((k: any) => k.Frame === kf.frame)
                if (keyIndex === -1) return

                const key = propData.Keys[keyIndex]
                result.push({
                    ownerType: 'node',
                    ownerId: kf.ownerId,
                    type: kf.type,
                    frame: kf.frame,
                    keyIndex,
                    value: Array.isArray(key.Vector) ? [...key.Vector] : key.Vector,
                    inTan: Array.isArray(key.InTan) ? [...key.InTan] : key.InTan,
                    outTan: Array.isArray(key.OutTan) ? [...key.OutTan] : key.OutTan
                })
                return
            }

            if (kf.ownerType === 'geoset') {
                const geosetTrack = getGeosetTrackInfo(kf.type)
                if (!geosetTrack) return
                const geosetAnim = geosetAnims.find((anim: any) => Number(anim?.GeosetId) === Number(kf.ownerId))
                const track = geosetAnim?.[geosetTrack.propName]
                if (!isAnimTrack(track)) return

                const keyIndex = track.Keys.findIndex((k: any) => k.Frame === kf.frame)
                if (keyIndex === -1) return

                const key = track.Keys[keyIndex]
                result.push({
                    ownerType: 'geoset',
                    ownerId: Number(kf.ownerId),
                    type: kf.type,
                    frame: kf.frame,
                    keyIndex,
                    value: Array.isArray(key.Vector) ? [...key.Vector] : key.Vector,
                    inTan: Array.isArray(key.InTan) ? [...key.InTan] : key.InTan,
                    outTan: Array.isArray(key.OutTan) ? [...key.OutTan] : key.OutTan
                })
                return
            }

            if (kf.ownerType === 'textureAnim') {
                const textureTrack = getTextureAnimTrackInfo(kf.type)
                if (!textureTrack) return
                const textureAnim = textureAnims[Number(kf.ownerId)]
                const track = textureAnim?.[textureTrack.propName]
                if (!isAnimTrack(track)) return

                const keyIndex = track.Keys.findIndex((k: any) => k.Frame === kf.frame)
                if (keyIndex === -1) return

                const key = track.Keys[keyIndex]
                result.push({
                    ownerType: 'textureAnim',
                    ownerId: Number(kf.ownerId),
                    type: kf.type,
                    frame: kf.frame,
                    keyIndex,
                    value: Array.isArray(key.Vector) ? [...key.Vector] : key.Vector,
                    inTan: Array.isArray(key.InTan) ? [...key.InTan] : key.InTan,
                    outTan: Array.isArray(key.OutTan) ? [...key.OutTan] : key.OutTan
                })
                return
            }

            if (kf.ownerType === 'materialLayer') {
                const materialTrack = getMaterialTrackInfo(kf.type)
                if (!materialTrack) return
                const { materialIndex, layerIndex } = decodeMaterialLayerOwnerId(Number(kf.ownerId))
                const track = materials[materialIndex]?.Layers?.[layerIndex]?.[materialTrack.propName]
                if (!isAnimTrack(track)) return

                const keyIndex = track.Keys.findIndex((k: any) => k.Frame === kf.frame)
                if (keyIndex === -1) return

                const key = track.Keys[keyIndex]
                result.push({
                    ownerType: 'materialLayer',
                    ownerId: Number(kf.ownerId),
                    type: kf.type,
                    frame: kf.frame,
                    keyIndex,
                    value: Array.isArray(key.Vector) ? [...key.Vector] : key.Vector,
                    inTan: Array.isArray(key.InTan) ? [...key.InTan] : key.InTan,
                    outTan: Array.isArray(key.OutTan) ? [...key.OutTan] : key.OutTan
                })
            }
        })
        return result
    }, [selectedKeyframeUids])

    const getEditableTimelineSnapshots = useCallback(() => {
        const state = useModelStore.getState()
        const mergedModelData = mergeMaterialManagerPreview(state.modelData as any, state.materialManagerPreview as any)
        return {
            nodes: state.nodes as any[],
            geosetAnims: Array.isArray((mergedModelData as any)?.GeosetAnims)
                ? ((mergedModelData as any).GeosetAnims as any[])
                : [],
            textureAnims: Array.isArray((mergedModelData as any)?.TextureAnims)
                ? ((mergedModelData as any).TextureAnims as any[])
                : [],
            materials: Array.isArray((mergedModelData as any)?.Materials)
                ? ((mergedModelData as any).Materials as any[])
                : []
        }
    }, [])

    const effectiveClipboard = useMemo(() => {
        if (clipboardKeyframes && clipboardKeyframes.keyframes.length > 0) {
            return { source: 'clipboard' as const, data: clipboardKeyframes }
        }
        const selectedData = getSelectedKeyframeData()
        if (selectedData.length === 0) return null
        const baseFrame = Math.min(...selectedData.map(kf => kf.frame))
        return {
            source: 'selection' as const,
            data: {
                keyframes: selectedData.map(kf => ({
                    ownerType: kf.ownerType,
                    ownerId: kf.ownerId,
                    type: kf.type,
                    frame: kf.frame,
                    value: kf.value,
                    inTan: kf.inTan,
                    outTan: kf.outTan
                })),
                isCut: false,
                baseFrame
            }
        }
    }, [clipboardKeyframes, getSelectedKeyframeData])

    const clipboardInfo = useMemo(() => {
        if (!effectiveClipboard || effectiveClipboard.data.keyframes.length === 0) return null
        const frames = effectiveClipboard.data.keyframes.map(kf => kf.frame)
        const start = Math.min(...frames)
        const end = Math.max(...frames)
        return {
            count: effectiveClipboard.data.keyframes.length,
            start,
            end,
            span: end - start
        }
    }, [effectiveClipboard])

    // Delete selected keyframes
    const deleteSelectedKeyframes = useCallback(() => {
        if (selectedKeyframeUids.size === 0) return

        const keyframeData = getSelectedKeyframeData()
        if (keyframeData.length === 0) return

        const { nodes, geosetAnims, textureAnims, materials } = getEditableTimelineSnapshots()
        const oldNodes = cloneNodesForKeyframes(nodes)
        const nodesCopy = cloneNodesForKeyframes(nodes)
        const oldGeosetAnims = cloneGeosetAnimsForKeyframes(geosetAnims)
        const geosetAnimsCopy = cloneGeosetAnimsForKeyframes(geosetAnims)
        const oldTextureAnims = cloneTextureAnimsForKeyframes(textureAnims)
        const textureAnimsCopy = cloneTextureAnimsForKeyframes(textureAnims)
        const oldMaterials = cloneMaterialsForKeyframes(materials)
        const materialsCopy = cloneMaterialsForKeyframes(materials)
        let nodeChanged = false
        let geosetChanged = false
        let textureChanged = false
        let materialChanged = false

        const grouped = new Map<string, { ownerType: KeyframeOwnerType, ownerId: number, type: string, frames: number[] }>()
        keyframeData.forEach(kf => {
            const key = `${kf.ownerType}-${kf.ownerId}-${kf.type}`
            if (!grouped.has(key)) {
                grouped.set(key, { ownerType: kf.ownerType, ownerId: kf.ownerId, type: kf.type, frames: [] })
            }
            grouped.get(key)!.frames.push(kf.frame)
        })

        grouped.forEach(({ ownerType, ownerId, type, frames }) => {
            if (ownerType === 'node') {
                const node = nodesCopy.find((n: any) => n.ObjectId === ownerId)
                const propName = getNodeTrackPropertyName(type)
                if (!node || !isAnimTrack(node[propName])) return
                node[propName].Keys = node[propName].Keys.filter((k: any) => !frames.includes(k.Frame))
                nodeChanged = true
                if (node[propName].Keys.length === 0) {
                    delete node[propName]
                }
                return
            }

            if (ownerType === 'geoset') {
                const geosetTrack = getGeosetTrackInfo(type)
                if (!geosetTrack) return
                const geosetAnim = geosetAnimsCopy.find((anim: any) => Number(anim?.GeosetId) === Number(ownerId))
                const track = geosetAnim?.[geosetTrack.propName]
                if (!isAnimTrack(track)) return
                track.Keys = track.Keys.filter((k: any) => !frames.includes(k.Frame))
                geosetChanged = true
                if (track.Keys.length === 0 && geosetAnim) {
                    delete geosetAnim[geosetTrack.propName]
                }
                return
            }

            if (ownerType === 'textureAnim') {
                const textureTrack = getTextureAnimTrackInfo(type)
                if (!textureTrack) return
                const textureAnim = textureAnimsCopy[Number(ownerId)]
                const track = textureAnim?.[textureTrack.propName]
                if (!isAnimTrack(track)) return
                track.Keys = track.Keys.filter((k: any) => !frames.includes(k.Frame))
                textureChanged = true
                if (track.Keys.length === 0 && textureAnim) {
                    delete textureAnim[textureTrack.propName]
                }
                return
            }

            if (ownerType === 'materialLayer') {
                const materialTrack = getMaterialTrackInfo(type)
                if (!materialTrack) return
                const { materialIndex, layerIndex } = decodeMaterialLayerOwnerId(Number(ownerId))
                const track = materialsCopy[materialIndex]?.Layers?.[layerIndex]?.[materialTrack.propName]
                if (!isAnimTrack(track)) return
                track.Keys = track.Keys.filter((k: any) => !frames.includes(k.Frame))
                materialChanged = true
                if (track.Keys.length === 0 && materialsCopy[materialIndex]?.Layers?.[layerIndex]) {
                    const layer = materialsCopy[materialIndex].Layers[layerIndex]
                    layer[materialTrack.propName] = materialTrack.propName === 'TextureID' ? 0 : 1
                }
            }
        })

        if (!nodeChanged && !geosetChanged && !textureChanged && !materialChanged) return

        useHistoryStore.getState().push({
            name: `删除 ${keyframeData.length} 个关键帧`,
            undo: () => applyKeyframeSnapshots(oldNodes, oldGeosetAnims, oldTextureAnims, oldMaterials, { nodeChanged, geosetChanged, textureChanged, materialChanged }),
            redo: () => applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })
        })

        applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })
        setSelectedKeyframeUids(new Set())
    }, [selectedKeyframeUids, getSelectedKeyframeData, applyKeyframeSnapshots, getEditableTimelineSnapshots])

    // Copy keyframes to clipboard (isCut = true for cut operation)
    const copyKeyframes = useCallback((isCut: boolean) => {
        if (selectedKeyframeUids.size === 0) return

        const keyframeData = getSelectedKeyframeData()
        if (keyframeData.length === 0) return

        const baseFrame = Math.min(...keyframeData.map(kf => kf.frame))

        setClipboardKeyframes({
            keyframes: keyframeData.map(kf => ({
                ownerType: kf.ownerType,
                ownerId: kf.ownerId,
                type: kf.type,
                frame: kf.frame,
                value: kf.value,
                inTan: kf.inTan,
                outTan: kf.outTan
            })),
            isCut,
            baseFrame
        })

        if (isCut) {
            deleteSelectedKeyframes()
        }
    }, [selectedKeyframeUids, getSelectedKeyframeData, deleteSelectedKeyframes])

    // Paste keyframes at current frame position
    const pasteKeyframes = useCallback(() => {
        if (!effectiveClipboard) return
        const source = effectiveClipboard.data

        const currentFrame = frameRef.current
        const offset = currentFrame - source.baseFrame

        const { nodes, geosetAnims, textureAnims, materials } = getEditableTimelineSnapshots()
        const oldNodes = cloneNodesForKeyframes(nodes)
        const nodesCopy = cloneNodesForKeyframes(nodes)
        const oldGeosetAnims = cloneGeosetAnimsForKeyframes(geosetAnims)
        const geosetAnimsCopy = cloneGeosetAnimsForKeyframes(geosetAnims)
        const oldTextureAnims = cloneTextureAnimsForKeyframes(textureAnims)
        const textureAnimsCopy = cloneTextureAnimsForKeyframes(textureAnims)
        const oldMaterials = cloneMaterialsForKeyframes(materials)
        const materialsCopy = cloneMaterialsForKeyframes(materials)
        let nodeChanged = false
        let geosetChanged = false
        let textureChanged = false
        let materialChanged = false

        source.keyframes.forEach(kf => {
            const targetFrame = kf.frame + offset
            if (kf.ownerType === 'node') {
                const node = nodesCopy.find((n: any) => n.ObjectId === kf.ownerId)
                if (!node) return

                const propName = getNodeTrackPropertyName(kf.type)
                if (!node[propName]) {
                    node[propName] = {
                        Keys: [],
                        LineType: 1,
                        GlobalSeqId: -1
                    }
                }

                const existingIdx = node[propName].Keys.findIndex((k: any) => k.Frame === targetFrame)
                const vectorSize = getParticleTrackInfo(kf.type)?.vectorSize ?? (kf.type === 'Rotation' ? 4 : (kf.type === 'Translation' || kf.type === 'Scaling' ? 3 : 1))
                const fallback = vectorSize === 1 ? [0] : (vectorSize === 4 ? [0, 0, 0, 1] : [0, 0, 0])
                const newKey: any = {
                    Frame: targetFrame,
                    Vector: toVectorArray(kf.value, vectorSize, fallback)
                }
                if (kf.inTan) newKey.InTan = [...kf.inTan]
                if (kf.outTan) newKey.OutTan = [...kf.outTan]

                if (existingIdx >= 0) {
                    node[propName].Keys[existingIdx] = newKey
                } else {
                    node[propName].Keys.push(newKey)
                    node[propName].Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                nodeChanged = true
                return
            }

            if (kf.ownerType === 'geoset') {
                const geosetTrack = getGeosetTrackInfo(kf.type)
                if (!geosetTrack) return

                let geosetAnim = geosetAnimsCopy.find((anim: any) => Number(anim?.GeosetId) === Number(kf.ownerId))
                if (!geosetAnim) {
                    geosetAnim = { GeosetId: Number(kf.ownerId) }
                    geosetAnimsCopy.push(geosetAnim)
                }

                if (!isAnimTrack(geosetAnim[geosetTrack.propName])) {
                    geosetAnim[geosetTrack.propName] = { InterpolationType: 1, GlobalSeqId: -1, Keys: [] }
                }
                const track = geosetAnim[geosetTrack.propName]
                const existingIdx = track.Keys.findIndex((k: any) => k.Frame === targetFrame)
                const fallback = geosetTrack.vectorSize === 1 ? [1] : [1, 1, 1]
                const vector = toVectorArray(kf.value, geosetTrack.vectorSize, fallback)
                const newKey: any = { Frame: targetFrame, Vector: vector }
                if (Array.isArray(kf.inTan)) newKey.InTan = [...kf.inTan]
                if (Array.isArray(kf.outTan)) newKey.OutTan = [...kf.outTan]

                if (existingIdx >= 0) {
                    track.Keys[existingIdx] = newKey
                } else {
                    track.Keys.push(newKey)
                    track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                geosetChanged = true
                return
            }

            if (kf.ownerType === 'textureAnim') {
                const textureTrack = getTextureAnimTrackInfo(kf.type)
                if (!textureTrack) return
                const textureAnimId = Number(kf.ownerId)
                if (!Number.isFinite(textureAnimId) || textureAnimId < 0) return
                if (!textureAnimsCopy[textureAnimId]) textureAnimsCopy[textureAnimId] = {}
                const textureAnim = textureAnimsCopy[textureAnimId]
                if (!isAnimTrack(textureAnim[textureTrack.propName])) {
                    textureAnim[textureTrack.propName] = { InterpolationType: 1, GlobalSeqId: -1, Keys: [] }
                }
                const track = textureAnim[textureTrack.propName]
                const existingIdx = track.Keys.findIndex((k: any) => k.Frame === targetFrame)
                const vectorSize = textureTrack.propName === 'Rotation'
                    ? ((Array.isArray(kf.value) && kf.value.length <= 1) ? 1 : 4)
                    : 3
                const fallback = vectorSize === 4 ? [0, 0, 0, 1] : [0, 0, 0]
                const vector = toVectorArray(kf.value, vectorSize, fallback)
                const newKey: any = { Frame: targetFrame, Vector: vector }
                if (Array.isArray(kf.inTan)) newKey.InTan = [...kf.inTan]
                if (Array.isArray(kf.outTan)) newKey.OutTan = [...kf.outTan]
                if (existingIdx >= 0) {
                    track.Keys[existingIdx] = newKey
                } else {
                    track.Keys.push(newKey)
                    track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                textureChanged = true
                return
            }

            if (kf.ownerType === 'materialLayer') {
                const materialTrack = getMaterialTrackInfo(kf.type)
                if (!materialTrack) return
                const { materialIndex, layerIndex } = decodeMaterialLayerOwnerId(Number(kf.ownerId))
                if (!materialsCopy[materialIndex]?.Layers?.[layerIndex]) return
                const layer = materialsCopy[materialIndex].Layers[layerIndex]
                if (!isAnimTrack(layer[materialTrack.propName])) {
                    layer[materialTrack.propName] = { InterpolationType: 1, GlobalSeqId: -1, Keys: [] }
                }
                const track = layer[materialTrack.propName]
                const existingIdx = track.Keys.findIndex((k: any) => k.Frame === targetFrame)
                const vector = toVectorArray(kf.value, 1, [materialTrack.propName === 'TextureID' ? 0 : 1])
                const newKey: any = { Frame: targetFrame, Vector: vector }
                if (Array.isArray(kf.inTan)) newKey.InTan = [...kf.inTan]
                if (Array.isArray(kf.outTan)) newKey.OutTan = [...kf.outTan]
                if (existingIdx >= 0) {
                    track.Keys[existingIdx] = newKey
                } else {
                    track.Keys.push(newKey)
                    track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                materialChanged = true
            }
        })

        if (!nodeChanged && !geosetChanged && !textureChanged && !materialChanged) return

        useHistoryStore.getState().push({
            name: `粘贴 ${source.keyframes.length} 个关键帧`,
            undo: () => applyKeyframeSnapshots(oldNodes, oldGeosetAnims, oldTextureAnims, oldMaterials, { nodeChanged, geosetChanged, textureChanged, materialChanged }),
            redo: () => applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })
        })

        applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })

        if (effectiveClipboard.source === 'clipboard' && source.isCut) {
            setClipboardKeyframes(null)
        }
    }, [effectiveClipboard, applyKeyframeSnapshots, getEditableTimelineSnapshots])

    const pasteKeyframesScaled = useCallback((mode: 'ratio' | 'range') => {
        if (!effectiveClipboard) return
        if (!clipboardInfo) return

        const source = effectiveClipboard.data
        const sourceStart = clipboardInfo.start
        const sourceSpan = clipboardInfo.span
        const currentFrame = Math.round(frameRef.current)

        let targetStart = currentFrame
        let scale = 1

        if (mode === 'ratio') {
            scale = (scalePastePercent || 0) / 100
            if (scale <= 0) return
        } else {
            if (scalePasteStart === null || scalePasteEnd === null) return
            if (sourceSpan === 0) return
            if (scalePasteEnd <= scalePasteStart) return
            targetStart = scalePasteStart
            scale = (scalePasteEnd - scalePasteStart) / sourceSpan
        }

        const { nodes, geosetAnims, textureAnims, materials } = getEditableTimelineSnapshots()
        const oldNodes = cloneNodesForKeyframes(nodes)
        const nodesCopy = cloneNodesForKeyframes(nodes)
        const oldGeosetAnims = cloneGeosetAnimsForKeyframes(geosetAnims)
        const geosetAnimsCopy = cloneGeosetAnimsForKeyframes(geosetAnims)
        const oldTextureAnims = cloneTextureAnimsForKeyframes(textureAnims)
        const textureAnimsCopy = cloneTextureAnimsForKeyframes(textureAnims)
        const oldMaterials = cloneMaterialsForKeyframes(materials)
        const materialsCopy = cloneMaterialsForKeyframes(materials)
        let nodeChanged = false
        let geosetChanged = false
        let textureChanged = false
        let materialChanged = false

        source.keyframes.forEach(kf => {
            const targetFrame = Math.round(targetStart + (kf.frame - sourceStart) * scale)
            if (kf.ownerType === 'node') {
                const node = nodesCopy.find((n: any) => n.ObjectId === kf.ownerId)
                if (!node) return

                const propName = getNodeTrackPropertyName(kf.type)
                if (!node[propName]) {
                    node[propName] = {
                        Keys: [],
                        LineType: 1,
                        GlobalSeqId: -1
                    }
                }

                const existingIdx = node[propName].Keys.findIndex((k: any) => k.Frame === targetFrame)
                const vectorSize = getParticleTrackInfo(kf.type)?.vectorSize ?? (kf.type === 'Rotation' ? 4 : (kf.type === 'Translation' || kf.type === 'Scaling' ? 3 : 1))
                const fallback = vectorSize === 1 ? [0] : (vectorSize === 4 ? [0, 0, 0, 1] : [0, 0, 0])
                const newKey: any = {
                    Frame: targetFrame,
                    Vector: toVectorArray(kf.value, vectorSize, fallback)
                }
                if (kf.inTan) newKey.InTan = [...kf.inTan]
                if (kf.outTan) newKey.OutTan = [...kf.outTan]

                if (existingIdx >= 0) {
                    node[propName].Keys[existingIdx] = newKey
                } else {
                    node[propName].Keys.push(newKey)
                    node[propName].Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                nodeChanged = true
                return
            }

            if (kf.ownerType === 'geoset') {
                const geosetTrack = getGeosetTrackInfo(kf.type)
                if (!geosetTrack) return
                let geosetAnim = geosetAnimsCopy.find((anim: any) => Number(anim?.GeosetId) === Number(kf.ownerId))
                if (!geosetAnim) {
                    geosetAnim = { GeosetId: Number(kf.ownerId) }
                    geosetAnimsCopy.push(geosetAnim)
                }

                if (!isAnimTrack(geosetAnim[geosetTrack.propName])) {
                    geosetAnim[geosetTrack.propName] = { InterpolationType: 1, GlobalSeqId: -1, Keys: [] }
                }
                const track = geosetAnim[geosetTrack.propName]
                const existingIdx = track.Keys.findIndex((k: any) => k.Frame === targetFrame)
                const fallback = geosetTrack.vectorSize === 1 ? [1] : [1, 1, 1]
                const vector = toVectorArray(kf.value, geosetTrack.vectorSize, fallback)
                const newKey: any = { Frame: targetFrame, Vector: vector }
                if (Array.isArray(kf.inTan)) newKey.InTan = [...kf.inTan]
                if (Array.isArray(kf.outTan)) newKey.OutTan = [...kf.outTan]

                if (existingIdx >= 0) {
                    track.Keys[existingIdx] = newKey
                } else {
                    track.Keys.push(newKey)
                    track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                geosetChanged = true
                return
            }

            if (kf.ownerType === 'textureAnim') {
                const textureTrack = getTextureAnimTrackInfo(kf.type)
                if (!textureTrack) return
                const textureAnimId = Number(kf.ownerId)
                if (!Number.isFinite(textureAnimId) || textureAnimId < 0) return
                if (!textureAnimsCopy[textureAnimId]) textureAnimsCopy[textureAnimId] = {}
                const textureAnim = textureAnimsCopy[textureAnimId]
                if (!isAnimTrack(textureAnim[textureTrack.propName])) {
                    textureAnim[textureTrack.propName] = { InterpolationType: 1, GlobalSeqId: -1, Keys: [] }
                }
                const track = textureAnim[textureTrack.propName]
                const existingIdx = track.Keys.findIndex((k: any) => k.Frame === targetFrame)
                const vectorSize = textureTrack.propName === 'Rotation'
                    ? ((Array.isArray(kf.value) && kf.value.length <= 1) ? 1 : 4)
                    : 3
                const fallback = vectorSize === 4 ? [0, 0, 0, 1] : [0, 0, 0]
                const vector = toVectorArray(kf.value, vectorSize, fallback)
                const newKey: any = { Frame: targetFrame, Vector: vector }
                if (Array.isArray(kf.inTan)) newKey.InTan = [...kf.inTan]
                if (Array.isArray(kf.outTan)) newKey.OutTan = [...kf.outTan]

                if (existingIdx >= 0) {
                    track.Keys[existingIdx] = newKey
                } else {
                    track.Keys.push(newKey)
                    track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                textureChanged = true
                return
            }

            if (kf.ownerType === 'materialLayer') {
                const materialTrack = getMaterialTrackInfo(kf.type)
                if (!materialTrack) return
                const { materialIndex, layerIndex } = decodeMaterialLayerOwnerId(Number(kf.ownerId))
                if (!materialsCopy[materialIndex]?.Layers?.[layerIndex]) return
                const layer = materialsCopy[materialIndex].Layers[layerIndex]
                if (!isAnimTrack(layer[materialTrack.propName])) {
                    layer[materialTrack.propName] = { InterpolationType: 1, GlobalSeqId: -1, Keys: [] }
                }
                const track = layer[materialTrack.propName]
                const existingIdx = track.Keys.findIndex((k: any) => k.Frame === targetFrame)
                const vector = toVectorArray(kf.value, 1, [materialTrack.propName === 'TextureID' ? 0 : 1])
                const newKey: any = { Frame: targetFrame, Vector: vector }
                if (Array.isArray(kf.inTan)) newKey.InTan = [...kf.inTan]
                if (Array.isArray(kf.outTan)) newKey.OutTan = [...kf.outTan]
                if (existingIdx >= 0) {
                    track.Keys[existingIdx] = newKey
                } else {
                    track.Keys.push(newKey)
                    track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                }
                materialChanged = true
            }
        })

        if (!nodeChanged && !geosetChanged && !textureChanged && !materialChanged) return

        useHistoryStore.getState().push({
            name: `缩放粘贴 ${source.keyframes.length} 个关键帧`,
            undo: () => applyKeyframeSnapshots(oldNodes, oldGeosetAnims, oldTextureAnims, oldMaterials, { nodeChanged, geosetChanged, textureChanged, materialChanged }),
            redo: () => applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })
        })

        applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })

        if (effectiveClipboard.source === 'clipboard' && source.isCut) {
            setClipboardKeyframes(null)
        }
    }, [effectiveClipboard, clipboardInfo, scalePastePercent, scalePasteStart, scalePasteEnd, applyKeyframeSnapshots, getEditableTimelineSnapshots])
    const openScalePasteDialog = useCallback(() => {
        if (!clipboardInfo) return
        const currentFrame = Math.round(frameRef.current)
        const span = Math.max(1, clipboardInfo.span)
        setScalePasteMode('ratio')
        setScalePastePercent(100)
        setScalePasteStart(currentFrame)
        setScalePasteEnd(currentFrame + span)
        setScalePasteOpen(true)
    }, [clipboardInfo])

    const closeContextMenu = useCallback(() => {
        setContextMenu(prev => ({ ...prev, visible: false }))
    }, [])

    useEffect(() => {
        if (!contextMenu.visible) return
        const handleGlobalClick = (e: MouseEvent) => {
            const menu = contextMenuRef.current
            if (menu && menu.contains(e.target as Node)) return
            setContextMenu(prev => ({ ...prev, visible: false }))
        }
        window.addEventListener('mousedown', handleGlobalClick)
        return () => window.removeEventListener('mousedown', handleGlobalClick)
    }, [contextMenu.visible])

    useLayoutEffect(() => {
        if (!contextMenu.visible) return
        const adjustPosition = () => {
            const menu = contextMenuRef.current
            if (!menu) return
            const menuRect = menu.getBoundingClientRect()
            let x = contextMenu.x
            let y = contextMenu.y
            const maxX = Math.max(0, window.innerWidth - menuRect.width - 2)
            const maxY = Math.max(0, window.innerHeight - menuRect.height - 2)
            if (x > maxX) x = maxX
            if (y > maxY) y = maxY
            if (x < 0) x = 0
            if (y < 0) y = 0
            if (x !== contextMenu.x || y !== contextMenu.y) {
                setContextMenu(prev => ({ ...prev, x, y }))
            }
        }
        const rafId = window.requestAnimationFrame(adjustPosition)
        return () => window.cancelAnimationFrame(rafId)
    }, [contextMenu.visible, contextMenu.x, contextMenu.y])

    // --- Global Window Handlers for Robust Dragging ---

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        // Failsafe state check
        if (e.buttons === 0) {
            // Stop any drag
            if (interactionRef.current.mode !== 'none') {
                setIsDragging(false)
                interactionRef.current.mode = 'none'
                setDragTargetSequenceIndex(null)
                setSelectionRect(null)
            }
            return
        }

        const { mode, lastMouseX } = interactionRef.current

        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        if (mode === 'pan') {
            const dx = e.clientX - lastMouseX
            if (Math.abs(e.clientX - interactionRef.current.startX) > 2) {
                blockContextMenuRef.current = true
            }
            const scrollDelta = dx / pixelsPerMsRef.current
            setScrollX(prev => Math.max(0, prev - scrollDelta))
            interactionRef.current.lastMouseX = e.clientX
        } else if (mode === 'scrub') {
            updateFrame(mouseToFrame(e.clientX))
        } else if (mode === 'dragSequenceStart' || mode === 'dragSequenceEnd') {
            // Drag Sequence START ONLY or END ONLY
            const idx = interactionRef.current.dragSequenceIndex
            const dxPixels = e.clientX - interactionRef.current.startX
            const dxFrames = Math.round(dxPixels / pixelsPerMsRef.current)

            const initialInterval = interactionRef.current.initialInterval
            if (initialInterval && idx >= 0) {
                let updatedInterval = [initialInterval[0], initialInterval[1]]

                if (mode === 'dragSequenceStart') {
                    // Update Start
                    let newStart = initialInterval[0] + dxFrames
                    // Constraint: Start < End
                    newStart = Math.min(newStart, initialInterval[1] - 1)
                    updatedInterval = [newStart, initialInterval[1]]
                } else {
                    // Update End
                    let newEnd = initialInterval[1] + dxFrames
                    // Constraint: End > Start
                    newEnd = Math.max(newEnd, initialInterval[0] + 1)
                    updatedInterval = [initialInterval[0], newEnd]
                }

                // 1. Update Store (Updates UI)
                useModelStore.getState().updateSequence(idx, { Interval: updatedInterval })

                // 2. Update Live Renderer (Updates Playback Range IMMEDIATELY)
                const renderer = useRendererStore.getState().renderer
                if (renderer) {
                    // Check if updating currently playing sequence
                    if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                        renderer.rendererData.animationInfo.Interval = [updatedInterval[0], updatedInterval[1]]
                    }
                    // Update model source data to persist change for this session's renderer instance
                    if (renderer.model && renderer.model.Sequences && renderer.model.Sequences[idx]) {
                        renderer.model.Sequences[idx].Interval = [updatedInterval[0], updatedInterval[1]]
                    }
                }
            }

        } else if (mode === 'pendingDragKeyframes') {
            // 检查是否超过拖动阈值，只有超过才进入真正的拖动模式
            const DRAG_THRESHOLD = 8 // 像素
            const dx = Math.abs(e.clientX - interactionRef.current.startX)
            const dy = Math.abs(e.clientY - interactionRef.current.startY)
            if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                // 进入真正的拖动模式
                interactionRef.current.mode = 'dragKeyframes'
                setIsDragging(true)
            }
        } else if (mode === 'dragKeyframes') {
            // Calculate frame offset from drag start
            const currentFrame = mouseToFrame(e.clientX)
            const startFrame = interactionRef.current.dragKeyframeStartFrame
            const frameOffset = Math.round(currentFrame - startFrame)
            const isScale = e.altKey && interactionRef.current.dragKeyframeData.length > 0

            // Update lastMouseX for tracking
            interactionRef.current.lastMouseX = e.clientX

            // Update state for real-time visual feedback in draw
            if (isScale) {
                const anchor = interactionRef.current.dragKeyframeScaleAnchorFrame
                const denom = startFrame - anchor
                let scale = 1
                if (Math.abs(denom) > 1e-4) {
                    scale = (currentFrame - anchor) / denom
                }
                if (!Number.isFinite(scale)) scale = 1
                scale = Math.max(0.05, scale)
                setDragKeyframeScale(scale)
                if (dragKeyframeOffsetRef.current !== 0) setDragKeyframeOffset(0)
            } else {
                if (dragKeyframeScaleRef.current !== null) setDragKeyframeScale(null)
                setDragKeyframeOffset(frameOffset)
            }
        } else if (mode === 'boxSelect') {
            setSelectionRect(prev => ({
                startX: interactionRef.current.startX,
                startY: interactionRef.current.startY,
                endX: mouseX,
                endY: mouseY
            }))
        }
    }, [])

    const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
        const { mode, startX } = interactionRef.current

        window.removeEventListener('mousemove', handleGlobalMouseMove)
        window.removeEventListener('mouseup', handleGlobalMouseUp)

        const canvas = canvasRef.current
        if (!canvas) {
            interactionRef.current.mode = 'none'
            setIsDragging(false)
            setSelectionRect(null)
            return
        }

        if (mode === 'pan') {
            setIsDragging(false)
            setSelectionRect(null)
            interactionRef.current.mode = 'none'
            setTimeout(() => {
                blockContextMenuRef.current = false
            }, 0)
            return
        } else if (mode === 'scrub') {
            setIsDragging(false)
            confirmScrub()
        } else if (mode === 'dragSequenceStart' || mode === 'dragSequenceEnd') {
            setIsDragging(false)
            const idx = interactionRef.current.dragSequenceIndex
            const initialInterval = interactionRef.current.initialInterval

            if (idx >= 0 && initialInterval) {
                const sequences = useModelStore.getState().sequences
                const newInterval = sequences[idx].Interval

                // Only push history if actual change occurred
                if (newInterval[0] !== initialInterval[0] || newInterval[1] !== initialInterval[1]) {
                    useHistoryStore.getState().push({
                        name: `Adjust Sequence ${sequences[idx].Name} Range`,
                        undo: () => {
                            useModelStore.getState().updateSequence(idx, { Interval: initialInterval })
                            // Sync Renderer
                            const renderer = useRendererStore.getState().renderer
                            if (renderer?.model?.Sequences?.[idx]) {
                                renderer.model.Sequences[idx].Interval = [...initialInterval]
                                if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                                    renderer.rendererData.animationInfo.Interval = [...initialInterval]
                                }
                            }
                        },
                        redo: () => {
                            useModelStore.getState().updateSequence(idx, { Interval: newInterval })
                            // Sync Renderer
                            const renderer = useRendererStore.getState().renderer
                            if (renderer?.model?.Sequences?.[idx]) {
                                renderer.model.Sequences[idx].Interval = [...newInterval]
                                if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                                    renderer.rendererData.animationInfo.Interval = [...newInterval]
                                }
                            }
                        }
                    })
                }
            }

            setDragTargetSequenceIndex(null)
            // Force refresh global max if needed
        } else if (mode === 'pendingDragKeyframes') {
            // 未超过拖动阈值，视为点击操作 - 仅选中关键帧，不移动
            setIsDragging(false)
            // 如果点击的是关键帧，跳转到该帧
            const clickedKf = getKeyframeAtPos(e.clientX, e.clientY)
            if (clickedKf) {
                updateFrame(clickedKf.frame)
                confirmScrub()
                const nextSelection = getSelectionSetForKeyframe(clickedKf)
                selectedKeyframeUidsRef.current = nextSelection
                setSelectedKeyframeUids(nextSelection)
            }
        } else if (mode === 'dragKeyframes') {
            setIsDragging(false)

            // Calculate final frame offset
            const currentFrame = mouseToFrame(e.clientX)
            const startFrame = interactionRef.current.dragKeyframeStartFrame
            const frameOffset = Math.round(currentFrame - startFrame)
            const dragScale = dragKeyframeScaleRef.current
            const scaleAnchor = interactionRef.current.dragKeyframeScaleAnchorFrame

            // Only process if there was actual movement
            if (dragScale !== null && interactionRef.current.dragKeyframeData.length > 0 && Math.abs(dragScale - 1) > 1e-4) {
                const { nodes, geosetAnims, textureAnims, materials } = getEditableTimelineSnapshots()
                const oldNodes = cloneNodesForKeyframes(nodes)
                const nodesCopy = cloneNodesForKeyframes(nodes)
                const oldGeosetAnims = cloneGeosetAnimsForKeyframes(geosetAnims)
                const geosetAnimsCopy = cloneGeosetAnimsForKeyframes(geosetAnims)
                const oldTextureAnims = cloneTextureAnimsForKeyframes(textureAnims)
                const textureAnimsCopy = cloneTextureAnimsForKeyframes(textureAnims)
                const oldMaterials = cloneMaterialsForKeyframes(materials)
                const materialsCopy = cloneMaterialsForKeyframes(materials)
                let nodeChanged = false
                let geosetChanged = false
                let textureChanged = false
                let materialChanged = false

                interactionRef.current.dragKeyframeData.forEach(kfData => {
                    const newFrame = Math.round(scaleAnchor + (kfData.originalFrame - scaleAnchor) * dragScale)
                    if (kfData.ownerType === 'node') {
                        const node = nodesCopy.find((n: any) => n.ObjectId === kfData.ownerId)
                        const propName = getNodeTrackPropertyName(kfData.type)
                        if (!node || !isAnimTrack(node[propName])) return

                        let keyIdx = kfData.keyIndex
                        if (keyIdx < 0 || keyIdx >= node[propName].Keys.length) {
                            keyIdx = node[propName].Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                        }
                        if (keyIdx >= 0) {
                            node[propName].Keys[keyIdx].Frame = newFrame
                            nodeChanged = true
                        }
                        return
                    }

                    if (kfData.ownerType === 'geoset') {
                        const geosetTrack = getGeosetTrackInfo(kfData.type)
                        if (!geosetTrack) return
                        const geosetAnim = geosetAnimsCopy.find((anim: any) => Number(anim?.GeosetId) === Number(kfData.ownerId))
                        const track = geosetAnim?.[geosetTrack.propName]
                        if (!isAnimTrack(track)) return

                        let keyIdx = kfData.keyIndex
                        if (keyIdx < 0 || keyIdx >= track.Keys.length) {
                            keyIdx = track.Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                        }
                        if (keyIdx >= 0) {
                            track.Keys[keyIdx].Frame = newFrame
                            geosetChanged = true
                        }
                        return
                    }

                    if (kfData.ownerType === 'textureAnim') {
                        const textureTrack = getTextureAnimTrackInfo(kfData.type)
                        if (!textureTrack) return
                        const textureAnim = textureAnimsCopy[Number(kfData.ownerId)]
                        const track = textureAnim?.[textureTrack.propName]
                        if (!isAnimTrack(track)) return
                        let keyIdx = kfData.keyIndex
                        if (keyIdx < 0 || keyIdx >= track.Keys.length) {
                            keyIdx = track.Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                        }
                        if (keyIdx >= 0) {
                            track.Keys[keyIdx].Frame = newFrame
                            textureChanged = true
                        }
                        return
                    }

                    if (kfData.ownerType === 'materialLayer') {
                        const materialTrack = getMaterialTrackInfo(kfData.type)
                        if (!materialTrack) return
                        const { materialIndex, layerIndex } = decodeMaterialLayerOwnerId(Number(kfData.ownerId))
                        const track = materialsCopy[materialIndex]?.Layers?.[layerIndex]?.[materialTrack.propName]
                        if (!isAnimTrack(track)) return
                        let keyIdx = kfData.keyIndex
                        if (keyIdx < 0 || keyIdx >= track.Keys.length) {
                            keyIdx = track.Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                        }
                        if (keyIdx >= 0) {
                            track.Keys[keyIdx].Frame = newFrame
                            materialChanged = true
                        }
                    }
                })

                interactionRef.current.dragKeyframeData.forEach(kfData => {
                    if (kfData.ownerType === 'node') {
                        const node = nodesCopy.find((n: any) => n.ObjectId === kfData.ownerId)
                        const propName = getNodeTrackPropertyName(kfData.type)
                        if (node && isAnimTrack(node[propName])) {
                            node[propName].Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                        }
                        return
                    }

                    if (kfData.ownerType === 'geoset') {
                        const geosetTrack = getGeosetTrackInfo(kfData.type)
                        if (!geosetTrack) return
                        const geosetAnim = geosetAnimsCopy.find((anim: any) => Number(anim?.GeosetId) === Number(kfData.ownerId))
                        const track = geosetAnim?.[geosetTrack.propName]
                        if (isAnimTrack(track)) {
                            track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                        }
                        return
                    }

                    if (kfData.ownerType === 'textureAnim') {
                        const textureTrack = getTextureAnimTrackInfo(kfData.type)
                        if (!textureTrack) return
                        const textureAnim = textureAnimsCopy[Number(kfData.ownerId)]
                        const track = textureAnim?.[textureTrack.propName]
                        if (isAnimTrack(track)) {
                            track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                        }
                        return
                    }

                    if (kfData.ownerType === 'materialLayer') {
                        const materialTrack = getMaterialTrackInfo(kfData.type)
                        if (!materialTrack) return
                        const { materialIndex, layerIndex } = decodeMaterialLayerOwnerId(Number(kfData.ownerId))
                        const track = materialsCopy[materialIndex]?.Layers?.[layerIndex]?.[materialTrack.propName]
                        if (isAnimTrack(track)) {
                            track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                        }
                    }
                })

                if (nodeChanged || geosetChanged || textureChanged || materialChanged) {
                    useHistoryStore.getState().push({
                        name: `缩放 ${interactionRef.current.dragKeyframeData.length} 个关键帧`,
                        undo: () => applyKeyframeSnapshots(oldNodes, oldGeosetAnims, oldTextureAnims, oldMaterials, { nodeChanged, geosetChanged, textureChanged, materialChanged }),
                        redo: () => applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })
                    })

                    applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })
                }

                // Keep selection on the transformed keyframes.
                const next = new Set<string>()
                interactionRef.current.dragKeyframeData.forEach((kfData) => {
                    const newFrame = Math.round(scaleAnchor + (kfData.originalFrame - scaleAnchor) * dragScale)
                    next.add(makeKeyframeUid(kfData.ownerType, kfData.ownerId, kfData.type, newFrame))
                })
                setSelectedKeyframeUids(next)
            } else if (dragScale === null && frameOffset !== 0 && interactionRef.current.dragKeyframeData.length > 0) {
                const { nodes, geosetAnims, textureAnims, materials } = getEditableTimelineSnapshots()
                const oldNodes = cloneNodesForKeyframes(nodes)
                const nodesCopy = cloneNodesForKeyframes(nodes)
                const oldGeosetAnims = cloneGeosetAnimsForKeyframes(geosetAnims)
                const geosetAnimsCopy = cloneGeosetAnimsForKeyframes(geosetAnims)
                const oldTextureAnims = cloneTextureAnimsForKeyframes(textureAnims)
                const textureAnimsCopy = cloneTextureAnimsForKeyframes(textureAnims)
                const oldMaterials = cloneMaterialsForKeyframes(materials)
                const materialsCopy = cloneMaterialsForKeyframes(materials)
                let nodeChanged = false
                let geosetChanged = false
                let textureChanged = false
                let materialChanged = false

                interactionRef.current.dragKeyframeData.forEach(kfData => {
                    const newFrame = kfData.originalFrame + frameOffset
                    if (kfData.ownerType === 'node') {
                        const node = nodesCopy.find((n: any) => n.ObjectId === kfData.ownerId)
                        const propName = getNodeTrackPropertyName(kfData.type)
                        if (!node || !isAnimTrack(node[propName])) return

                        let keyIdx = kfData.keyIndex
                        if (keyIdx < 0 || keyIdx >= node[propName].Keys.length) {
                            keyIdx = node[propName].Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                        }
                        if (keyIdx >= 0) {
                            node[propName].Keys[keyIdx].Frame = newFrame
                            nodeChanged = true
                        }
                        return
                    }

                    if (kfData.ownerType === 'geoset') {
                        const geosetTrack = getGeosetTrackInfo(kfData.type)
                        if (!geosetTrack) return
                        const geosetAnim = geosetAnimsCopy.find((anim: any) => Number(anim?.GeosetId) === Number(kfData.ownerId))
                        const track = geosetAnim?.[geosetTrack.propName]
                        if (!isAnimTrack(track)) return

                        let keyIdx = kfData.keyIndex
                        if (keyIdx < 0 || keyIdx >= track.Keys.length) {
                            keyIdx = track.Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                        }
                        if (keyIdx >= 0) {
                            track.Keys[keyIdx].Frame = newFrame
                            geosetChanged = true
                        }
                        return
                    }

                    if (kfData.ownerType === 'textureAnim') {
                        const textureTrack = getTextureAnimTrackInfo(kfData.type)
                        if (!textureTrack) return
                        const textureAnim = textureAnimsCopy[Number(kfData.ownerId)]
                        const track = textureAnim?.[textureTrack.propName]
                        if (!isAnimTrack(track)) return

                        let keyIdx = kfData.keyIndex
                        if (keyIdx < 0 || keyIdx >= track.Keys.length) {
                            keyIdx = track.Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                        }
                        if (keyIdx >= 0) {
                            track.Keys[keyIdx].Frame = newFrame
                            textureChanged = true
                        }
                        return
                    }

                    if (kfData.ownerType === 'materialLayer') {
                        const materialTrack = getMaterialTrackInfo(kfData.type)
                        if (!materialTrack) return
                        const { materialIndex, layerIndex } = decodeMaterialLayerOwnerId(Number(kfData.ownerId))
                        const track = materialsCopy[materialIndex]?.Layers?.[layerIndex]?.[materialTrack.propName]
                        if (!isAnimTrack(track)) return

                        let keyIdx = kfData.keyIndex
                        if (keyIdx < 0 || keyIdx >= track.Keys.length) {
                            keyIdx = track.Keys.findIndex((k: any) => k.Frame === kfData.originalFrame)
                        }
                        if (keyIdx >= 0) {
                            track.Keys[keyIdx].Frame = newFrame
                            materialChanged = true
                        }
                    }
                })

                interactionRef.current.dragKeyframeData.forEach(kfData => {
                    if (kfData.ownerType === 'node') {
                        const node = nodesCopy.find((n: any) => n.ObjectId === kfData.ownerId)
                        const propName = getNodeTrackPropertyName(kfData.type)
                        if (node && isAnimTrack(node[propName])) {
                            node[propName].Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                        }
                        return
                    }

                    if (kfData.ownerType === 'geoset') {
                        const geosetTrack = getGeosetTrackInfo(kfData.type)
                        if (!geosetTrack) return
                        const geosetAnim = geosetAnimsCopy.find((anim: any) => Number(anim?.GeosetId) === Number(kfData.ownerId))
                        const track = geosetAnim?.[geosetTrack.propName]
                        if (isAnimTrack(track)) {
                            track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                        }
                        return
                    }

                    if (kfData.ownerType === 'textureAnim') {
                        const textureTrack = getTextureAnimTrackInfo(kfData.type)
                        if (!textureTrack) return
                        const textureAnim = textureAnimsCopy[Number(kfData.ownerId)]
                        const track = textureAnim?.[textureTrack.propName]
                        if (isAnimTrack(track)) {
                            track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                        }
                        return
                    }

                    if (kfData.ownerType === 'materialLayer') {
                        const materialTrack = getMaterialTrackInfo(kfData.type)
                        if (!materialTrack) return
                        const { materialIndex, layerIndex } = decodeMaterialLayerOwnerId(Number(kfData.ownerId))
                        const track = materialsCopy[materialIndex]?.Layers?.[layerIndex]?.[materialTrack.propName]
                        if (isAnimTrack(track)) {
                            track.Keys.sort((a: any, b: any) => a.Frame - b.Frame)
                        }
                    }
                })

                if (nodeChanged || geosetChanged || textureChanged || materialChanged) {
                    useHistoryStore.getState().push({
                        name: `移动 ${interactionRef.current.dragKeyframeData.length} 个关键帧`,
                        undo: () => applyKeyframeSnapshots(oldNodes, oldGeosetAnims, oldTextureAnims, oldMaterials, { nodeChanged, geosetChanged, textureChanged, materialChanged }),
                        redo: () => applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })
                    })

                    applyKeyframeSnapshots(nodesCopy, geosetAnimsCopy, textureAnimsCopy, materialsCopy, { nodeChanged, geosetChanged, textureChanged, materialChanged })
                }

                // Keep selection on the moved keyframes.
                const next = new Set<string>()
                interactionRef.current.dragKeyframeData.forEach((kfData) => {
                    const newFrame = kfData.originalFrame + frameOffset
                    next.add(makeKeyframeUid(kfData.ownerType, kfData.ownerId, kfData.type, newFrame))
                })
                setSelectedKeyframeUids(next)
            }

            // Reset drag offset preview
            setDragKeyframeOffset(0)
            setDragKeyframeScale(null)
        } else if (mode === 'boxSelect') {
            const rect = canvas.getBoundingClientRect()
            const mouseX = e.clientX - rect.left
            const mouseY = e.clientY - rect.top

            const dist = Math.sqrt((mouseX - startX) ** 2 + (mouseY - interactionRef.current.startY) ** 2)

            if (dist < CLICK_MOVE_THRESHOLD) {
                const kf = getKeyframeAtPos(e.clientX, e.clientY)
                if (kf) {
                    updateFrame(kf.frame)
                    confirmScrub()
                    const nextSelection = getSelectionSetForKeyframe(kf)
                    selectedKeyframeUidsRef.current = nextSelection
                    setSelectedKeyframeUids(nextSelection)
                } else {
                    setSelectedKeyframeUids(new Set())
                }
            } else {
                const rectStart = Math.min(interactionRef.current.startX, mouseX)
                const rectEnd = Math.max(interactionRef.current.startX, mouseX)
                const rectTop = Math.min(interactionRef.current.startY, mouseY)
                const rectBottom = Math.max(interactionRef.current.startY, mouseY)

                const pxPerMs = pixelsPerMsRef.current
                const scroll = scrollXRef.current
                const displayMode = keyframeDisplayModeRef.current
                const laneMetrics = getLaneMetrics(displayMode, canvas.height)
                const laneYMap = laneMetrics.laneYMap

                const ids = new Set<string>()
                activeKeyframesRef.current.forEach(kf => {
                    if (!isKeyframeTypeVisible(kf.type, displayMode)) return

                    const kx = (kf.frame - scroll) * pxPerMs
                    if (kx < rectStart || kx > rectEnd) return

                    if (displayMode === 'particle') {
                        const intersectsParticleBand =
                            !(rectBottom < laneMetrics.trackTop || rectTop > laneMetrics.trackBottom)
                        if (intersectsParticleBand) ids.add(kf.uid)
                        return
                    }

                    const ky = laneYMap[kf.type] ?? (RULER_HEIGHT + OFFSET_TRANSLATION)
                    if (ky >= rectTop && ky <= rectBottom) ids.add(kf.uid)
                })
                setSelectedKeyframeUids(ids)
            }
            setSelectionRect(null)
        }

        interactionRef.current.mode = 'none'
    }, [handleGlobalMouseMove])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        if (contextMenu.visible) {
            closeContextMenu()
        }

        if (e.button === 2) {
            blockContextMenuRef.current = false
            interactionRef.current = {
                mode: 'pan',
                startX: e.clientX,
                startY: e.clientY,
                lastMouseX: e.clientX,
                initialScrollX: scrollXRef.current,
                dragSequenceIndex: -1,
                initialInterval: [0, 0],
                dragKeyframeStartFrame: 0,
                dragKeyframeData: [],
                dragKeyframeMinFrame: 0,
                dragKeyframeMaxFrame: 0,
                dragKeyframeScaleAnchorFrame: 0
            }
            setIsDragging(true)
            window.addEventListener('mousemove', handleGlobalMouseMove)
            window.addEventListener('mouseup', handleGlobalMouseUp)
            return
        }

        window.addEventListener('mousemove', handleGlobalMouseMove)
        window.addEventListener('mouseup', handleGlobalMouseUp)

        // 1. Check for Sequence Handles (Hit Test at Bottom)
        const handleHit = getSequenceHandleAtPos(e.clientX, e.clientY)
        if (handleHit) {
            const seq = useModelStore.getState().sequences[handleHit.index]
            interactionRef.current = {
                mode: handleHit.type === 'start' ? 'dragSequenceStart' : 'dragSequenceEnd',
                startX: e.clientX,
                startY: e.clientY,
                lastMouseX: e.clientX,
                initialScrollX: 0,
                dragSequenceIndex: handleHit.index,
                initialInterval: [...seq.Interval],
                dragKeyframeStartFrame: 0,
                dragKeyframeData: [],
                dragKeyframeMinFrame: 0,
                dragKeyframeMaxFrame: 0,
                dragKeyframeScaleAnchorFrame: 0
            }
            setIsDragging(true)
            setDragTargetSequenceIndex(handleHit.index)
            return
        }

        if (mouseY < RULER_HEIGHT) {
            // Scrub
            interactionRef.current = {
                mode: 'scrub',
                startX: e.clientX,
                startY: e.clientY,
                lastMouseX: e.clientX,
                initialScrollX: 0,
                dragSequenceIndex: -1,
                initialInterval: [0, 0],
                dragKeyframeStartFrame: 0,
                dragKeyframeData: [],
                dragKeyframeMinFrame: 0,
                dragKeyframeMaxFrame: 0,
                dragKeyframeScaleAnchorFrame: 0
            }
            setIsDragging(true)
            setPlaying(false)
            updateFrame(mouseToFrame(e.clientX))
            confirmScrub()
        } else {
            // Check if clicking on a selected keyframe (to drag)
            const clickedKf = getKeyframeAtPos(e.clientX, e.clientY)
            if (clickedKf && selectedKeyframeUids.has(clickedKf.uid)) {
                // 开始待定拖动模式（需要移动超过阈值才能真正拖动）
                const dragData = getSelectedKeyframeData().map(kf => ({
                    ownerType: kf.ownerType,
                    ownerId: kf.ownerId,
                    type: kf.type,
                    originalFrame: kf.frame,
                    keyIndex: kf.keyIndex
                }))
                const dragFrames = dragData.length > 0 ? dragData.map(kf => kf.originalFrame) : [clickedKf.frame]
                const minFrame = Math.min(...dragFrames)
                const maxFrame = Math.max(...dragFrames)
                let anchorFrame = minFrame
                if (maxFrame !== minFrame) {
                    const distToMin = Math.abs(clickedKf.frame - minFrame)
                    const distToMax = Math.abs(maxFrame - clickedKf.frame)
                    anchorFrame = distToMin >= distToMax ? minFrame : maxFrame
                }

                interactionRef.current = {
                    mode: 'pendingDragKeyframes',
                    startX: e.clientX,
                    startY: e.clientY,
                    lastMouseX: mouseX,
                    initialScrollX: 0,
                    dragSequenceIndex: -1,
                    initialInterval: [0, 0],
                    dragKeyframeStartFrame: clickedKf.frame,
                    dragKeyframeData: dragData,
                    dragKeyframeMinFrame: minFrame,
                    dragKeyframeMaxFrame: maxFrame,
                    dragKeyframeScaleAnchorFrame: anchorFrame
                }
                // 注意：这里不设置 setIsDragging(true)，等待超过阈值后再设置
            } else {
                // Box select mode
                interactionRef.current = {
                    mode: 'boxSelect',
                    startX: mouseX,
                    startY: mouseY,
                    lastMouseX: mouseX,
                    initialScrollX: 0,
                    dragSequenceIndex: -1,
                    initialInterval: [0, 0],
                    dragKeyframeStartFrame: 0,
                    dragKeyframeData: [],
                    dragKeyframeMinFrame: 0,
                    dragKeyframeMaxFrame: 0,
                    dragKeyframeScaleAnchorFrame: 0
                }
                setSelectionRect({ startX: mouseX, startY: mouseY, endX: mouseX, endY: mouseY })
            }
        }
    }, [handleGlobalMouseMove, handleGlobalMouseUp, setPlaying, selectedKeyframeUids, getSelectedKeyframeData, contextMenu.visible, closeContextMenu, getEditableTimelineSnapshots])

    useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove)
            window.removeEventListener('mouseup', handleGlobalMouseUp)
        }
    }, [handleGlobalMouseMove, handleGlobalMouseUp])


    const handleWheel = (e: React.WheelEvent) => {
        if (contextMenu.visible) {
            closeContextMenu()
        }
        const zoomSpeed = 0.001
        const delta = -e.deltaY
        const factor = 1 + delta * zoomSpeed

        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseFrame = scrollXRef.current + mouseX / pixelsPerMsRef.current

        const newPixelsPerMs = Math.max(minPixelsPerMs, Math.min(maxPixelsPerMs, pixelsPerMs * factor))
        setPixelsPerMs(newPixelsPerMs)
        setScrollX(Math.max(0, mouseFrame - mouseX / newPixelsPerMs))
    }

    const handleGoToStart = () => { setFrame(seqStart); setDisplayFrame(seqStart) }
    const handlePrevFrame = () => { setFrame(Math.max(seqStart, Math.round(frameRef.current) - 33)) }
    const handleNextFrame = () => { setFrame(Math.min(seqEnd, Math.round(frameRef.current) + 33)) }
    const handleGoToEnd = () => { setFrame(seqEnd); setDisplayFrame(seqEnd) }
    const jumpToAdjacentKeyframe = useCallback((direction: -1 | 1) => {
        const frames = Array.from(new Set(
            activeKeyframesRef.current
                .filter((kf) => {
                    if (!isKeyframeTypeVisible(kf.type, keyframeDisplayModeRef.current)) return false
                    return kf.frame >= seqStartRef.current && kf.frame <= seqEndRef.current
                })
                .map((kf) => Math.round(kf.frame))
        )).sort((a, b) => a - b)

        if (frames.length === 0) return false

        const currentFrame = Math.round(frameRef.current)
        const targetFrame = direction < 0
            ? [...frames].reverse().find((frame) => frame < currentFrame)
            : frames.find((frame) => frame > currentFrame)

        if (typeof targetFrame !== 'number') return false

        updateFrame(targetFrame)
        setDisplayFrame(targetFrame)
        confirmScrub()
        return true
    }, [confirmScrub])

    // Toolbar Handlers
    const handleFrameInputChange = (e: any) => {
        const val = parseInt(e.target.value)
        if (!isNaN(val)) {
            setFrame(val)
            setDisplayFrame(val)
        }
    }

    useEffect(() => {
        if (!isActive) return

        const unsubscribeHandlers = [
            registerShortcutHandler('timeline.deleteKeyframes', () => {
                if (selectedKeyframeUids.size === 0) return false
                deleteSelectedKeyframes()
                return true
            }),
            registerShortcutHandler('timeline.copyKeyframes', () => {
                if (selectedKeyframeUids.size === 0) return false
                copyKeyframes(false)
                return true
            }),
            registerShortcutHandler('timeline.cutKeyframes', () => {
                if (selectedKeyframeUids.size === 0) return false
                copyKeyframes(true)
                return true
            }),
            registerShortcutHandler('timeline.pasteKeyframes', () => {
                if (!effectiveClipboard) return false
                pasteKeyframes()
                return true
            }),
            registerShortcutHandler('timeline.quickKeyframe', () => {
                return insertKeyframesForSelectedNodes()
            }),
            registerShortcutHandler('timeline.prevKeyframe', () => {
                return jumpToAdjacentKeyframe(-1)
            }),
            registerShortcutHandler('timeline.nextKeyframe', () => {
                return jumpToAdjacentKeyframe(1)
            })
        ]

        return () => {
            unsubscribeHandlers.forEach((unsubscribe) => unsubscribe())
        }
    }, [isActive, selectedKeyframeUids, effectiveClipboard, deleteSelectedKeyframes, copyKeyframes, pasteKeyframes, insertKeyframesForSelectedNodes, jumpToAdjacentKeyframe])

    const handleSeqStartChange = (val: number | null) => {
        if (val !== null && currentSequence >= 0 && sequences) {
            const currentEnd = sequences[currentSequence].Interval[1]
            const oldInterval = [...sequences[currentSequence].Interval] // Snap old
            const newInterval = [val, currentEnd]

            const idx = currentSequence

            const doUpdate = (interval: number[]) => {
                useModelStore.getState().updateSequence(idx, { Interval: interval })
                // Sync Renderer
                const renderer = useRendererStore.getState().renderer
                if (renderer) {
                    if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                        renderer.rendererData.animationInfo.Interval = [...interval]
                    }
                    if (renderer.model && renderer.model.Sequences && renderer.model.Sequences[idx]) {
                        renderer.model.Sequences[idx].Interval = [...interval]
                    }
                }
            }

            doUpdate(newInterval)

            useHistoryStore.getState().push({
                name: `Set Sequence Start`,
                undo: () => doUpdate(oldInterval),
                redo: () => doUpdate(newInterval)
            })
        }
    }

    const handleSeqEndChange = (val: number | null) => {
        if (val !== null && currentSequence >= 0 && sequences) {
            const currentStart = sequences[currentSequence].Interval[0]
            const oldInterval = [...sequences[currentSequence].Interval]
            const newInterval = [currentStart, val]

            const idx = currentSequence

            const doUpdate = (interval: number[]) => {
                useModelStore.getState().updateSequence(idx, { Interval: interval })
                // Sync Renderer
                const renderer = useRendererStore.getState().renderer
                if (renderer) {
                    if (renderer.rendererData.animation === idx && renderer.rendererData.animationInfo) {
                        renderer.rendererData.animationInfo.Interval = [...interval]
                    }
                    if (renderer.model && renderer.model.Sequences && renderer.model.Sequences[idx]) {
                        renderer.model.Sequences[idx].Interval = [...interval]
                    }
                }
            }

            doUpdate(newInterval)

            useHistoryStore.getState().push({
                name: `Set Sequence End`,
                undo: () => doUpdate(oldInterval),
                redo: () => doUpdate(newInterval)
            })
        }
    }

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        if (blockContextMenuRef.current) {
            return
        }
        const clickedKf = getKeyframeAtPos(e.clientX, e.clientY)
        if (clickedKf && !selectedKeyframeUidsRef.current.has(clickedKf.uid)) {
            const next = getSelectionSetForKeyframe(clickedKf)
            selectedKeyframeUidsRef.current = next
            setSelectedKeyframeUids(next)
        }

        if (selectedKeyframeUidsRef.current.size === 0) {
            return
        }

        const selectionCount = selectedKeyframeUidsRef.current.size
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, selectionCount })
    }, [getKeyframeAtPos, getSelectionSetForKeyframe])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#1e1e1e', userSelect: 'none' }} onContextMenu={(e) => e.preventDefault()}>
            <style dangerouslySetInnerHTML={{
                __html: `
                .timeline-context-menu.ant-menu {
                    background: #2a2a2a;
                    border: none;
                }
                .timeline-context-menu-item {
                    height: 28px;
                    line-height: 28px;
                    padding: 0 12px;
                    margin: 0;
                    color: #fff;
                    font-size: 12px;
                    transition: background-color 0.12s ease, color 0.12s ease;
                    cursor: pointer;
                    white-space: nowrap;
                }
                .timeline-context-menu-item:hover {
                    background: #1f4f8f;
                    color: #fff;
                }
                .timeline-context-menu-item-disabled {
                    color: #666;
                    cursor: not-allowed;
                }
                .timeline-context-menu-item-disabled:hover {
                    background: transparent;
                    color: #666;
                }
                .timeline-context-menu-divider {
                    height: 1px;
                    margin: 4px 0;
                    background: #333;
                }
            `}} />
            <Modal
                title="缩放粘贴关键帧"
                open={scalePasteOpen}
                onCancel={() => setScalePasteOpen(false)}
                onOk={() => {
                    pasteKeyframesScaled(scalePasteMode)
                    setScalePasteOpen(false)
                }}
                okButtonProps={{
                    disabled: scalePasteMode === 'ratio'
                        ? !clipboardInfo || scalePastePercent <= 0
                        : !clipboardInfo || clipboardInfo.span === 0 || scalePasteStart === null || scalePasteEnd === null || scalePasteEnd <= scalePasteStart
                }}
                okText="粘贴"
                cancelText="取消"
                width={420}
                styles={{
                    content: { backgroundColor: '#1e1e1e', color: '#ccc' },
                    header: { backgroundColor: '#1e1e1e', color: '#ccc', borderBottom: '1px solid #333' },
                    body: { padding: '16px 20px' }
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Radio.Group
                        value={scalePasteMode}
                        onChange={(e) => setScalePasteMode(e.target.value)}
                        style={{ color: '#ccc' }}
                    >
                        <Radio value="ratio" style={{ color: '#ccc' }}>按比例缩放</Radio>
                        <Radio value="range" style={{ color: '#ccc' }}>按首尾帧范围缩放</Radio>
                    </Radio.Group>

                    {scalePasteMode === 'ratio' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: '#aaa', minWidth: 90 }}>缩放比例:</span>
                            <InputNumber
                                min={1}
                                max={1000}
                                value={scalePastePercent}
                                onChange={(v) => setScalePastePercent((v ?? 100) as number)}
                                style={{ width: 120 }}
                            />
                            <span style={{ color: '#888' }}>%</span>
                        </div>
                    )}

                    {scalePasteMode === 'range' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#aaa', minWidth: 90 }}>开始帧:</span>
                                <InputNumber
                                    min={0}
                                    value={scalePasteStart ?? undefined}
                                    onChange={(v) => setScalePasteStart(v === null ? null : (v as number))}
                                    style={{ width: 140 }}
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#aaa', minWidth: 90 }}>结束帧:</span>
                                <InputNumber
                                    min={0}
                                    value={scalePasteEnd ?? undefined}
                                    onChange={(v) => setScalePasteEnd(v === null ? null : (v as number))}
                                    style={{ width: 140 }}
                                />
                            </div>
                            {clipboardInfo && (
                                <div style={{ color: '#777', fontSize: 12 }}>
                                    源范围: {clipboardInfo.start} - {clipboardInfo.end} ({clipboardInfo.span} 帧)
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </Modal>
            {/* Toolbar */}
            <div
                style={{
                    minHeight: 36,
                    borderBottom: '1px solid #333',
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
                    alignItems: 'center',
                    padding: '4px 10px',
                    columnGap: 10,
                    rowGap: 0,
                    overflowX: 'auto',
                    overflowY: 'hidden'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'nowrap', whiteSpace: 'nowrap', justifySelf: 'start' }}>

                    {/* Frame/Current */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: '#aaa', fontSize: '12px' }}>当前:</span>
                        <Input
                            size="small"
                            style={{ width: 60, height: 22, backgroundColor: '#333', border: '1px solid #555', color: '#eee' }}
                            value={isEditingFrame ? inputFrameValue : displayFrame}
                            onChange={(e) => {
                                setIsEditingFrame(true)
                                setInputFrameValue(e.target.value)
                            }}
                            onBlur={(e) => {
                                setIsEditingFrame(false)
                                handleFrameInputChange(e)
                            }}
                            onPressEnter={(e: any) => {
                                setIsEditingFrame(false)
                                handleFrameInputChange(e)
                            }}
                        />
                    </div>

                    {/* Drag Offset / Scale Display (only during drag) */}
                    {dragKeyframeScale !== null && (() => (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, backgroundColor: 'rgba(250, 173, 20, 0.18)', padding: '2px 8px', borderRadius: 4 }}>
                            <span style={{ color: '#faad14', fontSize: '12px', fontWeight: 'bold' }}>
                                {'\u7f29\u653e:'} x{dragKeyframeScale.toFixed(2)}
                            </span>
                        </div>
                    ))()}
                    {dragKeyframeScale === null && dragKeyframeOffset !== 0 && (() => {
                        // Calculate target frame from first selected keyframe
                        const firstSelectedKf = activeKeyframesRef.current.find(kf => selectedKeyframeUids.has(kf.uid))
                        const targetFrame = firstSelectedKf ? firstSelectedKf.frame + dragKeyframeOffset : null
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, backgroundColor: 'rgba(24, 144, 255, 0.2)', padding: '2px 8px', borderRadius: 4 }}>
                                <span style={{ color: '#1890ff', fontSize: '12px', fontWeight: 'bold' }}>
                                    ???: {dragKeyframeOffset > 0 ? '+' : ''}{dragKeyframeOffset}??
                                </span>
                                {targetFrame !== null && (
                                    <span style={{ color: '#52c41a', fontSize: '12px', fontWeight: 'bold' }}>
                                        ????{targetFrame}
                                    </span>
                                )}
                            </div>
                        )
                    })()}

                </div>

                {/* Playback Controls */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'nowrap', whiteSpace: 'nowrap', minWidth: 'max-content', justifySelf: 'center' }}>
                    <div style={{ marginTop: 2 }}>
                        <Tooltip title={currentKeyframeModeConfig.tooltip}>
                            <Dropdown
                                menu={{
                                    items: keyframeModeMenuItems,
                                    selectedKeys: [keyframeDisplayMode],
                                    onClick: ({ key }) => setTimelineKeyframeDisplayMode(key as KeyframeDisplayMode)
                                }}
                                trigger={['click']}
                            >
                                <Button
                                    size="small"
                                    style={{
                                        minWidth: 112,
                                        height: 24,
                                        backgroundColor: currentKeyframeModeConfig.buttonColor,
                                        border: '1px solid #555',
                                        color: '#eee',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between'
                                    }}
                                >
                                    {currentKeyframeModeConfig.label}
                                    <DownOutlined style={{ fontSize: 10, marginLeft: 6 }} />
                                </Button>
                            </Dropdown>
                        </Tooltip>
                    </div>
                    <Button type="text" icon={<StepBackwardOutlined />} onClick={handleGoToStart} style={{ color: '#eee' }} />
                    <Button type="text" icon={<FastBackwardOutlined />} onClick={handlePrevFrame} style={{ color: '#eee' }} />

                    <Button
                        type="text"
                        shape="circle"
                        icon={isPlaying ? <PauseCircleOutlined style={{ fontSize: '24px', color: '#1890ff' }} /> : <PlayCircleOutlined style={{ fontSize: '24px', color: '#eee' }} />}
                        onClick={() => setPlaying(!isPlaying)}
                    />

                    <Button type="text" icon={<FastForwardOutlined />} onClick={handleNextFrame} style={{ color: '#eee' }} />
                    <Button type="text" icon={<StepForwardOutlined />} onClick={handleGoToEnd} style={{ color: '#eee' }} />

                    {/* Show All Keyframes Toggle (Moved to Right of Auto Key) */}
                    <Button
                        type="text"
                        icon={showAllKeyframes ? <EyeOutlined style={{ color: '#1890ff' }} /> : <EyeInvisibleOutlined />}
                        title="显示所有关键帧类型"
                        onClick={() => setShowAllKeyframes(!showAllKeyframes)}
                        style={{ color: showAllKeyframes ? '#1890ff' : '#eee' }}
                    />
                    <Button
                        type="text"
                        icon={<NodeIndexOutlined style={{ color: showAllOwnerKeyframes ? '#1890ff' : undefined }} />}
                        title={showAllOwnerKeyframes ? '显示所有对象的关键帧' : '只显示选中对象的关键帧'}
                        onClick={() => setShowAllOwnerKeyframes(!showAllOwnerKeyframes)}
                        style={{ color: showAllOwnerKeyframes ? '#1890ff' : '#eee' }}
                    />
                </div>

                {/* Zoom & Sequence Range (Right Aligned) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'nowrap', whiteSpace: 'nowrap', justifyContent: 'flex-end', justifySelf: 'end' }}>
                    {/* Sequence Range Inputs */}
                    {!isSpecificGlobalSequenceView && sequence && sequence.Interval && sequence.Interval.length >= 2 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color: '#888', fontSize: '11px' }}>序列:</span>
                            <InputNumber
                                size="small"
                                style={{ width: 55, height: 20, backgroundColor: '#333', border: '1px solid #555', color: '#eee', fontSize: '11px' }}
                                value={sequence.Interval[0]}
                                onChange={handleSeqStartChange}
                                controls={false}
                            />
                            <span style={{ color: '#666', fontSize: '11px' }}>-</span>
                            <InputNumber
                                size="small"
                                style={{ width: 55, height: 20, backgroundColor: '#333', border: '1px solid #555', color: '#eee', fontSize: '11px' }}
                                value={sequence.Interval[1]}
                                onChange={handleSeqEndChange}
                                controls={false}
                            />
                        </div>
                    )}
                    {isSpecificGlobalSequenceView && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color: '#888', fontSize: '11px' }}>全局序列:</span>
                            <InputNumber
                                size="small"
                                style={{ width: 80, height: 20, backgroundColor: '#333', border: '1px solid #555', color: '#eee', fontSize: '11px' }}
                                value={seqEnd}
                                controls={false}
                                readOnly
                            />
                        </div>
                    )}
                    <span style={{ color: '#444', fontSize: '12px' }}>|</span>
                    <ZoomOutOutlined style={{ color: '#888' }} />
                    <Slider
                        min={minPixelsPerMs}
                        max={maxPixelsPerMs}
                        step={0.01}
                        value={pixelsPerMs}
                        onChange={(v) => {
                            const centerFrame = scrollX + (containerSizeRef.current.width / 2) / pixelsPerMs
                            setPixelsPerMs(v as number)
                            // Keep center focused
                            setScrollX(Math.max(0, centerFrame - (containerSizeRef.current.width / 2) / (v as number)))
                        }}
                        style={{ width: 90 }}
                        tooltip={{ formatter: null }}
                    />
                    <ZoomInOutlined style={{ color: '#888' }} />
                </div>
            </div>

            {/* Canvas Container */}
            <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }} onWheel={handleWheel} onContextMenu={handleContextMenu}>
                <canvas
                    ref={canvasRef}
                    style={{ width: '100%', height: '100%', display: 'block', cursor: isDragging ? 'grabbing' : 'default' }}
                    onMouseDown={handleMouseDown}
                />
            </div>
            {contextMenu.visible && (
                <div
                    ref={contextMenuRef}
                    style={{
                        position: 'fixed',
                        left: contextMenu.x,
                        top: contextMenu.y,
                        zIndex: 4000,
                        backgroundColor: '#2a2a2a',
                        border: '1px solid #3a3a3a',
                        borderRadius: 4,
                        boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
                        padding: '4px 0',
                        minWidth: 110
                    }}
                >
                    <div
                        className={`timeline-context-menu-item${contextMenu.selectionCount === 0 ? ' timeline-context-menu-item-disabled' : ''}`}
                        onClick={contextMenu.selectionCount === 0 ? undefined : () => { copyKeyframes(false); closeContextMenu() }}
                    >
                        复制
                    </div>
                    <div
                        className={`timeline-context-menu-item${contextMenu.selectionCount === 0 ? ' timeline-context-menu-item-disabled' : ''}`}
                        onClick={contextMenu.selectionCount === 0 ? undefined : () => { copyKeyframes(true); closeContextMenu() }}
                    >
                        剪切
                    </div>
                    <div
                        className={`timeline-context-menu-item${!effectiveClipboard || effectiveClipboard.data.keyframes.length === 0 ? ' timeline-context-menu-item-disabled' : ''}`}
                        onClick={!effectiveClipboard || effectiveClipboard.data.keyframes.length === 0 ? undefined : () => { pasteKeyframes(); closeContextMenu() }}
                    >
                        粘贴
                    </div>
                    <div
                        className={`timeline-context-menu-item${!effectiveClipboard || effectiveClipboard.data.keyframes.length <= 2 ? ' timeline-context-menu-item-disabled' : ''}`}
                        onClick={!effectiveClipboard || effectiveClipboard.data.keyframes.length <= 2 ? undefined : () => { openScalePasteDialog(); closeContextMenu() }}
                    >
                        缩放粘贴
                    </div>
                    <div className="timeline-context-menu-divider" />
                    <div
                        className={`timeline-context-menu-item${contextMenu.selectionCount === 0 ? ' timeline-context-menu-item-disabled' : ''}`}
                        onClick={contextMenu.selectionCount === 0 ? undefined : () => { deleteSelectedKeyframes(); closeContextMenu() }}
                    >
                        删除
                    </div>
                </div>
            )}
        </div>
    )
}

const btnStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', color: '#ccc'
}

export default React.memo(TimelinePanel)
