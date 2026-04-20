import { quat } from 'gl-matrix'
import { useModelStore, extractNodesFromModel, updateModelDataWithNodes } from '../store/modelStore'
import { ModelNode, NodeType } from '../types/node'
import { Command } from '../utils/CommandManager'

type TransformOps = {
    translation: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
}

type Snapshot = {
    modelData: any
    nodes: ModelNode[]
    trackerRotation: [number, number, number]
}

const GLOBAL_TRANSFORM_ROOT_NAME = '__WMV_GLOBAL_TRANSFORM_ROOT__'

function cloneDeep<T>(value: T): T {
    const sc = (globalThis as { structuredClone?: <U>(input: U) => U }).structuredClone
    if (typeof sc === 'function') {
        return sc(value)
    }
    return JSON.parse(JSON.stringify(value))
}

function hasNonZeroVec3(value: [number, number, number], epsilon = 1e-6): boolean {
    return value.some((item) => Math.abs(item) > epsilon)
}

function hasNonIdentityScale(value: [number, number, number], epsilon = 1e-6): boolean {
    return value.some((item, index) => Math.abs(item - 1) > epsilon)
}

function collectStaticFrames(modelData: any): number[] {
    const frames = new Set<number>([0])
    const sequences = Array.isArray(modelData?.Sequences) ? modelData.Sequences : []
    for (const sequence of sequences) {
        const interval = sequence?.Interval
        const start = Number(interval?.[0])
        const end = Number(interval?.[1])
        if (Number.isFinite(start)) frames.add(start)
        if (Number.isFinite(end)) frames.add(end)
    }
    return Array.from(frames).sort((a, b) => a - b)
}

function makeVec3Track(value: [number, number, number], frames: number[]) {
    return {
        LineType: 1,
        InterpolationType: 1,
        GlobalSeqId: null,
        Keys: frames.map((frame) => ({
            Frame: frame,
            Vector: new Float32Array(value)
        }))
    }
}

function makeQuatTrack(value: [number, number, number], frames: number[]) {
    const q = quat.create()
    quat.fromEuler(q, value[0], value[1], value[2])
    return {
        LineType: 1,
        InterpolationType: 1,
        GlobalSeqId: null,
        Keys: frames.map((frame) => ({
            Frame: frame,
            Vector: new Float32Array([q[0], q[1], q[2], q[3]])
        }))
    }
}

function composeTrackerRotation(
    current: [number, number, number],
    delta: [number, number, number]
): [number, number, number] {
    if (!hasNonZeroVec3(delta)) return [...current]

    const currentQuat = quat.create()
    quat.fromEuler(currentQuat, current[0], current[1], current[2])

    const deltaQuat = quat.create()
    quat.fromEuler(deltaQuat, delta[0], delta[1], delta[2])

    const nextQuat = quat.create()
    quat.multiply(nextQuat, deltaQuat, currentQuat)

    const x = nextQuat[0], y = nextQuat[1], z = nextQuat[2], w = nextQuat[3]
    const sinrCosp = 2 * (w * x + y * z)
    const cosrCosp = 1 - 2 * (x * x + y * y)
    const roll = Math.atan2(sinrCosp, cosrCosp)

    const sinp = 2 * (w * y - z * x)
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp)

    const sinyCosp = 2 * (w * z + x * y)
    const cosyCosp = 1 - 2 * (y * y + z * z)
    const yaw = Math.atan2(sinyCosp, cosyCosp)

    return [
        roll * 180 / Math.PI,
        pitch * 180 / Math.PI,
        yaw * 180 / Math.PI
    ]
}

function markActiveTabDirty(
    state: ReturnType<typeof useModelStore.getState>
): Record<string, boolean> {
    if (!state.activeTabId) return state.dirtyTabs
    return { ...state.dirtyTabs, [state.activeTabId]: true }
}

export class GlobalTransformCommand implements Command {
    name = 'Global Transform'

    private before: Snapshot | null
    private after: Snapshot | null

    constructor(ops: TransformOps, _renderer?: any | null, pivot?: [number, number, number] | null) {
        const state = useModelStore.getState()
        if (!state.modelData) {
            this.before = null
            this.after = null
            return
        }

        const basePivot: [number, number, number] = pivot
            ? [pivot[0], pivot[1], pivot[2]]
            : [0, 0, 0]

        this.before = {
            modelData: cloneDeep(state.modelData),
            nodes: cloneDeep(state.nodes),
            trackerRotation: [...state.globalTransformTracker.rotation] as [number, number, number]
        }

        const nextNodes = cloneDeep(state.nodes)
        const staticFrames = collectStaticFrames(state.modelData)
        const nextObjectId = nextNodes.reduce((maxId, node) => (
            typeof node?.ObjectId === 'number' && node.ObjectId > maxId ? node.ObjectId : maxId
        ), -1) + 1

        const wrapperNode: ModelNode = {
            type: NodeType.HELPER,
            Name: GLOBAL_TRANSFORM_ROOT_NAME,
            ObjectId: nextObjectId,
            Parent: -1,
            Flags: 0,
            PivotPoint: [...basePivot] as [number, number, number],
            ...(hasNonZeroVec3(ops.translation) ? { Translation: makeVec3Track(ops.translation, staticFrames) } : {}),
            ...(hasNonZeroVec3(ops.rotation) ? { Rotation: makeQuatTrack(ops.rotation, staticFrames) } : {}),
            ...(hasNonIdentityScale(ops.scale) ? { Scaling: makeVec3Track(ops.scale, staticFrames) } : {})
        } as ModelNode

        for (const node of nextNodes) {
            if (!node || node.type === NodeType.CAMERA) continue
            if (node.Parent === undefined || node.Parent === null || node.Parent < 0) {
                node.Parent = nextObjectId
            }
        }
        nextNodes.push(wrapperNode)

        const nextModelData = updateModelDataWithNodes(cloneDeep(state.modelData), nextNodes, false)
        if (!nextModelData) {
            this.after = null
            return
        }

        this.after = {
            modelData: nextModelData,
            nodes: extractNodesFromModel(nextModelData),
            trackerRotation: composeTrackerRotation(this.before.trackerRotation, ops.rotation)
        }
    }

    execute() {
        this.apply(this.after)
    }

    undo() {
        this.apply(this.before)
    }

    private apply(snapshot: Snapshot | null) {
        if (!snapshot) return

        useModelStore.setState((state) => ({
            modelData: cloneDeep(snapshot.modelData),
            nodes: cloneDeep(snapshot.nodes),
            rendererReloadTrigger: state.rendererReloadTrigger + 1,
            globalTransformTracker: {
                rotation: [...snapshot.trackerRotation] as [number, number, number]
            },
            dirtyTabs: markActiveTabDirty(state)
        }))
    }
}
