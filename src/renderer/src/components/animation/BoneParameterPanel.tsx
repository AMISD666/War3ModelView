import React, { useMemo } from 'react'
import { InputNumber, Space, Typography, Select, message } from 'antd'
import { useSelectionStore } from '../../store/selectionStore'
import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { SetNodeParentCommand } from '../../commands/SetNodeParentCommand'
import { useCommandManager } from '../../utils/CommandManager'

const { Text } = Typography

/**
 * 骨骼参数面板 - 显示选中骨骼的位置信息和绑定骨骼列表
 */
const BoneParameterPanel: React.FC = () => {
    const selectedNodeIds = useSelectionStore(state => state.selectedNodeIds)
    const selectNodes = useSelectionStore(state => state.selectNodes)
    const selectedVertexIds = useSelectionStore(state => state.selectedVertexIds)
    const nodes = useModelStore(state => state.nodes)
    const modelData = useModelStore(state => state.modelData)

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

    // 获取骨骼位置（从绑定姿态下的世界坐标）- 使用 useMemo 缓存避免重复计算
    const position = useMemo(() => {
        if (!selectedNode) return [0, 0, 0]

        // Get position from renderer's rendererData.nodes (has computed world matrix)
        if (renderer && renderer.rendererData && renderer.rendererData.nodes) {
            const objectId = selectedNode.ObjectId
            const nodeWrapper = renderer.rendererData.nodes[objectId]
            if (nodeWrapper && nodeWrapper.node && nodeWrapper.node.PivotPoint && nodeWrapper.matrix) {
                // Transform PivotPoint by the node's world matrix
                const pivot = nodeWrapper.node.PivotPoint
                const matrix = nodeWrapper.matrix
                // Manual mat4 * vec3 transform (result = matrix * [pivot, 1])
                const x = matrix[0] * pivot[0] + matrix[4] * pivot[1] + matrix[8] * pivot[2] + matrix[12]
                const y = matrix[1] * pivot[0] + matrix[5] * pivot[1] + matrix[9] * pivot[2] + matrix[13]
                const z = matrix[2] * pivot[0] + matrix[6] * pivot[1] + matrix[10] * pivot[2] + matrix[14]
                return [x, y, z]
            }
            // If nodeWrapper exists but no PivotPoint, try raw pivot from model
            if (nodeWrapper && renderer.model && renderer.model.PivotPoints && renderer.model.PivotPoints[objectId]) {
                const pivot = renderer.model.PivotPoints[objectId]
                const matrix = nodeWrapper.matrix
                if (pivot && matrix) {
                    const x = matrix[0] * pivot[0] + matrix[4] * pivot[1] + matrix[8] * pivot[2] + matrix[12]
                    const y = matrix[1] * pivot[0] + matrix[5] * pivot[1] + matrix[9] * pivot[2] + matrix[13]
                    const z = matrix[2] * pivot[0] + matrix[6] * pivot[1] + matrix[10] * pivot[2] + matrix[14]
                    return [x, y, z]
                }
            }
        }

        // Fallback: Try node's PivotPoint directly (local space)
        if (selectedNode.PivotPoint && Array.isArray(selectedNode.PivotPoint)) {
            return selectedNode.PivotPoint
        }

        return [0, 0, 0]
    }, [selectedNode, renderer])

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
                                <Text style={{ color: '#888', fontSize: '11px' }}>位置 (XYZ)</Text>
                                <Space style={{ marginTop: 4 }}>
                                    <InputNumber
                                        size="small"
                                        style={{ width: 70 }}
                                        value={position[0]?.toFixed(2)}
                                        disabled
                                        prefix={<span style={{ color: '#ff4d4f' }}>X</span>}
                                    />
                                    <InputNumber
                                        size="small"
                                        style={{ width: 70 }}
                                        value={position[1]?.toFixed(2)}
                                        disabled
                                        prefix={<span style={{ color: '#52c41a' }}>Y</span>}
                                    />
                                    <InputNumber
                                        size="small"
                                        style={{ width: 70 }}
                                        value={position[2]?.toFixed(2)}
                                        disabled
                                        prefix={<span style={{ color: '#1890ff' }}>Z</span>}
                                    />
                                </Space>
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

