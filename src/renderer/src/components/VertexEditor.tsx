import React, { useEffect, useState } from 'react'
import { ModelRenderer } from 'war3-model'
import { useSelectionStore } from '../store/selectionStore'
import { InputNumber } from 'antd'

interface VertexEditorProps {
    renderer: ModelRenderer | null
}

export const VertexEditor: React.FC<VertexEditorProps> = ({ renderer }) => {
    const { selectedVertexIds, geometrySubMode, mainMode } = useSelectionStore()
    const [position, setPosition] = useState<[number, number, number] | null>(null)

    useEffect(() => {
        if (!renderer || selectedVertexIds.length !== 1 || geometrySubMode !== 'vertex' || mainMode !== 'geometry') {
            setPosition(null)
            return
        }

        const sel = selectedVertexIds[0]
        const geoset = renderer.model.Geosets[sel.geosetIndex]
        if (geoset) {
            const vIndex = sel.index * 3
            setPosition([
                geoset.Vertices[vIndex],
                geoset.Vertices[vIndex + 1],
                geoset.Vertices[vIndex + 2]
            ])
        }
    }, [renderer, selectedVertexIds, geometrySubMode, mainMode])

    const handleChange = (index: number, value: number | null) => {
        if (value === null || !renderer || selectedVertexIds.length !== 1) return

        const sel = selectedVertexIds[0]
        const geoset = renderer.model.Geosets[sel.geosetIndex]
        if (geoset) {
            const vIndex = sel.index * 3
            const newPos = [...(position || [0, 0, 0])] as [number, number, number]
            newPos[index] = value
            setPosition(newPos)

            // Update Model
            geoset.Vertices[vIndex + index] = value

            if ((renderer as any).updateGeosetVertices) {
                (renderer as any).updateGeosetVertices(sel.geosetIndex, geoset.Vertices)
            }
        }
    }

    if (!position) return null

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
            gap: '5px',
            zIndex: 100
        }}>
            <div style={{ fontSize: '12px', marginBottom: '5px' }}>顶点坐标</div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <span style={{ color: '#ff4d4f', width: '15px' }}>X:</span>
                <InputNumber
                    size="small"
                    value={position[0]}
                    onChange={(v) => handleChange(0, v)}
                    style={{ width: '80px', backgroundColor: '#1f1f1f', color: 'white', border: '1px solid #434343' }}
                />
            </div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <span style={{ color: '#52c41a', width: '15px' }}>Y:</span>
                <InputNumber
                    size="small"
                    value={position[1]}
                    onChange={(v) => handleChange(1, v)}
                    style={{ width: '80px', backgroundColor: '#1f1f1f', color: 'white', border: '1px solid #434343' }}
                />
            </div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <span style={{ color: '#1890ff', width: '15px' }}>Z:</span>
                <InputNumber
                    size="small"
                    value={position[2]}
                    onChange={(v) => handleChange(2, v)}
                    style={{ width: '80px', backgroundColor: '#1f1f1f', color: 'white', border: '1px solid #434343' }}
                />
            </div>
        </div>
    )
}
