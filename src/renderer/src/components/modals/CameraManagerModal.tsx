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
            name: '添加摄像机',
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
            name: '删除摄像机',
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
            name: '更新摄像机',
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
                color: isSelected ? '#fff' : '#b0b0b0',
                fontSize: '13px',
                padding: '4px 0'
            }}
        >
            <span>{item.Name || `摄像机 ${index}`}</span>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {label && <div style={{ color: '#888', fontSize: '11px', marginBottom: 2 }}>{label}</div>}
                {['X', 'Y', 'Z'].map((axis, i) => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ color: '#666', width: 16, fontSize: '11px' }}>{axis}</span>
                        <InputNumber
                            size="small"
                            style={{ flex: 1, background: '#1a1a1a', borderColor: '#333', color: '#fff', fontSize: '12px' }}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, border: '1px solid #444', padding: '4px 8px', borderRadius: 4, background: '#222' }}>
                    <span style={{ color: '#aaa', marginRight: 8, fontSize: '12px' }}>名称:</span>
                    <Input
                        size="small"
                        value={cam.Name}
                        onChange={(e) => updateCamera(index, { Name: e.target.value })}
                        style={{ background: '#1a1a1a', borderColor: '#333', color: '#fff', fontSize: '13px' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                    <Card size="small" title={<span style={{ fontSize: '12px' }}>摄像机位置</span>} style={{ background: '#2d2d2d', borderColor: '#444', flex: 1 }} styles={{ header: { padding: '4px 12px', minHeight: 0 }, body: { padding: '8px' } }}>
                        <VectorInputs value={pos} onChange={(v) => updateStaticPos('Translation', v)} label="" />
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Checkbox
                                checked={!!cam.Translation && (cam.Translation.Keys?.length > 1 || cam.Translation.GlobalSeqId !== null)}
                                onChange={(e) => toggleBlock(index, 'Translation', e.target.checked)}
                                style={{ color: '#ccc', fontSize: '12px' }}
                            >
                                动画
                            </Checkbox>
                            <Button size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: '12px' }} onClick={() => openEditor(index, 'Translation')}>
                                编辑关键帧
                            </Button>
                        </div>
                    </Card>

                    <Card size="small" title={<span style={{ fontSize: '12px' }}>目标位置</span>} style={{ background: '#2d2d2d', borderColor: '#444', flex: 1 }} styles={{ header: { padding: '4px 12px', minHeight: 0 }, body: { padding: '8px' } }}>
                        <VectorInputs value={target} onChange={(v) => updateStaticPos('TargetTranslation', v)} label="" />
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Checkbox
                                checked={!!cam.TargetTranslation}
                                onChange={(e) => toggleBlock(index, 'TargetTranslation', e.target.checked)}
                                style={{ color: '#ccc', fontSize: '12px' }}
                            >
                                动画
                            </Checkbox>
                            <Button size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: '12px' }} onClick={() => openEditor(index, 'TargetTranslation')}>
                                编辑关键帧
                            </Button>
                        </div>
                    </Card>
                </div>

                <Card size="small" title={<span style={{ fontSize: '12px' }}>裁剪与设置</span>} style={{ background: '#2d2d2d', borderColor: '#444' }} styles={{ header: { padding: '4px 12px', minHeight: 0 }, body: { padding: '12px' } }}>
                    <Row gutter={[12, 12]}>
                        <Col span={8}>
                            <div style={{ color: '#888', marginBottom: 2, fontSize: '11px' }}>视场角:</div>
                            <InputNumber
                                size="small"
                                style={{ width: '100%', background: '#1a1a1a', borderColor: '#333', color: '#fff' }}
                                value={cam.FieldOfView}
                                onChange={(v) => updateCamera(index, { FieldOfView: v || 0 })}
                            />
                        </Col>
                        <Col span={8}>
                            <div style={{ color: '#888', marginBottom: 2, fontSize: '11px' }}>近裁面:</div>
                            <InputNumber
                                size="small"
                                style={{ width: '100%', background: '#1a1a1a', borderColor: '#333', color: '#fff' }}
                                value={cam.NearClip}
                                onChange={(v) => updateCamera(index, { NearClip: v || 0 })}
                            />
                        </Col>
                        <Col span={8}>
                            <div style={{ color: '#888', marginBottom: 2, fontSize: '11px' }}>远裁面:</div>
                            <InputNumber
                                size="small"
                                style={{ width: '100%', background: '#1a1a1a', borderColor: '#333', color: '#fff' }}
                                value={cam.FarClip}
                                onChange={(v) => updateCamera(index, { FarClip: v || 0 })}
                            />
                        </Col>
                    </Row>
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Checkbox
                            checked={!!cam.Rotation}
                            onChange={(e) => toggleBlock(index, 'Rotation', e.target.checked)}
                            style={{ color: '#ccc', fontSize: '12px' }}
                        >
                            旋转动画
                        </Checkbox>
                        <Button size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: '12px' }} onClick={() => openEditor(index, 'Rotation')}>
                            编辑旋转关键帧
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
            <Tooltip title="从当前视角添加">
                <Button
                    type="text"
                    size="small"
                    icon={<CameraOutlined />}
                    onClick={onAddFromView}
                    style={{ color: '#1677ff' }}
                />
            </Tooltip>
            <Tooltip title="查看选中的摄像机">
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
                listTitle="摄像机列表"
                detailTitle="摄像机属性"
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
                        title={`编辑 ${editingBlock?.field}`}
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
                title="摄像机管理器"
                open={visible}
                onCancel={onClose}
                width={850}
                footer={null}
                wrapClassName="dark-theme-modal"
            >
                {renderManagerContent()}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <Button type="primary" onClick={onClose} style={{ marginRight: 8 }}>确认</Button>
                    <Button onClick={onClose}>取消</Button>
                </div>
            </DraggableModal>

            {editorVisible && (
                <KeyframeEditor
                    visible={editorVisible}
                    onCancel={() => setEditorVisible(false)}
                    onOk={handleEditorSave}
                    initialData={getCurrentEditorData()}
                    title={`编辑 ${editingBlock?.field}`}
                    vectorSize={3}
                    globalSequences={globalSequences}
                />
            )}
        </>
    )
}

export default CameraManagerModal
