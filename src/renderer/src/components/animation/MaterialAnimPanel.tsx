import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Button, Select, Typography } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'

import { useHistoryStore } from '../../store/historyStore'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { windowManager } from '../../utils/windowManager'
import { GlobalSequenceSelect } from '../common/GlobalSequenceSelect'
import RightFloatingPanelShell from './RightFloatingPanelShell'

const { Text } = Typography

const INTERPOLATION_OPTIONS = [
    { label: '无插值', value: 0 },
    { label: '线性', value: 1 },
    { label: '埃尔米特', value: 2 },
    { label: '贝塞尔', value: 3 }
]

const deepClone = <T,>(value: T): T => {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
}

const isAnimTrack = (value: any): value is { Keys: any[]; GlobalSeqId?: number | null; InterpolationType?: number; LineType?: number } => (
    !!value && typeof value === 'object' && Array.isArray(value.Keys)
)

const normalizeScalarTrackKeys = (keys: any[], fallback: number) => {
    if (!Array.isArray(keys)) return []
    return keys
        .map((key) => {
            const frame = Number(key?.Frame ?? key?.Time ?? 0)
            const rawVector = ArrayBuffer.isView(key?.Vector) ? Array.from(key.Vector as ArrayLike<number>) : key?.Vector
            const value = Array.isArray(rawVector) ? Number(rawVector[0] ?? fallback) : Number(rawVector ?? fallback)
            return {
                Frame: Number.isFinite(frame) ? Math.round(frame) : 0,
                Vector: [Number.isFinite(value) ? value : fallback],
                InTan: [0],
                OutTan: [0]
            }
        })
        .sort((a, b) => a.Frame - b.Frame)
}

const sampleScalarTrack = (track: any, frame: number, fallback: number) => {
    if (!isAnimTrack(track) || track.Keys.length === 0) return fallback
    const keys = normalizeScalarTrackKeys(track.Keys, fallback)
    if (keys.length === 0) return fallback
    if (frame <= keys[0].Frame) return Number(keys[0].Vector[0] ?? fallback)
    if (frame >= keys[keys.length - 1].Frame) return Number(keys[keys.length - 1].Vector[0] ?? fallback)
    for (let i = 0; i < keys.length - 1; i++) {
        const left = keys[i]
        const right = keys[i + 1]
        if (frame >= left.Frame && frame <= right.Frame) {
            const span = right.Frame - left.Frame
            if (span <= 0) return Number(left.Vector[0] ?? fallback)
            const t = (frame - left.Frame) / span
            return Number(left.Vector[0] ?? fallback) + (Number(right.Vector[0] ?? fallback) - Number(left.Vector[0] ?? fallback)) * t
        }
    }
    return fallback
}

const upsertScalarTrackKey = (keys: any[], frame: number, value: number) => {
    const normalized = normalizeScalarTrackKeys(keys, value)
    const targetFrame = Math.round(frame)
    const newKey = { Frame: targetFrame, Vector: [value], InTan: [0], OutTan: [0] }
    const index = normalized.findIndex((key) => key.Frame === targetFrame)
    if (index >= 0) normalized[index] = newKey
    else normalized.push(newKey)
    normalized.sort((a, b) => a.Frame - b.Frame)
    return normalized
}

const createDefaultLayer = () => ({
    FilterMode: 0,
    TextureID: 0,
    Alpha: 1,
    Unshaded: true,
    Unfogged: false,
    TwoSided: true,
    SphereEnvMap: false,
    NoDepthTest: false,
    NoDepthSet: false
})

const getTextureName = (image: any) => {
    const path = String(image || '')
    if (!path) return '(空贴图)'
    const parts = path.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || path
}

const MaterialAnimPanel: React.FC = () => {
    const { modelData, currentFrame, setMaterials } = useModelStore()
    const {
        pickedGeosetIndex,
        selectedMaterialIndex,
        selectedMaterialIndices,
        setSelectedMaterialIndex,
        setSelectedMaterialIndices,
        timelineKeyframeDisplayMode
    } = useSelectionStore()

    const [collapsed, setCollapsed] = useState(true)
    const [editingField, setEditingField] = useState<'TextureID' | 'Alpha' | null>(null)

    useEffect(() => {
        setCollapsed(timelineKeyframeDisplayMode !== 'material')
    }, [timelineKeyframeDisplayMode])

    const materials = useMemo(() => Array.isArray((modelData as any)?.Materials) ? ((modelData as any).Materials as any[]) : [], [modelData])
    const textures = useMemo(() => Array.isArray((modelData as any)?.Textures) ? ((modelData as any).Textures as any[]) : [], [modelData])
    const roundedFrame = Math.round(currentFrame)

    const selectedIds = useMemo(() => {
        const base = selectedMaterialIndices.filter((id) => id >= 0 && id < materials.length)
        if (base.length > 0) return base
        if (selectedMaterialIndex !== null && selectedMaterialIndex >= 0 && selectedMaterialIndex < materials.length) return [selectedMaterialIndex]
        return []
    }, [materials.length, selectedMaterialIndex, selectedMaterialIndices])

    const primaryMaterialIndex = selectedIds[0] ?? null
    const primaryMaterial = primaryMaterialIndex !== null ? materials[primaryMaterialIndex] : null
    const primaryLayer = primaryMaterial?.Layers?.[0] ?? null

    useEffect(() => {
        if (materials.length === 0) {
            if (selectedMaterialIndex !== null) setSelectedMaterialIndex(null)
            if (selectedMaterialIndices.length > 0) setSelectedMaterialIndices([])
            return
        }

        const geosets = Array.isArray((modelData as any)?.Geosets) ? ((modelData as any).Geosets as any[]) : []
        const pickedMaterialId = (
            pickedGeosetIndex !== null &&
            pickedGeosetIndex >= 0 &&
            pickedGeosetIndex < geosets.length
        )
            ? Number(geosets[pickedGeosetIndex]?.MaterialID)
            : NaN

        if (selectedIds.length === 0) {
            const next = Number.isFinite(pickedMaterialId) && pickedMaterialId >= 0 && pickedMaterialId < materials.length
                ? pickedMaterialId
                : 0
            setSelectedMaterialIndex(next)
            setSelectedMaterialIndices([next])
            return
        }

        const nextIds = selectedIds.filter((id) => id >= 0 && id < materials.length)
        if (nextIds.length !== selectedIds.length) {
            setSelectedMaterialIndices(nextIds)
            setSelectedMaterialIndex(nextIds[0] ?? null)
        } else if (selectedMaterialIndex !== nextIds[0]) {
            setSelectedMaterialIndex(nextIds[0] ?? null)
        }
    }, [materials.length, modelData, pickedGeosetIndex, selectedIds, selectedMaterialIndex, selectedMaterialIndices.length, setSelectedMaterialIndex, setSelectedMaterialIndices])

    const currentTextureId = useMemo(() => {
        if (!primaryLayer) return 0
        return typeof primaryLayer.TextureID === 'number'
            ? Math.round(primaryLayer.TextureID)
            : Math.round(sampleScalarTrack(primaryLayer.TextureID, roundedFrame, 0))
    }, [primaryLayer, roundedFrame])

    const currentAlpha = useMemo(() => {
        if (!primaryLayer) return 1
        return typeof primaryLayer.Alpha === 'number'
            ? Number(primaryLayer.Alpha)
            : sampleScalarTrack(primaryLayer.Alpha, roundedFrame, 1)
    }, [primaryLayer, roundedFrame])

    const textureOptions = useMemo(() => (
        textures.map((texture, index) => ({
            label: `${index}: ${getTextureName(texture?.Image)}`,
            value: index
        }))
    ), [textures])

    const commitMaterials = useCallback((historyName: string, updater: (nextMaterials: any[]) => void) => {
        const oldMaterials = deepClone(materials)
        const nextMaterials = deepClone(materials)
        updater(nextMaterials)
        useHistoryStore.getState().push({
            name: historyName,
            undo: () => setMaterials(deepClone(oldMaterials)),
            redo: () => setMaterials(deepClone(nextMaterials))
        })
        setMaterials(nextMaterials)
    }, [materials, setMaterials])

    const ensureTrackLayer = useCallback((material: any) => {
        const layers = Array.isArray(material?.Layers) ? [...material.Layers] : []
        while (layers.length === 0) layers.push(createDefaultLayer())
        return layers
    }, [])

    const applyToSelectedMaterials = useCallback((historyName: string, updater: (layer: any) => any) => {
        if (selectedIds.length === 0) return
        commitMaterials(historyName, (nextMaterials) => {
            selectedIds.forEach((materialIndex) => {
                if (materialIndex < 0 || materialIndex >= nextMaterials.length) return
                const material = nextMaterials[materialIndex]
                const layers = ensureTrackLayer(material)
                layers[0] = updater({ ...layers[0] })
                nextMaterials[materialIndex] = { ...material, Layers: layers }
            })
        })
    }, [commitMaterials, ensureTrackLayer, selectedIds])

    const updateStaticField = useCallback((field: 'TextureID' | 'Alpha', value: number | null) => {
        const safeValue = field === 'TextureID'
            ? Math.max(0, Math.round(Number(value ?? 0)))
            : Math.max(0, Math.min(1, Number(value ?? 1)))
        applyToSelectedMaterials(`修改材质${field}`, (layer) => ({
            ...layer,
            [field]: safeValue
        }))
    }, [applyToSelectedMaterials])

    const insertTrackKey = useCallback((field: 'TextureID' | 'Alpha') => {
        const fallback = field === 'TextureID' ? 0 : 1
        const value = field === 'TextureID' ? currentTextureId : currentAlpha
        applyToSelectedMaterials(`材质${field}关键帧`, (layer) => {
            const track = isAnimTrack(layer[field])
                ? { ...layer[field], Keys: normalizeScalarTrackKeys(layer[field].Keys, fallback) }
                : { LineType: 1, InterpolationType: 1, GlobalSeqId: -1, Keys: [] as any[] }
            track.Keys = upsertScalarTrackKey(track.Keys, roundedFrame, value)
            return { ...layer, [field]: track }
        })
    }, [applyToSelectedMaterials, currentAlpha, currentTextureId, roundedFrame])

    const getTrackMeta = useCallback((field: 'TextureID' | 'Alpha') => {
        const track = primaryLayer?.[field]
        return {
            globalSeqId: typeof track?.GlobalSeqId === 'number' ? track.GlobalSeqId : null,
            interpolationType: typeof (track?.InterpolationType ?? track?.LineType) === 'number' ? Number(track?.InterpolationType ?? track?.LineType) : 1
        }
    }, [primaryLayer])

    const updateTrackMeta = useCallback((field: 'TextureID' | 'Alpha', patch: { GlobalSeqId?: number | null; InterpolationType?: number }) => {
        const fallback = field === 'TextureID' ? currentTextureId : currentAlpha
        applyToSelectedMaterials(`修改材质${field}轨道属性`, (layer) => {
            const previousTrack = layer[field]
            const previousInterpolation = typeof (previousTrack?.InterpolationType ?? previousTrack?.LineType) === 'number'
                ? Number(previousTrack?.InterpolationType ?? previousTrack?.LineType)
                : 1
            const previousGlobalSeqId = typeof previousTrack?.GlobalSeqId === 'number' ? previousTrack.GlobalSeqId : -1
            const track = isAnimTrack(previousTrack)
                ? { ...previousTrack, Keys: normalizeScalarTrackKeys(previousTrack.Keys, fallback) }
                : { LineType: previousInterpolation, InterpolationType: previousInterpolation, GlobalSeqId: previousGlobalSeqId, Keys: [{ Frame: 0, Vector: [fallback], InTan: [0], OutTan: [0] }] }
            const nextInterpolation = patch.InterpolationType ?? previousInterpolation
            const nextGlobalSeqId = patch.GlobalSeqId === null ? -1 : (patch.GlobalSeqId ?? previousGlobalSeqId)
            track.LineType = nextInterpolation
            track.InterpolationType = nextInterpolation
            track.GlobalSeqId = nextGlobalSeqId
            return { ...layer, [field]: track }
        })
    }, [applyToSelectedMaterials, currentAlpha, currentTextureId])

    const openEditor = useCallback((field: 'TextureID' | 'Alpha') => {
        if (!primaryLayer || primaryMaterialIndex === null) return
        setEditingField(field)
        const fallback = field === 'TextureID' ? currentTextureId : currentAlpha
        const payload = {
            callerId: 'MaterialAnimPanel',
            initialData: isAnimTrack(primaryLayer[field])
                ? primaryLayer[field]
                : { LineType: 1, InterpolationType: 1, GlobalSeqId: null, Keys: [{ Frame: 0, Vector: [fallback] }] },
            title: field === 'TextureID' ? '编辑材质贴图 ID 关键帧' : '编辑材质透明度关键帧',
            vectorSize: 1,
            fieldName: `${field}_${primaryMaterialIndex}_0`,
            globalSequences: Array.isArray((modelData as any)?.GlobalSequences)
                ? (modelData as any).GlobalSequences.map((g: any) => typeof g === 'number' ? g : g?.Duration).filter((v: any) => typeof v === 'number')
                : [],
            sequences: (modelData as any)?.Sequences || []
        }
        const windowId = windowManager.getKeyframeWindowId(payload.fieldName)
        payload.targetWindowId = windowId
        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload)
    }, [currentAlpha, currentTextureId, modelData, primaryLayer, primaryMaterialIndex])

    const handleSaveEditor = useCallback((animVector: any) => {
        if (!editingField) return
        const fallback = editingField === 'TextureID' ? currentTextureId : currentAlpha
        applyToSelectedMaterials(`编辑材质${editingField}关键帧`, (layer) => {
            const previousTrack = layer[editingField]
            const previousInterpolation = typeof (previousTrack?.InterpolationType ?? previousTrack?.LineType) === 'number'
                ? Number(previousTrack?.InterpolationType ?? previousTrack?.LineType)
                : 1
            const previousGlobalSeqId = typeof previousTrack?.GlobalSeqId === 'number' ? previousTrack.GlobalSeqId : -1
            const nextInterpolation = typeof (animVector?.InterpolationType ?? animVector?.LineType) === 'number'
                ? Number(animVector?.InterpolationType ?? animVector?.LineType)
                : previousInterpolation
            const rawGlobalSeq = animVector?.GlobalSeqId
            const nextGlobalSeqId = typeof rawGlobalSeq === 'number' ? rawGlobalSeq : (rawGlobalSeq === null ? -1 : previousGlobalSeqId)
            return {
                ...layer,
                [editingField]: {
                    Keys: normalizeScalarTrackKeys(animVector?.Keys || [], fallback),
                    LineType: nextInterpolation,
                    InterpolationType: nextInterpolation,
                    GlobalSeqId: nextGlobalSeqId
                }
            }
        })
    }, [applyToSelectedMaterials, currentAlpha, currentTextureId, editingField])

    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any
            if (payload?.callerId === 'MaterialAnimPanel') {
                handleSaveEditor(payload.data)
            }
        })
        return () => { unlisten.then((fn) => fn()) }
    }, [handleSaveEditor])

    const textureTrackMeta = getTrackMeta('TextureID')
    const alphaTrackMeta = getTrackMeta('Alpha')
    const hasTextureTrack = isAnimTrack(primaryLayer?.TextureID)
    const hasAlphaTrack = isAnimTrack(primaryLayer?.Alpha)

    const openMaterialManager = useCallback(() => {
        if (primaryMaterialIndex !== null) {
            setSelectedMaterialIndex(primaryMaterialIndex)
            setSelectedMaterialIndices([primaryMaterialIndex])
        }
        void windowManager.openMaterialManager()
    }, [primaryMaterialIndex, setSelectedMaterialIndex, setSelectedMaterialIndices])

    const fieldLabelStyle: React.CSSProperties = { width: 52, flexShrink: 0, color: '#b0b0b0', fontSize: 12 }
    const metaLabelStyle: React.CSSProperties = { color: '#888', fontSize: 11, flexShrink: 0 }
    const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
    const nestedRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 60 }

    return (
        <RightFloatingPanelShell
            title="材质关键帧"
            status={selectedIds.length > 0 ? `已选 ${selectedIds.length}` : '未选择'}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
        >
            {materials.length === 0 ? (
                <div style={{ color: '#777', fontSize: 12 }}>当前模型没有材质</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={rowStyle}>
                        <Text style={fieldLabelStyle}>材质</Text>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: 140, overflowY: 'auto', paddingRight: 4 }}>
                            {materials.map((material, index) => {
                                const isSelected = selectedIds.includes(index)
                                return (
                                    <div
                                        key={index}
                                        onClick={(e) => {
                                            const isMulti = e.ctrlKey || e.metaKey || e.shiftKey
                                            if (isMulti) {
                                                if (isSelected) {
                                                    const next = selectedIds.filter(i => i !== index)
                                                    setSelectedMaterialIndices(next)
                                                    setSelectedMaterialIndex(next.length > 0 ? next[0] : null)
                                                } else {
                                                    const next = [...selectedIds, index].sort((a,b)=>a-b)
                                                    setSelectedMaterialIndices(next)
                                                    setSelectedMaterialIndex(next[0])
                                                }
                                            } else {
                                                // 单选：如果已经只选中这一项，再点就取消
                                                if (isSelected && selectedIds.length === 1) {
                                                    setSelectedMaterialIndices([])
                                                    setSelectedMaterialIndex(null)
                                                } else {
                                                    setSelectedMaterialIndices([index])
                                                    setSelectedMaterialIndex(index)
                                                }
                                            }
                                        }}
                                        style={{
                                            width: 'calc(25% - 3px)', // 4 per row
                                            padding: '4px',
                                            backgroundColor: isSelected ? 'rgba(50, 120, 220, 0.6)' : 'rgba(100, 100, 100, 0.2)',
                                            border: isSelected ? '1px solid #4a90e2' : '1px solid #444',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            textAlign: 'center',
                                            fontSize: 11,
                                            color: isSelected ? '#fff' : '#aaa',
                                            userSelect: 'none',
                                            transition: 'all 0.15s ease'
                                        }}
                                        title={`材质 ${index} (${Array.isArray(material?.Layers) ? material.Layers.length : 0} 层)`}
                                    >
                                        {String(index)}
                                    </div>
                                )
                            })}
                        </div>
                        <Button size="small" icon={<EditOutlined />} onClick={openMaterialManager} />
                    </div>

                    <div style={{ ...rowStyle, marginTop: 4 }}>
                        <Text style={fieldLabelStyle}>贴图ID</Text>
                        <Select
                            size="small"
                            value={currentTextureId}
                            onChange={(value) => updateStaticField('TextureID', value)}
                            options={textureOptions}
                            style={{ width: 120 }}
                        />
                        <div style={{ flex: 1 }} />
                        <Button size="small" onClick={() => insertTrackKey('TextureID')} disabled={selectedIds.length === 0} style={{ background: '#333', borderColor: '#444', color: '#ddd' }}>
                            K帧
                        </Button>
                        <Button size="small" onClick={() => openEditor('TextureID')} disabled={selectedIds.length !== 1} style={{ fontSize: 11, color: '#1890ff', borderColor: '#1890ff', background: 'transparent' }}>
                            动画编辑
                        </Button>
                    </div>

                    <div style={nestedRowStyle}>
                        <Text style={{ ...metaLabelStyle, width: 52 }}>全局序列</Text>
                        <GlobalSequenceSelect
                            size="small"
                            value={hasTextureTrack ? textureTrackMeta.globalSeqId : null}
                            onChange={(value) => updateTrackMeta('TextureID', { GlobalSeqId: value })}
                            style={{ flex: 1, minWidth: 0 }}
                        />
                        <Text style={metaLabelStyle}>插值</Text>
                        <Select
                            size="small"
                            value={textureTrackMeta.interpolationType}
                            options={INTERPOLATION_OPTIONS}
                            onChange={(value) => updateTrackMeta('TextureID', { InterpolationType: Number(value) })}
                            style={{ width: 80 }}
                        />
                    </div>

                    <div style={{ ...rowStyle, marginTop: 4 }}>
                        <Text style={fieldLabelStyle}>透明度</Text>
                        <InputNumber
                            size="small"
                            value={currentAlpha}
                            onChange={(value) => updateStaticField('Alpha', value)}
                            min={0}
                            max={1}
                            step={0.01}
                            precision={3}
                            style={{ width: 80 }}
                        />
                        <div style={{ flex: 1 }} />
                        <Button size="small" onClick={() => insertTrackKey('Alpha')} disabled={selectedIds.length === 0} style={{ background: '#333', borderColor: '#444', color: '#ddd' }}>
                            K帧
                        </Button>
                        <Button size="small" onClick={() => openEditor('Alpha')} disabled={selectedIds.length !== 1} style={{ fontSize: 11, color: '#1890ff', borderColor: '#1890ff', background: 'transparent' }}>
                            动画编辑
                        </Button>
                    </div>

                    <div style={nestedRowStyle}>
                        <Text style={{ ...metaLabelStyle, width: 52 }}>全局序列</Text>
                        <GlobalSequenceSelect
                            size="small"
                            value={hasAlphaTrack ? alphaTrackMeta.globalSeqId : null}
                            onChange={(value) => updateTrackMeta('Alpha', { GlobalSeqId: value })}
                            style={{ flex: 1, minWidth: 0 }}
                        />
                        <Text style={metaLabelStyle}>插值</Text>
                        <Select
                            size="small"
                            value={alphaTrackMeta.interpolationType}
                            options={INTERPOLATION_OPTIONS}
                            onChange={(value) => updateTrackMeta('Alpha', { InterpolationType: Number(value) })}
                            style={{ width: 80 }}
                        />
                    </div>
                </div>
            )}
        </RightFloatingPanelShell>
    )
}

export default React.memo(MaterialAnimPanel)
