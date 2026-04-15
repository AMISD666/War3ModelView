import React, { useState, useEffect, useRef } from 'react'
import { List, Button, Input, Checkbox, Card, Typography, message, Dropdown, Slider } from 'antd'
import { SmartInputNumber as InputNumber } from '../common/SmartInputNumber'
import type { MenuProps } from 'antd'
import { PlusOutlined, DeleteOutlined, FolderOpenOutlined, DatabaseOutlined, ReloadOutlined } from '@ant-design/icons'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame';
import { DraggableModal } from '../DraggableModal'
import { useSelectionStore } from '../../store/selectionStore'

import { useModelStore } from '../../store/modelStore'
import { useRendererStore } from '../../store/rendererStore'
import { readFile, writeFile, exists, size } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { decodeTextureData, getTextureCandidatePaths, isMPQPath, normalizePath } from '../viewer/textureLoader'
import TextureAdjustWorker from '../../workers/texture-adjust.worker?worker'
import { setDraggedTextureIndex } from '../../utils/textureDragDrop'
import {
    applyTextureAdjustments,
    DEFAULT_TEXTURE_ADJUSTMENTS,
    TextureAdjustments,
    normalizeTextureAdjustments,
    isDefaultTextureAdjustments,
    TEXTURE_ADJUSTMENTS_KEY
} from '../../utils/textureAdjustments'
import { useRpcClient } from '../../hooks/useRpc'
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { markStandalonePerf, markStandalonePerfOnce } from '../../utils/standalonePerf'
import {
    buildTextureDefinitionSignature,
    remapMaterialsAfterTextureRemoval
} from '../../utils/materialTextureRelations'
import { invokeReadMpqFile } from '../../utils/mpqPerf'

const { Text } = Typography

interface TextureEditorModalProps {
    visible: boolean
    onClose: () => void
    modelPath?: string
    isStandalone?: boolean
    initialTextures?: any[]
    onApply?: (textures: any[]) => void | Promise<void>
    asWindow?: boolean
}

interface LocalTexture {
    __editorId: string
    Image?: string
    ReplaceableId?: number
    Flags?: number
    [key: string]: any
}

interface PreviewCacheEntry {
    basePreviewImageData: ImageData | null
    previewUrl: string | null
    previewSource: string | null
    previewError: string | null
}

interface TextureManagerSnapshot {
    textures: any[]
    materials: any[]
    geosets: any[]
    globalSequences: number[]
    modelPath: string | undefined
}

interface TextureManagerRpcState {
    snapshotVersion: number
    snapshot: TextureManagerSnapshot
    pickedGeosetIndex: number | null
}

interface TextureManagerPatch {
    pickedGeosetIndex: number | null
}

const createEditorId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `tex-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const ensureLocalTexture = (texture: any): LocalTexture => ({
    ...texture,
    __editorId: typeof texture?.__editorId === 'string' ? texture.__editorId : createEditorId()
})

const TextureEditorModal: React.FC<TextureEditorModalProps> = ({
    visible,
    onClose,
    modelPath: propModelPath,
    isStandalone = false,
    initialTextures,
    onApply,
    asWindow = false
}) => {
    // 1. Local Store & RPC Fallback Setups
    const localStore = useModelStore()
    const isDetachedWindow = asWindow === true
    const textureSaveMode = useRendererStore(state => state.textureSaveMode)
    const setTextureSaveMode = useRendererStore(state => state.setTextureSaveMode)
    const textureSaveSuffix = useRendererStore(state => state.textureSaveSuffix)
    const setTextureSaveSuffix = useRendererStore(state => state.setTextureSaveSuffix)

    const initialRpcState: TextureManagerRpcState = {
        snapshotVersion: 0,
        snapshot: {
            textures: [],
            materials: [],
            geosets: [],
            globalSequences: [],
            modelPath: undefined,
        },
        pickedGeosetIndex: null,
    }

    const { state: rpcState, emitCommand } = useRpcClient<TextureManagerRpcState, TextureManagerPatch>(
        'textureManager',
        initialRpcState,
        {
            applyPatch: (previousState, patch) => {
                const nextPickedGeosetIndex = patch?.pickedGeosetIndex ?? null
                if (previousState.pickedGeosetIndex === nextPickedGeosetIndex) {
                    return previousState
                }
                return {
                    ...previousState,
                    pickedGeosetIndex: nextPickedGeosetIndex,
                }
            }
        }
    )

    const rpcSnapshot = rpcState.snapshot
    const modelPath = propModelPath ?? (isStandalone ? rpcSnapshot.modelPath : localStore.modelPath ?? undefined)

    // Abstract the active data source based on mode
    const getActiveData = () => {
        if (isStandalone) {
            return {
                Textures: rpcSnapshot.textures,
                Materials: rpcSnapshot.materials,
                Geosets: rpcSnapshot.geosets,
                GlobalSequences: rpcSnapshot.globalSequences,
                pickedGeosetIndex: rpcState.pickedGeosetIndex
            }
        } else if (isDetachedWindow) {
            return {
                Textures: initialTextures || [],
                Materials: [],
                Geosets: [],
                GlobalSequences: [],
                pickedGeosetIndex: null
            }
        } else {
            return {
                Textures: localStore.modelData?.Textures || [],
                Materials: localStore.modelData?.Materials || [],
                Geosets: localStore.modelData?.Geosets || [],
                GlobalSequences: localStore.modelData?.GlobalSequences || [],
                pickedGeosetIndex: useSelectionStore.getState().pickedGeosetIndex
            }
        }
    }

    const [localTextures, setLocalTextures] = useState<LocalTexture[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [isExternalTextureDropActive, setIsExternalTextureDropActive] = useState(false)
    // 路径输入框本地缓冲，避免每次 onChange 触发全量重渲染导致输入框失去焦点
    const [pathInputValue, setPathInputValue] = useState('')

    const isSaveAsMode = textureSaveMode === 'save_as'
    const textureSaveModeLabel = isSaveAsMode ? '另存为' : '覆盖原贴图'

    const handleTextureSaveModeChange = (mode: 'overwrite' | 'save_as') => {
        setTextureSaveMode(mode)
        if (isStandalone) {
            emitCommand('EXECUTE_TEXTURE_ACTION', { action: 'SET_TEXTURE_SAVE_MODE', payload: { mode } })
        }
    }

    const handleTextureSaveSuffixChange = (suffix: string) => {
        setTextureSaveSuffix(suffix)
        if (isStandalone) {
            emitCommand('EXECUTE_TEXTURE_ACTION', { action: 'SET_TEXTURE_SAVE_SUFFIX', payload: { suffix } })
        }
    }

    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [isLoadingPreview, setIsLoadingPreview] = useState(false)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [previewSource, setPreviewSource] = useState<string | null>(null) // 'mpq' | 'file' | null
    const [basePreviewImageData, setBasePreviewImageData] = useState<ImageData | null>(null)
    const [adjustmentsByTextureId, setAdjustmentsByTextureId] = useState<Record<string, TextureAdjustments>>({})
    const listRef = useRef<HTMLDivElement>(null)
    const previewLoadIdRef = useRef(0)
    const hasLiveTextureOverrideRef = useRef(false)
    const previewCacheRef = useRef<Map<string, PreviewCacheEntry>>(new Map())
    const selectedPreviewCacheKeyRef = useRef<string | null>(null)
    const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const previewAdjustWorkerRef = useRef<Worker | null>(null)
    const previewAdjustSourceKeyRef = useRef<string | null>(null)
    const previewAdjustRequestIdRef = useRef(0)
    const previewAdjustInFlightRef = useRef(false)
    const pendingPreviewAdjustmentsRef = useRef<TextureAdjustments>(DEFAULT_TEXTURE_ADJUSTMENTS)
    const latestAdjustedPreviewImageDataRef = useRef<ImageData | null>(null)
    const latestAdjustedPreviewAdjustmentsRef = useRef<TextureAdjustments>(DEFAULT_TEXTURE_ADJUSTMENTS)
    const latestAdjustedPreviewKeyRef = useRef<string | null>(null)
    const pendingRendererSyncRef = useRef<{
        textureId: string
        imagePath?: string
        adjustments: TextureAdjustments
        previewKey: string | null
    } | null>(null)
    const rendererAdjustmentFlushTimeoutRef = useRef<number | null>(null)
    const latestSelectedTextureRef = useRef<LocalTexture | null>(null)
    const latestSelectedAdjustmentsRef = useRef<TextureAdjustments>(DEFAULT_TEXTURE_ADJUSTMENTS)
    const latestBasePreviewImageDataRef = useRef<ImageData | null>(null)
    const localTexturesRef = useRef<LocalTexture[]>([])
    const adjustmentsByTextureIdRef = useRef<Record<string, TextureAdjustments>>({})
    const pendingTextureSaveTimeoutRef = useRef<number | null>(null)
    /** 路径框正在编辑时，禁止用父级/RPC 状态覆盖输入，避免失焦与截断输入 */
    const pathInputEditingRef = useRef(false)
    const pathInputSelectedIndexRef = useRef(-1)

    // Helper to scroll to selected item
    const scrollToItem = (index: number) => {
        if (listRef.current && index >= 0) {
            const itemHeight = 48 // Approximate height of list item
            listRef.current.scrollTop = index * itemHeight
        }
    }

    const getReplaceableLabel = (id?: number) => {
        if (!id) return null
        return `ReplaceableId ${id}`
    }

    const makeSolidDataUrl = (r: number, g: number, b: number, a: number = 255) => {
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 64
        const ctx = canvas.getContext('2d')
        if (ctx) {
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            return canvas.toDataURL()
        }
        return null
    }
    const lastHandledPickedGeosetRef = useRef<number | null | undefined>(undefined)
    const isInitializedRef = useRef(false)
    const lastTexturesSignatureRef = useRef('')
    const lastStandaloneSnapshotVersionRef = useRef<number | null>(null)
    const lastSelectedIndexRef = useRef(-1)
    const selectedTexture = selectedIndex >= 0 ? localTextures[selectedIndex] : null
    const selectedTextureId = selectedTexture?.__editorId || ''
    const selectedAdjustments = selectedTextureId
        ? (adjustmentsByTextureId[selectedTextureId] || DEFAULT_TEXTURE_ADJUSTMENTS)
        : DEFAULT_TEXTURE_ADJUSTMENTS

    useEffect(() => {
        lastSelectedIndexRef.current = selectedIndex
    }, [selectedIndex])

    // 路径输入：仅在切换选中项或外部数据更新且未在编辑时同步到输入框；保存仅在失焦/Enter 时 commitPathInput
    useEffect(() => {
        const indexChanged = pathInputSelectedIndexRef.current !== selectedIndex
        pathInputSelectedIndexRef.current = selectedIndex

        if (indexChanged) {
            pathInputEditingRef.current = false
        }

        if (pathInputEditingRef.current) {
            return
        }

        if (selectedIndex < 0) {
            setPathInputValue('')
            return
        }
        setPathInputValue(selectedTexture?.Image ?? '')
    }, [selectedIndex, selectedTexture?.__editorId, selectedTexture?.Image])

    const serializeTexturesForSave = (
        textures: LocalTexture[],
        adjustmentsMap: Record<string, TextureAdjustments> = adjustmentsByTextureIdRef.current
    ): any[] => {
        return textures.map((texture) => {
            const { __editorId, ...rest } = texture
            const raw = adjustmentsMap[__editorId]
            if (raw) {
                const normalized = normalizeTextureAdjustments(raw)
                if (!isDefaultTextureAdjustments(normalized)) {
                    return {
                        ...rest,
                        [TEXTURE_ADJUSTMENTS_KEY]: normalized
                    }
                }
            }
            if (Object.prototype.hasOwnProperty.call(rest, TEXTURE_ADJUSTMENTS_KEY)) {
                const cleaned = { ...rest }
                delete cleaned[TEXTURE_ADJUSTMENTS_KEY]
                return cleaned
            }
            return rest
        })
    }

    const syncStandaloneTextures = (
        textures: LocalTexture[],
        adjustmentsMap: Record<string, TextureAdjustments> = adjustmentsByTextureIdRef.current
    ) => {
        if (!isStandalone) {
            return
        }
        emitCommand('EXECUTE_TEXTURE_ACTION', {
            action: 'SAVE_TEXTURES',
            payload: serializeTexturesForSave(textures, adjustmentsMap)
        })
    }

    const buildTextureDeletionResult = (
        removedIndex: number,
        nextLocalTextures: LocalTexture[]
    ): { texturesForSave: any[]; materialsForSave: any[] } => {
        const texturesForSave = serializeTexturesForSave(nextLocalTextures)
        const activeData = getActiveData()
        const currentMaterials = Array.isArray(activeData.Materials) ? activeData.Materials : []
        const materialsForSave = remapMaterialsAfterTextureRemoval(currentMaterials, removedIndex, nextLocalTextures.length)

        return { texturesForSave, materialsForSave }
    }

    const commitTextureCollection = (
        nextTextures: LocalTexture[],
        adjustmentsMap: Record<string, TextureAdjustments> = adjustmentsByTextureIdRef.current
    ) => {
        setLocalTextures(nextTextures)
        const texturesForSave = serializeTexturesForSave(nextTextures, adjustmentsMap)
        if (isStandalone) {
            emitCommand('EXECUTE_TEXTURE_ACTION', { action: 'SAVE_TEXTURES', payload: texturesForSave })
        } else if (isDetachedWindow) {
            void Promise.resolve(onApply?.(texturesForSave)).catch((error) => {
                console.error('[TextureEditor] Failed to apply detached textures:', error)
            })
        } else {
            localStore.setTextures(texturesForSave)
        }
    }

    const commitPathInput = () => {
        if (selectedIndex < 0) return
        const newPath = pathInputValue
        if (newPath === (localTextures[selectedIndex]?.Image ?? '')) return
        updateLocalTexture(selectedIndex, { Image: newPath })
    }

    useEffect(() => {
        latestSelectedTextureRef.current = selectedTexture
    }, [selectedTexture])

    useEffect(() => {
        localTexturesRef.current = localTextures
    }, [localTextures])

    useEffect(() => {
        adjustmentsByTextureIdRef.current = adjustmentsByTextureId
    }, [adjustmentsByTextureId])

    useEffect(() => {
        latestSelectedAdjustmentsRef.current = selectedAdjustments
    }, [selectedAdjustments])

    useEffect(() => {
        latestBasePreviewImageDataRef.current = basePreviewImageData
    }, [basePreviewImageData])

    useEffect(() => {
        const worker = new TextureAdjustWorker()
        previewAdjustWorkerRef.current = worker

        worker.onmessage = (event: MessageEvent<any>) => {
            const payload = event.data
            if (!payload || payload.type !== 'result') {
                return
            }

            if (payload.key !== selectedPreviewCacheKeyRef.current) {
                return
            }

            if (payload.requestId !== previewAdjustRequestIdRef.current) {
                return
            }

            previewAdjustInFlightRef.current = false

            const adjusted = new ImageData(new Uint8ClampedArray(payload.buffer), payload.width, payload.height)
            const normalizedAdjustments = normalizeTextureAdjustments(payload.adjustments)
            latestAdjustedPreviewImageDataRef.current = adjusted
            latestAdjustedPreviewAdjustmentsRef.current = normalizedAdjustments
            latestAdjustedPreviewKeyRef.current = payload.key
            drawPreviewImageData(adjusted)
            setPreviewUrl(null)
            fulfillPendingRendererSync()

            if (!areAdjustmentsEqual(pendingPreviewAdjustmentsRef.current, normalizedAdjustments)) {
                dispatchPreviewAdjustments(pendingPreviewAdjustmentsRef.current)
            }
        }

        worker.onerror = () => {
            previewAdjustInFlightRef.current = false
            previewAdjustWorkerRef.current = null
            applyPreviewAdjustmentsNow(pendingPreviewAdjustmentsRef.current)
        }

        worker.onmessageerror = () => {
            previewAdjustInFlightRef.current = false
            previewAdjustWorkerRef.current = null
            applyPreviewAdjustmentsNow(pendingPreviewAdjustmentsRef.current)
        }

        return () => {
            pendingRendererSyncRef.current = null
            previewAdjustInFlightRef.current = false
            previewAdjustWorkerRef.current = null
            previewAdjustSourceKeyRef.current = null
            if (rendererAdjustmentFlushTimeoutRef.current !== null) {
                window.clearTimeout(rendererAdjustmentFlushTimeoutRef.current)
            }
            if (pendingTextureSaveTimeoutRef.current !== null) {
                window.clearTimeout(pendingTextureSaveTimeoutRef.current)
                pendingTextureSaveTimeoutRef.current = null
            }
            worker.terminate()
        }
    }, [])

    useEffect(() => {
        if (!isStandalone) return
        markStandalonePerf('child_runtime_mounted', { windowId: 'textureManager' })
    }, [isStandalone])

    useEffect(() => {
        if (!isStandalone || !visible || localTextures.length === 0) return
        markStandalonePerfOnce('textureManager:first_content_rendered', 'first_content_rendered', {
            windowId: 'textureManager',
            textureCount: localTextures.length,
            selectedIndex,
        })
    }, [isStandalone, visible, localTextures.length, selectedIndex])

    const getTextureIndexForPickedGeoset = (data: ReturnType<typeof getActiveData>): number => {
        const pickedGeosetIndex = data?.pickedGeosetIndex
        if (pickedGeosetIndex === null || pickedGeosetIndex === undefined) return -1
        if (!data.Geosets || !data.Geosets[pickedGeosetIndex]) return -1

        const materialId = data.Geosets[pickedGeosetIndex].MaterialID
        if (materialId === undefined || !data.Materials || !data.Materials[materialId]) return -1

        const material = data.Materials[materialId]
        if (!material?.Layers || material.Layers.length === 0) return -1

        const textureId = material.Layers[0].TextureID
        if (typeof textureId !== 'number' || textureId < 0 || textureId >= data.Textures.length) return -1

        return textureId
    }


    useEffect(() => {
        if (!isStandalone || !visible) return

        let disposed = false
        let unlistenModelChange: (() => void) | undefined

        listen<{ modelPath?: string }>('active-model-changed', (event) => {
            if (disposed) return
            const nextModelPath = String(event.payload?.modelPath || '')
            const currentModelPath = String(rpcState.snapshot.modelPath || '')
            if (nextModelPath === currentModelPath && currentModelPath !== '') {
                return
            }
            emit('rpc-req-textureManager').catch(() => { })
        }).then((fn) => {
            if (disposed) {
                fn()
                return
            }
            unlistenModelChange = fn
        }).catch(() => { })

        return () => {
            disposed = true
            if (unlistenModelChange) unlistenModelChange()
        }
    }, [isStandalone, visible, rpcState.snapshot.modelPath])

    // Focus listener to forcefully request data when window becomes active
    useEffect(() => {
        if (!isStandalone || !visible) return
        const handleFocus = () => {
            emit('rpc-req-textureManager').catch(() => { })
        }
        window.addEventListener('focus', handleFocus)
        return () => window.removeEventListener('focus', handleFocus)
    }, [isStandalone, visible])

    // Initialize local state
    useEffect(() => {
        const data = getActiveData()

        if (!visible) {
            isInitializedRef.current = false
            lastTexturesSignatureRef.current = ''
            lastStandaloneSnapshotVersionRef.current = null
            lastHandledPickedGeosetRef.current = undefined
            return
        }

        if (data && data.Textures && data.Textures.length > 0) {
            const textureSignature = buildTextureDefinitionSignature(data.Textures)
            const snapshotChanged = isStandalone && lastStandaloneSnapshotVersionRef.current !== rpcState.snapshotVersion
            // 仅当贴图定义真正变化时全量重置；snapshotVersion 会周期性递增，不应单独触发重置（否则会重建 __editorId、打断路径输入焦点）
            const texturesChanged =
                !isInitializedRef.current ||
                lastTexturesSignatureRef.current !== textureSignature

            if (!texturesChanged) {
                if (isStandalone && snapshotChanged) {
                    lastStandaloneSnapshotVersionRef.current = rpcState.snapshotVersion
                }
                return
            }
            const cloned = JSON.parse(JSON.stringify(data.Textures))
            const nextAdjustments: Record<string, TextureAdjustments> = {}
            const prevSnapshot = localTexturesRef.current
            const textureItemIdentityKey = (x: any) =>
                JSON.stringify({
                    image: x?.Image ?? '',
                    replaceableId: x?.ReplaceableId ?? 0,
                    flags: x?.Flags ?? 0,
                })
            const withReplaceables = cloned.map((t: any, i: number) => {
                const prevT = i < prevSnapshot.length ? prevSnapshot[i] : null
                const withStableId =
                    prevT &&
                    typeof prevT.__editorId === 'string' &&
                    textureItemIdentityKey(prevT) === textureItemIdentityKey(t)
                        ? { ...t, __editorId: prevT.__editorId }
                        : t

                if (!t?.Image && t?.ReplaceableId === 1) {
                    const texture = ensureLocalTexture({ ...withStableId, Image: 'ReplaceableTextures\\TeamColor\\TeamColor00.blp' })
                    if (t?.[TEXTURE_ADJUSTMENTS_KEY]) {
                        nextAdjustments[texture.__editorId] = normalizeTextureAdjustments(t[TEXTURE_ADJUSTMENTS_KEY])
                    }
                    return texture
                }
                if (!t?.Image && t?.ReplaceableId === 2) {
                    const texture = ensureLocalTexture({ ...withStableId, Image: 'ReplaceableTextures\\TeamGlow\\TeamGlow00.blp' })
                    if (t?.[TEXTURE_ADJUSTMENTS_KEY]) {
                        nextAdjustments[texture.__editorId] = normalizeTextureAdjustments(t[TEXTURE_ADJUSTMENTS_KEY])
                    }
                    return texture
                }
                const texture = ensureLocalTexture(withStableId)
                if (t?.[TEXTURE_ADJUSTMENTS_KEY]) {
                    nextAdjustments[texture.__editorId] = normalizeTextureAdjustments(t[TEXTURE_ADJUSTMENTS_KEY])
                }
                return texture
            })

            const rememberedIndex = lastSelectedIndexRef.current
            const pickedTextureIndex = getTextureIndexForPickedGeoset(data)
            const nextSelectedIndex =
                (!isInitializedRef.current && pickedTextureIndex >= 0 && pickedTextureIndex < withReplaceables.length)
                    ? pickedTextureIndex
                    : rememberedIndex >= 0 && rememberedIndex < withReplaceables.length
                        ? rememberedIndex
                        : selectedIndex >= 0 && selectedIndex < withReplaceables.length
                            ? selectedIndex
                            : pickedTextureIndex >= 0 && pickedTextureIndex < withReplaceables.length
                                ? pickedTextureIndex
                                : withReplaceables.length > 0
                                    ? 0
                                    : -1

            setLocalTextures(withReplaceables)
            setAdjustmentsByTextureId(nextAdjustments)
            setBasePreviewImageData(null)
            hasLiveTextureOverrideRef.current = false
            setSelectedIndex(nextSelectedIndex)

            if (nextSelectedIndex >= 0) {
                setTimeout(() => scrollToItem(nextSelectedIndex), 0)
            }

            lastTexturesSignatureRef.current = textureSignature
            lastStandaloneSnapshotVersionRef.current = isStandalone ? rpcState.snapshotVersion : null
            isInitializedRef.current = true
            lastHandledPickedGeosetRef.current = data.pickedGeosetIndex ?? null
        } else if (visible) {
            setLocalTextures([])
            setSelectedIndex(-1)
            setAdjustmentsByTextureId({})
            setBasePreviewImageData(null)
            hasLiveTextureOverrideRef.current = false
            isInitializedRef.current = false
            lastTexturesSignatureRef.current = ''
            lastHandledPickedGeosetRef.current = data?.pickedGeosetIndex ?? null
            lastStandaloneSnapshotVersionRef.current = isStandalone ? rpcState.snapshotVersion : null
        }
    }, [visible, isStandalone ? rpcState.snapshotVersion : isDetachedWindow ? initialTextures : localStore.modelData?.Textures])

    // Subscribe to Ctrl+Click geoset picking - auto-select texture
    useEffect(() => {
        const data = getActiveData()
        if (!visible || !data) return

        const handlePickedGeoset = (pickedGeosetIndex: number | null) => {
            if (pickedGeosetIndex === lastHandledPickedGeosetRef.current) {
                return
            }

            lastHandledPickedGeosetRef.current = pickedGeosetIndex

            if (pickedGeosetIndex === null || !data.Geosets || !data.Geosets[pickedGeosetIndex]) {
                return
            }

            const materialId = data.Geosets[pickedGeosetIndex].MaterialID
            if (materialId === undefined || !data.Materials || !data.Materials[materialId]) {
                return
            }

            const material = data.Materials[materialId]
            if (!material.Layers || material.Layers.length === 0) {
                return
            }

            const textureId = material.Layers[0].TextureID
            if (typeof textureId !== 'number' || textureId < 0 || textureId >= localTextures.length) {
                return
            }

            if (textureId !== lastSelectedIndexRef.current) {
                setSelectedIndex(textureId)
                setTimeout(() => scrollToItem(textureId), 0)
            }
        }

        if (isStandalone) {
            handlePickedGeoset(rpcState.pickedGeosetIndex ?? null)
            return
        }

        let lastPickedIndex: number | null = useSelectionStore.getState().pickedGeosetIndex

        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                handlePickedGeoset(pickedGeosetIndex)
            }
        })
        return unsubscribe
    }, [visible, isStandalone, rpcState.pickedGeosetIndex, isStandalone ? rpcState.snapshotVersion : localStore.modelData?.Geosets, isStandalone ? rpcState.snapshotVersion : localStore.modelData?.Materials, localTextures.length])

    const toUint8Array = (payload: any): Uint8Array | null => {
        if (!payload) return null
        if (payload instanceof Uint8Array) return payload
        if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
        if (ArrayBuffer.isView(payload)) {
            return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
        }
        if (Array.isArray(payload)) {
            return new Uint8Array(payload)
        }
        if (typeof payload === 'string') {
            try {
                const binary = atob(payload)
                const bytes = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i)
                }
                return bytes
            } catch {
                return null
            }
        }
        return null
    }

    const toArrayBuffer = (payload: any): ArrayBuffer | null => {
        const bytes = toUint8Array(payload)
        if (!bytes) return null
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }

    const isAbsolutePath = (p: string) => /^[a-zA-Z]:/.test(p) || p.startsWith('\\')

    const getLocalCandidates = (imagePath: string): string[] => {
        const normalized = normalizePath(imagePath)
        if (isAbsolutePath(normalized)) return [normalized]
        if (modelPath) return getTextureCandidatePaths(modelPath, normalized)
        return [normalized]
    }
    const getPreviewCacheKey = (texture: LocalTexture | null | undefined): string => {
        const imagePath = typeof texture?.Image === 'string' ? normalizePath(texture.Image) : ''
        return `${modelPath || ''}::${texture?.__editorId || ''}::${texture?.ReplaceableId ?? -1}::${imagePath}`
    }

    const writePreviewCache = (cacheKey: string, entry: PreviewCacheEntry) => {
        const cache = previewCacheRef.current
        if (cache.has(cacheKey)) cache.delete(cacheKey)
        cache.set(cacheKey, entry)
        if (cache.size > 96) {
            const oldestKey = cache.keys().next().value
            if (typeof oldestKey === 'string') cache.delete(oldestKey)
        }
    }

    const applyCachedPreview = (cacheKey: string, allowPreviewUrl: boolean): boolean => {
        const cache = previewCacheRef.current
        const cached = cache.get(cacheKey)
        if (!cached) return false
        cache.delete(cacheKey)
        cache.set(cacheKey, cached)
        setPreviewError(cached.previewError)
        setPreviewSource(cached.previewSource)
        setBasePreviewImageData(cached.basePreviewImageData)
        setPreviewUrl(cached.basePreviewImageData && !allowPreviewUrl ? null : cached.previewUrl)
        setIsLoadingPreview(false)
        return true
    }

    const toPercent = (value: number) => `${Math.round(value)}%`
    const toDegree = (value: number) => `${Math.round(value)}°`
    const huePreviewColor = `hsl(${Math.round(selectedAdjustments.hue + 180)}, 100%, 50%)`

    const areAdjustmentsEqual = (left: TextureAdjustments, right: TextureAdjustments) =>
        left.hue === right.hue &&
        left.brightness === right.brightness &&
        left.saturation === right.saturation &&
        left.opacity === right.opacity

    const drawPreviewImageData = (imageData: ImageData | null) => {
        const canvas = previewCanvasRef.current
        if (!canvas || !imageData) {
            return
        }

        if (canvas.width !== imageData.width) canvas.width = imageData.width
        if (canvas.height !== imageData.height) canvas.height = imageData.height

        const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false })
        if (!ctx) {
            return
        }

        ctx.putImageData(imageData, 0, 0)
    }

    const fulfillPendingRendererSync = () => {
        const pending = pendingRendererSyncRef.current
        const adjustedImageData = latestAdjustedPreviewImageDataRef.current
        if (!pending || !adjustedImageData) {
            return
        }

        if (pending.previewKey !== latestAdjustedPreviewKeyRef.current) {
            return
        }

        if (!areAdjustmentsEqual(pending.adjustments, latestAdjustedPreviewAdjustmentsRef.current)) {
            return
        }

        applyTextureToRenderer(pending.imagePath, adjustedImageData)
        hasLiveTextureOverrideRef.current = !isDefaultTextureAdjustments(pending.adjustments)
        pendingRendererSyncRef.current = null
    }

    const applyPreviewAdjustmentsNow = (adjustments: TextureAdjustments) => {
        const cacheKey = selectedPreviewCacheKeyRef.current
        const sourceImageData = latestBasePreviewImageDataRef.current
        if (!sourceImageData || !cacheKey) {
            return
        }

        const normalizedAdjustments = normalizeTextureAdjustments(adjustments)
        const adjusted = isDefaultTextureAdjustments(normalizedAdjustments)
            ? sourceImageData
            : applyTextureAdjustments(sourceImageData, normalizedAdjustments)

        latestAdjustedPreviewImageDataRef.current = adjusted
        latestAdjustedPreviewAdjustmentsRef.current = normalizedAdjustments
        latestAdjustedPreviewKeyRef.current = cacheKey
        drawPreviewImageData(adjusted)
        setPreviewUrl(null)
        fulfillPendingRendererSync()
    }

    const dispatchPreviewAdjustments = (adjustments: TextureAdjustments) => {
        const cacheKey = selectedPreviewCacheKeyRef.current
        const worker = previewAdjustWorkerRef.current
        const normalizedAdjustments = normalizeTextureAdjustments(adjustments)

        pendingPreviewAdjustmentsRef.current = normalizedAdjustments

        if (!cacheKey || !latestBasePreviewImageDataRef.current) {
            return
        }

        if (isDefaultTextureAdjustments(normalizedAdjustments)) {
            previewAdjustInFlightRef.current = false
            applyPreviewAdjustmentsNow(normalizedAdjustments)
            return
        }

        if (!worker || previewAdjustSourceKeyRef.current !== cacheKey) {
            applyPreviewAdjustmentsNow(normalizedAdjustments)
            return
        }

        if (previewAdjustInFlightRef.current) {
            return
        }

        previewAdjustInFlightRef.current = true
        const requestId = ++previewAdjustRequestIdRef.current
        worker.postMessage({
            type: 'apply',
            key: cacheKey,
            requestId,
            adjustments: normalizedAdjustments,
        })
    }

    const clearRendererAdjustmentFlush = () => {
        if (rendererAdjustmentFlushTimeoutRef.current !== null) {
            window.clearTimeout(rendererAdjustmentFlushTimeoutRef.current)
            rendererAdjustmentFlushTimeoutRef.current = null
        }
    }

    const applyTextureToRenderer = (imagePath: string | undefined, imageData: ImageData) => {
        if (!imagePath) return

        const renderer = useRendererStore.getState().renderer
        if (renderer && typeof renderer.setTextureImageData === 'function') {
            renderer.setTextureImageData(imagePath, [imageData])

            const normalized = normalizePath(imagePath)
            if (normalized !== imagePath) {
                renderer.setTextureImageData(normalized, [imageData])
            }

            const forwardSlash = normalized.replace(/\\/g, '/')
            if (forwardSlash !== normalized) {
                renderer.setTextureImageData(forwardSlash, [imageData])
            }
        }
    }

    const flushTextureAdjustmentsToRenderer = (options?: {
        adjustments?: TextureAdjustments
        textureId?: string
    }) => {
        const texture = latestSelectedTextureRef.current
        const sourceImageData = latestBasePreviewImageDataRef.current
        const nextAdjustments = normalizeTextureAdjustments(
            options?.adjustments || latestSelectedAdjustmentsRef.current
        )

        if (!texture?.Image || !sourceImageData) return
        if (options?.textureId && texture.__editorId !== options.textureId) return

        const previewKey = selectedPreviewCacheKeyRef.current

        if (isStandalone) {
            emit('IPC_LIVE_TEXTURE_ADJUST', {
                modelPath: modelPath || '',
                imagePath: texture.Image,
                adjustments: nextAdjustments,
            })
            hasLiveTextureOverrideRef.current = !isDefaultTextureAdjustments(nextAdjustments)
            pendingRendererSyncRef.current = null
            return
        }

        if (isDefaultTextureAdjustments(nextAdjustments)) {
            pendingRendererSyncRef.current = null
            applyTextureToRenderer(texture.Image, sourceImageData)
            hasLiveTextureOverrideRef.current = false
            return
        }

        if (
            latestAdjustedPreviewImageDataRef.current &&
            latestAdjustedPreviewKeyRef.current === previewKey &&
            areAdjustmentsEqual(nextAdjustments, latestAdjustedPreviewAdjustmentsRef.current)
        ) {
            pendingRendererSyncRef.current = null
            applyTextureToRenderer(texture.Image, latestAdjustedPreviewImageDataRef.current)
            hasLiveTextureOverrideRef.current = true
            return
        }

        pendingRendererSyncRef.current = {
            textureId: texture.__editorId,
            imagePath: texture.Image,
            adjustments: nextAdjustments,
            previewKey,
        }

        dispatchPreviewAdjustments(nextAdjustments)
    }

    const scheduleTextureAdjustmentRendererFlush = (
        textureId: string,
        adjustments: TextureAdjustments,
        delayMs: number
    ) => {
        clearRendererAdjustmentFlush()
        rendererAdjustmentFlushTimeoutRef.current = window.setTimeout(() => {
            rendererAdjustmentFlushTimeoutRef.current = null
            flushTextureAdjustmentsToRenderer({ textureId, adjustments })
        }, delayMs)
    }

    const updateSelectedAdjustment = (
        patch: Partial<TextureAdjustments>,
        rendererSync: 'none' | 'debounced' | 'immediate' = 'none'
    ) => {
        if (!selectedTextureId) return

        const nextAdjustments = normalizeTextureAdjustments({
            ...latestSelectedAdjustmentsRef.current,
            ...patch
        })

        latestSelectedAdjustmentsRef.current = nextAdjustments

        setAdjustmentsByTextureId((prev) => ({
            ...prev,
            [selectedTextureId]: nextAdjustments
        }))

        if (rendererSync === 'immediate') {
            clearRendererAdjustmentFlush()
            flushTextureAdjustmentsToRenderer({ textureId: selectedTextureId, adjustments: nextAdjustments })
            return
        }

        if (rendererSync === 'debounced') {
            scheduleTextureAdjustmentRendererFlush(
                selectedTextureId,
                nextAdjustments,
                isStandalone ? 48 : 64
            )
        }
    }

    const handleAdjustmentSliderChange = (field: keyof TextureAdjustments, value: number | boolean) => {
        updateSelectedAdjustment({ [field]: value }, 'debounced')
    }

    const scheduleTextureSave = () => {
        if (pendingTextureSaveTimeoutRef.current !== null) {
            window.clearTimeout(pendingTextureSaveTimeoutRef.current)
        }
        pendingTextureSaveTimeoutRef.current = window.setTimeout(() => {
            pendingTextureSaveTimeoutRef.current = null
            const texturesForSave = buildTexturesForSave()
            if (isStandalone) {
                emitCommand('EXECUTE_TEXTURE_ACTION', { action: 'SAVE_TEXTURES', payload: texturesForSave })
            } else if (isDetachedWindow) {
                void Promise.resolve(onApply?.(texturesForSave)).catch((error) => {
                    console.error('[TextureEditor] Failed to auto-apply detached textures:', error)
                })
            } else {
                localStore.setTextures(texturesForSave)
            }
        }, 120)
    }

    const handleAdjustmentSliderComplete = () => {
        if (!selectedTextureId) return
        clearRendererAdjustmentFlush()
        flushTextureAdjustmentsToRenderer({ textureId: selectedTextureId })
        scheduleTextureSave()
    }

    const resetAdjustmentField = (field: keyof TextureAdjustments) => {
        updateSelectedAdjustment({ [field]: DEFAULT_TEXTURE_ADJUSTMENTS[field] }, 'immediate')
        scheduleTextureSave()
    }

    const buildTexturesForSave = (): any[] => serializeTexturesForSave(localTextures)

    const handleCancel = () => {
        if (hasLiveTextureOverrideRef.current) {
            if (isStandalone) {
                emitCommand('EXECUTE_TEXTURE_ACTION', { action: 'RELOAD_RENDERER' })
            } else {
                localStore.triggerRendererReload()
            }
            hasLiveTextureOverrideRef.current = false
        }
        onClose()
    }

    const handleOk = () => {
        const texturesForSave = buildTexturesForSave()

        if (isStandalone) {
            emitCommand('EXECUTE_TEXTURE_ACTION', { action: 'SAVE_TEXTURES', payload: texturesForSave })
        } else if (isDetachedWindow) {
            void Promise.resolve(onApply?.(texturesForSave)).catch((error) => {
                console.error('[TextureEditor] Failed to apply detached textures:', error)
            })
        } else {
            localStore.setTextures(texturesForSave)
        }

        message.success('纹理已保存')
        hasLiveTextureOverrideRef.current = false
        if (isStandalone) {
            onClose()
        } else {
            onClose()
        }
    }

    // Load preview when selection changes
    useEffect(() => {
        const loadId = ++previewLoadIdRef.current
        const isStale = () => previewLoadIdRef.current !== loadId

        const loadTexture = async () => {
            if (!selectedTexture) {
                setIsLoadingPreview(false)
                setPreviewUrl(null)
                setPreviewError(null)
                setPreviewSource(null)
                setBasePreviewImageData(null)
                selectedPreviewCacheKeyRef.current = null
                return
            }

            const texture = selectedTexture
            const cacheKey = getPreviewCacheKey(texture)
            selectedPreviewCacheKeyRef.current = cacheKey
            const allowCachedPreviewUrl = isDefaultTextureAdjustments(selectedAdjustments)
            latestAdjustedPreviewImageDataRef.current = null
            latestAdjustedPreviewAdjustmentsRef.current = DEFAULT_TEXTURE_ADJUSTMENTS
            latestAdjustedPreviewKeyRef.current = null
            pendingRendererSyncRef.current = null
            if (applyCachedPreview(cacheKey, allowCachedPreviewUrl)) {
                return
            }

            if (!texture.Image) {
                setIsLoadingPreview(false)
                setBasePreviewImageData(null)
                const replaceableLabel = getReplaceableLabel(texture.ReplaceableId)
                if (texture.ReplaceableId === 1) {
                    const url = makeSolidDataUrl(220, 60, 60)
                    setPreviewUrl(url)
                    setPreviewError(null)
                    setPreviewSource('Replaceable')
                    writePreviewCache(cacheKey, { basePreviewImageData: null, previewUrl: url, previewSource: 'Replaceable', previewError: null })
                } else if (texture.ReplaceableId === 2) {
                    const url = makeSolidDataUrl(255, 210, 0)
                    setPreviewUrl(url)
                    setPreviewError(null)
                    setPreviewSource('Replaceable')
                    writePreviewCache(cacheKey, { basePreviewImageData: null, previewUrl: url, previewSource: 'Replaceable', previewError: null })
                } else if (replaceableLabel) {
                    setPreviewUrl(null)
                    setPreviewError(replaceableLabel)
                    setPreviewSource(null)
                } else {
                    setPreviewUrl(null)
                    setPreviewError('无法加载贴图')
                    setPreviewSource(null)
                }
                return
            }

            const imagePath = texture.Image
            const normalizedImagePath = normalizePath(imagePath)
            const isBlp = imagePath.toLowerCase().endsWith('.blp')
            const isTga = imagePath.toLowerCase().endsWith('.tga')
            const isSupported = isBlp || isTga
            const isReplaceable = texture.ReplaceableId === 1 || texture.ReplaceableId === 2

            setIsLoadingPreview(true)
            setPreviewError(null)
            setPreviewUrl(null)
            setPreviewSource(null)
            setBasePreviewImageData(null)

            let loaded = false

            const isMpqPath = isMPQPath(normalizedImagePath)

            if (isMpqPath && isSupported) {
                try {
                    const mpqPath = normalizedImagePath
                    const mpqData = await invokeReadMpqFile<Uint8Array>(mpqPath, 'TextureEditorModal.preview.mpqPath')
                    if (isStale()) return

                    const mpqBuffer = toArrayBuffer(mpqData)
                    if (mpqBuffer && mpqBuffer.byteLength > 0) {
                        const imageData = decodeTextureData(mpqBuffer, imagePath)
                        if (imageData) {
                            setBasePreviewImageData(imageData)
                            setPreviewUrl(null)
                            setPreviewSource('MPQ')
                            writePreviewCache(cacheKey, { basePreviewImageData: imageData, previewUrl: null, previewSource: 'MPQ', previewError: null })
                            loaded = true
                        }
                    }
                } catch {
                }
                if (!loaded && (isReplaceable || !isSupported)) {
                    if (texture.ReplaceableId === 1) {
                        setPreviewUrl(makeSolidDataUrl(220, 60, 60))
                        setPreviewError(null)
                        setPreviewSource('Replaceable')
                    } else if (texture.ReplaceableId === 2) {
                        setPreviewUrl(makeSolidDataUrl(255, 210, 0))
                        setPreviewError(null)
                        setPreviewSource('Replaceable')
                    } else {
                        setPreviewError('无法加载贴图：MPQ 未找到')
                    }
                    setIsLoadingPreview(false)
                    return
                }
            }

            if (!loaded && isSupported && !isReplaceable) {
                try {
                    const candidates = getLocalCandidates(imagePath)
                    let lastError: string | null = null

                    for (const candidate of candidates) {
                        try {
                            const buffer = await readFile(candidate)
                            if (isStale()) return
                            if (buffer) {
                                const imageData = decodeTextureData(buffer.buffer, imagePath)
                                if (imageData) {
                                    setBasePreviewImageData(imageData)
                                    setPreviewUrl(null)
                                    setPreviewSource('\u6587\u4ef6')
                                    writePreviewCache(cacheKey, { basePreviewImageData: imageData, previewUrl: null, previewSource: '\u6587\u4ef6', previewError: null })
                                    loaded = true
                                    break
                                } else {
                                    lastError = '\u65e0\u6cd5\u52a0\u8f7d\u8d34\u56fe\uff1aBLP \u89e3\u7801\u5931\u8d25'
                                }
                            } else {
                                lastError = '\u65e0\u6cd5\u52a0\u8f7d\u8d34\u56fe\uff1a\u8bfb\u53d6\u5931\u8d25'
                            }
                        } catch (e: any) {
                            if (!loaded) {
                                lastError = `无法加载贴图：${e.message || '读取失败'}`
                            }
                        }
                    }

                    if (!loaded && lastError) {
                        setPreviewError(lastError)
                    }
                } catch (e: any) {
                    if (!loaded) {
                        setPreviewError(`无法加载贴图：${e.message || '读取失败'}`)
                    }
                }
            }

            if (!loaded && isSupported && !isReplaceable) {
                try {
                    const mpqData = await invokeReadMpqFile<Uint8Array>(normalizedImagePath, 'TextureEditorModal.preview.fallbackMpq')
                    if (isStale()) return

                    const mpqBuffer = toArrayBuffer(mpqData)
                    if (mpqBuffer && mpqBuffer.byteLength > 0) {
                        const imageData = decodeTextureData(mpqBuffer, imagePath)
                        if (imageData) {
                            setBasePreviewImageData(imageData)
                            setPreviewUrl(null)
                            setPreviewSource('MPQ')
                            writePreviewCache(cacheKey, { basePreviewImageData: imageData, previewUrl: null, previewSource: 'MPQ', previewError: null })
                            loaded = true
                        }
                    }
                } catch {
                    if (!loaded) {
                        setPreviewError('无法加载贴图：读取失败')
                    }
                }
            }

            if (!loaded && !isSupported) {
                const candidates = getLocalCandidates(imagePath)
                let fullPath = candidates[0] || imagePath

                for (const candidate of candidates) {
                    try {
                        await readFile(candidate)
                        fullPath = candidate
                        break
                    } catch {
                    }
                }
                const filePreviewUrl = `file://${fullPath}`
                setBasePreviewImageData(null)
                setPreviewUrl(filePreviewUrl)
                setPreviewSource('文件')
                writePreviewCache(cacheKey, { basePreviewImageData: null, previewUrl: filePreviewUrl, previewSource: '文件', previewError: null })
            }

            if (isStale()) return
            setIsLoadingPreview(false)
        }
        loadTexture()
    }, [selectedIndex, selectedTexture?.__editorId, selectedTexture?.Image, selectedTexture?.ReplaceableId, selectedTexture?.Flags, modelPath])

    const selectedImageLower = (selectedTexture?.Image || '').toLowerCase()
    const isSelectedTextureBlpOrTga = selectedImageLower.endsWith('.blp') || selectedImageLower.endsWith('.tga')
    const canAdjustSelectedTexture = isSelectedTextureBlpOrTga && !!basePreviewImageData && !isLoadingPreview

    useEffect(() => {
        if (!isStandalone || !selectedTexture?.Image || !modelPath) {
            return
        }

        emit('IPC_LIVE_TEXTURE_PREPARE', {
            modelPath,
            imagePath: selectedTexture.Image,
        })
    }, [isStandalone, modelPath, selectedTexture?.Image, selectedTextureId])

    useEffect(() => {
        clearRendererAdjustmentFlush()
    }, [selectedTextureId, basePreviewImageData])

    useEffect(() => {
        const cacheKey = selectedPreviewCacheKeyRef.current
        const worker = previewAdjustWorkerRef.current

        if (!basePreviewImageData || !cacheKey) {
            latestAdjustedPreviewImageDataRef.current = null
            latestAdjustedPreviewAdjustmentsRef.current = DEFAULT_TEXTURE_ADJUSTMENTS
            latestAdjustedPreviewKeyRef.current = null
            previewAdjustSourceKeyRef.current = null
            previewAdjustInFlightRef.current = false
            if (worker) {
                worker.postMessage({ type: 'clear' })
            }
            return
        }

        latestAdjustedPreviewImageDataRef.current = basePreviewImageData
        latestAdjustedPreviewAdjustmentsRef.current = DEFAULT_TEXTURE_ADJUSTMENTS
        latestAdjustedPreviewKeyRef.current = cacheKey
        previewAdjustSourceKeyRef.current = cacheKey
        previewAdjustInFlightRef.current = false

        if (worker) {
            const sourcePixels = new Uint8ClampedArray(basePreviewImageData.data)
            worker.postMessage({
                type: 'set-source',
                key: cacheKey,
                width: basePreviewImageData.width,
                height: basePreviewImageData.height,
                buffer: sourcePixels.buffer,
            }, [sourcePixels.buffer])
        }

        dispatchPreviewAdjustments(selectedAdjustments)
    }, [basePreviewImageData, selectedTextureId])

    useEffect(() => {
        const cacheKey = selectedPreviewCacheKeyRef.current
        if (!basePreviewImageData || !cacheKey) {
            return
        }

        dispatchPreviewAdjustments(selectedAdjustments)
    }, [basePreviewImageData, selectedAdjustments, selectedTextureId])

    const updateLocalTexture = (index: number, updates: any) => {
        const newTextures = [...localTextures]
        newTextures[index] = { ...newTextures[index], ...updates }
        setLocalTextures(newTextures)

        const shouldInvalidatePreview =
            index === selectedIndex &&
            (Object.prototype.hasOwnProperty.call(updates, 'Image') ||
                Object.prototype.hasOwnProperty.call(updates, 'ReplaceableId'))

        if (shouldInvalidatePreview) {
            previewCacheRef.current.clear()
            selectedPreviewCacheKeyRef.current = null
            previewAdjustSourceKeyRef.current = null
            latestAdjustedPreviewImageDataRef.current = null
            latestAdjustedPreviewKeyRef.current = null
            pendingRendererSyncRef.current = null
            setBasePreviewImageData(null)
            setPreviewUrl(null)
            setPreviewError(null)
            setPreviewSource(null)
        }

        syncStandaloneTextures(newTextures)
    }

    const handleFlagChange = (flag: number, checked: boolean) => {
        if (selectedIndex < 0) return
        let newFlags = localTextures[selectedIndex].Flags || 0
        if (checked) newFlags |= flag
        else newFlags &= ~flag
        updateLocalTexture(selectedIndex, { Flags: newFlags })
    }

    const isFlagSet = (flag: number) => {
        if (selectedIndex < 0) return false
        return ((localTextures[selectedIndex].Flags || 0) & flag) !== 0
    }

    const pathInputDropRef = useRef<HTMLDivElement | null>(null)
    const previewDropRef = useRef<HTMLDivElement | null>(null)
    const detailDropSurfaceRef = useRef<HTMLDivElement | null>(null)
    const selectedIndexRef = useRef(-1)
    const modelPathRef = useRef<string | undefined>(modelPath ?? undefined)

    const normalizeTexturePathKey = (path: string): string => path.replace(/\//g, '\\').toLowerCase()

    const isAbsoluteWindowsPath = (path: string): boolean => /^[a-zA-Z]:\\/.test(path) || path.startsWith('\\\\')

    const getModelDirectory = (currentModelPath?: string): string | null => {
        if (!currentModelPath) return null
        const normalizedModelPath = currentModelPath.replace(/\//g, '\\')
        const modelDir = normalizedModelPath.split('\\').slice(0, -1).join('\\')
        return modelDir || null
    }

    const getFileName = (path: string): string => path.replace(/\//g, '\\').split('\\').pop() || path

    const splitFileName = (fileName: string): { stem: string; ext: string } => {
        const dot = fileName.lastIndexOf('.')
        if (dot <= 0) return { stem: fileName, ext: '' }
        return { stem: fileName.slice(0, dot), ext: fileName.slice(dot) }
    }

    const areBinaryContentsEqual = (left: Uint8Array, right: Uint8Array): boolean => {
        if (left.length !== right.length) return false
        for (let index = 0; index < left.length; index++) {
            if (left[index] !== right[index]) return false
        }
        return true
    }

    const ensureTextureInModelDir = async (rawPath: string, currentModelPath?: string): Promise<{ relativePath: string; copied: boolean } | null> => {
        const modelDir = getModelDirectory(currentModelPath)
        if (!modelDir) {
            message.warning('当前模型路径无效，无法导入外部贴图')
            return null
        }

        const sourcePath = rawPath.replace(/\//g, '\\')
        if (!isAbsoluteWindowsPath(sourcePath)) {
            return null
        }

        const sourceLower = sourcePath.toLowerCase()
        const modelDirLower = modelDir.toLowerCase()
        const modelDirPrefix = `${modelDirLower}\\`
        if (sourceLower.startsWith(modelDirPrefix)) {
            return {
                relativePath: sourcePath.slice(modelDir.length + 1),
                copied: false
            }
        }

        const originalFileName = getFileName(sourcePath)
        let targetFileName = originalFileName
        let targetAbsPath = `${modelDir}\\${targetFileName}`
        const sourceSize = await size(sourcePath).catch(() => null)
        let sourceBytesCache: Uint8Array | null | undefined

        const readSourceBytes = async (): Promise<Uint8Array | null> => {
            if (sourceBytesCache !== undefined) return sourceBytesCache
            sourceBytesCache = await readFile(sourcePath).catch(() => null)
            return sourceBytesCache
        }

        const isSameFileContent = async (candidateAbsPath: string, candidateSize: number | null): Promise<boolean> => {
            if (sourceSize === null || candidateSize === null || sourceSize !== candidateSize) {
                return false
            }
            if (normalizeTexturePathKey(candidateAbsPath) === normalizeTexturePathKey(sourcePath)) {
                return true
            }
            const [sourceBytes, candidateBytes] = await Promise.all([
                readSourceBytes(),
                readFile(candidateAbsPath).catch(() => null)
            ])
            if (!sourceBytes || !candidateBytes) {
                return false
            }
            return areBinaryContentsEqual(sourceBytes, candidateBytes)
        }

        if (await exists(targetAbsPath)) {
            const targetSize = await size(targetAbsPath).catch(() => null)
            if (await isSameFileContent(targetAbsPath, targetSize)) {
                return {
                    relativePath: targetFileName,
                    copied: false
                }
            }

            const { stem, ext } = splitFileName(originalFileName)
            let index = 1
            while (await exists(`${modelDir}\\${stem}_${index}${ext}`)) {
                const candidateFileName = `${stem}_${index}${ext}`
                const candidateAbsPath = `${modelDir}\\${candidateFileName}`
                const candidateSize = await size(candidateAbsPath).catch(() => null)
                if (await isSameFileContent(candidateAbsPath, candidateSize)) {
                    return {
                        relativePath: candidateFileName,
                        copied: false
                    }
                }
                index++
            }
            targetFileName = `${stem}_${index}${ext}`
            targetAbsPath = `${modelDir}\\${targetFileName}`
        }

        const bytes = await readFile(sourcePath)
        await writeFile(targetAbsPath, bytes)
        return {
            relativePath: targetFileName,
            copied: true
        }
    }

    useEffect(() => {
        selectedIndexRef.current = selectedIndex
        modelPathRef.current = modelPath ?? undefined
    }, [selectedIndex, modelPath])

    const isPointInsideElement = (x: number, y: number, element: HTMLElement | null): boolean => {
        if (!element) return false
        const rect = element.getBoundingClientRect()
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    const applyDroppedTexture = async (filePath: string) => {
        const currentSelectedIndex = selectedIndexRef.current
        if (currentSelectedIndex < 0) return

        const imported = await ensureTextureInModelDir(filePath, modelPathRef.current ?? undefined)
        if (!imported) return

        const currentLocalTextures = localTexturesRef.current
        const currentAdjustmentsByTextureId = adjustmentsByTextureIdRef.current

        const nextLocalTextures = currentLocalTextures.map((texture, index) => index === currentSelectedIndex
            ? { ...texture, Image: imported.relativePath, ReplaceableId: 0 }
            : texture)

        setLocalTextures(nextLocalTextures)
        setPathInputValue(imported.relativePath)
        previewCacheRef.current.clear()
        setBasePreviewImageData(null)
        setPreviewUrl(null)
        setPreviewError(null)
        setPreviewSource(null)
        latestAdjustedPreviewImageDataRef.current = null
        latestAdjustedPreviewKeyRef.current = null
        selectedPreviewCacheKeyRef.current = null

        const texturesForSave = nextLocalTextures.map((texture) => {
            const { __editorId, ...rest } = texture
            const raw = adjustmentsByTextureIdRef.current[__editorId]
            if (raw) {
                const normalized = normalizeTextureAdjustments(raw)
                if (!isDefaultTextureAdjustments(normalized)) {
                    return {
                        ...rest,
                        [TEXTURE_ADJUSTMENTS_KEY]: normalized
                    }
                }
            }
            if (Object.prototype.hasOwnProperty.call(rest, TEXTURE_ADJUSTMENTS_KEY)) {
                const cleaned = { ...rest }
                delete cleaned[TEXTURE_ADJUSTMENTS_KEY]
                return cleaned
            }
            return rest
        })

        if (isStandalone) {
            emitCommand('EXECUTE_TEXTURE_ACTION', { action: 'SAVE_TEXTURES', payload: texturesForSave })
        } else if (isDetachedWindow) {
            void Promise.resolve(onApply?.(texturesForSave)).catch((error) => {
                console.error('[TextureEditor] Failed to apply dropped detached texture:', error)
            })
        } else {
            localStore.setTextures(texturesForSave)
        }

        message.success(imported.copied ? `已复制并替换贴图: ${imported.relativePath}` : `已替换贴图: ${imported.relativePath}`)
    }

    const importTexturesFromFiles = async (paths: string[]) => {
        if (paths.length === 0) return

        const currentLocalTextures = localTexturesRef.current
        const existingPaths = new Set(
            currentLocalTextures.map((texture) => normalizeTexturePathKey(texture.Image || ''))
        )

        const newTextures: LocalTexture[] = []
        let addedCount = 0
        let skippedCount = 0
        let copiedCount = 0

        for (const filePath of paths) {
            const imported = await ensureTextureInModelDir(filePath, modelPathRef.current ?? undefined)
            if (!imported) {
                continue
            }

            const normalizedRelativePath = normalizeTexturePathKey(imported.relativePath)
            if (existingPaths.has(normalizedRelativePath)) {
                skippedCount++
                continue
            }

            existingPaths.add(normalizedRelativePath)
            newTextures.push(ensureLocalTexture({ Image: imported.relativePath, ReplaceableId: 0, Flags: 0 }))
            addedCount++
            if (imported.copied) {
                copiedCount++
            }
        }

        if (newTextures.length === 0) {
            if (skippedCount > 0) {
                message.warning(`所有选择的纹理都已存在，跳过 ${skippedCount} 个重复`)
            }
            return
        }

        const updatedTextures = [...currentLocalTextures, ...newTextures]
        commitTextureCollection(updatedTextures)
        const nextSelectedIndex = updatedTextures.length - 1
        setSelectedIndex(nextSelectedIndex)
        setTimeout(() => scrollToItem(nextSelectedIndex), 0)

        if (addedCount === 1 && skippedCount === 0) {
            message.success(copiedCount > 0
                ? `已复制并添加纹理: ${newTextures[0].Image}`
                : `已添加纹理: ${newTextures[0].Image}`)
            return
        }

        if (copiedCount > 0) {
            message.success(`已添加 ${addedCount} 个纹理，其中 ${copiedCount} 个已复制到模型目录${skippedCount > 0 ? `，跳过 ${skippedCount} 个重复` : ''}`)
            return
        }

        if (skippedCount > 0) {
            message.success(`已添加 ${addedCount} 个纹理，跳过 ${skippedCount} 个重复`)
            return
        }

        message.success(`已批量添加 ${addedCount} 个纹理`)
    }

    useEffect(() => {
        if (!isStandalone || !visible) return

        let disposed = false
        let unlistenDrop: (() => void) | undefined
        let unlistenDragEnter: (() => void) | undefined
        let unlistenDragLeave: (() => void) | undefined

        const setupDragDrop = async () => {
            const currentWindowLabel = getCurrentWindow().label
            const isHitTarget = (position?: { x: number; y: number } | null) => {
                const dropTargets = [detailDropSurfaceRef.current, pathInputDropRef.current, previewDropRef.current].filter(Boolean) as HTMLDivElement[]
                if (dropTargets.length === 0) return false
                if (!position) return true
                return dropTargets.some((target) => isPointInsideElement(position.x, position.y, target))
            }

            unlistenDragEnter = await listen<{ paths?: string[]; position?: { x: number; y: number } }>('tauri://drag-enter', (event) => {
                if (disposed) return
                const sourceWindowLabel = (event as any)?.windowLabel
                if (sourceWindowLabel && sourceWindowLabel !== currentWindowLabel) return
                const hasTexture = (event.payload?.paths || []).some((path) => /\.(blp|tga)$/i.test(path))
                if (!hasTexture) return
                if (!isHitTarget(event.payload?.position)) return
                setIsExternalTextureDropActive(true)
            })

            unlistenDragLeave = await listen('tauri://drag-leave', () => {
                if (disposed) return
                setIsExternalTextureDropActive(false)
            })

            unlistenDrop = await listen<{ paths?: string[]; position?: { x: number; y: number } }>('tauri://drag-drop', (event) => {
                if (disposed) return
                const sourceWindowLabel = (event as any)?.windowLabel
                if (sourceWindowLabel && sourceWindowLabel !== currentWindowLabel) return

                const filePath = (event.payload?.paths || []).find((path) => /\.(blp|tga)$/i.test(path))
                if (!filePath) return

                if (!isHitTarget(event.payload?.position)) return
                setIsExternalTextureDropActive(false)
                void applyDroppedTexture(filePath)
            })
        }

        setupDragDrop().catch((error) => {
            console.error('[TextureEditor] Failed to setup standalone drag-drop:', error)
        })

        return () => {
            disposed = true
            unlistenDrop?.()
            unlistenDragEnter?.()
            unlistenDragLeave?.()
            setIsExternalTextureDropActive(false)
        }
    }, [isStandalone, visible])
    const Wrapper = isStandalone ? 'div' : DraggableModal as any;
    const wrapperProps = isStandalone
        ? { style: { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#252525', overflow: 'hidden' } }
        : {
            title: "纹理管理器",
            open: visible,
            onOk: handleOk,
            onCancel: handleCancel,
            width: 920,
            okText: "确定",
            cancelText: "取消",
            maskClosable: false,
            wrapClassName: "dark-theme-modal",
            styles: {
                content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                body: { backgroundColor: '#2d2d2d', padding: 0 },
                footer: { borderTop: '1px solid #4a4a4a' }
            }
        };

    if (isStandalone || isDetachedWindow) {
        return (
            <StandaloneWindowFrame title="贴图管理器" onClose={() => getCurrentWindow().hide()}>
                <div style={{ display: 'flex', flex: 1, backgroundColor: '#252525', width: '100%', overflow: 'hidden' }}>
                    {/* List (Left) */}
                    <div ref={listRef} style={{ width: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                        <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a' }}>
                            <Dropdown
                                menu={{
                                    items: [
                                        {
                                            key: 'file',
                                            label: '从文件导入',
                                            icon: <FolderOpenOutlined />,
                                            onClick: async () => {
                                                try {
                                                    const selected = await open({
                                                        multiple: true,
                                                        filters: [{
                                                            name: '纹理文件',
                                                            extensions: ['blp', 'png', 'tga', 'jpg', 'jpeg']
                                                        }]
                                                    })

                                                    // Handle both single and multiple selection
                                                    const paths = Array.isArray(selected) ? selected : (selected ? [selected] : [])

                                                    if (paths.length === 0) return
                                                    await importTexturesFromFiles(paths)
                                                } catch (e) {
                                                    console.error('Failed to open file dialog:', e)
                                                }
                                            }
                                        },
                                        {
                                            key: 'mpq',
                                            label: '从 MPQ 选择',
                                            icon: <DatabaseOutlined />,
                                            disabled: true,  // 暂时禁用
                                            onClick: () => {
                                                message.info('MPQ 纹理选择功能即将推出')
                                            }
                                        },
                                        { type: 'divider' },
                                        {
                                            key: 'blank',
                                            label: '新建空白纹理',
                                            icon: <PlusOutlined />,
                                            onClick: () => {
                                                const newTexture = ensureLocalTexture({ Image: 'Textures\\white.blp', ReplaceableId: 0, Flags: 0 })
                                                const updatedTextures = [...localTexturesRef.current, newTexture]
                                                commitTextureCollection(updatedTextures)
                                                const nextSelectedIndex = updatedTextures.length - 1
                                                setSelectedIndex(nextSelectedIndex)
                                                setTimeout(() => scrollToItem(nextSelectedIndex), 0)
                                            }
                                        }
                                    ] as MenuProps['items']
                                }}
                                trigger={['click']}
                            >
                                <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    block
                                    style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff' }}
                                >
                                    添加 ▼
                                </Button>
                            </Dropdown>
                        </div>
                        <List
                            dataSource={localTextures}
                            renderItem={(item, index) => (
                                <List.Item
                                    onClick={() => setSelectedIndex(index)}
                                    draggable
                                    onDragStart={(e) => {
                                        setDraggedTextureIndex(e.dataTransfer, index)
                                    }}
                                    style={{
                                        cursor: 'pointer',
                                        padding: '10px 12px',
                                        backgroundColor: selectedIndex === index ? '#1677ff' : 'transparent',
                                        borderBottom: '1px solid #4a4a4a'
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', color: selectedIndex === index ? '#ffffff' : '#e8e8e8' }}>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                                            <span style={{ marginRight: '8px', opacity: 0.7, color: 'inherit' }}>{index}:</span>
                                            <span style={{ color: 'inherit' }}>{(item.Image ? item.Image.split(/[\\/]/).pop() : null) || getReplaceableLabel(item.ReplaceableId) || '无法加载贴图'}</span>
                                        </div>
                                        <DeleteOutlined
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                const removedId = localTextures[index]?.__editorId
                                                const newTextures = localTextures.filter((_, i) => i !== index)
                                                const { texturesForSave, materialsForSave } = buildTextureDeletionResult(index, newTextures)
                                                setLocalTextures(newTextures)
                                                if (removedId) {
                                                    setAdjustmentsByTextureId((prev) => {
                                                        const next = { ...prev }
                                                        delete next[removedId]
                                                        return next
                                                    })
                                                }
                                                if (isStandalone) {
                                                    emitCommand('EXECUTE_TEXTURE_ACTION', {
                                                        action: 'SAVE_TEXTURES_WITH_MATERIALS',
                                                        payload: {
                                                            textures: texturesForSave,
                                                            materials: materialsForSave
                                                        }
                                                    })
                                                } else if (isDetachedWindow) {
                                                    void Promise.resolve(onApply?.(texturesForSave)).catch((error) => {
                                                        console.error('[TextureEditor] Failed to apply detached texture deletion:', error)
                                                    })
                                                } else {
                                                    localStore.setVisualDataPatch({
                                                        Textures: texturesForSave,
                                                        Materials: materialsForSave
                                                    })
                                                }
                                                if (selectedIndex === index) setSelectedIndex(-1)
                                                else if (selectedIndex > index) setSelectedIndex(selectedIndex - 1)
                                            }}
                                            style={{ color: selectedIndex === index ? '#ffffff' : '#ff4d4f' }}
                                        />
                                    </div>
                                </List.Item>
                            )}
                        />
                    </div>

                    {/* Details (Right) */}
                    <div style={{ flex: 1, padding: '16px', overflow: 'hidden', backgroundColor: '#252525', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {selectedTexture ? (
                            <>
                                {/* Top Section: Settings (Left) & Preview (Right) */}
                                <div ref={detailDropSurfaceRef} style={{ flex: 1, display: 'flex', gap: '16px', minHeight: 0, border: isExternalTextureDropActive ? '1px dashed #5a9cff' : '1px dashed transparent', borderRadius: 8, boxShadow: isExternalTextureDropActive ? '0 0 0 1px rgba(90,156,255,0.22) inset' : 'none', background: isExternalTextureDropActive ? 'rgba(90,156,255,0.06)' : 'transparent', transition: 'border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease' }}>
                                    {/* Left Settings (Inputs, Checkboxes & Adjustments) */}
                                    <div style={{ width: '272px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative' }}>
                                        <div ref={pathInputDropRef} style={{ flexShrink: 0 }}>
                                            {isExternalTextureDropActive ? (
                                                <div style={{ marginBottom: '8px', padding: '8px 10px', borderRadius: '6px', border: '1px dashed #5a9cff', background: 'rgba(90,156,255,0.10)', color: '#9fc1ff', fontSize: '12px' }}>将 .blp 或 .tga 贴图拖到右侧即可复制到模型目录并替换当前贴图</div>
                                            ) : null}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                                                <Typography.Text style={{ color: '#b0b0b0' }}>路径:</Typography.Text>
                                            </div>
                                            <Input
                                                value={pathInputValue}
                                                onChange={(e) => setPathInputValue(e.target.value)}
                                                onFocus={() => {
                                                    pathInputEditingRef.current = true
                                                }}
                                                onBlur={() => {
                                                    commitPathInput()
                                                    pathInputEditingRef.current = false
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        (e.target as HTMLInputElement).blur()
                                                    }
                                                }}
                                                style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                            />
                                            {isStandalone && (
                                                <Typography.Text style={{ display: 'block', marginTop: '4px', fontSize: '10px', color: '#808080' }}>
                                                    可拖放 .blp / .tga 文件替换当前贴图
                                                </Typography.Text>
                                            )}
                                        </div>
                                        <div style={{ flexShrink: 0 }}>
                                            <Typography.Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>可替换 ID:</Typography.Text>
                                            <InputNumber
                                                value={selectedTexture.ReplaceableId}
                                                onChange={(v) => updateLocalTexture(selectedIndex, { ReplaceableId: v })}
                                                style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                            />
                                            <Typography.Text style={{ fontSize: '10px', color: '#808080' }}>0:无 1:队色 2:光晕 31+:树</Typography.Text>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px', flexShrink: 0 }}>
                                            <Checkbox checked={isFlagSet(1)} onChange={(e) => handleFlagChange(1, e.target.checked)} style={{ color: '#e8e8e8' }}>
                                                笼罩宽度 (Wrap Width)
                                            </Checkbox>
                                            <Checkbox checked={isFlagSet(2)} onChange={(e) => handleFlagChange(2, e.target.checked)} style={{ color: '#e8e8e8' }}>
                                                笼罩高度 (Wrap Height)
                                            </Checkbox>
                                        </div>

                                        {/* Bottom Section: Adjustments (Moved to left column) */}
                                        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                                <Typography.Text style={{ color: '#b0b0b0', fontSize: 12, display: 'block' }}>贴图调整（保存后生效）</Typography.Text>
                                                <Checkbox 
                                                    checked={selectedAdjustments.colorize} 
                                                    onChange={(e) => {
                                                        handleAdjustmentSliderChange('colorize', e.target.checked);
                                                        handleAdjustmentSliderComplete();
                                                    }}
                                                    disabled={!canAdjustSelectedTexture}
                                                    style={{ fontSize: 12, color: '#b0b0b0' }}
                                                >
                                                    着色
                                                </Checkbox>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <Typography.Text style={{ color: '#999', fontSize: 12, width: 44, flexShrink: 0 }}>色相</Typography.Text>
                                                <div style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid #666', backgroundColor: huePreviewColor, flexShrink: 0 }} />
                                                <Typography.Text style={{ color: '#999', fontSize: 12, width: 36, flexShrink: 0 }}>{toDegree(selectedAdjustments.hue)}</Typography.Text>
                                                <div style={{ flex: 1, width: '140px', maxWidth: '140px' }}>
                                                    <div style={{ height: 4, borderRadius: 2, marginBottom: 2, background: 'linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)' }} />
                                                    <Slider
                                                        min={-180} max={180} step={1}
                                                        value={selectedAdjustments.hue}
                                                        onChange={(value) => handleAdjustmentSliderChange('hue', Number(value))}
                                                        onChangeComplete={handleAdjustmentSliderComplete}
                                                        disabled={!canAdjustSelectedTexture}
                                                        tooltip={{ open: false }}
                                                        style={{ margin: 0 }}
                                                    />
                                                </div>
                                                <Button size="small" icon={<ReloadOutlined />} onClick={() => resetAdjustmentField('hue')} disabled={!canAdjustSelectedTexture} style={{ width: 24, minWidth: 24, paddingInline: 0 }} />
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <Typography.Text style={{ color: '#999', fontSize: 12, width: 44, flexShrink: 0 }}>明暗度</Typography.Text>
                                                <div style={{ width: 16, height: 16, visibility: 'hidden', flexShrink: 0 }} />
                                                <Typography.Text style={{ color: '#999', fontSize: 12, width: 36, flexShrink: 0 }}>{toPercent(selectedAdjustments.brightness)}</Typography.Text>
                                                <div style={{ flex: 1, width: '140px', maxWidth: '140px' }}>
                                                    <Slider
                                                        min={0} max={200} step={1}
                                                        value={selectedAdjustments.brightness}
                                                        onChange={(value) => handleAdjustmentSliderChange('brightness', Number(value))}
                                                        onChangeComplete={handleAdjustmentSliderComplete}
                                                        disabled={!canAdjustSelectedTexture}
                                                        tooltip={{ open: false }}
                                                        style={{ margin: 0 }}
                                                    />
                                                </div>
                                                <Button size="small" icon={<ReloadOutlined />} onClick={() => resetAdjustmentField('brightness')} disabled={!canAdjustSelectedTexture} style={{ width: 24, minWidth: 24, paddingInline: 0 }} />
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <Typography.Text style={{ color: '#999', fontSize: 12, width: 44, flexShrink: 0 }}>饱和度</Typography.Text>
                                                <div style={{ width: 16, height: 16, visibility: 'hidden', flexShrink: 0 }} />
                                                <Typography.Text style={{ color: '#999', fontSize: 12, width: 36, flexShrink: 0 }}>{toPercent(selectedAdjustments.saturation)}</Typography.Text>
                                                <div style={{ flex: 1, width: '140px', maxWidth: '140px' }}>
                                                    <Slider
                                                        min={0} max={200} step={1}
                                                        value={selectedAdjustments.saturation}
                                                        onChange={(value) => handleAdjustmentSliderChange('saturation', Number(value))}
                                                        onChangeComplete={handleAdjustmentSliderComplete}
                                                        disabled={!canAdjustSelectedTexture}
                                                        tooltip={{ open: false }}
                                                        style={{ margin: 0 }}
                                                    />
                                                </div>
                                                <Button size="small" icon={<ReloadOutlined />} onClick={() => resetAdjustmentField('saturation')} disabled={!canAdjustSelectedTexture} style={{ width: 24, minWidth: 24, paddingInline: 0 }} />
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <Typography.Text style={{ color: '#999', fontSize: 12, width: 44, flexShrink: 0 }}>透明度</Typography.Text>
                                                <div style={{ width: 16, height: 16, visibility: 'hidden', flexShrink: 0 }} />
                                                <Typography.Text style={{ color: '#999', fontSize: 12, width: 36, flexShrink: 0 }}>{toPercent(selectedAdjustments.opacity)}</Typography.Text>
                                                <div style={{ flex: 1, width: '140px', maxWidth: '140px' }}>
                                                    <Slider
                                                        min={0} max={200} step={1}
                                                        value={selectedAdjustments.opacity}
                                                        onChange={(value) => handleAdjustmentSliderChange('opacity', Number(value))}
                                                        onChangeComplete={handleAdjustmentSliderComplete}
                                                        disabled={!canAdjustSelectedTexture}
                                                        tooltip={{ open: false }}
                                                        style={{ margin: 0 }}
                                                    />
                                                </div>
                                                <Button size="small" icon={<ReloadOutlined />} onClick={() => resetAdjustmentField('opacity')} disabled={!canAdjustSelectedTexture} style={{ width: 24, minWidth: 24, paddingInline: 0 }} />
                                            </div>
                                        </div>

                                        {!isSelectedTextureBlpOrTga && (
                                            <Typography.Text style={{ color: '#808080', fontSize: 12, marginTop: 4, display: 'block' }}>
                                                仅 blp/tga 贴图支持调整
                                            </Typography.Text>
                                        )}
                                    </div>

                                    {/* Right Preview (Square, fixed size) */}
                                    <div style={{ width: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <div ref={previewDropRef} style={{ width: '100%', height: '380px', border: '1px solid #4a4a4a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f1f1f', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                                            {isLoadingPreview ? (
                                                <div style={{ color: '#5a9cff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                                    <div className="ant-spin ant-spin-spinning" style={{ fontSize: 24 }}>?</div>
                                                    <span>加载中...</span>
                                                </div>
                                            ) : basePreviewImageData ? (
                                                <>
                                                    <canvas ref={previewCanvasRef} style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }} />
                                                    {previewSource && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            bottom: 4,
                                                            right: 4,
                                                            backgroundColor: previewSource === 'MPQ' ? '#52c41a' : '#1677ff',
                                                            color: '#fff',
                                                            padding: '2px 6px',
                                                            borderRadius: 3,
                                                            fontSize: 10,
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {previewSource}
                                                        </div>
                                                    )}
                                                </>
                                            ) : previewUrl ? (
                                                <>
                                                    <img src={previewUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                                    {previewSource && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            bottom: 4,
                                                            right: 4,
                                                            backgroundColor: previewSource === 'MPQ' ? '#52c41a' : '#1677ff',
                                                            color: '#fff',
                                                            padding: '2px 6px',
                                                            borderRadius: 3,
                                                            fontSize: 10,
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {previewSource}
                                                        </div>
                                                    )}
                                                </>
                                            ) : previewError ? (
                                                <div style={{ color: '#ff4d4f', textAlign: 'center', padding: 8 }}>
                                                    <div>?? {previewError}</div>
                                                    <div style={{ fontSize: 11, color: '#888', marginTop: 4, wordBreak: 'break-all' }}>{selectedTexture?.Image}</div>
                                                </div>
                                            ) : (
                                                <span style={{ color: '#666' }}>无预览</span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Button
                                                    size="small"
                                                    type={!isSaveAsMode ? 'primary' : 'default'}
                                                    onClick={() => handleTextureSaveModeChange('overwrite')}
                                                    style={{ width: 72, flexShrink: 0, ...(!isSaveAsMode ? { backgroundColor: '#5a9cff', borderColor: '#5a9cff' } : { backgroundColor: '#2b2b2b', borderColor: '#3a3a3a', color: '#8c8c8c' }) }}
                                                >
                                                    覆盖
                                                </Button>
                                                <Button
                                                    size="small"
                                                    type={isSaveAsMode ? 'primary' : 'default'}
                                                    onClick={() => handleTextureSaveModeChange('save_as')}
                                                    style={{ width: 72, flexShrink: 0, ...(isSaveAsMode ? { backgroundColor: '#5a9cff', borderColor: '#5a9cff' } : { backgroundColor: '#2b2b2b', borderColor: '#3a3a3a', color: '#8c8c8c' }) }}
                                                >
                                                    另存为
                                                </Button>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4, opacity: isSaveAsMode ? 1 : 0.45 }}>
                                                <Typography.Text style={{ color: '#b0b0b0', fontSize: 12 }}>另存后缀</Typography.Text>
                                                <Input
                                                    value={textureSaveSuffix}
                                                    onChange={(e) => handleTextureSaveSuffixChange(e.target.value)}
                                                    placeholder="_1"
                                                    disabled={!isSaveAsMode}
                                                    style={{ width: 120, backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                                请从左侧列表选择一个纹理
                            </div>
                        )}
                    </div>
                </div>
            </StandaloneWindowFrame >
        )
    }

    return (
        <DraggableModal
            title="纹理管理器"
            open={visible}
            onOk={handleOk}
            onCancel={handleCancel}
            width={920}
            okText="确定"
            cancelText="取消"
            maskClosable={false}
            wrapClassName="dark-theme-modal"
        >
            <div style={{ padding: 16, minHeight: 160, color: '#d9d9d9', backgroundColor: '#2d2d2d' }}>
                嵌入式纹理管理器尚未完成迁移。当前主要维护独立窗口编辑路径。
            </div>
        </DraggableModal>
    )

}

export default TextureEditorModal

