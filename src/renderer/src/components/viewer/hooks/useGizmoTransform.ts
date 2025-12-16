/**
 * useGizmoTransform - Gizmo transformation logic for the Viewer component
 * Handles translation, rotation, and scaling of vertices and nodes via gizmo dragging
 */

import { useCallback } from 'react'
import { vec3, mat4 } from 'gl-matrix'
import { useSelectionStore } from '../../../store/selectionStore'
import { useModelStore } from '../../../store/modelStore'
import type { GizmoAxis, CameraState } from '../types'

export interface UseGizmoTransformParams {
    rendererRef: React.MutableRefObject<any>
    targetCamera: React.MutableRefObject<CameraState>
    gizmoState: React.MutableRefObject<{
        activeAxis: GizmoAxis
        isDragging: boolean
        dragStartPos: vec3 | null
    }>
    animationSubMode: string
}

/**
 * Get move scale factor based on camera distance
 */
function getMoveScale(cameraState: CameraState): number {
    return cameraState.distance * 0.002
}

/**
 * Get move vector based on axis - unified movement for all axes
 * Screen X controls world X (horizontal drag), Screen Y controls world Y/Z (vertical drag)
 * Note: Screen deltaY is negative when dragging up, so we negate it for Y/Z axes
 */
function getMoveVectorForAxis(deltaX: number, deltaY: number, moveScale: number, axis: GizmoAxis): vec3 {
    const moveVec = vec3.create()
    // Use horizontal screen movement for horizontal world axes
    // Use vertical screen movement for vertical world axis
    // Screen Y is inverted (negative when dragging up), so negate for natural feel
    if (axis === 'x') moveVec[0] = deltaX * moveScale       // Horizontal drag moves X
    else if (axis === 'y') moveVec[1] = -deltaY * moveScale // Drag up = positive Y
    else if (axis === 'z') moveVec[2] = -deltaY * moveScale // Drag up = positive Z
    else if (axis === 'xy') { moveVec[0] = deltaX * moveScale; moveVec[1] = -deltaY * moveScale }
    else if (axis === 'xz') { moveVec[0] = deltaX * moveScale; moveVec[2] = -deltaY * moveScale }
    else if (axis === 'yz') { moveVec[1] = -deltaY * moveScale; moveVec[2] = deltaX * moveScale }
    return moveVec
}

/**
 * 自动K帧：为选中节点在当前帧添加 Translation 关键帧
 */
function autoKeyframeTranslation(nodeId: number, translation: [number, number, number]) {
    const { autoKeyframe, currentFrame, nodes, updateNode } = useModelStore.getState()
    if (!autoKeyframe) return

    const node = nodes.find((n: any) => n.ObjectId === nodeId)
    if (!node) return

    const frame = Math.round(currentFrame)
    const existingProp = node.Translation || { Keys: [], InterpolationType: 1 }
    const keys = [...(existingProp.Keys || [])]

    // 查找或创建关键帧
    const existingKeyIndex = keys.findIndex((k: any) => Math.abs(k.Frame - frame) < 0.1)

    if (existingKeyIndex >= 0) {
        keys[existingKeyIndex] = { ...keys[existingKeyIndex], Vector: translation }
    } else {
        keys.push({ Frame: frame, Vector: translation })
        keys.sort((a: any, b: any) => a.Frame - b.Frame)
    }

    updateNode(nodeId, {
        Translation: { ...existingProp, Keys: keys }
    })
}

/**
 * Convert World Space delta to Local Space delta
 * Uses the inverse of the parent's rotation matrix to transform the delta
 */
function worldDeltaToLocalDelta(renderer: any, nodeId: number, worldDelta: vec3): vec3 {
    if (!renderer || !renderer.rendererData || !renderer.rendererData.nodes) {
        return worldDelta; // Fallback: use world delta as-is
    }

    const nodes = renderer.rendererData.nodes;
    const nodeWrapper = nodes.find((n: any) => n.node && n.node.ObjectId === nodeId);

    if (!nodeWrapper || !nodeWrapper.node) return worldDelta;

    const parentId = nodeWrapper.node.Parent;
    if (parentId === undefined || parentId === -1) {
        // No parent, Local == World
        return worldDelta;
    }

    const parentWrapper = nodes.find((n: any) => n.node && n.node.ObjectId === parentId);
    if (!parentWrapper || !parentWrapper.matrix) {
        // Parent invalid, treat as root
        return worldDelta;
    }

    // Extract rotation from parent matrix (upper-left 3x3)
    const parentMat = parentWrapper.matrix;

    // Create a 3x3 rotation matrix from the 4x4 matrix
    // For delta transformation, we only need the inverse rotation (transpose for orthonormal)
    // Parent matrix transforms Local -> World
    // Inverse (transpose for rotation) transforms World -> Local
    const invRotation = mat4.create();

    // Copy rotation part and transpose it (for orthonormal matrices, transpose = inverse)
    invRotation[0] = parentMat[0];
    invRotation[1] = parentMat[4];
    invRotation[2] = parentMat[8];
    invRotation[4] = parentMat[1];
    invRotation[5] = parentMat[5];
    invRotation[6] = parentMat[9];
    invRotation[8] = parentMat[2];
    invRotation[9] = parentMat[6];
    invRotation[10] = parentMat[10];
    // No translation for delta transformation
    invRotation[12] = 0;
    invRotation[13] = 0;
    invRotation[14] = 0;
    invRotation[15] = 1;

    // Transform world delta to local delta
    const localDelta = vec3.create();
    vec3.transformMat4(localDelta, worldDelta, invRotation);

    console.log('[worldDeltaToLocalDelta] nodeId:', nodeId, 'parentId:', parentId,
        'worldDelta:', [worldDelta[0].toFixed(2), worldDelta[1].toFixed(2), worldDelta[2].toFixed(2)],
        'localDelta:', [localDelta[0].toFixed(2), localDelta[1].toFixed(2), localDelta[2].toFixed(2)]);

    return localDelta;
}

export function useGizmoTransform({
    rendererRef,
    targetCamera,
    gizmoState,
    animationSubMode
}: UseGizmoTransformParams) {

    /**
     * Handle gizmo drag for transformations
     */
    const handleGizmoDrag = useCallback((deltaX: number, deltaY: number) => {
        const { transformMode, mainMode, animationSubMode: subMode } = useSelectionStore.getState()
        const axis = gizmoState.current.activeAxis

        console.log('[handleGizmoDrag] mainMode:', mainMode, 'subMode:', subMode, 'transformMode:', transformMode, 'axis:', axis)

        if (!axis) return
        // 支持 geometry 模式、animation/binding 模式、animation/keyframe 模式
        const isGeometry = mainMode === 'geometry'
        const isBinding = mainMode === 'animation' && subMode === 'binding'
        const isKeyframe = mainMode === 'animation' && subMode === 'keyframe'

        if (!isGeometry && !isBinding && !isKeyframe) {
            console.log('[handleGizmoDrag] skipped: not in valid mode')
            return
        }

        const moveScale = getMoveScale(targetCamera.current)

        // === TRANSLATE MODE ===
        if (transformMode === 'translate') {
            if (isGeometry) {
                handleTranslateVertices(deltaX, deltaY, axis, moveScale)
            } else if (isBinding) {
                handleTranslateNodes(deltaX, deltaY, axis, moveScale)
            } else if (isKeyframe) {
                console.log('[Gizmo Keyframe] deltaX:', deltaX, 'deltaY:', deltaY, 'axis:', axis, 'moveScale:', moveScale)
                handleTranslateNodesKeyframe(deltaX, deltaY, axis, moveScale)
            }
        } else if (transformMode === 'rotate' || transformMode === 'scale') {
            if (isGeometry) {
                handleRotateOrScaleVertices(deltaX, deltaY, transformMode, axis)
            }
        }
    }, [targetCamera, gizmoState, rendererRef])

    /**
     * Translate vertices in geometry mode
     */
    const handleTranslateVertices = useCallback((
        deltaX: number,
        deltaY: number,
        axis: GizmoAxis,
        moveScale: number
    ) => {
        if (!rendererRef.current) return

        const moveVec = getMoveVectorForAxis(deltaX, deltaY, moveScale, axis)
        const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()
        const affectedGeosets = new Set<number>()

        const updateVertex = (geosetIndex: number, vertexIndex: number, updateFn: (v: Float32Array, idx: number) => void) => {
            const geoset = rendererRef.current.model.Geosets[geosetIndex]
            if (!geoset) return
            updateFn(geoset.Vertices, vertexIndex * 3)
            affectedGeosets.add(geosetIndex)
        }

        const applyToSelection = (updateFn: (v: Float32Array, idx: number) => void) => {
            if (geometrySubMode === 'vertex') {
                selectedVertexIds.forEach(sel => updateVertex(sel.geosetIndex, sel.index, updateFn))
            } else if (geometrySubMode === 'face') {
                selectedFaceIds.forEach(sel => {
                    const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
                    if (geoset) {
                        const fIndex = sel.index * 3
                        updateVertex(sel.geosetIndex, geoset.Faces[fIndex], updateFn)
                        updateVertex(sel.geosetIndex, geoset.Faces[fIndex + 1], updateFn)
                        updateVertex(sel.geosetIndex, geoset.Faces[fIndex + 2], updateFn)
                    }
                })
            }
        }

        applyToSelection((v, i) => {
            v[i] += moveVec[0]
            v[i + 1] += moveVec[1]
            v[i + 2] += moveVec[2]
        })

        // Update GPU buffers
        affectedGeosets.forEach(geosetIndex => {
            const geoset = rendererRef.current.model.Geosets[geosetIndex]
            if ((rendererRef.current as any).updateGeosetVertices) {
                (rendererRef.current as any).updateGeosetVertices(geosetIndex, geoset.Vertices)
            }
        })
    }, [rendererRef])

    /**
     * Translate nodes in animation binding mode
     */
    const handleTranslateNodes = useCallback((deltaX: number, deltaY: number, axis: GizmoAxis, moveScale: number) => {
        if (!rendererRef.current?.rendererData?.nodes) return

        const moveVec = getMoveVectorForAxis(deltaX, deltaY, moveScale, axis)
        const { selectedNodeIds } = useSelectionStore.getState()

        selectedNodeIds.forEach(nodeId => {
            const nodeWrapper = rendererRef.current.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
            if (nodeWrapper?.node.PivotPoint) {
                nodeWrapper.node.PivotPoint[0] += moveVec[0]
                nodeWrapper.node.PivotPoint[1] += moveVec[1]
                nodeWrapper.node.PivotPoint[2] += moveVec[2]
            }
        })
    }, [rendererRef])

    /**
     * Translate nodes in keyframe mode - updates animation Translation property
     * Accumulates delta and creates keyframe when drag ends
     */
    const keyframeDragDelta = { current: vec3.create() } // 累积拖拽偏移量

    const handleTranslateNodesKeyframe = useCallback((deltaX: number, deltaY: number, axis: GizmoAxis, moveScale: number) => {
        console.log('[handleTranslateNodesKeyframe] called')
        if (!rendererRef.current?.rendererData?.nodes) {
            console.log('[handleTranslateNodesKeyframe] no renderer nodes')
            return
        }

        // World Space delta from screen movement
        const worldDelta = getMoveVectorForAxis(deltaX, deltaY, moveScale, axis)
        const { selectedNodeIds } = useSelectionStore.getState()
        console.log('[handleTranslateNodesKeyframe] selectedNodeIds:', selectedNodeIds, 'worldDelta:', [worldDelta[0], worldDelta[1], worldDelta[2]])

        selectedNodeIds.forEach(nodeId => {
            const nodeWrapper = rendererRef.current.rendererData.nodes.find((n: any) => n.node.ObjectId === nodeId)
            console.log('[handleTranslateNodesKeyframe] nodeId:', nodeId, 'nodeWrapper:', !!nodeWrapper)
            if (nodeWrapper?.node) {
                // Convert World Space delta to Local Space delta using parent's inverse rotation
                const localDelta = worldDeltaToLocalDelta(rendererRef.current, nodeId, worldDelta)

                // 累积拖拽偏移量（用于关键帧）- now using local delta
                vec3.add(keyframeDragDelta.current, keyframeDragDelta.current, localDelta)

                // 获取当前关键帧值并添加增量（实时预览）
                const { currentFrame, nodes, autoKeyframe } = useModelStore.getState()
                const storeNode = nodes.find((n: any) => n.ObjectId === nodeId)
                const frame = Math.round(currentFrame)
                console.log('[handleTranslateNodesKeyframe] autoKeyframe:', autoKeyframe, 'frame:', frame, 'storeNode:', !!storeNode)

                // 从现有关键帧获取当前位置或使用 [0,0,0]
                let currentTranslation = [0, 0, 0]
                if (storeNode?.Translation?.Keys) {
                    const exactKey = storeNode.Translation.Keys.find((k: any) => Math.abs(k.Frame - frame) < 0.1)
                    if (exactKey?.Vector) {
                        currentTranslation = [...exactKey.Vector]
                    }
                }

                // 计算新的位移值 - using LOCAL delta now
                const newTranslation: [number, number, number] = [
                    currentTranslation[0] + localDelta[0],
                    currentTranslation[1] + localDelta[1],
                    currentTranslation[2] + localDelta[2]
                ]
                console.log('[handleTranslateNodesKeyframe] newTranslation:', newTranslation)

                // 如果自动K帧开启，创建/更新关键帧
                autoKeyframeTranslation(nodeId, newTranslation)
            }
        })
    }, [rendererRef])

    /**
     * Rotate or scale vertices
     */
    const handleRotateOrScaleVertices = useCallback((
        deltaX: number,
        deltaY: number,
        transformMode: 'rotate' | 'scale',
        axis: GizmoAxis
    ) => {
        if (!rendererRef.current) return

        const { selectedVertexIds, selectedFaceIds, geometrySubMode } = useSelectionStore.getState()

        // Calculate center of selection
        const center = vec3.create()
        let count = 0

        const accumulateCenter = (geosetIndex: number, vertexIndex: number) => {
            const geoset = rendererRef.current.model.Geosets[geosetIndex]
            if (!geoset) return
            const vIndex = vertexIndex * 3
            center[0] += geoset.Vertices[vIndex]
            center[1] += geoset.Vertices[vIndex + 1]
            center[2] += geoset.Vertices[vIndex + 2]
            count++
        }

        if (geometrySubMode === 'vertex') {
            selectedVertexIds.forEach(sel => accumulateCenter(sel.geosetIndex, sel.index))
        } else if (geometrySubMode === 'face') {
            selectedFaceIds.forEach(sel => {
                const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
                if (geoset) {
                    const fIndex = sel.index * 3
                    accumulateCenter(sel.geosetIndex, geoset.Faces[fIndex])
                    accumulateCenter(sel.geosetIndex, geoset.Faces[fIndex + 1])
                    accumulateCenter(sel.geosetIndex, geoset.Faces[fIndex + 2])
                }
            })
        }

        if (count === 0) return
        vec3.scale(center, center, 1.0 / count)

        const affectedGeosets = new Set<number>()

        const updateVertex = (geosetIndex: number, vertexIndex: number, updateFn: (v: Float32Array, idx: number) => void) => {
            const geoset = rendererRef.current.model.Geosets[geosetIndex]
            if (!geoset) return
            updateFn(geoset.Vertices, vertexIndex * 3)
            affectedGeosets.add(geosetIndex)
        }

        const applyToSelection = (updateFn: (v: Float32Array, idx: number) => void) => {
            if (geometrySubMode === 'vertex') {
                selectedVertexIds.forEach(sel => updateVertex(sel.geosetIndex, sel.index, updateFn))
            } else if (geometrySubMode === 'face') {
                selectedFaceIds.forEach(sel => {
                    const geoset = rendererRef.current.model.Geosets[sel.geosetIndex]
                    if (geoset) {
                        const fIndex = sel.index * 3
                        updateVertex(sel.geosetIndex, geoset.Faces[fIndex], updateFn)
                        updateVertex(sel.geosetIndex, geoset.Faces[fIndex + 1], updateFn)
                        updateVertex(sel.geosetIndex, geoset.Faces[fIndex + 2], updateFn)
                    }
                })
            }
        }

        if (transformMode === 'rotate') {
            let angle = 0
            const rotAxis = vec3.create()

            if (axis === 'x') {
                angle = deltaY * 0.01
                vec3.set(rotAxis, 1, 0, 0)
            } else if (axis === 'y') {
                angle = -deltaX * 0.01
                vec3.set(rotAxis, 0, 1, 0)
            } else if (axis === 'z') {
                angle = deltaX * 0.01
                vec3.set(rotAxis, 0, 0, 1)
            }

            if (angle !== 0) {
                const rotMat = mat4.create()
                mat4.fromRotation(rotMat, angle, rotAxis)

                applyToSelection((v, i) => {
                    const p = vec3.fromValues(v[i], v[i + 1], v[i + 2])
                    vec3.sub(p, p, center)
                    vec3.transformMat4(p, p, rotMat)
                    vec3.add(p, p, center)
                    v[i] = p[0]
                    v[i + 1] = p[1]
                    v[i + 2] = p[2]
                })
            }
        } else if (transformMode === 'scale') {
            const scaleVec = vec3.fromValues(1, 1, 1)
            const scaleFactor = 1 + (deltaX - deltaY) * 0.005

            if (axis === 'x') scaleVec[0] = scaleFactor
            else if (axis === 'y') scaleVec[1] = scaleFactor
            else if (axis === 'z') scaleVec[2] = scaleFactor
            else if (axis === 'xy') { scaleVec[0] = scaleFactor; scaleVec[1] = scaleFactor }
            else if (axis === 'xz') { scaleVec[0] = scaleFactor; scaleVec[2] = scaleFactor }
            else if (axis === 'yz') { scaleVec[1] = scaleFactor; scaleVec[2] = scaleFactor }
            else if (axis === 'center') { vec3.set(scaleVec, scaleFactor, scaleFactor, scaleFactor) }

            if (scaleVec[0] !== 1 || scaleVec[1] !== 1 || scaleVec[2] !== 1) {
                applyToSelection((v, i) => {
                    const p = vec3.fromValues(v[i], v[i + 1], v[i + 2])
                    vec3.sub(p, p, center)
                    vec3.mul(p, p, scaleVec)
                    vec3.add(p, p, center)
                    v[i] = p[0]
                    v[i + 1] = p[1]
                    v[i + 2] = p[2]
                })
            }
        }

        // Update GPU buffers
        affectedGeosets.forEach(geosetIndex => {
            const geoset = rendererRef.current.model.Geosets[geosetIndex]
            if ((rendererRef.current as any).updateGeosetVertices) {
                (rendererRef.current as any).updateGeosetVertices(geosetIndex, geoset.Vertices)
            }
        })
    }, [rendererRef])

    return {
        handleGizmoDrag,
        handleTranslateVertices,
        handleTranslateNodes,
        handleTranslateNodesKeyframe,
        handleRotateOrScaleVertices
    }
}
