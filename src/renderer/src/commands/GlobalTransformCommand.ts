import { Command } from '../utils/CommandManager'
import { useModelStore } from '../store/modelStore'
import { useRendererStore } from '../store/rendererStore'
import { mat4, quat, vec3 } from 'gl-matrix'

type TransformOps = {
    translation: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
}

export class GlobalTransformCommand implements Command {
    name = 'Global Transform'
    private forward: TransformOps
    private renderer: any | null
    private pivot: [number, number, number] | null
    private forwardMatrix: mat4
    private inverseMatrix: mat4

    constructor(ops: TransformOps, renderer?: any | null, pivot?: [number, number, number] | null) {
        this.forward = {
            translation: [...ops.translation],
            rotation: [...ops.rotation],
            scale: [...ops.scale]
        } as TransformOps
        this.renderer = renderer ?? null
        this.pivot = pivot ?? null
        this.forwardMatrix = this.buildMatrix(this.forward, this.pivot)
        this.inverseMatrix = mat4.invert(mat4.create(), this.forwardMatrix) || mat4.create()
    }

    execute() {
        this.applyMatrix(this.forwardMatrix)
    }

    undo() {
        this.applyMatrix(this.inverseMatrix)
    }

    private applyMatrix(matrix: mat4) {
        const { transformModel } = useModelStore.getState()
        const ops = this.decomposeMatrix(matrix)
        // Suppress full reload - we will sync the renderer manually below.
        // This prevents screen flicker while maintaining correct animation.
        transformModel({ ...ops, suppressReload: true })
        this.syncRenderer()
    }

    private buildMatrix(ops: TransformOps, pivot: [number, number, number] | null): mat4 {
        const out = mat4.create()
        mat4.translate(out, out, ops.translation)
        if (pivot) {
            mat4.translate(out, out, pivot)
        }
        const rotQuat = quat.create()
        quat.fromEuler(rotQuat, ops.rotation[0], ops.rotation[1], ops.rotation[2])
        const rotScale = mat4.create()
        mat4.fromRotationTranslationScale(rotScale, rotQuat, [0, 0, 0], ops.scale)
        mat4.multiply(out, out, rotScale)
        if (pivot) {
            const negPivot = vec3.fromValues(-pivot[0], -pivot[1], -pivot[2])
            mat4.translate(out, out, negPivot)
        }
        return out
    }

    private decomposeMatrix(matrix: mat4): TransformOps {
        const translation = vec3.create()
        const scaling = vec3.create()
        const rotationQuat = quat.create()
        mat4.getTranslation(translation, matrix)
        mat4.getScaling(scaling, matrix)
        mat4.getRotation(rotationQuat, matrix)
        const rotation = this.quatToEuler(rotationQuat)
        return {
            translation: [translation[0], translation[1], translation[2]],
            rotation,
            scale: [scaling[0], scaling[1], scaling[2]]
        }
    }

    private quatToEuler(q: quat): [number, number, number] {
        const x = q[0], y = q[1], z = q[2], w = q[3]
        const sinr_cosp = 2 * (w * x + y * z)
        const cosr_cosp = 1 - 2 * (x * x + y * y)
        const roll = Math.atan2(sinr_cosp, cosr_cosp)

        const sinp = 2 * (w * y - z * x)
        let pitch: number
        if (Math.abs(sinp) >= 1) pitch = Math.sign(sinp) * Math.PI / 2
        else pitch = Math.asin(sinp)

        const siny_cosp = 2 * (w * z + x * y)
        const cosy_cosp = 1 - 2 * (y * y + z * z)
        const yaw = Math.atan2(siny_cosp, cosy_cosp)

        return [roll * 180 / Math.PI, pitch * 180 / Math.PI, yaw * 180 / Math.PI]
    }

    private syncRenderer() {
        const renderer = this.renderer ?? useRendererStore.getState().renderer
        const modelData = useModelStore.getState().modelData as any
        if (!renderer || !modelData) return

        // Geoset geometry (GPU buffers)
        if (modelData.Geosets && renderer.model?.Geosets) {
            const toFloat32 = (data: any) => (data instanceof Float32Array ? data : new Float32Array(data))
            const len = Math.min(modelData.Geosets.length, renderer.model.Geosets.length)
            for (let i = 0; i < len; i++) {
                const src = modelData.Geosets[i]
                const dst = renderer.model.Geosets[i]
                if (src?.Vertices) {
                    const verts = toFloat32(src.Vertices)
                    dst.Vertices = verts
                    if (typeof renderer.updateGeosetVertices === 'function') {
                        renderer.updateGeosetVertices(i, verts)
                    }
                }
                if (src?.Normals) {
                    const normals = toFloat32(src.Normals)
                    dst.Normals = normals
                    if (typeof renderer.updateGeosetNormals === 'function') {
                        renderer.updateGeosetNormals(i, normals)
                    }
                }
                if (src?.MinimumExtent) dst.MinimumExtent = src.MinimumExtent
                if (src?.MaximumExtent) dst.MaximumExtent = src.MaximumExtent
            }
        }

        // Pivot points
        if (modelData.PivotPoints) {
            renderer.model.PivotPoints = modelData.PivotPoints
        }

        // Node groups (update in-place to preserve wrapper references)
        const groups = [
            'Nodes', 'Bones', 'Helpers', 'Attachments', 'Lights',
            'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
            'EventObjects', 'CollisionShapes', 'Cameras'
        ]
        for (const key of groups) {
            const srcList = modelData[key]
            const dstList = renderer.model?.[key]
            if (srcList && dstList) {
                const len = Math.min(srcList.length, dstList.length)
                for (let i = 0; i < len; i++) {
                    Object.assign(dstList[i], srcList[i])
                }
            }
        }

        // Update renderer.model.Nodes in place to keep wrapper references intact.
        if (renderer.model?.Nodes) {
            const nodeMap = new Map<number, any>()
            for (const key of groups) {
                const srcList = modelData[key]
                if (srcList) {
                    for (const node of srcList) {
                        const id = node?.ObjectId
                        if (typeof id === 'number') nodeMap.set(id, node)
                    }
                }
            }
            for (const node of renderer.model.Nodes) {
                const id = node?.ObjectId
                const src = typeof id === 'number' ? nodeMap.get(id) : null
                if (src) Object.assign(node, src)
            }
        } else {
            const storeNodes = useModelStore.getState().nodes as any
            if (storeNodes && renderer.model) {
                renderer.model.Nodes = storeNodes
            }
        }

        // CRITICAL FIX: Always rebuild NodeWrappers after patching nodes.
        // This ensures rendererData.nodes references the updated node objects
        // and corrects parent-child relationships in the bone hierarchy.
        if (renderer.modelInstance && typeof renderer.modelInstance.syncNodes === 'function') {
            renderer.modelInstance.syncNodes()
        }

        if (typeof renderer.update === 'function') {
            renderer.update(0)
        }
    }
}
