import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import StandaloneToolWindowRouter, { isStandaloneToolWindowLabel } from './components/detached/StandaloneToolWindowRouter'
import { initDebugLogging } from './utils/debugLog'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/plugin-process'
import { windowManager } from './utils/WindowManager'
import { useRef } from 'react'

const MainLayoutNew = lazy(() => import('./components/MainLayoutNew'))
const ActivationModal = lazy(() => import('./components/modals/ActivationModal'))

interface ActivationStatus {
    is_activated: boolean
    license_type: string
    expiration_date: string | null
    days_remaining: number | null
    error: string | null
}

function App(): JSX.Element {
    const [isActivated, setIsActivated] = useState<boolean | null>(null)
    const [shouldMountMainLayout, setShouldMountMainLayout] = useState(false)
    const isClosingRef = useRef(false)
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

        const mountHandle = window.requestAnimationFrame(() => {
            setShouldMountMainLayout(true)
        })

        const unlistenPromise = getCurrentWindow().onCloseRequested(async (event) => {
            if (event.isPreventDefault() || isClosingRef.current) {
                return
            }

            event.preventDefault()
            isClosingRef.current = true

            try {
                await windowManager.destroyAllWindows().catch(console.error)
                await exit(0)
            } catch (error) {
                console.error('[App] graceful exit failed:', error)
                isClosingRef.current = false
            }
        })

        return () => {
            window.cancelAnimationFrame(mountHandle)
            unlistenPromise.then(unlisten => unlisten()).catch(console.error)
        }
    }, [standaloneWindowLabel])

    useEffect(() => {
        if (standaloneWindowLabel || !shouldMountMainLayout) {
            return
        }

        const runCheck = () => {
            void checkActivation()
        }

        const requestIdleCallbackRef = (window as Window & {
            requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
        }).requestIdleCallback

        if (requestIdleCallbackRef) {
            const idleId = requestIdleCallbackRef(runCheck, { timeout: 1200 })
            return () => {
                const cancelIdleCallbackRef = (window as Window & {
                    cancelIdleCallback?: (handle: number) => void
                }).cancelIdleCallback
                cancelIdleCallbackRef?.(idleId)
            }
        }

        const timeoutId = window.setTimeout(runCheck, 250)
        return () => window.clearTimeout(timeoutId)
    }, [standaloneWindowLabel, shouldMountMainLayout])

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

    const shellFallback = (
        <div
            style={{
                height: '100dvh',
                width: '100%',
                backgroundColor: '#1e1e1e',
                color: '#d8d8d8',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            <div
                style={{
                    height: 40,
                    borderBottom: '1px solid #2d2d2d',
                    backgroundColor: '#202020',
                    flexShrink: 0,
                }}
            />
            <div style={{ flex: 1, background: 'linear-gradient(180deg, #1d1d1d 0%, #171717 100%)' }} />
        </div>
    )

    return (
        <>
            <Suspense fallback={shellFallback}>
                {shouldMountMainLayout ? <MainLayoutNew /> : shellFallback}
            </Suspense>

            {isActivated === false && (
                <Suspense fallback={null}>
                    <ActivationModal
                        open={true}
                        onActivated={handleActivated}
                    />
                </Suspense>
            )}
        </>
    )
}

export default App
