import React, { useState } from 'react';
import { Button } from 'antd';
import { MasterDetailLayout } from '../MasterDetailLayout';
import { useModelStore } from '../../store/modelStore';
import { useHistoryStore } from '../../store/historyStore';
import { DraggableModal } from '../DraggableModal';
import DynamicField from '../node/DynamicField';
import KeyframeEditor from '../editors/KeyframeEditor';

interface TextureAnimationManagerModalProps {
    visible: boolean;
    onClose: () => void;
}

const TextureAnimationManagerModal: React.FC<TextureAnimationManagerModalProps> = ({ visible, onClose }) => {
    const { modelData, setTextureAnims } = useModelStore();
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);

    // Editor State
    const [editorVisible, setEditorVisible] = useState(false);
    const [editingBlock, setEditingBlock] = useState<{ index: number, field: string } | null>(null);

    const textureAnims = modelData?.TextureAnims || [];
    const globalSequences = (modelData?.GlobalSequences || []) as unknown as number[];

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

    const openEditor = (index: number, field: string, _label: string) => {
        setEditingBlock({ index, field });
        setEditorVisible(true);
    };

    const handleEditorSave = (result: any) => {
        if (editingBlock) {
            const { index, field } = editingBlock;
            updateAnim(index, { [field]: result });
            setEditorVisible(false);
            setEditingBlock(null);
        }
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

    const getCurrentEditorData = () => {
        if (!editingBlock || selectedIndex < 0) return null;
        const anim = textureAnims[editingBlock.index] as any;
        return anim ? anim[editingBlock.field] : null;
    };

    const getVectorSize = () => {
        if (!editingBlock) return 3;
        if (editingBlock.field === 'Rotation') return 4; // Rotations are usually quaternions (4)
        return 3; // Translation and Scaling are vector3
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

            {editorVisible && (
                <KeyframeEditor
                    visible={editorVisible}
                    onCancel={() => setEditorVisible(false)}
                    onOk={handleEditorSave}
                    initialData={getCurrentEditorData()}
                    title={`编辑 ${editingBlock?.field}`}
                    vectorSize={getVectorSize()}
                    globalSequences={globalSequences}
                />
            )}
        </>
    );
};

export default TextureAnimationManagerModal;
