import type { ModelData } from '../../types/model'
import type { ModelNode } from '../../types/node'
import { useModelStore, type ReplaceDocumentSnapshotOptions } from '../../store/modelStore'
import { commandBus, type CommandBus, type ExecuteDocumentCommandOptions } from './CommandBus'

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

export type DocumentSnapshotReplacement = {
    modelData: ModelData
} & Pick<
    ReplaceDocumentSnapshotOptions,
    | 'nodes'
    | 'sequences'
    | 'hiddenGeosetIds'
    | 'selectedGeosetIndex'
    | 'selectedGeosetIndices'
    | 'forceShowAllGeosets'
    | 'globalTransformTracker'
>

export interface ReplaceDocumentSnapshotCommandInput {
    name: string
    before: DocumentSnapshotReplacement | null
    after: DocumentSnapshotReplacement | null
    options?: ExecuteDocumentCommandOptions
    applyOptions?: Pick<ReplaceDocumentSnapshotOptions, 'rendererReload' | 'clearMaterialPreview'>
}

export interface ReplaceCameraListCommandInput {
    name: string
    before: CameraDocumentEntry[]
    after: CameraDocumentEntry[]
    options?: ExecuteDocumentCommandOptions
}

export interface ReplaceGeosetAnimationListCommandInput {
    name: string
    before: unknown[]
    after: unknown[]
    options?: ExecuteDocumentCommandOptions
}

export interface ReplaceGeosetListCommandInput {
    name: string
    before: unknown[]
    after: unknown[]
    options?: ExecuteDocumentCommandOptions
}

export interface ReplaceGeosetListAndAnimationsCommandInput {
    name: string
    beforeGeosets: unknown[]
    afterGeosets: unknown[]
    beforeGeosetAnims: unknown[]
    afterGeosetAnims: unknown[]
    options?: ExecuteDocumentCommandOptions
}

export interface ReplaceTextureAnimationListCommandInput {
    name: string
    before: unknown[]
    after: unknown[]
    options?: ExecuteDocumentCommandOptions
}

export interface ReplaceTextureAnimationListAndMaterialsCommandInput {
    name: string
    beforeTextureAnims: unknown[]
    afterTextureAnims: unknown[]
    beforeMaterials: unknown[]
    afterMaterials: unknown[]
    options?: ExecuteDocumentCommandOptions
}

const cloneModelData = (data: ModelData | null): ModelData | null =>
    data === null ? null : structuredClone(data)

const cloneDocumentSnapshot = (
    snapshot: DocumentSnapshotReplacement | null
): DocumentSnapshotReplacement | null =>
    snapshot === null ? null : structuredClone(snapshot)

const cloneCameras = (cameras: CameraDocumentEntry[]): CameraDocumentEntry[] =>
    structuredClone(cameras)

const cloneCollection = <T,>(items: T[]): T[] =>
    structuredClone(items)

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

    replaceDocumentSnapshot(input: ReplaceDocumentSnapshotCommandInput): void {
        const before = cloneDocumentSnapshot(input.before)
        const after = cloneDocumentSnapshot(input.after)

        const apply = (snapshot: DocumentSnapshotReplacement | null): void => {
            if (!snapshot) return
            const { modelData, ...snapshotOptions } = cloneDocumentSnapshot(snapshot)!
            useModelStore.getState().replaceDocumentSnapshot(modelData, {
                ...snapshotOptions,
                ...(input.applyOptions ?? {}),
            })
        }

        this.bus.execute({
            name: input.name,
            execute: () => apply(after),
            undo: () => apply(before),
            redo: () => apply(after),
        }, input.options)
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
        }, input.options)
    }

    replaceGeosetAnimationList(input: ReplaceGeosetAnimationListCommandInput): void {
        const before = cloneCollection(input.before)
        const after = cloneCollection(input.after)

        const apply = (anims: unknown[]): void => {
            useModelStore.getState().setGeosetAnims(cloneCollection(anims))
        }

        this.bus.execute({
            name: input.name,
            execute: () => apply(after),
            undo: () => apply(before),
            redo: () => apply(after),
        }, input.options)
    }

    replaceGeosetList(input: ReplaceGeosetListCommandInput): void {
        const before = cloneCollection(input.before)
        const after = cloneCollection(input.after)

        const apply = (geosets: unknown[]): void => {
            useModelStore.getState().setGeosets(cloneCollection(geosets))
        }

        this.bus.execute({
            name: input.name,
            execute: () => apply(after),
            undo: () => apply(before),
            redo: () => apply(after),
        }, input.options)
    }

    replaceGeosetListAndAnimations(input: ReplaceGeosetListAndAnimationsCommandInput): void {
        const beforeGeosets = cloneCollection(input.beforeGeosets)
        const afterGeosets = cloneCollection(input.afterGeosets)
        const beforeGeosetAnims = cloneCollection(input.beforeGeosetAnims)
        const afterGeosetAnims = cloneCollection(input.afterGeosetAnims)

        const apply = (geosets: unknown[], geosetAnims: unknown[]): void => {
            const store = useModelStore.getState()
            store.setGeosetAnims(cloneCollection(geosetAnims))
            store.setGeosets(cloneCollection(geosets))
        }

        this.bus.execute({
            name: input.name,
            execute: () => apply(afterGeosets, afterGeosetAnims),
            undo: () => apply(beforeGeosets, beforeGeosetAnims),
            redo: () => apply(afterGeosets, afterGeosetAnims),
        }, input.options)
    }

    replaceTextureAnimationList(input: ReplaceTextureAnimationListCommandInput): void {
        const before = cloneCollection(input.before)
        const after = cloneCollection(input.after)

        const apply = (anims: unknown[]): void => {
            useModelStore.getState().setTextureAnims(cloneCollection(anims))
        }

        this.bus.execute({
            name: input.name,
            execute: () => apply(after),
            undo: () => apply(before),
            redo: () => apply(after),
        })
    }

    replaceTextureAnimationListAndMaterials(input: ReplaceTextureAnimationListAndMaterialsCommandInput): void {
        const beforeTextureAnims = cloneCollection(input.beforeTextureAnims)
        const afterTextureAnims = cloneCollection(input.afterTextureAnims)
        const beforeMaterials = cloneCollection(input.beforeMaterials)
        const afterMaterials = cloneCollection(input.afterMaterials)

        const apply = (textureAnims: unknown[], materials: unknown[]): void => {
            useModelStore.getState().setVisualDataPatch({
                TextureAnims: cloneCollection(textureAnims),
                Materials: cloneCollection(materials),
            })
        }

        this.bus.execute({
            name: input.name,
            execute: () => apply(afterTextureAnims, afterMaterials),
            undo: () => apply(beforeTextureAnims, beforeMaterials),
            redo: () => apply(afterTextureAnims, afterMaterials),
        }, input.options)
    }
}

export const modelDocumentCommandHandler = new ModelDocumentCommandHandler()
