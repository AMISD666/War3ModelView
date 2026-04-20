import { NodeType } from '../../types/node'

export interface OrbitCameraView {
    distance: number
    theta: number
    phi: number
    target: [number, number, number]
}

export interface CameraViewportBridge {
    createCameraFromCurrentView(): Record<string, unknown> | null
    focusCamera(cameraNode: Record<string, unknown>): void
}

const isArrayLike = (value: unknown): value is ArrayLike<number> =>
    Array.isArray(value) || value instanceof Float32Array || ArrayBuffer.isView(value)

const toArray = (value: unknown): number[] => {
    if (value instanceof Float32Array) return Array.from(value)
    if (ArrayBuffer.isView(value)) return Array.from(value as unknown as Iterable<number>)
    if (Array.isArray(value)) return value
    return []
}

const getCameraPosition = (animatedValue: any, staticValue?: unknown): number[] => {
    if (staticValue && isArrayLike(staticValue)) return toArray(staticValue)
    if (isArrayLike(animatedValue)) return toArray(animatedValue)
    if (animatedValue && Array.isArray(animatedValue.Keys) && animatedValue.Keys.length > 0) {
        const vector = animatedValue.Keys[0]?.Vector
        return vector ? toArray(vector) : [0, 0, 0]
    }
    return [0, 0, 0]
}

export const createCameraNodeFromOrbitView = (
    camera: OrbitCameraView,
    nextCameraNumber: number,
): Record<string, unknown> => {
    const { distance, theta, phi, target } = camera
    const cx = distance * Math.sin(phi) * Math.cos(theta)
    const cy = distance * Math.sin(phi) * Math.sin(theta)
    const cz = distance * Math.cos(phi)
    const cameraPos: [number, number, number] = [
        cx + target[0],
        cy + target[1],
        cz + target[2],
    ]

    return {
        Name: `Camera ${nextCameraNumber}`,
        type: NodeType.CAMERA,
        FieldOfView: 0.7853,
        NearClip: 16,
        FarClip: 5000,
        Position: new Float32Array(cameraPos),
        TargetPosition: new Float32Array(target),
        Translation: {
            LineType: 0,
            GlobalSeqId: null,
            Keys: [{ Frame: 0, Vector: new Float32Array(cameraPos) }],
        },
        TargetTranslation: {
            LineType: 0,
            GlobalSeqId: null,
            Keys: [{ Frame: 0, Vector: new Float32Array(target) }],
        },
    }
}

export const getOrbitCameraViewFromModelCamera = (
    cameraNode: Record<string, any>,
): OrbitCameraView | null => {
    if (!cameraNode) return null

    const position = getCameraPosition(cameraNode.Translation, cameraNode.Position)
    const target = getCameraPosition(cameraNode.TargetTranslation, cameraNode.TargetPosition)
    if (position.length < 3 || target.length < 3) {
        return null
    }

    const dx = position[0] - target[0]
    const dy = position[1] - target[1]
    const dz = position[2] - target[2]

    let distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (distance < 0.1) distance = 100

    let phi = Math.acos(dz / distance)
    if (Number.isNaN(phi)) phi = Math.PI / 4
    phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi))

    let theta = Math.atan2(dy, dx)
    if (Number.isNaN(theta)) theta = 0

    return {
        distance,
        theta,
        phi,
        target: [target[0], target[1], target[2]],
    }
}
