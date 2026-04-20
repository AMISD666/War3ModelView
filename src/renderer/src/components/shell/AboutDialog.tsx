import React from 'react'
import { uiText } from '../../constants/uiText'
import type { ActivationStatus } from '../../application/shell/useAppShellController'

interface AboutDialogProps {
    open: boolean
    activationStatus: ActivationStatus | null
    activationCode: string
    activationLoading: boolean
    activationError: string | null
    onClose(): void
    onActivationCodeChange(value: string): void
    onActivate(): void
}

export const AboutDialog: React.FC<AboutDialogProps> = ({
    open,
    activationStatus,
    activationCode,
    activationLoading,
    activationError,
    onClose,
    onActivationCodeChange,
    onActivate,
}) => {
    if (!open) {
        return null
    }

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
        }} onClick={onClose}>
            <div style={{
                backgroundColor: '#333',
                padding: '20px',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                minWidth: '300px',
                textAlign: 'center',
                border: '1px solid #555',
            }} onClick={(event) => event.stopPropagation()}>
                <h3 style={{ marginTop: 0, marginBottom: '15px' }}>{uiText.about.title}</h3>
                <p style={{ fontSize: '18px', margin: '10px 0' }}>{uiText.app.name} {uiText.app.version}</p>

                <div style={{
                    marginTop: '15px',
                    padding: '12px',
                    backgroundColor: '#2a2a2a',
                    borderRadius: '4px',
                    textAlign: 'left',
                }}>
                    <div style={{ marginBottom: '8px', color: '#aaa', fontSize: '12px' }}>{uiText.about.activationStatus}</div>
                    {activationStatus ? (
                        activationStatus.is_activated ? (
                            <>
                                <div style={{
                                    color: activationStatus.level >= 2 ? '#ffc53d' : '#52c41a',
                                    fontWeight: 'bold',
                                    marginBottom: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                }}>
                                    <span>✓ {activationStatus.level_name}</span>
                                    <span style={{
                                        fontSize: '11px',
                                        padding: '2px 6px',
                                        backgroundColor: activationStatus.level >= 2 ? '#ffc53d22' : '#52c41a22',
                                        borderRadius: '3px',
                                        color: activationStatus.level >= 2 ? '#ffc53d' : '#52c41a',
                                    }}>
                                        {activationStatus.license_type === 'PERM'
                                            ? uiText.about.permanent
                                            : activationStatus.license_type === 'QQ'
                                                ? uiText.about.qqVerification
                                                : uiText.about.timeLimited}
                                    </span>
                                </div>
                                {(activationStatus.license_type === 'TIME' || activationStatus.license_type === 'QQ') && activationStatus.days_remaining !== null && (
                                    <div style={{ color: activationStatus.days_remaining <= 7 ? '#ff7875' : '#eee', fontSize: '13px' }}>
                                        {activationStatus.license_type === 'QQ' ? uiText.about.reviewDate : uiText.about.expirationDate}: {activationStatus.expiration_date} (剩余 {activationStatus.days_remaining} 天)
                                    </div>
                                )}
                                {activationStatus.level < 2 && (
                                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
                                        {uiText.about.upgradeHint}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div style={{ color: '#ff7875' }}>{uiText.about.inactive}</div>
                        )
                    ) : (
                        <div style={{ color: '#888' }}>{uiText.about.loading}</div>
                    )}
                </div>

                <div style={{
                    marginTop: '15px',
                    padding: '12px',
                    backgroundColor: '#2a2a2a',
                    borderRadius: '4px',
                    textAlign: 'left',
                }}>
                    <div style={{ marginBottom: '8px', color: '#aaa', fontSize: '12px' }}>
                        {activationStatus?.is_activated ? uiText.about.replaceActivationCode : uiText.about.enterActivationCode}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                            type="text"
                            value={activationCode}
                            onChange={(event) => onActivationCodeChange(event.target.value)}
                            placeholder={uiText.about.activationPlaceholder}
                            style={{
                                flex: 1,
                                padding: '6px 10px',
                                backgroundColor: '#1e1e1e',
                                border: '1px solid #555',
                                borderRadius: '4px',
                                color: '#eee',
                                fontSize: '13px',
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !activationLoading) {
                                    onActivate()
                                }
                            }}
                        />
                        <button
                            onClick={onActivate}
                            disabled={activationLoading}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: activationLoading ? '#555' : '#52c41a',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: activationLoading ? 'not-allowed' : 'pointer',
                                fontSize: '13px',
                            }}
                        >
                            {activationLoading ? uiText.about.activating : uiText.about.activate}
                        </button>
                    </div>
                    {activationError && (
                        <div style={{ marginTop: '8px', color: '#ff7875', fontSize: '12px' }}>
                            {activationError}
                        </div>
                    )}
                </div>

                <button
                    onClick={onClose}
                    style={{
                        marginTop: '20px',
                        padding: '6px 16px',
                        backgroundColor: '#007acc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                    }}
                >
                    {uiText.about.confirm}
                </button>
            </div>
        </div>
    )
}
