/**
 * renderHelpers - Rendering helper functions for the Viewer component
 * Contains visualization logic for nodes, cameras, collision shapes, etc.
 */

import { mat4 } from 'gl-matrix'
import { GridRenderer } from '../GridRenderer'
import { DebugRenderer } from '../DebugRenderer'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { getPos } from './types'

/**
 * Render grid if enabled
 */
export function renderGrid(
    gridRenderer: GridRenderer,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    mvMatrix: mat4,
    pMatrix: mat4,
    enabled: boolean
): void {
    if (enabled) {
        gridRenderer.render(gl, mvMatrix, pMatrix)
    }
}

/**
 * Render collision shapes visualization
 */
export function renderCollisionShapes(
    debugRenderer: DebugRenderer,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    mvMatrix: mat4,
    pMatrix: mat4,
    rendererData: any
): void {
    if (!rendererData?.nodes) return

    const collisionNodes = rendererData.nodes.filter(
        (n: any) => n.node?.Shape !== undefined && n.node.Shape !== null
    )

    collisionNodes.forEach((nodeWrapper: any) => {
        const node = nodeWrapper.node
        const shape = node.Shape
        if (!shape) return

        const pivotPoint = node.PivotPoint || [0, 0, 0]
        let worldMatrix = nodeWrapper.matrix || mat4.create()

        // Apply pivot point offset
        const offsetMatrix = mat4.create()
        mat4.translate(offsetMatrix, mat4.create(), pivotPoint)
        mat4.multiply(worldMatrix, worldMatrix, offsetMatrix)

        // Determine color based on selection
        const selectedNodeIds = useSelectionStore.getState().selectedNodeIds
        const isSelected = selectedNodeIds.includes(node.ObjectId)
        const color: [number, number, number, number] = isSelected
            ? [0, 1, 0, 0.5]  // Green if selected
            : [1, 1, 0, 0.3]  // Yellow

        if (shape.Type === 0) { // Box
            const vertices = shape.Vertices
            if (vertices && vertices.length >= 6) {
                const min = [vertices[0], vertices[1], vertices[2]] as number[]
                const max = [vertices[3], vertices[4], vertices[5]] as number[]
                debugRenderer.renderWireframeBox(gl, mvMatrix, pMatrix, min, max, color)
            }
        } else if (shape.Type === 2) { // Sphere
            const radius = shape.BoundsRadius || 50
            // TODO: Fix signature - DebugRenderer.renderWireframeSphere needs center parameter
            const center = [0, 0, 0] as Float32Array | number[]
            debugRenderer.renderWireframeSphere(gl, mvMatrix, pMatrix, radius, center, 16, color)
        } else if (shape.Type === 3) { // Cylinder
            // TODO: Implement renderWireframeCylinder in DebugRenderer
            // const radius = shape.BoundsRadius || 50
            // const vertices = shape.Vertices
            // Currently not implemented
        }
    })
}

/**
 * Render skeleton bones visualization
 * NOTE: renderWireframeBone is not implemented in DebugRenderer yet
 */
export function renderSkeleton(
    _debugRenderer: DebugRenderer,
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    _mvMatrix: mat4,
    _pMatrix: mat4,
    _rendererData: any,
    _model: any
): void {
    // TODO: Implement renderWireframeBone in DebugRenderer
    // Currently disabled
}

/**
 * Render node axes visualization
 * NOTE: renderWireframeAxis is not implemented in DebugRenderer yet
 */
export function renderNodes(
    _debugRenderer: DebugRenderer,
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    _mvMatrix: mat4,
    _pMatrix: mat4,
    _rendererData: any,
    _selectedNodeIds: number[]
): void {
    // TODO: Implement renderWireframeAxis in DebugRenderer
    // Currently disabled
}

/**
 * Render light objects visualization
 * NOTE: renderWireframeLight is not implemented in DebugRenderer yet
 */
export function renderLights(
    _debugRenderer: DebugRenderer,
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    _mvMatrix: mat4,
    _pMatrix: mat4,
    _rendererData: any,
    _model: any,
    _selectedNodeIds: number[]
): void {
    // TODO: Implement renderWireframeLight in DebugRenderer
    // Currently disabled
}

/**
 * Render camera frustum visualization
 */
export function renderCameraFrustum(
    debugRenderer: DebugRenderer,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    mvMatrix: mat4,
    pMatrix: mat4,
    cameraNodes: any[],
    selectedIdx: number
): void {
    if (selectedIdx < 0 || selectedIdx >= cameraNodes.length) return

    const cam = cameraNodes[selectedIdx]
    const camAny = cam as any

    const pos = getPos(camAny.Translation, camAny.Position)
    const target = getPos(camAny.TargetTranslation, camAny.TargetPosition)
    const fov = camAny.FieldOfView || 0.7853
    const nearClip = camAny.NearClip || 16
    const farClip = camAny.FarClip || 1000

    debugRenderer.renderWireframeFrustum(
        gl, mvMatrix, pMatrix,
        pos, target, fov, nearClip, farClip,
        [0, 0.8, 1, 1]
    )
}

/**
 * Apply geoset visibility and hover highlighting
 */
export function applyGeosetVisibility(
    mdlRenderer: any,
    _gl: WebGLRenderingContext | WebGL2RenderingContext
): Map<number, number> {
    const { hiddenGeosetIds, forceShowAllGeosets } = useModelStore.getState()
    const originalGeosetAlphas = new Map<number, number>()

    if (!forceShowAllGeosets && mdlRenderer.rendererData?.geosetAlpha) {
        const numGeosets = mdlRenderer.model.Geosets?.length || 0
        for (let i = 0; i < numGeosets; i++) {
            originalGeosetAlphas.set(i, mdlRenderer.rendererData.geosetAlpha[i] ?? 1)
            if (hiddenGeosetIds.includes(i)) {
                mdlRenderer.rendererData.geosetAlpha[i] = 0
            }
        }
    }

    return originalGeosetAlphas
}

/**
 * Restore geoset alphas after rendering
 */
export function restoreGeosetAlphas(
    mdlRenderer: any,
    originalAlphas: Map<number, number>
): void {
    if (originalAlphas.size > 0 && mdlRenderer.rendererData?.geosetAlpha) {
        originalAlphas.forEach((alpha, index) => {
            mdlRenderer.rendererData.geosetAlpha[index] = alpha
        })
    }
}
