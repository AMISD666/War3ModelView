import React, { useState, useEffect } from 'react';
import { Button } from 'antd';
import { MasterDetailLayout } from '../MasterDetailLayout';
import { useModelStore } from '../../store/modelStore';
import { useHistoryStore } from '../../store/historyStore';
import { useSelectionStore } from '../../store/selectionStore';
import { DraggableModal } from '../DraggableModal';
import DynamicField from '../node/DynamicField';
import { emit, listen } from '@tauri-apps/api/event';
import { windowManager } from '../../utils/windowManager';

interface TextureAnimationManagerModalProps {
    visible: boolean;
    onClose: () => void;
}

const TextureAnimationManagerModal: React.FC<TextureAnimationManagerModalProps> = ({ visible, onClose }) => {
    const { modelData, setTextureAnims } = useModelStore();
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);

    // Editor State
    const [editingBlock, setEditingBlock] = useState<{ index: number, field: string } | null>(null);

    const textureAnims = modelData?.TextureAnims || [];
    const globalSequences = (modelData?.GlobalSequences || []) as unknown as number[];

    // Subscribe to Ctrl+Click geoset picking - auto-select texture animation
    useEffect(() => {
        if (!visible || !modelData) return

        const trySelect = (pickedGeosetIndex: number | null) => {
            if (pickedGeosetIndex !== null && modelData.Geosets && modelData.Geosets[pickedGeosetIndex]) {
                const materialId = modelData.Geosets[pickedGeosetIndex].MaterialID
                if (materialId !== undefined && modelData.Materials && modelData.Materials[materialId]) {
                    const material = modelData.Materials[materialId]
                    if (material.Layers && material.Layers.length > 0) {
                        const layer = material.Layers[0] as any
                        const animId = layer.TVertexAnimId
                        if (typeof animId === 'number' && animId >= 0 && animId < textureAnims.length) {
                            setSelectedIndex(animId)
                            console.log('[TextureAnimManager] Auto-selected animation', animId, 'for geoset', pickedGeosetIndex)
                            return true
                        }
                    }
                }
            }
            return false
        }

        // Initial check
        const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
        if (selectedIndex === -1) {
            trySelect(initialPickedIndex)
        }

        // Subscribe
        let lastPickedIndex: number | null = initialPickedIndex
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                trySelect(pickedGeosetIndex)
            }
        })
        return unsubscribe
    }, [visible, modelData, textureAnims.length])

    const handleAdd = () => {
        // Create an empty texture animation - do NOT add empty {} as blocks
        // The renderer will crash if it finds a block without Keys array
        const newAnim = {
            // No Translation, Rotation, or Scaling by default
            // User can enable them via the checkboxes which will create valid blocks
        };
        const newAnims = [...textureAnims, newAnim];
        const oldAnims = [...textureAnims];

        useHistoryStore.getState().push({
            name: 'Add Texture Animation',
            undo: () => setTextureAnims(oldAnims),
            redo: () => setTextureAnims(newAnims)
        });

        setTextureAnims(newAnims);
        setSelectedIndex(newAnims.length - 1);
    };

    const handleDelete = (index: number) => {
        const newAnims = textureAnims.filter((_, i) => i !== index);
        const oldAnims = [...textureAnims];

        useHistoryStore.getState().push({
            name: `Delete Texture Animation ${index}`,
            undo: () => setTextureAnims(oldAnims),
            redo: () => setTextureAnims(newAnims)
        });

        setTextureAnims(newAnims);
        if (selectedIndex >= newAnims.length) {
            setSelectedIndex(newAnims.length - 1);
        }
    };

    const updateAnim = (index: number, updates: any) => {
        const newAnims = [...textureAnims];
        newAnims[index] = { ...newAnims[index], ...updates };
        const oldAnims = [...textureAnims];

        useHistoryStore.getState().push({
            name: `Update Texture Animation ${index}`,
            undo: () => setTextureAnims(oldAnims),
            redo: () => setTextureAnims(newAnims)
        });

        setTextureAnims(newAnims);
    };

    const toggleBlock = (index: number, key: string, checked: boolean) => {
        const currentAnim = textureAnims[index];
        const newAnims = [...textureAnims];

        if (checked) {
            // Add the block if it doesn't exist
            newAnims[index] = {
                ...currentAnim,
                [key]: (currentAnim as any)[key] || { InterpolationType: 0, GlobalSeqId: null, Keys: [] }
            };
        } else {
            // Remove the block
            const { [key]: _, ...rest } = currentAnim as any;
            newAnims[index] = rest;
        }
        const oldAnims = [...textureAnims];
        useHistoryStore.getState().push({
            name: `Toggle Texture Animation Block ${key}`,
            undo: () => setTextureAnims(oldAnims),
            redo: () => setTextureAnims(newAnims)
        });
        setTextureAnims(newAnims);
    };

    useEffect(() => {
        let active = true;
        const unlistenPromise = listen('IPC_KEYFRAME_SAVE', (event) => {
            if (!active) return;
            const payload = event.payload as any;
            if (payload && payload.callerId === 'TextureAnimationManagerModal') {
                if (editingBlock) {
                    const { index, field } = editingBlock;
                    updateAnim(index, { [field]: payload.data });
                    setEditingBlock(null);
                }
            }
        });

        return () => {
            active = false;
            unlistenPromise.then(f => {
                if (typeof f === 'function') f();
            });
        };
    }, [editingBlock, textureAnims]);

    const getCurrentEditorData = (index: number, field: string) => {
        if (index < 0) return null;
        const anim = textureAnims[index] as any;
        return anim ? anim[field] : null;
    };

    const getVectorSize = (field: string) => {
        if (field === 'Rotation') return 4;
        return 3;
    };

    const openEditor = (index: number, field: string, label: string) => {
        setEditingBlock({ index, field });

        const payload = {
            callerId: 'TextureAnimationManagerModal',
            initialData: getCurrentEditorData(index, field),
            title: `编辑 ${field}`,
            vectorSize: getVectorSize(field),
            globalSequences: globalSequences,
            fieldName: 'TextureAnimation',
            sequences: modelData?.Sequences || []
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
        payload.targetWindowId = windowId;

        emit('IPC_KEYFRAME_INIT', payload);
        windowManager.openToolWindow(windowId, payload.title, 600, 480);
    };

    const renderListItem = (_item: any, index: number, isSelected: boolean) => (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: isSelected ? '#fff' : '#b0b0b0' // Fix: Ensure text is visible when not selected
        }}>
            <span>{`TextureAnim ${index}`}</span>
        </div>
    );

    const renderDetail = (item: any, index: number) => {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <DynamicField
                    label="移动 (Translation)"
                    isDynamic={!!item.Translation}
                    onDynamicChange={(c) => toggleBlock(index, 'Translation', c)}
                    onEdit={() => openEditor(index, 'Translation', '编辑移动')}
                    buttonLabel="编辑移动"
                />

                <DynamicField
                    label="旋转 (Rotation)"
                    isDynamic={!!item.Rotation}
                    onDynamicChange={(c) => toggleBlock(index, 'Rotation', c)}
                    onEdit={() => openEditor(index, 'Rotation', '编辑旋转')}
                    buttonLabel="编辑旋转"
                />

                <DynamicField
                    label="缩放 (Scaling)"
                    isDynamic={!!item.Scaling}
                    onDynamicChange={(c) => toggleBlock(index, 'Scaling', c)}
                    onEdit={() => openEditor(index, 'Scaling', '编辑缩放')}
                    buttonLabel="编辑缩放"
                />
            </div>
        );
    };

    return (
        <>
            <DraggableModal
                title="纹理动画管理器"
                open={visible}
                onCancel={onClose}
                width={800}
                footer={null}
                wrapClassName="dark-theme-modal"
            >
                <div style={{ height: 500, background: '#222', border: '1px solid #444' }}>
                    <MasterDetailLayout
                        items={textureAnims}
                        selectedIndex={selectedIndex}
                        onSelect={setSelectedIndex}
                        renderListItem={renderListItem}
                        renderDetail={renderDetail}
                        onAdd={handleAdd}
                        onDelete={handleDelete}
                        listTitle="动画列表"
                        detailTitle="动画详情"
                        listWidth={200}
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button onClick={onClose}>关闭</Button>
                </div>
            </DraggableModal>
        </>
    );
};

export default TextureAnimationManagerModal;
