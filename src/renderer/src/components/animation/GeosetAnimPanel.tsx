import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Typography, Select, Button, ColorPicker, Input, Tooltip } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import { useHistoryStore } from '../../store/historyStore'
import KeyframeEditor from '../editors/KeyframeEditor'
import RightFloatingPanelShell from './RightFloatingPanelShell'

const { Text } = Typography

// --- 转换工具函数 ---

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
        const rgbFuncMatch = value.match(/^rgb\s*\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*\)$/)
        if (rgbFuncMatch) {
            const parts = [Number(rgbFuncMatch[1]), Number(rgbFuncMatch[2]), Number(rgbFuncMatch[3])]
            if (parts.every((part) => Number.isFinite(part))) {
                const use255Scale = parts.some((part) => part > 1)
                return [
                    clamp01(use255Scale ? parts[0] / 255 : parts[0]),
                    clamp01(use255Scale ? parts[1] / 255 : parts[1]),
                    clamp01(use255Scale ? parts[2] / 255 : parts[2])
                ]
            }
        }
    }
    return [...fallback]
}

const normalizedColorToRgbText = (color: [number, number, number]) => {
    const to255 = (value: number) => Math.round(clamp01(value) * 255)
    return `rgb(${to255(color[0])}, ${to255(color[1])}, ${to255(color[2])})`
}

const GeosetAnimPanel: React.FC = () => {
    const {
        animationSubMode,
        pickedGeosetIndex
    } = useSelectionStore()

    const modelData = useModelStore(state => state.modelData)
    const currentFrame = useModelStore(state => state.currentFrame)
    const selectedGeosetIndex = useModelStore(state => state.selectedGeosetIndex)
    const selectedGeosetIndices = useModelStore(state => state.selectedGeosetIndices)
    const setSelectedGeosetIndex = useModelStore(state => state.setSelectedGeosetIndex)
    const setSelectedGeosetIndices = useModelStore(state => state.setSelectedGeosetIndices)
    const setGeosetAnims = useModelStore(state => state.setGeosetAnims)

    const [geosetAlphaInput, setGeosetAlphaInput] = useState<number>(1)
    const [geosetColorInput, setGeosetColorInput] = useState<[number, number, number]>([1, 1, 1])
    const [geosetColorText, setGeosetColorText] = useState<string>('rgb(255, 255, 255)')
    const [editingGeosetField, setEditingGeosetField] = useState<'Alpha' | 'Color' | null>(null)
    const [isGeosetEditorOpen, setIsGeosetEditorOpen] = useState(false)
    const [collapsed, setCollapsed] = useState(false)

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
        if (selectedGeosetIds.length === 0 && geosetIds.length > 0) {
            setSelectedGeosetIndices([geosetIds[0]])
        }
    }, [geosetIds, selectedGeosetIds, setSelectedGeosetIndices])

    useEffect(() => {
        const firstId = selectedGeosetIds[0] ?? null
        if (selectedGeosetIndex !== firstId) {
            setSelectedGeosetIndex(firstId)
        }
    }, [selectedGeosetIds, selectedGeosetIndex, setSelectedGeosetIndex])

    const activeGeosetId = selectedGeosetIds.length > 0 ? selectedGeosetIds[0] : null

    const activeGeosetAnim = useMemo(() => {
        if (activeGeosetId === null) return null
        const anims = (modelData as any)?.GeosetAnims
        if (!Array.isArray(anims)) return null
        return anims.find((anim: any) => Number(anim?.GeosetId) === Number(activeGeosetId)) || null
    }, [modelData, activeGeosetId])

    const currentGeosetAlpha = useMemo(() => {
        if (!activeGeosetAnim) return 1
        if (isAnimTrack(activeGeosetAnim.Alpha)) return sampleScalarTrack(activeGeosetAnim.Alpha, currentFrame, 1)
        if (typeof activeGeosetAnim.Alpha === 'number') return activeGeosetAnim.Alpha
        return 1
    }, [activeGeosetAnim, currentFrame])

    const currentGeosetColor = useMemo<[number, number, number]>(() => {
        if (!activeGeosetAnim) return [1, 1, 1]
        if (isAnimTrack(activeGeosetAnim.Color)) return sampleColorTrack(activeGeosetAnim.Color, currentFrame, [1, 1, 1])
        if (Array.isArray(activeGeosetAnim.Color)) return [Number(activeGeosetAnim.Color[0] ?? 1), Number(activeGeosetAnim.Color[1] ?? 1), Number(activeGeosetAnim.Color[2] ?? 1)]
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

    useEffect(() => {
        setGeosetColorText(normalizedColorToRgbText(geosetColorInput))
    }, [geosetColorInput])

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
                const track = isAnimTrack(currentAnim.Alpha) ? { ...currentAnim.Alpha, Keys: normalizeScalarKeys(currentAnim.Alpha.Keys) } : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
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
                const track = isAnimTrack(currentAnim.Alpha) ? { ...currentAnim.Alpha, Keys: normalizeScalarKeys(currentAnim.Alpha.Keys) } : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
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
        const color = geosetColorInput
        commitGeosetAnims(`Geoset Color Key x${selectedGeosetIds.length}`, (nextAnims) => {
            selectedGeosetIds.forEach((geosetId) => {
                let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) {
                    nextAnims.push({ GeosetId: geosetId, Alpha: 1, Color: [1, 1, 1], Flags: 0, UseColor: true, DropShadow: false })
                    index = nextAnims.length - 1
                }
                const currentAnim = { ...nextAnims[index], UseColor: true }
                const track = isAnimTrack(currentAnim.Color) ? { ...currentAnim.Color, Keys: normalizeColorKeys(currentAnim.Color.Keys) } : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
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
                const track = isAnimTrack(currentAnim.Color) ? { ...currentAnim.Color, Keys: normalizeColorKeys(currentAnim.Color.Keys) } : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
                track.Keys = removeKeyByFrame(track.Keys, frame, 3)
                currentAnim.Color = track.Keys.length > 0 ? track : [1, 1, 1]
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, currentFrame, commitGeosetAnims])

    const applyStaticAlpha = useCallback((alpha: number) => {
        if (selectedGeosetIds.length === 0) return
        commitGeosetAnims(`Set Geoset Static Alpha`, (nextAnims) => {
            selectedGeosetIds.forEach((geosetId) => {
                let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) return
                const currentAnim = { ...nextAnims[index] }
                if (isAnimTrack(currentAnim.Alpha)) return
                currentAnim.Alpha = alpha
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, commitGeosetAnims])

    const applyStaticColor = useCallback((color: [number, number, number]) => {
        if (selectedGeosetIds.length === 0) return
        commitGeosetAnims(`Set Geoset Static Color`, (nextAnims) => {
            selectedGeosetIds.forEach((geosetId) => {
                let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(geosetId))
                if (index < 0) return
                const currentAnim = { ...nextAnims[index], UseColor: true }
                if (isAnimTrack(currentAnim.Color)) return
                currentAnim.Color = [color[0], color[1], color[2]]
                nextAnims[index] = currentAnim
            })
        })
    }, [selectedGeosetIds, commitGeosetAnims])

    const handleSaveKeyframeEditor = useCallback((animVector: any) => {
        if (!editingGeosetField || activeGeosetId === null) return setIsGeosetEditorOpen(false)
        commitGeosetAnims(`Edit Geoset ${editingGeosetField}`, (nextAnims) => {
            let index = nextAnims.findIndex((anim: any) => Number(anim?.GeosetId) === Number(activeGeosetId))
            if (index < 0) return
            const currentAnim = { ...nextAnims[index] }
            if (editingGeosetField === 'Alpha') {
                const keys = upsertScalarKey(normalizeScalarKeys(animVector?.Keys || []), 0, 1)
                currentAnim.Alpha = { LineType: animVector.LineType ?? 1, GlobalSeqId: animVector.GlobalSeqId ?? null, Keys: keys }
            } else {
                currentAnim.Color = { LineType: animVector.LineType ?? 1, GlobalSeqId: animVector.GlobalSeqId ?? null, Keys: normalizeColorKeys(animVector?.Keys || []) }
                currentAnim.UseColor = true
            }
            nextAnims[index] = currentAnim
        })
        setIsGeosetEditorOpen(false)
    }, [editingGeosetField, activeGeosetId, commitGeosetAnims])

    const editorData = useMemo(() => {
        if (!editingGeosetField) return null
        if (editingGeosetField === 'Alpha') {
            if (isAnimTrack(activeGeosetAnim?.Alpha)) return activeGeosetAnim?.Alpha
            return { LineType: 1, GlobalSeqId: null, Keys: [{ Frame: 0, Vector: [currentGeosetAlpha] }] }
        }
        if (isAnimTrack(activeGeosetAnim?.Color)) return activeGeosetAnim?.Color
        return { LineType: 1, GlobalSeqId: null, Keys: [{ Frame: 0, Vector: [...currentGeosetColor] }] }
    }, [editingGeosetField, activeGeosetAnim, currentGeosetAlpha, currentGeosetColor])

    return (
        <RightFloatingPanelShell
            title="多边形组关键帧"
            status={`已选 ${selectedGeosetIds.length}`}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Geoset Selector */}
                <div>
                    <Text style={{ color: '#888', fontSize: 11 }}>选择多边形组</Text>
                    <Select
                        size="small"
                        style={{ width: '100%', marginTop: 4 }}
                        mode="multiple"
                        maxTagCount={2}
                        value={selectedGeosetIds}
                        options={geosetIds.map((id) => ({ label: `Geoset ${id}`, value: id }))}
                        onChange={(v) => setSelectedGeosetIndices(v as number[])}
                        placeholder="选择多边形组..."
                    />
                </div>

                {/* Alpha */}
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: '#888', fontSize: 11 }}>透明度 {hasExactGeosetAlphaKey && <span style={{ color: '#52c41a' }}>●</span>}</Text>
                        <Button size="small" type="text" onClick={() => { setEditingGeosetField('Alpha'); setIsGeosetEditorOpen(true) }} disabled={selectedGeosetIds.length !== 1} style={{ fontSize: 10, color: '#1890ff', padding: 0, height: 18 }}>轨道编辑</Button>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <InputNumber size="small" min={0} max={1} step={0.05} value={geosetAlphaInput} onChange={(v) => { setGeosetAlphaInput(v ?? 1); applyStaticAlpha(v ?? 1) }} style={{ flex: 1 }} />
                        <Button size="small" onClick={handleInsertGeosetAlphaKey} disabled={selectedGeosetIds.length === 0} style={{ background: '#333', borderColor: '#444', color: '#ddd' }}>插帧</Button>
                        <Button size="small" onClick={handleDeleteGeosetAlphaKey} disabled={selectedGeosetIds.length === 0} style={{ background: '#333', borderColor: '#444', color: '#ddd' }}>删帧</Button>
                    </div>
                </div>

                {/* Color */}
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: '#888', fontSize: 11 }}>颜色 {hasExactGeosetColorKey && <span style={{ color: '#52c41a' }}>●</span>}</Text>
                        <Button size="small" type="text" onClick={() => { setEditingGeosetField('Color'); setIsGeosetEditorOpen(true) }} disabled={selectedGeosetIds.length !== 1} style={{ fontSize: 10, color: '#1890ff', padding: 0, height: 18 }}>轨道编辑</Button>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <ColorPicker size="small" format="rgb" value={geosetColorText} onChange={(c) => setGeosetColorInput(parseColorToNormalized(c, [1, 1, 1]))} onChangeComplete={(c) => applyStaticColor(parseColorToNormalized(c, [1, 1, 1]))} />
                        <Input size="small" value={geosetColorText} onChange={(e) => setGeosetColorText(e.target.value)} onBlur={() => applyStaticColor(parseColorToNormalized(geosetColorText, [1, 1, 1]))} style={{ flex: 1, fontSize: 11 }} />
                        <Button size="small" onClick={handleInsertGeosetColorKey} disabled={selectedGeosetIds.length === 0} style={{ background: '#333', borderColor: '#444', color: '#ddd' }}>插帧</Button>
                    </div>
                </div>
            </div>

            <KeyframeEditor
                visible={isGeosetEditorOpen}
                onCancel={() => setIsGeosetEditorOpen(false)}
                onOk={handleSaveKeyframeEditor}
                initialData={editorData}
                title={editingGeosetField === 'Color' ? '多边形组颜色' : '多边形组透明度'}
                vectorSize={editingGeosetField === 'Color' ? 3 : 1}
                globalSequences={(modelData as any)?.GlobalSequences || []}
                fieldName={editingGeosetField || undefined}
            />
        </RightFloatingPanelShell>
    )
}

export default React.memo(GeosetAnimPanel)

