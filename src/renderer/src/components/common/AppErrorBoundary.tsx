import React from 'react'
import { Button } from 'antd'
import { uiText } from '../../constants/uiText'

type AppErrorBoundaryProps = {
    children: React.ReactNode
    scope?: string
    onRetry?: () => void
    minHeight?: number | string
    compact?: boolean
}

type AppErrorBoundaryState = {
    error: Error | null
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = {
        error: null,
    }

    static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
        return { error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        console.error(`[AppErrorBoundary] ${this.props.scope ?? uiText.errorBoundary.defaultScope}`, error, errorInfo)
    }

    private handleRetry = (): void => {
        this.setState({ error: null })
        this.props.onRetry?.()
    }

    render(): React.ReactNode {
        const { children, scope, minHeight = 240, compact = false } = this.props
        const { error } = this.state

        if (!error) {
            return children
        }

        return (
            <div
                style={{
                    minHeight,
                    height: '100%',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: compact ? 16 : 24,
                    background: 'linear-gradient(180deg, #191919 0%, #121212 100%)',
                    color: '#f0f0f0',
                }}
            >
                <div
                    style={{
                        width: 'min(100%, 520px)',
                        padding: compact ? 16 : 20,
                        borderRadius: 10,
                        border: '1px solid #3a3a3a',
                        backgroundColor: '#202020',
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.35)',
                    }}
                >
                    <div style={{ fontSize: compact ? 16 : 18, fontWeight: 600, marginBottom: 8 }}>
                        {uiText.errorBoundary.title}
                    </div>
                    <div style={{ color: '#a6a6a6', fontSize: 13, marginBottom: 8 }}>
                        {scope ?? uiText.errorBoundary.defaultScope}
                    </div>
                    <div style={{ color: '#d0d0d0', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                        {uiText.errorBoundary.description}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                        <Button type="primary" onClick={this.handleRetry}>
                            {uiText.errorBoundary.retry}
                        </Button>
                        <Button onClick={() => window.location.reload()}>
                            {uiText.errorBoundary.reloadPage}
                        </Button>
                    </div>
                    <details>
                        <summary style={{ cursor: 'pointer', color: '#bdbdbd' }}>{uiText.errorBoundary.details}</summary>
                        <pre
                            style={{
                                marginTop: 12,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                fontSize: 12,
                                lineHeight: 1.6,
                                color: '#ffb3b3',
                            }}
                        >
                            {error.stack || error.message}
                        </pre>
                    </details>
                </div>
            </div>
        )
    }
}

export default AppErrorBoundary
