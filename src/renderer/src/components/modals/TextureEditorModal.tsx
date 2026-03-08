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
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { decodeTextureData, getTextureCandidatePaths, isMPQPath, normalizePath } from '../viewer/textureLoader'
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

const { Text } = Typography

interface TextureEditorModalProps {
    visible: boolean
    onClose: () => void
    modelPath?: string
    isStandalone?: boolean
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

const TextureEditorModal: React.FC<TextureEditorModalProps> = ({ visible, onClose, modelPath: propModelPath, isStandalone }) => {
    // 1. Local Store & RPC Fallback Setups
    const localStore = useModelStore()

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
    const modelPath = propModelPath || (isStandalone ? rpcSnapshot.modelPath : localStore.modelPath)

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
    const previewAdjustRafRef = useRef<number | null>(null)
    const rendererAdjustmentFlushTimeoutRef = useRef<number | null>(null)
    const latestSelectedTextureRef = useRef<LocalTexture | null>(null)
    const latestSelectedAdjustmentsRef = useRef<TextureAdjustments>(DEFAULT_TEXTURE_ADJUSTMENTS)
    const latestBasePreviewImageDataRef = useRef<ImageData | null>(null)

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

    useEffect(() => {
        latestSelectedTextureRef.current = selectedTexture
    }, [selectedTexture])

    useEffect(() => {
        latestSelectedAdjustmentsRef.current = selectedAdjustments
    }, [selectedAdjustments])

    useEffect(() => {
        latestBasePreviewImageDataRef.current = basePreviewImageData
    }, [basePreviewImageData])

    useEffect(() => {
        return () => {
            if (previewAdjustRafRef.current !== null) {
                cancelAnimationFrame(previewAdjustRafRef.current)
            }
            if (rendererAdjustmentFlushTimeoutRef.current !== null) {
                window.clearTimeout(rendererAdjustmentFlushTimeoutRef.current)
            }
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
            const textureSignature = JSON.stringify(
                data.Textures.map((texture: any) => ({
                    image: texture?.Image ?? '',
                    replaceableId: texture?.ReplaceableId ?? 0,
                    flags: texture?.Flags ?? 0
                }))
            )
            const snapshotChanged = isStandalone && lastStandaloneSnapshotVersionRef.current !== rpcState.snapshotVersion
            const texturesChanged =
                !isInitializedRef.current ||
                snapshotChanged ||
                lastTexturesSignatureRef.current !== textureSignature

            if (!texturesChanged) {
                return
            }
            const cloned = JSON.parse(JSON.stringify(data.Textures))
            const nextAdjustments: Record<string, TextureAdjustments> = {}
            const withReplaceables = cloned.map((t: any) => {
                if (!t?.Image && t?.ReplaceableId === 1) {
                    const texture = ensureLocalTexture({ ...t, Image: 'ReplaceableTextures\\TeamColor\\TeamColor00.blp' })
                    if (t?.[TEXTURE_ADJUSTMENTS_KEY]) {
                        nextAdjustments[texture.__editorId] = normalizeTextureAdjustments(t[TEXTURE_ADJUSTMENTS_KEY])
                    }
                    return texture
                }
                if (!t?.Image && t?.ReplaceableId === 2) {
                    const texture = ensureLocalTexture({ ...t, Image: 'ReplaceableTextures\\TeamGlow\\TeamGlow00.blp' })
                    if (t?.[TEXTURE_ADJUSTMENTS_KEY]) {
                        nextAdjustments[texture.__editorId] = normalizeTextureAdjustments(t[TEXTURE_ADJUSTMENTS_KEY])
                    }
                    return texture
                }
                const texture = ensureLocalTexture(t)
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
        }
    }, [visible, isStandalone ? rpcState.snapshotVersion : localStore.modelData?.Textures])

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

    const imageDataToDataUrl = (imageData: ImageData): string | null => {
        const canvas = document.createElement('canvas')
        canvas.width = imageData.width
        canvas.height = imageData.height
        const ctx = canvas.getContext('2d')
        if (ctx) {
            ctx.putImageData(imageData, 0, 0)
            return canvas.toDataURL()
        }
        return null
    }

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

    const clearRendererAdjustmentFlush = () => {
        if (rendererAdjustmentFlushTimeoutRef.current !== null) {
            window.clearTimeout(rendererAdjustmentFlushTimeoutRef.current)
            rendererAdjustmentFlushTimeoutRef.current = null
        }
    }

    const applyTextureToRenderer = (imagePath: string | undefined, imageData: ImageData) => {
        if (!imagePath) return

        if (isStandalone) {
            const dataUrl = imageDataToDataUrl(imageData)
            if (dataUrl) {
                emit('IPC_LIVE_TEXTURE_UPDATE', { imagePath, dataUrl })
            }
            return
        }

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

        const imageDataForRenderer = isDefaultTextureAdjustments(nextAdjustments)
            ? sourceImageData
            : applyTextureAdjustments(sourceImageData, nextAdjustments)

        applyTextureToRenderer(texture.Image, imageDataForRenderer)
        hasLiveTextureOverrideRef.current = !isDefaultTextureAdjustments(nextAdjustments)
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
                isStandalone ? 160 : 96
            )
        }
    }

    const handleAdjustmentSliderChange = (field: keyof TextureAdjustments, value: number) => {
        updateSelectedAdjustment({ [field]: value }, 'debounced')
    }

    const handleAdjustmentSliderComplete = () => {
        if (!selectedTextureId) return
        clearRendererAdjustmentFlush()
        flushTextureAdjustmentsToRenderer({ textureId: selectedTextureId })
    }

    const resetAdjustmentField = (field: keyof TextureAdjustments) => {
        updateSelectedAdjustment({ [field]: DEFAULT_TEXTURE_ADJUSTMENTS[field] }, 'immediate')
    }

    const buildTexturesForSave = (): any[] => {
        return localTextures.map((texture) => {
            const { __editorId, ...rest } = texture
            const raw = adjustmentsByTextureId[__editorId]
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
                    const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: mpqPath })
                    if (isStale()) return

                    const mpqBuffer = toArrayBuffer(mpqData)
                    if (mpqBuffer && mpqBuffer.byteLength > 0) {
                        const imageData = decodeTextureData(mpqBuffer, imagePath)
                        if (imageData) {
                            const defaultPreviewUrl = imageDataToDataUrl(imageData)
                            setBasePreviewImageData(imageData)
                            setPreviewSource('MPQ')
                            if (allowCachedPreviewUrl && defaultPreviewUrl) {
                                setPreviewUrl(defaultPreviewUrl)
                            }
                            writePreviewCache(cacheKey, { basePreviewImageData: imageData, previewUrl: defaultPreviewUrl, previewSource: 'MPQ', previewError: null })
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
                                    const defaultPreviewUrl = imageDataToDataUrl(imageData)
                                    setBasePreviewImageData(imageData)
                                    setPreviewSource('文件')
                                    if (allowCachedPreviewUrl && defaultPreviewUrl) {
                                        setPreviewUrl(defaultPreviewUrl)
                                    }
                                    writePreviewCache(cacheKey, { basePreviewImageData: imageData, previewUrl: defaultPreviewUrl, previewSource: '文件', previewError: null })
                                    loaded = true
                                    break
                                } else {
                                    lastError = '无法加载贴图：BLP 解码失败'
                                }
                            } else {
                                lastError = '无法加载贴图：读取失败'
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
                    const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: normalizedImagePath })
                    if (isStale()) return

                    const mpqBuffer = toArrayBuffer(mpqData)
                    if (mpqBuffer && mpqBuffer.byteLength > 0) {
                        const imageData = decodeTextureData(mpqBuffer, imagePath)
                        if (imageData) {
                            const defaultPreviewUrl = imageDataToDataUrl(imageData)
                            setBasePreviewImageData(imageData)
                            setPreviewSource('MPQ')
                            if (allowCachedPreviewUrl && defaultPreviewUrl) {
                                setPreviewUrl(defaultPreviewUrl)
                            }
                            writePreviewCache(cacheKey, { basePreviewImageData: imageData, previewUrl: defaultPreviewUrl, previewSource: 'MPQ', previewError: null })
                            loaded = true
                        }
                    }
                } catch {
                    if (!loaded) {
                        setPreviewError('无法加载贴图：MPQ 读取失败')
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
        clearRendererAdjustmentFlush()
    }, [selectedTextureId, basePreviewImageData])

    useEffect(() => {
        if (!basePreviewImageData) return
        if (previewAdjustRafRef.current !== null) {
            cancelAnimationFrame(previewAdjustRafRef.current)
            previewAdjustRafRef.current = null
        }
        const cacheKey = selectedPreviewCacheKeyRef.current
        const useDefaultAdjustments = isDefaultTextureAdjustments(selectedAdjustments)
        if (useDefaultAdjustments && cacheKey) {
            const cached = previewCacheRef.current.get(cacheKey)
            if (cached?.previewUrl) {
                setPreviewUrl(cached.previewUrl)
                return
            }
        }

        previewAdjustRafRef.current = requestAnimationFrame(() => {
            previewAdjustRafRef.current = null
            const adjusted = useDefaultAdjustments
                ? basePreviewImageData
                : applyTextureAdjustments(basePreviewImageData, selectedAdjustments)
            const dataUrl = imageDataToDataUrl(adjusted)
            if (dataUrl) {
                setPreviewUrl(dataUrl)
                if (cacheKey && useDefaultAdjustments) {
                    const cached = previewCacheRef.current.get(cacheKey)
                    if (cached) {
                        writePreviewCache(cacheKey, { ...cached, previewUrl: dataUrl, previewError: null })
                    }
                }
            }
        })

        return () => {
            if (previewAdjustRafRef.current !== null) {
                cancelAnimationFrame(previewAdjustRafRef.current)
                previewAdjustRafRef.current = null
            }
        }
    }, [basePreviewImageData, selectedAdjustments, selectedTextureId])

    const updateLocalTexture = (index: number, updates: any) => {
        const newTextures = [...localTextures]
        newTextures[index] = { ...newTextures[index], ...updates }
        setLocalTextures(newTextures)
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
    const selectedIndexRef = useRef(-1)
    const modelPathRef = useRef<string | undefined>(modelPath)

    const normalizeDroppedTexturePath = (filePath: string, currentModelPath?: string): string => {
        const normalizedFilePath = filePath.replace(/\\/g, '/')
        if (!currentModelPath) {
            return normalizedFilePath.replace(/\//g, '\\')
        }

        const modelDir = currentModelPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
        if (modelDir && normalizedFilePath.toLowerCase().startsWith(`${modelDir.toLowerCase()}/`)) {
            return normalizedFilePath.substring(modelDir.length + 1).replace(/\//g, '\\')
        }

        return normalizedFilePath.replace(/\//g, '\\')
    }

    useEffect(() => {
        selectedIndexRef.current = selectedIndex
        modelPathRef.current = modelPath
    }, [selectedIndex, modelPath])

    const applyDroppedTexture = (filePath: string) => {
        const currentSelectedIndex = selectedIndexRef.current
        if (currentSelectedIndex < 0) return

        const nextImagePath = normalizeDroppedTexturePath(filePath, modelPathRef.current)
        setLocalTextures((prev) => {
            if (currentSelectedIndex < 0 || currentSelectedIndex >= prev.length) return prev
            const next = [...prev]
            next[currentSelectedIndex] = { ...next[currentSelectedIndex], Image: nextImagePath, ReplaceableId: 0 }
            return next
        })
        message.success(`已替换贴图: ${nextImagePath}`)
    }

    useEffect(() => {
        if (!isStandalone || !visible) return

        let disposed = false
        let unlistenDrop: (() => void) | undefined

        const setupDragDrop = async () => {
            const currentWindowLabel = getCurrentWindow().label
            unlistenDrop = await listen<{ paths?: string[]; position?: { x: number; y: number } }>('tauri://drag-drop', (event) => {
                if (disposed) return
                const sourceWindowLabel = (event as any)?.windowLabel
                if (sourceWindowLabel && sourceWindowLabel !== currentWindowLabel) return

                const filePath = (event.payload?.paths || []).find((path) => /\.(blp|tga)$/i.test(path))
                if (!filePath) return

                const dropTargets = [pathInputDropRef.current, previewDropRef.current].filter(Boolean) as HTMLDivElement[]
                if (dropTargets.length === 0) return

                const position = event.payload?.position
                if (position) {
                    const hitTarget = dropTargets.some((target) => {
                        const rect = target.getBoundingClientRect()
                        return position.x >= rect.left && position.x <= rect.right && position.y >= rect.top && position.y <= rect.bottom
                    })
                    if (!hitTarget) return
                }

                applyDroppedTexture(filePath)
            })
        }

        setupDragDrop().catch((error) => {
            console.error('[TextureEditor] Failed to setup standalone drag-drop:', error)
        })

        return () => {
            disposed = true
            unlistenDrop?.()
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

    if (isStandalone) {
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

                                                    // Get existing texture paths for duplicate detection
                                                    const existingPaths = new Set(
                                                        localTextures.map(t => (t.Image || '').toLowerCase())
                                                    )

                                                    const newTextures: any[] = []
                                                    let addedCount = 0
                                                    let skippedCount = 0

                                                    for (const filePath of paths) {
                                                        // 计算相对路径
                                                        let relativePath = filePath

                                                        if (modelPath) {
                                                            // 获取模型所在目录
                                                            const modelDir = modelPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
                                                            const selectedNormalized = filePath.replace(/\\/g, '/')

                                                            // 检查是否在模型目录下
                                                            if (selectedNormalized.toLowerCase().startsWith(modelDir.toLowerCase())) {
                                                                // 提取相对路径
                                                                relativePath = selectedNormalized.substring(modelDir.length + 1)
                                                                // 转换为反斜杠（MDX 标准格式）
                                                                relativePath = relativePath.replace(/\//g, '\\')
                                                            } else {
                                                                // 不在模型目录下，使用文件名
                                                                relativePath = filePath.replace(/\\/g, '/').split('/').pop() || filePath
                                                            }
                                                        }

                                                        // Check for duplicate (same path)
                                                        if (existingPaths.has(relativePath.toLowerCase())) {
                                                            skippedCount++
                                                            continue
                                                        }

                                                        // Also add to existing set to prevent duplicates within the batch
                                                        existingPaths.add(relativePath.toLowerCase())

                                                        newTextures.push(ensureLocalTexture({ Image: relativePath, ReplaceableId: 0, Flags: 0 }))
                                                        addedCount++
                                                    }

                                                    if (newTextures.length > 0) {
                                                        const updatedTextures = [...localTextures, ...newTextures]
                                                        setLocalTextures(updatedTextures)
                                                        setSelectedIndex(updatedTextures.length - 1) // Select the last added texture
                                                        setTimeout(() => scrollToItem(updatedTextures.length - 1), 0)

                                                        if (addedCount === 1 && skippedCount === 0) {
                                                            message.success(`已添加纹理: ${newTextures[0].Image}`)
                                                        } else if (skippedCount > 0) {
                                                            message.success(`已添加 ${addedCount} 个纹理，跳过 ${skippedCount} 个重复`)
                                                        } else {
                                                            message.success(`已批量添加 ${addedCount} 个纹理`)
                                                        }
                                                    } else if (skippedCount > 0) {
                                                        message.warning(`所有选择的纹理都已存在，跳过 ${skippedCount} 个重复`)
                                                    }
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
                                                setLocalTextures([...localTextures, newTexture])
                                                setSelectedIndex(localTextures.length)
                                                setTimeout(() => scrollToItem(localTextures.length), 0)
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
                                                setLocalTextures(newTextures)
                                                if (removedId) {
                                                    setAdjustmentsByTextureId((prev) => {
                                                        const next = { ...prev }
                                                        delete next[removedId]
                                                        return next
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
                                <div style={{ flex: 1, display: 'flex', gap: '16px', minHeight: 0 }}>
                                    {/* Left Settings (Inputs, Checkboxes & Adjustments) */}
                                    <div style={{ width: '272px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div ref={pathInputDropRef} style={{ flexShrink: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                                                <Typography.Text style={{ color: '#b0b0b0' }}>路径:</Typography.Text>
                                            </div>
                                            <Input
                                                value={selectedTexture.Image}
                                                onChange={(e) => updateLocalTexture(selectedIndex, { Image: e.target.value })}
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
                                            <Typography.Text style={{ color: '#b0b0b0', fontSize: 12, display: 'block', marginBottom: 4 }}>贴图调整（保存后生效）</Typography.Text>

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
                                    <div ref={previewDropRef} style={{ width: '380px', flexShrink: 0, height: '380px', border: '1px solid #4a4a4a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f1f1f', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                                        {isLoadingPreview ? (
                                            <div style={{ color: '#5a9cff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                                <div className="ant-spin ant-spin-spinning" style={{ fontSize: 24 }}>?</div>
                                                <span>加载中...</span>
                                            </div>
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

}

export default TextureEditorModal














