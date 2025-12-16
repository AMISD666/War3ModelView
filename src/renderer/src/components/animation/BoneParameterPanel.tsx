import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { InputNumber, Space, Typography, Select, message } from 'antd'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { SetNodeParentCommand } from '../../commands/SetNodeParentCommand'
import { UpdateKeyframeCommand } from '../../commands/UpdateKeyframeCommand'
import { useCommandManager } from '../../utils/CommandManager'

const { Text } = Typography

// 插值函数：获取指定帧的 Translation 值
const interpolateTranslation = (keys: any[], frame: number): number[] => {
    if (!keys || keys.length === 0) return [0, 0, 0]

    const sortedKeys = [...keys].sort((a: any, b: any) => a.Frame - b.Frame)

    const toArray = (v: any): number[] => {
        if (!v) return [0, 0, 0]
        if (Array.isArray(v)) return [...v]
        if (v.length !== undefined) return Array.from(v) as number[]
        return [0, 0, 0]
    }

    if (frame <= sortedKeys[0].Frame) {
        return toArray(sortedKeys[0].Vector)
    }
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) {
        return toArray(sortedKeys[sortedKeys.length - 1].Vector)
    }

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame)
            const from = toArray(sortedKeys[i].Vector)
            const to = toArray(sortedKeys[i + 1].Vector)
            return from.map((v, idx) => v + (to[idx] - v) * t)
        }
    }

    return [0, 0, 0]
}

/**
 * 骨骼参数面板 - 显示选中骨骼的 Translation 信息和绑定骨骼列表
 */
const BoneParameterPanel: React.FC = () => {
    const selectedNodeIds = useSelectionStore(state => state.selectedNodeIds)
    const selectNodes = useSelectionStore(state => state.selectNodes)
    const selectedVertexIds = useSelectionStore(state => state.selectedVertexIds)
    const nodes = useModelStore(state => state.nodes)
    const modelData = useModelStore(state => state.modelData)
    const currentFrame = useModelStore(state => state.currentFrame)

    const renderer = useRendererStore(state => state.renderer)
    const { executeCommand } = useCommandManager()

    // 获取选中的骨骼节点
    const selectedNode = selectedNodeIds.length === 1
        ? nodes.find((n: any) => n.ObjectId === selectedNodeIds[0])
        : null

    // 计算该骨骼绑定的顶点数量
    const boneVertexCount = useMemo(() => {
        if (!modelData || !modelData.Geosets || selectedNodeIds.length !== 1) return 0
        const boneId = selectedNodeIds[0]
        let count = 0

        modelData.Geosets.forEach((geoset: any) => {
            if (!geoset.VertexGroup || !geoset.Groups) return
            geoset.VertexGroup.forEach((groupIdx: number) => {
                const group = geoset.Groups[groupIdx]
                if (group && Array.isArray(group) && group.includes(boneId)) {
                    count++
                }
            })
        })

        return count
    }, [modelData, selectedNodeIds])

    // 计算绑定骨骼
    const boundBones = useMemo(() => {
        if (!modelData || !modelData.Geosets || selectedVertexIds.length === 0) return []

        const boneMap = new Map<number, string>()

        selectedVertexIds.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (!geoset || !geoset.VertexGroup || !geoset.Groups) return

            const matrixGroupIndex = geoset.VertexGroup[sel.index]
            if (matrixGroupIndex === undefined || matrixGroupIndex < 0 || matrixGroupIndex >= geoset.Groups.length) return

            const matrixGroup = geoset.Groups[matrixGroupIndex] as any
            if (!matrixGroup) return

            const matrix = matrixGroup
            if (matrix && Array.isArray(matrix)) {
                matrix.forEach((nodeIndex: number) => {
                    const node = nodes.find((n: any) => n.ObjectId === nodeIndex)
                    if (node) {
                        boneMap.set(nodeIndex, node.Name)
                    }
                })
            }
        })

        return Array.from(boneMap.entries()).map(([index, name]) => ({ index, name }))
    }, [modelData, nodes, selectedVertexIds])

    // 获取当前帧的 Translation 值（插值）
    const translation = useMemo(() => {
        if (!selectedNode) return [0, 0, 0]
        const keys = selectedNode.Translation?.Keys
        if (!keys || keys.length === 0) return [0, 0, 0]
        return interpolateTranslation(keys, currentFrame)
    }, [selectedNode, currentFrame])

    // 检查当前帧是否有精确的关键帧
    const hasExactKeyframe = useMemo(() => {
        if (!selectedNode?.Translation?.Keys) return false
        const frame = Math.round(currentFrame)
        return selectedNode.Translation.Keys.some((k: any) => Math.abs(k.Frame - frame) < 0.1)
    }, [selectedNode, currentFrame])

    // 处理 Translation 值变化
    const handleTranslationChange = useCallback((axis: number, value: number | null) => {
        if (value === null || !selectedNode || !renderer) return

        const frame = Math.round(currentFrame)
        const nodeId = selectedNode.ObjectId

        // 获取当前的 Translation 值
        const currentTranslation = [...translation]
        currentTranslation[axis] = value

        // 获取现有关键帧（如果有）
        const oldKeys = selectedNode.Translation?.Keys || []
        const existingKey = oldKeys.find((k: any) => Math.abs(k.Frame - frame) < 0.1)

        const cmd = new UpdateKeyframeCommand(renderer, [{
            nodeId,
            propertyName: 'Translation',
            frame,
            oldValue: existingKey ? [...existingKey.Vector] : null,
            newValue: currentTranslation
        }])

        executeCommand(cmd)
        message.success(`已更新 Translation 关键帧 (帧 ${frame})`)
    }, [selectedNode, currentFrame, translation, renderer, executeCommand])

    const handleParentChange = (value: number | undefined) => {
        if (!renderer || !selectedNode) return

        const cmd = new SetNodeParentCommand(renderer, selectedNode.ObjectId, value)
        executeCommand(cmd)
        message.success('已修改父节点')
    }

    // Filter nodes for dropdown: exclude self and children (to prevent loops)
    const availableParents = useMemo(() => {
        if (!selectedNode) return []

        // Avoid cyclic dependency: Exclude self and all descendants
        const descendantIds = new Set<number>()
        descendantIds.add(selectedNode.ObjectId)

        const stack = [selectedNode.ObjectId]
        while (stack.length > 0) {
            const currentId = stack.pop()!
            // find children
            const children = nodes.filter((n: any) => n.Parent === currentId)
            children.forEach((c: any) => {
                if (!descendantIds.has(c.ObjectId)) {
                    descendantIds.add(c.ObjectId)
                    stack.push(c.ObjectId)
                }
            })
        }

        return nodes
            .filter((n: any) => !descendantIds.has(n.ObjectId))
            .map((n: any) => ({ label: `${n.Name} (${n.ObjectId})`, value: n.ObjectId }))
    }, [nodes, selectedNode])

    return (
        <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#2b2b2b',
            color: '#eee'
        }}>
            {/* 顶点统计信息 */}
            <div style={{
                padding: '8px 10px',
                borderBottom: '1px solid #444',
                backgroundColor: '#333'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                    <span style={{ color: '#aaa' }}>
                        选中顶点: <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{selectedVertexIds.length}</span>
                    </span>
                    {selectedNodeIds.length === 1 && (
                        <span style={{ color: '#aaa' }}>
                            骨骼绑定: <span style={{ color: '#1890ff', fontWeight: 'bold' }}>{boneVertexCount}</span>
                        </span>
                    )}
                </div>
            </div>

            {/* 骨骼参数 */}
            <div style={{ padding: '10px', borderBottom: '1px solid #444' }}>
                <Text strong style={{ color: '#fff', fontSize: '13px' }}>骨骼参数</Text>

                <div style={{ marginTop: 10 }}>
                    {selectedNode ? (
                        <>
                            <div style={{ marginBottom: 8, color: '#aaa', fontSize: '12px' }}>
                                {selectedNode.Name} ({selectedNode.type})
                            </div>
                            <div style={{ marginBottom: 6 }}>
                                <Text style={{ color: '#888', fontSize: '11px' }}>
                                    位移 (Translation)
                                    {hasExactKeyframe && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}
                                </Text>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <span style={{ color: '#ff4d4f', marginRight: 8, fontSize: '11px', width: 12 }}>X</span>
                                        <InputNumber
                                            size="small"
                                            controls={false}
                                            style={{ flex: 1, background: '#1f1f1f', borderColor: '#444', color: '#fff' }}
                                            value={parseFloat(translation[0]?.toFixed(5)) || 0}
                                            step={0.1}
                                            onPressEnter={(e) => handleTranslationChange(0, parseFloat((e.target as HTMLInputElement).value))}
                                            onBlur={(e) => handleTranslationChange(0, parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <span style={{ color: '#52c41a', marginRight: 8, fontSize: '11px', width: 12 }}>Y</span>
                                        <InputNumber
                                            size="small"
                                            controls={false}
                                            style={{ flex: 1, background: '#1f1f1f', borderColor: '#444', color: '#fff' }}
                                            value={parseFloat(translation[1]?.toFixed(5)) || 0}
                                            step={0.1}
                                            onPressEnter={(e) => handleTranslationChange(1, parseFloat((e.target as HTMLInputElement).value))}
                                            onBlur={(e) => handleTranslationChange(1, parseFloat(e.target.value))}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <span style={{ color: '#1890ff', marginRight: 8, fontSize: '11px', width: 12 }}>Z</span>
                                        <InputNumber
                                            size="small"
                                            controls={false}
                                            style={{ flex: 1, background: '#1f1f1f', borderColor: '#444', color: '#fff' }}
                                            value={parseFloat(translation[2]?.toFixed(5)) || 0}
                                            step={0.1}
                                            onPressEnter={(e) => handleTranslationChange(2, parseFloat((e.target as HTMLInputElement).value))}
                                            onBlur={(e) => handleTranslationChange(2, parseFloat(e.target.value))}
                                        />
                                    </div>
                                </div>
                                <div style={{ marginTop: 4, fontSize: '10px', color: '#666' }}>
                                    输入数值或使用 Gizmo 编辑 · 帧 {Math.round(currentFrame)}
                                </div>
                            </div>

                            <div style={{ marginBottom: 6 }}>
                                <Text style={{ color: '#888', fontSize: '11px' }}>父节点</Text>
                                <Select
                                    style={{ width: '100%', marginTop: 4 }}
                                    size="small"
                                    placeholder="无父节点"
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    value={selectedNode.Parent === -1 ? undefined : selectedNode.Parent}
                                    onChange={handleParentChange}
                                    options={availableParents}
                                    disabled={!renderer}
                                />
                            </div>
                        </>
                    ) : (
                        <div style={{ color: '#666', fontSize: '12px' }}>
                            {selectedNodeIds.length === 0
                                ? '未选择骨骼'
                                : `已选择 ${selectedNodeIds.length} 个骨骼`}
                        </div>
                    )}
                </div>
            </div>

            {/* 绑定骨骼列表 */}
            <div style={{ flex: 1, overflow: 'auto', padding: '10px' }}>
                <Text strong style={{ color: '#fff', fontSize: '13px' }}>
                    绑定骨骼 ({boundBones.length})
                </Text>

                {boundBones.length === 0 ? (
                    <div style={{ marginTop: 10, color: '#666', fontSize: '12px', textAlign: 'center' }}>
                        未选择顶点或无绑定
                    </div>
                ) : (
                    <div style={{ marginTop: 10 }}>
                        {boundBones.map(bone => (
                            <div
                                key={bone.index}
                                onClick={() => selectNodes([bone.index])}
                                style={{
                                    padding: '6px 8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    backgroundColor: selectedNodeIds.includes(bone.index) ? 'rgba(24, 144, 255, 0.3)' : 'transparent',
                                    border: selectedNodeIds.includes(bone.index) ? '1px solid #1890ff' : '1px solid transparent',
                                    borderRadius: 2,
                                    marginBottom: 2,
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                <span style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    backgroundColor: selectedNodeIds.includes(bone.index) ? '#1890ff' : '#52c41a',
                                    marginRight: 8,
                                    display: 'inline-block'
                                }} />
                                {bone.name}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default BoneParameterPanel

