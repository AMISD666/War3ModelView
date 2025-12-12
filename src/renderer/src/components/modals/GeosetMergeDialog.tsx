import React, { useState, useEffect, useMemo } from 'react';
import { Select, Button, message, ConfigProvider, theme } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore';
import { decodeBLP, getBLPImageData } from 'war3-model';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

interface GeosetMergeDialogProps {
    visible: boolean;
    selectedGeosetIndices: number[];
    onCancel: () => void;
    onConfirm: (materialIndex: number) => void;
}

export const GeosetMergeDialog: React.FC<GeosetMergeDialogProps> = ({
    visible,
    selectedGeosetIndices,
    onCancel,
    onConfirm
}) => {
    const { modelData, modelPath } = useModelStore();
    const [selectedMaterialIndex, setSelectedMaterialIndex] = useState<number>(-1);
    const [texturePreviewUrl, setTexturePreviewUrl] = useState<string | null>(null);
    const [loadingTexture, setLoadingTexture] = useState(false);

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
        result.push({ label: '新建材质 (白色)', value: -1 });

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

    // Default to first used material
    useEffect(() => {
        if (visible && usedMaterialIndices.length > 0) {
            setSelectedMaterialIndex(usedMaterialIndices[0]);
        } else if (visible) {
            setSelectedMaterialIndex(-1);
        }
    }, [visible, usedMaterialIndices]);

    // Load texture preview when material changes
    useEffect(() => {
        const loadTexturePreview = async () => {
            if (selectedMaterialIndex < 0) {
                setTexturePreviewUrl(null);
                return;
            }

            const material = allMaterials[selectedMaterialIndex] as any;
            if (!material?.Layers?.length) {
                setTexturePreviewUrl(null);
                return;
            }

            const textureId = material.Layers[0].TextureID;
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
                    // Resolve relative path
                    if (modelPath && !fullPath.match(/^[a-zA-Z]:/) && !fullPath.startsWith('/')) {
                        const modelDir = modelPath.substring(0, modelPath.lastIndexOf('\\'));
                        fullPath = `${modelDir}\\${fullPath}`;
                    }

                    // Try local file first
                    let buffer: ArrayBuffer | null = null;
                    try {
                        const fileData = await readFile(fullPath);
                        buffer = fileData.buffer;
                    } catch {
                        // Try MPQ
                        try {
                            const mpqResult: number[] = await invoke('read_mpq_file', { filePath: texturePath });
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
    }, [selectedMaterialIndex, allMaterials, modelData?.Textures, modelPath]);

    const handleConfirm = () => {
        if (selectedGeosetIndices.length < 2) {
            message.error('请选择至少2个多边形进行合并');
            return;
        }
        onConfirm(selectedMaterialIndex);
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
                width={500}
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
                            style={{ width: '100%' }}
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
                        <div style={{ marginTop: 16, color: '#777', fontSize: 12 }}>
                            将合并 {selectedGeosetIndices.length} 个多边形
                        </div>
                    </div>
                </div>
            </DraggableModal>
        </ConfigProvider>
    );
};

export default GeosetMergeDialog;
