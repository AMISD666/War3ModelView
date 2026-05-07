import React, { useCallback, useRef, useState } from 'react'
import { Button, InputNumber, Spin, Typography } from 'antd'
import { FolderOpenOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { useRpcClient } from '../../hooks/useRpc'
import { useWindowEvent } from '../../hooks/useWindowEvent'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
import { desktopGateway } from '../../infrastructure/desktop'
import { showMessage } from '../../store/messageStore'

const { Text } = Typography

interface FbxBatchMergeModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
}

type FbxBatchMergeResultEvent = {
    requestId?: string
    ok: boolean
    sourceCount?: number
    sequenceCount?: number
    message?: string
}

const getFileName = (path: string): string => {
    const parts = path.replace(/\//g, '\\').split('\\')
    return parts[parts.length - 1] || path
}

const panelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 12,
    height: '100%',
    backgroundColor: '#1f1f1f',
}

const fieldRowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
}

const fieldStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
}

const listStyle: React.CSSProperties = {
    minHeight: 120,
    maxHeight: 220,
    overflowY: 'auto',
    backgroundColor: '#181818',
    border: '1px solid #333',
    borderRadius: 5,
    padding: 8,
}

const fileRowStyle: React.CSSProperties = {
    color: '#d8d8d8',
    fontSize: 12,
    lineHeight: '22px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
}

const FbxBatchMergeModal: React.FC<FbxBatchMergeModalProps> = ({
    visible,
    onClose,
    isStandalone = false,
}) => {
    const [paths, setPaths] = useState<string[]>([])
    const [startFrame, setStartFrame] = useState<number>(333)
    const [intervalFrame, setIntervalFrame] = useState<number>(2000)
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('')
    const pendingRequestIdRef = useRef<string | null>(null)
    const { emitCommand } = useRpcClient('fbxBatchMerge', {})

    useWindowEvent<FbxBatchMergeResultEvent>('fbxBatchMerge-result', (event) => {
        const result = event.payload
        if (result.requestId && result.requestId !== pendingRequestIdRef.current) return

        pendingRequestIdRef.current = null
        setBusy(false)
        if (!result.ok) {
            const message = result.message || '合并失败'
            setStatus(`合并失败：${message}`)
            if (isStandalone) {
                showMessage('error', '多 FBX 文件合并失败', message)
            }
            return
        }

        const message = result.message || `合并完成：${result.sourceCount ?? paths.length} 个 FBX，${result.sequenceCount ?? 0} 个动作序列`
        setStatus(message)
        if (isStandalone) {
            showMessage('success', '多 FBX 文件合并', message)
        }
    })

    const pickFiles = useCallback(async () => {
        const result = await desktopGateway.openFileDialog({
            title: '选择多个 FBX 文件',
            multiple: true,
            filters: [{ name: 'FBX', extensions: ['fbx'] }],
        })
        if (!result) return
        const selected = Array.isArray(result) ? result : [result]
        setPaths(selected.filter((path) => path.toLowerCase().endsWith('.fbx')))
        setStatus('')
    }, [])

    const handleMerge = useCallback(async () => {
        if (paths.length < 2) {
            showMessage('warning', '多 FBX 文件合并', '请选择至少 2 个 FBX 文件')
            return
        }

        setBusy(true)
        setStatus('正在合并 FBX 动作...')
        const requestId = Math.random().toString(36).substring(2, 11)
        pendingRequestIdRef.current = requestId
        emitCommand('EXECUTE_FBX_BATCH_MERGE', {
            requestId,
            paths,
            startFrame,
            intervalFrame,
        })
    }, [emitCommand, intervalFrame, paths, startFrame])

    const content = (
        <div style={panelStyle}>
            <Button icon={<FolderOpenOutlined />} onClick={pickFiles} disabled={busy}>
                选择 FBX 文件
            </Button>

            <div style={listStyle}>
                {paths.length === 0 ? (
                    <Text style={{ color: '#777', fontSize: 12 }}>未选择 FBX 文件</Text>
                ) : (
                    paths.map((path, index) => (
                        <div key={path} style={fileRowStyle} title={path}>
                            {index + 1}. {getFileName(path)}
                        </div>
                    ))
                )}
            </div>

            <div style={fieldRowStyle}>
                <label style={fieldStyle}>
                    <Text style={{ color: '#aaa', fontSize: 12 }}>开始帧</Text>
                    <InputNumber
                        value={startFrame}
                        onChange={(value) => setStartFrame(Number(value ?? 333))}
                        min={0}
                        step={1}
                        disabled={busy}
                        style={{ width: '100%' }}
                    />
                </label>
                <label style={fieldStyle}>
                    <Text style={{ color: '#aaa', fontSize: 12 }}>间隔帧</Text>
                    <InputNumber
                        value={intervalFrame}
                        onChange={(value) => setIntervalFrame(Number(value ?? 2000))}
                        min={1}
                        step={1}
                        disabled={busy}
                        style={{ width: '100%' }}
                    />
                </label>
            </div>

            <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleMerge}
                disabled={busy || paths.length < 2}
                loading={busy}
            >
                开始合并
            </Button>

            {status && (
                <Text style={{ color: status.startsWith('合并失败') ? '#ff7875' : '#bfbfbf', fontSize: 12 }}>
                    {busy && <Spin size="small" style={{ marginRight: 6 }} />}
                    {status}
                </Text>
            )}
        </div>
    )

    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="多 FBX 文件合并" onClose={onClose}>
                {content}
            </StandaloneWindowFrame>
        )
    }

    if (!visible) return null
    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
        }}>
            <div style={{ width: 420, height: 420, border: '1px solid #333' }}>
                {content}
            </div>
        </div>
    )
}

export default FbxBatchMergeModal
