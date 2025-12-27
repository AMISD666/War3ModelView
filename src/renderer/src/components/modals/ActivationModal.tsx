import React, { useState, useEffect } from 'react'
import { Modal, Input, Button, message, Spin, Alert } from 'antd'
import { CopyOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
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

const ActivationModal: React.FC<ActivationModalProps> = ({ open, onActivated }) => {
    const [machineId, setMachineId] = useState<string>('')
    const [licenseCode, setLicenseCode] = useState<string>('')
    const [loading, setLoading] = useState<boolean>(false)
    const [machineIdLoading, setMachineIdLoading] = useState<boolean>(true)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState<boolean>(false)

    useEffect(() => {
        if (open) {
            loadMachineId()
        }
    }, [open])

    const loadMachineId = async () => {
        setMachineIdLoading(true)
        try {
            const mid = await invoke<string>('get_machine_id')
            setMachineId(mid)
        } catch (e: any) {
            setError('无法获取机器码: ' + (e?.message || e))
        } finally {
            setMachineIdLoading(false)
        }
    }

    const handleCopyMachineId = () => {
        navigator.clipboard.writeText(machineId)
        setCopied(true)
        message.success('机器码已复制到剪贴板')
        setTimeout(() => setCopied(false), 2000)
    }

    const handleActivate = async () => {
        if (!licenseCode.trim()) {
            setError('请输入激活码')
            return
        }

        setLoading(true)
        setError(null)

        try {
            const result = await invoke<ActivationStatus>('activate_software', {
                licenseCode: licenseCode.trim()
            })

            if (result.is_activated) {
                message.success('软件激活成功!')
                onActivated()
            } else {
                setError(result.error || '激活失败')
            }
        } catch (e: any) {
            setError(typeof e === 'string' ? e : (e?.message || '激活失败，请检查激活码是否正确'))
        } finally {
            setLoading(false)
        }
    }

    // Dark theme styles matching main interface
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
            width={480}
            styles={{
                content: {
                    backgroundColor: '#333',
                    border: '1px solid #555',
                    borderRadius: '8px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.6)'
                },
                body: { padding: '32px' },
                mask: { backgroundColor: 'rgba(0, 0, 0, 0.85)' }
            }}
        >
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <h2 style={{
                    color: '#eee',
                    margin: 0,
                    marginBottom: 8,
                    fontSize: '22px',
                    fontWeight: 500
                }}>
                    咕咕War3模型编辑器
                </h2>
                <span style={{ color: '#888', fontSize: '13px' }}>
                    软件需要激活后才能使用
                </span>
            </div>

            {/* Machine ID Section */}
            <div style={{ marginBottom: 24 }}>
                <div style={{ color: '#ccc', marginBottom: 8, fontSize: '13px', fontWeight: 500 }}>
                    您的机器码
                </div>
                {machineIdLoading ? (
                    <div style={{ textAlign: 'center', padding: 16 }}>
                        <Spin size="small" />
                        <span style={{ color: '#888', marginLeft: 8 }}>正在获取机器码...</span>
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
                            {copied ? '已复制' : '复制'}
                        </Button>
                    </div>
                )}
                <div style={{ color: '#666', fontSize: '11px', marginTop: 8 }}>
                    请将机器码发送给软件提供者以获取激活码
                </div>
            </div>

            {/* License Code Input */}
            <div style={{ marginBottom: 24 }}>
                <div style={{ color: '#ccc', marginBottom: 8, fontSize: '13px', fontWeight: 500 }}>
                    激活码
                </div>
                <Input.TextArea
                    value={licenseCode}
                    onChange={(e) => setLicenseCode(e.target.value)}
                    placeholder="请在此输入激活码"
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

            {/* Error Display */}
            {error && (
                <Alert
                    message={<span style={{ color: '#ff7875' }}>{error}</span>}
                    type="error"
                    showIcon
                    icon={<ExclamationCircleOutlined style={{ color: '#ff7875' }} />}
                    style={{
                        marginBottom: 24,
                        backgroundColor: 'rgba(255, 77, 79, 0.15)',
                        border: '1px solid #ff4d4f'
                    }}
                />
            )}

            {/* Activate Button */}
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
                激活软件
            </Button>
        </Modal>
    )
}

export default ActivationModal

