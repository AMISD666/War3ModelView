import { useEffect, useState } from 'react'
import MainLayoutNew from './components/MainLayoutNew'
import ActivationModal from './components/modals/ActivationModal'
import { initDebugLogging } from './utils/debugLog'
import { invoke } from '@tauri-apps/api/core'
import { Spin } from 'antd'

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

    useEffect(() => {
        initDebugLogging()
        checkActivation()
    }, [])

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
                <Spin size="large" tip="正在检查激活状态..." />
            </div>
        )
    }

    // Not activated - show activation modal
    if (!isActivated) {
        return (
            <>
                <ActivationModal
                    open={true}
                    onActivated={handleActivated}
                />
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
        <MainLayoutNew />
    )
}

export default App
