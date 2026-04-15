/**
 * useKeyboardHandlers - Keyboard event handlers for the Viewer component
 * Handles view presets, undo/redo, and camera toggle
 */

import { useCallback, useEffect } from 'react'
import { vec3 } from 'gl-matrix'
import { useModelStore } from '../../../store/modelStore'
import { useSelectionStore } from '../../../store/selectionStore'
import { commandManager } from '../../../utils/CommandManager'
import { normalizeKeyComboFromEvent } from '../../../shortcuts/utils'
import { getPos } from '../types'
import type { CameraState } from '../types'

export interface UseKeyboardHandlersParams {
    targetCamera: React.MutableRefObject<CameraState>
    inCameraView: React.MutableRefObject<boolean>
    previousCameraState: React.MutableRefObject<CameraState | null>
    syncCameraToOrbit: () => void
    onToggleWireframe: () => void
}

export function useKeyboardHandlers({
    targetCamera,
    inCameraView,
    previousCameraState,
    syncCameraToOrbit,
    onToggleWireframe
}: UseKeyboardHandlersParams) {

    // Toggle camera view mode (~ key)
    const handleCameraViewToggle = useCallback(() => {
        if (inCameraView.current) {
            // Exit camera view: restore previous state if available
            if (previousCameraState.current) {
                targetCamera.current.distance = previousCameraState.current.distance
                targetCamera.current.theta = previousCameraState.current.theta
                targetCamera.current.phi = previousCameraState.current.phi
                vec3.set(
                    targetCamera.current.target,
                    previousCameraState.current.target[0],
                    previousCameraState.current.target[1],
                    previousCameraState.current.target[2]
                )
                previousCameraState.current = null
            } else {
                vec3.set(targetCamera.current.target, 0, 0, 0)
            }
            syncCameraToOrbit()
            inCameraView.current = false
        } else {
            // Enter camera view
            previousCameraState.current = {
                distance: targetCamera.current.distance,
                theta: targetCamera.current.theta,
                phi: targetCamera.current.phi,
                target: vec3.clone(targetCamera.current.target) as Float32Array
            }

            const selector = document.getElementById('camera-selector') as HTMLSelectElement
            if (selector && selector.value !== '-1') {
                const { nodes: storeNodes } = useModelStore.getState()
                const cameraList = storeNodes.filter((n: any) => n.type === 'Camera')
                const idx = parseInt(selector.value)

                if (idx >= 0 && idx < cameraList.length) {
                    const cam = cameraList[idx] as any
                    const pos = getPos(cam.Translation, cam.Position)
                    const target = getPos(cam.TargetTranslation, cam.TargetPosition)

                    const dx = pos[0] - target[0]
                    const dy = pos[1] - target[1]
                    const dz = pos[2] - target[2]
                    let distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
                    if (distance < 0.1) distance = 100

                    let phi = Math.acos(dz / distance)
                    if (isNaN(phi)) phi = Math.PI / 4
                    phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi))

                    let theta = Math.atan2(dy, dx)
                    if (isNaN(theta)) theta = 0

                    targetCamera.current.distance = distance
                    targetCamera.current.theta = theta
                    targetCamera.current.phi = phi
                    vec3.set(targetCamera.current.target, target[0], target[1], target[2])
                    syncCameraToOrbit()
                    inCameraView.current = true
                }
            }
        }
    }, [syncCameraToOrbit, targetCamera, inCameraView, previousCameraState])

    // Main keyboard handler
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        // Ignore if input is focused
        if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
            return
        }

        const combo = normalizeKeyComboFromEvent(e)
        if (!combo) return

        switch (combo) {
            case 'F': // Toggle wireframe/textured render mode
                onToggleWireframe()
                break
            case '0': // Camera Reset / Focus
                vec3.set(targetCamera.current.target, 0, 0, 0)
                targetCamera.current.distance = 500
                targetCamera.current.theta = Math.PI / 4
                targetCamera.current.phi = Math.PI / 4
                syncCameraToOrbit()
                break
            case '1': // Front
                targetCamera.current.theta = -Math.PI / 2
                targetCamera.current.phi = Math.PI / 2
                syncCameraToOrbit()
                break
            case '2': // Back
                targetCamera.current.theta = Math.PI / 2
                targetCamera.current.phi = Math.PI / 2
                syncCameraToOrbit()
                break
            case '3': // Left
                targetCamera.current.theta = 0
                targetCamera.current.phi = Math.PI / 2
                syncCameraToOrbit()
                break
            case '4': // Right
                targetCamera.current.theta = Math.PI
                targetCamera.current.phi = Math.PI / 2
                syncCameraToOrbit()
                break
            case '5': // Top
                targetCamera.current.phi = 0.01
                syncCameraToOrbit()
                break
            case '6': // Bottom
                targetCamera.current.phi = Math.PI - 0.01
                syncCameraToOrbit()
                break
            case 'Backquote':
            case 'Shift+Backquote': // View selected camera (~ key) - Toggle mode
                handleCameraViewToggle()
                break
            case 'Ctrl+Z':
            case 'Meta+Z':
                commandManager.undo()
                break
            case 'Ctrl+Shift+Z':
            case 'Meta+Shift+Z':
            case 'Ctrl+Y':
            case 'Meta+Y':
                commandManager.redo()
                break
        }
    }, [handleCameraViewToggle, onToggleWireframe, syncCameraToOrbit, targetCamera])

    // Transform mode keyboard shortcuts (W, E, R)
    useEffect(() => {
        const handleTransformKeys = (e: KeyboardEvent) => {
            if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return

            const combo = normalizeKeyComboFromEvent(e)
            if (combo === 'W') useSelectionStore.getState().setTransformMode('translate')
            if (combo === 'E') useSelectionStore.getState().setTransformMode('rotate')
            if (combo === 'R') useSelectionStore.getState().setTransformMode('scale')
        }
        window.addEventListener('keydown', handleTransformKeys)
        return () => window.removeEventListener('keydown', handleTransformKeys)
    }, [])

    // Undo/Redo keyboard shortcuts (separate effect)
    useEffect(() => {
        const handleUndoRedo = (e: KeyboardEvent) => {
            if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return

            const combo = normalizeKeyComboFromEvent(e)
            if (combo === 'Ctrl+Z' || combo === 'Meta+Z') {
                e.preventDefault()
                commandManager.undo()
            } else if (
                combo === 'Ctrl+Y' ||
                combo === 'Meta+Y' ||
                combo === 'Ctrl+Shift+Z' ||
                combo === 'Meta+Shift+Z'
            ) {
                e.preventDefault()
                commandManager.redo()
            }
        }
        window.addEventListener('keydown', handleUndoRedo)
        return () => window.removeEventListener('keydown', handleUndoRedo)
    }, [])

    return {
        handleKeyDown,
        handleCameraViewToggle
    }
}
