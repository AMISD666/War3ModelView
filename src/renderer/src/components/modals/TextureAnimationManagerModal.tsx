import React, { useState, useEffect } from 'react'
import { Button, Card } from 'antd'
import { MasterDetailLayout } from '../MasterDetailLayout'
import { useModelStore } from '../../store/modelStore'
import { useHistoryStore } from '../../store/historyStore'
import { useSelectionStore } from '../../store/selectionStore'
import { DraggableModal } from '../DraggableModal'
import DynamicField from '../node/DynamicField'
import KeyframeEditor from '../editors/KeyframeEditor'

interface TextureAnimationManagerModalProps {
    visible: boolean
    onClose: () => void
    asWindow?: boolean
}

const TextureAnimationManagerModal: React.FC<TextureAnimationManagerModalProps> = ({ visible, onClose, asWindow = false }) => {
    const { modelData, setTextureAnims } = useModelStore()
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)

    const [editorVisible, setEditorVisible] = useState(false)
    const [editingBlock, setEditingBlock] = useState<{ index: number, field: string } | null>(null)

    const textureAnims = modelData?.TextureAnims || []
    const globalSequences = (modelData?.GlobalSequences || []) as unknown as number[]

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
                            return true
                        }
                    }
                }
            }
            return false
        }

        const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
        if (selectedIndex === -1) {
            trySelect(initialPickedIndex)
        }

        let lastPickedIndex: number | null = initialPickedIndex
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                trySelect(pickedGeosetIndex)
            }
        })
        return unsubscribe
    }, [visible, modelData, textureAnims.length, selectedIndex])

    const handleAdd = () => {
        const newAnim = {}
        const newAnims = [...textureAnims, newAnim]
        const oldAnims = [...textureAnims]

        useHistoryStore.getState().push({
            name: '添加贴图动画',
            undo: () => setTextureAnims(oldAnims),
            redo: () => setTextureAnims(newAnims)
        })

        setTextureAnims(newAnims)
        setSelectedIndex(newAnims.length - 1)
    }

    const handleDelete = (index: number) => {
        const newAnims = textureAnims.filter((_, i) => i !== index)
        const oldAnims = [...textureAnims]

        useHistoryStore.getState().push({
            name: `删除贴图动画 ${index}`,
            undo: () => setTextureAnims(oldAnims),
            redo: () => setTextureAnims(newAnims)
        })

        setTextureAnims(newAnims)
        if (selectedIndex >= newAnims.length) {
            setSelectedIndex(newAnims.length - 1)
        }
    }

    const updateAnim = (index: number, updates: any) => {
        const newAnims = [...textureAnims]
        newAnims[index] = { ...newAnims[index], ...updates }
        const oldAnims = [...textureAnims]

        useHistoryStore.getState().push({
            name: `更新贴图动画 ${index}`,
            undo: () => setTextureAnims(oldAnims),
            redo: () => setTextureAnims(newAnims)
        })

        setTextureAnims(newAnims)
    }

    const toggleBlock = (index: number, key: string, checked: boolean) => {
        const currentAnim = textureAnims[index]
        const newAnims = [...textureAnims]

        if (checked) {
            newAnims[index] = {
                ...currentAnim,
                [key]: (currentAnim as any)[key] || { InterpolationType: 0, GlobalSeqId: null, Keys: [] }
            }
        } else {
            const { [key]: _discard, ...rest } = currentAnim as any
            newAnims[index] = rest
        }

        const oldAnims = [...textureAnims]
        useHistoryStore.getState().push({
            name: `切换贴图动画块 ${key}`,
            undo: () => setTextureAnims(oldAnims),
            redo: () => setTextureAnims(newAnims)
        })
        setTextureAnims(newAnims)
    }

    const openEditor = (index: number, field: string) => {
        setEditingBlock({ index, field })
        setEditorVisible(true)
    }

    const handleEditorSave = (result: any) => {
        if (editingBlock) {
            const { index, field } = editingBlock
            updateAnim(index, { [field]: result })
            setEditorVisible(false)
            setEditingBlock(null)
        }
    }

    const renderListItem = (_item: any, index: number, isSelected: boolean) => (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: isSelected ? '#fff' : '#b0b0b0',
                fontSize: '13px',
                padding: '4px 0'
            }}
        >
            <span>{`动画 ${index}`}</span>
        </div>
    )

    const renderDetail = (item: any, index: number) => {
        const propertyNames = ['Translation', 'Rotation', 'Scaling']
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {propertyNames.map((prop) => (
                    <Card
                        key={prop}
                        size="small"
                        title={<span style={{ fontSize: '12px' }}>{prop}</span>}
                        style={{ background: '#2d2d2d', borderColor: '#444' }}
                        styles={{ header: { padding: '4px 8px', minHeight: '32px', borderBottom: '1px solid #444' }, body: { padding: '8px' } }}
                    >
                        <DynamicField
                            label=""
                            isDynamic={!!item[prop]}
                            onDynamicChange={(c) => toggleBlock(index, prop, c)}
                            onEdit={() => openEditor(index, prop)}
                            buttonLabel={`编辑 ${prop}`}
                        />
                    </Card>
                ))}
            </div>
        )
    }

    const getCurrentEditorData = () => {
        if (!editingBlock || selectedIndex < 0) return null
        const anim = textureAnims[editingBlock.index] as any
        return anim ? anim[editingBlock.field] : null
    }

    const getVectorSize = () => {
        if (!editingBlock) return 3
        if (editingBlock.field === 'Rotation') return 4
        return 3
    }

    const renderManagerContent = (contentHeight: string | number = 500) => (
        <div style={{ height: contentHeight, background: '#222', border: '1px solid #444' }}>
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
    )

    if (asWindow) {
        if (!visible) return null
        return (
            <>
                <div style={{ height: '100vh', padding: 8, backgroundColor: '#1f1f1f', overflow: 'hidden' }}>
                    {renderManagerContent('calc(100vh - 16px)')}
                </div>

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
        )
    }

    return (
        <>
            <DraggableModal
                title="贴图动画管理器"
                open={visible}
                onCancel={onClose}
                width={800}
                footer={null}
                wrapClassName="dark-theme-modal"
            >
                {renderManagerContent()}
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
    )
}

export default TextureAnimationManagerModal
