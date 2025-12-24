import React, { useState, useEffect } from 'react'
import { Modal, Input, Button, message, Typography, Space, Spin, Alert } from 'antd'
import { CopyOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { invoke } from '@tauri-apps/api/core'

const { Title, Text, Paragraph } = Typography

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
                body: { padding: '32px' },
                mask: { backgroundColor: 'rgba(0, 0, 0, 0.85)' }
            }}
        >
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <Title level={3} style={{ marginBottom: 8 }}>
                    War3 Model Editor
                </Title>
                <Text type="secondary">软件需要激活后才能使用</Text>
            </div>

            {/* Machine ID Section */}
            <div style={{ marginBottom: 24 }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                    您的机器码
                </Text>
                {machineIdLoading ? (
                    <div style={{ textAlign: 'center', padding: 16 }}>
                        <Spin size="small" />
                        <Text type="secondary" style={{ marginLeft: 8 }}>正在获取机器码...</Text>
                    </div>
                ) : (
                    <Space.Compact style={{ width: '100%' }}>
                        <Input
                            value={machineId}
                            readOnly
                            style={{
                                fontFamily: 'monospace',
                                backgroundColor: '#f5f5f5'
                            }}
                        />
                        <Button
                            icon={copied ? <CheckCircleOutlined /> : <CopyOutlined />}
                            onClick={handleCopyMachineId}
                            type={copied ? 'primary' : 'default'}
                        >
                            {copied ? '已复制' : '复制'}
                        </Button>
                    </Space.Compact>
                )}
                <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                    请将机器码发送给软件提供者以获取激活码
                </Paragraph>
            </div>

            {/* License Code Input */}
            <div style={{ marginBottom: 24 }}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                    激活码
                </Text>
                <Input.TextArea
                    value={licenseCode}
                    onChange={(e) => setLicenseCode(e.target.value)}
                    placeholder="请在此输入激活码"
                    rows={4}
                    style={{ fontFamily: 'monospace' }}
                />
            </div>

            {/* Error Display */}
            {error && (
                <Alert
                    message={error}
                    type="error"
                    showIcon
                    icon={<ExclamationCircleOutlined />}
                    style={{ marginBottom: 24 }}
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
            >
                激活软件
            </Button>
        </Modal>
    )
}

export default ActivationModal
