import { useEffect, useState } from 'react'
import MainLayoutNew from './components/MainLayoutNew'
import ActivationModal from './components/modals/ActivationModal'
import { initDebugLogging } from './utils/debugLog'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/plugin-process'

interface ActivationStatus {
    is_activated: boolean
    license_type: string
    expiration_date: string | null
    days_remaining: number | null
    error: string | null
}

function App(): JSX.Element {
    // Start as null (unknown), render main UI optimistically
    const [isActivated, setIsActivated] = useState<boolean | null>(null)

    useEffect(() => {
        initDebugLogging()
        checkActivation()

        // When the main window closes, forcefully exit the entire application 
        // to prevent preloaded background windows from keeping the process alive.
        const unlistenPromise = getCurrentWindow().onCloseRequested(async () => {
            await exit(0);
        });

        return () => {
            unlistenPromise.then(unlisten => unlisten()).catch(console.error);
        }
    }, [])

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

    return (
        <>
            {/* Always render main layout immediately — no blocking spinner */}
            <MainLayoutNew />

            {/* Overlay activation modal only after check confirms not activated */}
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

