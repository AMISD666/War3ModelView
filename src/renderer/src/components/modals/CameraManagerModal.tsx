import React, { useState } from 'react'
import { Button, Card, Space, InputNumber, Row, Col, Input, Checkbox, Tooltip } from 'antd'
import { EyeOutlined, CameraOutlined } from '@ant-design/icons'
import { MasterDetailLayout } from '../MasterDetailLayout'
import { useModelStore } from '../../store/modelStore'
import { DraggableModal } from '../DraggableModal'
import { useHistoryStore } from '../../store/historyStore'
import KeyframeEditor from '../editors/KeyframeEditor'
import { CameraNode, NodeType } from '../../types/node'

interface CameraManagerModalProps {
    visible: boolean
    onClose: () => void
    onAddFromView?: () => void
    onViewCamera?: (camera: CameraNode) => void
    asWindow?: boolean
}

const CameraManagerModal: React.FC<CameraManagerModalProps> = ({
    visible,
    onClose,
    onAddFromView,
    onViewCamera,
    asWindow = false
}) => {
    const { modelData, updateNodes, nodes, addNode, deleteNode } = useModelStore()
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)

    const [editorVisible, setEditorVisible] = useState(false)
    const [editingBlock, setEditingBlock] = useState<{ index: number, field: string } | null>(null)

    const cameras = nodes.filter((n) => n.type === NodeType.CAMERA) as CameraNode[]
    const globalSequences = (modelData?.GlobalSequences || []) as unknown as number[]

    const handleAdd = () => {
        const newCamera: Partial<CameraNode> & { Name: string, type: NodeType } = {
            Name: `Camera ${cameras.length + 1}`,
            type: NodeType.CAMERA,
            FieldOfView: 0.7853,
            NearClip: 16,
            FarClip: 5000,
            Translation: {
                InterpolationType: 0,
                GlobalSeqId: null,
                Keys: [{ Frame: 0, Vector: [0, 0, 0] }]
            },
            TargetTranslation: {
                InterpolationType: 0,
                GlobalSeqId: null,
                Keys: [{ Frame: 0, Vector: [100, 0, 0] }]
            }
        }

        const currentNodes = useModelStore.getState().nodes
        const maxObjectId = currentNodes.reduce((max, n) => Math.max(max, n.ObjectId), -1)
        const newObjectId = maxObjectId + 1

        useHistoryStore.getState().push({
            name: 'Add Camera',
            undo: () => deleteNode(newObjectId),
            redo: () => addNode({ ...newCamera, ObjectId: newObjectId })
        })

        addNode(newCamera)
    }

    const handleDelete = (index: number) => {
        if (index < 0 || index >= cameras.length) return

        const node = cameras[index]
        const nodeClone = JSON.parse(JSON.stringify(node))

        useHistoryStore.getState().push({
            name: 'Delete Camera',
            undo: () => addNode(nodeClone),
            redo: () => deleteNode(node.ObjectId)
        })

        deleteNode(node.ObjectId)
        if (selectedIndex >= index) setSelectedIndex(Math.max(-1, selectedIndex - 1))
    }

    const updateCamera = (index: number, updates: Partial<CameraNode>) => {
        const camera = cameras[index]
        if (!camera) return

        const oldData: Partial<CameraNode> = {}
        Object.keys(updates).forEach((key) => {
            const k = key as keyof CameraNode
            oldData[k] = (camera as any)[k]
        })

        const objectId = camera.ObjectId
        useHistoryStore.getState().push({
            name: 'Update Camera',
            undo: () => updateNodes([{ objectId, data: oldData }]),
            redo: () => updateNodes([{ objectId, data: updates }])
        })

        updateNodes([{ objectId: camera.ObjectId, data: updates }])
    }

    const toggleBlock = (index: number, key: keyof CameraNode, checked: boolean) => {
        const currentCam = cameras[index]
        if (checked) {
            updateCamera(index, {
                [key]: (currentCam as any)[key] || {
                    InterpolationType: 0,
                    GlobalSeqId: null,
                    Keys: [{ Frame: 0, Vector: [0, 0, 0] }]
                }
            })
        } else {
            updateCamera(index, { [key]: undefined } as any)
        }
    }

    const openEditor = (index: number, field: string) => {
        setEditingBlock({ index, field })
        setEditorVisible(true)
    }

    const handleEditorSave = (result: any) => {
        if (!editingBlock) return
        const { index, field } = editingBlock
        updateCamera(index, { [field]: result })
        setEditorVisible(false)
        setEditingBlock(null)
    }

    const renderListItem = (item: any, index: number, isSelected: boolean) => (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: isSelected ? '#fff' : '#b0b0b0'
            }}
        >
            <span>{item.Name || `Camera ${index}`}</span>
        </div>
    )

    const renderDetail = (item: any, index: number) => {
        const cam = item as CameraNode
        const isArrayLike = (v: any) => Array.isArray(v) || v instanceof Float32Array || ArrayBuffer.isView(v)
        const toArray = (v: any) => (v instanceof Float32Array ? Array.from(v) : v)

        const getPos = (prop: any, directProp?: any) => {
            if (directProp && isArrayLike(directProp)) return toArray(directProp)
            if (isArrayLike(prop)) return toArray(prop)
            if (prop && prop.Keys && prop.Keys.length > 0) {
                const v = prop.Keys[0].Vector
                return v ? toArray(v) : [0, 0, 0]
            }
            return [0, 0, 0]
        }

        const pos = getPos(cam.Translation, (cam as any).Position)
        const target = getPos(cam.TargetTranslation, (cam as any).TargetPosition)

        const VectorInputs = ({ value, onChange, label }: { value: number[], onChange: (val: number[]) => void, label: string }) => (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ color: '#ccc', marginBottom: 4 }}>{label}</div>
                {['X', 'Y', 'Z'].map((axis, i) => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ color: '#888', width: 20 }}>{axis}: </span>
                        <InputNumber
                            size="small"
                            style={{ flex: 1, background: '#222', borderColor: '#444', color: '#fff' }}
                            value={value[i]}
                            onChange={(v) => {
                                const newVal = [...value]
                                newVal[i] = v || 0
                                onChange(newVal)
                            }}
                        />
                    </div>
                ))}
            </div>
        )

        const updateStaticPos = (key: 'Translation' | 'TargetTranslation', newVal: number[]) => {
            const block = (cam as any)[key]
            const newBlock = block ? { ...block } : { InterpolationType: 0, GlobalSeqId: null, Keys: [{ Frame: 0, Vector: newVal }] }
            if (newBlock.Keys && newBlock.Keys.length > 0) {
                newBlock.Keys[0].Vector = newVal
            } else {
                newBlock.Keys = [{ Frame: 0, Vector: newVal }]
            }
            updateCamera(index, { [key]: newBlock })
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, border: '1px solid #484848', padding: 8 }}>
                    <span style={{ color: '#ccc', marginRight: 8 }}>Name:</span>
                    <Input
                        value={cam.Name}
                        onChange={(e) => updateCamera(index, { Name: e.target.value })}
                        style={{ background: '#222', borderColor: '#444', color: '#fff' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: 16 }}>
                    <Card size="small" title="Camera Position" style={{ background: '#333', borderColor: '#444', flex: 1 }} headStyle={{ color: '#ddd' }}>
                        <VectorInputs value={pos} onChange={(v) => updateStaticPos('Translation', v)} label="" />
                        <div style={{ marginTop: 8 }}>
                            <Checkbox
                                checked={!!cam.Translation && (cam.Translation.Keys?.length > 1 || cam.Translation.GlobalSeqId !== null)}
                                onChange={(e) => toggleBlock(index, 'Translation', e.target.checked)}
                                style={{ color: '#ccc' }}
                            >
                                Animate
                            </Checkbox>
                            <Button size="small" style={{ width: '100%', marginTop: 4 }} onClick={() => openEditor(index, 'Translation')}>
                                Edit Translation
                            </Button>
                        </div>
                    </Card>

                    <Card size="small" title="Target Position" style={{ background: '#333', borderColor: '#444', flex: 1 }} headStyle={{ color: '#ddd' }}>
                        <VectorInputs value={target} onChange={(v) => updateStaticPos('TargetTranslation', v)} label="" />
                        <div style={{ marginTop: 8 }}>
                            <Checkbox
                                checked={!!cam.TargetTranslation}
                                onChange={(e) => toggleBlock(index, 'TargetTranslation', e.target.checked)}
                                style={{ color: '#ccc' }}
                            >
                                Animate
                            </Checkbox>
                            <Button size="small" style={{ width: '100%', marginTop: 4 }} onClick={() => openEditor(index, 'TargetTranslation')}>
                                Edit Target
                            </Button>
                        </div>
                    </Card>
                </div>

                <Card size="small" title="Other" style={{ background: '#333', borderColor: '#444' }} headStyle={{ color: '#ddd' }}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <div style={{ color: '#aaa', marginBottom: 4 }}>Field of View:</div>
                            <InputNumber
                                style={{ width: '100%', background: '#222', borderColor: '#444', color: '#fff' }}
                                value={cam.FieldOfView}
                                onChange={(v) => updateCamera(index, { FieldOfView: v || 0 })}
                            />
                        </Col>
                        <Col span={12}>
                            <div style={{ color: '#aaa', marginBottom: 4 }}>Near Clip:</div>
                            <InputNumber
                                style={{ width: '100%', background: '#222', borderColor: '#444', color: '#fff' }}
                                value={cam.NearClip}
                                onChange={(v) => updateCamera(index, { NearClip: v || 0 })}
                            />
                        </Col>
                    </Row>
                    <Row gutter={16} style={{ marginTop: 8 }}>
                        <Col span={12}>
                            <div style={{ color: '#aaa', marginBottom: 4 }}>Far Clip:</div>
                            <InputNumber
                                style={{ width: '100%', background: '#222', borderColor: '#444', color: '#fff' }}
                                value={cam.FarClip}
                                onChange={(v) => updateCamera(index, { FarClip: v || 0 })}
                            />
                        </Col>
                    </Row>
                    <div style={{ marginTop: 12 }}>
                        <Checkbox
                            checked={!!cam.Rotation}
                            onChange={(e) => toggleBlock(index, 'Rotation', e.target.checked)}
                            style={{ color: '#ccc' }}
                        >
                            Animate Rotation
                        </Checkbox>
                        <Button size="small" style={{ marginLeft: 8 }} onClick={() => openEditor(index, 'Rotation')}>
                            Edit Rotation
                        </Button>
                    </div>
                </Card>
            </div>
        )
    }

    const getCurrentEditorData = () => {
        if (!editingBlock || selectedIndex < 0) return null
        const cam = cameras[editingBlock.index]
        if (!cam) return null
        return (cam as any)[editingBlock.field]
    }

    const extraButtons = (
        <Space size={4}>
            <Tooltip title="Add from current view">
                <Button
                    type="text"
                    size="small"
                    icon={<CameraOutlined />}
                    onClick={onAddFromView}
                    style={{ color: '#1677ff' }}
                />
            </Tooltip>
            <Tooltip title="View selected camera">
                <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    disabled={selectedIndex < 0}
                    onClick={() => {
                        if (selectedIndex >= 0 && onViewCamera) {
                            onViewCamera(cameras[selectedIndex])
                        }
                    }}
                    style={{ color: selectedIndex < 0 ? '#666' : '#52c41a', opacity: selectedIndex < 0 ? 0.5 : 1 }}
                />
            </Tooltip>
        </Space>
    )

    const renderManagerContent = (contentHeight: string | number = 650) => (
        <div style={{ height: contentHeight, background: '#222', border: '1px solid #444' }}>
            <MasterDetailLayout
                items={cameras}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                renderListItem={renderListItem}
                renderDetail={renderDetail}
                onAdd={handleAdd}
                onDelete={handleDelete}
                listTitle="Camera List"
                detailTitle="Camera Properties"
                listWidth={200}
                extraButtons={extraButtons}
            />
        </div>
    )

    if (asWindow) {
        if (!visible) return null
        return (
            <>
                <div style={{ height: '100vh', padding: 12, backgroundColor: '#1f1f1f', overflow: 'hidden' }}>
                    {renderManagerContent('calc(100vh - 24px)')}
                </div>
                {editorVisible && (
                    <KeyframeEditor
                        visible={editorVisible}
                        onCancel={() => setEditorVisible(false)}
                        onOk={handleEditorSave}
                        initialData={getCurrentEditorData()}
                        title={`Edit ${editingBlock?.field}`}
                        vectorSize={3}
                        globalSequences={globalSequences}
                    />
                )}
            </>
        )
    }

    return (
        <>
            <DraggableModal
                title="Camera Manager"
                open={visible}
                onCancel={onClose}
                width={850}
                footer={null}
                wrapClassName="dark-theme-modal"
            >
                {renderManagerContent()}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button type="primary" onClick={onClose} style={{ marginRight: 8 }}>Confirm</Button>
                    <Button onClick={onClose}>Cancel</Button>
                </div>
            </DraggableModal>

            {editorVisible && (
                <KeyframeEditor
                    visible={editorVisible}
                    onCancel={() => setEditorVisible(false)}
                    onOk={handleEditorSave}
                    initialData={getCurrentEditorData()}
                    title={`Edit ${editingBlock?.field}`}
                    vectorSize={3}
                    globalSequences={globalSequences}
                />
            )}
        </>
    )
}

export default CameraManagerModal
