import React, { useState } from 'react'
import { useModelStore } from '../../store/modelStore'
import { Card, List, Checkbox, Button, Select, Typography } from 'antd'
import type { Color } from 'antd/es/color-picker'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { ColorPicker } from '@renderer/components/common/EnhancedColorPicker'
import { PlusOutlined } from '@ant-design/icons'
import { coercePivotFloat3 } from 'war3-model'

const { Text } = Typography
const { Option } = Select

const GeosetAnimationEditor: React.FC = () => {
    const { modelData, updateGeosetAnim } = useModelStore()
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)

    const geosetAnims = modelData?.GeosetAnims || []
    const geosets = modelData?.Geosets || []

    const selectedAnim = selectedIndex >= 0 ? geosetAnims[selectedIndex] : null

    const handleColorChange = (color: Color) => {
        if (selectedIndex < 0) return
        const rgb = color.toRgb()
        // War3 uses 0-1 float for color
        const newColor: [number, number, number] = [rgb.r / 255, rgb.g / 255, rgb.b / 255]
        updateGeosetAnim(selectedIndex, { Color: newColor })
    }

    const handleAlphaChange = (val: number | null) => {
        if (selectedIndex < 0 || val === null) return
        updateGeosetAnim(selectedIndex, { Alpha: val })
    }

    const handleGeosetChange = (val: number) => {
        if (selectedIndex < 0) return
        updateGeosetAnim(selectedIndex, { GeosetId: val })
    }

    const handleUseColorChange = (e: any) => {
        if (selectedIndex < 0) return
        updateGeosetAnim(selectedIndex, { UseColor: e.target.checked })
    }

    const handleDropShadowChange = (e: any) => {
        if (selectedIndex < 0) return
        updateGeosetAnim(selectedIndex, { DropShadow: e.target.checked })
    }

    // Helper to check if property is dynamic (has keys)
    const isDynamic = (prop: any) => {
        return prop && typeof prop === 'object' && !Array.isArray(prop) && 'Keys' in prop
    }

    // Helper to get static color or default
    const getColor = (anim: any) => {
        if (!anim || anim.Color == null) return '#ffffff'
        if (ArrayBuffer.isView(anim.Color)) {
            const c = coercePivotFloat3(anim.Color as Float32Array | Uint8Array | number[])
            if (c) {
                return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
            }
        }
        if (Array.isArray(anim.Color)) {
            const [r, g, b] = anim.Color
            return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
        }
        return '#ffffff'
    }

    const getAlpha = (anim: any) => {
        if (!anim || anim.Alpha === undefined) return 1
        if (typeof anim.Alpha === 'number') return anim.Alpha
        return 1
    }

    return (
        <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
            <div style={{ padding: '10px', borderBottom: '1px solid #303030' }}>
                <Button type="primary" icon={<PlusOutlined />} block>
                    添加多边形动画
                </Button>
            </div>
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* List */}
                <div style={{ width: '200px', borderRight: '1px solid #303030', overflowY: 'auto' }}>
                    <List
                        dataSource={geosetAnims}
                        renderItem={(_item, index) => (
                            <List.Item
                                onClick={() => setSelectedIndex(index)}
                                style={{
                                    cursor: 'pointer',
                                    padding: '8px 12px',
                                    backgroundColor: selectedIndex === index ? '#177ddc' : 'transparent',
                                    color: selectedIndex === index ? '#fff' : 'inherit'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                    <span>GeosetAnim {index}</span>
                                    {/* <DeleteOutlined /> */}
                                </div>
                            </List.Item>
                        )}
                    />
                </div>

                {/* Details */}
                <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
                    {selectedAnim ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Color Section */}
                            <Card title="颜色" size="small" bordered={false} style={{ background: '#1f1f1f' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                                    <Checkbox checked={isDynamic(selectedAnim.Color)}>动态化</Checkbox>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <Button>颜色</Button>
                                    <ColorPicker
                                        value={getColor(selectedAnim)}
                                        onChange={handleColorChange}
                                        disabled={isDynamic(selectedAnim.Color)}
                                    />
                                </div>
                            </Card>

                            {/* Alpha Section */}
                            <Card title="透明度" size="small" bordered={false} style={{ background: '#1f1f1f' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                                    <Checkbox checked={isDynamic(selectedAnim.Alpha)}>动态化</Checkbox>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <Button>透明度</Button>
                                    <InputNumber
                                        value={getAlpha(selectedAnim)}
                                        onChange={handleAlphaChange}
                                        step={0.1}
                                        min={0}
                                        max={1}
                                        disabled={isDynamic(selectedAnim.Alpha)}
                                    />
                                </div>
                            </Card>

                            {/* Other Section */}
                            <Card title="其他" size="small" bordered={false} style={{ background: '#1f1f1f' }}>
                                <div style={{ marginBottom: '16px' }}>
                                    <Text style={{ display: 'block', marginBottom: '8px' }}>多边形 ID:</Text>
                                    <Select
                                        style={{ width: '100%' }}
                                        value={selectedAnim.GeosetId}
                                        onChange={handleGeosetChange}
                                    >
                                        {geosets.map((_, idx) => (
                                            <Option key={idx} value={idx}>
                                                Geoset {idx}
                                            </Option>
                                        ))}
                                    </Select>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <Checkbox
                                        checked={selectedAnim.UseColor === undefined ? true : selectedAnim.UseColor} // Default true if undefined?
                                        onChange={handleUseColorChange}
                                    >
                                        使用颜色 (Use Color)
                                    </Checkbox>
                                    <Checkbox
                                        checked={selectedAnim.DropShadow}
                                        onChange={handleDropShadowChange}
                                    >
                                        阴影效果 (Drop Shadow)
                                    </Checkbox>
                                </div>
                            </Card>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#666' }}>
                            请选择一个多边形动画
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default GeosetAnimationEditor
