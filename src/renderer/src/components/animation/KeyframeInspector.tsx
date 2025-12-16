import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useRendererStore } from '../../store/rendererStore'

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

// 非受控数字输入框，防止重渲染打断输入
const UncontrolledInput: React.FC<{
    value: number
    onChange: (val: number) => void
    step?: string
    disabled?: boolean
    style?: React.CSSProperties
}> = ({ value, onChange, step, disabled, style }) => {
    const [localVal, setLocalVal] = useState(value.toString())
    const isEditing = useRef(false)

    useEffect(() => {
        if (!isEditing.current) {
            setLocalVal(value.toString())
        }
    }, [value])

    const handleCommit = () => {
        isEditing.current = false
        const num = parseFloat(localVal)
        if (!isNaN(num)) {
            onChange(num)
        } else {
            setLocalVal(value.toString()) // Reset on invalid
        }
    }

    return (
        <input
            type="number"
            step={step}
            value={localVal}
            onChange={(e) => {
                isEditing.current = true
                setLocalVal(e.target.value)
            }}
            onBlur={handleCommit}
            onKeyDown={(e) => {
                e.stopPropagation(); // 阻止全局快捷键
                if (e.key === 'Enter') {
                    handleCommit()
                    e.currentTarget.blur()
                }
            }}
            disabled={disabled}
            style={style}
        />
    )
}

/**
 * 关键帧检查器
 */
const KeyframeInspector: React.FC = () => {
    const selectedNodeIds = useSelectionStore(state => state.selectedNodeIds)
    const transformMode = useSelectionStore(state => state.transformMode)
    const nodes = useModelStore(state => state.nodes)
    const isPlaying = useModelStore(state => state.isPlaying)
    const updateNodeSilent = useModelStore(state => state.updateNodeSilent)
    // const setFrame = useModelStore(state => state.setFrame) // Unused
    const renderer = useRendererStore(state => state.renderer)

    const [displayFrame, setDisplayFrame] = useState(0)
    // const [jumpFrame, setJumpFrame] = useState('') // Unused
    const [, forceUpdate] = useState({})
    const currentFrameRef = useRef(0)

    // 只在暂停时更新帧显示
    useEffect(() => {
        const interval = setInterval(() => {
            // Update frame logic...
            const store = useModelStore.getState()
            const frame = store.currentFrame
            currentFrameRef.current = frame

            if (!store.isPlaying) {
                setDisplayFrame(Math.round(frame))
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
        const interpolationType = existingProp.InterpolationType || 0;

        let newKey: any = { Frame: frame, Vector: newValues };

        // 修复切线丢失问题：如果插值类型需要切线，则必须初始化
        if (interpolationType > 1) { // 2=Hermite, 3=Bezier
            if (existingKeyIndex >= 0) {
                const oldKey = keys[existingKeyIndex];
                if (oldKey.InTan) newKey.InTan = [...oldKey.InTan];
                else newKey.InTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0];
                if (oldKey.OutTan) newKey.OutTan = [...oldKey.OutTan];
                else newKey.OutTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0];
            } else {
                newKey.InTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0];
                newKey.OutTan = propName === 'Rotation' ? [0, 0, 0, 0] : [0, 0, 0];
            }
        }

        if (existingKeyIndex >= 0) {
            keys[existingKeyIndex] = newKey
        } else {
            keys.push(newKey)
            keys.sort((a: any, b: any) => a.Frame - b.Frame)
        }

        const newProp = { ...existingProp, Keys: keys }

        // 使用 Silent 更新避免全量重载导致 T-Pose
        updateNodeSilent(activeNode.ObjectId, { [propName]: newProp })

        // 手动同步 Renderer Runtime Data (实时更新)
        if (renderer && (renderer as any).rendererData) {
            const nodes = (renderer as any).rendererData.nodes;
            const renderNode = nodes.find((n: any) => n.node && n.node.ObjectId === activeNode.ObjectId);
            if (renderNode) {
                // 直接更新运行时节点数据
                renderNode.node[propName] = newProp;

                // 强制刷新一帧动画 (dt=0) 以重新计算变换
                renderer.update(0);
            }
        }

        pushHistory({
            nodeId: activeNode.ObjectId,
            propName,
            oldValue: oldProp,
            newValue: newProp
        })
    }, [activeNode, updateNodeSilent, renderer])

    // 跳转帧 (Unused)
    // const handleJumpFrame = () => { ... }

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

        // 默认拿本地关键帧数据 (Local Only)
        // REVERT: Removed World Position Logic entirely to stabilize input
        let rawValues = getKeyframeValues(prop, isRotation ? 4 : 3)
        let displayValues = [...rawValues]

        // 旋转使用欧拉角显示
        const values = isRotation ? quatToEuler(displayValues) : displayValues
        const axes = ['X', 'Y', 'Z']
        const axisColors = ['#ff4d4f', '#52c41a', '#1890ff']

        return (
            <div style={{ marginBottom: 12 }}>
                {/* 标题栏 + 插值选择 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#ccc' }}>
                        {label} {'(Local)'}
                    </span>
                    <select
                        value={prop?.InterpolationType ?? 1}
                        onChange={(e) => {
                            const val = parseInt(e.target.value)
                            const existingProp = prop || { Keys: [], InterpolationType: 1 }
                            const newProp = { ...existingProp, InterpolationType: val }
                            updateNodeSilent(activeNode.ObjectId, { [propName]: newProp })
                            if (renderer) renderer.update(0);
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
                            <UncontrolledInput
                                step={isRotation ? "1" : "0.01"}
                                value={parseFloat(values[i]?.toFixed(2) ?? '0')}
                                onChange={(val) => {
                                    const newVals = [...values]
                                    newVals[i] = val

                                    if (isRotation) {
                                        // 欧拉角转回四元数
                                        const quat = eulerToQuat(newVals as [number, number, number])
                                        handleValueChange(propName, quat)
                                    } else {
                                        // 位移/缩放直接使用 (Local)
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

    return (
        <div style={{ padding: 12, color: '#fff', fontSize: '12px' }}>
            <div style={{ marginBottom: 12 }}>
                <span style={{ color: '#888' }}>当前节点:</span>
                <span style={{ marginLeft: 8, fontWeight: 'bold' }}>{activeNode.Name}</span>
                <span style={{ marginLeft: 8, color: '#555', fontSize: '10px' }}>(ID: {activeNode.ObjectId})</span>
            </div>

            {renderProperty()}

            {/* Undo/Redo - hidden for now as global shortcut works */}
        </div>
    )
}

export default KeyframeInspector
