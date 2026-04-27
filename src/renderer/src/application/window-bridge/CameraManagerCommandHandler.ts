import type { CameraDocumentEntry, ModelDocumentCommandHandler } from '../commands'
import { modelDocumentCommandHandler } from '../commands'
import { useModelStore } from '../../store/modelStore'
import { markCommandReceived, markCommandRejected, markToolCommandStaleRevision } from '../diagnostics'
import type { CameraViewportBridge } from './CameraViewportBridge'

export interface CameraManagerCommandDependencies {
    viewportBridge: CameraViewportBridge
    getCameras: () => CameraDocumentEntry[]
    syncCameraManager: () => void
}

const cloneCameras = (cameras: CameraDocumentEntry[]): CameraDocumentEntry[] =>
    structuredClone(cameras)

type RevisionedCameraCommand = {
    action?: string
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy?: 'warn' | 'reject'
}

const checkCameraCommandRevision = (payload: RevisionedCameraCommand | undefined): boolean => {
    const state = useModelStore.getState()
    markCommandReceived({
        source: 'CameraManagerCommandHandler',
        commandName: 'EXECUTE_CAMERA_ACTION',
        action: payload?.action ?? '',
        commandDocumentId: payload?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: payload?.baseDocumentRevision ?? '',
        activeDocumentRevision: state.documentRevision,
        stalePolicy: payload?.stalePolicy ?? '',
    })

    if (typeof payload?.baseDocumentRevision !== 'number') {
        return true
    }

    const documentMismatch =
        payload.documentId !== undefined &&
        payload.documentId !== null &&
        state.documentId !== null &&
        payload.documentId !== state.documentId
    const revisionMismatch = payload.baseDocumentRevision !== state.documentRevision
    if (!documentMismatch && !revisionMismatch) {
        return true
    }

    markToolCommandStaleRevision({
        source: 'CameraManagerCommandHandler',
        commandName: 'EXECUTE_CAMERA_ACTION',
        action: payload.action ?? '',
        commandDocumentId: payload.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: payload.baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
        stalePolicy: payload.stalePolicy ?? 'warn',
    })

    if (documentMismatch || payload.stalePolicy === 'reject') {
        markCommandRejected({
            source: 'CameraManagerCommandHandler',
            commandName: 'EXECUTE_CAMERA_ACTION',
            action: payload.action ?? '',
            commandDocumentId: payload.documentId ?? '',
            activeDocumentId: state.documentId ?? '',
            baseDocumentRevision: payload.baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
            reason: documentMismatch ? 'document_mismatch' : 'stale_revision',
        })
        console.warn('[CameraManagerCommandHandler] Rejected stale command', {
            action: payload.action,
            commandDocumentId: payload.documentId,
            activeDocumentId: state.documentId,
            baseDocumentRevision: payload.baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
        })
        return false
    }

    console.warn('[CameraManagerCommandHandler] Stale command detected; applying for compatibility', {
        action: payload.action,
        commandDocumentId: payload.documentId,
        activeDocumentId: state.documentId,
        baseDocumentRevision: payload.baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
    })
    return true
}

export class CameraManagerCommandHandler {
    constructor(
        private readonly documentHandler: ModelDocumentCommandHandler = modelDocumentCommandHandler,
    ) { }

    handle(command: string, payload: unknown, dependencies: CameraManagerCommandDependencies): void {
        if (command !== 'EXECUTE_CAMERA_ACTION') {
            return
        }

        const actionPayload = payload as (RevisionedCameraCommand & { payload?: any }) | undefined
        if (!checkCameraCommandRevision(actionPayload)) {
            return
        }
        const action = actionPayload?.action
        const data = actionPayload?.payload

        if (action === 'ADD') {
            const previousCameras = cloneCameras(dependencies.getCameras())
            const nextCameras = [...previousCameras, data]
            this.documentHandler.replaceCameraList({
                name: 'Add Camera',
                before: previousCameras,
                after: nextCameras,
            })
            dependencies.syncCameraManager()
            return
        }

        if (action === 'DELETE') {
            const cameraIndex = typeof data?.cameraIndex === 'number' ? data.cameraIndex : -1
            const previousCameras = cloneCameras(dependencies.getCameras())
            if (cameraIndex >= 0 && cameraIndex < previousCameras.length) {
                const nextCameras = previousCameras.filter((_, index) => index !== cameraIndex)
                this.documentHandler.replaceCameraList({
                    name: 'Delete Camera',
                    before: previousCameras,
                    after: nextCameras,
                })
                dependencies.syncCameraManager()
            }
            return
        }

        if (action === 'UPDATE') {
            const cameraIndex = typeof data?.cameraIndex === 'number' ? data.cameraIndex : -1
            const updates = data?.data
            const previousCameras = cloneCameras(dependencies.getCameras())
            if (cameraIndex >= 0 && cameraIndex < previousCameras.length && updates && typeof updates === 'object') {
                const oldData: Record<string, unknown> = {}
                Object.keys(updates).forEach((key) => {
                    oldData[key] = previousCameras[cameraIndex]?.[key]
                })
                const nextCameras = previousCameras.map((camera, index) =>
                    index === cameraIndex ? { ...camera, ...updates } : camera
                )
                this.documentHandler.replaceCameraList({
                    name: 'Update Camera',
                    before: previousCameras.map((camera, index) =>
                        index === cameraIndex ? { ...camera, ...oldData } : camera
                    ),
                    after: nextCameras,
                })
                dependencies.syncCameraManager()
            }
            return
        }

        if (action === 'ADD_FROM_VIEW') {
            const nextCamera = dependencies.viewportBridge.createCameraFromCurrentView()
            if (!nextCamera) {
                return
            }
            const previousCameras = cloneCameras(dependencies.getCameras())
            const nextCameras = [...previousCameras, nextCamera]
            this.documentHandler.replaceCameraList({
                name: 'Add Camera',
                before: previousCameras,
                after: nextCameras,
            })
            dependencies.syncCameraManager()
            return
        }

        if (action === 'VIEW_CAMERA') {
            const cameraIndex = typeof data?.cameraIndex === 'number' ? data.cameraIndex : -1
            const cameras = dependencies.getCameras()
            const cameraNode = cameraIndex >= 0 && cameraIndex < cameras.length ? cameras[cameraIndex] : null
            if (cameraNode) {
                dependencies.viewportBridge.focusCamera(cameraNode)
            }
        }
    }
}

export const cameraManagerCommandHandler = new CameraManagerCommandHandler()
