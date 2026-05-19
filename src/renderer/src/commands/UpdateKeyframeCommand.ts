import { Command } from '../utils/CommandManager'
import { useModelStore } from '../store/modelStore'

type TransformPropertyName = 'Rotation' | 'Scaling' | 'Translation'

type TransformKeyframe = {
    Frame: number
    Vector?: unknown
    InTan?: unknown
    OutTan?: unknown
    [key: string]: unknown
}

type TransformTrack = {
    Keys: TransformKeyframe[]
    LineType?: unknown
    InterpolationType?: unknown
    [key: string]: unknown
}

export interface KeyframeChange {
    nodeId: number
    propertyName: TransformPropertyName
    frame: number
    oldValue: number[] | null  // null = key didn't exist
    newValue: number[]
}

const LINE_TYPE_HERMITE = 2
const LINE_TYPE_BEZIER = 3

function getDefaultVector(propertyName: TransformPropertyName): number[] {
    if (propertyName === 'Rotation') return [0, 0, 0, 1]
    if (propertyName === 'Scaling') return [1, 1, 1]
    return [0, 0, 0]
}

function getVectorSize(propertyName: TransformPropertyName): number {
    return propertyName === 'Rotation' ? 4 : 3
}

function toFiniteArray(value: unknown, fallback: number[]): number[] {
    const source = value && typeof (value as { length?: number }).length === 'number'
        ? Array.from(value as ArrayLike<number>)
        : []
    const expected = fallback.length
    const out = fallback.slice()
    for (let i = 0; i < expected; i++) {
        const next = Number(source[i])
        out[i] = Number.isFinite(next) ? next : fallback[i]
    }
    return out
}

function getTrackLineType(prop: TransformTrack): number {
    const raw = Number(prop?.LineType ?? prop?.InterpolationType ?? 1)
    return Number.isFinite(raw) ? raw : 1
}

function createZeroTangent(propertyName: TransformPropertyName): number[] {
    return new Array(getVectorSize(propertyName)).fill(0)
}

function ensureTrackMetadata(prop: TransformTrack): TransformTrack {
    const lineType = getTrackLineType(prop)
    return {
        ...prop,
        LineType: lineType,
        InterpolationType: lineType,
    }
}

function ensureKeyTangents(key: TransformKeyframe, propertyName: TransformPropertyName, lineType: number): TransformKeyframe {
    if (lineType !== LINE_TYPE_HERMITE && lineType !== LINE_TYPE_BEZIER) {
        return key
    }

    const zero = createZeroTangent(propertyName)
    return {
        ...key,
        InTan: toFiniteArray(key?.InTan, zero),
        OutTan: toFiniteArray(key?.OutTan, zero),
    }
}

export class UpdateKeyframeCommand implements Command {
    constructor(
        private renderer: any,
        private changes: KeyframeChange[],
        private onSync?: () => void
    ) { }

    execute() {
        this.applyChanges(true)
    }

    undo() {
        this.applyChanges(false)
    }

    private applyChanges(useNew: boolean) {
        const { nodes, updateNodes } = useModelStore.getState()
        const updates: { objectId: number, data: any }[] = []

        for (const change of this.changes) {
            const storeNode = nodes.find((n: any) => n.ObjectId === change.nodeId)
            if (!storeNode) continue

            const value = useNew ? change.newValue : change.oldValue
            let prop = storeNode[change.propertyName] as TransformTrack | undefined

            if (!prop) {
                prop = { Keys: [], LineType: 1, InterpolationType: 1 }
            } else {
                prop = { ...prop, Keys: [...(prop.Keys || [])] as TransformKeyframe[] }
            }
            prop = ensureTrackMetadata(prop)
            const lineType = getTrackLineType(prop)

            // Find key at frame
            const keyIndex = prop.Keys.findIndex((k) => Math.abs(k.Frame - change.frame) < 0.1)

            if (value === null) {
                // Remove Key (for undo when key didn't exist before)
                if (keyIndex >= 0) {
                    prop.Keys.splice(keyIndex, 1)
                }
            } else {
                const nextVector = toFiniteArray(value, getDefaultVector(change.propertyName))
                if (keyIndex >= 0) {
                    prop.Keys[keyIndex] = ensureKeyTangents(
                        { ...prop.Keys[keyIndex], Vector: nextVector },
                        change.propertyName,
                        lineType
                    )
                } else {
                    prop.Keys.push(ensureKeyTangents(
                        { Frame: change.frame, Vector: nextVector },
                        change.propertyName,
                        lineType
                    ))
                    prop.Keys.sort((a, b) => a.Frame - b.Frame)
                }
            }
            prop.Keys = prop.Keys.map((key) => ensureKeyTangents(key, change.propertyName, lineType))

            // Check if we need to add this node to updates
            const existingUpdate = updates.find(u => u.objectId === change.nodeId)
            if (existingUpdate) {
                existingUpdate.data[change.propertyName] = prop
            } else {
                updates.push({ objectId: change.nodeId, data: { [change.propertyName]: prop } })
            }

            // Also update renderer model for immediate effect
            if (this.renderer && this.renderer.model && this.renderer.model.Nodes) {
                const rendererNode = this.renderer.model.Nodes.find((n: any) => n.ObjectId === change.nodeId)
                if (rendererNode) {
                    rendererNode[change.propertyName] = prop
                }
            }
        }

        if (updates.length > 0) {
            updateNodes(updates)
        }

        // Force renderer update
        if (this.renderer) {
            this.renderer.update(0)
        }

        if (this.onSync) {
            this.onSync()
        }
    }
}
