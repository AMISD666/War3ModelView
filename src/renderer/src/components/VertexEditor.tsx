import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MoveVerticesCommand, VertexChange } from '../commands/MoveVerticesCommand'
import { commandManager } from '../utils/CommandManager'
import { useModelStore } from '../store/modelStore'
import { type SelectionId, useSelectionStore } from '../store/selectionStore'
import { ConfigProvider, theme, Typography, Space, Row, Col, Tag, Divider } from 'antd'
import { SmartInputNumber } from './common/SmartInputNumber'
import { GatewayOutlined, AimOutlined, ExpandOutlined, SyncOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

interface VertexEditorProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: any
    onBeginUpdate?: () => void
}

type Vec3 = [number, number, number]

type SelectionStats = {
    count: number
    center: Vec3
}

const ZERO_VECTOR: Vec3 = [0, 0, 0]
const DISPLAY_DECIMALS = 5

const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: '64px',
    right: '24px',
    width: '280px',
    padding: '0',
    borderRadius: '12px',
    overflow: 'hidden',
    zIndex: 1000,
    background: '#1f1f1f',
    border: '1px solid #303030',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    pointerEvents: 'auto'
}

const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    background: '#262626',
    borderBottom: '1px solid #303030',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
}

const contentStyle: React.CSSProperties = {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
}

const footerStyle: React.CSSProperties = {
    padding: '8px 16px',
    background: '#262626',
    borderTop: '1px solid #303030',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
}

const sectionTitleStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.45)',
    marginBottom: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
}

function getGeometryModeLabel(mode: 'vertex' | 'face' | 'group'): string {
    if (mode === 'face') return '面'
    if (mode === 'group') return '组'
    return '点'
}

function getAxisColor(axis: 'x' | 'y' | 'z'): string {
    if (axis === 'x') return '#ff5d5f'
    if (axis === 'y') return '#52c41a'
    return '#3b82f6'
}

function vectorsEqual(a: Vec3 | null, b: Vec3 | null, epsilon = 0.000001): boolean {
    if (a === b) return true
    if (!a || !b) return false
    return Math.abs(a[0] - b[0]) < epsilon
        && Math.abs(a[1] - b[1]) < epsilon
        && Math.abs(a[2] - b[2]) < epsilon
}

function selectionStatsEqual(a: SelectionStats | null, b: SelectionStats | null): boolean {
    if (a === b) return true
    if (!a || !b) return false
    return a.count === b.count && vectorsEqual(a.center, b.center)
}

function formatDisplayValue(value: number): string {
    if (!Number.isFinite(value)) return '0'
    return Number(value.toFixed(DISPLAY_DECIMALS)).toString()
}

function getCoincidentVertexKey(vertices: Float32Array | number[], vertexIndex: number): string {
    const offset = vertexIndex * 3
    const round = (value: number) => Math.round(Number(value) * 10000) / 10000
    return `${round(vertices[offset])}|${round(vertices[offset + 1])}|${round(vertices[offset + 2])}`
}

function collectExpandedFaceVertices(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: any,
    selectedFaceIds: SelectionId[]
): SelectionId[] {
    const result: SelectionId[] = []
    const uniqueVertexKeys = new Set<string>()
    const positionKeysByGeoset = new Map<number, Set<string>>()

    for (const sel of selectedFaceIds) {
        const geoset = renderer?.model?.Geosets?.[sel.geosetIndex]
        if (!geoset?.Faces || !geoset?.Vertices) continue

        const faceOffset = sel.index * 3
        const faceVertexIndices = [
            geoset.Faces[faceOffset],
            geoset.Faces[faceOffset + 1],
            geoset.Faces[faceOffset + 2]
        ]

        for (const vertexIndex of faceVertexIndices) {
            if (!Number.isFinite(vertexIndex)) continue

            const uniqueKey = `${sel.geosetIndex}-${vertexIndex}`
            if (!uniqueVertexKeys.has(uniqueKey)) {
                uniqueVertexKeys.add(uniqueKey)
                result.push({ geosetIndex: sel.geosetIndex, index: vertexIndex })
            }

            let geosetPositionKeys = positionKeysByGeoset.get(sel.geosetIndex)
            if (!geosetPositionKeys) {
                geosetPositionKeys = new Set<string>()
                positionKeysByGeoset.set(sel.geosetIndex, geosetPositionKeys)
            }
            geosetPositionKeys.add(getCoincidentVertexKey(geoset.Vertices, vertexIndex))
        }
    }

    for (const [geosetIndex, positionKeys] of positionKeysByGeoset.entries()) {
        const geoset = renderer?.model?.Geosets?.[geosetIndex]
        if (!geoset?.Vertices) continue

        const vertexCount = Math.floor(geoset.Vertices.length / 3)
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
            const positionKey = getCoincidentVertexKey(geoset.Vertices, vertexIndex)
            if (!positionKeys.has(positionKey)) continue

            const uniqueKey = `${geosetIndex}-${vertexIndex}`
            if (uniqueVertexKeys.has(uniqueKey)) continue

            uniqueVertexKeys.add(uniqueKey)
            result.push({ geosetIndex, index: vertexIndex })
        }
    }

    return result
}

function computeSelectionStats(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: any,
    selections: SelectionId[]
): SelectionStats | null {
    if (!renderer || selections.length === 0) {
        return null
    }

    let sumX = 0
    let sumY = 0
    let sumZ = 0
    let validCount = 0

    for (const sel of selections) {
        const geoset = renderer.model?.Geosets?.[sel.geosetIndex]
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

    if (validCount === 0) {
        return null
    }

    return {
        count: validCount,
        center: [sumX / validCount, sumY / validCount, sumZ / validCount]
    }
}

export const VertexEditor: React.FC<VertexEditorProps> = ({ renderer, onBeginUpdate }) => {
    const cachedRenderer = useModelStore((state) => state.cachedRenderer)
    const selectedVertexIds = useSelectionStore((state) => state.selectedVertexIds)
    const selectedFaceIds = useSelectionStore((state) => state.selectedFaceIds)
    const geometrySubMode = useSelectionStore((state) => state.geometrySubMode)
    const mainMode = useSelectionStore((state) => state.mainMode)
    const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(null)
    const [centerPosition, setCenterPosition] = useState<Vec3 | null>(null)
    const [multiOffset, setMultiOffset] = useState<Vec3>(ZERO_VECTOR)
    const startCenterPosition = useRef<Vec3 | null>(null)
    const isEditingCenterInput = useRef(false)

    const activeRenderer = renderer ?? cachedRenderer
    const isGeometrySelectionMode = geometrySubMode === 'vertex' || geometrySubMode === 'face' || geometrySubMode === 'group'

    const effectiveSelections = useMemo<SelectionId[]>(() => {
        if (!activeRenderer || !isGeometrySelectionMode) {
            return []
        }

        if (geometrySubMode === 'vertex') {
            return selectedVertexIds
        }

        return collectExpandedFaceVertices(activeRenderer, selectedFaceIds)
    }, [activeRenderer, geometrySubMode, isGeometrySelectionMode, selectedFaceIds, selectedVertexIds])

    useEffect(() => {
        const hasSelection = mainMode === 'geometry' && isGeometrySelectionMode && effectiveSelections.length > 0
        if (!activeRenderer || !hasSelection) {
            setSelectionStats(null)
            setCenterPosition(null)
            setMultiOffset(ZERO_VECTOR)
            startCenterPosition.current = null
            return
        }

        let isCancelled = false
        let frameId = 0

        const syncSelectionStats = () => {
            if (isCancelled) return

            const nextStats = computeSelectionStats(activeRenderer, effectiveSelections)
            setSelectionStats((previousStats) => selectionStatsEqual(previousStats, nextStats) ? previousStats : nextStats)

            if (!isEditingCenterInput.current) {
                if (nextStats) {
                    const nextCenter: Vec3 = [...nextStats.center]
                    setCenterPosition((previousCenter) => vectorsEqual(previousCenter, nextCenter) ? previousCenter : nextCenter)
                    startCenterPosition.current = [...nextCenter]
                } else {
                    setCenterPosition(null)
                    startCenterPosition.current = null
                }
            }

            frameId = window.requestAnimationFrame(syncSelectionStats)
        }

        syncSelectionStats()

        return () => {
            isCancelled = true
            window.cancelAnimationFrame(frameId)
        }
    }, [activeRenderer, effectiveSelections, isGeometrySelectionMode, mainMode])

    const syncAffectedGeosetsToStore = (changes: VertexChange[]) => {
        const affectedGeosets = new Set(changes.map((change) => change.geosetIndex))
        affectedGeosets.forEach((index) => {
            const vertices = activeRenderer?.model?.Geosets?.[index]?.Vertices
            if (vertices) {
                useModelStore.getState().updateGeoset(index, { Vertices: Array.from(vertices) })
            }
        })
    }

    const buildSelectionChanges = (delta: Vec3): VertexChange[] => {
        if (!activeRenderer) return []

        const changes: VertexChange[] = []
        effectiveSelections.forEach((sel) => {
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
        })
    }

    if (mainMode !== 'geometry' || !isGeometrySelectionMode || effectiveSelections.length === 0) return null

    const modeLabel = getGeometryModeLabel(geometrySubMode)

    const renderAxisLabel = (axis: 'x' | 'y' | 'z') => (
        <Space size={8} style={{ width: '40px' }}>
            <span style={{
                width: '10px',
                height: '10px',
                borderRadius: '2px',
                backgroundColor: getAxisColor(axis),
                display: 'inline-block'
            }} />
            <Text strong style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.85)' }}>
                {axis.toUpperCase()}
            </Text>
        </Space>
    )

    const renderNumberInput = (
        value: number,
        onChange: (value: number | null) => void,
        onCommit: () => void,
        onFocus?: () => void,
        onBlur?: () => void
    ) => (
        <SmartInputNumber
            style={{ width: '100%' }}
            size="small"
            step="0.00001"
            precision={5}
            value={value}
            onChange={(val) => {
                onChange(val === null || val === undefined ? null : Number(val))
            }}
            onFocus={onFocus}
            onBlur={() => {
                onCommit()
                onBlur?.()
            }}
            onPressEnter={(e) => {
                ;(e.target as HTMLInputElement).blur()
            }}
        />
    )

    return (
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
            <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
                <div style={headerStyle}>
                    <Space direction="vertical" size={0}>
                        <Title level={5} style={{ margin: 0, fontSize: '14px' }}>
                            变换中心
                        </Title>
                        <Text type="secondary" style={{ fontSize: '11px' }}>
                            精确编辑选区坐标
                        </Text>
                    </Space>
                    <Tag bordered={false} color="blue" style={{ margin: 0, opacity: 0.8 }}>
                        <GatewayOutlined /> {modeLabel}模式
                    </Tag>
                </div>

                <div style={contentStyle}>
                    {centerPosition && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={sectionTitleStyle}>
                                <AimOutlined /> 中心点坐标
                            </div>
                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    {renderAxisLabel('x')}
                                    {renderNumberInput(
                                        centerPosition[0],
                                        (value) => handleCenterChange(0, value),
                                        handleCenterCommit,
                                        () => { isEditingCenterInput.current = true },
                                        () => { isEditingCenterInput.current = false }
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    {renderAxisLabel('y')}
                                    {renderNumberInput(
                                        centerPosition[1],
                                        (value) => handleCenterChange(1, value),
                                        handleCenterCommit,
                                        () => { isEditingCenterInput.current = true },
                                        () => { isEditingCenterInput.current = false }
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    {renderAxisLabel('z')}
                                    {renderNumberInput(
                                        centerPosition[2],
                                        (value) => handleCenterChange(2, value),
                                        handleCenterCommit,
                                        () => { isEditingCenterInput.current = true },
                                        () => { isEditingCenterInput.current = false }
                                    )}
                                </div>
                            </Space>
                        </div>
                    )}

                    <Divider style={{ margin: '4px 0', borderColor: 'rgba(255, 255, 255, 0.06)' }} />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={sectionTitleStyle}>
                            <ExpandOutlined /> 叠加位移
                        </div>
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {renderAxisLabel('x')}
                                {renderNumberInput(multiOffset[0], (value) => handleMultiOffsetChange(0, value), handleMultiCommit)}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {renderAxisLabel('y')}
                                {renderNumberInput(multiOffset[1], (value) => handleMultiOffsetChange(1, value), handleMultiCommit)}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {renderAxisLabel('z')}
                                {renderNumberInput(multiOffset[2], (value) => handleMultiOffsetChange(2, value), handleMultiCommit)}
                            </div>
                        </Space>
                    </div>
                </div>

                <div style={footerStyle}>
                    <Text type="secondary" style={{ fontSize: '11px' }}>
                        选中 <Text strong style={{ color: '#fff' }}>{selectionStats?.count ?? effectiveSelections.length}</Text> 个顶点
                    </Text>
                    <Tag icon={<SyncOutlined spin={false} />} color="success" bordered={false} style={{ margin: 0, fontSize: '10px' }}>
                        实时同步
                    </Tag>
                </div>
            </div>
        </ConfigProvider>
    )
}
