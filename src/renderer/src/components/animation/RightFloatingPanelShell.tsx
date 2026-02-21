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
                width: 320,
                background: 'rgba(24, 24, 24, 0.95)',
                border: '1px solid #3a3a3a',
                borderRadius: 6,
                padding: '8px 10px',
                color: '#ddd',
                display: 'flex',
                flexDirection: 'column',
                gap: collapsed ? 0 : 8,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                pointerEvents: 'auto',
                ...style
            }}
        >
            {/* 标题栏 */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: 24,
                    userSelect: 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#bfbfbf', fontSize: 13, fontWeight: 500 }}>{title}</span>
                    {status && <div style={{ fontSize: 12, color: '#888' }}>{status}</div>}
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
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
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
