import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Divider } from 'antd'
import { MoveVerticesCommand, VertexChange } from '../commands/MoveVerticesCommand'
import { commandManager } from '../utils/CommandManager'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'

interface VertexEditorProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: any
    onBeginUpdate?: () => void
}

type Vec3 = [number, number, number]

const ZERO_VECTOR: Vec3 = [0, 0, 0]

const inputStyle: React.CSSProperties = {
    width: '96px',
    backgroundColor: '#1f1f1f',
    color: '#fff',
    border: '1px solid #434343',
    borderRadius: '6px',
    padding: '2px 8px',
    outline: 'none',
    appearance: 'textfield',
    MozAppearance: 'textfield' as any
}

export const VertexEditor: React.FC<VertexEditorProps> = ({ renderer, onBeginUpdate }) => {
    const selectedVertexIds = useSelectionStore((state) => state.selectedVertexIds)
    const geometrySubMode = useSelectionStore((state) => state.geometrySubMode)
    const mainMode = useSelectionStore((state) => state.mainMode)
    const [centerPosition, setCenterPosition] = useState<Vec3 | null>(null)
    const [multiOffset, setMultiOffset] = useState<Vec3>(ZERO_VECTOR)
    const startCenterPosition = useRef<Vec3 | null>(null)

    const activeRenderer = renderer ?? useModelStore.getState().cachedRenderer

    const selectionStats = useMemo(() => {
        if (!activeRenderer || !Array.isArray(selectedVertexIds) || selectedVertexIds.length === 0) {
            return null
        }

        let sumX = 0
        let sumY = 0
        let sumZ = 0
        let validCount = 0

        for (const sel of selectedVertexIds) {
            const geoset = activeRenderer.model?.Geosets?.[sel.geosetIndex]
            if (!geoset?.Vertices) continue
            const vertexOffset = sel.index * 3
            const x = geoset.Vertices[vertexOffset]
            const y = geoset.Vertices[vertexOffset + 1]
            const z = geoset.Vertices[vertexOffset + 2]
            if (![x, y, z].every(Number.isFinite)) continue
            sumX += x
            sumY += y
            sumZ += z
            validCount += 1
        }

        if (validCount === 0) return null

        return {
            count: validCount,
            center: [sumX / validCount, sumY / validCount, sumZ / validCount] as Vec3
        }
    }, [activeRenderer, selectedVertexIds])

    useEffect(() => {
        if (!activeRenderer || geometrySubMode !== 'vertex' || mainMode !== 'geometry' || selectedVertexIds.length === 0) {
            setCenterPosition(null)
            setMultiOffset(ZERO_VECTOR)
            startCenterPosition.current = null
            return
        }

        if (selectionStats) {
            const nextCenter: Vec3 = [...selectionStats.center]
            setCenterPosition(nextCenter)
            startCenterPosition.current = [...nextCenter]
        } else {
            setCenterPosition(null)
            startCenterPosition.current = null
        }
        setMultiOffset(ZERO_VECTOR)
    }, [activeRenderer, selectedVertexIds, geometrySubMode, mainMode, selectionStats])

    const buildSelectionChanges = (delta: Vec3): VertexChange[] => {
        if (!activeRenderer) return []

        const changes: VertexChange[] = []
        selectedVertexIds.forEach((sel) => {
            const geoset = activeRenderer.model?.Geosets?.[sel.geosetIndex]
            if (!geoset?.Vertices) return
            const vertexOffset = sel.index * 3
            const oldPos: Vec3 = [
                geoset.Vertices[vertexOffset] ?? 0,
                geoset.Vertices[vertexOffset + 1] ?? 0,
                geoset.Vertices[vertexOffset + 2] ?? 0
            ]
            const newPos: Vec3 = [
                oldPos[0] + delta[0],
                oldPos[1] + delta[1],
                oldPos[2] + delta[2]
            ]
            changes.push({
                geosetIndex: sel.geosetIndex,
                vertexIndex: sel.index,
                oldPos,
                newPos
            })
        })

        return changes
    }

    const executeSelectionMove = (delta: Vec3, afterCommit?: () => void) => {
        if (!activeRenderer) return
        if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return

        const changes = buildSelectionChanges(delta)
        if (changes.length === 0) return

        onBeginUpdate?.()
        const cmd = new MoveVerticesCommand(activeRenderer, changes, syncAffectedGeosetsToStore)
        commandManager.execute(cmd)
        afterCommit?.()
    }

    const handleCenterChange = (axis: number, value: number | null) => {
        if (value === null || !centerPosition) return
        const nextCenter = [...centerPosition] as Vec3
        nextCenter[axis] = value
        setCenterPosition(nextCenter)
    }

    const handleCenterCommit = () => {
        if (!centerPosition || !startCenterPosition.current) return

        const delta: Vec3 = [
            centerPosition[0] - startCenterPosition.current[0],
            centerPosition[1] - startCenterPosition.current[1],
            centerPosition[2] - startCenterPosition.current[2]
        ]

        executeSelectionMove(delta, () => {
            startCenterPosition.current = [...centerPosition]
        })
    }

    const handleMultiOffsetChange = (axis: number, value: number | null) => {
        if (value === null) return
        const nextOffset = [...multiOffset] as Vec3
        nextOffset[axis] = value
        setMultiOffset(nextOffset)
    }

    const handleMultiCommit = () => {
        executeSelectionMove(multiOffset, () => {
            setMultiOffset(ZERO_VECTOR)
            if (selectionStats) {
                const nextCenter: Vec3 = [
                    selectionStats.center[0] + multiOffset[0],
                    selectionStats.center[1] + multiOffset[1],
                    selectionStats.center[2] + multiOffset[2]
                ]
                setCenterPosition(nextCenter)
                startCenterPosition.current = [...nextCenter]
            }
        })
    }

    const syncAffectedGeosetsToStore = (changes: VertexChange[]) => {
        const affectedGeosets = new Set(changes.map((change) => change.geosetIndex))
        affectedGeosets.forEach((index) => {
            const vertices = activeRenderer?.model?.Geosets?.[index]?.Vertices
            if (vertices) {
                useModelStore.getState().updateGeoset(index, { Vertices: Array.from(vertices) })
            }
        })
    }

    if (mainMode !== 'geometry' || geometrySubMode !== 'vertex' || selectedVertexIds.length === 0) return null

    const renderNumberInput = (
        value: number,
        onChange: (value: number | null) => void,
        onCommit: () => void
    ) => (
        <input
            type="number"
            step="0.0001"
            value={Number.isFinite(value) ? value : 0}
            onChange={(event) => {
                const nextValue = event.target.value
                onChange(nextValue === '' ? null : Number(nextValue))
            }}
            onBlur={onCommit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    onCommit()
                }
            }}
            style={inputStyle}
            className="vertex-editor-number-input"
        />
    )

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
            minWidth: '180px',
            border: '1px solid #434343'
        }}>
            <style>{`
                .vertex-editor-number-input::-webkit-outer-spin-button,
                .vertex-editor-number-input::-webkit-inner-spin-button {
                    -webkit-appearance: none;
                    margin: 0;
                }
            `}</style>
            {centerPosition && (
                <>
                    <div style={{ fontSize: '12px', marginBottom: '2px', color: '#aaa' }}>中心点坐标</div>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                        <span style={{ color: '#ff4d4f', width: '15px' }}>X:</span>
                        {renderNumberInput(centerPosition[0], (value) => handleCenterChange(0, value), handleCenterCommit)}
                    </div>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                        <span style={{ color: '#52c41a', width: '15px' }}>Y:</span>
                        {renderNumberInput(centerPosition[1], (value) => handleCenterChange(1, value), handleCenterCommit)}
                    </div>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                        <span style={{ color: '#1890ff', width: '15px' }}>Z:</span>
                        {renderNumberInput(centerPosition[2], (value) => handleCenterChange(2, value), handleCenterCommit)}
                    </div>
                    <Divider style={{ margin: '8px 0', borderColor: '#434343' }} />
                </>
            )}

            <div style={{ fontSize: '12px', marginBottom: '2px', color: '#aaa' }}>叠加位移</div>
            {selectionStats && (
                <div style={{ fontSize: '11px', color: '#777', marginBottom: '4px' }}>
                    当前中心点 {`${selectionStats.center[0].toFixed(3)}, ${selectionStats.center[1].toFixed(3)}, ${selectionStats.center[2].toFixed(3)}`}
                </div>
            )}
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <span style={{ color: '#ff4d4f', width: '15px' }}>X:</span>
                {renderNumberInput(multiOffset[0], (value) => handleMultiOffsetChange(0, value), handleMultiCommit)}
            </div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <span style={{ color: '#52c41a', width: '15px' }}>Y:</span>
                {renderNumberInput(multiOffset[1], (value) => handleMultiOffsetChange(1, value), handleMultiCommit)}
            </div>
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <span style={{ color: '#1890ff', width: '15px' }}>Z:</span>
                {renderNumberInput(multiOffset[2], (value) => handleMultiOffsetChange(2, value), handleMultiCommit)}
            </div>
            <Divider style={{ margin: '8px 0', borderColor: '#434343' }} />

            <div style={{ fontSize: '11px', color: '#888' }}>
                已选择 {selectedVertexIds.length} 个顶点
            </div>
        </div>
    )
}
