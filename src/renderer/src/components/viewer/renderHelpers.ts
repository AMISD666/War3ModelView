/**
 * renderHelpers - Rendering helper functions for the Viewer component
 * Contains visualization logic for nodes, cameras, collision shapes, etc.
 */

import { mat4, vec3, vec4 } from 'gl-matrix'
import { GridRenderer } from '../../GridRenderer'
import { DebugRenderer } from '../../DebugRenderer'
import { GizmoRenderer } from '../../GizmoRenderer'
import { useModelStore } from '../../../store/modelStore'
import { useSelectionStore } from '../../../store/selectionStore'
import { isArrayLike, toArray, getPos, getVal, getVec, hexToRgb } from '../types'

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
                const min = vec3.fromValues(vertices[0], vertices[1], vertices[2])
                const max = vec3.fromValues(vertices[3], vertices[4], vertices[5])
                debugRenderer.renderWireframeBox(gl, worldMatrix, mvMatrix, pMatrix, min, max, color)
            }
        } else if (shape.Type === 2) { // Sphere
            const radius = shape.BoundsRadius || 50
            debugRenderer.renderWireframeSphere(gl, worldMatrix, mvMatrix, pMatrix, radius, 16, color)
        } else if (shape.Type === 3) { // Cylinder
            const radius = shape.BoundsRadius || 50
            const vertices = shape.Vertices
            if (vertices && vertices.length >= 6) {
                const height = Math.abs(vertices[5] - vertices[2])
                debugRenderer.renderWireframeCylinder(gl, worldMatrix, mvMatrix, pMatrix, radius, height, 16, color)
            }
        }
    })
}

/**
 * Render skeleton bones visualization
 */
export function renderSkeleton(
    debugRenderer: DebugRenderer,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    mvMatrix: mat4,
    pMatrix: mat4,
    rendererData: any,
    model: any
): void {
    if (!rendererData?.nodes || !model?.Bones) return

    model.Bones.forEach((bone: any) => {
        if (bone.Parent === -1 || bone.Parent === undefined) return

        const childNode = rendererData.nodes.find((n: any) => n.node?.ObjectId === bone.ObjectId)
        const parentNode = rendererData.nodes.find((n: any) => n.node?.ObjectId === bone.Parent)

        if (!childNode?.matrix || !parentNode?.matrix) return

        const childPos = vec3.create()
        const parentPos = vec3.create()
        mat4.getTranslation(childPos, childNode.matrix)
        mat4.getTranslation(parentPos, parentNode.matrix)

        debugRenderer.renderWireframeBone(gl, mvMatrix, pMatrix, parentPos, childPos, 5, [1, 1, 0, 1])
    })
}

/**
 * Render node axes visualization
 */
export function renderNodes(
    debugRenderer: DebugRenderer,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    mvMatrix: mat4,
    pMatrix: mat4,
    rendererData: any,
    selectedNodeIds: number[]
): void {
    if (!rendererData?.nodes) return

    const renderableNodes = rendererData.nodes.filter((n: any) => {
        const type = n.node?.type
        return type === 'Bone' || type === 'Helper' || type === 'Attachment' || type === 'Event'
    })

    renderableNodes.forEach((nodeWrapper: any) => {
        const node = nodeWrapper.node
        const pos = vec3.create()
        mat4.getTranslation(pos, nodeWrapper.matrix)

        const isSelected = selectedNodeIds.includes(node.ObjectId)
        const axisLength = isSelected ? 20 : 10
        const alpha = isSelected ? 1 : 0.6

        debugRenderer.renderWireframeAxis(gl, mvMatrix, pMatrix, pos, axisLength, alpha)
    })
}

/**
 * Render light objects visualization
 */
export function renderLights(
    debugRenderer: DebugRenderer,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    mvMatrix: mat4,
    pMatrix: mat4,
    rendererData: any,
    model: any,
    selectedNodeIds: number[]
): void {
    if (!rendererData?.nodes || !model?.Lights) return

    const lightNodes = rendererData.nodes.filter((n: any) => n.node?.type === 'Light')

    lightNodes.forEach((nodeWrapper: any) => {
        const node = nodeWrapper.node
        const light = model.Lights.find((l: any) => l.ObjectId === node.ObjectId)
        if (!light) return

        const pos = vec3.create()
        mat4.getTranslation(pos, nodeWrapper.matrix)

        const lightType = typeof light.LightType === 'number' ? light.LightType : 0
        const attenStart = getVal(light.AttenuationStart) || 50
        const attenEnd = getVal(light.AttenuationEnd) || 200
        const intensity = getVal(light.Intensity) || 1

        let color: [number, number, number, number]
        if (lightType === 1) {
            const ambient = getVec(light.AmbientColor)
            color = [ambient[0], ambient[1], ambient[2], 0.8]
        } else {
            const diffuse = getVec(light.Color)
            color = [diffuse[0] * intensity, diffuse[1] * intensity, diffuse[2] * intensity, 0.8]
        }

        const isSelected = selectedNodeIds.includes(node.ObjectId)
        if (isSelected) {
            color = [1, 1, 0, 1] // Yellow for selected
        }

        debugRenderer.renderWireframeLight(
            gl, mvMatrix, pMatrix,
            [pos[0], pos[1], pos[2]],
            color,
            lightType, attenStart, attenEnd
        )
    })
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
    gl: WebGLRenderingContext | WebGL2RenderingContext
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
