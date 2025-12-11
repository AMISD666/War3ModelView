/**
 * useViewerCamera - Camera state and control hook for the Viewer component
 */

import { useRef, useCallback } from 'react'
import { vec3 } from 'gl-matrix'
import { SimpleOrbitCamera } from '../../../utils/SimpleOrbitCamera'

export interface CameraState {
    distance: number
    theta: number
    phi: number
    target: Float32Array
}

export interface ViewerCameraRef {
    camera: SimpleOrbitCamera | null
    targetCamera: React.MutableRefObject<CameraState>
    inCameraView: React.MutableRefObject<boolean>
    previousCameraState: React.MutableRefObject<CameraState | null>
    syncCameraToOrbit: () => void
    resetCamera: () => void
    getCamera: () => { distance: number; theta: number; phi: number; target: [number, number, number] }
    setCamera: (params: { distance: number; theta: number; phi: number; target: [number, number, number] }) => void
    applyViewPreset: (preset: string) => void
}

export function useViewerCamera(canvasRef: React.RefObject<HTMLCanvasElement>): ViewerCameraRef {
    const cameraRef = useRef<SimpleOrbitCamera | null>(null)

    // Initialize camera if not already created
    if (canvasRef.current && !cameraRef.current) {
        cameraRef.current = new SimpleOrbitCamera(canvasRef.current)
    }

    // Camera state backup for target-based orbit
    const targetCamera = useRef<CameraState>({
        distance: 500,
        theta: Math.PI / 4,
        phi: Math.PI / 4,
        target: new Float32Array([0, 0, 0])
    })

    // Track if currently viewing a model camera (for ~ toggle)
    const inCameraView = useRef(false)

    // Store previous camera state to restore after exiting camera view
    const previousCameraState = useRef<CameraState | null>(null)

    // Helper to sync targetCamera state to SimpleOrbitCamera
    const syncCameraToOrbit = useCallback(() => {
        if (cameraRef.current) {
            cameraRef.current.distance = targetCamera.current.distance
            cameraRef.current.horizontalAngle = targetCamera.current.theta + Math.PI / 2
            cameraRef.current.verticalAngle = targetCamera.current.phi
            vec3.copy(cameraRef.current.target, targetCamera.current.target)
            cameraRef.current.update()
        }
    }, [])

    const resetCamera = useCallback(() => {
        vec3.set(targetCamera.current.target, 0, 0, 0)
        targetCamera.current.distance = 500
        targetCamera.current.theta = Math.PI / 4
        targetCamera.current.phi = Math.PI / 4
        syncCameraToOrbit()
    }, [syncCameraToOrbit])

    const getCamera = useCallback(() => {
        // Read from SimpleOrbitCamera (actual camera used by render loop)
        if (cameraRef.current) {
            return {
                distance: cameraRef.current.distance,
                theta: cameraRef.current.horizontalAngle - Math.PI / 2, // Convert back from horizontalAngle
                phi: cameraRef.current.verticalAngle,
                target: [
                    cameraRef.current.target[0],
                    cameraRef.current.target[1],
                    cameraRef.current.target[2]
                ] as [number, number, number]
            }
        }
        // Fallback to targetCamera
        return {
            distance: targetCamera.current.distance,
            theta: targetCamera.current.theta,
            phi: targetCamera.current.phi,
            target: [
                targetCamera.current.target[0],
                targetCamera.current.target[1],
                targetCamera.current.target[2]
            ] as [number, number, number]
        }
    }, [])

    const setCamera = useCallback((params: { distance: number; theta: number; phi: number; target: [number, number, number] }) => {
        console.log('[useViewerCamera] Setting camera:', params)
        const clampedPhi = Math.max(0.01, Math.min(Math.PI - 0.01, params.phi))

        // Update targetCamera (backup/fallback)
        targetCamera.current.distance = params.distance
        targetCamera.current.theta = params.theta
        targetCamera.current.phi = clampedPhi
        vec3.set(targetCamera.current.target, params.target[0], params.target[1], params.target[2])

        // CRITICAL: Also update SimpleOrbitCamera which is actually used by the render loop
        if (cameraRef.current) {
            cameraRef.current.distance = params.distance
            cameraRef.current.horizontalAngle = params.theta + Math.PI / 2 // Theta to horizontalAngle offset
            cameraRef.current.verticalAngle = clampedPhi
            vec3.set(cameraRef.current.target, params.target[0], params.target[1], params.target[2])
            cameraRef.current.update()
        }
    }, [])

    const applyViewPreset = useCallback((preset: string) => {
        switch (preset) {
            case 'front':
                targetCamera.current.theta = -Math.PI / 2
                targetCamera.current.phi = Math.PI / 2
                break
            case 'back':
                targetCamera.current.theta = Math.PI / 2
                targetCamera.current.phi = Math.PI / 2
                break
            case 'left':
                targetCamera.current.theta = 0
                targetCamera.current.phi = Math.PI / 2
                break
            case 'right':
                targetCamera.current.theta = Math.PI
                targetCamera.current.phi = Math.PI / 2
                break
            case 'top':
                targetCamera.current.phi = 0.01
                break
            case 'bottom':
                targetCamera.current.phi = Math.PI - 0.01
                break
            case 'focus':
                resetCamera()
                return // resetCamera already calls syncCameraToOrbit
        }
        syncCameraToOrbit()
    }, [syncCameraToOrbit, resetCamera])

    return {
        camera: cameraRef.current,
        targetCamera,
        inCameraView,
        previousCameraState,
        syncCameraToOrbit,
        resetCamera,
        getCamera,
        setCamera,
        applyViewPreset
    }
}
