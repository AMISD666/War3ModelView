import React, { useState, useEffect, useRef } from 'react'
import { Button, InputNumber } from 'antd'
import { PlusOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons'
import { useModelStore } from '../../store/modelStore'
import { useRpcClient } from '../../hooks/useRpc'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
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
    const updateGlobalSequences = useModelStore(state => state.updateGlobalSequences)

    const { state: rpcState, emitCommand } = useRpcClient<{ globalSequences: number[] }>(
        'globalSequenceManager',
        { globalSequences: [] }
    )

    const storeGlobalSequences = useModelStore(state => ((state.modelData as any)?.GlobalSequences as number[]) || [])
    const globalSequences: number[] = isStandalone ? (rpcState.globalSequences || []) : storeGlobalSequences

    const [localSeqs, setLocalSeqs] = useState<number[]>([])
    const lastGlobalSeqSigRef = useRef('')

    useEffect(() => {
        const sig = JSON.stringify(globalSequences)
        if (sig === lastGlobalSeqSigRef.current) {
            return
        }
        lastGlobalSeqSigRef.current = sig
        setLocalSeqs([...globalSequences])
    }, [globalSequences])

    const saveChanges = (newSeqs: number[]) => {
        if (isStandalone) {
            emitCommand('EXECUTE_GLOBAL_SEQ_ACTION', { action: 'SAVE', globalSequences: newSeqs })
        } else {
            // Targeted patch — avoids full model reload and preserving animation state
            updateGlobalSequences(newSeqs)
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

    const innerContent = (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: isStandalone ? '100%' : '100vh',
            backgroundColor: BASE,
            color: TEXT,
            fontFamily: 'Segoe UI, sans-serif',
            fontSize: '13px',
            overflow: 'hidden',
            userSelect: 'none',
        }}>
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

    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="全局动作管理器" onClose={() => getCurrentWindow().hide()}>
                {innerContent}
            </StandaloneWindowFrame>
        );
    }

    return innerContent;
}

export default GlobalSequenceModal
