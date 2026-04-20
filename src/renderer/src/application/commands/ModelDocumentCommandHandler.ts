import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import { useModelStore } from '../../store/modelStore'
import { commandBus, type CommandBus } from './CommandBus'

type SetModelDataCommandOptions = {
    skipAutoRecalculate?: boolean
    skipModelRebuild?: boolean
}

export type CameraDocumentEntry = Record<string, unknown>

export interface ReplaceModelDataCommandInput {
    name: string
    before: ModelData | null
    after: ModelData | null
    path: string | null
    options?: SetModelDataCommandOptions
    forceRendererReload?: boolean
}

export interface ReplaceCameraListCommandInput {
    name: string
    before: CameraDocumentEntry[]
    after: CameraDocumentEntry[]
}

const cloneModelData = (data: ModelData | null): ModelData | null =>
    data === null ? null : structuredClone(data)

const cloneCameras = (cameras: CameraDocumentEntry[]): CameraDocumentEntry[] =>
    structuredClone(cameras)

const forceRendererReload = (): void => {
    useModelStore.setState((state) => ({
        rendererReloadTrigger: state.rendererReloadTrigger + 1,
    }))
}

export class ModelDocumentCommandHandler {
    constructor(private readonly bus: CommandBus = commandBus) {}

    replaceModelData(input: ReplaceModelDataCommandInput): void {
        const before = cloneModelData(input.before)
        const after = cloneModelData(input.after)

        const apply = (snapshot: ModelData | null): void => {
            useModelStore.getState().setModelData(cloneModelData(snapshot), input.path, input.options)
            if (input.forceRendererReload) {
                forceRendererReload()
            }
        }

        this.bus.execute({
            name: input.name,
            execute: () => apply(after),
            undo: () => apply(before),
            redo: () => apply(after),
        })
    }

    replaceCameraList(input: ReplaceCameraListCommandInput): void {
        const before = cloneCameras(input.before)
        const after = cloneCameras(input.after)

        const apply = (cameras: CameraDocumentEntry[]): void => {
            useModelStore.getState().setCameras(cloneCameras(cameras) as unknown as ModelNode[])
        }

        this.bus.execute({
            name: input.name,
            execute: () => apply(after),
            undo: () => apply(before),
            redo: () => apply(after),
        })
    }
}

export const modelDocumentCommandHandler = new ModelDocumentCommandHandler()
