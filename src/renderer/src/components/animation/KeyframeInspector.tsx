import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Select } from 'antd'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'

const { Option } = Select

// 关键帧历史管理
interface KeyframeHistoryEntry {
    nodeId: number
    propName: 'Translation' | 'Rotation' | 'Scaling'
    oldValue: any
    newValue: any
}

const MAX_HISTORY = 10
let historyStack: KeyframeHistoryEntry[] = []
let historyIndex = -1

// 四元数转欧拉角 (弧度)
function quatToEuler(q: number[]): [number, number, number] {
    const [x, y, z, w] = q

    // Roll (X)
    const sinr_cosp = 2 * (w * x + y * z)
    const cosr_cosp = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinr_cosp, cosr_cosp)

    // Pitch (Y)
    const sinp = 2 * (w * y - z * x)
    let pitch: number
    if (Math.abs(sinp) >= 1) {
        pitch = Math.sign(sinp) * Math.PI / 2
    } else {
        pitch = Math.asin(sinp)
    }

    // Yaw (Z)
    const siny_cosp = 2 * (w * z + x * y)
    const cosy_cosp = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(siny_cosp, cosy_cosp)

    return [roll * 180 / Math.PI, pitch * 180 / Math.PI, yaw * 180 / Math.PI]
}

// 欧拉角转四元数 (度)
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
 * 关键帧检查器
 */
const KeyframeInspector: React.FC = () => {
    const selectedNodeIds = useSelectionStore(state => state.selectedNodeIds)
    const transformMode = useSelectionStore(state => state.transformMode)
    const nodes = useModelStore(state => state.nodes)
    const isPlaying = useModelStore(state => state.isPlaying)
    const updateNode = useModelStore(state => state.updateNode)
    const setFrame = useModelStore(state => state.setFrame)

    const [displayFrame, setDisplayFrame] = useState(0)
    const [jumpFrame, setJumpFrame] = useState('')
    const [, forceUpdate] = useState({})
    const currentFrameRef = useRef(0)

    // 只在暂停时更新帧显示
    useEffect(() => {
        currentFrameRef.current = useModelStore.getState().currentFrame
        setDisplayFrame(Math.round(currentFrameRef.current))
        const interval = setInterval(() => {
            const playing = useModelStore.getState().isPlaying
            if (!playing) {
                const frame = useModelStore.getState().currentFrame
                if (Math.abs(frame - currentFrameRef.current) > 0.5) {
                    currentFrameRef.current = frame
                    setDisplayFrame(Math.round(frame))
                }
            }
        }, 200)
        return () => clearInterval(interval)
    }, [])

    const activeNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null
    const activeNode = activeNodeId !== null ? nodes.find((n: any) => n.ObjectId === activeNodeId) : null

    // 获取关键帧数据或默认值
    const getKeyframeValues = useCallback((prop: any, size: 3 | 4): number[] => {
        if (!prop || !prop.Keys || prop.Keys.length === 0) {
            return size === 4 ? [0, 0, 0, 1] : [0, 0, 0]
        }
        const keys = prop.Keys
        let closestKey = keys[0]
        for (const k of keys) {
            if (Math.abs(k.Frame - displayFrame) < Math.abs(closestKey.Frame - displayFrame)) {
                closestKey = k
            }
        }
        return closestKey.Vector || (size === 4 ? [0, 0, 0, 1] : [0, 0, 0])
    }, [displayFrame])

    // 添加到历史记录
    const pushHistory = (entry: KeyframeHistoryEntry) => {
        historyStack = historyStack.slice(0, historyIndex + 1)
        historyStack.push(entry)
        if (historyStack.length > MAX_HISTORY) {
            historyStack.shift()
        } else {
            historyIndex++
        }
        forceUpdate({})
    }

    // 修改关键帧值
    const handleValueChange = useCallback((propName: 'Translation' | 'Rotation' | 'Scaling', newValues: number[]) => {
        if (!activeNode) return

        const oldProp = activeNode[propName] ? JSON.parse(JSON.stringify(activeNode[propName])) : null
        const existingProp = activeNode[propName] || { Keys: [], InterpolationType: 1 }
        const keys = [...(existingProp.Keys || [])]
        const frame = Math.round(currentFrameRef.current)

        const existingKeyIndex = keys.findIndex((k: any) => Math.abs(k.Frame - frame) < 0.1)

        if (existingKeyIndex >= 0) {
            keys[existingKeyIndex] = { ...keys[existingKeyIndex], Vector: newValues }
        } else {
            keys.push({ Frame: frame, Vector: newValues })
            keys.sort((a: any, b: any) => a.Frame - b.Frame)
        }

        const newProp = { ...existingProp, Keys: keys }
        updateNode(activeNode.ObjectId, { [propName]: newProp })

        pushHistory({
            nodeId: activeNode.ObjectId,
            propName,
            oldValue: oldProp,
            newValue: newProp
        })
    }, [activeNode, updateNode])

    // 跳转帧
    const handleJumpFrame = () => {
        const frame = parseInt(jumpFrame)
        if (!isNaN(frame) && frame >= 0) {
            setFrame(frame)
            setDisplayFrame(frame)
            currentFrameRef.current = frame
            setJumpFrame('')
        }
    }

    // 当前显示的属性
    const getCurrentPropInfo = (): { label: string; propName: 'Translation' | 'Rotation' | 'Scaling'; isRotation: boolean } | null => {
        if (transformMode === 'translate') return { label: '位移', propName: 'Translation', isRotation: false }
        if (transformMode === 'rotate') return { label: '旋转 (欧拉角)', propName: 'Rotation', isRotation: true }
        if (transformMode === 'scale') return { label: '缩放', propName: 'Scaling', isRotation: false }
        return null
    }

    const propInfo = getCurrentPropInfo()

    // 渲染单个属性
    const renderProperty = () => {
        if (!activeNode || !propInfo) return null

        const { label, propName, isRotation } = propInfo
        const prop = activeNode[propName]

        // 位移模式始终使用世界位置
        let rawValues = getKeyframeValues(prop, isRotation ? 4 : 3)
        if (propName === 'Translation') {
            // 始终使用 Viewer 计算的世界位置
            const worldPos = (window as any)._selectedBoneWorldPos
            if (worldPos && Array.isArray(worldPos) && worldPos.length === 3) {
                rawValues = worldPos
            }
        }

        // 旋转使用欧拉角显示
        const values = isRotation ? quatToEuler(rawValues) : rawValues
        const axes = ['X', 'Y', 'Z']
        const axisColors = ['#ff4d4f', '#52c41a', '#1890ff']

        return (
            <div style={{ marginBottom: 12 }}>
                {/* 标题栏 + 插值选择 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#ccc' }}>{label}</span>
                    <select
                        value={prop?.InterpolationType ?? 1}
                        onChange={(e) => {
                            const val = parseInt(e.target.value)
                            const existingProp = prop || { Keys: [], InterpolationType: 1 }
                            const newProp = { ...existingProp, InterpolationType: val }
                            updateNode(activeNode.ObjectId, { [propName]: newProp })
                        }}
                        style={{
                            backgroundColor: '#333',
                            color: '#ccc',
                            border: '1px solid #555',
                            borderRadius: 3,
                            padding: '2px 4px',
                            fontSize: '10px'
                        }}
                    >
                        <option value={0}>无</option>
                        <option value={1}>线性</option>
                        <option value={2}>平滑</option>
                        <option value={3}>贝塞尔</option>
                    </select>
                </div>

                {/* 数值输入 - 每行一轴 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {axes.map((axis, i) => (
                        <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                                color: axisColors[i],
                                fontSize: '11px',
                                fontWeight: 'bold',
                                width: 14,
                                textAlign: 'center'
                            }}>{axis}</span>
                            <input
                                type="number"
                                step={isRotation ? "1" : "0.01"}
                                value={parseFloat(values[i]?.toFixed(2) ?? '0')}
                                onChange={(e) => {
                                    const newVals = [...values]
                                    newVals[i] = parseFloat(e.target.value) || 0
                                    if (isRotation) {
                                        // 欧拉角转回四元数
                                        const quat = eulerToQuat(newVals as [number, number, number])
                                        handleValueChange(propName, quat)
                                    } else {
                                        handleValueChange(propName, newVals)
                                    }
                                }}
                                disabled={isPlaying}
                                style={{
                                    flex: 1,
                                    backgroundColor: '#1a1a1a',
                                    border: '1px solid #444',
                                    borderRadius: 3,
                                    color: isPlaying ? '#666' : '#fff',
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    outline: 'none'
                                }}
                            />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (!activeNode) {
        return (
            <div style={{ padding: 20, color: '#666', textAlign: 'center', fontSize: '12px' }}>
                请选择一个节点
            </div>
        )
    }

    if (!propInfo) {
        return (
            <div style={{ padding: 20, color: '#666', textAlign: 'center', fontSize: '12px' }}>
                请选择变换模式（W/E/R）
            </div>
        )
    }

    return (
        <div style={{ padding: 10, overflowY: 'auto', height: '100%', color: 'white', backgroundColor: '#252525' }}>
            {/* 节点信息 */}
            <div style={{ marginBottom: 10, borderBottom: '1px solid #333', paddingBottom: 8 }}>
                <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#eee' }}>{activeNode.Name}</div>
                <div style={{
                    fontSize: '12px',
                    marginTop: 4,
                    fontWeight: 'bold',
                    color: (() => {
                        // 不同节点类型用不同颜色
                        const typeColors: Record<string, string> = {
                            'Bone': '#52c41a',      // 绿色
                            'Helper': '#1890ff',    // 蓝色
                            'Attachment': '#faad14', // 橙色
                            'Light': '#ffe58f',     // 黄色
                            'ParticleEmitter': '#ff4d4f', // 红色
                            'ParticleEmitter2': '#ff7a45', // 橙红
                            'RibbonEmitter': '#eb2f96', // 粉色
                            'Camera': '#722ed1',    // 紫色
                            'Event': '#13c2c2',     // 青色
                            'CollisionShape': '#8c8c8c' // 灰色
                        }
                        return typeColors[activeNode.type] || '#888'
                    })()
                }}>
                    {(() => {
                        // 节点类型中文名称
                        const typeNames: Record<string, string> = {
                            'Bone': '骨骼',
                            'Helper': '辅助点',
                            'Attachment': '附着点',
                            'Light': '灯光',
                            'ParticleEmitter': '粒子发射器',
                            'ParticleEmitter2': '粒子发射器2',
                            'RibbonEmitter': '飘带发射器',
                            'Camera': '摄像机',
                            'Event': '事件',
                            'CollisionShape': '碰撞体'
                        }
                        return typeNames[activeNode.type] || activeNode.type
                    })()}
                </div>
            </div>

            {/* 属性编辑 */}
            {renderProperty()}
        </div>
    )
}

export default KeyframeInspector
