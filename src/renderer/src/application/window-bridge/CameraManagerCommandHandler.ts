import type { CameraDocumentEntry, ModelDocumentCommandHandler } from '../commands'
import { modelDocumentCommandHandler } from '../commands'
import type { CameraViewportBridge } from './CameraViewportBridge'

export interface CameraManagerCommandDependencies {
    viewportBridge: CameraViewportBridge
    getCameras: () => CameraDocumentEntry[]
    syncCameraManager: () => void
}

const cloneCameras = (cameras: CameraDocumentEntry[]): CameraDocumentEntry[] =>
    structuredClone(cameras)

export class CameraManagerCommandHandler {
    constructor(
        private readonly documentHandler: ModelDocumentCommandHandler = modelDocumentCommandHandler,
    ) { }

    handle(command: string, payload: unknown, dependencies: CameraManagerCommandDependencies): void {
        if (command !== 'EXECUTE_CAMERA_ACTION') {
            return
        }

        const actionPayload = payload as { action?: string; payload?: any } | undefined
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
