import React, { useState, useEffect, useRef } from 'react';
import { Button } from 'antd';
import { MasterDetailLayout } from '../MasterDetailLayout';
import { useModelStore } from '../../store/modelStore';
import { useHistoryStore } from '../../store/historyStore';
import { useSelectionStore } from '../../store/selectionStore';
import { DraggableModal } from '../DraggableModal';
import DynamicField from '../node/DynamicField';
import { listen } from '@tauri-apps/api/event';
import { windowManager } from '../../utils/WindowManager';

import { useRpcClient } from '../../hooks/useRpc';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CloseOutlined } from '@ant-design/icons';

interface TextureAnimationManagerModalProps {
    visible: boolean;
    onClose: () => void;
    isStandalone?: boolean;
}

const TextureAnimationManagerModal: React.FC<TextureAnimationManagerModalProps> = ({ visible, onClose, isStandalone }) => {
    const { modelData, setTextureAnims } = useModelStore();
    const rpcClient = useRpcClient<any>('textureAnimManager', {
        textureAnims: [],
        globalSequences: [],
        sequences: [],
        materials: [],
        geosets: [],
        pickedGeosetIndex: null
    });
    const rpcState = rpcClient.state;

    const [selectedIndex, setSelectedIndex] = useState<number>(-1);
    const [localAnims, setLocalAnims] = useState<any[]>([]);
    const lastSourceAnimsSigRef = useRef('');

    // Editor State
    const [editingBlock, setEditingBlock] = useState<{ index: number, field: string } | null>(null);

    const sourceAnims = isStandalone ? rpcState.textureAnims : modelData?.TextureAnims;
    const globalSequences = isStandalone ? rpcState.globalSequences : (modelData?.GlobalSequences || []) as unknown as number[];
    const currentGeosets = isStandalone ? rpcState.geosets : modelData?.Geosets;
    const currentMaterials = isStandalone ? rpcState.materials : modelData?.Materials;
    const sequences = isStandalone ? rpcState.sequences : modelData?.Sequences || [];

    useEffect(() => {
        if (!visible) {
            setLocalAnims([]);
            setSelectedIndex(-1);
            setEditingBlock(null);
            lastSourceAnimsSigRef.current = '';
            return;
        }

        const sig = JSON.stringify(sourceAnims ?? null);
        if (sig === lastSourceAnimsSigRef.current) {
            return;
        }
        lastSourceAnimsSigRef.current = sig;

        if (Array.isArray(sourceAnims)) {
            setLocalAnims([...sourceAnims]);
            if (sourceAnims.length === 0) {
                setSelectedIndex(-1);
                setEditingBlock(null);
            } else {
                setSelectedIndex((prev) => (prev >= sourceAnims.length ? sourceAnims.length - 1 : prev));
            }
        } else {
            setLocalAnims([]);
            setSelectedIndex(-1);
            setEditingBlock(null);
        }
    }, [visible, sourceAnims]);

    const saveToBackend = (action: string, payload: any, newAnims: any[]) => {
        setLocalAnims(newAnims);
        if (isStandalone) {
            rpcClient.emitCommand('EXECUTE_TEXTURE_ANIM_ACTION', { action, payload });
        } else {
            // Apply history and state locally
            if (action === 'ADD') {
                const oldAnims = [...(modelData?.TextureAnims || [])];
                useHistoryStore.getState().push({
                    name: 'Add Texture Animation',
                    undo: () => setTextureAnims(oldAnims),
                    redo: () => setTextureAnims(newAnims)
                });
            } else if (action === 'DELETE') {
                const oldAnims = [...(modelData?.TextureAnims || [])];
                useHistoryStore.getState().push({
                    name: `Delete Texture Animation`,
                    undo: () => setTextureAnims(oldAnims),
                    redo: () => setTextureAnims(newAnims)
                });
            } else if (action === 'UPDATE' || action === 'TOGGLE_BLOCK') {
                const oldAnims = [...(modelData?.TextureAnims || [])];
                useHistoryStore.getState().push({
                    name: `Update Texture Animation`,
                    undo: () => setTextureAnims(oldAnims),
                    redo: () => setTextureAnims(newAnims)
                });
            }
            setTextureAnims(newAnims);
        }
    };

    // Subscribe to Ctrl+Click geoset picking - auto-select texture animation
    useEffect(() => {
        if (!visible) return;

        const trySelect = (pickedGeosetIndex: number | null) => {
            if (pickedGeosetIndex !== null && currentGeosets && currentGeosets[pickedGeosetIndex]) {
                const materialId = currentGeosets[pickedGeosetIndex].MaterialID
                if (materialId !== undefined && currentMaterials && currentMaterials[materialId]) {
                    const material = currentMaterials[materialId]
                    if (material.Layers && material.Layers.length > 0) {
                        const layer = material.Layers[0] as any
                        const animId = layer.TVertexAnimId
                        if (typeof animId === 'number' && animId >= 0 && animId < localAnims.length) {
                            setSelectedIndex(animId)
                            return true
                        }
                    }
                }
            }
            return false
        }

        // Initial check
        const initialPickedIndex = isStandalone ? rpcState.pickedGeosetIndex : useSelectionStore.getState().pickedGeosetIndex;
        if (selectedIndex === -1) {
            trySelect(initialPickedIndex)
        }

        // Subscribe (Standlaone uses RPC state prop)
        if (isStandalone) {
            trySelect(rpcState.pickedGeosetIndex);
        } else {
            let lastPickedIndex: number | null = initialPickedIndex
            const unsubscribe = useSelectionStore.subscribe((state) => {
                const pickedGeosetIndex = state.pickedGeosetIndex
                if (pickedGeosetIndex !== lastPickedIndex) {
                    lastPickedIndex = pickedGeosetIndex
                    trySelect(pickedGeosetIndex)
                }
            })
            return unsubscribe
        }
        return undefined
    }, [visible, currentGeosets, currentMaterials, rpcState.pickedGeosetIndex, localAnims.length, isStandalone])

    const handleAdd = () => {
        const newAnim = {};
        const newAnims = [...localAnims, newAnim];
        saveToBackend('ADD', newAnims, newAnims);
        setSelectedIndex(newAnims.length - 1);
    };

    const handleDelete = (index: number) => {
        const newAnims = localAnims.filter((_, i) => i !== index);
        saveToBackend('DELETE', newAnims, newAnims);
        if (selectedIndex >= newAnims.length) {
            setSelectedIndex(newAnims.length - 1);
        }
    };

    const updateAnim = (index: number, updates: any) => {
        const newAnims = [...localAnims];
        newAnims[index] = { ...newAnims[index], ...updates };
        saveToBackend('UPDATE', newAnims, newAnims);
    };

    const toggleBlock = (index: number, key: string, checked: boolean) => {
        const currentAnim = localAnims[index];
        const newAnims = [...localAnims];

        if (checked) {
            newAnims[index] = {
                ...currentAnim,
                [key]: (currentAnim as any)[key] || { InterpolationType: 0, GlobalSeqId: null, Keys: [] }
            };
        } else {
            const { [key]: _, ...rest } = currentAnim as any;
            newAnims[index] = rest;
        }
        saveToBackend('TOGGLE_BLOCK', newAnims, newAnims);
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
    }, [editingBlock, localAnims]);

    const getCurrentEditorData = (index: number, field: string) => {
        if (index < 0) return null;
        const anim = localAnims[index] as any;
        return anim ? anim[field] : null;
    };

    const getVectorSize = (field: string) => {
        if (field === 'Rotation') return 4;
        return 3;
    };

    const openEditor = (index: number, field: string, label: string) => {
        setEditingBlock({ index, field });

        const payload: any = {
            callerId: 'TextureAnimationManagerModal',
            initialData: getCurrentEditorData(index, field),
            title: `编辑 ${field}`,
            vectorSize: getVectorSize(field),
            globalSequences: globalSequences,
            fieldName: 'TextureAnimation',
            sequences: sequences
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);

        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload);
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

    const Wrapper = isStandalone ? 'div' : DraggableModal as any;
    const wrapperProps = isStandalone
        ? { style: { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#252525', overflow: 'hidden' } }
        : {
            title: "贴图动画管理器",
            open: visible,
            onCancel: onClose,
            width: 800,
            footer: null,
            wrapClassName: "dark-theme-modal"
        };

    return (
        <Wrapper {...wrapperProps}>
            {isStandalone && (
                <div data-tauri-drag-region style={{ height: 32, flexShrink: 0, backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a', display: 'flex', alignItems: 'center', padding: '0 16px', justifyContent: 'space-between', userSelect: 'none' }}>
                    <span data-tauri-drag-region style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 'bold' }}>贴图动画管理器</span>
                    <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => getCurrentWindow().hide()} style={{ color: '#b0b0b0' }} />
                </div>
            )}
            <div style={{ flex: 1, background: '#222', border: isStandalone ? 'none' : '1px solid #444', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <MasterDetailLayout
                    items={localAnims}
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
            {!isStandalone && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button onClick={onClose}>关闭</Button>
                </div>
            )}
        </Wrapper>
    );
};

export default TextureAnimationManagerModal;
