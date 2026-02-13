import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Spin } from 'antd'
import { DETACHED_TEXTURE_EDITOR_QUERY } from './constants/detachedWindows'
import { initDebugLogging } from './utils/debugLog'

const MainLayoutNew = lazy(() => import('./components/MainLayoutNew'))
const ActivationModal = lazy(() => import('./components/modals/ActivationModal'))
const TextureEditorDetachedWindow = lazy(() => import('./components/detached/TextureEditorDetachedWindow'))
const DetachedManagerWindow = lazy(() => import('./components/detached/DetachedManagerWindow'))

interface ActivationStatus {
    is_activated: boolean
    license_type: string
    expiration_date: string | null
    days_remaining: number | null
    error: string | null
}

function App(): JSX.Element {
    const [isActivated, setIsActivated] = useState<boolean | null>(null)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_activationError, setActivationError] = useState<string | null>(null)
    const detachedMode = useMemo(() => {
        const params = new URLSearchParams(window.location.search)
        return params.get('detached')
    }, [])

    useEffect(() => {
        if (detachedMode) {
            return
        }
        initDebugLogging()
        checkActivation()
    }, [detachedMode])

    const checkActivation = async () => {
        try {
            const status = await invoke<ActivationStatus>('get_activation_status')
            setIsActivated(status.is_activated)
            if (!status.is_activated && status.error) {
                setActivationError(status.error)
            }
        } catch (e: any) {
            console.error('Activation check failed:', e)
            setIsActivated(false)
        }
    }

    const handleActivated = () => {
        setIsActivated(true)
        setActivationError(null)
    }

    const detachedFallback = (
        <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1f1f1f' }} />
    )

    // Detached windows do not need activation/bootstrap UI.
    if (detachedMode === DETACHED_TEXTURE_EDITOR_QUERY) {
        return (
            <Suspense fallback={detachedFallback}>
                <TextureEditorDetachedWindow />
            </Suspense>
        )
    }
    if (typeof detachedMode === 'string' && detachedMode.startsWith('manager-')) {
        return (
            <Suspense fallback={detachedFallback}>
                <DetachedManagerWindow detachedMode={detachedMode} />
            </Suspense>
        )
    }

    // Loading state
    if (isActivated === null) {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                backgroundColor: '#1e1e1e'
            }}>
                <Spin size="large" />
            </div>
        )
    }

    // Not activated - show activation modal
    if (!isActivated) {
        return (
            <>
                <Suspense fallback={null}>
                    <ActivationModal
                        open={true}
                        onActivated={handleActivated}
                    />
                </Suspense>
                {/* Dark background placeholder */}
                <div style={{
                    width: '100vw',
                    height: '100vh',
                    backgroundColor: '#1e1e1e'
                }} />
            </>
        )
    }

    // Activated - show main app
    return (
        <Suspense fallback={null}>
            <MainLayoutNew />
        </Suspense>
    )
}

export default App
