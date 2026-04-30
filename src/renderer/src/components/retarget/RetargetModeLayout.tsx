import React, { useMemo, useState } from 'react'
import { Button, Radio, Select, Tooltip } from 'antd'
import { CopyOutlined, InsertRowRightOutlined, SwapOutlined } from '@ant-design/icons'
import {
    retargetAnimationService,
    type RetargetModelSnapshot,
    type RetargetSequenceCopyRange,
    type RetargetSequenceReplaceMode,
} from '../../application/retarget'
import { useModelStore } from '../../store/modelStore'
import { showMessage } from '../../store/messageStore'
import type { ModelNode } from '../../types/node'
import RetargetModelViewport3D from './RetargetModelViewport3D'

type PanelId = 'A' | 'B'

interface RetargetModeLayoutProps {
    onSaveTarget: () => boolean | Promise<boolean>
    onExportTargetMDL: () => void | Promise<void>
    onExportTargetMDX: () => void | Promise<void>
}

const getDisplayName = (path: string | null): string => {
    if (!path) return '未打开模型'
    return path.split(/[\\/]/).pop() || path
}

const getNodeLabel = (node: ModelNode): string => {
    const name = (node as any).Name || `Object ${node.ObjectId}`
    return `${name} #${node.ObjectId}`
}

const readSequenceInterval = (sequence: unknown): [number, number] | null => {
    const interval = (sequence as any)?.Interval
    if (!interval || typeof interval.length !== 'number' || interval.length < 2) return null
    const start = Number(interval[0])
    const end = Number(interval[1])
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
    return [start, end]
}

const getModelName = (snapshot: RetargetModelSnapshot): string => {
    const modelName = (snapshot.modelData as any)?.Model?.Name
    if (typeof modelName === 'string' && modelName.trim()) return modelName.trim()
    const displayName = getDisplayName(snapshot.path)
    return displayName.replace(/\.(mdx|mdl)$/i, '')
}

const toolbarGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
}

const toolbarDividerStyle: React.CSSProperties = {
    width: 1,
    height: 22,
    background: '#3a3a3a',
    margin: '0 6px',
    flex: '0 0 auto',
}

const singleSequenceGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginLeft: 18,
}

export const RetargetModeLayout: React.FC<RetargetModeLayoutProps> = ({
    onSaveTarget,
    onExportTargetMDL,
    onExportTargetMDX,
}) => {
    const targetModelData = useModelStore((state) => state.modelData)
    const targetModelPath = useModelStore((state) => state.modelPath)
    const targetNodes = useModelStore((state) => state.nodes)
    const [source, setSource] = useState<RetargetModelSnapshot | null>(null)
    const [copyEnabled, setCopyEnabled] = useState(false)
    const [selectedSourceNodeId, setSelectedSourceNodeId] = useState<number | null>(null)
    const [selectedTargetNodeId, setSelectedTargetNodeId] = useState<number | null>(null)
    const [openingSource, setOpeningSource] = useState(false)
    const [openingTarget, setOpeningTarget] = useState(false)
    const [savingTarget, setSavingTarget] = useState(false)
    const [replacingSequences, setReplacingSequences] = useState(false)
    const [replacingSingleSequence, setReplacingSingleSequence] = useState(false)
    const [sequenceReplaceMode, setSequenceReplaceMode] = useState<RetargetSequenceReplaceMode>('smart')
    const [selectedSourceSequenceIndex, setSelectedSourceSequenceIndex] = useState<number | null>(null)
    const [manualSequenceRange, setManualSequenceRange] = useState<RetargetSequenceCopyRange | null>(null)

    const selectedSourceNode = useMemo(
        () => source?.nodes.find((node) => node.ObjectId === selectedSourceNodeId) ?? null,
        [source, selectedSourceNodeId]
    )

    const sourceSequenceOptions = useMemo(() => {
        const sequences = Array.isArray((source?.modelData as any)?.Sequences) ? (source?.modelData as any).Sequences : []
        return sequences.map((sequence: any, index: number) => {
            const interval = readSequenceInterval(sequence)
            const name = String(sequence?.Name ?? `Sequence ${index + 1}`)
            return {
                value: index,
                label: interval ? `${name} (${interval[0]}-${interval[1]})` : name,
            }
        })
    }, [source])

    const handleOpenSource = async () => {
        setOpeningSource(true)
        try {
            const snapshot = await retargetAnimationService.openSourceFromDialog()
            if (!snapshot) return
            setSource(snapshot)
            setSelectedSourceNodeId(null)
            setManualSequenceRange(null)
            setSelectedSourceSequenceIndex(Array.isArray((snapshot.modelData as any)?.Sequences) && (snapshot.modelData as any).Sequences.length > 0 ? 0 : null)
            showMessage('success', '套动作模式', `A 区已打开: ${getDisplayName(snapshot.path)}`)
        } catch (error) {
            showMessage('error', '打开 A 区模型失败', error instanceof Error ? error.message : String(error))
        } finally {
            setOpeningSource(false)
        }
    }

    const handleOpenTarget = async () => {
        setOpeningTarget(true)
        try {
            const snapshot = await retargetAnimationService.openTargetFromDialog()
            if (!snapshot) return
            setSelectedTargetNodeId(null)
            setManualSequenceRange(null)
            showMessage('success', '套动作模式', `B 区已打开: ${getDisplayName(snapshot.path)}`)
        } catch (error) {
            showMessage('error', '打开 B 区模型失败', error instanceof Error ? error.message : String(error))
        } finally {
            setOpeningTarget(false)
        }
    }

    const handleSelectSourceNode = (node: ModelNode) => {
        setSelectedSourceNodeId(node.ObjectId)
        if (copyEnabled) {
            showMessage('info', '已选择 A 区节点', getNodeLabel(node))
        }
    }

    const handleSelectTargetNode = (node: ModelNode) => {
        setSelectedTargetNodeId(node.ObjectId)
        if (!copyEnabled) return
        if (!source || !selectedSourceNode || !targetModelData) {
            showMessage('warning', '套动作模式', '请先打开 A/B 模型，并在 A 区选择一个节点')
            return
        }

        try {
            const result = retargetAnimationService.copyNodeData({
                sourceModelData: source.modelData,
                sourceNode: selectedSourceNode,
                targetModelData,
                targetNode: node,
                sequenceRange: manualSequenceRange,
            })
            showMessage(
                'success',
                '节点数据已复制',
                manualSequenceRange
                    ? `${getNodeLabel(selectedSourceNode)} -> ${getNodeLabel(node)}，已复制到 ${manualSequenceRange.targetInterval[0]}-${manualSequenceRange.targetInterval[1]}`
                    : `${getNodeLabel(selectedSourceNode)} -> ${getNodeLabel(node)}，字段 ${result.copiedFields.length} 个`
            )
        } catch (error) {
            showMessage('error', '复制节点数据失败', error instanceof Error ? error.message : String(error))
        }
    }

    const handleReplaceSequences = () => {
        if (!source || !targetModelData) {
            showMessage('warning', '套动作模式', '请先打开 A/B 模型')
            return
        }
        setReplacingSequences(true)
        try {
            const result = retargetAnimationService.replaceTargetSequences({
                sourceModelData: source.modelData,
                targetModelData,
                mode: sequenceReplaceMode,
            })
            if (sequenceReplaceMode === 'manual') {
                showMessage('success', '手动模式', `已替换 ${result.sequenceCount} 个动作序列范围，未修改动画轨道`)
            } else {
                showMessage('success', '智能模式', `已替换 ${result.sequenceCount} 个动作序列，并同步 ${result.copiedTrackCount} 个匹配动画轨道`)
            }
        } catch (error) {
            showMessage('error', '替换动作序列失败', error instanceof Error ? error.message : String(error))
        } finally {
            setReplacingSequences(false)
        }
    }

    const handleReplaceSingleSequence = () => {
        if (!source || !targetModelData) {
            showMessage('warning', '套动作模式', '请先打开 A/B 模型')
            return
        }
        if (selectedSourceSequenceIndex === null) {
            showMessage('warning', '单动作替换', '请先在 A 区选择一个动作')
            return
        }
        setReplacingSingleSequence(true)
        try {
            const result = retargetAnimationService.replaceTargetSingleSequence({
                sourceModelData: source.modelData,
                targetModelData,
                sourceSequenceIndex: selectedSourceSequenceIndex,
                sourceModelName: getModelName(source),
                mode: sequenceReplaceMode,
            })
            if (sequenceReplaceMode === 'manual') {
                setManualSequenceRange({
                    sourceInterval: result.sourceInterval,
                    targetInterval: result.targetInterval,
                })
                setCopyEnabled(true)
                showMessage(
                    'success',
                    '手动模式',
                    `已新增 ${result.newSequenceName}（${result.targetInterval[0]}-${result.targetInterval[1]}），请手动选择 A/B 节点复制`
                )
            } else {
                setManualSequenceRange(null)
                showMessage(
                    'success',
                    '智能模式',
                    `已新增 ${result.newSequenceName}（${result.targetInterval[0]}-${result.targetInterval[1]}），并同步 ${result.copiedTrackCount} 个关键帧`
                )
            }
        } catch (error) {
            showMessage('error', '单动作替换失败', error instanceof Error ? error.message : String(error))
        } finally {
            setReplacingSingleSequence(false)
        }
    }

    const runTargetFileAction = async (action: () => void | boolean | Promise<void | boolean>) => {
        if (!targetModelData) {
            showMessage('warning', '套动作模式', '请先打开 B 区模型')
            return
        }
        setSavingTarget(true)
        try {
            await action()
        } finally {
            setSavingTarget(false)
        }
    }

    const renderPanel = (panel: PanelId) => {
        const isSource = panel === 'A'
        const nodes = isSource ? source?.nodes ?? [] : targetNodes
        const selectedId = isSource ? selectedSourceNodeId : selectedTargetNodeId
        const canWriteTarget = !isSource && !!targetModelData
        return (
            <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: isSource ? '1px solid #333' : 0 }}>
                <div style={{ height: 42, borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', background: '#202020' }}>
                    <strong style={{ fontSize: 15 }}>{panel} 区</strong>
                    <span style={{ color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {getDisplayName(isSource ? source?.path ?? null : targetModelPath)}
                    </span>
                    <Button size="small" onClick={isSource ? handleOpenSource : handleOpenTarget} loading={isSource ? openingSource : openingTarget}>
                        打开模型
                    </Button>
                    {!isSource && (
                        <>
                            <Button size="small" onClick={() => void runTargetFileAction(onSaveTarget)} disabled={!canWriteTarget} loading={savingTarget}>
                                保存
                            </Button>
                            <Button size="small" onClick={() => void runTargetFileAction(onExportTargetMDL)} disabled={!canWriteTarget || savingTarget}>
                                导出 MDL
                            </Button>
                            <Button size="small" onClick={() => void runTargetFileAction(onExportTargetMDX)} disabled={!canWriteTarget || savingTarget}>
                                导出 MDX
                            </Button>
                        </>
                    )}
                </div>
                <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                    <RetargetModelViewport3D
                        label={panel}
                        modelPath={isSource ? source?.path ?? null : targetModelPath}
                        modelData={isSource ? source?.modelData : targetModelData}
                        nodes={nodes}
                        selectedNodeId={selectedId}
                        onSelectNode={isSource ? handleSelectSourceNode : handleSelectTargetNode}
                    />
                </div>
            </section>
        )
    }

    return (
        <div style={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: '#181818', color: '#eee', overflow: 'hidden' }}>
            <div style={{ height: 38, borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', background: '#242424' }}>
                <div style={toolbarGroupStyle}>
                    <Tooltip title="开启后，先点 A 区节点，再点 B 区节点，复制动态关键帧和质心点数据。">
                        <Button
                            size="small"
                            type={copyEnabled ? 'primary' : 'default'}
                            icon={<CopyOutlined />}
                            onClick={() => setCopyEnabled(!copyEnabled)}
                            aria-label="复制节点数据"
                        />
                    </Tooltip>
                </div>
                <span style={toolbarDividerStyle} />
                <div style={toolbarGroupStyle}>
                    <Radio.Group
                        size="small"
                        value={sequenceReplaceMode}
                        onChange={(event) => setSequenceReplaceMode(event.target.value)}
                        optionType="button"
                        buttonStyle="solid"
                        options={[
                            { label: '智能', value: 'smart' },
                            { label: '手动', value: 'manual' },
                        ]}
                    />
                    <Tooltip title={sequenceReplaceMode === 'manual' ? '只替换动作序列范围，不修改动画轨道。' : '按同名骨骼/节点匹配并同步动画轨道。'}>
                        <Button
                            className="retarget-sequence-replace-button"
                            size="small"
                            icon={<SwapOutlined />}
                            onClick={handleReplaceSequences}
                            disabled={!source || !targetModelData}
                            loading={replacingSequences}
                            aria-label="替换动作序列"
                        />
                    </Tooltip>
                    <div style={singleSequenceGroupStyle}>
                        <Tooltip title={sequenceReplaceMode === 'manual' ? '按 A 区选中动作给 B 区新增动作序列，随后手动选择节点复制到新范围。' : '按 A 区选中动作给 B 区新增动作序列，并自动复制同名节点在该动作范围内的关键帧。'}>
                            <Button
                                className="retarget-sequence-replace-button"
                                size="small"
                                icon={<InsertRowRightOutlined />}
                                onClick={handleReplaceSingleSequence}
                                disabled={!source || !targetModelData || selectedSourceSequenceIndex === null}
                                loading={replacingSingleSequence}
                                aria-label="单动作替换"
                            />
                        </Tooltip>
                        <Select
                            size="small"
                            value={selectedSourceSequenceIndex ?? undefined}
                            options={sourceSequenceOptions}
                            onChange={(value) => {
                                setSelectedSourceSequenceIndex(value)
                                setManualSequenceRange(null)
                            }}
                            disabled={!source || sourceSequenceOptions.length === 0}
                            placeholder="A 区动作"
                            style={{ width: 220 }}
                            popupClassName="dark-theme-select-dropdown"
                        />
                    </div>
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                {renderPanel('A')}
                {renderPanel('B')}
            </div>
        </div>
    )
}

export default RetargetModeLayout
