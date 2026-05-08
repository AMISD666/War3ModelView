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
    action?: CameraManagerAction
    documentId?: string | null
    baseDocumentRevision?: number
    stalePolicy?: 'warn' | 'reject'
}

export type CameraManagerAction = 'ADD' | 'DELETE' | 'UPDATE' | 'ADD_FROM_VIEW' | 'VIEW_CAMERA'

export type CameraManagerActionPayload =
    | (RevisionedCameraCommand & {
        action: 'ADD'
        payload: {
            camera: CameraDocumentEntry
        }
    })
    | (RevisionedCameraCommand & {
        action: 'DELETE' | 'VIEW_CAMERA'
        payload: {
            cameraIndex: number
        }
    })
    | (RevisionedCameraCommand & {
        action: 'UPDATE'
        payload: {
            cameraIndex: number
            updates: Partial<CameraDocumentEntry>
        }
    })
    | (RevisionedCameraCommand & {
        action: 'ADD_FROM_VIEW'
        payload?: undefined
    })

const DOCUMENT_WRITE_ACTIONS = new Set<CameraManagerAction>(['ADD', 'DELETE', 'UPDATE', 'ADD_FROM_VIEW'])

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)

const isCameraDocumentEntry = (value: unknown): value is CameraDocumentEntry =>
    isObjectRecord(value) && typeof value.Name === 'string'

const isCameraUpdates = (value: unknown): value is Partial<CameraDocumentEntry> =>
    isObjectRecord(value) && Object.keys(value).length > 0

const getCameraIndex = (value: unknown): number | null => {
    if (!isObjectRecord(value) || typeof value.cameraIndex !== 'number') {
        return null
    }
    return Number.isInteger(value.cameraIndex) ? value.cameraIndex : null
}

const normalizeCameraActionPayload = (payload: unknown): CameraManagerActionPayload | null => {
    if (!isObjectRecord(payload) || typeof payload.action !== 'string') {
        return null
    }

    const revisionEnvelope: Omit<RevisionedCameraCommand, 'action'> = {
        documentId: typeof payload.documentId === 'string' || payload.documentId === null ? payload.documentId : undefined,
        baseDocumentRevision: typeof payload.baseDocumentRevision === 'number' ? payload.baseDocumentRevision : undefined,
        stalePolicy: payload.stalePolicy === 'warn' || payload.stalePolicy === 'reject' ? payload.stalePolicy : undefined,
    }

    switch (payload.action) {
        case 'ADD': {
            const actionPayload = isObjectRecord(payload.payload) ? payload.payload.camera : null
            if (!isCameraDocumentEntry(actionPayload)) {
                return null
            }
            return {
                ...revisionEnvelope,
                action: 'ADD',
                payload: {
                    camera: actionPayload,
                },
            }
        }
        case 'DELETE':
        case 'VIEW_CAMERA': {
            const cameraIndex = getCameraIndex(payload.payload)
            if (cameraIndex === null) {
                return null
            }
            return {
                ...revisionEnvelope,
                action: payload.action,
                payload: {
                    cameraIndex,
                },
            }
        }
        case 'UPDATE': {
            const cameraIndex = getCameraIndex(payload.payload)
            const updates = isObjectRecord(payload.payload) ? payload.payload.updates : null
            if (cameraIndex === null || !isCameraUpdates(updates)) {
                return null
            }
            return {
                ...revisionEnvelope,
                action: 'UPDATE',
                payload: {
                    cameraIndex,
                    updates,
                },
            }
        }
        case 'ADD_FROM_VIEW':
            return {
                ...revisionEnvelope,
                action: 'ADD_FROM_VIEW',
            }
        default:
            return null
    }
}

const checkCameraCommandRevision = (payload: RevisionedCameraCommand | undefined): boolean => {
    const state = useModelStore.getState()
    const stalePolicy = payload?.stalePolicy ?? (payload?.action && DOCUMENT_WRITE_ACTIONS.has(payload.action) ? 'reject' : 'warn')
    markCommandReceived({
        source: 'CameraManagerCommandHandler',
        commandName: 'EXECUTE_CAMERA_ACTION',
        action: payload?.action ?? '',
        commandDocumentId: payload?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: payload?.baseDocumentRevision ?? '',
        activeDocumentRevision: state.documentRevision,
        stalePolicy,
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
        stalePolicy,
    })

    if (documentMismatch || stalePolicy === 'reject') {
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

        const actionPayload = normalizeCameraActionPayload(payload)
        if (!actionPayload) {
            markCommandRejected({
                source: 'CameraManagerCommandHandler',
                commandName: 'EXECUTE_CAMERA_ACTION',
                action: '',
                commandDocumentId: '',
                activeDocumentId: useModelStore.getState().documentId ?? '',
                baseDocumentRevision: '',
                activeDocumentRevision: useModelStore.getState().documentRevision,
                reason: 'invalid_payload',
            })
            return
        }
        if (!checkCameraCommandRevision(actionPayload)) {
            return
        }
        const action = actionPayload.action

        if (action === 'ADD') {
            const previousCameras = cloneCameras(dependencies.getCameras())
            const nextCameras = [...previousCameras, actionPayload.payload.camera]
            this.documentHandler.replaceCameraList({
                name: 'Add Camera',
                before: previousCameras,
                after: nextCameras,
            })
            dependencies.syncCameraManager()
            return
        }

        if (action === 'DELETE') {
            const cameraIndex = actionPayload.payload.cameraIndex
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
            const cameraIndex = actionPayload.payload.cameraIndex
            const updates = actionPayload.payload.updates
            const previousCameras = cloneCameras(dependencies.getCameras())
            if (cameraIndex >= 0 && cameraIndex < previousCameras.length) {
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
            const cameraIndex = actionPayload.payload.cameraIndex
            const cameras = dependencies.getCameras()
            const cameraNode = cameraIndex >= 0 && cameraIndex < cameras.length ? cameras[cameraIndex] : null
            if (cameraNode) {
                dependencies.viewportBridge.focusCamera(cameraNode)
            }
        }
    }
}

export const cameraManagerCommandHandler = new CameraManagerCommandHandler()
