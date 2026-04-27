import React from 'react'
import { LoadingOutlined } from '@ant-design/icons'
import type { SaveOperation } from '../store/saveOperationStore'

interface SaveProgressOverlayProps {
    operation: SaveOperation
}

export const SaveProgressOverlay: React.FC<SaveProgressOverlayProps> = ({ operation }) => {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-label={operation.title}
            style={{
                position: 'absolute',
                inset: 0,
                zIndex: 2147482000,
                background: 'rgba(12, 12, 12, 0.72)',
                backdropFilter: 'blur(2px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
                color: '#f2f2f2',
            }}
        >
            <div
                style={{
                    width: 'min(420px, calc(100vw - 48px))',
                    border: '1px solid #3d3d3d',
                    backgroundColor: '#242424',
                    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.42)',
                    borderRadius: 6,
                    padding: '18px 20px',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <LoadingOutlined style={{ color: '#63a4ff', fontSize: 18 }} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{operation.title}</div>
                        <div
                            style={{
                                marginTop: 4,
                                fontSize: 12,
                                color: '#b8b8b8',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {operation.detail}
                        </div>
                    </div>
                </div>
                <div
                    style={{
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: '#151515',
                        overflow: 'hidden',
                        border: '1px solid #303030',
                    }}
                >
                    <div
                        style={{
                            height: '100%',
                            width: `${operation.progress}%`,
                            borderRadius: 4,
                            background: 'linear-gradient(90deg, #3b82f6, #4ade80)',
                            transition: 'width 160ms ease-out',
                        }}
                    />
                </div>
                <div style={{ marginTop: 8, textAlign: 'right', color: '#cfcfcf', fontSize: 12 }}>
                    {operation.progress}%
                </div>
            </div>
        </div>
    )
}
