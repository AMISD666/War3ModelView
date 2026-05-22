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
import { ADVANCED_IMPORT_FEATURE_NAME, isAdvancedImportSourcePath } from '../model-import/fbxSourcePath'
import { requireProFeature } from '../../utils/featureGate'
import { markStartupNow } from '../diagnostics/startupDiagnostics'

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
        markStartupNow('frontend.model_open.open_path_start', {
            source: input.source,
            path: input.path,
        })
        if (isAdvancedImportSourcePath(input.path) && !(await requireProFeature(ADVANCED_IMPORT_FEATURE_NAME))) {
            markStartupNow('frontend.model_open.open_path_blocked_feature_gate', {
                source: input.source,
                path: input.path,
            })
            return false
        }
        if (input.acceptPath && !input.acceptPath(input.path)) {
            markStartupNow('frontend.model_open.open_path_rejected_extension', {
                source: input.source,
                path: input.path,
            })
            return false
        }
        if (input.processedPaths?.has(input.path)) {
            markStartupNow('frontend.model_open.open_path_duplicate_skipped', {
                source: input.source,
                path: input.path,
            })
            return false
        }

        input.processedPaths?.add(input.path)
        const opened = context.openModelAsTab(input.path)
        markStartupNow('frontend.model_open.open_path_tab_result', {
            source: input.source,
            path: input.path,
            opened,
        })

        if (input.addToRecent) {
            context.setRecentFiles(addRecentFile(input.path))
        }

        return opened
    }

    async openPathsSequentially(input: OpenModelPathsInput, context: OpenModelPathContext): Promise<string[]> {
        const uniquePaths = Array.from(new Set(input.paths.filter(Boolean)))
        const openedPaths: string[] = []
        markStartupNow('frontend.model_open.open_paths_start', {
            source: input.source,
            pathCount: uniquePaths.length,
            delayMs: input.delayMs ?? 0,
            paths: uniquePaths,
        })

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

        markStartupNow('frontend.model_open.open_paths_done', {
            source: input.source,
            openedCount: openedPaths.length,
            openedPaths,
        })
        return openedPaths
    }

    handleLoadedModel(data: ModelData & { path?: string | null }, context: HandleLoadedModelContext): void {
        markStartupNow('frontend.model_open.loaded_model_handle_start', {
            path: data.path || context.currentModelPath || '',
            sequenceCount: Array.isArray(data.Sequences) ? data.Sequences.length : 0,
            geosetCount: Array.isArray(data.Geosets) ? data.Geosets.length : 0,
            nodeCount: Array.isArray(data.Nodes) ? data.Nodes.length : 0,
        })
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
            markStartupNow('frontend.model_open.loaded_model_handle_done', {
                path: data.path || context.currentModelPath || '',
                hasSequences: true,
            })
            return
        }

        useModelStore.getState().setSequence(-1)
        context.setPlaying(false)
        markStartupNow('frontend.model_open.loaded_model_handle_done', {
            path: data.path || context.currentModelPath || '',
            hasSequences: false,
        })
    }
}

export const openModelWorkflow = new OpenModelWorkflow(desktopGateway, windowGateway)
