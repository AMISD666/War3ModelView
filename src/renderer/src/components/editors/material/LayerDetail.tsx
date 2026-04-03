import React, { useState } from 'react'
import { Checkbox, Button, Select, Space } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { EditOutlined } from '@ant-design/icons'
import { listen } from '@tauri-apps/api/event'
import { windowManager } from '../../../utils/WindowManager'
import { useModelStore } from '../../../store/modelStore'
import TextureAnimationManagerModal from '../../modals/TextureAnimationManagerModal'
import { MATERIAL_FILTER_MODE_OPTIONS } from '../../../constants/filterModes'

interface LayerDetailProps {
    layer: any
    onUpdate: (updatedLayer: any) => void
    _onBack: () => void
}

const isAnimTrack = (value: any): value is { Keys: any[]; LineType?: number; GlobalSeqId?: number | null; InterpolationType?: number } => (
    !!value && typeof value === 'object' && Array.isArray(value.Keys)
)

const LayerDetail: React.FC<LayerDetailProps> = ({ layer, onUpdate }) => {
    const modelData = useModelStore(state => state.modelData)
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

    React.useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any;
            if (payload && payload.callerId === 'LayerDetail') {
                if (editingField) {
                    handleChange(editingField, payload.data)
                }
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [editingField, layer]);

    const openKeyframeEditor = (field: string, vectorSize: number) => {
        setEditingField(field)
        setEditingVectorSize(vectorSize)

        const payload = {
            callerId: 'LayerDetail',
            initialData: layer[field],
            title: `编辑 ${field}`,
            vectorSize,
            globalSequences: (modelData?.GlobalSequences || [])
                .map((g: any) => (typeof g === 'number' ? g : g?.Duration))
                .filter((v: any) => typeof v === 'number'),
            sequences: modelData?.Sequences || [],
            fieldName: field
        };

        const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
        payload.targetWindowId = windowId;

        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload);
    }

    const textureOptions = (modelData as any)?.Textures?.map((t: any, i: number) => ({
        value: i,
        label: `[${i}] ${t.Image ? t.Image.split(/[\\/]/).pop() : '无路径'}`
    })) || []

    const textureAnimOptions = (modelData as any)?.TextureAnims?.map((_t: any, i: number) => ({
        value: i,
        label: `TextureAnim ${i}`
    })) || []

    const isAlphaAnimated = isAnimTrack(layer.Alpha)
    const isTextureIDAnimated = isAnimTrack(layer.TextureID)

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
                        options={MATERIAL_FILTER_MODE_OPTIONS as any}
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

            {/* Texture Animation Manager Modal */}
            <TextureAnimationManagerModal
                visible={isAnimManagerOpen}
                onClose={() => setIsAnimManagerOpen(false)}
            />
        </div>
    )
}

export default LayerDetail
