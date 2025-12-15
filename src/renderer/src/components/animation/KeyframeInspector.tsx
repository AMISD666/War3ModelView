import React, { useState, useEffect, useRef, useCallback } from 'react'
import { InputNumber, Button, Space, Select, Tooltip, Row, Col } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'

const { Option } = Select

/**
 * 关键帧检查器 - 查看和编辑选中节点的动画属性
 * 性能优化：节流帧显示更新
 */
const KeyframeInspector: React.FC = () => {
    const selectedNodeIds = useSelectionStore(state => state.selectedNodeIds)
    const nodes = useModelStore(state => state.nodes)
    const updateNode = useModelStore(state => state.updateNode)

    const [displayFrame, setDisplayFrame] = useState(0)
    const currentFrameRef = useRef(0)

    // 每500ms更新一次显示的帧数，避免每帧重渲染
    useEffect(() => {
        currentFrameRef.current = useModelStore.getState().currentFrame

        const interval = setInterval(() => {
            const frame = useModelStore.getState().currentFrame
            if (Math.abs(frame - currentFrameRef.current) > 0.5) {
                currentFrameRef.current = frame
                setDisplayFrame(Math.round(frame))
            }
        }, 500)

        return () => clearInterval(interval)
    }, [])

    // 获取选中的节点
    const activeNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null
    const activeNode = activeNodeId !== null ? nodes.find((n: any) => n.ObjectId === activeNodeId) : null

    // 查找当前帧的关键帧
    const findKeyframe = useCallback((keys: any[], frame: number) => {
        if (!keys) return null
        return keys.find((k: any) => Math.abs(k.Frame - frame) < 0.1)
    }, [])

    // 设置关键帧
    const handleSetKeyframe = useCallback((propName: 'Translation' | 'Rotation' | 'Scaling', value?: number[]) => {
        if (!activeNode) return

        const existingProp = activeNode[propName] || { Keys: [], InterpolationType: 1 }
        const keys = [...(existingProp.Keys || [])]
        const frame = Math.round(currentFrameRef.current)

        let newValue = value
        if (!newValue) {
            if (propName === 'Scaling') newValue = [1, 1, 1]
            else if (propName === 'Rotation') newValue = [0, 0, 0, 1]
            else newValue = [0, 0, 0]
        }

        const existingKeyIndex = keys.findIndex((k: any) => Math.abs(k.Frame - frame) < 0.1)

        if (existingKeyIndex >= 0) {
            keys[existingKeyIndex] = { ...keys[existingKeyIndex], Vector: newValue }
        } else {
            keys.push({ Frame: frame, Vector: newValue })
            keys.sort((a: any, b: any) => a.Frame - b.Frame)
        }

        updateNode(activeNode.ObjectId, {
            [propName]: { ...existingProp, Keys: keys }
        })
    }, [activeNode, updateNode])

    // 删除关键帧
    const handleDeleteKeyframe = useCallback((propName: 'Translation' | 'Rotation' | 'Scaling') => {
        if (!activeNode || !activeNode[propName]) return

        const keys = [...activeNode[propName].Keys]
        const frame = Math.round(currentFrameRef.current)
        const newKeys = keys.filter((k: any) => Math.abs(k.Frame - frame) >= 0.1)

        updateNode(activeNode.ObjectId, {
            [propName]: { ...activeNode[propName], Keys: newKeys }
        })
    }, [activeNode, updateNode])

    // 修改插值类型
    const handleInterpolationChange = useCallback((propName: 'Translation' | 'Rotation' | 'Scaling', type: number) => {
        if (!activeNode) return
        const prop = activeNode[propName]
        if (!prop) return
        updateNode(activeNode.ObjectId, {
            [propName]: { ...prop, InterpolationType: type }
        })
    }, [activeNode, updateNode])

    // 渲染属性编辑区
    const renderProperty = (label: string, propName: 'Translation' | 'Rotation' | 'Scaling', size: 3 | 4) => {
        if (!activeNode) return null

        const prop = activeNode[propName]
        const keys = prop ? prop.Keys : []
        const activeKey = findKeyframe(keys, displayFrame)
        const hasKey = !!activeKey
        const values = activeKey ? activeKey.Vector : (size === 4 ? [0, 0, 0, 1] : [0, 0, 0])

        return (
            <div style={{ marginBottom: 12, padding: '8px', backgroundColor: '#333', borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold' }}>{label}</span>
                    <Space size="small">
                        <Select
                            size="small"
                            style={{ width: 75, fontSize: '10px' }}
                            value={prop ? prop.InterpolationType : 0}
                            onChange={(val) => handleInterpolationChange(propName, val)}
                            disabled={!prop || !prop.Keys?.length}
                        >
                            <Option value={0}>无</Option>
                            <Option value={1}>线性</Option>
                            <Option value={2}>埃尔米特</Option>
                            <Option value={3}>贝塞尔</Option>
                        </Select>

                        {hasKey ? (
                            <Tooltip title="删除关键帧">
                                <Button danger type="text" icon={<DeleteOutlined />} size="small" onClick={() => handleDeleteKeyframe(propName)} />
                            </Tooltip>
                        ) : (
                            <Tooltip title="添加关键帧">
                                <Button type="text" icon={<PlusOutlined style={{ color: '#52c41a' }} />} size="small" onClick={() => handleSetKeyframe(propName)} />
                            </Tooltip>
                        )}
                    </Space>
                </div>

                {hasKey ? (
                    <Row gutter={4}>
                        {['X', 'Y', 'Z', 'W'].slice(0, size).map((axis, i) => (
                            <Col span={24 / size} key={axis}>
                                <InputNumber
                                    size="small"
                                    style={{ width: '100%' }}
                                    value={values[i]}
                                    step={0.1}
                                    onChange={(val) => {
                                        const newVals = [...values]
                                        newVals[i] = val || 0
                                        handleSetKeyframe(propName, newVals)
                                    }}
                                    prefix={<span style={{ color: axis === 'X' ? '#ff4d4f' : axis === 'Y' ? '#52c41a' : axis === 'Z' ? '#1890ff' : '#aaa', fontSize: '10px' }}>{axis}</span>}
                                />
                            </Col>
                        ))}
                    </Row>
                ) : (
                    <div style={{ color: '#666', fontSize: '11px', textAlign: 'center', padding: 4 }}>
                        帧 {displayFrame} 无关键帧
                    </div>
                )}
            </div>
        )
    }

    if (!activeNode) {
        return (
            <div style={{ padding: 20, color: '#666', textAlign: 'center', fontSize: '12px' }}>
                请选择一个节点以编辑关键帧
            </div>
        )
    }

    return (
        <div style={{ padding: 10, overflowY: 'auto', height: '100%', color: 'white', backgroundColor: '#2b2b2b' }}>
            <div style={{ marginBottom: 10, borderBottom: '1px solid #444', paddingBottom: 6 }}>
                <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{activeNode.Name}</div>
                <div style={{ color: '#888', fontSize: '10px' }}>{activeNode.type} | 帧: {displayFrame}</div>
            </div>

            {renderProperty('位移', 'Translation', 3)}
            {renderProperty('旋转', 'Rotation', 4)}
            {renderProperty('缩放', 'Scaling', 3)}
        </div>
    )
}

export default KeyframeInspector
