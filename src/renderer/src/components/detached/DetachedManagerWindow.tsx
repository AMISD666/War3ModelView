import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Spin } from 'antd'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useModelStore } from '../../store/modelStore'
import CameraManagerModal from '../modals/CameraManagerModal'
import GeosetEditorModal from '../modals/GeosetEditorModal'
import GeosetAnimationModal from '../modals/GeosetAnimationModal'
import TextureAnimationManagerModal from '../modals/TextureAnimationManagerModal'
import MaterialEditorModal from '../modals/MaterialEditorModal'
import SequenceEditorModal from '../modals/SequenceEditorModal'
import GlobalSequenceModal from '../modals/GlobalSequenceModal'

import {
    DETACHED_CAMERA_EVENTS,
    DETACHED_MANAGER_EVENTS,
    DETACHED_MANAGER_TYPES,
    DetachedCameraViewPayload,
    DetachedManagerApplyPayload,
    DetachedManagerLifecyclePayload,
    DetachedManagerRequestSnapshotPayload,
    DetachedManagerSnapshotPayload,
    DetachedManagerType
} from '../../constants/detachedWindows'

const parseDetachedManagerType = (detachedMode: string | null): DetachedManagerType | null => {
    if (!detachedMode || !detachedMode.startsWith('manager-')) return null
    const rawType = detachedMode.slice('manager-'.length) as DetachedManagerType
    return DETACHED_MANAGER_TYPES.includes(rawType) ? rawType : null
}

interface DetachedManagerWindowProps {
    detachedMode: string | null
}

const DetachedManagerWindow: React.FC<DetachedManagerWindowProps> = ({ detachedMode }) => {
    const managerType = useMemo(() => parseDetachedManagerType(detachedMode), [detachedMode])
    const [isReady, setIsReady] = useState(false)
    const [hasSnapshot, setHasSnapshot] = useState(false)
    const setModelData = useModelStore((state) => state.setModelData)
    const modelData = useModelStore((state) => state.modelData)
    const modelPath = useModelStore((state) => state.modelPath)
    const suppressNextApplyRef = useRef(false)
    const applyTimerRef = useRef<number | null>(null)
    const requestRetryTimerRef = useRef<number | null>(null)
    const hasSnapshotRef = useRef(false)

    useEffect(() => {
        let unlistenCloseRequested: (() => void) | null = null

        const setup = async () => {
            const currentWindow = getCurrentWindow()
            unlistenCloseRequested = await currentWindow.onCloseRequested(async (event) => {
                event.preventDefault()
                try {
                    await currentWindow.hide()
                } catch (error) {
                    console.error('[DetachedManagerWindow] hide on close requested failed:', error)
                }
            })
        }

        setup().catch((error) => {
            console.error('[DetachedManagerWindow] close-requested listener setup failed:', error)
        })

        return () => {
            unlistenCloseRequested?.()
        }
    }, [])

    useEffect(() => {
        if (!managerType) {
            setIsReady(true)
            return
        }

        let mounted = true
        let unlistenSnapshot: (() => void) | null = null
        hasSnapshotRef.current = false
        setHasSnapshot(false)

        const setup = async () => {
            const currentWindow = getCurrentWindow()
            const windowLabel = currentWindow.label
            const lifecyclePayload: DetachedManagerLifecyclePayload = {
                managerType,
                windowLabel
            }

            unlistenSnapshot = await listen<DetachedManagerSnapshotPayload>(
                DETACHED_MANAGER_EVENTS.snapshot,
                (event) => {
                    if (!mounted) return
                    const payload = event.payload
                    if (!payload || payload.managerType !== managerType || !payload.modelData) return
                    suppressNextApplyRef.current = true
                    setModelData(payload.modelData, payload.modelPath ?? null, {
                        skipAutoRecalculate: true,
                        skipModelRebuild: true
                    })
                    hasSnapshotRef.current = true
                    setHasSnapshot(true)
                    setIsReady(true)
                    emitTo('main', DETACHED_MANAGER_EVENTS.hydrated, lifecyclePayload).catch((error) => {
                        console.error('[DetachedManagerWindow] hydrated emit failed:', error)
                    })
                }
            )

            await emitTo('main', DETACHED_MANAGER_EVENTS.ready, lifecyclePayload)

            const requestSnapshot = async () => {
                const requestPayload: DetachedManagerRequestSnapshotPayload = {
                    managerType,
                    windowLabel
                }
                await emitTo('main', DETACHED_MANAGER_EVENTS.requestSnapshot, requestPayload)
            }

            // Fallback pull if "ready -> snapshot" misses due startup timing.
            let retries = 0
            const maxRetries = 8
            const retry = () => {
                if (!mounted || hasSnapshotRef.current || retries >= maxRetries) return
                retries += 1
                requestSnapshot().catch((error) => {
                    console.error('[DetachedManagerWindow] snapshot retry failed:', error)
                })
                requestRetryTimerRef.current = window.setTimeout(retry, 220)
            }
            requestRetryTimerRef.current = window.setTimeout(retry, 220)
        }

        setup().catch((error) => {
            console.error('[DetachedManagerWindow] setup failed:', error)
            if (mounted) setIsReady(true)
        })

        return () => {
            mounted = false
            unlistenSnapshot?.()
            if (requestRetryTimerRef.current !== null) {
                window.clearTimeout(requestRetryTimerRef.current)
                requestRetryTimerRef.current = null
            }
            if (applyTimerRef.current !== null) {
                window.clearTimeout(applyTimerRef.current)
                applyTimerRef.current = null
            }
        }
    }, [managerType, setModelData])

    useEffect(() => {
        if (!managerType || !isReady || !hasSnapshot || !modelData) return
        if (suppressNextApplyRef.current) {
            suppressNextApplyRef.current = false
            return
        }

        if (applyTimerRef.current !== null) {
            window.clearTimeout(applyTimerRef.current)
        }

        applyTimerRef.current = window.setTimeout(() => {
            const payloadModelData = managerType === 'sequence'
                ? { Sequences: (modelData as any)?.Sequences || [] }
                : modelData
            const payload: DetachedManagerApplyPayload = {
                managerType,
                modelData: payloadModelData,
                modelPath: modelPath || undefined
            }
            emitTo('main', DETACHED_MANAGER_EVENTS.apply, payload).catch((error) => {
                console.error('[DetachedManagerWindow] apply emit failed:', error)
            })
            applyTimerRef.current = null
        }, 120)
    }, [managerType, isReady, hasSnapshot, modelData, modelPath])

    const handleClose = async () => {
        try {
            await getCurrentWindow().hide()
        } catch (error) {
            console.error('[DetachedManagerWindow] close failed:', error)
        }
    }

    if (!isReady) {
        return (
            <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f1f1f' }}>
                <Spin size="large" />
            </div>
        )
    }

    if (!managerType) {
        return (
            <div style={{ height: '100vh', padding: 16, backgroundColor: '#1f1f1f' }}>
                <Alert type="error" message="Invalid manager window mode." showIcon />
            </div>
        )
    }

    if (!hasSnapshot) {
        return (
            <div style={{ height: '100vh', padding: 16, backgroundColor: '#1f1f1f' }}>
                <Alert type="warning" message="No model snapshot from main window." showIcon />
            </div>
        )
    }

    if (managerType === 'camera') {
        return (
            <CameraManagerModal
                visible={true}
                asWindow={true}
                onClose={handleClose}
                onAddFromView={() => {
                    emitTo('main', DETACHED_CAMERA_EVENTS.addFromView).catch((error) => {
                        console.error('[DetachedManagerWindow] camera add-from-view emit failed:', error)
                    })
                }}
                onViewCamera={(camera) => {
                    const payload: DetachedCameraViewPayload = { camera }
                    emitTo('main', DETACHED_CAMERA_EVENTS.view, payload).catch((error) => {
                        console.error('[DetachedManagerWindow] camera view emit failed:', error)
                    })
                }}
            />
        )
    }
    if (managerType === 'geoset') {
        return <GeosetEditorModal visible={true} asWindow={true} onClose={handleClose} />
    }
    if (managerType === 'geosetAnim') {
        return <GeosetAnimationModal visible={true} asWindow={true} onClose={handleClose} />
    }
    if (managerType === 'textureAnim') {
        return <TextureAnimationManagerModal visible={true} asWindow={true} onClose={handleClose} />
    }
    if (managerType === 'material') {
        return <MaterialEditorModal visible={true} asWindow={true} onClose={handleClose} />
    }
    if (managerType === 'sequence') {
        return <SequenceEditorModal visible={true} asWindow={true} onClose={handleClose} />
    }
    if (managerType === 'globalSequence') {
        return <GlobalSequenceModal visible={true} isStandalone={true} onClose={handleClose} />
    }

    return (
        <div style={{ height: '100vh', padding: 16, backgroundColor: '#1f1f1f' }}>
            <Alert type="error" message="Unsupported manager type." showIcon />
        </div>
    )
}

export default DetachedManagerWindow
