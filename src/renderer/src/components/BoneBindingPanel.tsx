import React, { useMemo } from 'react'
import { useSelectionStore } from '../store/selectionStore'
import { useModelStore } from '../store/modelStore'
import { useUIStore } from '../store/uiStore'

const BoneBindingPanel: React.FC = () => {
    const { selectedVertexIds, mainMode, animationSubMode, selectedNodeIds, selectNodes } = useSelectionStore()
    const { modelData, nodes } = useModelStore()
    const { setShowNodeManager } = useUIStore()

    const boundBones = useMemo(() => {
        // Only calculate if in correct mode to save performance, but ALWAYS call the hook
        if (mainMode !== 'animation' || animationSubMode !== 'binding') return []

        if (!modelData || !modelData.Geosets || selectedVertexIds.length === 0) return []

        const boneMap = new Map<number, string>()

        selectedVertexIds.forEach(sel => {
            const geoset = modelData.Geosets![sel.geosetIndex]
            if (!geoset) return

            // Safety checks for missing data
            if (!geoset.VertexGroup || !geoset.Groups) return

            const matrixGroupIndex = geoset.VertexGroup[sel.index]
            // Check if index is valid
            if (matrixGroupIndex === undefined || matrixGroupIndex < 0 || matrixGroupIndex >= geoset.Groups.length) return

            const matrixGroup = geoset.Groups[matrixGroupIndex] as any
            if (!matrixGroup) return

            // Handle both 'Matrix' (MDL) and 'matrices' (Type definition)
            // Groups is number[][] so matrixGroup is number[]
            const matrix = matrixGroup
            console.log('[BoneBindingPanel] Processing Vertex:', sel, 'GroupIndex:', matrixGroupIndex, 'Matrix:', matrix)

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

    // Only show in Animation Mode -> Binding Submode
    if (mainMode !== 'animation' || animationSubMode !== 'binding') return null

    return (
        <div style={{
            position: 'absolute',
            right: 20,
            top: 120,
            width: 200,
            maxHeight: 400,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: 10,
            borderRadius: 4,
            overflowY: 'auto',
            zIndex: 100,
            border: '1px solid #444',
            backdropFilter: 'blur(4px)'
        }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', borderBottom: '1px solid #555', paddingBottom: 5, color: '#ddd' }}>
                绑定骨骼 ({boundBones.length})
            </h4>
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
    )
}

export default BoneBindingPanel
