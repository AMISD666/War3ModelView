import { useEffect, useMemo, useState } from 'react'
import MainLayoutNew from './components/MainLayoutNew'
import ActivationModal from './components/modals/ActivationModal'
import StandaloneToolWindowRouter, { isStandaloneToolWindowLabel } from './components/detached/StandaloneToolWindowRouter'
import { initDebugLogging } from './utils/debugLog'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/plugin-process'
import { windowManager } from './utils/WindowManager'

interface ActivationStatus {
    is_activated: boolean
    license_type: string
    expiration_date: string | null
    days_remaining: number | null
    error: string | null
}

function App(): JSX.Element {
    const [isActivated, setIsActivated] = useState<boolean | null>(null)
    const standaloneWindowLabel = useMemo(() => {
        if (typeof window === 'undefined') return null
        const params = new URLSearchParams(window.location.search)
        const windowLabel = params.get('window')
        return isStandaloneToolWindowLabel(windowLabel) ? windowLabel : null
    }, [])

    useEffect(() => {
        initDebugLogging()

        if (standaloneWindowLabel) {
            return
        }

        checkActivation()

        const unlistenPromise = getCurrentWindow().onCloseRequested(async () => {
            await windowManager.destroyAllWindows().catch(console.error)
            await exit(0)
        })

        return () => {
            unlistenPromise.then(unlisten => unlisten()).catch(console.error)
        }
    }, [standaloneWindowLabel])

    const checkActivation = async () => {
        try {
            const status = await invoke<ActivationStatus>('get_activation_status')
            setIsActivated(status.is_activated)
        } catch (e: any) {
            console.error('Activation check failed:', e)
            setIsActivated(false)
        }
    }

    const handleActivated = () => {
        setIsActivated(true)
    }

    if (standaloneWindowLabel) {
        return <StandaloneToolWindowRouter windowLabel={standaloneWindowLabel} />
    }

    return (
        <>
            <MainLayoutNew />

            {isActivated === false && (
                <ActivationModal
                    open={true}
                    onActivated={handleActivated}
                />
            )}
        </>
    )
}

export default App
