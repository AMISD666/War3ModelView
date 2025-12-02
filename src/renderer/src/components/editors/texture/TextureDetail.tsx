import React, { useState, useEffect } from 'react'
import { Input, Checkbox, InputNumber, Button } from 'antd'
import { decodeBLP, getBLPImageData } from 'war3-model'
import { readFile } from '@tauri-apps/plugin-fs'

interface TextureDetailProps {
    texture: any
    modelPath?: string
    onUpdate: (updatedTexture: any) => void
    onClose: () => void
}

const TextureDetail: React.FC<TextureDetailProps> = ({ texture, modelPath, onUpdate, onClose }) => {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)

    useEffect(() => {
        const loadTexture = async () => {
            if (!texture.Image) {
                setPreviewUrl(null)
                return
            }

            const isBlp = texture.Image.toLowerCase().endsWith('.blp')

            if (isBlp) {
                try {
                    let fullPath = texture.Image
                    // Resolve relative path if modelPath is available
                    if (modelPath && !fullPath.match(/^[a-zA-Z]:/) && !fullPath.startsWith('/')) {
                        const modelDir = modelPath.substring(0, modelPath.lastIndexOf('\\'))
                        fullPath = `${modelDir}\\${fullPath}`
                    }

                    console.log('[TextureDetail] Loading BLP from:', fullPath)

                    // Read file using Tauri fs plugin
                    const buffer = await readFile(fullPath)
                    console.log('[TextureDetail] File read, size:', buffer.byteLength)

                    if (buffer) {
                        // Decode BLP
                        const blp = decodeBLP(buffer.buffer)
                        console.log('[TextureDetail] BLP decoded:', blp.width, 'x', blp.height)
                        const imageData = getBLPImageData(blp, 0) // 0 for mipLevel 0

                        if (imageData) {
                            // Draw to canvas to get Data URL
                            const canvas = document.createElement('canvas')
                            canvas.width = imageData.width
                            canvas.height = imageData.height
                            const ctx = canvas.getContext('2d')
                            if (ctx) {
                                // Create actual ImageData to avoid type mismatches
                                const realImageData = new ImageData(
                                    new Uint8ClampedArray(imageData.data),
                                    imageData.width,
                                    imageData.height
                                )
                                ctx.putImageData(realImageData, 0, 0)
                                const dataUrl = canvas.toDataURL()
                                console.log('[TextureDetail] Canvas created, data URL length:', dataUrl.length)
                                setPreviewUrl(dataUrl)
                            }
                        }
                    }
                } catch (e) {
                    console.error("[TextureDetail] Failed to load BLP:", e)
                    setPreviewUrl(null)
                }
            } else {
                // Try standard image loading
                setPreviewUrl(`file://${texture.Image}`)
            }
        }

        loadTexture()
    }, [texture.Image, modelPath])

    const handleChange = (field: string, value: any) => {
        onUpdate({ ...texture, [field]: value })
    }

    const handleFlagChange = (flag: number, checked: boolean) => {
        let newFlags = texture.Flags || 0
        if (checked) {
            newFlags |= flag
        } else {
            newFlags &= ~flag
        }
        handleChange('Flags', newFlags)
    }

    const isFlagSet = (flag: number) => {
        return ((texture.Flags || 0) & flag) !== 0
    }

    return (
        <div style={{ display: 'flex', height: '400px', gap: '20px' }}>
            {/* Left: Image Preview */}
            <div style={{ flex: 1, border: '1px solid #444', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#222', overflow: 'hidden' }}>
                {previewUrl ? (
                    <img
                        src={previewUrl}
                        alt="Texture Preview"
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        onError={(e) => {
                            // Fallback if loading fails even with previewUrl
                            const img = e.target as HTMLImageElement;
                            img.alt = 'Image Not Found'
                            img.style.display = 'none'
                        }}
                    />
                ) : (
                    <div style={{ textAlign: 'center', color: '#666' }}>
                        <div>No Image</div>
                        <div style={{ fontSize: 12 }}>{texture.Image}</div>
                    </div>
                )}
            </div>

            {/* Right: Settings */}
            <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ border: '1px solid #ccc', padding: '10px', position: 'relative', marginTop: '10px' }}>
                    <span style={{ position: 'absolute', top: '-10px', left: '10px', backgroundColor: '#1f1f1f', padding: '0 5px', color: '#ccc' }}>文件名</span>
                    <Input
                        value={texture.Image}
                        onChange={(e) => handleChange('Image', e.target.value)}
                        style={{ marginTop: '5px' }}
                    />
                </div>

                <div style={{ border: '1px solid #ccc', padding: '10px', position: 'relative', marginTop: '10px' }}>
                    <span style={{ position: 'absolute', top: '-10px', left: '10px', backgroundColor: '#1f1f1f', padding: '0 5px', color: '#ccc' }}>贴图材质</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '5px' }}>
                        <Checkbox
                            checked={isFlagSet(1)}
                            onChange={(e) => handleFlagChange(1, e.target.checked)}
                        >
                            笼罩宽度 (Wrap Width)
                        </Checkbox>
                        <Checkbox
                            checked={isFlagSet(2)}
                            onChange={(e) => handleFlagChange(2, e.target.checked)}
                        >
                            笼罩高度 (Wrap Height)
                        </Checkbox>
                    </div>
                </div>

                <div style={{ border: '1px solid #ccc', padding: '10px', position: 'relative', marginTop: '10px', flex: 1 }}>
                    <span style={{ position: 'absolute', top: '-10px', left: '10px', backgroundColor: '#1f1f1f', padding: '0 5px', color: '#ccc' }}>可替换 ID</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                        <span>ID:</span>
                        <InputNumber
                            value={texture.ReplaceableId}
                            onChange={(v) => handleChange('ReplaceableId', v)}
                            style={{ flex: 1 }}
                        />
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '12px', color: '#aaa', overflowY: 'auto', maxHeight: '120px' }}>
                        <div>0 - 无 (以贴图代替)</div>
                        <div>1 - 队伍颜色</div>
                        <div>2 - 队伍光晕</div>
                        <div>11 - 悬崖</div>
                        <div>31 - 洛丹伦树木</div>
                        <div>32 - 白杨谷树木</div>
                        <div>33 - 贫瘠之地树木</div>
                        <div>34 - 诺森德的树木</div>
                        <div>35 - 蘑菇型树木</div>
                        {/* Add more if needed */}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <Button type="primary" onClick={onClose}>确定</Button>
                    <Button onClick={onClose}>取消</Button>
                </div>
            </div>
        </div>
    )
}

export default TextureDetail
