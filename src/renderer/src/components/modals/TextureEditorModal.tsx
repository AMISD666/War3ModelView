import React, { useState, useEffect, useRef } from 'react'
import { List, Button, Input, Checkbox, InputNumber, Card, Typography, message, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { DraggableModal } from '../DraggableModal';
import { PlusOutlined, DeleteOutlined, FolderOpenOutlined, DatabaseOutlined } from '@ant-design/icons'
import { useSelectionStore } from '../../store/selectionStore'

import { useModelStore } from '../../store/modelStore'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { decodeTextureData, getTextureCandidatePaths, isMPQPath, normalizePath } from '../viewer/textureLoader'
import { setDraggedTextureIndex } from '../../utils/textureDragDrop'

const { Text } = Typography

interface TextureEditorModalProps {
    visible: boolean
    onClose: () => void
    modelPath?: string
    initialTextures?: any[] | null
    onApply?: (textures: any[]) => void | Promise<void>
    asWindow?: boolean
}

const TextureEditorModal: React.FC<TextureEditorModalProps> = ({
    visible,
    onClose,
    modelPath: propModelPath,
    initialTextures,
    onApply,
    asWindow = false
}) => {
    const { modelData, setTextures, modelPath: storeModelPath } = useModelStore()
    const [localTextures, setLocalTextures] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [isLoadingPreview, setIsLoadingPreview] = useState(false)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [previewSource, setPreviewSource] = useState<string | null>(null) // 'mpq' | 'file' | null
    const listRef = useRef<HTMLDivElement>(null)
    const previewLoadIdRef = useRef(0)
    const suppressNextLiveApplyRef = useRef(false)
    const lastAppliedSignatureRef = useRef('')
    const pendingLiveApplyRef = useRef<Promise<void>>(Promise.resolve())
    const [pathDraft, setPathDraft] = useState<string>('')
    const pathCommitTimerRef = useRef<number | null>(null)

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

    // Use prop modelPath if provided, otherwise fall back to store
    const modelPath = propModelPath || storeModelPath

    const getTexturesSignature = (textures: any[]) => {
        try {
            return JSON.stringify(textures)
        } catch {
            return `${textures.length}`
        }
    }

    // Initialize local state
    useEffect(() => {
        const sourceTextures = Array.isArray(initialTextures)
            ? initialTextures
            : (modelData?.Textures || null)

        if (visible && sourceTextures) {
            const cloned = typeof structuredClone === 'function'
                ? structuredClone(sourceTextures)
                : JSON.parse(JSON.stringify(sourceTextures))
            const withReplaceables = cloned.map((t: any) => {
                if (!t?.Image && t?.ReplaceableId === 1) {
                    return { ...t, Image: 'ReplaceableTextures\\TeamColor\\TeamColor00.blp' }
                }
                if (!t?.Image && t?.ReplaceableId === 2) {
                    return { ...t, Image: 'ReplaceableTextures\\TeamGlow\\TeamGlow00.blp' }
                }
                return t
            })
            suppressNextLiveApplyRef.current = true
            lastAppliedSignatureRef.current = getTexturesSignature(withReplaceables)
            setLocalTextures(withReplaceables)

            let initialSelection = withReplaceables.length > 0 ? 0 : -1

            if (!Array.isArray(initialTextures) && modelData) {
                const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
                if (initialPickedIndex !== null && modelData.Geosets && modelData.Geosets[initialPickedIndex]) {
                    const materialId = modelData.Geosets[initialPickedIndex].MaterialID
                    if (materialId !== undefined && modelData.Materials && modelData.Materials[materialId]) {
                        const material = modelData.Materials[materialId]
                        if (material.Layers && material.Layers.length > 0) {
                            const textureId = material.Layers[0].TextureID
                            if (typeof textureId === 'number' && textureId >= 0 && textureId < withReplaceables.length) {
                                initialSelection = textureId
                                console.log('[TextureEditor] Initial auto-selected texture', textureId, 'for geoset', initialPickedIndex)
                            }
                        }
                    }
                }
            }

            if (initialSelection !== -1) {
                setSelectedIndex(initialSelection)
                setTimeout(() => scrollToItem(initialSelection), 0)
            } else {
                setSelectedIndex(withReplaceables.length > 0 ? 0 : -1)
            }
        } else if (visible) {
            suppressNextLiveApplyRef.current = true
            lastAppliedSignatureRef.current = getTexturesSignature([])
            setLocalTextures([])
            setSelectedIndex(-1)
        }
    }, [visible, modelData, initialTextures])

    useEffect(() => {
        if (!visible || !onApply) return
        if (suppressNextLiveApplyRef.current) {
            suppressNextLiveApplyRef.current = false
            return
        }

        const signature = getTexturesSignature(localTextures)
        if (signature === lastAppliedSignatureRef.current) {
            return
        }
        lastAppliedSignatureRef.current = signature

        pendingLiveApplyRef.current = pendingLiveApplyRef.current
            .catch(() => { })
            .then(async () => {
                await onApply(localTextures)
            })
            .catch((error) => {
                console.error('[TextureEditor] Live apply failed:', error)
            })
    }, [localTextures, onApply, visible])

    // Subscribe to Ctrl+Click geoset picking - auto-select texture
    useEffect(() => {
        if (!visible || !modelData || Array.isArray(initialTextures)) return

        // Initial check is handled in the init effect above to avoid race conditions or double sets
        // But we still need to subscribe to subsequent changes while modal is open

        let lastPickedIndex: number | null = useSelectionStore.getState().pickedGeosetIndex

        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                if (pickedGeosetIndex !== null && modelData.Geosets && modelData.Geosets[pickedGeosetIndex]) {
                    const materialId = modelData.Geosets[pickedGeosetIndex].MaterialID
                    if (materialId !== undefined && modelData.Materials && modelData.Materials[materialId]) {
                        const material = modelData.Materials[materialId]
                        if (material.Layers && material.Layers.length > 0) {
                            const textureId = material.Layers[0].TextureID
                            // Note: TextureID can be AnimVector, handle number only
                            if (typeof textureId === 'number' && textureId >= 0 && textureId < localTextures.length) {
                                setSelectedIndex(textureId)
                                scrollToItem(textureId)
                                console.log('[TextureEditor] Auto-selected texture', textureId, 'for geoset', pickedGeosetIndex)
                            }
                        }
                    }
                }
            }
        })
        return unsubscribe
    }, [visible, modelData, localTextures.length, initialTextures])

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
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }

    const isAbsolutePath = (p: string) => /^[a-zA-Z]:/.test(p) || p.startsWith('\\\\')

    const getLocalCandidates = (imagePath: string): string[] => {
        const normalized = normalizePath(imagePath)
        if (isAbsolutePath(normalized)) return [normalized]
        if (modelPath) return getTextureCandidatePaths(modelPath, normalized)
        return [normalized]
    }

    // Load preview when selection changes
    useEffect(() => {
        const loadId = ++previewLoadIdRef.current
        const isStale = () => previewLoadIdRef.current !== loadId

        const loadTexture = async () => {
            if (selectedIndex < 0 || !localTextures[selectedIndex]) {
                setPreviewUrl(null)
                setPreviewError(null)
                setPreviewSource(null)
                return
            }

            const texture = localTextures[selectedIndex]
            if (!texture.Image) {
                const replaceableLabel = getReplaceableLabel(texture.ReplaceableId)
                if (texture.ReplaceableId === 1) {
                    setPreviewUrl(makeSolidDataUrl(220, 60, 60))
                    setPreviewError(null)
                    setPreviewSource('Replaceable')
                } else if (texture.ReplaceableId === 2) {
                    setPreviewUrl(makeSolidDataUrl(255, 210, 0))
                    setPreviewError(null)
                    setPreviewSource('Replaceable')
                } else if (replaceableLabel) {
                    setPreviewUrl(null)
                    setPreviewError(replaceableLabel)
                    setPreviewSource(null)
                } else {
                    setPreviewUrl(null)
                    setPreviewError('Unable to load texture')
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

            let loaded = false

            // Strategy 1: Try MPQ first for standard Warcraft 3 paths
            const isMpqPath = isMPQPath(normalizedImagePath)

            if (isMpqPath && isSupported) {
                try {
                    const mpqPath = normalizedImagePath
                    console.log('[TextureEditor] Trying MPQ for:', mpqPath)
                    const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: mpqPath })
                    if (isStale()) return

                    const mpqBuffer = toArrayBuffer(mpqData)
                    if (mpqBuffer && mpqBuffer.byteLength > 0) {
                        const imageData = decodeTextureData(mpqBuffer, imagePath)
                        const dataUrl = imageData ? imageDataToDataUrl(imageData) : null
                        if (dataUrl) {
                            setPreviewUrl(dataUrl)
                            setPreviewSource('MPQ')
                            loaded = true
                            console.log('[TextureEditor] Loaded from MPQ successfully')
                        }
                    }
                } catch (mpqError) {
                    console.log('[TextureEditor] MPQ loading failed, trying file system:', mpqError)
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
                        setPreviewError('Unable to load texture: MPQ not found')
                    }
                    setIsLoadingPreview(false)
                    return
                }
            }

            // Strategy 2: Try local file system if MPQ didn't work
            if (!loaded && isSupported && !isReplaceable) {
                try {
                    const candidates = getLocalCandidates(imagePath)
                    let lastError: string | null = null

                    for (const candidate of candidates) {
                        console.log('[TextureEditor] Trying file system for:', candidate)
                        try {
                            const buffer = await readFile(candidate)
                            if (isStale()) return
                            if (buffer) {
                                const imageData = decodeTextureData(buffer.buffer, imagePath)
                                const dataUrl = imageData ? imageDataToDataUrl(imageData) : null
                                if (dataUrl) {
                                    setPreviewUrl(dataUrl)
                                    setPreviewSource('File')
                                    loaded = true
                                    console.log('[TextureEditor] Loaded from file system successfully')
                                    break
                                } else {
                                    lastError = 'Unable to load texture: BLP decode failed'
                                }
                            } else {
                                lastError = 'Unable to load texture: read failed'
                            }
                        } catch (e: any) {
                            if (!loaded) {
                                lastError = 'Unable to load texture: ' + (e.message || 'read failed')
                            }
                        }
                    }

                    if (!loaded && lastError) {
                        setPreviewError(lastError)
                    }
                } catch (e: any) {
                    console.error("[TextureEditor] File system load failed:", e)
                    if (!loaded) {
                        setPreviewError('Unable to load texture: ' + (e.message || 'read failed'))
                    }
                }
            }

            // Strategy 3: MPQ fallback even for non-standard paths
            if (!loaded && isSupported && !isReplaceable) {
                try {
                    const mpqData = await invoke<Uint8Array>('read_mpq_file', { path: normalizedImagePath })
                    if (isStale()) return

                    const mpqBuffer = toArrayBuffer(mpqData)
                    if (mpqBuffer && mpqBuffer.byteLength > 0) {
                        const imageData = decodeTextureData(mpqBuffer, imagePath)
                        const dataUrl = imageData ? imageDataToDataUrl(imageData) : null
                        if (dataUrl) {
                            setPreviewUrl(dataUrl)
                            setPreviewSource('MPQ')
                            loaded = true
                        }
                    }
                } catch (e: any) {
                    if (!loaded) {
                        setPreviewError('Unable to load texture: MPQ read failed')
                    }
                }
            }

            // Non-BLP texture (PNG, TGA, etc.)
            if (!loaded && !isSupported) {
                const candidates = getLocalCandidates(imagePath)
                let fullPath = candidates[0] || imagePath

                for (const candidate of candidates) {
                    try {
                        await readFile(candidate)
                        fullPath = candidate
                        break
                    } catch {
                        // Try next candidate
                    }
                }
                setPreviewUrl(`file://${fullPath}`)
                setPreviewSource('File')
            }

            if (isStale()) return
            setIsLoadingPreview(false)
        }
        loadTexture()
    }, [selectedIndex, localTextures, modelPath])

    const handleOk = () => {
        setTextures(localTextures)
        message.success('Texture saved')
        onClose()
    }

    const handleModalOk = async () => {
        if (onApply) {
            try {
                await onApply(localTextures)
                message.success('Texture saved')
                onClose()
            } catch (error) {
                console.error('[TextureEditor] Apply failed:', error)
                message.error('Failed to save textures')
            }
            return
        }
        handleOk()
    }

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

    const selectedTexture = selectedIndex >= 0 ? localTextures[selectedIndex] : null

    useEffect(() => {
        if (selectedTexture?.Image !== undefined && selectedTexture?.Image !== null) {
            setPathDraft(String(selectedTexture.Image))
        } else {
            setPathDraft('')
        }
    }, [selectedIndex, selectedTexture?.Image])

    useEffect(() => {
        return () => {
            if (pathCommitTimerRef.current !== null) {
                window.clearTimeout(pathCommitTimerRef.current)
            }
        }
    }, [])

    const commitPathDraft = (indexAtCommit: number, valueAtCommit: string) => {
        if (indexAtCommit < 0) return
        if (pathCommitTimerRef.current !== null) {
            window.clearTimeout(pathCommitTimerRef.current)
        }
        pathCommitTimerRef.current = window.setTimeout(() => {
            updateLocalTexture(indexAtCommit, { Image: valueAtCommit })
            pathCommitTimerRef.current = null
        }, 100)
    }

    const renderEditorContent = (contentHeight: string | number = '500px') => (
        <div style={{ display: 'flex', height: contentHeight, border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
            <div ref={listRef} style={{ width: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a' }}>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        block
                        style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff' }}
                        onClick={async () => {
                            const selected = await open({
                                multiple: true,
                                filters: [{ name: 'Textures', extensions: ['blp', 'tga', 'png', 'jpg', 'jpeg', 'bmp'] }]
                            })
                            if (!selected) return
                            try {
                                const paths = Array.isArray(selected) ? selected : [selected]
                                const newTextures = paths.map((p: string) => ({
                                    Image: p,
                                    ReplaceableId: 0,
                                    Flags: 0
                                }))
                                if (newTextures.length > 0) {
                                    const updatedTextures = [...localTextures, ...newTextures]
                                    setLocalTextures(updatedTextures)
                                    setSelectedIndex(updatedTextures.length - 1)
                                    setTimeout(() => scrollToItem(updatedTextures.length - 1), 0)
                                    message.success(`Added ${newTextures.length} texture(s)`)
                                } else {
                                    message.warning('No new textures were added')
                                }
                            } catch (error) {
                                console.error('Failed to import textures:', error)
                            }
                        }}
                    >
                        Add Texture
                    </Button>
                </div>
                <List
                    dataSource={localTextures}
                    renderItem={(item, index) => (
                        <List.Item
                            onClick={() => setSelectedIndex(index)}
                            draggable
                            onDragStart={(event) => {
                                setDraggedTextureIndex(event.dataTransfer, index)
                                event.dataTransfer.effectAllowed = 'copy'
                            }}
                            style={{
                                cursor: 'pointer',
                                padding: '6px 12px',
                                backgroundColor: selectedIndex === index ? '#1677ff' : 'transparent',
                                color: selectedIndex === index ? '#fff' : '#b0b0b0',
                                borderBottom: '1px solid #3a3a3a',
                                minHeight: '36px'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '110px', fontSize: '13px' }}>
                                    <span style={{ marginRight: '6px', opacity: 0.5, fontSize: '11px' }}>{index}:</span>
                                    {item.Image ? item.Image.split('\\').pop() : (getReplaceableLabel(item.ReplaceableId) || 'Unknown')}
                                </div>
                                <DeleteOutlined
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        const newTextures = localTextures.filter((_, i) => i !== index)
                                        setLocalTextures(newTextures)
                                        if (selectedIndex === index) setSelectedIndex(-1)
                                        else if (selectedIndex > index) setSelectedIndex(selectedIndex - 1)
                                    }}
                                    style={{ color: selectedIndex === index ? '#fff' : '#ff4d4f', fontSize: '12px', opacity: 0.8 }}
                                />
                            </div>
                        </List.Item>
                    )}
                />
            </div>

            <div style={{ flex: 1, padding: '12px', overflowY: 'auto', backgroundColor: '#252525', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {selectedTexture ? (
                    <>
                        <div style={{ height: '350px', border: '1px solid #4a4a4a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                            {isLoadingPreview ? (
                                <div style={{ color: '#1677ff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                    <div className="ant-spin ant-spin-spinning" style={{ fontSize: 20 }}>...</div>
                                    <span style={{ fontSize: 12 }}>Loading Preview...</span>
                                </div>
                            ) : previewUrl ? (
                                <>
                                    <img src={previewUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                    {previewSource && (
                                        <div style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: previewSource === 'MPQ' ? '#52c41a' : '#1677ff', color: '#fff', padding: '1px 5px', borderRadius: 2, fontSize: 10, fontWeight: 'bold', opacity: 0.8 }}>
                                            {previewSource}
                                        </div>
                                    )}
                                </>
                            ) : previewError ? (
                                <div style={{ color: '#ff4d4f', textAlign: 'center', padding: 8, fontSize: '12px' }}>
                                    <div>Warning: {previewError}</div>
                                    <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>{selectedTexture?.Image}</div>
                                </div>
                            ) : (
                                <span style={{ color: '#666', fontSize: '12px' }}>No Available Preview</span>
                            )}
                        </div>

                        <Card title={<span style={{ color: '#e8e8e8', fontSize: '13px' }}>Texture Properties</span>} size="small" bordered={false} style={{ background: '#333333', border: '1px solid #4a4a4a' }} styles={{ header: { borderBottom: '1px solid #4a4a4a', padding: '4px 12px' }, body: { padding: '12px' } }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Text style={{ minWidth: '45px', color: '#b0b0b0', fontSize: '12px' }}>Path:</Text>
                                    <Input
                                        size="small"
                                        value={pathDraft}
                                        onChange={(event) => setPathDraft(event.target.value)}
                                        onBlur={() => commitPathDraft(selectedIndex, pathDraft)}
                                        onPressEnter={() => commitPathDraft(selectedIndex, pathDraft)}
                                        style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Text style={{ minWidth: '45px', color: '#b0b0b0', fontSize: '12px' }}>ReplID:</Text>
                                    <InputNumber size="small" value={selectedTexture.ReplaceableId} onChange={(value) => updateLocalTexture(selectedIndex, { ReplaceableId: value })} style={{ width: '80px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }} />
                                    <Text style={{ fontSize: '11px', color: '#808080', marginLeft: '4px' }}>0:None, 1:TeamColor, 2:TeamGlow, 31+:Trees</Text>
                                </div>
                                <div style={{ display: 'flex', gap: '16px', paddingLeft: '53px' }}>
                                    <Checkbox checked={isFlagSet(1)} onChange={(event) => handleFlagChange(1, event.target.checked)} style={{ color: '#e8e8e8', fontSize: '12px' }}>Wrap Width</Checkbox>
                                    <Checkbox checked={isFlagSet(2)} onChange={(event) => handleFlagChange(2, event.target.checked)} style={{ color: '#e8e8e8', fontSize: '12px' }}>Wrap Height</Checkbox>
                                </div>
                            </div>
                        </Card>
                    </>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888', fontSize: '13px' }}>
                        Please select a texture from the left list
                    </div>
                )}
            </div>
        </div >
    )

    if (asWindow) {
        if (!visible) return null
        return (
            <div style={{ height: '100vh', padding: 12, backgroundColor: '#1f1f1f', overflow: 'hidden' }}>
                {renderEditorContent('calc(100vh - 24px)')}
            </div>
        )
    }

    return (
        <DraggableModal
            title="纹理管理器"
            open={visible}
            onOk={handleModalOk}
            onCancel={onClose}
            width={900}
            okText="保存"
            cancelText="取消"
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{
                content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                body: { backgroundColor: '#2d2d2d' },
                footer: { borderTop: '1px solid #4a4a4a' },
            }}
        >
            {renderEditorContent()}
        </DraggableModal>
    )
}

export default TextureEditorModal
