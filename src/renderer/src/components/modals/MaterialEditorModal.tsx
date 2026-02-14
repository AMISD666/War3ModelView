import React, { useState, useEffect } from 'react'
import { Button, List, Card, Checkbox, InputNumber, Select, Typography, message, Row, Col, Input } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { DraggableModal } from '../DraggableModal'
import KeyframeEditor from '../editors/KeyframeEditor'
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useHistoryStore } from '../../store/historyStore'
import { getDraggedTextureIndex } from '../../utils/textureDragDrop'

const { Text } = Typography

/**
 * Convert Shading bitmask to individual boolean properties for UI display
 * LayerShading: Unshaded=1, SphereEnvMap=2, TwoSided=16, Unfogged=32, NoDepthTest=64, NoDepthSet=128
 */
function normalizeMaterialsForUI(materials: any[]): any[] {
    return materials.map(material => ({
        ...material,
        Layers: (material.Layers || []).map((layer: any) => {
            const shading = layer.Shading || 0;
            return {
                ...layer,
                // Set boolean properties from Shading bitmask (if not already set)
                Unshaded: layer.Unshaded !== undefined ? layer.Unshaded : (shading & 1) !== 0,
                SphereEnvMap: layer.SphereEnvMap !== undefined ? layer.SphereEnvMap : (shading & 2) !== 0,
                TwoSided: layer.TwoSided !== undefined ? layer.TwoSided : (shading & 16) !== 0,
                Unfogged: layer.Unfogged !== undefined ? layer.Unfogged : (shading & 32) !== 0,
                NoDepthTest: layer.NoDepthTest !== undefined ? layer.NoDepthTest : (shading & 64) !== 0,
                NoDepthSet: layer.NoDepthSet !== undefined ? layer.NoDepthSet : (shading & 128) !== 0,
            };
        })
    }));
}

/**
 * Convert boolean properties back to Shading bitmask for saving
 */
function denormalizeMaterialsForSave(materials: any[]): any[] {
    return materials.map(material => ({
        ...material,
        // Ensure material has required properties
        PriorityPlane: material.PriorityPlane ?? 0,
        RenderMode: material.RenderMode ?? 0,
        Layers: (material.Layers || []).map((layer: any) => {
            // Rebuild Shading bitmask from boolean flags
            let shading = 0;
            if (layer.Unshaded) shading |= 1;
            if (layer.SphereEnvMap) shading |= 2;
            if (layer.TwoSided) shading |= 16;
            if (layer.Unfogged) shading |= 32;
            if (layer.NoDepthTest) shading |= 64;
            if (layer.NoDepthSet) shading |= 128;

            // Create clean layer without UI-only boolean properties
            const { Unshaded, SphereEnvMap, TwoSided, Unfogged, NoDepthTest, NoDepthSet, ...cleanLayer } = layer;

            return {
                ...cleanLayer,
                // Core required properties with defaults
                FilterMode: layer.FilterMode ?? 0,
                Shading: shading,
                CoordId: layer.CoordId ?? 0,
                Alpha: layer.Alpha ?? 1,
                // TextureID - can be number or AnimVector
                TextureID: layer.TextureID ?? 0,
                // TVertexAnimId - null or a valid index (not undefined)
                TVertexAnimId: layer.TVertexAnimId === undefined ? null : layer.TVertexAnimId,
            };
        })
    }));
}

interface MaterialEditorModalProps {
    visible: boolean
    onClose: () => void
    asWindow?: boolean
}

const MaterialEditorModal: React.FC<MaterialEditorModalProps> = ({ visible, onClose, asWindow = false }) => {
    const { modelData, modelPath, setMaterials, setTextures } = useModelStore()
    const [localMaterials, setLocalMaterials] = useState<any[]>([])
    const [selectedMaterialIndex, setSelectedMaterialIndex] = useState<number>(-1)
    const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(-1)
    const [dragLayerIndex, setDragLayerIndex] = useState<number | null>(null)
    const [dragOverLayerIndex, setDragOverLayerIndex] = useState<number | null>(null)
    const [isTextureDropActive, setIsTextureDropActive] = useState(false)

    // Keyframe Editor State
    const [isKeyframeEditorOpen, setIsKeyframeEditorOpen] = useState(false)
    const [editingField, setEditingField] = useState<string | null>(null)
    const [editingVectorSize, setEditingVectorSize] = useState(1)
    const [isTextureAnimIdEditorOpen, setIsTextureAnimIdEditorOpen] = useState(false)
    const [textureAnimIdEditorText, setTextureAnimIdEditorText] = useState('')

    const isInitialized = React.useRef(false)
    const materialListRef = React.useRef<HTMLDivElement>(null)
    const layerListRef = React.useRef<HTMLDivElement>(null)
    const textureDropZoneRef = React.useRef<HTMLDivElement>(null)
    const textureAnimIdInputRef = React.useRef<any>(null)
    const dragOverLayerIndexRef = React.useRef<number | null>(null)
    const originalMaterialsRef = React.useRef<any[] | null>(null)
    const originalTexturesRef = React.useRef<any[] | null>(null)
    const isCommittingRef = React.useRef(false)
    const didRealtimePreviewRef = React.useRef(false)
    const didRealtimeTexturePreviewRef = React.useRef(false)
    const suppressNextLiveApplyRef = React.useRef(false)
    const lastAppliedSignatureRef = React.useRef('')

    useEffect(() => {
        dragOverLayerIndexRef.current = dragOverLayerIndex
    }, [dragOverLayerIndex])

    // Initialize local state
    useEffect(() => {
        if (visible) {
            if (!isInitialized.current && modelData && modelData.Materials) {
                console.log('[MaterialEditorModal] Initializing local materials from store. Count:', modelData.Materials.length)
                originalMaterialsRef.current = JSON.parse(JSON.stringify(modelData.Materials))
                originalTexturesRef.current = JSON.parse(JSON.stringify(modelData.Textures || []))
                isCommittingRef.current = false
                didRealtimePreviewRef.current = false
                didRealtimeTexturePreviewRef.current = false
                // Convert Shading bitmask to boolean properties for UI display
                const normalized = normalizeMaterialsForUI(JSON.parse(JSON.stringify(modelData.Materials)));
                suppressNextLiveApplyRef.current = true
                try {
                    lastAppliedSignatureRef.current = JSON.stringify(normalized)
                } catch {
                    lastAppliedSignatureRef.current = `${normalized.length}`
                }
                setLocalMaterials(normalized)
                setSelectedMaterialIndex(modelData.Materials.length > 0 ? 0 : -1)
                setSelectedLayerIndex(
                    modelData.Materials.length > 0 && Array.isArray(normalized[0]?.Layers) && normalized[0].Layers.length > 0
                        ? 0
                        : -1
                )
                isInitialized.current = true
            }
        } else {
            setLocalMaterials([])
            setSelectedMaterialIndex(-1)
            setSelectedLayerIndex(-1)
            setIsTextureDropActive(false)
            isInitialized.current = false
            if (isCommittingRef.current) {
                isCommittingRef.current = false
            }
            originalMaterialsRef.current = null
            originalTexturesRef.current = null
            didRealtimePreviewRef.current = false
            didRealtimeTexturePreviewRef.current = false
            suppressNextLiveApplyRef.current = false
            lastAppliedSignatureRef.current = ''
        }
    }, [visible, modelData])

    // Subscribe to Ctrl+Click geoset picking - auto-select material
    useEffect(() => {
        if (!visible || !modelData) return

        // Read initial value immediately when modal opens
        const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
        if (initialPickedIndex !== null && modelData.Geosets && modelData.Geosets[initialPickedIndex]) {
            const materialId = modelData.Geosets[initialPickedIndex].MaterialID
            if (materialId !== undefined && materialId >= 0 && materialId < localMaterials.length) {
                setSelectedMaterialIndex(materialId)
                const layers = localMaterials[materialId]?.Layers
                setSelectedLayerIndex(Array.isArray(layers) && layers.length > 0 ? 0 : -1)
                console.log('[MaterialEditor] Initial auto-selected material', materialId, 'for geoset', initialPickedIndex)
            }
        }

        // Subscribe to future changes
        let lastPickedIndex: number | null = initialPickedIndex
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                if (pickedGeosetIndex !== null && modelData.Geosets && modelData.Geosets[pickedGeosetIndex]) {
                    const materialId = modelData.Geosets[pickedGeosetIndex].MaterialID
                    if (materialId !== undefined && materialId >= 0 && materialId < localMaterials.length) {
                        setSelectedMaterialIndex(materialId)
                        const layers = localMaterials[materialId]?.Layers
                        setSelectedLayerIndex(Array.isArray(layers) && layers.length > 0 ? 0 : -1)
                        console.log('[MaterialEditor] Auto-selected material', materialId, 'for geoset', pickedGeosetIndex)
                    }
                }
            }
        })
        return unsubscribe
    }, [visible, modelData, localMaterials.length])

    useEffect(() => {
        if (!visible || !asWindow) return
        if (suppressNextLiveApplyRef.current) {
            suppressNextLiveApplyRef.current = false
            return
        }

        let signature = ''
        try {
            signature = JSON.stringify(localMaterials)
        } catch {
            signature = `${localMaterials.length}`
        }
        if (signature === lastAppliedSignatureRef.current) return
        lastAppliedSignatureRef.current = signature

        didRealtimePreviewRef.current = true
        setMaterials(denormalizeMaterialsForSave(localMaterials))
    }, [visible, asWindow, localMaterials, setMaterials])

    useEffect(() => {
        if (selectedMaterialIndex < 0) {
            if (selectedLayerIndex !== -1) setSelectedLayerIndex(-1)
            return
        }
        const layers = localMaterials[selectedMaterialIndex]?.Layers || []
        if (!Array.isArray(layers) || layers.length === 0) {
            if (selectedLayerIndex !== -1) setSelectedLayerIndex(-1)
            return
        }
        if (selectedLayerIndex < 0 || selectedLayerIndex >= layers.length) {
            setSelectedLayerIndex(0)
        }
    }, [localMaterials, selectedMaterialIndex, selectedLayerIndex])

    const handleOk = () => {
        // Convert boolean flags back to Shading bitmask before saving
        const materialsForSave = denormalizeMaterialsForSave(localMaterials)
        const texturesForSave = JSON.parse(JSON.stringify(modelData?.Textures || []))
        const oldMaterials = originalMaterialsRef.current || modelData?.Materials || []
        const oldTextures = originalTexturesRef.current || modelData?.Textures || []

        useHistoryStore.getState().push({
            name: '编辑材质',
            undo: () => {
                setTextures(oldTextures)
                setMaterials(oldMaterials)
            },
            redo: () => {
                setTextures(texturesForSave)
                setMaterials(materialsForSave)
            }
        })

        isCommittingRef.current = true
        setTextures(texturesForSave)
        setMaterials(materialsForSave)
        message.success('材质已保存')
        onClose()
    }

    const handleCancel = () => {
        if (!asWindow && !isCommittingRef.current && didRealtimeTexturePreviewRef.current && originalTexturesRef.current) {
            setTextures(originalTexturesRef.current)
        }
        if (!asWindow && !isCommittingRef.current && didRealtimePreviewRef.current && originalMaterialsRef.current) {
            setMaterials(originalMaterialsRef.current)
        }
        onClose()
    }

    const updateLocalMaterial = (index: number, updates: any) => {
        const newMaterials = [...localMaterials]
        newMaterials[index] = { ...newMaterials[index], ...updates }
        setLocalMaterials(newMaterials)
    }

    const updateLocalLayer = (matIndex: number, layerIndex: number, updates: any, applyRealtime: boolean = false) => {
        const newMaterials = [...localMaterials]
        const newLayers = [...newMaterials[matIndex].Layers]
        newLayers[layerIndex] = { ...newLayers[layerIndex], ...updates }
        newMaterials[matIndex].Layers = newLayers
        setLocalMaterials(newMaterials)

        if (applyRealtime) {
            didRealtimePreviewRef.current = true
            setMaterials(denormalizeMaterialsForSave(newMaterials))
        }
    }

    const moveLayer = (fromIndex: number, toIndex: number) => {
        if (selectedMaterialIndex < 0) return
        const material = localMaterials[selectedMaterialIndex]
        const layers = [...(material?.Layers || [])]
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= layers.length || toIndex >= layers.length) return
        if (fromIndex === toIndex) return

        const [moved] = layers.splice(fromIndex, 1)
        layers.splice(toIndex, 0, moved)

        const newMaterials = [...localMaterials]
        newMaterials[selectedMaterialIndex] = { ...material, Layers: layers }
        setLocalMaterials(newMaterials)

        if (selectedLayerIndex === fromIndex) {
            setSelectedLayerIndex(toIndex)
        } else if (selectedLayerIndex > fromIndex && selectedLayerIndex <= toIndex) {
            setSelectedLayerIndex(selectedLayerIndex - 1)
        } else if (selectedLayerIndex < fromIndex && selectedLayerIndex >= toIndex) {
            setSelectedLayerIndex(selectedLayerIndex + 1)
        }
    }

    const handleLayerMouseDown = (e: React.MouseEvent, index: number) => {
        if (e.button !== 0) return
        if (selectedMaterialIndex < 0) return
        e.preventDefault()

        const startX = e.clientX
        const startY = e.clientY
        let dragStarted = false

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = Math.abs(moveEvent.clientX - startX)
            const deltaY = Math.abs(moveEvent.clientY - startY)

            if (!dragStarted && (deltaX > 4 || deltaY > 4)) {
                dragStarted = true
                setDragLayerIndex(index)
                setDragOverLayerIndex(index)
            }

            if (dragStarted) {
                const elementUnderMouse = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null
                const layerItem = elementUnderMouse?.closest('[data-layer-index]') as HTMLElement | null
                if (layerItem) {
                    const targetIndex = parseInt(layerItem.dataset.layerIndex || '', 10)
                    if (!isNaN(targetIndex)) {
                        setDragOverLayerIndex(targetIndex)
                    }
                } else {
                    setDragOverLayerIndex(null)
                }
            }
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            if (dragStarted) {
                const targetIndex = dragOverLayerIndexRef.current
                if (targetIndex !== null) {
                    moveLayer(index, targetIndex)
                }
            }
            setDragLayerIndex(null)
            setDragOverLayerIndex(null)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // Material Actions
    const handleAddMaterial = () => {
        // Include a default layer with TextureID 0 so the geoset renders correctly
        const defaultLayer = {
            FilterMode: 0,
            TextureID: 0,
            Alpha: 1,
            Unshaded: true, // Prevent lighting issues hiding the model
            Unfogged: false,
            TwoSided: true, // Prevent backface culling hiding the model
            SphereEnvMap: false,
            NoDepthTest: false,
            NoDepthSet: false
        }
        const newMaterial = { PriorityPlane: 0, RenderMode: 0, Layers: [defaultLayer] }
        setLocalMaterials([...localMaterials, newMaterial])
        setSelectedMaterialIndex(localMaterials.length)
        setSelectedLayerIndex(0)
        // Auto-scroll to the new material after state update
        setTimeout(() => {
            if (materialListRef.current) {
                materialListRef.current.scrollTop = materialListRef.current.scrollHeight
            }
        }, 0)
    }

    const handleDeleteMaterial = (index: number) => {
        const newMaterials = localMaterials.filter((_, i) => i !== index)
        setLocalMaterials(newMaterials)

        // Update geoset MaterialID references - only for geosets that referenced the deleted material
        // Set them to use material 0 (the first remaining material)
        if (modelData?.Geosets) {
            const updatedGeosets = modelData.Geosets.map((geoset: any) => {
                const matId = geoset.MaterialID;
                if (matId === index) {
                    // Geoset was referencing the deleted material, set to 0
                    return { ...geoset, MaterialID: 0 };
                } else if (matId > index) {
                    // Geoset was referencing a material after the deleted one
                    // We need to decrement to keep the reference valid
                    return { ...geoset, MaterialID: matId - 1 };
                }
                return geoset;
            });
            // Sync BOTH materials and geosets to the store together to prevent mismatch
            // This ensures the renderer sees consistent data
            setMaterials(newMaterials);
            useModelStore.getState().setGeosets(updatedGeosets);
        }

        if (selectedMaterialIndex === index) {
            setSelectedMaterialIndex(-1)
            setSelectedLayerIndex(-1)
        } else if (selectedMaterialIndex > index) {
            setSelectedMaterialIndex(selectedMaterialIndex - 1)
        }
    }

    // Layer Actions
    const handleAddLayer = () => {
        if (selectedMaterialIndex < 0) return
        const newLayer = {
            FilterMode: 0,
            TextureID: 0,  // Default to first texture (index 0) instead of -1 (invalid)
            Alpha: 1,
            Unshaded: true,
            Unfogged: false,
            TwoSided: true,
            SphereEnvMap: false,
            NoDepthTest: false,
            NoDepthSet: false
        }
        const newMaterials = [...localMaterials]
        newMaterials[selectedMaterialIndex].Layers = [...(newMaterials[selectedMaterialIndex].Layers || []), newLayer]
        setLocalMaterials(newMaterials)
        setSelectedLayerIndex(newMaterials[selectedMaterialIndex].Layers.length - 1)
    }

    const handleDeleteLayer = (index: number) => {
        if (selectedMaterialIndex < 0) return
        const newMaterials = [...localMaterials]
        newMaterials[selectedMaterialIndex].Layers = newMaterials[selectedMaterialIndex].Layers.filter((_: any, i: number) => i !== index)
        setLocalMaterials(newMaterials)
        if (selectedLayerIndex === index) setSelectedLayerIndex(-1)
        else if (selectedLayerIndex > index) setSelectedLayerIndex(selectedLayerIndex - 1)
    }

    // Keyframe Logic
    const openKeyframeEditor = (field: string, vectorSize: number) => {
        setEditingField(field)
        setEditingVectorSize(vectorSize)
        setIsKeyframeEditorOpen(true)
    }

    const openTextureAnimIdTextEditor = () => {
        if (selectedMaterialIndex < 0 || selectedLayerIndex < 0) return
        const layer = localMaterials[selectedMaterialIndex]?.Layers?.[selectedLayerIndex]
        if (!layer) return
        const currentId = layer.TVertexAnimId === null || layer.TVertexAnimId === undefined ? -1 : layer.TVertexAnimId
        setTextureAnimIdEditorText(String(currentId))
        setIsTextureAnimIdEditorOpen(true)
    }

    const handleTextureAnimIdTextSave = () => {
        if (selectedMaterialIndex < 0 || selectedLayerIndex < 0) return
        const raw = textureAnimIdEditorText.trim()
        const match = raw.match(/-?\d+/)
        if (!match) {
            message.warning('请输入整数ID（-1 表示无）')
            return
        }
        const parsed = Number.parseInt(match[0], 10)
        if (!Number.isFinite(parsed) || parsed < -1) {
            message.warning('贴图动画ID无效，请输入 -1 或非负整数')
            return
        }
        updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TVertexAnimId: parsed === -1 ? null : parsed }, true)
        setIsTextureAnimIdEditorOpen(false)
    }

    const handleKeyframeSave = (animVector: any) => {
        if (editingField && selectedMaterialIndex >= 0 && selectedLayerIndex >= 0) {
            updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { [editingField]: animVector })
        }
        setIsKeyframeEditorOpen(false)
    }

    const handleAnimToggle = (field: string, checked: boolean, vectorSize: number = 1) => {
        if (selectedMaterialIndex < 0 || selectedLayerIndex < 0) return
        const layer = localMaterials[selectedMaterialIndex].Layers[selectedLayerIndex]

        if (checked) {
            const currentVal = layer[field]
            // For TextureID, default to 0 (first texture); for Alpha, default to 1
            const defaultVal = field === 'TextureID' ? 0 : 1
            const initialVal = typeof currentVal === 'number' ? currentVal : defaultVal
            const animVector = {
                Keys: [{ Frame: 0, Vector: vectorSize === 1 ? [initialVal] : new Array(vectorSize).fill(0) }],
                LineType: 0,
                GlobalSeqId: null
            }
            updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { [field]: animVector })
        } else {
            const currentVal = layer[field]
            // For TextureID, default to 0; for Alpha, default to 1
            let staticVal = field === 'TextureID' ? 0 : 1
            if (currentVal && currentVal.Keys && currentVal.Keys.length > 0) {
                staticVal = currentVal.Keys[0].Vector[0]
            }
            updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { [field]: staticVal })
        }
    }

    const selectedMaterial = selectedMaterialIndex >= 0 ? localMaterials[selectedMaterialIndex] : null
    const selectedLayer = selectedMaterial && selectedLayerIndex >= 0 && selectedMaterial.Layers ? selectedMaterial.Layers[selectedLayerIndex] : null

    const filterModeOptions = [
        { value: 0, label: 'None' },
        { value: 1, label: 'Transparent' },
        { value: 2, label: 'Blend' },
        { value: 3, label: 'Additive' },
        { value: 4, label: 'Add Alpha' },
        { value: 5, label: 'Modulate' },
        { value: 6, label: 'Modulate 2X' },
    ]

    const SUPPORTED_TEXTURE_EXTENSIONS = new Set(['.blp', '.tga'])

    const isSupportedTextureFile = (path: string): boolean => {
        const lower = path.toLowerCase()
        for (const ext of SUPPORTED_TEXTURE_EXTENSIONS) {
            if (lower.endsWith(ext)) return true
        }
        return false
    }

    const normalizeTexturePathKey = (path: string): string => path.replace(/\//g, '\\').toLowerCase()

    const isAbsoluteWindowsPath = (path: string): boolean => /^[a-zA-Z]:\\/.test(path) || path.startsWith('\\\\')

    const getModelDirectory = (): string | null => {
        if (!modelPath) return null
        const normalizedModelPath = modelPath.replace(/\//g, '\\')
        const modelDir = normalizedModelPath.split('\\').slice(0, -1).join('\\')
        return modelDir || null
    }

    const getFileName = (path: string): string => path.replace(/\//g, '\\').split('\\').pop() || path

    const splitFileName = (fileName: string): { stem: string; ext: string } => {
        const dot = fileName.lastIndexOf('.')
        if (dot <= 0) return { stem: fileName, ext: '' }
        return { stem: fileName.slice(0, dot), ext: fileName.slice(dot) }
    }

    const tryParseFileUriToPath = (uri: string): string | null => {
        if (!uri || !uri.toLowerCase().startsWith('file://')) return null
        try {
            const decoded = decodeURIComponent(uri.replace(/^file:\/\//i, ''))
            if (/^\/[a-zA-Z]:\//.test(decoded)) {
                return decoded.slice(1).replace(/\//g, '\\')
            }
            return decoded.replace(/\//g, '\\')
        } catch {
            return null
        }
    }

    const getExternalTexturePathsFromDrop = (dataTransfer: DataTransfer): string[] => {
        const result: string[] = []
        const seen = new Set<string>()

        const pushIfSupported = (raw: string | null | undefined) => {
            if (!raw) return
            const trimmed = raw.trim()
            if (!trimmed) return
            const parsedUriPath = tryParseFileUriToPath(trimmed)
            const finalPath = parsedUriPath || trimmed
            if (!isSupportedTextureFile(finalPath)) return

            const key = normalizeTexturePathKey(finalPath)
            if (seen.has(key)) return
            seen.add(key)
            result.push(finalPath)
        }

        const files = Array.from(dataTransfer.files || [])
        for (const file of files) {
            const filePath = (file as any).path as string | undefined
            if (filePath) {
                pushIfSupported(filePath)
            } else {
                pushIfSupported(file.name)
            }
        }

        const uriList = dataTransfer.getData('text/uri-list')
        if (uriList) {
            uriList
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#'))
                .forEach((line) => pushIfSupported(line))
        }

        const textPlain = dataTransfer.getData('text/plain')
        if (textPlain) {
            textPlain
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .forEach((line) => pushIfSupported(line))
        }

        return result
    }

    const ensureTextureInModelDir = async (rawPath: string): Promise<{ relativePath: string; copied: boolean } | null> => {
        const modelDir = getModelDirectory()
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

        // Already under model directory: keep a relative path.
        if (sourceLower.startsWith(modelDirPrefix)) {
            return {
                relativePath: sourcePath.slice(modelDir.length + 1),
                copied: false
            }
        }

        const { copyFile, exists, size } = await import('@tauri-apps/plugin-fs')
        const originalFileName = getFileName(sourcePath)
        let targetFileName = originalFileName
        let targetAbsPath = `${modelDir}\\${targetFileName}`
        const sourceSize = await size(sourcePath).catch(() => null)

        // Same-name file exists: reuse it when file size matches.
        if (await exists(targetAbsPath)) {
            const targetSize = await size(targetAbsPath).catch(() => null)
            if (sourceSize !== null && targetSize !== null && sourceSize === targetSize) {
                return {
                    relativePath: targetFileName,
                    copied: false
                }
            }

            // Name collision with different size: search suffixed names.
            const { stem, ext } = splitFileName(originalFileName)
            let index = 1
            while (await exists(`${modelDir}\\${stem}_${index}${ext}`)) {
                const candidateFileName = `${stem}_${index}${ext}`
                const candidateAbsPath = `${modelDir}\\${candidateFileName}`
                const candidateSize = await size(candidateAbsPath).catch(() => null)
                if (sourceSize !== null && candidateSize !== null && sourceSize === candidateSize) {
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

        await copyFile(sourcePath, targetAbsPath)
        return {
            relativePath: targetFileName,
            copied: true
        }
    }

    const importExternalTexturesAndGetFirstId = async (externalPaths: string[]): Promise<number | null> => {
        if (externalPaths.length === 0) return null

        const currentTextures = Array.isArray(modelData?.Textures) ? [...modelData.Textures] : []
        const pathToIndex = new Map<string, number>()
        currentTextures.forEach((tex: any, index: number) => {
            const path = tex?.Image
            if (typeof path === 'string' && path.length > 0) {
                pathToIndex.set(normalizeTexturePathKey(path), index)
            }
        })

        let firstTextureId: number | null = null
        let addedCount = 0
        let copiedCount = 0

        for (const rawPath of externalPaths) {
            let imported: { relativePath: string; copied: boolean } | null = null
            try {
                imported = await ensureTextureInModelDir(rawPath)
            } catch (error) {
                console.error('[MaterialEditorModal] Failed to import external texture:', rawPath, error)
                continue
            }
            if (!imported) continue

            const modelTexturePath = imported.relativePath
            const key = normalizeTexturePathKey(modelTexturePath)
            let textureId = pathToIndex.get(key)
            if (textureId === undefined) {
                textureId = currentTextures.length
                currentTextures.push({
                    Image: modelTexturePath,
                    ReplaceableId: 0,
                    Flags: 0
                })
                pathToIndex.set(key, textureId)
                addedCount++
            }
            if (imported.copied) copiedCount++

            if (firstTextureId === null) {
                firstTextureId = textureId
            }
        }

        if (firstTextureId === null) return null

        if (addedCount > 0) {
            didRealtimeTexturePreviewRef.current = true
            setTextures(currentTextures)
            if (copiedCount > 0) {
                message.success(`已复制 ${copiedCount} 个贴图到模型目录并应用`)
            } else {
                message.success(`已导入 ${addedCount} 个贴图并应用到当前图层`)
            }
        } else {
            message.success('已应用已存在的贴图到当前图层')
        }

        return firstTextureId
    }

    const isPointInsideElement = (x: number, y: number, element: HTMLElement | null): boolean => {
        if (!element) return false
        const rect = element.getBoundingClientRect()
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    useEffect(() => {
        if (!visible) return

        const onExternalFileDrop = async (evt: Event) => {
            if (selectedMaterialIndex < 0 || selectedLayerIndex < 0) return

            const customEvent = evt as CustomEvent<{ paths?: string[]; position?: { x: number; y: number } | null }>
            const paths = Array.isArray(customEvent.detail?.paths) ? customEvent.detail.paths : []
            if (paths.length === 0) return

            const supportedPaths = paths.filter(isSupportedTextureFile)
            if (supportedPaths.length === 0) return

            const position = customEvent.detail?.position
            if (position && !isPointInsideElement(position.x, position.y, textureDropZoneRef.current)) {
                return
            }

            try {
                const nextTextureId = await importExternalTexturesAndGetFirstId(supportedPaths)
                if (nextTextureId === null) return
                updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TextureID: nextTextureId }, true)
            } catch (error) {
                console.error('[MaterialEditorModal] External file drop handling failed:', error)
                message.error('贴图导入失败')
            }
        }

        window.addEventListener('war3-external-file-drop', onExternalFileDrop as EventListener)
        return () => window.removeEventListener('war3-external-file-drop', onExternalFileDrop as EventListener)
    }, [visible, selectedMaterialIndex, selectedLayerIndex, modelData, modelPath, localMaterials])

    const textureCount = (modelData as any)?.Textures?.length || 0
    const textureOptions = Array.from({ length: textureCount }, (_, i) => {
        const path = (modelData as any)?.Textures?.[i]?.Image || '';
        // Extract just the filename for cleaner display
        const filename = path.replace(/\\/g, '/').split('/').pop() || path;

        return {
            value: i,
            label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', marginRight: 8 }} title={path}>
                        {filename}
                    </span>
                    <span style={{ fontWeight: 'bold', minWidth: 24, textAlign: 'right', color: '#888', fontSize: '0.9em' }}>#{i}</span>
                </div>
            )
        };
    })
    if (textureOptions.length === 0) {
        textureOptions.push({ value: -1, label: <span>No Textures</span> })
    }

    const handleTextureDropOver = (e: React.DragEvent<HTMLDivElement>) => {
        const draggedIndex = getDraggedTextureIndex(e.dataTransfer)
        const externalTexturePaths = getExternalTexturePathsFromDrop(e.dataTransfer)
        const hasFilePayload = Array.from(e.dataTransfer.types || []).includes('Files')
        if (draggedIndex === null && externalTexturePaths.length === 0 && !hasFilePayload) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setIsTextureDropActive(true)
    }

    const handleTextureDropLeave = () => {
        setIsTextureDropActive(false)
    }

    const handleTextureDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        setIsTextureDropActive(false)
        if (selectedMaterialIndex < 0 || selectedLayerIndex < 0) return
        e.preventDefault()

        const draggedIndex = getDraggedTextureIndex(e.dataTransfer)
        if (draggedIndex !== null) {
            if (draggedIndex >= textureCount) {
                message.warning(`拖放的贴图索引 ${draggedIndex} 超出范围`)
                return
            }
            updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TextureID: draggedIndex }, true)
            return
        }

        const externalTexturePaths = getExternalTexturePathsFromDrop(e.dataTransfer)
        if (externalTexturePaths.length === 0) return

        try {
            const nextTextureId = await importExternalTexturesAndGetFirstId(externalTexturePaths)
            if (nextTextureId === null) return
            updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TextureID: nextTextureId }, true)
        } catch (error) {
            console.error('[MaterialEditorModal] Texture drop import failed:', error)
            message.error('贴图导入失败')
        }
    }

    const renderEditorContent = (contentHeight: string | number = '600px') => (
        <div style={{ display: 'flex', height: contentHeight, border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
            <div style={{ width: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a' }}>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        block
                        size="small"
                        onClick={handleAddMaterial}
                        style={{ fontSize: '12px' }}
                    >
                        添加材质
                    </Button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', padding: '4px' }}>
                    {localMaterials.map((_item, index) => (
                        <div
                            key={index}
                            onClick={() => {
                                setSelectedMaterialIndex(index)
                                const layers = localMaterials[index]?.Layers
                                setSelectedLayerIndex(Array.isArray(layers) && layers.length > 0 ? 0 : -1)
                            }}
                            style={{
                                cursor: 'pointer',
                                padding: '4px 4px',
                                backgroundColor: selectedMaterialIndex === index ? '#1677ff' : '#2a2a2a',
                                color: selectedMaterialIndex === index ? '#fff' : '#b0b0b0',
                                border: '1px solid #3a3a3a',
                                borderRadius: '2px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                minHeight: '24px',
                                fontSize: '11px'
                            }}
                        >
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>M{index}</span>
                            <DeleteOutlined
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteMaterial(index)
                                }}
                                style={{ color: selectedMaterialIndex === index ? '#fff' : '#ff4d4f', fontSize: '10px' }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#252525', overflow: 'hidden' }}>
                {selectedMaterial ? (
                    <div style={{ display: 'flex', height: '100%' }}>
                        {/* Layer List */}
                        <div style={{ width: '150px', borderRight: '1px solid #4a4a4a', display: 'flex', flexDirection: 'column', backgroundColor: '#2a2a2a' }}>
                            <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a', backgroundColor: '#333' }}>
                                <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    block
                                    size="small"
                                    onClick={handleAddLayer}
                                    style={{ fontSize: '12px' }}
                                >
                                    添加图层
                                </Button>
                            </div>
                            <div ref={layerListRef} style={{ flex: 1, overflowY: 'auto' }}>
                                {selectedMaterial.Layers.map((layer: any, lIdx: number) => (
                                    <div
                                        key={lIdx}
                                        data-layer-index={lIdx}
                                        onMouseDown={(e) => handleLayerMouseDown(e, lIdx)}
                                        onClick={() => setSelectedLayerIndex(lIdx)}
                                        style={{
                                            padding: '4px 8px',
                                            cursor: 'pointer',
                                            backgroundColor: selectedLayerIndex === lIdx ? '#1677ff' : (dragLayerIndex === lIdx ? '#444' : (dragOverLayerIndex === lIdx ? '#555' : 'transparent')),
                                            color: selectedLayerIndex === lIdx ? '#fff' : '#b0b0b0',
                                            borderBottom: '1px solid #3a3a3a',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            minHeight: '32px',
                                            opacity: dragLayerIndex === lIdx ? 0.5 : 1
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                            <span style={{ fontSize: '11px', opacity: 0.5 }}>{lIdx}:</span>
                                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '12px' }}>
                                                T:{typeof layer.TextureID === 'number' ? layer.TextureID : 'Anim'} | {filterModeOptions.find(o => o.value === layer.FilterMode)?.label || 'None'}
                                            </span>
                                        </div>
                                        <DeleteOutlined
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                handleDeleteLayer(lIdx)
                                            }}
                                            style={{ color: selectedLayerIndex === lIdx ? '#fff' : '#ff4d4f', fontSize: '11px' }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Layer Details */}
                        <div ref={textureDropZoneRef} style={{ flex: 1, padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}
                            onDragOver={handleTextureDropOver}
                            onDragLeave={handleTextureDropLeave}
                            onDrop={handleTextureDrop}>

                            {isTextureDropActive && (
                                <div style={{ position: 'absolute', inset: 8, border: '2px dashed #1677ff', borderRadius: 8, backgroundColor: 'rgba(22, 119, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none' }}>
                                    <span style={{ color: '#1677ff', fontWeight: 'bold' }}>拖放贴图到这里</span>
                                </div>
                            )}

                            <Card
                                title={<span style={{ color: '#b0b0b0', fontSize: '12px' }}>材质属性</span>}
                                size="small"
                                bordered={false}
                                style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                styles={{ header: { padding: '4px 8px', minHeight: '32px', borderBottom: '1px solid #4a4a4a' }, body: { padding: '8px' } }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <Text style={{ color: '#b0b0b0', fontSize: '12px' }}>优先级</Text>
                                        <InputNumber
                                            size="small"
                                            value={selectedMaterial.PriorityPlane || 0}
                                            onChange={(v) => updateLocalMaterial(selectedMaterialIndex, { PriorityPlane: v })}
                                            style={{ width: '70px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                        <Checkbox checked={selectedMaterial.ConstantColor} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { ConstantColor: e.target.checked })} style={{ color: '#e8e8e8', fontSize: '11px' }}>固定颜色</Checkbox>
                                        <Checkbox checked={selectedMaterial.SortPrimsFarZ} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { SortPrimsFarZ: e.target.checked })} style={{ color: '#e8e8e8', fontSize: '11px' }}>远Z排序</Checkbox>
                                        <Checkbox checked={selectedMaterial.FullResolution} onChange={(e) => updateLocalMaterial(selectedMaterialIndex, { FullResolution: e.target.checked })} style={{ color: '#e8e8e8', fontSize: '11px' }}>全分辨率</Checkbox>
                                    </div>
                                </div>
                            </Card>

                            {selectedLayer ? (
                                <>
                                    <Card
                                        title={<span style={{ color: '#e8e8e8', fontSize: '13px' }}>贴图与滤镜</span>}
                                        size="small"
                                        bordered={false}
                                        style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                        styles={{ header: { borderBottom: '1px solid #4a4a4a', padding: '4px 8px', minHeight: '32px' }, body: { padding: '8px' } }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Text style={{ minWidth: '70px', color: '#b0b0b0', fontSize: '12px' }}>贴图:</Text>
                                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <Select
                                                        size="small"
                                                        style={{ flex: 1 }}
                                                        value={typeof selectedLayer.TextureID === 'number' ? selectedLayer.TextureID : -2}
                                                        onChange={(v) => {
                                                            if (v === -2) handleAnimToggle('TextureID', true)
                                                            else updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TextureID: v }, true)
                                                        }}
                                                        popupClassName="dark-theme-select-dropdown"
                                                        options={[
                                                            ...textureOptions,
                                                            { value: -2, label: 'Animated Texture' }
                                                        ]}
                                                    />
                                                    {typeof selectedLayer.TextureID !== 'number' && (
                                                        <Button size="small" type="link" onClick={() => openKeyframeEditor('TextureID', 1)} style={{ padding: 0, height: 'auto' }}>编辑</Button>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <Text style={{ minWidth: '70px', color: '#b0b0b0', fontSize: '12px' }}>滤镜:</Text>
                                                <Select
                                                    size="small"
                                                    style={{ flex: 1 }}
                                                    value={selectedLayer.FilterMode}
                                                    onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { FilterMode: v }, true)}
                                                    popupClassName="dark-theme-select-dropdown"
                                                    options={filterModeOptions}
                                                />
                                            </div>
                                        </div>
                                    </Card>

                                    <Card
                                        title={<span style={{ color: '#e8e8e8', fontSize: '13px' }}>透明度与动画</span>}
                                        size="small"
                                        bordered={false}
                                        style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                        styles={{ header: { borderBottom: '1px solid #4a4a4a', padding: '4px 8px', minHeight: '32px' }, body: { padding: '8px' } }}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <Checkbox
                                                    checked={typeof selectedLayer.Alpha !== 'number'}
                                                    onChange={(e) => handleAnimToggle('Alpha', e.target.checked)}
                                                    style={{ color: '#e8e8e8', fontSize: '12px' }}
                                                >
                                                    动态透明度
                                                </Checkbox>
                                                <InputNumber
                                                    size="small"
                                                    value={typeof selectedLayer.Alpha === 'number' ? selectedLayer.Alpha : undefined}
                                                    onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Alpha: v ?? 1 }, true)}
                                                    step={0.1}
                                                    min={0}
                                                    max={1}
                                                    disabled={typeof selectedLayer.Alpha !== 'number'}
                                                    style={{ width: '80px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '12px' }}
                                                />
                                                {typeof selectedLayer.Alpha !== 'number' && (
                                                    <Button
                                                        type="link"
                                                        size="small"
                                                        onClick={() => openKeyframeEditor('Alpha', 1)}
                                                        style={{ color: '#1677ff', padding: 0, height: 'auto', fontSize: '12px' }}
                                                    >
                                                        编辑关键帧
                                                    </Button>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <Checkbox
                                                    checked={selectedLayer.TVertexAnimId !== null && selectedLayer.TVertexAnimId !== undefined}
                                                    onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TVertexAnimId: e.target.checked ? 0 : null }, true)}
                                                    style={{ color: '#e8e8e8', fontSize: '12px' }}
                                                >
                                                    贴图动画ID
                                                </Checkbox>
                                                <InputNumber
                                                    ref={textureAnimIdInputRef}
                                                    size="small"
                                                    value={selectedLayer.TVertexAnimId === null ? -1 : selectedLayer.TVertexAnimId}
                                                    onChange={(v) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TVertexAnimId: v === -1 ? null : v }, true)}
                                                    disabled={selectedLayer.TVertexAnimId === null || selectedLayer.TVertexAnimId === undefined}
                                                    style={{ width: '50px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8', fontSize: '11px' }}
                                                />
                                                <Button
                                                    type="link"
                                                    size="small"
                                                    disabled={selectedLayer.TVertexAnimId === null || selectedLayer.TVertexAnimId === undefined}
                                                    onClick={openTextureAnimIdTextEditor}
                                                    style={{ color: '#1677ff', padding: 0, height: 'auto', fontSize: '12px' }}
                                                >
                                                    编辑
                                                </Button>
                                            </div>
                                        </div>
                                    </Card>

                                    <Card
                                        title={<span style={{ color: '#e8e8e8', fontSize: '13px' }}>着色标志</span>}
                                        size="small"
                                        bordered={false}
                                        style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                        styles={{ header: { borderBottom: '1px solid #4a4a4a', padding: '4px 12px' }, body: { padding: '12px' } }}
                                    >
                                        <Row gutter={[8, 8]}>
                                            <Col span={12}><Checkbox checked={selectedLayer.Unshaded} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Unshaded: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '11px' }}>无阴影</Checkbox></Col>
                                            <Col span={12}><Checkbox checked={selectedLayer.SphereEnvMap} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { SphereEnvMap: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '11px' }}>球面环境映射</Checkbox></Col>
                                            <Col span={12}><Checkbox checked={selectedLayer.TwoSided} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { TwoSided: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '11px' }}>双面</Checkbox></Col>
                                            <Col span={12}><Checkbox checked={selectedLayer.Unfogged} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { Unfogged: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '11px' }}>无雾</Checkbox></Col>
                                            <Col span={12}><Checkbox checked={selectedLayer.NoDepthTest} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { NoDepthTest: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '11px' }}>禁用深度测试</Checkbox></Col>
                                            <Col span={12}><Checkbox checked={selectedLayer.NoDepthSet} onChange={(e) => updateLocalLayer(selectedMaterialIndex, selectedLayerIndex, { NoDepthSet: e.target.checked }, true)} style={{ color: '#e8e8e8', fontSize: '11px' }}>禁用深度写入</Checkbox></Col>
                                        </Row>
                                    </Card>
                                </>
                            ) : (
                                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '120px', color: '#888' }}>
                                    <Text style={{ color: '#888', fontSize: '13px' }}>请从图层列表中选择一个图层</Text>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888', fontSize: '13px' }}>
                        请从左侧列表中选择一个材质
                    </div>
                )}
            </div>
        </div>
    )

    const keyframeEditorNode = isKeyframeEditorOpen && editingField ? (
        <KeyframeEditor
            visible={isKeyframeEditorOpen}
            onCancel={() => setIsKeyframeEditorOpen(false)}
            onOk={handleKeyframeSave}
            initialData={selectedLayer ? selectedLayer[editingField] : null}
            title={`编辑 ${editingField}`}
            vectorSize={editingVectorSize}
            globalSequences={(modelData as any)?.GlobalSequences || []}
            fieldName={editingField || ''}
        />
    ) : null

    const textureAnimIdEditorNode = (
        <DraggableModal
            title="编辑贴图动画ID"
            open={isTextureAnimIdEditorOpen}
            onCancel={() => setIsTextureAnimIdEditorOpen(false)}
            onOk={handleTextureAnimIdTextSave}
            okText="应用"
            cancelText="取消"
            width={380}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: 12, backgroundColor: '#252525' } }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Text style={{ color: '#b0b0b0', fontSize: '12px' }}>请输入贴图动画ID文本（-1表示无）</Text>
                <Input.TextArea
                    value={textureAnimIdEditorText}
                    onChange={(e) => setTextureAnimIdEditorText(e.target.value)}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    style={{ fontFamily: 'Consolas, monospace', backgroundColor: '#1f1f1f', color: '#e8e8e8', borderColor: '#4a4a4a' }}
                />
            </div>
        </DraggableModal>
    )

    if (asWindow) {
        if (!visible) return null
        return (
            <div style={{ height: '100vh', padding: 8, backgroundColor: '#1f1f1f', overflow: 'hidden' }}>
                {renderEditorContent('calc(100vh - 16px)')}
                {keyframeEditorNode}
                {textureAnimIdEditorNode}
            </div>
        )
    }

    return (
        <DraggableModal
            title="材质编辑器"
            open={visible}
            onOk={handleOk}
            onCancel={handleCancel}
            okText="保存"
            cancelText="取消"
            width={850}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: 0, backgroundColor: '#252525' } }}
        >
            {renderEditorContent()}
            {keyframeEditorNode}
            {textureAnimIdEditorNode}
        </DraggableModal>
    )
}

export default MaterialEditorModal
