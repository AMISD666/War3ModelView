import React, { useState, useEffect } from 'react'
import { Input, Checkbox, Button } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { readFile } from '@tauri-apps/plugin-fs'
import { decodeTextureData, normalizePath } from '../../viewer/textureLoader'
import { invokeReadMpqFile } from '../../../utils/mpqPerf'

interface TextureDetailProps {
    texture: any
    modelPath?: string
    onUpdate: (updatedTexture: any) => void
    onClose: () => void
}

const TextureDetail: React.FC<TextureDetailProps> = ({ texture, modelPath, onUpdate, onClose }) => {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)

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
        if (bytes.buffer instanceof ArrayBuffer) {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        }
        return bytes.slice().buffer
    }

    useEffect(() => {
        const loadTexture = async () => {
            if (!texture.Image) {
                setPreviewUrl(null)
                return
            }

            const imagePath = texture.Image
            const isBlp = imagePath.toLowerCase().endsWith('.blp')
            const isTga = imagePath.toLowerCase().endsWith('.tga')
            const isSupported = isBlp || isTga

            if (isSupported) {
                try {
                    let fullPath = imagePath
                    // Resolve relative path if modelPath is available
                    if (modelPath && !fullPath.match(/^[a-zA-Z]:/) && !fullPath.startsWith('/')) {
                        const modelDir = modelPath.substring(0, modelPath.lastIndexOf('\\'))
                        fullPath = `${modelDir}\\${fullPath}`
                    }

                    const buffer = await readFile(fullPath)
                    if (buffer) {
                        const imageData = decodeTextureData(buffer.buffer, imagePath)
                        const dataUrl = imageData ? imageDataToDataUrl(imageData) : null
                        if (dataUrl) {
                            setPreviewUrl(dataUrl)
                            return
                        }
                    }
                } catch (e) {
                    // fall through to MPQ
                }
                try {
                    const mpqData = await invokeReadMpqFile<Uint8Array>(normalizePath(imagePath), 'TextureDetail.preview')
                    const mpqBuffer = toArrayBuffer(mpqData)
                    if (mpqBuffer && mpqBuffer.byteLength > 0) {
                        const imageData = decodeTextureData(mpqBuffer, imagePath)
                        const dataUrl = imageData ? imageDataToDataUrl(imageData) : null
                        if (dataUrl) {
                            setPreviewUrl(dataUrl)
                            return
                        }
                    }
                } catch (e) {
                    // ignore MPQ failure
                }
                setPreviewUrl(null)
            } else {
                // Try standard image loading
                setPreviewUrl(`file://${imagePath}`)
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
                            img.alt = '\u56fe\u7247\u672a\u627e\u5230'
                            img.style.display = 'none'
                        }}
                    />
                ) : (
                    <div style={{ textAlign: 'center', color: '#666' }}>
                        <div>{'\u65e0\u6cd5\u52a0\u8f7d\u8d34\u56fe'}</div>
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
