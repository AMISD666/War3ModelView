import React, { useState, useEffect } from 'react'
import { Button, Tooltip, Modal } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import MaterialList from './material/MaterialList'
import MaterialDetail from './material/MaterialDetail'
import LayerDetail from './material/LayerDetail'

interface MaterialEditorProps {
    model: any
    onUpdate: () => void
}

const MaterialEditor: React.FC<MaterialEditorProps> = ({ model, onUpdate }) => {
    const [materials, setMaterials] = useState<any[]>([])
    const [selectedMaterialIndex, setSelectedMaterialIndex] = useState<number>(-1)
    const [selectedLayerIndex, setSelectedLayerIndex] = useState<number>(-1)

    // Modal visibility states
    const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false)
    const [isLayerModalOpen, setIsLayerModalOpen] = useState(false)

    useEffect(() => {
        if (model && model.Materials) {
            setMaterials(JSON.parse(JSON.stringify(model.Materials)))
        } else {
            setMaterials([])
        }
    }, [model])

    // const handleUpdate = () => {
    //     if (model) {
    //         model.Materials = JSON.parse(JSON.stringify(materials))
    //         onUpdate()
    //     }
    // }

    const updateMaterial = (updatedMaterial: any) => {
        const newMaterials = [...materials]
        newMaterials[selectedMaterialIndex] = updatedMaterial
        setMaterials(newMaterials)

        // Auto-save
        if (model) {
            model.Materials = JSON.parse(JSON.stringify(newMaterials))
            onUpdate()
        }
    }

    const updateLayer = (updatedLayer: any) => {
        const newMaterials = [...materials]
        newMaterials[selectedMaterialIndex].Layers[selectedLayerIndex] = updatedLayer
        setMaterials(newMaterials)

        // Auto-save
        if (model) {
            model.Materials = JSON.parse(JSON.stringify(newMaterials))
            onUpdate()
        }
    }

    if (!model) return <div style={{ padding: 20, color: '#aaa' }}>未加载模型</div>

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px' }}>
            {/* Header / Reset Button */}
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <Tooltip title="重置">
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={() => {
                            if (model && model.Materials) {
                                setMaterials(JSON.parse(JSON.stringify(model.Materials)))
                            }
                        }}
                    />
                </Tooltip>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <MaterialList
                    materials={materials}
                    onSelect={(index) => {
                        setSelectedMaterialIndex(index)
                        setIsMaterialModalOpen(true)
                    }}
                />
            </div>

            {/* Level 2: Material Detail Modal */}
            <Modal
                title={`材质 [${selectedMaterialIndex}] 设置`}
                open={isMaterialModalOpen}
                onCancel={() => setIsMaterialModalOpen(false)}
                footer={null}
                width={600}
                centered
                maskClosable={false}
                destroyOnClose
            >
                {selectedMaterialIndex !== -1 && materials[selectedMaterialIndex] && (
                    <MaterialDetail
                        material={materials[selectedMaterialIndex]}
                        _index={selectedMaterialIndex}
                        onUpdate={updateMaterial}
                        onSelectLayer={(layerIndex) => {
                            setSelectedLayerIndex(layerIndex)
                            setIsLayerModalOpen(true)
                        }}
                        _onBack={() => setIsMaterialModalOpen(false)}
                    />
                )}
            </Modal>

            {/* Level 3: Layer Detail Modal */}
            <Modal
                title={`材质 [${selectedMaterialIndex}] - 图层 [${selectedLayerIndex}] 设置`}
                open={isLayerModalOpen}
                onCancel={() => setIsLayerModalOpen(false)}
                footer={null}
                width={700}
                centered
                maskClosable={false}
                destroyOnClose
                zIndex={1001} // Ensure it's above the first modal
            >
                {selectedMaterialIndex !== -1 && selectedLayerIndex !== -1 && materials[selectedMaterialIndex]?.Layers?.[selectedLayerIndex] && (
                    <LayerDetail
                        layer={materials[selectedMaterialIndex].Layers[selectedLayerIndex]}
                        model={model}
                        onUpdate={updateLayer}
                        _onBack={() => setIsLayerModalOpen(false)}
                    />
                )}
            </Modal>
        </div>
    )
}

export default MaterialEditor
