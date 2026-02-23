import React, { useState, useEffect, useRef } from 'react'
import { Modal, Input, Button, message, Spin, Alert, Divider } from 'antd'
import { CopyOutlined, CheckCircleOutlined, ExclamationCircleOutlined, RightOutlined, DownOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'

interface ActivationStatus {
    is_activated: boolean
    license_type: string
    expiration_date: string | null
    days_remaining: number | null
    error: string | null
}

interface ActivationModalProps {
    open: boolean
    onActivated: () => void
}

const QQ_GROUP_ID = '168886891'
const QQ_POLLING_TIMEOUT_MS = 2 * 60 * 1000

const ActivationModal: React.FC<ActivationModalProps> = ({ open, onActivated }) => {
    const [machineId, setMachineId] = useState<string>('')
    const [licenseCode, setLicenseCode] = useState<string>('')
    const [loading, setLoading] = useState<boolean>(false)
    const [qqWindowLoading, setQqWindowLoading] = useState<boolean>(false)
    const [qqPolling, setQqPolling] = useState<boolean>(false)
    const [machineIdLoading, setMachineIdLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState<boolean>(false)
    const [showLicenseSection, setShowLicenseSection] = useState<boolean>(false)
    const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const pollingStartMsRef = useRef<number>(0)

    const closeQqWindow = async () => {
        try {
            await invoke('close_qq_verification_window')
        } catch {
            // Ignore close errors from already-closed window.
        }
    }

    const stopPolling = (closeWindow: boolean = false) => {
        if (pollingTimerRef.current) {
            clearInterval(pollingTimerRef.current)
            pollingTimerRef.current = null
        }
        pollingStartMsRef.current = 0
        setQqPolling(false)
        if (closeWindow) {
            void closeQqWindow()
        }
    }

    useEffect(() => {
        if (open) {
            loadMachineId()
        } else {
            stopPolling(true)
        }

        return () => stopPolling(true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const loadMachineId = async () => {
        setMachineIdLoading(true)
        try {
            const mid = await invoke<string>('get_machine_id')
            setMachineId(mid)
        } catch (e: any) {
            setError('\u65e0\u6cd5\u83b7\u53d6\u673a\u5668\u7801: ' + (e?.message || e))
        } finally {
            setMachineIdLoading(false)
        }
    }

    const startPolling = () => {
        stopPolling(false)
        setQqPolling(true)
        pollingStartMsRef.current = Date.now()

        pollingTimerRef.current = setInterval(async () => {
            try {
                if (pollingStartMsRef.current > 0 && (Date.now() - pollingStartMsRef.current) > QQ_POLLING_TIMEOUT_MS) {
                    stopPolling(false)
                    setError('\u9a8c\u8bc1\u7b49\u5f85\u8d85\u65f6\uff0c\u8bf7\u70b9\u51fb\u300c\u91cd\u65b0\u6253\u5f00QQ\u9a8c\u8bc1\u300d\u91cd\u8bd5')
                    return
                }
                const verified = await invoke<boolean>('check_qq_verification_window_status')
                if (verified) {
                    stopPolling(false)
                    message.success('\u0051\u0051\u7fa4\u6210\u5458\u9a8c\u8bc1\u6210\u529f\uff0c\u5df2\u6fc0\u6d3b\u57fa\u7840\u7248\uff08180\u5929\u6709\u6548\uff09')
                    onActivated()
                }
            } catch (e: any) {
                stopPolling(false)
                setError(typeof e === 'string' ? e : (e?.message || '\u0051\u0051\u7fa4\u9a8c\u8bc1\u72b6\u6001\u68c0\u67e5\u5931\u8d25'))
            }
        }, 2000)
    }

    const handleOpenQqVerification = async () => {
        setQqWindowLoading(true)
        setError(null)
        try {
            await invoke('open_qq_verification_window')
            startPolling()
            message.info('\u8bf7\u5728\u5f39\u51fa\u7684\u0051\u0051\u9875\u9762\u5b8c\u6210\u767b\u5f55\uff0c\u5e76\u786e\u8ba4\u4f60\u5728\u6307\u5b9a\u0051\u0051\u7fa4\u5185')
        } catch (e: any) {
            setError(typeof e === 'string' ? e : (e?.message || '\u6253\u5f00\u0051\u0051\u7fa4\u9a8c\u8bc1\u7a97\u53e3\u5931\u8d25'))
        } finally {
            setQqWindowLoading(false)
        }
    }

    const handleCancelQqVerification = async () => {
        stopPolling(true)
        message.info('\u5df2\u53d6\u6d88\u0051\u0051\u7fa4\u9a8c\u8bc1')
    }

    const handleCopyMachineId = () => {
        navigator.clipboard.writeText(machineId)
        setCopied(true)
        message.success('\u673a\u5668\u7801\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f')
        setTimeout(() => setCopied(false), 2000)
    }

    const handleActivate = async () => {
        if (!licenseCode.trim()) {
            setError('\u8bf7\u8f93\u5165\u6fc0\u6d3b\u7801')
            return
        }

        setLoading(true)
        setError(null)

        try {
            const result = await invoke<ActivationStatus>('activate_software', {
                licenseCode: licenseCode.trim()
            })

            if (result.is_activated) {
                message.success('\u8f6f\u4ef6\u6fc0\u6d3b\u6210\u529f!')
                onActivated()
            } else {
                setError(result.error || '\u6fc0\u6d3b\u5931\u8d25')
            }
        } catch (e: any) {
            setError(typeof e === 'string' ? e : (e?.message || '\u6fc0\u6d3b\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6fc0\u6d3b\u7801\u662f\u5426\u6b63\u786e'))
        } finally {
            setLoading(false)
        }
    }

    const darkInputStyle: React.CSSProperties = {
        backgroundColor: '#2a2a2a',
        border: '1px solid #555',
        color: '#eee',
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace"
    }

    return (
        <Modal
            open={open}
            title={null}
            footer={null}
            closable={false}
            maskClosable={false}
            keyboard={false}
            centered
            width={520}
            styles={{
                content: {
                    backgroundColor: '#333',
                    border: '1px solid #555',
                    borderRadius: '8px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.6)'
                },
                body: { padding: '28px' },
                mask: { backgroundColor: 'rgba(0, 0, 0, 0.85)' }
            }}
        >
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <h2 style={{
                    color: '#eee',
                    margin: 0,
                    marginBottom: 8,
                    fontSize: '22px',
                    fontWeight: 500
                }}>
                    {'\u5495\u5495War3\u6a21\u578b\u7f16\u8f91\u5668'}
                </h2>
                <span style={{ color: '#888', fontSize: '13px' }}>
                    {'\u8f6f\u4ef6\u672a\u6fc0\u6d3b\uff0c\u8bf7\u4f7f\u7528\u6fc0\u6d3b\u7801\u6216\u0051\u0051\u7fa4\u6210\u5458\u9a8c\u8bc1'}
                </span>
            </div>

            <div style={{
                marginBottom: 20,
                padding: '14px',
                borderRadius: 6,
                border: '1px solid #3f3f3f',
                backgroundColor: '#2a2a2a'
            }}>
                <div style={{ color: '#ccc', marginBottom: 8, fontSize: '13px', fontWeight: 500 }}>
                    {'\u0051\u0051\u7fa4\u6210\u5458\u9a8c\u8bc1\uff08\u57fa\u7840\u7248\uff09'}
                </div>
                <div style={{ color: '#999', fontSize: '12px', lineHeight: 1.6, marginBottom: 10 }}>
                    {'\u6307\u5b9a\u7fa4\u53f7\uff1a'}{QQ_GROUP_ID}
                    <br />
                    {'\u901a\u8fc7\u9a8c\u8bc1\u540e\u53ef\u6fc0\u6d3b\u57fa\u7840\u7248\uff0c\u9700\u6bcf\u534a\u5e74\u91cd\u65b0\u9a8c\u8bc1\u4e00\u6b21\u3002'}
                </div>
                <Button
                    block
                    onClick={handleOpenQqVerification}
                    loading={qqWindowLoading || qqPolling}
                    style={{
                        backgroundColor: '#1f3b53',
                        borderColor: '#2f5f86',
                        color: '#d7ebff'
                    }}
                >
                    {qqPolling
                        ? '\u9a8c\u8bc1\u4e2d\uff08\u6bcf2\u79d2\u81ea\u52a8\u68c0\u67e5\uff09...'
                        : '\u6253\u5f00\u0051\u0051\u7fa4\u9a8c\u8bc1'}
                </Button>
                {qqPolling && (
                    <Button
                        block
                        onClick={handleCancelQqVerification}
                        style={{
                            marginTop: 8,
                            backgroundColor: '#3f3f3f',
                            borderColor: '#666',
                            color: '#ddd'
                        }}
                    >
                        {'\u53d6\u6d88\u5e76\u5173\u95ed\u9a8c\u8bc1\u7a97\u53e3'}
                    </Button>
                )}
            </div>

            <div style={{ textAlign: 'center', margin: '8px 0' }}>
                <Button
                    type="link"
                    onClick={() => setShowLicenseSection(!showLicenseSection)}
                    style={{ color: '#888', fontSize: '13px' }}
                    icon={showLicenseSection ? <DownOutlined /> : <RightOutlined />}
                >
                    {showLicenseSection ? '\u6536\u8d77\u6fc0\u6d3b\u7801\u6fc0\u6d3b' : '\u4f7f\u7528\u6fc0\u6d3b\u7801\u6fc0\u6d3b'}
                </Button>
            </div>

            {showLicenseSection && (
                <>
                    <Divider style={{ margin: '16px 0', borderColor: '#4a4a4a' }} />

                    <div style={{ marginBottom: 20 }}>
                        <div style={{ color: '#ccc', marginBottom: 8, fontSize: '13px', fontWeight: 500 }}>
                            {'\u60a8\u7684\u673a\u5668\u7801'}
                        </div>
                        {machineIdLoading ? (
                            <div style={{ textAlign: 'center', padding: 16 }}>
                                <Spin size="small" />
                                <span style={{ color: '#888', marginLeft: 8 }}>
                                    {'\u6b63\u5728\u83b7\u53d6\u673a\u5668\u7801...'}
                                </span>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', gap: 8 }}>
                                <Input
                                    value={machineId}
                                    readOnly
                                    style={{ ...darkInputStyle, flex: 1 }}
                                />
                                <Button
                                    icon={copied ? <CheckCircleOutlined /> : <CopyOutlined />}
                                    onClick={handleCopyMachineId}
                                    style={{
                                        backgroundColor: copied ? '#52c41a' : '#444',
                                        border: '1px solid #666',
                                        color: '#eee'
                                    }}
                                >
                                    {copied ? '\u5df2\u590d\u5236' : '\u590d\u5236'}
                                </Button>
                            </div>
                        )}
                        <div style={{ color: '#666', fontSize: '11px', marginTop: 8 }}>
                            {'\u8bf7\u8f93\u5165\u6fc0\u6d3b\u7801\u8fdb\u884c\u6c38\u4e45\u6388\u6743\u6fc0\u6d3b'}
                        </div>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <div style={{ color: '#ccc', marginBottom: 8, fontSize: '13px', fontWeight: 500 }}>
                            {'\u6fc0\u6d3b\u7801'}
                        </div>
                        <Input.TextArea
                            value={licenseCode}
                            onChange={(e) => setLicenseCode(e.target.value)}
                            placeholder={'\u8bf7\u5728\u6b64\u8f93\u5165\u6fc0\u6d3b\u7801'}
                            rows={4}
                            styles={{
                                textarea: {
                                    backgroundColor: '#2a2a2a',
                                    border: '1px solid #555',
                                    color: '#eee'
                                }
                            }}
                            className="dark-textarea"
                        />
                        <style>{`
                            .dark-textarea::placeholder,
                            .dark-textarea textarea::placeholder {
                                color: #888 !important;
                            }
                        `}</style>
                    </div>

                    {error && (
                        <Alert
                            message={<span style={{ color: '#ff7875' }}>{error}</span>}
                            type="error"
                            showIcon
                            icon={<ExclamationCircleOutlined style={{ color: '#ff7875' }} />}
                            style={{
                                marginBottom: 20,
                                backgroundColor: 'rgba(255, 77, 79, 0.15)',
                                border: '1px solid #ff4d4f'
                            }}
                        />
                    )}

                    <Button
                        type="primary"
                        block
                        size="large"
                        loading={loading}
                        onClick={handleActivate}
                        disabled={!machineId || machineIdLoading}
                        style={{
                            height: 44,
                            fontSize: '15px',
                            backgroundColor: '#007acc',
                            borderColor: '#007acc'
                        }}
                    >
                        {'\u4f7f\u7528\u6fc0\u6d3b\u7801\u6fc0\u6d3b'}
                    </Button>
                </>
            )}
        </Modal>
    )
}

export default ActivationModal
