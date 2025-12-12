import React, { useEffect, useState, useRef } from 'react'
import { ModelRenderer } from 'war3-model'
import { useSelectionStore } from '../store/selectionStore'
import { InputNumber } from 'antd'
import { commandManager } from '../utils/CommandManager'
import { MoveVerticesCommand, VertexChange } from '../commands/MoveVerticesCommand'
import { useModelStore } from '../store/modelStore'

interface VertexEditorProps {
    renderer: ModelRenderer | null
    onBeginUpdate?: () => void
}

export const VertexEditor: React.FC<VertexEditorProps> = ({ renderer, onBeginUpdate }) => {
    const { selectedVertexIds, geometrySubMode, mainMode } = useSelectionStore()
    const [position, setPosition] = useState<[number, number, number] | null>(null)
    const startPosition = useRef<[number, number, number] | null>(null)

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


    // Only show in geometry mode AND when single vertex is selected
    if (mainMode !== 'geometry' || !position) return null

    return (
        <div style={{
            position: 'absolute',
            top: '60px',
            right: '20px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            padding: '10px',
            borderRadius: '8px',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            zIndex: 100,
            minWidth: '140px'
        }}>
            <div style={{ fontSize: '12px', marginBottom: '2px' }}>顶点坐标</div>
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
        </div>
    )
}
