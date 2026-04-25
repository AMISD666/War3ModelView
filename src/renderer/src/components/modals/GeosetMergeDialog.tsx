import { appMessage } from '../../store/messageStore'
import React, { useState, useEffect, useMemo } from 'react';
import { Select, Button, ConfigProvider, theme } from 'antd'
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import { decodeBLP, getBLPImageData } from 'war3-model';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { MaterialLayerOptions, LayerConfig, DEFAULT_LAYER_CONFIG } from './MaterialLayerOptions';
import { invokeReadMpqFile } from '../../utils/mpqPerf';

interface GeosetMergeDialogProps {
    visible: boolean;
    selectedGeosetIndices: number[];
    onCancel: () => void;
    onConfirm: (materialIndex: number, newLayerConfig?: LayerConfig) => void;
}

export const GeosetMergeDialog: React.FC<GeosetMergeDialogProps> = ({
    visible,
    selectedGeosetIndices,
    onCancel,
    onConfirm
}) => {
    const { modelData, modelPath } = useModelStore();
    const [selectedMaterialIndex, setSelectedMaterialIndex] = useState<number>(-1);
    const [layerConfig, setLayerConfig] = useState<LayerConfig>(DEFAULT_LAYER_CONFIG);
    const [texturePreviewUrl, setTexturePreviewUrl] = useState<string | null>(null);
    const [loadingTexture, setLoadingTexture] = useState(false);

    // Build texture list for MaterialLayerOptions
    const textures = useMemo(() => {
        const list: { id: number; path: string }[] = [];
        (modelData?.Textures || []).forEach((tex: any, i: number) => {
            list.push({ id: i, path: tex.Image || '' });
        });
        return list;
    }, [modelData?.Textures]);

    // Get materials used by selected geosets
    const usedMaterialIndices = useMemo(() => {
        const indices = new Set<number>();
        selectedGeosetIndices.forEach(idx => {
            const geoset = modelData?.Geosets?.[idx];
            if (geoset && typeof geoset.MaterialID === 'number') {
                indices.add(geoset.MaterialID);
            }
        });
        return Array.from(indices);
    }, [modelData?.Geosets, selectedGeosetIndices]);

    // All materials
    const allMaterials = modelData?.Materials || [];
    const otherMaterialIndices = useMemo(() => {
        const usedSet = new Set(usedMaterialIndices);
        return allMaterials.map((_: any, i: number) => i).filter((i: number) => !usedSet.has(i));
    }, [allMaterials, usedMaterialIndices]);

    // Build flat options with dividers
    const options = useMemo(() => {
        const result: { label: string; value: number; disabled?: boolean }[] = [];

        // New material option
        result.push({ label: '新建材质', value: -1 });

        // Used materials
        if (usedMaterialIndices.length > 0) {
            result.push({ label: '─── 选中引用的材质 ───', value: -999, disabled: true });
            usedMaterialIndices.forEach(idx => {
                result.push({ label: `材质 ${idx}`, value: idx });
            });
        }

        // Other materials
        if (otherMaterialIndices.length > 0) {
            result.push({ label: '─── 其他材质 ───', value: -998, disabled: true });
            otherMaterialIndices.forEach(idx => {
                result.push({ label: `材质 ${idx}`, value: idx });
            });
        }

        return result;
    }, [usedMaterialIndices, otherMaterialIndices]);

    // Default to first used material, initialize layerConfig from it
    useEffect(() => {
        if (visible && usedMaterialIndices.length > 0) {
            const matIdx = usedMaterialIndices[0];
            setSelectedMaterialIndex(matIdx);
            // Initialize layer config from this material
            const srcMat = allMaterials[matIdx];
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
        } else if (visible) {
            setSelectedMaterialIndex(-1);
            setLayerConfig(DEFAULT_LAYER_CONFIG);
        }
    }, [visible, usedMaterialIndices, allMaterials]);

    // Load texture preview when material changes (or layerConfig for new mode)
    useEffect(() => {
        const loadTexturePreview = async () => {
            let textureId: number = -1;

            if (selectedMaterialIndex < 0) {
                // New material mode - use layerConfig
                textureId = layerConfig.textureId;
            } else {
                const material = allMaterials[selectedMaterialIndex] as any;
                if (material?.Layers?.length) {
                    textureId = typeof material.Layers[0].TextureID === 'number' ? material.Layers[0].TextureID : -1;
                }
            }

            if (textureId < 0) {
                setTexturePreviewUrl(null);
                return;
            }

            const texture: any = modelData?.Textures?.[textureId];
            if (!texture?.Image) {
                setTexturePreviewUrl(null);
                return;
            }

            const texturePath = texture.Image as string;
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
                            const mpqResult: number[] = await invokeReadMpqFile<number[]>(texturePath.replace(/\//g, '\\'), 'GeosetMergeDialog.preview');
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

        loadTexturePreview();
    }, [selectedMaterialIndex, layerConfig.textureId, allMaterials, modelData?.Textures, modelPath]);

    const handleConfirm = () => {
        if (selectedGeosetIndices.length < 2) {
            appMessage.error('请选择至少2个多边形进行合并');
            return;
        }
        // Pass layerConfig only when new material mode
        onConfirm(selectedMaterialIndex, selectedMaterialIndex < 0 ? layerConfig : undefined);
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
                title="合并多边形"
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

                    {/* Material Selection */}
                    <div style={{ flex: 1 }}>
                        <div style={{ marginBottom: 10, color: '#aaa', fontSize: 13 }}>
                            选择合并后使用的材质:
                        </div>
                        <Select
                            style={{ width: '100%', marginBottom: 16 }}
                            value={selectedMaterialIndex}
                            onChange={setSelectedMaterialIndex}
                            options={options}
                            size="large"
                            optionRender={(option) => (
                                <div style={{
                                    color: option.data.disabled ? '#666' : '#ddd',
                                    textAlign: option.data.disabled ? 'center' : 'left',
                                    fontSize: option.data.disabled ? 11 : 13
                                }}>
                                    {option.label}
                                </div>
                            )}
                        />

                        {/* Show MaterialLayerOptions when New Material selected */}
                        {selectedMaterialIndex < 0 && (
                            <div style={{
                                backgroundColor: '#1a1a1a',
                                padding: 12,
                                borderRadius: 6,
                                border: '1px solid #333',
                                marginBottom: 12
                            }}>
                                <MaterialLayerOptions
                                    value={layerConfig}
                                    onChange={setLayerConfig}
                                    textures={textures}
                                />
                            </div>
                        )}

                        <div style={{ color: '#777', fontSize: 12 }}>
                            将合并 {selectedGeosetIndices.length} 个多边形
                        </div>
                    </div>
                </div>
            </DraggableModal>
        </ConfigProvider>
    );
};

export default GeosetMergeDialog;
