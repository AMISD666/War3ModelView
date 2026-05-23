import React, { useState, useEffect, useRef } from 'react'
import { List, Checkbox, Button, Select, Card, Typography } from 'antd'
import type { Color } from 'antd/es/color-picker'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { ColorPicker } from '@renderer/components/common/EnhancedColorPicker'
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
import { useRpcClient } from '../../hooks/useRpc'
import { useWindowEvent } from '../../hooks/useWindowEvent'
import { windowManager } from '../../utils/WindowManager'
import { modelDocumentCommandHandler } from '../../application/commands'
import { createUpdateGeosetAnimsPayload } from '../../application/window-bridge/GeosetAnimationCommandPayload'
import {
    geosetAnimDropsShadow,
    geosetAnimUsesColor,
    setGeosetAnimColorEnabled,
    setGeosetAnimDropShadowEnabled,
} from '../../application/geoset-animation/geosetAnimationFlags'
import {
    cloneGeosetAnimForEditor,
    getGeosetAnimEditorAlpha,
    getGeosetAnimEditorColor,
    isGeosetAnimDynamic,
    readGeosetAnimColorVector,
} from '../../application/geoset-animation/geosetAnimationValues'

const { Text } = Typography
const { Option } = Select

interface GeosetAnimationModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
}

const GeosetAnimationModal: React.FC<GeosetAnimationModalProps> = ({ visible, onClose, isStandalone }) => {
    const { modelData } = useModelStore()
    const { state: rpcState, emitCommand } = useRpcClient<any>('geosetAnimManager', { geosets: [], geosetAnims: [], globalSequences: [], pickedGeosetIndex: null })
    const emitGeosetAnimUpdate = (geosetAnims: unknown[]) => {
        emitCommand('EXECUTE_ANIM_ACTION', createUpdateGeosetAnimsPayload({
            documentId: rpcState.documentId,
            documentRevision: rpcState.documentRevision,
            geosetAnims,
        }))
    }

    const [localAnims, setLocalAnims] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [geosets, setGeosets] = useState<any[]>([])
    const listRef = useRef<HTMLDivElement>(null)
    const lastAnimGeoSigRef = useRef('')
    const desiredSelectedIndexRef = useRef(-1)

    const scrollToItem = (index: number) => {
        if (listRef.current && index >= 0) {
            const itemHeight = 46
            listRef.current.scrollTop = index * itemHeight
        }
    }
    const selectAnimIndex = (index: number) => {
        desiredSelectedIndexRef.current = index
        setSelectedIndex(index)
    }
    const restoreSelectedIndex = (count: number) => {
        if (count <= 0) {
            desiredSelectedIndexRef.current = -1
            setSelectedIndex(-1)
            return
        }
        const desiredIndex = desiredSelectedIndexRef.current
        const nextIndex = desiredIndex >= 0 ? Math.min(desiredIndex, count - 1) : 0
        desiredSelectedIndexRef.current = nextIndex
        setSelectedIndex(nextIndex)
    }
    const [editingField, setEditingField] = useState<string | null>(null)

    // Initialize local state when modal opens（仅当 RPC/模型数据内容真的变化时重建，避免周期性同步打断编辑）
    useEffect(() => {
        const currentAnims = isStandalone ? rpcState.geosetAnims : modelData?.GeosetAnims;
        const currentGeosets = isStandalone ? rpcState.geosets : modelData?.Geosets;

        if (!visible) {
            setLocalAnims([])
            setGeosets([])
            selectAnimIndex(-1)
            lastAnimGeoSigRef.current = ''
            return
        }

        const sig = JSON.stringify({ a: currentAnims, g: currentGeosets })
        if (sig === lastAnimGeoSigRef.current) {
            return
        }
        lastAnimGeoSigRef.current = sig

        if (currentAnims) {
            const clonedAnims = (currentAnims || []).map(cloneGeosetAnimForEditor)
            setLocalAnims(clonedAnims)
            setGeosets(currentGeosets || [])
            restoreSelectedIndex(clonedAnims.length)
        } else {
            setLocalAnims([])
            setGeosets(Array.isArray(currentGeosets) ? currentGeosets : [])
            selectAnimIndex(-1)
        }
    }, [visible, isStandalone ? rpcState.geosetAnims : modelData?.GeosetAnims, isStandalone ? rpcState.geosets : modelData?.Geosets])

    // Subscribe to Ctrl+Click geoset picking - auto-select matching geoset animation
    useEffect(() => {
        if (!visible) return

        const handlePickedGeoset = (pickedGeosetIndex: number | null) => {
            if (pickedGeosetIndex === null || localAnims.length === 0) return
            const matchingIndex = localAnims.findIndex((anim: any) => anim.GeosetId === pickedGeosetIndex)
            if (matchingIndex !== -1) {
                selectAnimIndex(matchingIndex)
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
            emitGeosetAnimUpdate(anims);
        } else {
            modelDocumentCommandHandler.replaceGeosetAnimationList({
                name: 'Update Geoset Animation',
                before: structuredClone(modelData?.GeosetAnims || []),
                after: anims,
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

    const handleUseColorChange = (checked: boolean) => {
        if (selectedIndex < 0) return
        updateLocalAnim(selectedIndex, setGeosetAnimColorEnabled(localAnims[selectedIndex], checked))
    }

    const handleDropShadowChange = (checked: boolean) => {
        if (selectedIndex < 0) return
        updateLocalAnim(selectedIndex, setGeosetAnimDropShadowEnabled(localAnims[selectedIndex], checked))
    }

    const handleDeleteAnim = (index: number) => {
        const newAnims = localAnims.filter((_, i) => i !== index)
        setLocalAnims(newAnims)
        saveToBackend(newAnims)
        if (selectedIndex === index) {
            selectAnimIndex(-1)
        } else if (selectedIndex > index) {
            selectAnimIndex(selectedIndex - 1)
        }
    }

    // Animation toggle handlers
    const handleColorAnimToggle = (checked: boolean) => {
        if (selectedIndex < 0) return
        const anim = localAnims[selectedIndex]

        if (checked) {
            // Convert static color to AnimVector
            const colorArr = readGeosetAnimColorVector(anim.Color ?? [1, 1, 1])
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
                staticColor = readGeosetAnimColorVector(v)
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
                                selectAnimIndex(newAnims.length - 1)
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
                                onClick={() => selectAnimIndex(index)}
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
                                            checked={isGeosetAnimDynamic(selectedAnim.Color)}
                                            onChange={(e) => handleColorAnimToggle(e.target.checked)}
                                            style={{ color: '#e8e8e8' }}
                                        >
                                            <span style={{ color: '#e8e8e8' }}>动态化</span>
                                        </Checkbox>
                                        {isGeosetAnimDynamic(selectedAnim.Color) && (
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
                                    {!isGeosetAnimDynamic(selectedAnim.Color) && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ color: '#b0b0b0', fontSize: '12px' }}>颜色:</span>
                                            <ColorPicker
                                                value={getGeosetAnimEditorColor(selectedAnim)}
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
                                            checked={isGeosetAnimDynamic(selectedAnim.Alpha)}
                                            onChange={(e) => handleAlphaAnimToggle(e.target.checked)}
                                            style={{ color: '#e8e8e8' }}
                                        >
                                            <span style={{ color: '#e8e8e8' }}>动态化</span>
                                        </Checkbox>
                                        {isGeosetAnimDynamic(selectedAnim.Alpha) && (
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
                                    {!isGeosetAnimDynamic(selectedAnim.Alpha) && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ color: '#b0b0b0', fontSize: '12px' }}>透明度:</span>
                                            <InputNumber
                                                value={getGeosetAnimEditorAlpha(selectedAnim)}
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
                                        checked={geosetAnimUsesColor(selectedAnim)}
                                        onChange={(e) => handleUseColorChange(e.target.checked)}
                                        style={{ color: '#e8e8e8' }}
                                    >
                                        <span style={{ color: '#e8e8e8' }}>使用颜色 (Use Color)</span>
                                    </Checkbox>
                                    <Checkbox
                                        checked={geosetAnimDropsShadow(selectedAnim)}
                                        onChange={(e) => handleDropShadowChange(e.target.checked)}
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
