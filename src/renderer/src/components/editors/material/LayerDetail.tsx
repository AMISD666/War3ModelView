import React, { useState } from 'react'
import { Checkbox, Button, Select, Space } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { EditOutlined } from '@ant-design/icons'
import KeyframeEditor from '../KeyframeEditor'
import { useModelStore } from '../../../store/modelStore'
import TextureAnimationManagerModal from '../../modals/TextureAnimationManagerModal'

interface LayerDetailProps {
    layer: any
    onUpdate: (updatedLayer: any) => void
    _onBack: () => void
}

const LayerDetail: React.FC<LayerDetailProps> = ({ layer, onUpdate }) => {
    const modelData = useModelStore(state => state.modelData)
    const [isKeyframeEditorOpen, setIsKeyframeEditorOpen] = useState(false)
    const [isAnimManagerOpen, setIsAnimManagerOpen] = useState(false)
    const [editingField, setEditingField] = useState<string | null>(null)
    const [editingVectorSize, setEditingVectorSize] = useState(1)

    const handleChange = (field: string, value: any) => {
        onUpdate({ ...layer, [field]: value })
    }

    const handleAnimToggle = (field: string, checked: boolean, vectorSize: number = 1) => {
        if (checked) {
            // Convert to AnimVector
            const currentVal = layer[field]
            // For TextureID, default to 0 (first texture); for Alpha, default to 1
            const defaultVal = field === 'TextureID' ? 0 : 1
            const initialVal = typeof currentVal === 'number' ? currentVal : defaultVal

            // Create default AnimVector structure
            const animVector = {
                Keys: [
                    { Frame: 0, Vector: vectorSize === 1 ? [initialVal] : new Array(vectorSize).fill(0) }
                ],
                LineType: 0,
                GlobalSeqId: null
            }
            handleChange(field, animVector)
        } else {
            // Convert to static value (take first key or default)
            const currentVal = layer[field]
            // For TextureID, default to 0; for Alpha, default to 1
            let staticVal = field === 'TextureID' ? 0 : 1
            if (currentVal && currentVal.Keys && currentVal.Keys.length > 0) {
                staticVal = currentVal.Keys[0].Vector[0]
            }
            handleChange(field, staticVal)
        }
    }

    const openKeyframeEditor = (field: string, vectorSize: number) => {
        setEditingField(field)
        setEditingVectorSize(vectorSize)
        setIsKeyframeEditorOpen(true)
    }

    const handleKeyframeSave = (animVector: any) => {
        if (editingField) {
            handleChange(editingField, animVector)
        }
        setIsKeyframeEditorOpen(false)
    }

    const filterModeOptions = [
        { value: 0, label: 'None' },
        { value: 1, label: 'Transparent' },
        { value: 2, label: 'Blend' },
        { value: 3, label: 'Additive' },
        { value: 4, label: 'Add Alpha' },
        { value: 5, label: 'Modulate' },
        { value: 6, label: 'Modulate 2X' },
    ]

    const textureOptions = (modelData as any)?.Textures?.map((t: any, i: number) => ({
        value: i,
        label: `[${i}] ${t.Image ? t.Image.split(/[\\/]/).pop() : '无路径'}`
    })) || []

    const textureAnimOptions = (modelData as any)?.TextureAnims?.map((_t: any, i: number) => ({
        value: i,
        label: `TextureAnim ${i}`
    })) || []

    const isAlphaAnimated = layer.Alpha && typeof layer.Alpha !== 'number'
    const isTextureIDAnimated = layer.TextureID && typeof layer.TextureID !== 'number'

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px' }}>
            {/* Row 1: Texture ID (Full Width) */}
            <div style={{ border: '1px solid #444', padding: 10, borderRadius: 4, marginBottom: 10 }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#aaa' }}>贴图 ID:</h4>
                <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Checkbox
                        checked={isTextureIDAnimated}
                        onChange={(e) => handleAnimToggle('TextureID', e.target.checked, 1)}
                    >
                        动态
                    </Checkbox>
                    {!isTextureIDAnimated && (
                        <Select
                            size="small"
                            style={{ flex: 1 }}
                            value={typeof layer.TextureID === 'number' ? layer.TextureID : 0}
                            onChange={(v) => handleChange('TextureID', v)}
                            options={textureOptions}
                        />
                    )}
                    {isTextureIDAnimated && (
                        <>
                            <div style={{ color: '#888', fontSize: 12, flex: 1 }}>
                                已动态化，点击"编辑动画"修改关键帧
                            </div>
                            <Button
                                size="small"
                                onClick={() => openKeyframeEditor('TextureID', 1)}
                            >
                                编辑动画
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Row 2: Alpha + Filter Mode + Texture Animation */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                {/* Alpha */}
                <div style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#aaa' }}>透明度 (Alpha):</h4>
                    <div style={{ marginBottom: 10 }}>
                        <Checkbox
                            checked={isAlphaAnimated}
                            onChange={(e) => handleAnimToggle('Alpha', e.target.checked, 1)}
                        >
                            动态
                        </Checkbox>
                    </div>
                    <Space>
                        <Button
                            size="small"
                            disabled={!isAlphaAnimated}
                            onClick={() => openKeyframeEditor('Alpha', 1)}
                        >
                            编辑动画
                        </Button>
                        {!isAlphaAnimated && (
                            <InputNumber
                                size="small"
                                value={typeof layer.Alpha === 'number' ? layer.Alpha : 1}
                                onChange={(v) => handleChange('Alpha', v)}
                                step={0.1}
                                min={0}
                                max={1}
                                precision={2}
                            />
                        )}
                    </Space>
                </div>

                {/* Filter Mode */}
                <div style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#aaa' }}>过滤模式:</h4>
                    <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={layer.FilterMode}
                        onChange={(v) => handleChange('FilterMode', v)}
                        options={filterModeOptions}
                    />
                </div>

                {/* Texture Animation */}
                <div style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#aaa' }}>纹理动画 (TVertexAnim):</h4>
                    <Space style={{ width: '100%' }}>
                        <Select
                            size="small"
                            style={{ width: '100%' }}
                            allowClear
                            placeholder="None"
                            value={layer.TVertexAnimId}
                            onChange={(v) => handleChange('TVertexAnimId', v)}
                            options={textureAnimOptions}
                        />
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => setIsAnimManagerOpen(true)}
                        />
                    </Space>
                </div>
            </div>

            {/* Row 3: Flags */}
            <div style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#aaa' }}>标记 (Flags)</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                    <Checkbox checked={layer.Unshaded} onChange={(e) => handleChange('Unshaded', e.target.checked)}>无阴影 (Unshaded)</Checkbox>
                    <Checkbox checked={layer.Unfogged} onChange={(e) => handleChange('Unfogged', e.target.checked)}>无迷雾 (Unfogged)</Checkbox>
                    <Checkbox checked={layer.TwoSided} onChange={(e) => handleChange('TwoSided', e.target.checked)}>双面的 (Two Sided)</Checkbox>
                    <Checkbox checked={layer.SphereEnvMap} onChange={(e) => handleChange('SphereEnvMap', e.target.checked)}>球面环境贴图</Checkbox>
                    <Checkbox checked={layer.NoDepthTest} onChange={(e) => handleChange('NoDepthTest', e.target.checked)}>无深度测试</Checkbox>
                    <Checkbox checked={layer.NoDepthSet} onChange={(e) => handleChange('NoDepthSet', e.target.checked)}>无深度设置</Checkbox>
                </div>
            </div>

            {/* Keyframe Editor Modal */}
            {editingField && (
                <KeyframeEditor
                    visible={isKeyframeEditorOpen}
                    onCancel={() => setIsKeyframeEditorOpen(false)}
                    onOk={handleKeyframeSave}
                    initialData={layer[editingField]}
                    title={`Edit ${editingField}`}
                    vectorSize={editingVectorSize}
                    globalSequences={(modelData as any)?.GlobalSequences || []}
                    fieldName={editingField || ''}
                />
            )}

            {/* Texture Animation Manager Modal */}
            <TextureAnimationManagerModal
                visible={isAnimManagerOpen}
                onClose={() => setIsAnimManagerOpen(false)}
            />
        </div>
    )
}

export default LayerDetail

