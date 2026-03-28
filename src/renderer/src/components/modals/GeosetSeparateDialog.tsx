import React, { useState, useEffect, useMemo } from 'react';
import { Select, Button, Radio, ConfigProvider, theme } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import { decodeBLP, getBLPImageData } from 'war3-model';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { MaterialLayerOptions, LayerConfig, DEFAULT_LAYER_CONFIG } from './MaterialLayerOptions';
import { invokeReadMpqFile } from '../../utils/mpqPerf';

type MaterialMode = 'keep' | 'new' | 'existing';

interface GeosetSeparateDialogProps {
    visible: boolean;
    sourceGeosetIndex: number;
    onCancel: () => void;
    onConfirm: (config: {
        mode: MaterialMode;
        materialIndex?: number;  // for 'existing' or result of 'keep'
        newLayerConfig?: LayerConfig;  // for 'new'
    }) => void;
}

export const GeosetSeparateDialog: React.FC<GeosetSeparateDialogProps> = ({
    visible,
    sourceGeosetIndex,
    onCancel,
    onConfirm
}) => {
    const { modelData, modelPath } = useModelStore();
    const [mode, setMode] = useState<MaterialMode>('keep');
    const [selectedMaterialIndex, setSelectedMaterialIndex] = useState<number>(-1);
    const [layerConfig, setLayerConfig] = useState<LayerConfig>(DEFAULT_LAYER_CONFIG);
    const [texturePreviewUrl, setTexturePreviewUrl] = useState<string | null>(null);
    const [loadingTexture, setLoadingTexture] = useState(false);

    // Get source material info
    const sourceGeoset = modelData?.Geosets?.[sourceGeosetIndex];
    const sourceMaterialId = sourceGeoset?.MaterialID ?? 0;
    const allMaterials = modelData?.Materials || [];

    // Build texture list
    const textures = useMemo(() => {
        const list: { id: number; path: string }[] = [];
        (modelData?.Textures || []).forEach((tex: any, i: number) => {
            list.push({ id: i, path: tex.Image || '' });
        });
        return list;
    }, [modelData?.Textures]);

    // Build material options for 'existing' mode
    const materialOptions = useMemo(() => {
        return allMaterials.map((_: any, i: number) => ({
            label: `材质 ${i}`,
            value: i
        }));
    }, [allMaterials]);

    // Reset state on open
    useEffect(() => {
        if (visible) {
            setMode('keep');
            setSelectedMaterialIndex(sourceMaterialId);
            // Initialize layer config from source material's first layer
            const srcMat = allMaterials[sourceMaterialId];
            if (srcMat?.Layers?.[0]) {
                const layer = srcMat.Layers[0] as any;
                const shading = layer.Shading || 0;
                setLayerConfig({
                    textureId: typeof layer.TextureID === 'number' ? layer.TextureID : 0,
                    filterMode: layer.FilterMode ?? 0,
                    alpha: typeof layer.Alpha === 'number' ? layer.Alpha : 1,
                    unshaded: (shading & 1) !== 0,
                    sphereEnvMap: (shading & 2) !== 0,
                    twoSided: (shading & 16) !== 0,
                    unfogged: (shading & 32) !== 0,
                    noDepthTest: (shading & 64) !== 0,
                    noDepthSet: (shading & 128) !== 0,
                });
            } else {
                setLayerConfig(DEFAULT_LAYER_CONFIG);
            }
        }
    }, [visible, sourceMaterialId, allMaterials]);

    // Load texture preview for current mode
    useEffect(() => {
        const loadPreview = async () => {
            let textureId: number = -1;

            if (mode === 'keep' || mode === 'existing') {
                const matIdx = mode === 'keep' ? sourceMaterialId : selectedMaterialIndex;
                const material = allMaterials[matIdx];
                if (material?.Layers?.[0]) {
                    textureId = typeof material.Layers[0].TextureID === 'number' ? material.Layers[0].TextureID : -1;
                }
            } else if (mode === 'new') {
                textureId = layerConfig.textureId;
            }

            if (textureId < 0 || !modelData?.Textures?.[textureId]) {
                setTexturePreviewUrl(null);
                return;
            }

            const texture = modelData.Textures[textureId];
            const texturePath = texture.Image || '';
            const isBlp = texturePath.toLowerCase().endsWith('.blp');

            if (isBlp) {
                setLoadingTexture(true);
                try {
                    let fullPath = texturePath;
                    if (modelPath && !fullPath.match(/^[a-zA-Z]:/) && !fullPath.startsWith('/')) {
                        const modelDir = modelPath.substring(0, modelPath.lastIndexOf('\\'));
                        fullPath = `${modelDir}\\${fullPath}`;
                    }

                    let buffer: ArrayBuffer | null = null;
                    try {
                        const fileData = await readFile(fullPath);
                        buffer = fileData.buffer;
                    } catch {
                        try {
                            const mpqResult: number[] = await invokeReadMpqFile<number[]>(texturePath.replace(/\//g, '\\'), 'GeosetSeparateDialog.preview');
                            buffer = new Uint8Array(mpqResult).buffer;
                        } catch {
                            buffer = null;
                        }
                    }

                    if (buffer) {
                        const blp = decodeBLP(buffer);
                        const imageData = getBLPImageData(blp, 0);
                        if (imageData) {
                            const canvas = document.createElement('canvas');
                            canvas.width = imageData.width;
                            canvas.height = imageData.height;
                            const ctx = canvas.getContext('2d');
                            if (ctx) {
                                const realImageData = new ImageData(
                                    new Uint8ClampedArray(imageData.data),
                                    imageData.width,
                                    imageData.height
                                );
                                ctx.putImageData(realImageData, 0, 0);
                                setTexturePreviewUrl(canvas.toDataURL());
                            }
                        }
                    } else {
                        setTexturePreviewUrl(null);
                    }
                } catch (e) {
                    console.error('Failed to load texture preview:', e);
                    setTexturePreviewUrl(null);
                } finally {
                    setLoadingTexture(false);
                }
            } else {
                setTexturePreviewUrl(`file://${texturePath}`);
            }
        };

        loadPreview();
    }, [mode, selectedMaterialIndex, layerConfig.textureId, allMaterials, modelData?.Textures, modelPath, sourceMaterialId]);

    const handleConfirm = () => {
        if (mode === 'keep') {
            onConfirm({ mode: 'keep', materialIndex: sourceMaterialId });
        } else if (mode === 'existing') {
            onConfirm({ mode: 'existing', materialIndex: selectedMaterialIndex });
        } else {
            onConfirm({ mode: 'new', newLayerConfig: layerConfig });
        }
    };

    return (
        <ConfigProvider
            theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                    colorBgContainer: '#1e1e1e',
                    colorBgElevated: '#2a2a2a',
                    colorBorder: '#444',
                    colorText: '#ddd',
                    colorTextSecondary: '#999',
                }
            }}
        >
            <DraggableModal
                title="分离多边形"
                open={visible}
                onCancel={onCancel}
                footer={[
                    <Button key="cancel" onClick={onCancel}>取消</Button>,
                    <Button key="confirm" type="primary" onClick={handleConfirm}>确定</Button>
                ]}
                width={520}
            >
                <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                    {/* Texture Preview */}
                    <div style={{
                        width: 120,
                        height: 120,
                        border: '1px solid #444',
                        borderRadius: 4,
                        backgroundColor: '#0a0a0a',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        overflow: 'hidden'
                    }}>
                        {loadingTexture ? (
                            <span style={{ color: '#666', fontSize: 11 }}>加载中...</span>
                        ) : texturePreviewUrl ? (
                            <img
                                src={texturePreviewUrl}
                                alt="材质预览"
                                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                            />
                        ) : (
                            <span style={{ color: '#555', fontSize: 11 }}>无预览</span>
                        )}
                    </div>

                    {/* Options */}
                    <div style={{ flex: 1 }}>
                        <div style={{ marginBottom: 12, color: '#aaa', fontSize: 13 }}>
                            选择分离后使用的材质:
                        </div>
                        <Radio.Group
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}
                        >
                            <Radio value="keep" style={{ color: '#ddd' }}>保持原材质 (材质 {sourceMaterialId})</Radio>
                            <Radio value="new" style={{ color: '#ddd' }}>新建材质</Radio>
                            <Radio value="existing" style={{ color: '#ddd' }}>使用其他材质</Radio>
                        </Radio.Group>

                        {/* New Material Options */}
                        {mode === 'new' && (
                            <div style={{
                                backgroundColor: '#1a1a1a',
                                padding: 12,
                                borderRadius: 6,
                                border: '1px solid #333'
                            }}>
                                <MaterialLayerOptions
                                    value={layerConfig}
                                    onChange={setLayerConfig}
                                    textures={textures}
                                />
                            </div>
                        )}

                        {/* Existing Material Selection */}
                        {mode === 'existing' && (
                            <Select
                                style={{ width: '100%' }}
                                value={selectedMaterialIndex}
                                onChange={setSelectedMaterialIndex}
                                options={materialOptions}
                                size="large"
                            />
                        )}
                    </div>
                </div>
            </DraggableModal>
        </ConfigProvider>
    );
};

export default GeosetSeparateDialog;
