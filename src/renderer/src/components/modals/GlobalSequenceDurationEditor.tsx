import React, { useState, useEffect } from 'react'
import { Button, InputNumber } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, emit } from '@tauri-apps/api/event'

const GlobalSequenceDurationEditor: React.FC = () => {
    const [index, setIndex] = useState<number>(0)
    const [duration, setDuration] = useState<number>(1000)
    const [callerId, setCallerId] = useState<string>('')
    const [sourceTabId, setSourceTabId] = useState<string | null>(null)
    const [sourceModelPath, setSourceModelPath] = useState<string | null>(null)

    useEffect(() => {
        const unlisten = listen('IPC_GLOBAL_SEQ_DURATION_INIT', (event) => {
            const payload = event.payload as any
            console.log('[GlobalSequenceDurationEditor] Received init payload:', payload);
            if (payload) {
                setIndex(payload.index ?? 0)
                setDuration(payload.duration ?? 1000)
                setCallerId(payload.callerId ?? '')
                setSourceTabId(payload.sourceTabId ?? null)
                setSourceModelPath(payload.sourceModelPath ?? null)
            }
        })

        return () => {
            unlisten.then(f => f())
        }
    }, [])

    const handleConfirm = () => {
        console.log('[GlobalSequenceDurationEditor] Emitting update:', { index, duration, callerId, sourceTabId, sourceModelPath });
        emit('IPC_GLOBAL_SEQUENCE_UPDATE', {
            index,
            duration,
            callerId,
            sourceTabId,
            sourceModelPath
        })
        getCurrentWindow().hide()
    }

    const handleCancel = () => {
        getCurrentWindow().hide()
    }

    return (
        <StandaloneWindowFrame
            title={`编辑全局序列 ${index} 对话框`}
            onClose={handleCancel}
        >
            <div style={{
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                backgroundColor: '#1e1e1e',
                height: '100%',
                color: '#e0e0e0',
                justifyContent: 'center'
            }}>
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                }}>
                    <div style={{ fontSize: '12px', color: '#888' }}>持续时间 (ms)</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <InputNumber
                            value={duration}
                            onChange={(val) => setDuration(val || 0)}
                            min={0}
                            step={100}
                            style={{
                                flex: 1,
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                backgroundColor: '#252525',
                                borderColor: '#4a4a4a',
                                color: '#fff'
                            }}
                            autoFocus
                            onPressEnter={handleConfirm}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                    <Button
                        onClick={handleCancel}
                        style={{
                            backgroundColor: 'transparent',
                            borderColor: '#4a4a4a',
                            color: '#aaa',
                            padding: '0 20px'
                        }}
                    >
                        取消
                    </Button>
                    <Button
                        type="primary"
                        icon={<CheckOutlined />}
                        onClick={handleConfirm}
                        style={{
                            padding: '0 24px',
                            fontWeight: 600
                        }}
                    >
                        确定
                    </Button>
                </div>
            </div>
        </StandaloneWindowFrame>
    )
}

export default GlobalSequenceDurationEditor
