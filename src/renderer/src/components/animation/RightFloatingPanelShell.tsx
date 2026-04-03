import React from 'react'
import { Button, Tooltip } from 'antd'
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'

interface RightFloatingPanelShellProps {
    title: string
    status?: React.ReactNode
    collapsed: boolean
    onToggleCollapse: () => void
    children: React.ReactNode
    style?: React.CSSProperties
}

/**
 * 关键帧模式右侧浮层统一外壳
 */
const RightFloatingPanelShell: React.FC<RightFloatingPanelShellProps> = ({
    title,
    status,
    collapsed,
    onToggleCollapse,
    children,
    style
}) => {
    return (
        <div
            style={{
                width: '100%',
                background: 'rgba(24, 24, 24, 0.95)',
                border: '1px solid #3a3a3a',
                borderRadius: 6,
                color: '#ddd',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                pointerEvents: 'auto',
                overflow: 'hidden',
                ...style
            }}
        >
            {/* 标题栏 */}
            <div
                onClick={onToggleCollapse}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: 32,
                    padding: '0 10px',
                    background: 'linear-gradient(90deg, #3a3a3a 0%, #242424 100%)',
                    borderBottom: collapsed ? 'none' : '1px solid #1f1f1f',
                    userSelect: 'none',
                    cursor: 'pointer'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#eaeaea', fontSize: 13, fontWeight: 500 }}>{title}</span>
                    {status && <div style={{ fontSize: 12, color: '#999' }}>{status}</div>}
                </div>

                <Tooltip title={collapsed ? '展开面板' : '折叠面板'}>
                    <Button
                        type="text"
                        size="small"
                        icon={collapsed ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                        onClick={(e) => {
                            e.stopPropagation()
                            onToggleCollapse()
                        }}
                        style={{ color: '#aaa', padding: 0, width: 24, height: 24 }}
                    />
                </Tooltip>
            </div>

            {/* 内容区 */}
            {!collapsed && (
                <div
                    style={{
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        background: 'rgba(24, 24, 24, 0.95)',
                        animation: 'fadeIn 0.2s ease-out'
                    }}
                >
                    {children}
                </div>
            )}

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    )
}

export default React.memo(RightFloatingPanelShell)
