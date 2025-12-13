import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useSelectionStore } from '../store/selectionStore'
import { InputNumber, Button, Tooltip, Divider } from 'antd'
import { commandManager } from '../utils/CommandManager'
import { MoveVerticesCommand, VertexChange } from '../commands/MoveVerticesCommand'
import { SplitVerticesCommand } from '../commands/SplitVerticesCommand'
import { WeldVerticesCommand } from '../commands/WeldVerticesCommand'
import { useModelStore } from '../store/modelStore'
import { SplitCellsOutlined, MergeCellsOutlined } from '@ant-design/icons'

interface VertexEditorProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: any
    onBeginUpdate?: () => void
}

export const VertexEditor: React.FC<VertexEditorProps> = ({ renderer, onBeginUpdate }) => {
    const { selectedVertexIds, geometrySubMode, mainMode } = useSelectionStore()
    const [position, setPosition] = useState<[number, number, number] | null>(null)
    const startPosition = useRef<[number, number, number] | null>(null)

    // Update position display when single vertex is selected
    useEffect(() => {
        if (!renderer || selectedVertexIds.length !== 1 || geometrySubMode !== 'vertex' || mainMode !== 'geometry') {
            setPosition(null)
            startPosition.current = null
            return
        }

        const sel = selectedVertexIds[0]
        const geoset = renderer.model.Geosets[sel.geosetIndex]
        if (geoset) {
            const vIndex = sel.index * 3
            const pos: [number, number, number] = [
                geoset.Vertices[vIndex],
                geoset.Vertices[vIndex + 1],
                geoset.Vertices[vIndex + 2]
            ]
            setPosition(pos)
            startPosition.current = [...pos]
        }
    }, [renderer, selectedVertexIds, geometrySubMode, mainMode])

    const handleChange = (index: number, value: number | null) => {
        if (value === null || !renderer || selectedVertexIds.length !== 1 || !position) return

        const newPos = [...position] as [number, number, number]
        newPos[index] = value
        setPosition(newPos)

        // Preview in renderer
        const sel = selectedVertexIds[0]
        const geoset = renderer.model.Geosets[sel.geosetIndex]
        if (geoset) {
            const vIndex = sel.index * 3
            geoset.Vertices[vIndex + index] = value
            if ((renderer as any).updateGeosetVertices) {
                (renderer as any).updateGeosetVertices(sel.geosetIndex, geoset.Vertices)
            }
        }
    }

    const handleCommit = () => {
        if (!renderer || selectedVertexIds.length !== 1 || !position || !startPosition.current) return

        // Check if changed
        if (
            position[0] === startPosition.current[0] &&
            position[1] === startPosition.current[1] &&
            position[2] === startPosition.current[2]
        ) {
            return
        }

        if (onBeginUpdate) onBeginUpdate()

        const sel = selectedVertexIds[0]
        const change: VertexChange = {
            geosetIndex: sel.geosetIndex,
            vertexIndex: sel.index,
            oldPos: startPosition.current,
            newPos: position
        }

        const cmd = new MoveVerticesCommand(
            renderer,
            [change],
            (syncedChanges) => {
                const affectedGeosets = new Set(syncedChanges.map(c => c.geosetIndex))
                affectedGeosets.forEach(index => {
                    const vertices = renderer.model.Geosets[index].Vertices
                    if (vertices) {
                        useModelStore.getState().updateGeoset(index, { Vertices: Array.from(vertices) })
                    }
                })
            }
        )
        commandManager.execute(cmd)

        // Update start position for next edit
        startPosition.current = [...position]
    }

    // Split selected vertices
    const handleSplit = useCallback(() => {
        if (!renderer || selectedVertexIds.length < 1) return

        if (onBeginUpdate) onBeginUpdate()

        const cmd = new SplitVerticesCommand(renderer, selectedVertexIds)
        commandManager.execute(cmd)

        console.log('[VertexEditor] Executed SplitVerticesCommand for', selectedVertexIds.length, 'vertices')
    }, [renderer, selectedVertexIds, onBeginUpdate])

    // Weld selected vertices
    const handleWeld = useCallback(() => {
        if (!renderer || selectedVertexIds.length < 2) return

        // Check all vertices are from the same geoset
        const geosetIndex = selectedVertexIds[0].geosetIndex
        const allSameGeoset = selectedVertexIds.every(s => s.geosetIndex === geosetIndex)
        if (!allSameGeoset) {
            console.warn('[VertexEditor] Cannot weld vertices from different geosets')
            return
        }

        if (onBeginUpdate) onBeginUpdate()

        const cmd = new WeldVerticesCommand(renderer, selectedVertexIds)
        commandManager.execute(cmd)

        console.log('[VertexEditor] Executed WeldVerticesCommand for', selectedVertexIds.length, 'vertices')
    }, [renderer, selectedVertexIds, onBeginUpdate])

    // Only show in geometry mode with vertex sub-mode when vertices are selected
    if (mainMode !== 'geometry' || geometrySubMode !== 'vertex' || selectedVertexIds.length === 0) return null

    const canSplit = selectedVertexIds.length >= 1
    const canWeld = selectedVertexIds.length >= 2 && selectedVertexIds.every(s => s.geosetIndex === selectedVertexIds[0].geosetIndex)

    return (
        <div style={{
            position: 'absolute',
            top: '60px',
            right: '20px',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            padding: '12px',
            borderRadius: '8px',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: 100,
            minWidth: '160px',
            border: '1px solid #434343'
        }}>
            {/* Position editing - only for single vertex */}
            {position && selectedVertexIds.length === 1 && (
                <>
                    <div style={{ fontSize: '12px', marginBottom: '2px', color: '#aaa' }}>顶点坐标</div>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                        <span style={{ color: '#ff4d4f', width: '15px' }}>X:</span>
                        <InputNumber
                            size="small"
                            value={position[0]}
                            onChange={(v) => handleChange(0, v)}
                            onBlur={handleCommit}
                            onPressEnter={handleCommit}
                            style={{ width: '80px', backgroundColor: '#1f1f1f', color: 'white', border: '1px solid #434343' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                        <span style={{ color: '#52c41a', width: '15px' }}>Y:</span>
                        <InputNumber
                            size="small"
                            value={position[1]}
                            onChange={(v) => handleChange(1, v)}
                            onBlur={handleCommit}
                            onPressEnter={handleCommit}
                            style={{ width: '80px', backgroundColor: '#1f1f1f', color: 'white', border: '1px solid #434343' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                        <span style={{ color: '#1890ff', width: '15px' }}>Z:</span>
                        <InputNumber
                            size="small"
                            value={position[2]}
                            onChange={(v) => handleChange(2, v)}
                            onBlur={handleCommit}
                            onPressEnter={handleCommit}
                            style={{ width: '80px', backgroundColor: '#1f1f1f', color: 'white', border: '1px solid #434343' }}
                        />
                    </div>
                    <Divider style={{ margin: '8px 0', borderColor: '#434343' }} />
                </>
            )}

            {/* Selection info */}
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>
                已选择 {selectedVertexIds.length} 个顶点
            </div>

            {/* Split/Weld buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
                <Tooltip title="分离顶点 - 为每个面创建独立的顶点副本">
                    <Button
                        size="small"
                        icon={<SplitCellsOutlined />}
                        onClick={handleSplit}
                        disabled={!canSplit}
                        style={{ flex: 1 }}
                    >
                        分离
                    </Button>
                </Tooltip>
                <Tooltip title="焊接顶点 - 将选中顶点合并到中心点">
                    <Button
                        size="small"
                        icon={<MergeCellsOutlined />}
                        onClick={handleWeld}
                        disabled={!canWeld}
                        style={{ flex: 1 }}
                    >
                        焊接
                    </Button>
                </Tooltip>
            </div>
        </div>
    )
}

