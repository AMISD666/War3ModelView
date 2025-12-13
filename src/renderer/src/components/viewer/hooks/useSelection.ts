/**
 * useSelection - Selection logic for the Viewer component
 * Handles box selection and single-click selection for vertices, faces, and nodes
 */

import { useCallback } from 'react'
import { vec3, vec4, mat4 } from 'gl-matrix'
import { useSelectionStore } from '../../../store/selectionStore'
import { useModelStore } from '../../../store/modelStore'
import { pickClosestGeoset } from '../../../utils/rayTriangle'
import type { CameraState } from '../types'
import { SimpleOrbitCamera } from '../../../utils/SimpleOrbitCamera'

export interface UseSelectionParams {
    rendererRef: React.MutableRefObject<any>
    canvasRef: React.RefObject<HTMLCanvasElement>
    cameraRef: React.MutableRefObject<SimpleOrbitCamera | null>
    targetCamera: React.MutableRefObject<CameraState>
}

/**
 * Project a 3D point to screen coordinates
 */
function projectPoint(
    point: vec3,
    viewProj: mat4,
    viewport: [number, number, number, number]
): vec3 | null {
    const v4 = [point[0], point[1], point[2], 1.0]
    const clip = [0, 0, 0, 0]

    clip[0] = v4[0] * viewProj[0] + v4[1] * viewProj[4] + v4[2] * viewProj[8] + v4[3] * viewProj[12]
    clip[1] = v4[0] * viewProj[1] + v4[1] * viewProj[5] + v4[2] * viewProj[9] + v4[3] * viewProj[13]
    clip[2] = v4[0] * viewProj[2] + v4[1] * viewProj[6] + v4[2] * viewProj[10] + v4[3] * viewProj[14]
    clip[3] = v4[0] * viewProj[3] + v4[1] * viewProj[7] + v4[2] * viewProj[11] + v4[3] * viewProj[15]

    if (clip[3] === 0 || clip[3] < 0) return null

    const ndc = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]]
    const x = (ndc[0] + 1) * 0.5 * viewport[2]
    const y = (1 - ndc[1]) * 0.5 * viewport[3]

    return vec3.fromValues(x, y, ndc[2])
}

/**
 * Calculate camera position from spherical coordinates
 */
function getCameraPosition(cameraState: CameraState): vec3 {
    const { distance, theta, phi, target } = cameraState
    const cameraPos = vec3.create()
    const cameraX = distance * Math.sin(phi) * Math.cos(theta)
    const cameraY = distance * Math.sin(phi) * Math.sin(theta)
    const cameraZ = distance * Math.cos(phi)
    vec3.set(cameraPos, cameraX, cameraY, cameraZ)
    vec3.add(cameraPos, cameraPos, target)
    return cameraPos
}

export function useSelection({
    rendererRef,
    canvasRef,
    cameraRef,
    targetCamera
}: UseSelectionParams) {

    /**
     * Handle box selection
     */
    const handleBoxSelection = useCallback((
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        isShift: boolean,
        isCtrl: boolean
    ) => {
        if (!rendererRef.current || !canvasRef.current) return

        const {
            mainMode, animationSubMode, geometrySubMode,
            addVertexSelection, addFaceSelection, removeVertexSelection, removeFaceSelection,
            selectVertices, selectFaces, selectNodes
        } = useSelectionStore.getState()

        if (mainMode !== 'geometry' && mainMode !== 'animation') return

        const rect = canvasRef.current.getBoundingClientRect()
        const boxLeft = Math.min(startX, endX) - rect.left
        const boxRight = Math.max(startX, endX) - rect.left
        const boxTop = Math.min(startY, endY) - rect.top
        const boxBottom = Math.max(startY, endY) - rect.top

        const cameraPos = getCameraPosition(targetCamera.current)

        const pMatrix = mat4.create()
        mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 100000)

        const mvMatrix = mat4.create()
        const cameraUp = vec3.fromValues(0, 0, 1)
        mat4.lookAt(mvMatrix, cameraPos, targetCamera.current.target, cameraUp)

        const viewProj = mat4.create()
        mat4.multiply(viewProj, pMatrix, mvMatrix)

        const viewport: [number, number, number, number] = [0, 0, canvasRef.current.width, canvasRef.current.height]

        const isInBox = (screenPos: vec3 | null): boolean => {
            if (!screenPos) return false
            return screenPos[0] >= boxLeft && screenPos[0] <= boxRight &&
                screenPos[1] >= boxTop && screenPos[1] <= boxBottom
        }

        // Vertex selection (Geometry mode or Animation Binding mode)
        if (geometrySubMode === 'vertex' || (mainMode === 'animation' && animationSubMode === 'binding')) {
            const newSelection: { geosetIndex: number, index: number }[] = []

            // Get hidden geoset IDs to skip during selection
            const { hiddenGeosetIds, forceShowAllGeosets } = useModelStore.getState()

            for (let i = 0; i < rendererRef.current.model.Geosets.length; i++) {
                // Skip hidden geosets
                if (!forceShowAllGeosets && hiddenGeosetIds.includes(i)) continue

                const geoset = rendererRef.current.model.Geosets[i]
                const vertices = geoset.Vertices

                for (let j = 0; j < vertices.length; j += 3) {
                    const v = vec3.fromValues(vertices[j], vertices[j + 1], vertices[j + 2])
                    const screenPos = projectPoint(v, viewProj, viewport)
                    if (isInBox(screenPos)) {
                        newSelection.push({ geosetIndex: i, index: j / 3 })
                    }
                }
            }

            if (isShift) {
                removeVertexSelection(newSelection)
            } else if (isCtrl) {
                addVertexSelection(newSelection)
            } else {
                selectVertices(newSelection)
            }

        } else if (geometrySubMode === 'face') {
            const newSelection: { geosetIndex: number, index: number }[] = []

            // Get hidden geoset IDs to skip during selection
            const { hiddenGeosetIds, forceShowAllGeosets } = useModelStore.getState()

            for (let i = 0; i < rendererRef.current.model.Geosets.length; i++) {
                // Skip hidden geosets
                if (!forceShowAllGeosets && hiddenGeosetIds.includes(i)) continue

                const geoset = rendererRef.current.model.Geosets[i]
                const faces = geoset.Faces
                const vertices = geoset.Vertices

                for (let j = 0; j < faces.length; j += 3) {
                    const idx0 = faces[j] * 3
                    const idx1 = faces[j + 1] * 3
                    const idx2 = faces[j + 2] * 3

                    const v0 = vec3.fromValues(vertices[idx0], vertices[idx0 + 1], vertices[idx0 + 2])
                    const v1 = vec3.fromValues(vertices[idx1], vertices[idx1 + 1], vertices[idx1 + 2])
                    const v2 = vec3.fromValues(vertices[idx2], vertices[idx2 + 1], vertices[idx2 + 2])

                    const s0 = projectPoint(v0, viewProj, viewport)
                    const s1 = projectPoint(v1, viewProj, viewport)
                    const s2 = projectPoint(v2, viewProj, viewport)

                    if (isInBox(s0) || isInBox(s1) || isInBox(s2)) {
                        newSelection.push({ geosetIndex: i, index: j / 3 })
                    }
                }
            }

            if (isShift) {
                removeFaceSelection(newSelection)
            } else if (isCtrl) {
                addFaceSelection(newSelection)
            } else {
                selectFaces(newSelection)
            }

        } else if (mainMode === 'animation' && animationSubMode !== 'binding') {
            // Node box selection
            const newSelection: number[] = []
            if (!rendererRef.current.rendererData?.nodes) return

            rendererRef.current.rendererData.nodes.forEach((nodeWrapper: any) => {
                const pivot = nodeWrapper.node.PivotPoint
                const worldPos = vec3.create()
                vec3.transformMat4(worldPos, pivot, nodeWrapper.matrix)

                const screenPos = projectPoint(worldPos, viewProj, viewport)
                if (isInBox(screenPos)) {
                    newSelection.push(nodeWrapper.node.ObjectId)
                }
            })

            if (isCtrl) {
                const current = useSelectionStore.getState().selectedNodeIds
                const combined = Array.from(new Set([...current, ...newSelection]))
                selectNodes(combined)
            } else {
                selectNodes(newSelection)
            }
        }
    }, [rendererRef, canvasRef, targetCamera])

    /**
     * Handle single-click selection
     */
    const handleSelectionClick = useCallback((
        clientX: number,
        clientY: number,
        isShift: boolean,
        isCtrl: boolean
    ) => {
        if (!rendererRef.current || !canvasRef.current) return

        const {
            mainMode, animationSubMode, geometrySubMode,
            selectVertex, selectFace, addVertexSelection, addFaceSelection,
            removeVertexSelection, removeFaceSelection, clearAllSelections,
            selectNode, setPickedGeosetIndex
        } = useSelectionStore.getState()

        const rect = canvasRef.current.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top

        // === Ctrl+Click Geoset Picking ===
        if (isCtrl) {
            const pMatrix = mat4.create()
            const mvMatrix = mat4.create()
            const cameraPos = vec3.create()

            if (cameraRef.current) {
                cameraRef.current.getMatrix(mvMatrix, pMatrix)
                vec3.copy(cameraPos, cameraRef.current.position)
            } else {
                const camPos = getCameraPosition(targetCamera.current)
                vec3.copy(cameraPos, camPos)
                mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 100000)
                const cameraUp = vec3.fromValues(0, 0, 1)
                mat4.lookAt(mvMatrix, cameraPos, targetCamera.current.target, cameraUp)
            }

            const ndcX = (x / canvasRef.current.width) * 2 - 1
            const ndcY = 1 - (y / canvasRef.current.height) * 2

            const invProj = mat4.create()
            mat4.invert(invProj, pMatrix)

            const invView = mat4.create()
            mat4.invert(invView, mvMatrix)

            const rayClip4 = vec4.fromValues(ndcX, ndcY, -1.0, 1.0)
            const rayEye4 = vec4.create()
            vec4.transformMat4(rayEye4, rayClip4, invProj)
            rayEye4[2] = -1.0
            rayEye4[3] = 0.0

            const rayWorld4 = vec4.create()
            vec4.transformMat4(rayWorld4, rayEye4, invView)

            const rayDir = vec3.fromValues(rayWorld4[0], rayWorld4[1], rayWorld4[2])
            vec3.normalize(rayDir, rayDir)

            const geosets = rendererRef.current.model.Geosets || []
            const result = pickClosestGeoset(cameraPos, rayDir, geosets)

            if (result !== null) {
                console.log('[useSelection] Ctrl+Click picked geoset:', result.geosetIndex)
                setPickedGeosetIndex(result.geosetIndex)

                const { setHoveredGeosetId, setSelectedGeosetIndex } = useModelStore.getState()
                setHoveredGeosetId(result.geosetIndex)
                setSelectedGeosetIndex(result.geosetIndex)
                setTimeout(() => setHoveredGeosetId(null), 300)
                return
            } else {
                setPickedGeosetIndex(null)
            }
        }

        // === Animation Mode: Node Selection ===
        if (mainMode === 'animation') {
            const cameraPos = getCameraPosition(targetCamera.current)

            const pMatrix = mat4.create()
            mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 100000)

            const mvMatrix = mat4.create()
            const cameraUp = vec3.fromValues(0, 0, 1)
            mat4.lookAt(mvMatrix, cameraPos, targetCamera.current.target, cameraUp)

            const viewProj = mat4.create()
            mat4.multiply(viewProj, pMatrix, mvMatrix)
            const viewport: [number, number, number, number] = [0, 0, canvasRef.current.width, canvasRef.current.height]

            let closestNodeId = -1
            let minDist = 20

            if (rendererRef.current.rendererData?.nodes) {
                rendererRef.current.rendererData.nodes.forEach((nodeWrapper: any) => {
                    const pivot = nodeWrapper.node.PivotPoint
                    const worldPos = vec3.create()
                    vec3.transformMat4(worldPos, pivot, nodeWrapper.matrix)

                    const screenPos = projectPoint(worldPos, viewProj, viewport)
                    if (screenPos) {
                        const dx = screenPos[0] - x
                        const dy = screenPos[1] - y
                        const d = Math.sqrt(dx * dx + dy * dy)
                        if (d < minDist) {
                            minDist = d
                            closestNodeId = nodeWrapper.node.ObjectId
                        }
                    }
                })
            }

            if (closestNodeId !== -1) {
                selectNode(closestNodeId, isCtrl)
                return
            } else if (!isCtrl && animationSubMode !== 'binding') {
                selectNode(-1)
            }

            if (animationSubMode !== 'binding') return
        }

        // === Geometry Mode: Vertex/Face Selection ===
        if (mainMode !== 'geometry' && !(mainMode === 'animation' && animationSubMode === 'binding')) return

        const cameraPos = getCameraPosition(targetCamera.current)

        const pMatrix = mat4.create()
        mat4.perspective(pMatrix, Math.PI / 4, canvasRef.current.width / canvasRef.current.height, 1, 100000)

        const mvMatrix = mat4.create()
        const cameraUp = vec3.fromValues(0, 0, 1)
        mat4.lookAt(mvMatrix, cameraPos, targetCamera.current.target, cameraUp)

        const ndcX = (x / canvasRef.current.width) * 2 - 1
        const ndcY = 1 - (y / canvasRef.current.height) * 2

        const invProj = mat4.create()
        mat4.invert(invProj, pMatrix)

        const invView = mat4.create()
        mat4.invert(invView, mvMatrix)

        const rayClip = vec4.fromValues(ndcX, ndcY, -1.0, 1.0)
        const rayEye = vec4.create()
        vec4.transformMat4(rayEye, rayClip, invProj)
        rayEye[2] = -1.0
        rayEye[3] = 0.0

        const rayWorld = vec4.create()
        vec4.transformMat4(rayWorld, rayEye, invView)
        const rayDir = vec3.fromValues(rayWorld[0], rayWorld[1], rayWorld[2])
        vec3.normalize(rayDir, rayDir)

        const effectiveSubMode = (mainMode === 'animation' && animationSubMode === 'binding') ? 'vertex' : geometrySubMode

        const result = rendererRef.current.raycast(cameraPos, rayDir, effectiveSubMode)

        if (result) {
            if (effectiveSubMode === 'vertex') {
                const sel = result as { geosetIndex: number, index: number }
                if (isShift) {
                    removeVertexSelection([sel])
                } else if (isCtrl) {
                    addVertexSelection([sel])
                } else {
                    selectVertex(sel, false)
                }
            } else if (geometrySubMode === 'face') {
                const sel = result as { geosetIndex: number, index: number }
                if (isShift) {
                    removeFaceSelection([sel])
                } else if (isCtrl) {
                    addFaceSelection([sel])
                } else {
                    selectFace(sel, false)
                }
            }
        } else if (!isShift && !isCtrl) {
            clearAllSelections()
        }
    }, [rendererRef, canvasRef, cameraRef, targetCamera])

    return {
        handleBoxSelection,
        handleSelectionClick
    }
}
