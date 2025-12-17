import React, { useMemo } from 'react'
import { Button, Space, message, Tooltip } from 'antd'
import { LinkOutlined, DisconnectOutlined } from '@ant-design/icons'
import { useSelectionStore } from '../store/selectionStore'
import { useModelStore } from '../store/modelStore'
import { useUIStore } from '../store/uiStore'
import { useCommandManager } from '../utils/CommandManager'
import { BindVerticesCommand } from '../commands/BindVerticesCommand'
import { useRendererStore } from '../store/rendererStore'

const BoneBindingPanel: React.FC = () => {
    const renderer = useRendererStore(state => state.renderer)

    const { selectedVertexIds, mainMode, animationSubMode, selectedNodeIds, selectNodes } = useSelectionStore()
    const { modelData, nodes } = useModelStore()
    const { setShowNodeManager } = useUIStore()
    const { executeCommand } = useCommandManager()

    const boundBones = useMemo(() => {
        // Only calculate if in correct mode to save performance
        if (mainMode !== 'animation' || animationSubMode !== 'binding') return []

        if (!modelData || !modelData.Geosets || selectedVertexIds.length === 0) return []

        const boneMap = new Map<number, string>()

        selectedVertexIds.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (!geoset) return
            if (!geoset.VertexGroup || !geoset.Groups) return

            const matrixGroupIndex = geoset.VertexGroup[sel.index]
            if (matrixGroupIndex === undefined || matrixGroupIndex < 0 || matrixGroupIndex >= geoset.Groups.length) return

            const matrixGroup = geoset.Groups[matrixGroupIndex] as any
            const matrix = matrixGroup

            if (matrix && Array.isArray(matrix)) {
                matrix.forEach((nodeIndex: number) => {
                    const node = nodes.find(n => n.ObjectId === nodeIndex)
                    if (node) {
                        boneMap.set(nodeIndex, node.Name)
                    }
                })
            }
        })

        return Array.from(boneMap.entries()).map(([index, name]) => ({ index, name }))
    }, [modelData, nodes, selectedVertexIds, mainMode, animationSubMode])

    const handleDoubleClick = (nodeIndex: number) => {
        setShowNodeManager(true)
        selectNodes([nodeIndex])
    }

    const handleBind = (isBind: boolean) => {
        if (selectedNodeIds.length !== 1) {
            message.warning('请选择一个骨骼')
            return
        }
        if (selectedVertexIds.length === 0) {
            message.warning('请选择要绑定的顶点')
            return
        }

        if (!renderer) {
            console.error('Renderer not available')
            return
        }

        // Group vertices by geoset
        const targets = new Map<number, number[]>()

        // We use a Set to avoid duplicates if any (though selectedVertexIds should be unique)
        selectedVertexIds.forEach(v => {
            if (!targets.has(v.geosetIndex)) targets.set(v.geosetIndex, [])
            targets.get(v.geosetIndex)!.push(v.index)
        })

        const targetArr = Array.from(targets.entries()).map(([geosetIndex, vertexIndices]) => ({
            geosetIndex,
            vertexIndices
        }))

        const cmd = new BindVerticesCommand(
            renderer,
            targetArr,
            selectedNodeIds[0],
            isBind ? 'bind' : 'unbind'
        )
        executeCommand(cmd)
        message.success(isBind ? '已绑定骨骼' : '已解绑骨骼')
    }

    // Only show in Animation Mode -> Binding Submode
    if (mainMode !== 'animation' || animationSubMode !== 'binding') return null

    return (
        <div style={{
            position: 'absolute',
            right: 20,
            top: 120,
            width: 220,
            maxHeight: 500,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: 10,
            borderRadius: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 100,
            border: '1px solid #444',
            backdropFilter: 'blur(4px)'
        }}>
            <h4 style={{ margin: 0, fontSize: '14px', borderBottom: '1px solid #555', paddingBottom: 5, color: '#ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>绑定骨骼 ({boundBones.length})</span>
            </h4>

            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Tooltip title="将选中顶点绑定到当前选中的骨骼 (最多4个)">
                    <Button
                        size="small"
                        type="primary"
                        icon={<LinkOutlined />}
                        onClick={() => handleBind(true)}
                        disabled={selectedNodeIds.length !== 1 || selectedVertexIds.length === 0}
                    >
                        绑定
                    </Button>
                </Tooltip>
                <Tooltip title="解除选中顶点的骨骼绑定">
                    <Button
                        size="small"
                        danger
                        icon={<DisconnectOutlined />}
                        onClick={() => handleBind(false)}
                        disabled={selectedNodeIds.length !== 1 || selectedVertexIds.length === 0}
                    >
                        解绑
                    </Button>
                </Tooltip>
            </Space>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 50, maxHeight: 300 }}>
                {boundBones.length === 0 ? (
                    <div style={{ color: '#aaa', fontSize: '12px', textAlign: 'center', padding: '10px 0' }}>
                        未选择顶点或无绑定
                    </div>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {boundBones.map(bone => (
                            <li
                                key={bone.index}
                                onDoubleClick={() => handleDoubleClick(bone.index)}
                                onClick={() => selectNodes([bone.index])}
                                style={{
                                    padding: '6px 8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    backgroundColor: selectedNodeIds.includes(bone.index) ? 'rgba(255, 77, 79, 0.3)' : 'transparent',
                                    border: selectedNodeIds.includes(bone.index) ? '1px solid #ff4d4f' : '1px solid transparent',
                                    borderRadius: 2,
                                    marginBottom: 2,
                                    transition: 'all 0.2s',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                                onMouseEnter={(e) => {
                                    if (!selectedNodeIds.includes(bone.index)) {
                                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!selectedNodeIds.includes(bone.index)) {
                                        e.currentTarget.style.backgroundColor = 'transparent'
                                    }
                                }}
                            >
                                <span style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    backgroundColor: selectedNodeIds.includes(bone.index) ? '#ff4d4f' : '#52c41a',
                                    marginRight: 8,
                                    display: 'inline-block'
                                }} />
                                {bone.name}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}

export default BoneBindingPanel
