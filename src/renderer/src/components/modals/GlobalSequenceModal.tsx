import React, { useState, useEffect } from 'react'
import { Button, InputNumber } from 'antd'
import { PlusOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons'
import { useModelStore } from '../../store/modelStore'
import { useRpcClient } from '../../hooks/useRpc'
import { getCurrentWindow } from '@tauri-apps/api/window'

interface GlobalSequenceModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
    asWindow?: boolean
}

const GlobalSequenceModal: React.FC<GlobalSequenceModalProps> = ({
    visible,
    onClose,
    isStandalone,
}) => {
    const modelData = useModelStore(state => state.modelData)
    const setModelData = useModelStore(state => state.setModelData)
    const modelPath = useModelStore(state => state.modelPath)

    const { state: rpcState, emitCommand } = useRpcClient<{ globalSequences: number[] }>(
        'globalSequenceManager',
        { globalSequences: [] }
    )

    const storeGlobalSequences = (modelData as any)?.GlobalSequences as number[] || []
    const globalSequences: number[] = isStandalone ? (rpcState.globalSequences || []) : storeGlobalSequences

    const [localSeqs, setLocalSeqs] = useState<number[]>([])

    useEffect(() => {
        setLocalSeqs([...globalSequences])
    }, [JSON.stringify(globalSequences)])

    const saveChanges = (newSeqs: number[]) => {
        if (isStandalone) {
            emitCommand('EXECUTE_GLOBAL_SEQ_ACTION', { action: 'SAVE', globalSequences: newSeqs })
        } else {
            if (setModelData && modelData) {
                setModelData({ ...modelData, GlobalSequences: newSeqs } as any, modelPath)
            }
        }
    }

    const handleAdd = () => {
        const newSeqs = [...localSeqs, 1000]
        setLocalSeqs(newSeqs)
        saveChanges(newSeqs)
    }

    const handleDelete = (index: number) => {
        const newSeqs = localSeqs.filter((_, i) => i !== index)
        setLocalSeqs(newSeqs)
        saveChanges(newSeqs)
    }

    const handleValueChange = (index: number, val: number | null) => {
        if (val === null) return
        const newSeqs = [...localSeqs]
        newSeqs[index] = val
        setLocalSeqs(newSeqs)
        saveChanges(newSeqs)
    }

    if (!visible && !isStandalone) return null

    const BASE = '#1e1e1e'
    const PANEL = '#2c2c2c'
    const BORDER = '#3a3a3a'
    const ACCENT = '#5a9cff'
    const TEXT = '#e0e0e0'
    const MUTED = '#888'

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            backgroundColor: BASE,
            color: TEXT,
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '13px',
            overflow: 'hidden',
            userSelect: 'none',
        }}>
            {/* Header / Titlebar */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 12px',
                height: '36px',
                minHeight: '36px',
                backgroundColor: PANEL,
                borderBottom: `1px solid ${BORDER}`,
                flexShrink: 0,
            }}>
                <div data-tauri-drag-region style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center' }}>
                    <span data-tauri-drag-region style={{ fontWeight: 600, fontSize: '13px', letterSpacing: '0.3px' }}>
                        全局动作管理器
                    </span>
                </div>
                <Button
                    type="text"
                    size="small"
                    icon={<span style={{ fontSize: 14 }}>✕</span>}
                    onClick={() => isStandalone ? getCurrentWindow().hide() : onClose()}
                    style={{ color: '#888', width: 24, height: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                />
            </div>

            {/* List Header: Add button */}
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0, display: 'flex', justifyContent: 'flex-start' }}>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    size="small"
                    onClick={handleAdd}
                    style={{
                        backgroundColor: ACCENT,
                        borderColor: ACCENT,
                        height: '24px',
                        fontSize: '12px',
                    }}
                >
                    添加全局序列
                </Button>
            </div>

            {/* Body: Scrollable List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
                {localSeqs.length === 0 ? (
                    <div style={{
                        padding: '40px 20px',
                        textAlign: 'center',
                        color: MUTED,
                        fontSize: '12px',
                    }}>
                        暂无全局序列
                    </div>
                ) : (
                    localSeqs.map((duration, index) => (
                        <div
                            key={index}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 12px',
                                borderBottom: `1px solid ${BORDER}`,
                                transition: 'background 0.15s',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <span style={{ fontSize: '12px', color: MUTED, minWidth: '105px' }}>
                                GlobalSequence {index}
                            </span>

                            <InputNumber
                                value={duration}
                                onChange={(val) => handleValueChange(index, val)}
                                min={0}
                                step={100}
                                size="small"
                                style={{
                                    width: '80px',
                                    backgroundColor: '#151515',
                                    borderColor: '#333',
                                    color: TEXT,
                                }}
                                styles={{ input: { color: TEXT, textAlign: 'right' } }}
                            />

                            <span style={{ fontSize: '11px', color: MUTED, width: '22px' }}>ms</span>

                            <Button
                                type="text"
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={() => handleDelete(index)}
                                style={{
                                    color: '#ff6b6b',
                                    width: '24px',
                                    height: '24px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            />
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <div style={{
                padding: '6px 12px',
                backgroundColor: PANEL,
                borderTop: `1px solid ${BORDER}`,
                color: MUTED,
                fontSize: '11px',
                textAlign: 'right',
            }}>
                COUNT: {localSeqs.length}
            </div>
        </div>
    )
}

export default GlobalSequenceModal
