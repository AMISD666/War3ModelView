import type { DesktopGateway, OpenFileDialogOptions } from '../../infrastructure/desktop'
import { desktopGateway } from '../../infrastructure/desktop'
import type { WindowGateway } from '../../infrastructure/window'
import { windowGateway } from '../../infrastructure/window'
import { addRecentFile, type RecentFile } from '../../services/historyService'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import type { ModelData } from '../../types/model'
import type { AppMode } from '../../store/selectionStore'
import { pickDefaultSequenceIndex } from '../../utils/sequenceUtils'
import { FBX_PRO_FEATURE_NAME, isFbxSourcePath } from '../model-import/fbxSourcePath'
import { requireProFeature } from '../../utils/featureGate'

export type OpenModelSource =
    | 'dialog'
    | 'recent'
    | 'drag-drop'
    | 'cli-hot-open'
    | 'external-open'

export interface OpenModelPathContext {
    openModelAsTab: (filePath: string) => boolean
    setRecentFiles: (files: RecentFile[]) => void
}

export interface OpenModelPathInput {
    path: string
    source: OpenModelSource
    addToRecent?: boolean
    acceptPath?: (path: string) => boolean
    processedPaths?: Set<string>
}

export interface OpenModelPathsInput extends Omit<OpenModelPathInput, 'path'> {
    paths: string[]
    delayMs?: number
}

export interface HandleLoadedModelContext {
    currentModelPath: string | null
    commitLoadedModel: (
        data: ModelData | null,
        path: string | null,
        options?: { skipAutoRecalculate?: boolean; skipModelRebuild?: boolean; deferTabSnapshot?: boolean; deferNodeHydration?: boolean },
    ) => void
    completeLoading: () => void
    setMainMode: (mode: AppMode) => void
    setPlaying: (playing: boolean) => void
}

export const DEFAULT_IMPORT_FILE_DIALOG_OPTIONS: OpenFileDialogOptions = {
    multiple: false,
    filters: [{
        name: '魔兽争霸3资源',
        extensions: ['mdx', 'mdl', 'fbx', 'x', 'blp', 'tga', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
    }],
}

const MODEL_FILE_EXTENSIONS = new Set(['mdx', 'mdl', 'fbx', 'x'])
const OPENABLE_RESOURCE_EXTENSIONS = new Set(['mdx', 'mdl', 'fbx', 'x', 'blp', 'tga', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])

const getFileExtension = (path: string): string => {
    const dotIndex = path.lastIndexOf('.')
    return dotIndex >= 0 ? path.slice(dotIndex + 1).toLowerCase() : ''
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class OpenModelWorkflow {
    constructor(
        private readonly desktop: DesktopGateway,
        private readonly window: WindowGateway,
    ) { }

    isOpenableModelFile(path: string): boolean {
        return MODEL_FILE_EXTENSIONS.has(getFileExtension(path))
    }

    isOpenableResourceFile(path: string): boolean {
        return OPENABLE_RESOURCE_EXTENSIONS.has(getFileExtension(path))
    }

    async openFromDialog(
        context: OpenModelPathContext,
        options: OpenFileDialogOptions = DEFAULT_IMPORT_FILE_DIALOG_OPTIONS,
    ): Promise<string | null> {
        const selected = await this.desktop.openFileDialog(options)
        if (!selected || typeof selected !== 'string') {
            return null
        }

        void this.window.focusCurrentWindow().catch(() => {})
        await this.openPath({
            path: selected,
            source: 'dialog',
            addToRecent: true,
        }, context)
        return selected
    }

    async openPath(input: OpenModelPathInput, context: OpenModelPathContext): Promise<boolean> {
        if (!input.path) {
            return false
        }
        if (isFbxSourcePath(input.path) && !(await requireProFeature(FBX_PRO_FEATURE_NAME))) {
            return false
        }
        if (input.acceptPath && !input.acceptPath(input.path)) {
            return false
        }
        if (input.processedPaths?.has(input.path)) {
            return false
        }

        input.processedPaths?.add(input.path)
        const opened = context.openModelAsTab(input.path)

        if (input.addToRecent) {
            context.setRecentFiles(addRecentFile(input.path))
        }

        return opened
    }

    async openPathsSequentially(input: OpenModelPathsInput, context: OpenModelPathContext): Promise<string[]> {
        const uniquePaths = Array.from(new Set(input.paths.filter(Boolean)))
        const openedPaths: string[] = []

        for (let index = 0; index < uniquePaths.length; index += 1) {
            const path = uniquePaths[index]
            const opened = await this.openPath({
                ...input,
                path,
            }, context)

            if (opened) {
                openedPaths.push(path)
            }

            if (input.delayMs && index < uniquePaths.length - 1) {
                await sleep(input.delayMs)
            }
        }

        return openedPaths
    }

    handleLoadedModel(data: ModelData & { path?: string | null }, context: HandleLoadedModelContext): void {
        context.commitLoadedModel(data, data.path || context.currentModelPath, {
            skipAutoRecalculate: true,
            skipModelRebuild: true,
            deferTabSnapshot: true,
            deferNodeHydration: true,
        })
        context.completeLoading()
        void this.window.focusCurrentWindow().catch(() => {})

        const isSameModel = data.path === context.currentModelPath
        if (!isSameModel) {
            context.setMainMode('view')
            useSelectionStore.getState().clearAllSelections()
        }

        if (Array.isArray(data.Sequences) && data.Sequences.length > 0) {
            setTimeout(() => {
                const store = useModelStore.getState()
                if (!isSameModel || store.currentSequence === -1) {
                    const preferredSequence = store.currentSequence
                    const nextSequence = preferredSequence >= 0 ? preferredSequence : pickDefaultSequenceIndex(data.Sequences ?? [])
                    store.setSequence(nextSequence)
                    store.setPlaying(true)
                }
            }, 300)
            return
        }

        useModelStore.getState().setSequence(-1)
        context.setPlaying(false)
    }
}

export const openModelWorkflow = new OpenModelWorkflow(desktopGateway, windowGateway)
