import { extractNodesFromModel, updateModelDataWithNodes, useModelStore } from '../store/modelStore'
import type { ModelNode } from '../types/node'
import { NodeType } from '../types/node'
import type { Command } from '../utils/CommandManager'

export type MirrorAxis = 'x' | 'y' | 'z'

type Snapshot = {
    modelData: any
    nodes: ModelNode[]
    trackerRotation: [number, number, number]
}

const MIRROR_ROOT_NAME = '__WMV_MIRROR_ROOT__'
const WORLD_ORIGIN: [number, number, number] = [0, 0, 0]

function cloneDeep<T>(value: T): T {
    const sc = (globalThis as { structuredClone?: <U>(input: U) => U }).structuredClone
    if (typeof sc === 'function') {
        return sc(value)
    }
    return JSON.parse(JSON.stringify(value))
}

function markActiveTabDirty(
    state: ReturnType<typeof useModelStore.getState>
): Record<string, boolean> {
    if (!state.activeTabId) return state.dirtyTabs
    return { ...state.dirtyTabs, [state.activeTabId]: true }
}

function collectStaticFrames(modelData: any): number[] {
    const frames = new Set<number>([0])
    const sequences = Array.isArray(modelData?.Sequences) ? modelData.Sequences : []
    for (const sequence of sequences) {
        const start = Number(sequence?.Interval?.[0])
        const end = Number(sequence?.Interval?.[1])
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

function getMirrorScale(axis: MirrorAxis): [number, number, number] {
    if (axis === 'x') return [-1, 1, 1]
    if (axis === 'y') return [1, -1, 1]
    return [1, 1, -1]
}

function reverseTriangleWinding(faces: any): void {
    if (!faces || typeof faces.length !== 'number') return
    for (let i = 0; i + 2 < faces.length; i += 3) {
        const temp = faces[i + 1]
        faces[i + 1] = faces[i + 2]
        faces[i + 2] = temp
    }
}

function mirrorAbsoluteVec3(
    value: number[] | Float32Array | undefined | null,
    pivot: [number, number, number],
    scale: [number, number, number]
): void {
    if (!value || typeof value !== 'object' || value.length < 3) return
    value[0] = pivot[0] + (Number(value[0]) - pivot[0]) * scale[0]
    value[1] = pivot[1] + (Number(value[1]) - pivot[1]) * scale[1]
    value[2] = pivot[2] + (Number(value[2]) - pivot[2]) * scale[2]
}

function mirrorRelativeVec3(
    value: number[] | Float32Array | undefined | null,
    scale: [number, number, number]
): void {
    if (!value || typeof value !== 'object' || value.length < 3) return
    value[0] = Number(value[0]) * scale[0]
    value[1] = Number(value[1]) * scale[1]
    value[2] = Number(value[2]) * scale[2]
}

function mirrorVec3Track(track: any, scale: [number, number, number]): void {
    if (!track || !Array.isArray(track.Keys)) return
    track.Keys.forEach((key: any) => {
        mirrorRelativeVec3(key?.Vector, scale)
        mirrorRelativeVec3(key?.InTan, scale)
        mirrorRelativeVec3(key?.OutTan, scale)
    })
}

function buildMirroredSnapshot(axis: MirrorAxis): Snapshot | null {
    const state = useModelStore.getState()
    if (!state.modelData) {
        return null
    }

    const sourceModelData = cloneDeep(state.modelData)
    const pivot = WORLD_ORIGIN
    const scale = getMirrorScale(axis)
    const staticFrames = collectStaticFrames(sourceModelData)
    const nextNodes = cloneDeep(state.nodes)
    const nextObjectId = nextNodes.reduce((maxId, node) => (
        typeof node?.ObjectId === 'number' && node.ObjectId > maxId ? node.ObjectId : maxId
    ), -1) + 1

    const mirrorRoot: ModelNode = {
        type: NodeType.HELPER,
        Name: `${MIRROR_ROOT_NAME}_${axis.toUpperCase()}`,
        ObjectId: nextObjectId,
        Parent: -1,
        Flags: 0,
        PivotPoint: [...pivot] as [number, number, number],
        Scaling: makeVec3Track(scale, staticFrames)
    } as ModelNode

    for (const node of nextNodes) {
        if (!node || node.type === NodeType.CAMERA) continue
        if (node.Parent === undefined || node.Parent === null || node.Parent < 0) {
            node.Parent = nextObjectId
        }
    }
    nextNodes.push(mirrorRoot)

    const nextModelData = updateModelDataWithNodes(sourceModelData, nextNodes, false)
    if (!nextModelData) {
        return null
    }

    if (Array.isArray(nextModelData.Geosets)) {
        nextModelData.Geosets.forEach((geoset: any) => reverseTriangleWinding(geoset?.Faces))
    }

    if (Array.isArray(nextModelData.Cameras)) {
        nextModelData.Cameras.forEach((camera: any) => {
            mirrorAbsoluteVec3(camera?.Position, pivot, scale)
            mirrorAbsoluteVec3(camera?.TargetPosition, pivot, scale)
            mirrorVec3Track(camera?.Translation, scale)
            mirrorVec3Track(camera?.TargetTranslation, scale)
        })
    }

    ;(nextModelData as any).__forceFullReload = true

    return {
        modelData: nextModelData,
        nodes: extractNodesFromModel(nextModelData),
        trackerRotation: [...state.globalTransformTracker.rotation] as [number, number, number]
    }
}

export class MirrorModelCommand implements Command {
    name: string

    private before: Snapshot | null
    private after: Snapshot | null

    constructor(axis: MirrorAxis) {
        const state = useModelStore.getState()
        this.name = axis === 'z' ? 'Mirror Model Vertical' : 'Mirror Model Horizontal'
        this.before = state.modelData ? {
            modelData: cloneDeep(state.modelData),
            nodes: cloneDeep(state.nodes),
            trackerRotation: [...state.globalTransformTracker.rotation] as [number, number, number]
        } : null
        this.after = buildMirroredSnapshot(axis)
    }

    execute(): void {
        this.apply(this.after)
    }

    undo(): void {
        this.apply(this.before)
    }

    private apply(snapshot: Snapshot | null): void {
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
