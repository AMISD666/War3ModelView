import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import StandaloneToolWindowRouter, { isStandaloneToolWindowLabel } from './components/detached/StandaloneToolWindowRouter'
import AppErrorBoundary from './components/common/AppErrorBoundary'
import { GlobalMessageLayer } from './components/GlobalMessageLayer'
import { desktopGateway } from './infrastructure/desktop'

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
    const standaloneWindowLabel = useMemo(() => {
        if (typeof window === 'undefined') return null
        const params = new URLSearchParams(window.location.search)
        const windowLabel = params.get('window')
        return isStandaloneToolWindowLabel(windowLabel) ? windowLabel : null
    }, [])

    useEffect(() => {
        if (standaloneWindowLabel) {
            return
        }

        const mountHandle = window.requestAnimationFrame(() => {
            setShouldMountMainLayout(true)
        })

        return () => {
            window.cancelAnimationFrame(mountHandle)
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
            const status = await desktopGateway.invoke<ActivationStatus>('get_activation_status')
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
        return (
            <>
                <AppErrorBoundary scope="独立工具窗口">
                    <StandaloneToolWindowRouter windowLabel={standaloneWindowLabel} />
                </AppErrorBoundary>
                <GlobalMessageLayer />
            </>
        )
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
            <AppErrorBoundary scope="主应用">
                <Suspense fallback={shellFallback}>
                    {shouldMountMainLayout ? <MainLayoutNew /> : shellFallback}
                </Suspense>
            </AppErrorBoundary>

            {isActivated === false && (
                <AppErrorBoundary scope="激活弹窗" compact>
                    <Suspense fallback={null}>
                        <ActivationModal
                            open={true}
                            onActivated={handleActivated}
                        />
                    </Suspense>
                </AppErrorBoundary>
            )}

            <GlobalMessageLayer />
        </>
    )
}

export default App
