import React, { useState, useEffect, useRef } from 'react'
import { List, Checkbox, Button, Select, Card, Typography } from 'antd'
import type { Color } from 'antd/es/color-picker'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { ColorPicker } from '@renderer/components/common/EnhancedColorPicker'
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useHistoryStore } from '../../store/historyStore'
import { PlusOutlined, EditOutlined, DeleteOutlined, CloseOutlined } from '@ant-design/icons'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
import { useRpcClient } from '../../hooks/useRpc'
import { useWindowEvent } from '../../hooks/useWindowEvent'
import { windowManager } from '../../utils/WindowManager'
import { coercePivotFloat3 } from '../../utils/pivotUtils'
import { vectorToPlainArray } from '../../utils/animVectorIpc'
import { toFloat32Array } from '../../utils/modelUtils'

const { Text } = Typography
const { Option } = Select

interface GeosetAnimationModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
}

const GeosetAnimationModal: React.FC<GeosetAnimationModalProps> = ({ visible, onClose, isStandalone }) => {
    const { modelData, updateGeosetAnim, setGeosetAnims } = useModelStore()
    const { state: rpcState, emitCommand } = useRpcClient<any>('geosetAnimManager', { geosets: [], geosetAnims: [], globalSequences: [], pickedGeosetIndex: null })

    const [localAnims, setLocalAnims] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [geosets, setGeosets] = useState<any[]>([])
    const listRef = useRef<HTMLDivElement>(null)
    const lastAnimGeoSigRef = useRef('')

    const scrollToItem = (index: number) => {
        if (listRef.current && index >= 0) {
            const itemHeight = 46
            listRef.current.scrollTop = index * itemHeight
        }
    }
    const cloneAnimVector = (animVector: any, size: number) => {

        if (!animVector || typeof animVector !== 'object') return animVector
        const toArray = (val: any): number[] => {
            const values = vectorToPlainArray(val).slice(0, size)
            if (values.length >= size) {
                return values
            }
            if (values.length > 0) {
                return [...values, ...new Array(size - values.length).fill(0)]
            }
            return new Array(size).fill(0)
        }
        const keys = (animVector.Keys || []).map((k: any) => ({
            Frame: typeof k.Frame === 'number' ? k.Frame : (k.Time ?? 0),
            Vector: toArray(k.Vector),
            InTan: toArray(k.InTan),
            OutTan: toArray(k.OutTan)
        }))
        return {
            LineType: typeof animVector.LineType === 'number' ? animVector.LineType : 0,
            GlobalSeqId: animVector.GlobalSeqId ?? null,
            Keys: keys
        }
    }

    // Keyframe Editor State
    const [editingField, setEditingField] = useState<string | null>(null)
    const [editingVectorSize, setEditingVectorSize] = useState(1)

    // Initialize local state when modal opens（仅当 RPC/模型数据内容真的变化时重建，避免周期性同步打断编辑）
    useEffect(() => {
        const currentAnims = isStandalone ? rpcState.geosetAnims : modelData?.GeosetAnims;
        const currentGeosets = isStandalone ? rpcState.geosets : modelData?.Geosets;

        if (!visible) {
            setLocalAnims([])
            setGeosets([])
            setSelectedIndex(-1)
            lastAnimGeoSigRef.current = ''
            return
        }

        const sig = JSON.stringify({ a: currentAnims, g: currentGeosets })
        if (sig === lastAnimGeoSigRef.current) {
            return
        }
        lastAnimGeoSigRef.current = sig

        if (currentAnims) {
            // Deep clone GeosetAnims, converting Float32Array to regular arrays
            const clonedAnims = (currentAnims || []).map((anim: any) => {
                const cloned: any = { ...anim }
                // 静态色：Float32Array / Uint8Array(msgpack) 用 coerce；勿对 12 字节 Uint8Array 只取前三个「字节」当 RGB
                if (anim.Color instanceof Float32Array || ArrayBuffer.isView(anim.Color)) {
                    const c = coercePivotFloat3(anim.Color as Float32Array | Uint8Array | number[])
                    cloned.Color = c ? [c[0], c[1], c[2]] : [1, 1, 1]
                } else if (Array.isArray(anim.Color)) {
                    cloned.Color = [...anim.Color]
                } else if (anim.Color && typeof anim.Color === 'object' && Array.isArray((anim.Color as any).Keys)) {
                    cloned.Color = cloneAnimVector(anim.Color, 3)
                } else if (anim.Color && typeof anim.Color === 'object') {
                    const c = coercePivotFloat3(anim.Color as Float32Array | Uint8Array | number[])
                    const t = c ?? toFloat32Array(anim.Color, 3)
                    cloned.Color = [t[0], t[1], t[2]]
                }
                // Clone Alpha if it's an AnimVector
                if (anim.Alpha && typeof anim.Alpha === 'object' && 'Keys' in anim.Alpha) {
                    cloned.Alpha = cloneAnimVector(anim.Alpha, 1)
                } else if (typeof anim.Alpha === 'string') {
                    cloned.Alpha = parseFloat(anim.Alpha)
                }
                return cloned
            })
            setLocalAnims(clonedAnims)
            setGeosets(currentGeosets || [])
            if (selectedIndex < 0 && clonedAnims.length > 0) {
                setSelectedIndex(0)
            } else if (clonedAnims.length === 0) {
                setSelectedIndex(-1)
            }
        } else {
            setLocalAnims([])
            setGeosets(Array.isArray(currentGeosets) ? currentGeosets : [])
            setSelectedIndex(-1)
        }
    }, [visible, isStandalone ? rpcState.geosetAnims : modelData?.GeosetAnims, isStandalone ? rpcState.geosets : modelData?.Geosets])

    // Subscribe to Ctrl+Click geoset picking - auto-select matching geoset animation
    useEffect(() => {
        if (!visible) return

        const handlePickedGeoset = (pickedGeosetIndex: number | null) => {
            if (pickedGeosetIndex === null || localAnims.length === 0) return
            const matchingIndex = localAnims.findIndex((anim: any) => anim.GeosetId === pickedGeosetIndex)
            if (matchingIndex !== -1) {
                setSelectedIndex(matchingIndex)
                setTimeout(() => scrollToItem(matchingIndex), 0)            }
        }

        if (isStandalone) {
            handlePickedGeoset(typeof rpcState.pickedGeosetIndex === 'number' ? rpcState.pickedGeosetIndex : null)
            return
        }

        const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
        handlePickedGeoset(initialPickedIndex)

        let lastPickedIndex: number | null = initialPickedIndex
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                handlePickedGeoset(pickedGeosetIndex)
            }
        })
        return unsubscribe
    }, [visible, localAnims, isStandalone, rpcState.pickedGeosetIndex])

    const saveToBackend = (anims: any[]) => {
        if (isStandalone) {
            emitCommand('EXECUTE_ANIM_ACTION', { action: 'UPDATE_GEOSET_ANIMS', payload: anims });
        } else if (setGeosetAnims) {
            setGeosetAnims(anims)
        } else {
            anims.forEach((anim, index) => {
                updateGeosetAnim(index, anim)
            })
        }
    }

    const handleOk = () => {
        if (!isStandalone) onClose()
    }

    const handleCancel = () => {
        if (!isStandalone) onClose()
    }

    const updateLocalAnim = (index: number, updates: any, persist: boolean = true) => {
        const newAnims = [...localAnims]
        newAnims[index] = { ...newAnims[index], ...updates }
        setLocalAnims(newAnims)
        if (persist) {
            saveToBackend(newAnims)
        }
    }

    const selectedAnim = selectedIndex >= 0 ? localAnims[selectedIndex] : null

    const handleColorChange = (color: Color, persist: boolean = true) => {
        if (selectedIndex < 0) return
        const rgb = color.toRgb()
        const newColor: [number, number, number] = [rgb.r / 255, rgb.g / 255, rgb.b / 255]
        updateLocalAnim(selectedIndex, { Color: newColor }, persist)
    }

    const handleAlphaChange = (val: number | null) => {
        if (selectedIndex < 0 || val === null) return
        updateLocalAnim(selectedIndex, { Alpha: Number(val) })
    }

    const handleGeosetChange = (val: number) => {
        if (selectedIndex < 0) return
        updateLocalAnim(selectedIndex, { GeosetId: val })
    }

    const handleUseColorChange = (e: any) => {
        if (selectedIndex < 0) return
        updateLocalAnim(selectedIndex, { UseColor: e.target.checked })
    }

    const handleDropShadowChange = (e: any) => {
        if (selectedIndex < 0) return
        updateLocalAnim(selectedIndex, { DropShadow: e.target.checked })
    }

    const handleDeleteAnim = (index: number) => {
        const newAnims = localAnims.filter((_, i) => i !== index)
        setLocalAnims(newAnims)
        saveToBackend(newAnims)
        if (selectedIndex === index) {
            setSelectedIndex(-1)
        } else if (selectedIndex > index) {
            setSelectedIndex(selectedIndex - 1)
        }
    }

    const isDynamic = (prop: any) => {
        return prop && typeof prop === 'object' && !Array.isArray(prop) && !(prop instanceof Float32Array) && 'Keys' in prop
    }

    const getColor = (anim: any) => {
        if (!anim || anim.Color == null) return '#ffffff'
        const colorData = anim.Color
        if (ArrayBuffer.isView(colorData)) {
            const c = coercePivotFloat3(colorData as Float32Array | Uint8Array | number[])
            if (c) {
                return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
            }
        }
        if (Array.isArray(colorData) && colorData.length >= 3) {
            const r = Number(colorData[0]) || 0
            const g = Number(colorData[1]) || 0
            const b = Number(colorData[2]) || 0
            return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
        }
        return '#ffffff'
    }

    const getAlpha = (anim: any) => {
        if (!anim) return 1
        if (typeof anim.Alpha === 'number') return anim.Alpha
        return 1
    }

    // Animation toggle handlers
    const handleColorAnimToggle = (checked: boolean) => {
        if (selectedIndex < 0) return
        const anim = localAnims[selectedIndex]

        if (checked) {
            // Convert static color to AnimVector
            const currentColor = anim.Color ?? [1, 1, 1]
            let colorArr: number[] = [1, 1, 1]
            if (Array.isArray(currentColor)) {
                colorArr = [Number(currentColor[0]), Number(currentColor[1]), Number(currentColor[2])]
            } else if (currentColor instanceof Float32Array || ArrayBuffer.isView(currentColor)) {
                const c = coercePivotFloat3(currentColor as Float32Array | Uint8Array | number[])
                if (c) colorArr = [c[0], c[1], c[2]]
            }
            const animVector = {
                Keys: [{ Frame: 0, Vector: colorArr }],
                LineType: 1,
                GlobalSeqId: null
            }
            updateLocalAnim(selectedIndex, { Color: animVector })
        } else {
            // Convert AnimVector to static color
            const currentColor = anim.Color
            let staticColor: number[] = [1, 1, 1]
            if (currentColor && currentColor.Keys && currentColor.Keys.length > 0) {
                const v = currentColor.Keys[0].Vector
                if (ArrayBuffer.isView(v)) {
                    const c = coercePivotFloat3(v as Float32Array | Uint8Array | number[])
                    staticColor = c ? [c[0], c[1], c[2]] : [1, 1, 1]
                } else if (Array.isArray(v)) {
                    staticColor = [Number(v[0]), Number(v[1]), Number(v[2])]
                }
            }
            updateLocalAnim(selectedIndex, { Color: staticColor })
        }
    }

    const handleAlphaAnimToggle = (checked: boolean) => {
        if (selectedIndex < 0) return
        const anim = localAnims[selectedIndex]

        if (checked) {
            // Convert static alpha to AnimVector
            const currentAlpha = typeof anim.Alpha === 'number' ? anim.Alpha : 1
            const animVector = {
                Keys: [{ Frame: 0, Vector: [currentAlpha] }],
                LineType: 1,
                GlobalSeqId: null
            }
            updateLocalAnim(selectedIndex, { Alpha: animVector })
        } else {
            // Convert AnimVector to static alpha
            const currentAlpha = anim.Alpha
            let staticAlpha = 1
            if (currentAlpha && currentAlpha.Keys && currentAlpha.Keys.length > 0) {
                staticAlpha = currentAlpha.Keys[0].Vector[0] || 1
            }
            updateLocalAnim(selectedIndex, { Alpha: staticAlpha })
        }
    }

    // Subscribe to IPC_KEYFRAME_SAVE for standalone returns
    useWindowEvent<any>('IPC_KEYFRAME_SAVE', (event) => {
        const payload = event.payload
        if (payload?.callerId !== 'GeosetAnimationModal' || !editingField || selectedIndex < 0) return
        updateLocalAnim(selectedIndex, { [editingField]: payload.data })
    }, Boolean(isStandalone))

    // Open keyframe editor
    const openKeyframeEditor = (field: string, vectorSize: number) => {
        setEditingField(field)
        setEditingVectorSize(vectorSize)

        if (isStandalone) {
            const targetAnim = localAnims[selectedIndex];
            const initialData = field && targetAnim ? targetAnim[field] : null;

            const payload = {
                callerId: 'GeosetAnimationModal',
                initialData,
                title: field === 'Color' ? '颜色关键帧编辑器' : '透明度关键帧编辑器',
                vectorSize,
                fieldName: field,
                globalSequences: rpcState.globalSequences || []
            };

            const windowId = windowManager.getKeyframeWindowId(payload.fieldName);
            // Emit instantly to update react state before visual native window paint
            void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload);
            // Legacy inline route, which we obsolete now but just in case
            console.warn("GeosetAnimationModal inline KeyframeEditor is obsolete. Use standalone");
        }
    }

    const handleKeyframeSave = (animVector: any) => {
        if (editingField && selectedIndex >= 0) {
            updateLocalAnim(selectedIndex, { [editingField]: animVector })
        }
    }

    const globalSequences = isStandalone ? rpcState.globalSequences : (modelData as any)?.GlobalSequences || []

    const innerContent = (
        <>
            <div
                style={{
                    display: 'flex',
                    // 嵌入 DraggableModal 时保持固定高度；独立窗口须撑满标题栏下区域，避免底部露出黑边
                    flex: isStandalone ? 1 : undefined,
                    minHeight: isStandalone ? 0 : undefined,
                    height: isStandalone ? undefined : '450px',
                    border: '1px solid #4a4a4a',
                    backgroundColor: '#252525',
                }}
            >
                {/* List (Left) */}
                <div ref={listRef} style={{ width: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', backgroundColor: '#333333', borderRight: '1px solid #4a4a4a' }}>
                    <div style={{ padding: '8px', borderBottom: '1px solid #4a4a4a' }}>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            block
                            onClick={() => {
                                const newAnim = { GeosetId: 0, Alpha: 1, Color: [1, 1, 1], Flags: 0 }
                                const newAnims = [...localAnims, newAnim]
                                setLocalAnims(newAnims)
                                saveToBackend(newAnims)
                                setSelectedIndex(newAnims.length - 1)
                            }}
                            style={{ backgroundColor: '#5a9cff', borderColor: '#5a9cff' }}
                        >
                            添加
                        </Button>
                    </div>
                    <List
                        dataSource={localAnims}
                        renderItem={(_item, index) => (
                            <List.Item
                                onClick={() => setSelectedIndex(index)}
                                style={{
                                    cursor: 'pointer',
                                    padding: '8px 12px',
                                    backgroundColor: selectedIndex === index ? '#5a9cff' : 'transparent',
                                    color: selectedIndex === index ? '#fff' : '#b0b0b0',
                                    transition: 'background 0.2s',
                                    borderBottom: '1px solid #3a3a3a'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                    <span>GeosetAnim {index}</span>
                                    <Button
                                        type="text"
                                        danger
                                        size="small"
                                        icon={<DeleteOutlined />}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleDeleteAnim(index)
                                        }}
                                        style={{ color: selectedIndex === index ? '#fff' : '#ff4d4f' }}
                                    />
                                </div>
                            </List.Item>
                        )}
                    />
                </div>

                {/* Details (Right) */}
                <div style={{ flex: 1, padding: '16px', overflowY: 'auto', backgroundColor: '#252525' }}>
                    {selectedAnim ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                {/* Color Section */}
                                <Card
                                    title={<span style={{ color: '#e8e8e8' }}>颜色</span>}
                                    size="small"
                                    bordered={false}
                                    style={{ flex: 1, background: '#333333', border: '1px solid #4a4a4a' }}
                                    styles={{ header: { borderBottom: '1px solid #4a4a4a', color: '#e8e8e8' } }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                        <Checkbox
                                            checked={isDynamic(selectedAnim.Color)}
                                            onChange={(e) => handleColorAnimToggle(e.target.checked)}
                                            style={{ color: '#e8e8e8' }}
                                        >
                                            <span style={{ color: '#e8e8e8' }}>动态化</span>
                                        </Checkbox>
                                        {isDynamic(selectedAnim.Color) && (
                                            <Button
                                                type="link"
                                                icon={<EditOutlined />}
                                                onClick={() => openKeyframeEditor('Color', 3)}
                                                style={{ color: '#5a9cff' }}
                                            >
                                                编辑关键帧
                                            </Button>
                                        )}
                                    </div>
                                    {!isDynamic(selectedAnim.Color) && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ color: '#b0b0b0', fontSize: '12px' }}>颜色:</span>
                                            <ColorPicker
                                                value={getColor(selectedAnim)}
                                                onChange={(color) => handleColorChange(color, false)}
                                                onChangeComplete={(color) => handleColorChange(color, true)}
                                                placement="rightTop"
                                            />
                                        </div>
                                    )}
                                </Card>

                                {/* Alpha Section */}
                                <Card
                                    title={<span style={{ color: '#e8e8e8' }}>透明度</span>}
                                    size="small"
                                    bordered={false}
                                    style={{ flex: 1, background: '#333333', border: '1px solid #4a4a4a' }}
                                    styles={{ header: { borderBottom: '1px solid #4a4a4a', color: '#e8e8e8' } }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                        <Checkbox
                                            checked={isDynamic(selectedAnim.Alpha)}
                                            onChange={(e) => handleAlphaAnimToggle(e.target.checked)}
                                            style={{ color: '#e8e8e8' }}
                                        >
                                            <span style={{ color: '#e8e8e8' }}>动态化</span>
                                        </Checkbox>
                                        {isDynamic(selectedAnim.Alpha) && (
                                            <Button
                                                type="link"
                                                icon={<EditOutlined />}
                                                onClick={() => openKeyframeEditor('Alpha', 1)}
                                                style={{ color: '#5a9cff' }}
                                            >
                                                编辑关键帧
                                            </Button>
                                        )}
                                    </div>
                                    {!isDynamic(selectedAnim.Alpha) && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ color: '#b0b0b0', fontSize: '12px' }}>透明度:</span>
                                            <InputNumber
                                                value={getAlpha(selectedAnim)}
                                                onChange={handleAlphaChange}
                                                step={0.1}
                                                min={0}
                                                max={1}
                                                style={{ width: '80px', backgroundColor: '#252525', borderColor: '#4a4a4a', color: '#e8e8e8' }}
                                            />
                                        </div>
                                    )}
                                </Card>
                            </div>

                            {/* Other Section */}
                            <Card
                                title={<span style={{ color: '#e8e8e8' }}>其他设置</span>}
                                size="small"
                                bordered={false}
                                style={{ background: '#333333', border: '1px solid #4a4a4a' }}
                                styles={{ header: { borderBottom: '1px solid #4a4a4a', color: '#e8e8e8' } }}
                            >
                                <div style={{ marginBottom: '16px' }}>
                                    <Text style={{ display: 'block', marginBottom: '8px', color: '#b0b0b0' }}>多边形 ID:</Text>
                                    <Select
                                        style={{ width: '100%' }}
                                        value={selectedAnim.GeosetId}
                                        onChange={handleGeosetChange}
                                        popupClassName="dark-theme-select-dropdown"
                                    >
                                        {geosets.map((_, idx) => (
                                            <Option key={idx} value={idx}>
                                                Geoset {idx}
                                            </Option>
                                        ))}
                                    </Select>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    <Checkbox
                                        checked={selectedAnim.UseColor === undefined ? true : selectedAnim.UseColor}
                                        onChange={handleUseColorChange}
                                        style={{ color: '#e8e8e8' }}
                                    >
                                        <span style={{ color: '#e8e8e8' }}>使用颜色 (Use Color)</span>
                                    </Checkbox>
                                    <Checkbox
                                        checked={selectedAnim.DropShadow}
                                        onChange={handleDropShadowChange}
                                        style={{ color: '#e8e8e8' }}
                                    >
                                        <span style={{ color: '#e8e8e8' }}>阴影效果 (Drop Shadow)</span>
                                    </Checkbox>
                                </div>
                            </Card>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#808080' }}>
                            请从左侧列表选择一个多边形动画
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="多边形动画管理器" onClose={onClose}>
                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        backgroundColor: '#252525',
                    }}
                >
                    {innerContent}
                </div>
            </StandaloneWindowFrame>
        )
    }

    return (
        <DraggableModal
            title="多边形动画管理器"
            open={visible}
            onOk={handleOk}
            onCancel={handleCancel}
            width={800}
            footer={null}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{
                content: { backgroundColor: '#333333', border: '1px solid #4a4a4a', padding: 0 },
                header: { backgroundColor: '#2d2d2d', borderBottom: '1px solid #4a4a4a', margin: 0, padding: '12px 16px' },
                body: { backgroundColor: '#252525', padding: 0 }
            }}
        >
            {innerContent}
        </DraggableModal>
    )
}

export default GeosetAnimationModal
