import React, { useState, useEffect } from 'react'
import { List, Button, Input, Checkbox, InputNumber, Card, Typography, message, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { DraggableModal } from '../DraggableModal';
import { PlusOutlined, DeleteOutlined, FolderOpenOutlined, DatabaseOutlined } from '@ant-design/icons'
import { useSelectionStore } from '../../store/selectionStore'

import { useModelStore } from '../../store/modelStore'
import { decodeBLP, getBLPImageData } from 'war3-model'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

const { Text } = Typography

interface TextureEditorModalProps {
    visible: boolean
    onClose: () => void
    modelPath?: string
}

const TextureEditorModal: React.FC<TextureEditorModalProps> = ({ visible, onClose, modelPath: propModelPath }) => {
    const { modelData, setTextures, modelPath: storeModelPath } = useModelStore()
    const [localTextures, setLocalTextures] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [isLoadingPreview, setIsLoadingPreview] = useState(false)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [previewSource, setPreviewSource] = useState<string | null>(null) // 'mpq' | 'file' | null

    // Use prop modelPath if provided, otherwise fall back to store
    const modelPath = propModelPath || storeModelPath

    // Initialize local state
    useEffect(() => {
        if (visible && modelData && modelData.Textures) {
            setLocalTextures(JSON.parse(JSON.stringify(modelData.Textures)))

            // If no selection yet, try to select based on picked geoset
            const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
            let initialSelection = -1

            if (initialPickedIndex !== null && modelData.Geosets && modelData.Geosets[initialPickedIndex]) {
                const materialId = modelData.Geosets[initialPickedIndex].MaterialID
                if (materialId !== undefined && modelData.Materials && modelData.Materials[materialId]) {
                    const material = modelData.Materials[materialId]
                    if (material.Layers && material.Layers.length > 0) {
                        const textureId = material.Layers[0].TextureID
                        if (typeof textureId === 'number' && textureId >= 0 && textureId < modelData.Textures.length) {
                            initialSelection = textureId
                            console.log('[TextureEditor] Initial auto-selected texture', textureId, 'for geoset', initialPickedIndex)
                        }
                    }
                }
            }

            if (initialSelection !== -1) {
                setSelectedIndex(initialSelection)
            } else {
                setSelectedIndex(modelData.Textures.length > 0 ? 0 : -1)
            }
        } else if (visible) {
            setLocalTextures([])
            setSelectedIndex(-1)
        }
    }, [visible, modelData])

    // Subscribe to Ctrl+Click geoset picking - auto-select texture
    useEffect(() => {
        if (!visible || !modelData) return

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
                                console.log('[TextureEditor] Auto-selected texture', textureId, 'for geoset', pickedGeosetIndex)
                            }
                        }
                    }
                }
            }
        })
        return unsubscribe
    }, [visible, modelData, localTextures.length])

    // Helper function to decode BLP and create canvas data URL
    const decodeBLPToDataUrl = (buffer: ArrayBuffer): string | null => {
        try {
            const blp = decodeBLP(buffer)
            const imageData = getBLPImageData(blp, 0)
            if (imageData) {
                const canvas = document.createElement('canvas')
                canvas.width = imageData.width
                canvas.height = imageData.height
                const ctx = canvas.getContext('2d')
                if (ctx) {
                    const realImageData = new ImageData(
                        new Uint8ClampedArray(imageData.data),
                        imageData.width,
                        imageData.height
                    )
                    ctx.putImageData(realImageData, 0, 0)
                    return canvas.toDataURL()
                }
            }
        } catch (e) {
            console.error('[TextureEditor] BLP decode error:', e)
        }
        return null
    }

    // Load preview when selection changes
    useEffect(() => {
        const loadTexture = async () => {
            if (selectedIndex < 0 || !localTextures[selectedIndex]) {
                setPreviewUrl(null)
                setPreviewError(null)
                setPreviewSource(null)
                return
            }

            const texture = localTextures[selectedIndex]
            if (!texture.Image) {
                setPreviewUrl(null)
                setPreviewError('无路径')
                setPreviewSource(null)
                return
            }

            const imagePath = texture.Image
            const isBlp = imagePath.toLowerCase().endsWith('.blp')

            setIsLoadingPreview(true)
            setPreviewError(null)
            setPreviewUrl(null)
            setPreviewSource(null)

            let loaded = false

            // Strategy 1: Try MPQ first for standard Warcraft 3 paths
            const isMPQPath = /^(Textures|UI|ReplaceableTextures|Units|Buildings|Doodads|Environment)[\\\/]/i.test(imagePath)

            if (isMPQPath && isBlp) {
                try {
                    console.log('[TextureEditor] Trying MPQ for:', imagePath)
                    const mpqData = await invoke<number[]>('read_mpq_file', { path: imagePath })

                    if (mpqData && mpqData.length > 0) {
                        const mpqBuffer = new Uint8Array(mpqData).buffer
                        const dataUrl = decodeBLPToDataUrl(mpqBuffer)
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
            }

            // Strategy 2: Try local file system if MPQ didn't work
            if (!loaded && isBlp) {
                try {
                    // Normalize path separators
                    let normalizedPath = imagePath.replace(/\//g, '\\')

                    // Resolve relative path based on model location
                    let fullPath = normalizedPath
                    const isAbsolute = /^[a-zA-Z]:/.test(normalizedPath) || normalizedPath.startsWith('\\\\')

                    if (!isAbsolute && modelPath) {
                        const modelDir = modelPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
                        fullPath = `${modelDir}/${normalizedPath.replace(/\\/g, '/')}`
                        fullPath = fullPath.replace(/\//g, '\\')
                    }

                    console.log('[TextureEditor] Trying file system for:', fullPath)

                    const buffer = await readFile(fullPath)
                    if (buffer) {
                        const dataUrl = decodeBLPToDataUrl(buffer.buffer)
                        if (dataUrl) {
                            setPreviewUrl(dataUrl)
                            setPreviewSource('本地文件')
                            loaded = true
                            console.log('[TextureEditor] Loaded from file system successfully')
                        } else {
                            setPreviewError('无法解码 BLP 图像数据')
                        }
                    } else {
                        setPreviewError('无法读取文件')
                    }
                } catch (e: any) {
                    console.error("[TextureEditor] File system load failed:", e)
                    if (!loaded) {
                        setPreviewError(`加载失败: ${e.message || '未知错误'}`)
                    }
                }
            }

            // Non-BLP texture (PNG, TGA, etc.)
            if (!loaded && !isBlp) {
                let fullPath = imagePath
                const isAbsolute = /^[a-zA-Z]:/.test(imagePath)
                if (!isAbsolute && modelPath) {
                    const modelDir = modelPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
                    fullPath = `${modelDir}/${imagePath.replace(/\\/g, '/')}`
                }
                setPreviewUrl(`file://${fullPath}`)
                setPreviewSource('本地文件')
            }

            setIsLoadingPreview(false)
        }
        loadTexture()
    }, [selectedIndex, localTextures, modelPath])

    const handleOk = () => {
        setTextures(localTextures)
        message.success('纹理已保存')
        onClose()
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

    return (
        <DraggableModal
            title="纹理管理器"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            width={900}
            okText="确定"
            cancelText="取消"
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{
                content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                body: { backgroundColor: '#2d2d2d' },
                footer: { borderTop: '1px solid #4a4a4a' }
            }}
        >
            <div style={{ display: 'flex', height: '500px', border: '1px solid #4a4a4a', backgroundColor: '#252525' }}>
                {/* List (Left) */}
                <div style={{ width: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
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

                                                    newTextures.push({ Image: relativePath, ReplaceableId: 0, Flags: 0 })
                                                    addedCount++
                                                }

                                                if (newTextures.length > 0) {
                                                    const updatedTextures = [...localTextures, ...newTextures]
                                                    setLocalTextures(updatedTextures)
                                                    setSelectedIndex(updatedTextures.length - 1) // Select the last added texture

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
                                            const newTexture = { Image: 'Textures\\white.blp', ReplaceableId: 0, Flags: 0 }
                                            setLocalTextures([...localTextures, newTexture])
                                            setSelectedIndex(localTextures.length)
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
                                style={{
                                    cursor: 'pointer',
                                    padding: '8px 12px',
                                    backgroundColor: selectedIndex === index ? '#5a9cff' : 'transparent',
                                    color: selectedIndex === index ? '#fff' : '#b0b0b0',
                                    transition: 'background 0.2s',
                                    borderBottom: '1px solid #3a3a3a'
                                }}
                                className="hover:bg-[#454545]"
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                                        <span style={{ marginRight: '8px', opacity: 0.7 }}>{index}:</span>
                                        {item.Image || 'No Path'}
                                    </div>
                                    <DeleteOutlined
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            const newTextures = localTextures.filter((_, i) => i !== index)
                                            setLocalTextures(newTextures)
                                            if (selectedIndex === index) setSelectedIndex(-1)
                                            else if (selectedIndex > index) setSelectedIndex(selectedIndex - 1)
                                        }}
                                        style={{ color: '#ff4d4f' }}
                                    />
                                </div>
                            </List.Item>
                        )}
                    />
                </div>

                {/* Details (Right) */}
                <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#252525', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {selectedTexture ? (
                        <>
                            {/* Preview */}
                            <div style={{ height: '200px', border: '1px solid #4a4a4a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f1f1f', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                                {isLoadingPreview ? (
                                    <div style={{ color: '#5a9cff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                                        <div className="ant-spin ant-spin-spinning" style={{ fontSize: 24 }}>⏳</div>
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
                                        <div>⚠️ {previewError}</div>
                                        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{selectedTexture?.Image}</div>
                                    </div>
                                ) : (
                                    <span style={{ color: '#666' }}>无预览</span>
                                )}
                            </div>

                            {/* Settings */}
                            <Card
                                title={<span style={{ color: '#b0b0b0' }}>纹理设置</span>}
                                size="small"
                                bordered={false}
                                style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                headStyle={{ borderBottom: '1px solid #4a4a4a' }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>路径:</Text>
                                        <Input
                                            value={selectedTexture.Image}
                                            onChange={(e) => updateLocalTexture(selectedIndex, { Image: e.target.value })}
                                            style={{ backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                    </div>
                                    <div>
                                        <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0' }}>可替换 ID:</Text>
                                        <InputNumber
                                            value={selectedTexture.ReplaceableId}
                                            onChange={(v) => updateLocalTexture(selectedIndex, { ReplaceableId: v })}
                                            style={{ width: '100%', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                        />
                                        <Text style={{ fontSize: '12px', color: '#808080' }}>0: 无, 1: 队伍颜色, 2: 队伍光晕, 31+: 树木</Text>
                                    </div>
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <Checkbox checked={isFlagSet(1)} onChange={(e) => handleFlagChange(1, e.target.checked)} style={{ color: '#e8e8e8' }}>
                                            笼罩宽度 (Wrap Width)
                                        </Checkbox>
                                        <Checkbox checked={isFlagSet(2)} onChange={(e) => handleFlagChange(2, e.target.checked)} style={{ color: '#e8e8e8' }}>
                                            笼罩高度 (Wrap Height)
                                        </Checkbox>
                                    </div>
                                </div>
                            </Card>
                        </>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                            请从左侧列表选择一个纹理
                        </div>
                    )}
                </div>
            </div>
        </DraggableModal>
    )
}

export default TextureEditorModal
