import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Typography } from 'antd'

import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useHistoryStore } from '../../store/historyStore'
import RightFloatingPanelShell from './RightFloatingPanelShell'

const { Text } = Typography

const MAX_DECIMAL_PLACES = 4

const PARTICLE_TRACKS = [
    { label: '可见度', propName: 'Visibility', fallback: 1, step: 0.05, precision: MAX_DECIMAL_PLACES, min: 0, max: 1 },
    { label: '放射速率', propName: 'EmissionRate', fallback: 0, step: 0.1, precision: MAX_DECIMAL_PLACES },
    { label: '速度', propName: 'Speed', fallback: 0, step: 0.1, precision: MAX_DECIMAL_PLACES },
    { label: '变化', propName: 'Variation', fallback: 0, step: 0.1, precision: MAX_DECIMAL_PLACES },
    { label: '纬度', propName: 'Latitude', fallback: 0, step: 0.1, precision: MAX_DECIMAL_PLACES },
    { label: '长', propName: 'Length', fallback: 0, step: 0.1, precision: MAX_DECIMAL_PLACES },
    { label: '重力', propName: 'Gravity', fallback: 0, step: 0.1, precision: MAX_DECIMAL_PLACES },
    { label: '宽', propName: 'Width', fallback: 0, step: 0.1, precision: MAX_DECIMAL_PLACES }
] as const

type ParticleTrackProp = typeof PARTICLE_TRACKS[number]['propName']

const DEFAULT_INPUTS: Record<ParticleTrackProp, number> = {
    Visibility: 1,
    EmissionRate: 0,
    Speed: 0,
    Variation: 0,
    Latitude: 0,
    Length: 0,
    Width: 0,
    Gravity: 0
}

const isParticleEmitter2Node = (node: any): boolean => String(node?.type ?? '') === 'ParticleEmitter2'

const isAnimTrack = (value: any): value is { Keys: any[]; LineType?: number; GlobalSeqId?: number | null } => (
    !!value && typeof value === 'object' && Array.isArray(value.Keys)
)

const deepClone = <T,>(value: T): T => {
    const cloneFn = (globalThis as any).structuredClone
    if (typeof cloneFn === 'function') return cloneFn(value)
    return JSON.parse(JSON.stringify(value))
}

const roundToMaxDecimals = (value: number): number => {
    if (!Number.isFinite(value)) return 0
    const factor = 10 ** MAX_DECIMAL_PLACES
    const rounded = Math.round((value + Number.EPSILON) * factor) / factor
    return Object.is(rounded, -0) ? 0 : rounded
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
                Vector: [Number.isFinite(value) ? roundToMaxDecimals(value) : 0],
                InTan: [0],
                OutTan: [0]
            }
        })
        .sort((a, b) => a.Frame - b.Frame)
}

const upsertScalarKey = (keys: any[], frame: number, value: number) => {
    const next = normalizeScalarKeys(keys)
    const f = Math.round(frame)
    const idx = next.findIndex((key) => key.Frame === f)
    const newKey = { Frame: f, Vector: [roundToMaxDecimals(value)], InTan: [0], OutTan: [0] }
    if (idx >= 0) next[idx] = newKey
    else next.push(newKey)
    next.sort((a, b) => a.Frame - b.Frame)
    return next
}

const ensureScalarDefaultZeroKey = (keys: any[]) => {
    const next = normalizeScalarKeys(keys)
    if (next.some((key) => key.Frame === 0)) return next
    return upsertScalarKey(next, 0, 0)
}

const sampleScalarTrack = (track: any, frame: number, fallback = 0) => {
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

const readParticleScalarValueAtFrame = (node: any, propName: string, frame: number, fallback: number) => {
    const prop = node?.[propName]
    if (isAnimTrack(prop)) return Number(sampleScalarTrack(prop, frame, fallback))
    if (typeof prop === 'number' && Number.isFinite(prop)) return Number(prop)
    if (Array.isArray(prop) && prop.length > 0) {
        const first = Number(prop[0])
        return Number.isFinite(first) ? first : fallback
    }
    return fallback
}

const ParticleAnimKeyframePanel: React.FC = () => {
    const nodes = useModelStore((state) => state.nodes)
    const currentFrame = useModelStore((state) => state.currentFrame)
    const replaceNodes = useModelStore((state) => state.replaceNodes)
    const selectedNodeIds = useSelectionStore((state) => state.selectedNodeIds)
    const timelineKeyframeDisplayMode = useSelectionStore((state) => state.timelineKeyframeDisplayMode)

    const [inputs, setInputs] = useState<Record<ParticleTrackProp, number>>(DEFAULT_INPUTS)
    const [collapsed, setCollapsed] = useState(true)

    useEffect(() => {
        setCollapsed(timelineKeyframeDisplayMode !== 'particle')
    }, [timelineKeyframeDisplayMode])

    const selectedParticleIds = useMemo(() => {
        const particleIdSet = new Set<number>(
            (nodes as any[])
                .filter((node) => isParticleEmitter2Node(node))
                .map((node: any) => Number(node.ObjectId))
                .filter((id) => Number.isFinite(id))
        )
        return selectedNodeIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && particleIdSet.has(id))
    }, [nodes, selectedNodeIds])

    const primaryParticle = useMemo(() => {
        if (selectedParticleIds.length === 0) return null
        const id = selectedParticleIds[0]
        return (nodes as any[]).find((node: any) => Number(node?.ObjectId) === Number(id)) ?? null
    }, [nodes, selectedParticleIds])

    const exactKeyByProp = useMemo(() => {
        const frame = Math.round(currentFrame)
        const result: Record<ParticleTrackProp, boolean> = {
            Visibility: false,
            EmissionRate: false,
            Speed: false,
            Variation: false,
            Latitude: false,
            Length: false,
            Width: false,
            Gravity: false
        }
        if (!primaryParticle) return result
        PARTICLE_TRACKS.forEach(({ propName }) => {
            const track = primaryParticle[propName]
            result[propName] = isAnimTrack(track) && track.Keys.some((key: any) => Math.round(Number(key?.Frame ?? -1)) === frame)
        })
        return result
    }, [primaryParticle, currentFrame])

    useEffect(() => {
        const frame = Math.round(currentFrame)
        if (!primaryParticle) {
            setInputs(DEFAULT_INPUTS)
            return
        }
        const nextInputs = { ...DEFAULT_INPUTS }
        PARTICLE_TRACKS.forEach(({ propName, fallback }) => {
            nextInputs[propName] = roundToMaxDecimals(readParticleScalarValueAtFrame(primaryParticle, propName, frame, fallback))
        })
        setInputs(nextInputs)
    }, [primaryParticle, currentFrame])

    const commitParticleTracks = useCallback((historyName: string, updater: (nextNodes: any[]) => void) => {
        const oldNodes = deepClone(nodes || [])
        const nextNodes = deepClone(oldNodes)
        updater(nextNodes)

        useHistoryStore.getState().push({
            name: historyName,
            undo: () => replaceNodes(deepClone(oldNodes), { triggerReload: false }),
            redo: () => replaceNodes(deepClone(nextNodes), { triggerReload: false })
        })

        replaceNodes(nextNodes, { triggerReload: false })
    }, [nodes, replaceNodes])

    const handleInputChange = useCallback((propName: ParticleTrackProp, value: number | null) => {
        const safeValue = Number.isFinite(Number(value)) ? roundToMaxDecimals(Number(value)) : DEFAULT_INPUTS[propName]
        setInputs((prev) => ({ ...prev, [propName]: safeValue }))
    }, [])

    const handleInsertSingleKey = useCallback((propName: ParticleTrackProp) => {
        if (selectedParticleIds.length === 0) return
        const frame = Math.round(currentFrame)
        const trackDef = PARTICLE_TRACKS.find((item) => item.propName === propName)
        const fallback = trackDef?.fallback ?? DEFAULT_INPUTS[propName]
        const rawInput = inputs[propName]
        const keyValue = Number.isFinite(Number(rawInput)) ? roundToMaxDecimals(Number(rawInput)) : fallback

        commitParticleTracks(`Particle ${propName} Key x${selectedParticleIds.length}`, (nextNodes) => {
            selectedParticleIds.forEach((particleId) => {
                const nodeIndex = nextNodes.findIndex((n: any) => Number(n?.ObjectId) === Number(particleId))
                if (nodeIndex < 0) return
                const nextNode = { ...nextNodes[nodeIndex] } as any
                const track = isAnimTrack(nextNode[propName])
                    ? { ...nextNode[propName], Keys: normalizeScalarKeys(nextNode[propName].Keys) }
                    : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
                track.Keys = ensureScalarDefaultZeroKey(track.Keys)
                track.Keys = upsertScalarKey(track.Keys, frame, keyValue)
                nextNode[propName] = track
                nextNodes[nodeIndex] = nextNode
            })
        })
    }, [selectedParticleIds, currentFrame, inputs, commitParticleTracks])

    const handleInsertAllKeys = useCallback(() => {
        if (selectedParticleIds.length === 0) return
        const frame = Math.round(currentFrame)

        commitParticleTracks(`Particle Dynamic Key x${selectedParticleIds.length}`, (nextNodes) => {
            selectedParticleIds.forEach((particleId) => {
                const nodeIndex = nextNodes.findIndex((n: any) => Number(n?.ObjectId) === Number(particleId))
                if (nodeIndex < 0) return
                const nextNode = { ...nextNodes[nodeIndex] } as any

                PARTICLE_TRACKS.forEach(({ propName, fallback }) => {
                    const inputValue = Number(inputs[propName])
                    const currentValue = Number.isFinite(inputValue)
                        ? roundToMaxDecimals(inputValue)
                        : roundToMaxDecimals(readParticleScalarValueAtFrame(nextNode, propName, frame, fallback))
                    const track = isAnimTrack(nextNode[propName])
                        ? { ...nextNode[propName], Keys: normalizeScalarKeys(nextNode[propName].Keys) }
                        : { LineType: 1, GlobalSeqId: null, Keys: [] as any[] }
                    track.Keys = ensureScalarDefaultZeroKey(track.Keys)
                    track.Keys = upsertScalarKey(track.Keys, frame, currentValue)
                    nextNode[propName] = track
                })

                nextNodes[nodeIndex] = nextNode
            })
        })
    }, [selectedParticleIds, currentFrame, inputs, commitParticleTracks])

    return (
        <RightFloatingPanelShell
            title="粒子关键帧"
            status={`已选 ${selectedParticleIds.length}`}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
        >
            {selectedParticleIds.length === 0 ? (
                <div style={{ color: '#777', fontSize: 12, padding: '4px 2px' }}>
                    请选择粒子发射器节点后再编辑参数关键帧
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px 10px' }}>
                        {PARTICLE_TRACKS.map((track) => (
                            <div key={track.propName} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Text style={{ color: '#888', fontSize: 11, width: 44, flexShrink: 0, textAlign: 'right' }}>
                                    {track.label}
                                    {exactKeyByProp[track.propName] && <span style={{ color: '#52c41a', marginLeft: 2 }}>●</span>}
                                </Text>
                                <InputNumber
                                    size="small"
                                    min={'min' in track ? track.min : undefined}
                                    max={'max' in track ? track.max : undefined}
                                    step={track.step}
                                    value={inputs[track.propName]}
                                    onChange={(value) => handleInputChange(track.propName, value)}
                                    style={{ flex: 1, minWidth: 0 }}
                                />
                                <button
                                    onClick={() => handleInsertSingleKey(track.propName)}
                                    style={{
                                        padding: '1px 4px',
                                        background: 'transparent',
                                        border: '1px solid #555',
                                        borderRadius: 3,
                                        color: '#aaa',
                                        cursor: 'pointer',
                                        fontSize: 10,
                                        lineHeight: 1.4,
                                        flexShrink: 0
                                    }}
                                >
                                    K帧
                                </button>
                            </div>
                        ))}
                    </div>
                    <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
                        <Button
                            size="small"
                            block
                            onClick={handleInsertAllKeys}
                            style={{ background: '#177ddc', color: '#fff', border: 'none' }}
                        >
                            插入全部轨道关键帧
                        </Button>
                    </div>
                </div>
            )}
        </RightFloatingPanelShell>
    )
}

export default React.memo(ParticleAnimKeyframePanel)
