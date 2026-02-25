import React, { useEffect, useMemo, useState } from 'react'
import { Checkbox, Dropdown, Input, message, Typography, Button, type MenuProps } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { DraggableModal } from '../DraggableModal'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useHistoryStore } from '../../store/historyStore'
import { emit, listen } from '@tauri-apps/api/event'
import { windowManager } from '../../utils/windowManager'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useRpcClient } from '../../hooks/useRpc'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'

const { Text } = Typography

type SequenceItem = {
    index: number
    name: string
    start: number
    end: number
}

interface GeosetVisibilityToolModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
}

const deepClone = <T,>(value: T): T => {
    const cloneFn = (globalThis as any).structuredClone
    if (typeof cloneFn === 'function') return cloneFn(value)
    return JSON.parse(JSON.stringify(value))
}

const isAnimVector = (value: any): value is { Keys: any[]; LineType?: number; GlobalSeqId?: number | null } => {
    return !!value && typeof value === 'object' && Array.isArray(value.Keys)
}

const cloneAnimVector = (animVector: any, size: number) => {
    if (!animVector || typeof animVector !== 'object') return animVector

    const toArray = (val: any): number[] => {
        if (ArrayBuffer.isView(val)) return Array.from(val as ArrayLike<number>).slice(0, size)
        if (Array.isArray(val)) return val.slice(0, size)
        if (typeof val === 'number') return [val]
        return new Array(size).fill(0)
    }

    return {
        LineType: typeof animVector.LineType === 'number' ? animVector.LineType : 1,
        GlobalSeqId: animVector.GlobalSeqId ?? null,
        Keys: (animVector.Keys || []).map((key: any) => ({
            Frame: typeof key.Frame === 'number' ? key.Frame : Number(key.Time || 0),
            Vector: toArray(key.Vector),
            InTan: toArray(key.InTan),
            OutTan: toArray(key.OutTan)
        }))
    }
}

const normalizeAlphaKeys = (keys: any[]): any[] => {
    if (!Array.isArray(keys)) return []
    const normalized = keys.map((key) => {
        const frame = typeof key?.Frame === 'number' ? key.Frame : Number(key?.Time ?? 0)
        const vectorRaw = ArrayBuffer.isView(key?.Vector) ? Array.from(key.Vector as ArrayLike<number>) : key?.Vector
        const value = Array.isArray(vectorRaw) ? Number(vectorRaw[0] ?? 0) : Number(vectorRaw ?? 0)
        return {
            Frame: Number.isFinite(frame) ? Math.round(frame) : 0,
            Vector: [Number.isFinite(value) ? value : 0],
            InTan: [0],
            OutTan: [0]
        }
    })
    normalized.sort((a, b) => a.Frame - b.Frame)
    return normalized
}

const upsertScalarKey = (keys: any[], frame: number, value: number): any[] => {
    const normalizedFrame = Math.round(frame)
    const next = normalizeAlphaKeys(keys)
    const index = next.findIndex((key) => key.Frame === normalizedFrame)
    const newKey = { Frame: normalizedFrame, Vector: [value], InTan: [0], OutTan: [0] }
    if (index >= 0) {
        next[index] = newKey
    } else {
        next.push(newKey)
        next.sort((a, b) => a.Frame - b.Frame)
    }
    return next
}

const ensureDefaultVisibleKey = (keys: any[]): any[] => {
    return upsertScalarKey(keys, 0, 1)
}

const getAnimIndexByGeosetId = (anims: any[], geosetId: number): number => {
    return anims.findIndex((anim) => Number(anim?.GeosetId) === geosetId)
}

const createDefaultGeosetAnim = (geosetId: number) => ({
    GeosetId: geosetId,
    Alpha: 1,
    Color: [1, 1, 1],
    Flags: 0,
    UseColor: true,
    DropShadow: false
})

const hasAlphaKeyInRange = (anim: any, start: number, end: number): boolean => {
    if (!isAnimVector(anim?.Alpha)) return false
    const keys = normalizeAlphaKeys(anim.Alpha.Keys)
    return keys.some((key) => key.Frame >= start && key.Frame <= end)
}

const parseSequenceInterval = (interval: any): [number, number] => {
    let start = 0
    let end = 0

    if (Array.isArray(interval)) {
        start = Number(interval[0] ?? 0)
        end = Number(interval[1] ?? start)
    } else if (ArrayBuffer.isView(interval)) {
        const values = Array.from(interval as ArrayLike<number>)
        start = Number(values[0] ?? 0)
        end = Number(values[1] ?? start)
    } else if (interval && typeof interval === 'object') {
        const values = Object.values(interval).map(Number)
        start = Number(values[0] ?? 0)
        end = Number(values[1] ?? start)
    }

    if (!Number.isFinite(start)) start = 0
    if (!Number.isFinite(end)) end = start
    start = Math.round(start)
    end = Math.round(end)
    if (end < start) [start, end] = [end, start]
    return [start, end]
}

const GeosetVisibilityToolModal: React.FC<GeosetVisibilityToolModalProps> = ({ visible, onClose, isStandalone }) => {
    // Non-standalone direct store access
    const directModelData = useModelStore((state) => state.modelData) as any
    const directSetGeosetAnims = useModelStore((state) => state.setGeosetAnims)
    const directSetSequence = useModelStore((state) => state.setSequence)
    const directSetFrame = useModelStore((state) => state.setFrame)

    const { state: rpcState, emitCommand } = useRpcClient<any>('geosetVisibilityTool', {
        geosets: [],
        sequences: [],
        geosetAnims: [],
        globalSequences: [],
    })

    const modelData = isStandalone ? {
        Geosets: rpcState.geosets,
        Sequences: rpcState.sequences,
        GeosetAnims: rpcState.geosetsAnims, // To correctly match state
        GlobalSequences: rpcState.globalSequences
    } : directModelData

    const setGeosetAnims = (anims: any[]) => {
        if (isStandalone) {
            emitCommand('EXECUTE_VISIBILITY_ACTION', { action: 'SAVE_ANIMS', payload: anims })
        } else {
            directSetGeosetAnims(anims)
        }
    }

    const setSequence = (seqId: number | null) => {
        if (isStandalone) {
            emitCommand('EXECUTE_VISIBILITY_ACTION', { action: 'SET_SEQUENCE', payload: seqId })
        } else {
            directSetSequence(seqId)
        }
    }

    const setFrame = (frame: number) => {
        if (isStandalone) {
            emitCommand('EXECUTE_VISIBILITY_ACTION', { action: 'SET_FRAME', payload: frame })
        } else {
            directSetFrame(frame)
        }
    }

    const [localAnims, setLocalAnims] = useState<any[]>([])
    const [hasChanges, setHasChanges] = useState(false)
    const [selectedGeosetIds, setSelectedGeosetIds] = useState<number[]>([])
    const [lastSelectedGeosetId, setLastSelectedGeosetId] = useState<number | null>(null)
    const [geosetFilter, setGeosetFilter] = useState('')
    const [sequenceFilter, setSequenceFilter] = useState('')
    const [showHighlightedOnly, setShowHighlightedOnly] = useState(false)

    const [editingGeosetId, setEditingGeosetId] = useState<number | null>(null)

    const geosetIds = useMemo(() => {
        const geosets = modelData?.Geosets
        if (!Array.isArray(geosets)) return []
        return geosets.map((_: any, index: number) => index)
    }, [modelData])

    const sequences: SequenceItem[] = useMemo(() => {
        const source = Array.isArray(modelData?.Sequences) ? modelData.Sequences : []
        return source
            .map((sequence: any, index: number) => {
                const [start, end] = parseSequenceInterval(sequence?.Interval)
                return {
                    index,
                    name: String(sequence?.Name ?? sequence?.name ?? `Sequence ${index}`),
                    start,
                    end
                }
            })
            .filter((sequence: SequenceItem) => sequence.end >= sequence.start)
    }, [modelData])

    const animByGeosetId = useMemo(() => {
        const map = new Map<number, any>()
        for (const anim of localAnims) {
            const geosetId = Number(anim?.GeosetId)
            if (!Number.isFinite(geosetId)) continue
            if (!map.has(geosetId)) map.set(geosetId, anim)
        }
        return map
    }, [localAnims])

    const highlightedSequenceSet = useMemo(() => {
        const set = new Set<number>()
        if (selectedGeosetIds.length === 0) return set

        for (const sequence of sequences) {
            const highlighted = selectedGeosetIds.some((geosetId) => {
                const anim = animByGeosetId.get(geosetId)
                return hasAlphaKeyInRange(anim, sequence.start, sequence.end)
            })
            if (highlighted) set.add(sequence.index)
        }
        return set
    }, [selectedGeosetIds, sequences, animByGeosetId])

    const filteredGeosetIds = useMemo(() => {
        const query = geosetFilter.trim()
        if (!query) return geosetIds
        return geosetIds.filter((id) => String(id).includes(query))
    }, [geosetIds, geosetFilter])

    const filteredSequences = useMemo(() => {
        const query = sequenceFilter.trim().toLowerCase()
        return sequences.filter((sequence) => {
            if (showHighlightedOnly && !highlightedSequenceSet.has(sequence.index)) return false
            if (!query) return true
            return sequence.name.toLowerCase().includes(query) || String(sequence.index).includes(query)
        })
    }, [sequences, sequenceFilter, showHighlightedOnly, highlightedSequenceSet])

    useEffect(() => {
        if (!visible) return

        const clonedAnims = (modelData?.GeosetAnims || []).map((anim: any) => {
            const cloned = { ...anim }
            if (isAnimVector(anim?.Alpha)) cloned.Alpha = cloneAnimVector(anim.Alpha, 1)
            if (isAnimVector(anim?.Color)) cloned.Color = cloneAnimVector(anim.Color, 3)
            if (ArrayBuffer.isView(anim?.Color)) cloned.Color = Array.from(anim.Color as ArrayLike<number>)
            return cloned
        })
        setLocalAnims(clonedAnims)

        const picked = useSelectionStore.getState().pickedGeosetIndex
        const initialGeoset = picked !== null && picked >= 0 ? picked : geosetIds[0]
        if (initialGeoset !== undefined) {
            setSelectedGeosetIds([initialGeoset])
            setLastSelectedGeosetId(initialGeoset)
        } else {
            setSelectedGeosetIds([])
            setLastSelectedGeosetId(null)
        }
    }, [visible, modelData, geosetIds])

    useEffect(() => {
        if (!visible) return
        let lastPicked = useSelectionStore.getState().pickedGeosetIndex
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const picked = state.pickedGeosetIndex
            if (picked === lastPicked) return
            lastPicked = picked
            if (picked === null || picked < 0) return
            setSelectedGeosetIds([picked])
            setLastSelectedGeosetId(picked)
        })
        return unsubscribe
    }, [visible])

    const handleSaveAll = () => {
        const oldAnims = deepClone(modelData?.GeosetAnims || [])
        const newAnims = deepClone(localAnims)
        useHistoryStore.getState().push({
            name: 'Edit Geoset Sequence Visibility',
            undo: () => setGeosetAnims(oldAnims),
            redo: () => setGeosetAnims(newAnims)
        })
        setGeosetAnims(newAnims)
        message.success('多边形动作显隐修改已保存')
        onClose()
    }

    const handleApply = () => {
        const newAnims = deepClone(localAnims)
        setGeosetAnims(newAnims)
        message.success('多边形动作显隐修改已应用')
        setHasChanges(false)
    }

    const handleToggleAction = (sequence: SequenceItem) => {
        if (selectedGeosetIds.length === 0) {
            message.warning('请先在左侧选择至少一个多边形组')
            return
        }

        const shouldClear = highlightedSequenceSet.has(sequence.index)
        const nextAnims = [...localAnims]
        let changed = 0

        for (const geosetId of selectedGeosetIds) {
            let animIndex = getAnimIndexByGeosetId(nextAnims, geosetId)
            if (animIndex < 0 && shouldClear) continue
            if (animIndex < 0) {
                nextAnims.push(createDefaultGeosetAnim(geosetId))
                animIndex = nextAnims.length - 1
            }

            const currentAnim = { ...nextAnims[animIndex] }
            const currentAlpha = currentAnim.Alpha

            if (shouldClear) {
                if (!isAnimVector(currentAlpha)) continue
                const filtered = normalizeAlphaKeys(currentAlpha.Keys).filter((key) => key.Frame < sequence.start || key.Frame > sequence.end)
                const safeKeys = ensureDefaultVisibleKey(filtered)
                currentAnim.Alpha = { ...currentAlpha, Keys: safeKeys }
                nextAnims[animIndex] = currentAnim
                changed += 1
                continue
            }

            const alphaTrack = isAnimVector(currentAlpha)
                ? cloneAnimVector(currentAlpha, 1)
                : { LineType: 1, GlobalSeqId: null, Keys: [] }
            let keys = ensureDefaultVisibleKey(normalizeAlphaKeys(alphaTrack.Keys))
            keys = upsertScalarKey(keys, sequence.start, 0)
            keys = upsertScalarKey(keys, sequence.end, 0)
            currentAnim.Alpha = { ...alphaTrack, Keys: keys }
            nextAnims[animIndex] = currentAnim
            changed += 1
        }

        if (changed === 0) {
            message.info(shouldClear ? '未找到可清理的透明度关键帧' : '没有可写入的多边形组')
            return
        }
        setLocalAnims(nextAnims)
        setHasChanges(true)
        message.success(shouldClear ? `已清理 ${changed} 个多边形组在该动作范围内的关键帧` : `已写入 ${changed} 个多边形组的首尾帧透明度0`)
    }

    const ensureEditableAlphaTrack = (geosetId: number, startFrame: number) => {
        const nextAnims = [...localAnims]
        let animIndex = getAnimIndexByGeosetId(nextAnims, geosetId)
        if (animIndex < 0) {
            nextAnims.push(createDefaultGeosetAnim(geosetId))
            animIndex = nextAnims.length - 1
        }

        const currentAnim = { ...nextAnims[animIndex] }
        if (isAnimVector(currentAnim.Alpha)) {
            const track = cloneAnimVector(currentAnim.Alpha, 1)
            currentAnim.Alpha = { ...track, Keys: ensureDefaultVisibleKey(normalizeAlphaKeys(track.Keys)) }
        } else {
            const value = typeof currentAnim.Alpha === 'number' ? currentAnim.Alpha : 1
            currentAnim.Alpha = {
                LineType: 1,
                GlobalSeqId: null,
                Keys: ensureDefaultVisibleKey([{ Frame: startFrame, Vector: [value], InTan: [0], OutTan: [0] }])
            }
        }
        nextAnims[animIndex] = currentAnim
        setLocalAnims(nextAnims)
        setHasChanges(true)
    }

    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any;
            if (payload && payload.callerId === 'GeosetVisibilityToolModal') {
                if (editingGeosetId === null) return;

                const nextAnims = [...localAnims]
                let animIndex = getAnimIndexByGeosetId(nextAnims, editingGeosetId)
                if (animIndex < 0) {
                    nextAnims.push(createDefaultGeosetAnim(editingGeosetId))
                    animIndex = nextAnims.length - 1
                }

                nextAnims[animIndex] = {
                    ...nextAnims[animIndex],
                    Alpha: {
                        ...payload.data,
                        Keys: ensureDefaultVisibleKey(normalizeAlphaKeys(payload.data?.Keys || []))
                    }
                }
                setLocalAnims(nextAnims)
                setHasChanges(true)
                setEditingGeosetId(null)
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [editingGeosetId, localAnims]);

    const openAlphaTextEditor = (sequence: SequenceItem) => {
        if (selectedGeosetIds.length === 0) {
            message.warning('请先在左侧选择至少一个多边形组')
            return
        }

        const targetGeosetId = selectedGeosetIds[0]
        ensureEditableAlphaTrack(targetGeosetId, sequence.start)
        setSequence(sequence.index)
        setFrame(sequence.start)
        setEditingGeosetId(targetGeosetId)

        if (selectedGeosetIds.length > 1) {
            message.info('已打开第一个选中多边形组的透明度动态文本编辑器')
        }

        // We must delay the IPC call slightly so that ensureEditableAlphaTrack has time to update localAnims state
        // and editingAlphaData (which depends on localAnims) gets the new default track.
        // Actually, since we're generating the default track right now, let's just generate the payload directly:
        const nextAnims = [...localAnims]
        let animIndex = getAnimIndexByGeosetId(nextAnims, targetGeosetId)

        let initialData = null
        if (animIndex >= 0 && isAnimVector(nextAnims[animIndex].Alpha)) {
            initialData = nextAnims[animIndex].Alpha
        } else {
            // If missing, construct default track explicitly (as ensureEditableAlphaTrack will do)
            initialData = {
                LineType: 1,
                GlobalSeqId: null,
                Keys: ensureDefaultVisibleKey([{ Frame: sequence.start, Vector: [1], InTan: [0], OutTan: [0] }])
            }
        }

        const payload = {
            callerId: 'GeosetVisibilityToolModal',
            initialData,
            title: "透明度动态txt编辑器",
            vectorSize: 1,
            globalSequences: (modelData?.GlobalSequences || [])
                .map((g: any) => (typeof g === 'number' ? g : g?.Duration))
                .filter((v: any) => typeof v === 'number'),
            sequences: modelData?.Sequences || [],
            fieldName: 'Alpha'
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
        payload.targetWindowId = windowId;

        emit('IPC_KEYFRAME_INIT', payload);
        windowManager.openToolWindow(windowId, payload.title, 600, 480);
    }

    const handleGeosetClick = (geosetId: number, event: React.MouseEvent<HTMLElement>) => {
        if (event.shiftKey && lastSelectedGeosetId !== null) {
            const from = geosetIds.indexOf(lastSelectedGeosetId)
            const to = geosetIds.indexOf(geosetId)
            if (from >= 0 && to >= 0) {
                const start = Math.min(from, to)
                const end = Math.max(from, to)
                const range = geosetIds.slice(start, end + 1)
                setSelectedGeosetIds((prev) => Array.from(new Set([...prev, ...range])))
                return
            }
        }

        if (event.ctrlKey || event.metaKey) {
            setSelectedGeosetIds((prev) => {
                if (prev.includes(geosetId)) return prev.filter((id) => id !== geosetId)
                return [...prev, geosetId]
            })
            setLastSelectedGeosetId(geosetId)
            return
        }

        setSelectedGeosetIds([geosetId])
        setLastSelectedGeosetId(geosetId)
    }

    const getSequenceMenu = (sequence: SequenceItem): MenuProps => ({
        items: [{ key: 'edit-alpha-text', label: '编辑透明度动态txt' }],
        onClick: () => openAlphaTextEditor(sequence)
    })

    const editingAlphaData = useMemo(() => {
        if (editingGeosetId === null) return null
        const anim = animByGeosetId.get(editingGeosetId)
        if (!anim) return null
        return isAnimVector(anim.Alpha) ? anim.Alpha : null
    }, [editingGeosetId, animByGeosetId])

    const globalSequences = (modelData as any)?.GlobalSequences || []

    const innerContent = (
        <div style={{ display: 'flex', gap: 10, height: 520 }}>
            <div style={{ width: 320, border: '1px solid #4a4a4a', backgroundColor: '#252525', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '6px 8px', borderBottom: '1px solid #3f3f3f' }}>
                    <Text style={{ color: '#d0d0d0', fontSize: 12 }}>多边形组 ID</Text>
                    <Input
                        size="small"
                        value={geosetFilter}
                        onChange={(event) => setGeosetFilter(event.target.value)}
                        placeholder="搜索ID"
                        style={{ marginTop: 4 }}
                    />
                </div>
                <div style={{ padding: '4px 8px', borderBottom: '1px solid #3f3f3f', color: '#8f8f8f', fontSize: 11 }}>
                    选中 {selectedGeosetIds.length} / 总计 {geosetIds.length}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4 }}>
                        {filteredGeosetIds.map((geosetId) => {
                            const selected = selectedGeosetIds.includes(geosetId)
                            return (
                                <button
                                    key={`geoset-${geosetId}`}
                                    type="button"
                                    onClick={(event) => handleGeosetClick(geosetId, event)}
                                    style={{
                                        cursor: 'pointer',
                                        height: 26,
                                        padding: '0 4px',
                                        backgroundColor: selected ? '#214f87' : 'transparent',
                                        color: selected ? '#ffffff' : '#d0d0d0',
                                        border: '1px solid #3a3a3a',
                                        borderRadius: 2,
                                        userSelect: 'none',
                                        fontSize: 12,
                                        fontWeight: 500
                                    }}
                                >
                                    {geosetId}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>

            <div style={{ flex: 1, border: '1px solid #4a4a4a', backgroundColor: '#252525', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '6px 8px', borderBottom: '1px solid #3f3f3f', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Text style={{ color: '#d0d0d0', fontSize: 12, minWidth: 84 }}>动作列表</Text>
                    <Input
                        size="small"
                        value={sequenceFilter}
                        onChange={(event) => setSequenceFilter(event.target.value)}
                        placeholder="搜索动作名"
                        style={{ width: 200 }}
                    />
                    <Checkbox
                        checked={showHighlightedOnly}
                        onChange={(event) => setShowHighlightedOnly(event.target.checked)}
                        style={{ color: '#b0b0b0' }}
                    >
                        <span style={{ color: '#b0b0b0', fontSize: 12 }}>仅显示高亮</span>
                    </Checkbox>
                    <Text style={{ color: '#8f8f8f', fontSize: 12, marginLeft: 'auto' }}>
                        左键切换显隐，右键编辑透明度txt
                    </Text>
                </div>

                <div style={{ padding: '4px 8px', borderBottom: '1px solid #3f3f3f', color: '#8f8f8f', fontSize: 11 }}>
                    动作总计 {sequences.length}，当前显示 {filteredSequences.length}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 5 }}>
                        {filteredSequences.map((sequence) => {
                            const highlighted = highlightedSequenceSet.has(sequence.index)
                            const label = sequence.name || `Sequence ${sequence.index}`
                            return (
                                <Dropdown key={`seq-${sequence.index}`} menu={getSequenceMenu(sequence)} trigger={['contextMenu']}>
                                    <button
                                        type="button"
                                        onClick={() => handleToggleAction(sequence)}
                                        title={label}
                                        style={{
                                            cursor: 'pointer',
                                            height: 28,
                                            padding: '0 8px',
                                            backgroundColor: highlighted ? '#22432c' : 'transparent',
                                            border: highlighted ? '1px solid #3f7151' : '1px solid #3a3a3a',
                                            borderRadius: 2,
                                            userSelect: 'none',
                                            color: highlighted ? '#d8ffd8' : '#d0d0d0',
                                            fontSize: 12,
                                            fontWeight: 500,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                        }}
                                    >
                                        {label}
                                    </button>
                                </Dropdown>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    );

    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="多边形动作显隐工具" onClose={() => getCurrentWindow().hide()}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#1e1e1e' }}>
                    {/* Bottom Toolbar for Standalone mode */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        padding: '8px 16px',
                        borderBottom: '1px solid #333',
                        backgroundColor: '#252525'
                    }}>
                        <Button
                            size="small"
                            type="primary"
                            onClick={handleApply}
                            style={{ marginRight: 8 }}
                            disabled={!hasChanges}
                        >
                            应用修改
                        </Button>
                        <Button
                            size="small"
                            onClick={() => {
                                const clonedAnims = (modelData?.GeosetAnims || []).map((anim: any) => {
                                    const cloned = { ...anim }
                                    if (isAnimVector(anim?.Alpha)) cloned.Alpha = cloneAnimVector(anim.Alpha, 1)
                                    if (isAnimVector(anim?.Color)) cloned.Color = cloneAnimVector(anim.Color, 3)
                                    return cloned
                                })
                                setLocalAnims(clonedAnims)
                                setHasChanges(false)
                            }}
                        >
                            重置
                        </Button>
                    </div>
                    <div style={{ flex: 1, padding: 10, overflow: 'auto' }}>
                        {innerContent}
                    </div>
                </div>
            </StandaloneWindowFrame>
        )
    }

    return (
        <>
            <DraggableModal
                title="多边形动作显隐工具"
                open={visible}
                onOk={handleSaveAll}
                onCancel={onClose}
                width={980}
                okText="确定"
                cancelText="取消"
                maskClosable={false}
                wrapClassName="dark-theme-modal"
                styles={{
                    content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                    header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                    body: { backgroundColor: '#2d2d2d', padding: 12 },
                    footer: { borderTop: '1px solid #4a4a4a' }
                }}
            >
                {innerContent}
            </DraggableModal>
        </>
    )
}

export default GeosetVisibilityToolModal
