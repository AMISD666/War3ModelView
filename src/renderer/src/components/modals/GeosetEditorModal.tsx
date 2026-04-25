import { appMessage } from '../../store/messageStore'
import React, { useState, useEffect, useRef } from 'react'
import { List, Button, Select, Card, Typography } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { DraggableModal } from '../DraggableModal';
import { useModelStore } from '../../store/modelStore'
import { useSelectionStore } from '../../store/selectionStore'
import { ReloadOutlined } from '@ant-design/icons'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
import { useRpcClient } from '../../hooks/useRpc'
import { getCurrentWindow } from '@tauri-apps/api/window'

const { Text } = Typography

interface GeosetEditorModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
}

const GeosetEditorModal: React.FC<GeosetEditorModalProps> = ({ visible, onClose, isStandalone }) => {
    const { modelData, setGeosets } = useModelStore()
    const [localGeosets, setLocalGeosets] = useState<any[]>([])
    const [selectedIndex, setSelectedIndex] = useState<number>(-1)
    const [_hasChanges, setHasChanges] = useState(false)
    const listRef = useRef<HTMLDivElement>(null)
    const lastHandledStandalonePickedRef = useRef<number | null | undefined>(undefined)
    /** RPC 每次同步可能产生新数组引用，用签名避免无谓重置 localGeosets、打断输入焦点 */
    const lastSourceGeosetSigRef = useRef('')

    // RPC Sync for standalone mode
    const { state: rpcState, emitCommand } = useRpcClient<any>('geosetEditor', { geosets: [], materialsCount: 0, selectedIndex: -1, pickedGeosetIndex: null });

    const sourceGeosets = isStandalone ? rpcState.geosets : modelData?.Geosets || [];

    const standalonePickedIndex =
        typeof rpcState.pickedGeosetIndex === 'number'
            ? rpcState.pickedGeosetIndex
            : (typeof rpcState.selectedIndex === 'number' ? rpcState.selectedIndex : -1);
    // Helper to scroll to selected item
    const scrollToItem = (index: number) => {
        if (listRef.current && index >= 0) {
            const itemHeight = 50 // Approximate height of list item
            listRef.current.scrollTop = index * itemHeight
        }
    }

    // Initialize local state when modal opens（仅当数据源内容相对上次真的变化时重建本地副本）
    useEffect(() => {
        if (!visible) {
            lastSourceGeosetSigRef.current = ''
            return
        }

        const sig = JSON.stringify(sourceGeosets)
        if (sig === lastSourceGeosetSigRef.current) {
            return
        }
        lastSourceGeosetSigRef.current = sig

        if (sourceGeosets.length > 0) {
            setLocalGeosets(JSON.parse(JSON.stringify(sourceGeosets)))
        } else {
            setLocalGeosets([])
        }

        const standaloneIndex =
            typeof rpcState.pickedGeosetIndex === 'number'
                ? rpcState.pickedGeosetIndex
                : (typeof rpcState.selectedIndex === 'number' ? rpcState.selectedIndex : -1)

        const { selectedGeosetIndex } = useModelStore.getState()
        if (isStandalone && standaloneIndex >= 0 && standaloneIndex < sourceGeosets.length) {
            setSelectedIndex(standaloneIndex)
        } else if (selectedGeosetIndex !== null && selectedGeosetIndex >= 0 && selectedGeosetIndex < sourceGeosets.length) {
            setSelectedIndex(selectedGeosetIndex)
        } else {
            setSelectedIndex(sourceGeosets.length > 0 ? 0 : -1)
        }
        setHasChanges(false)
    }, [visible, sourceGeosets, isStandalone, rpcState.selectedIndex, rpcState.pickedGeosetIndex])

    // Subscribe to Ctrl+Click geoset picking - auto-select geoset
    useEffect(() => {
        if (!visible) return

        if (isStandalone) {
            if (standalonePickedIndex >= 0 && standalonePickedIndex < sourceGeosets.length) {
                setSelectedIndex(standalonePickedIndex)
                setTimeout(() => scrollToItem(standalonePickedIndex), 0)
            }
            return
        }

        const initialPickedIndex = useSelectionStore.getState().pickedGeosetIndex
        if (initialPickedIndex !== null && initialPickedIndex >= 0 && initialPickedIndex < localGeosets.length) {
            setSelectedIndex(initialPickedIndex)
            scrollToItem(initialPickedIndex)        }

        let lastPickedIndex: number | null = initialPickedIndex
        const unsubscribe = useSelectionStore.subscribe((state) => {
            const pickedGeosetIndex = state.pickedGeosetIndex
            if (pickedGeosetIndex !== lastPickedIndex) {
                lastPickedIndex = pickedGeosetIndex
                if (pickedGeosetIndex !== null && pickedGeosetIndex >= 0 && pickedGeosetIndex < localGeosets.length) {
                    setSelectedIndex(pickedGeosetIndex)
                    scrollToItem(pickedGeosetIndex)                }
            }
        })
        return unsubscribe
    }, [visible, localGeosets.length, sourceGeosets.length, isStandalone, standalonePickedIndex])

    const handleOk = () => {
        if (isStandalone) {
            emitCommand('EXECUTE_GEOSET_ACTION', { action: 'SAVE_ALL', payload: localGeosets });
            appMessage.success('多边形设置已保存')
            setHasChanges(false)
            getCurrentWindow().hide()
        } else if (setGeosets) {
            setGeosets(localGeosets)
            appMessage.success('多边形设置已保存')
            setHasChanges(false)
            onClose()
        }
    }

    const handleCancel = () => {
        if (isStandalone) {
            getCurrentWindow().hide()
        } else {
            onClose()
        }
    }

    const updateLocalGeoset = (index: number, updates: any) => {
        const newGeosets = [...localGeosets]
        newGeosets[index] = { ...newGeosets[index], ...updates }
        setLocalGeosets(newGeosets)
        setHasChanges(true)

        // Save immediately
        if (isStandalone) {
            emitCommand('EXECUTE_GEOSET_ACTION', { action: 'SAVE_ALL', payload: newGeosets });
        } else if (setGeosets) {
            setGeosets(newGeosets)
        }
    }

    const selectedGeoset = selectedIndex >= 0 ? localGeosets[selectedIndex] : null

    const materialsCount = isStandalone ? rpcState.materialsCount : ((modelData as any)?.Materials?.length || 0);
    const materialsOptions = Array.from({ length: materialsCount }).map((_, i) => ({
        value: i,
        label: `Material ${i}`
    }));

    const innerContent = (
        <div
            style={{
                display: 'flex',
                // 独立窗口：在标题栏下用 flex 撑满，避免 calc(100vh-32px) 与真实布局不一致导致整窗滚动条与底部黑边
                flex: isStandalone ? 1 : undefined,
                minHeight: isStandalone ? 0 : undefined,
                height: isStandalone ? undefined : '320px',
                backgroundColor: '#1e1e1e',
                padding: '12px',
                gap: '16px',
                boxSizing: 'border-box',
            }}
        >
            {/* List (Left) */}
            <div
                ref={listRef}
                style={{
                    flex: 1,
                    minWidth: '300px',
                    minHeight: 0,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: '#2a2a2a',
                    border: '1px solid #333',
                    borderRadius: '6px',
                }}
            >
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', color: '#e0e0e0', fontSize: '13px', fontWeight: 500, backgroundColor: '#252525', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }}>
                    多边形列表
                </div>
                <List
                    grid={{ gutter: 8, column: 2 }}
                    style={{ padding: '8px' }}
                    dataSource={localGeosets}
                    renderItem={(item, index) => (
                        <List.Item
                            onClick={() => setSelectedIndex(index)}
                            style={{
                                cursor: 'pointer',
                                padding: '6px 10px',
                                marginBottom: '6px',
                                backgroundColor: selectedIndex === index ? '#1668dc' : '#333',
                                color: selectedIndex === index ? '#fff' : '#b0b0b0',
                                transition: 'background 0.2s',
                                border: '1px solid',
                                borderColor: selectedIndex === index ? '#1668dc' : '#3a3a3a',
                                borderRadius: '6px',
                                textAlign: 'center'
                            }}
                            className={selectedIndex === index ? '' : 'hover:bg-[#404040]'}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center' }}>
                                <span style={{ fontWeight: '500', fontSize: '12px', color: selectedIndex === index ? '#fff' : '#e0e0e0' }}>Geoset {index}</span>
                                <span style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>
                                    {item.vertexCount ?? 0}v
                                </span>
                            </div>
                        </List.Item>
                    )}
                />
            </div>

            {/* Details (Right)：属性区固定较矮，不需要纵向滚动条 */}
            <div
                style={{
                    width: '280px',
                    flexShrink: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    alignSelf: 'stretch',
                }}
            >
                {selectedGeoset ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                        <Card
                            title={<span style={{ color: '#e0e0e0', fontSize: '13px', fontWeight: 500 }}>多边形属性</span>}
                            size="small"
                            bordered={false}
                            style={{ width: '100%', background: '#2a2a2a', border: '1px solid #333', borderRadius: '6px' }}
                            headStyle={{ borderBottom: '1px solid #333', backgroundColor: '#252525', borderTopLeftRadius: '6px', borderTopRightRadius: '6px', minHeight: '34px', padding: '0 12px' }}
                            bodyStyle={{ padding: '16px 14px' }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0', fontSize: '11px' }}>材质 ID (Material ID):</Text>
                                    <Select
                                        size="small"
                                        style={{ width: '100%' }}
                                        value={selectedGeoset.MaterialID}
                                        onChange={(v) => {
                                            const raw = typeof v === 'number' ? v : Number(v)
                                            const safe = Number.isFinite(raw) ? Math.floor(raw) : 0
                                            const clamped = materialsCount > 0
                                                ? Math.min(Math.max(0, safe), materialsCount - 1)
                                                : 0
                                            updateLocalGeoset(selectedIndex, { MaterialID: clamped })
                                        }}
                                        popupClassName="dark-theme-select-dropdown"
                                        options={materialsOptions}
                                    />
                                </div>
                                <div>
                                    <Text style={{ display: 'block', marginBottom: '4px', color: '#b0b0b0', fontSize: '11px' }}>选择组 (Selection Group):</Text>
                                    <InputNumber
                                        size="small"
                                        style={{ width: '100%', backgroundColor: '#1e1e1e', borderColor: '#333', color: '#e0e0e0', fontSize: '12px' }}
                                        value={selectedGeoset.SelectionGroup}
                                        onChange={(v) => updateLocalGeoset(selectedIndex, { SelectionGroup: v })}
                                    />
                                </div>
                            </div>
                        </Card>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', color: '#666', fontSize: '13px' }}>
                        请从左侧列表选择一个多边形
                    </div>
                )}
            </div>
        </div>
    );
    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="多边形管理器" onClose={() => getCurrentWindow().hide()}>
                <div
                    style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        backgroundColor: '#1e1e1e',
                    }}
                >
                    {innerContent}
                </div>
            </StandaloneWindowFrame>
        );
    }
    return (
        <DraggableModal
            title="多边形管理器 (Geoset Editor)"
            open={visible}
            onOk={handleOk}
            onCancel={handleCancel}
            width={850}
            okText="确定"
            cancelText="取消"
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{
                content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                body: { backgroundColor: '#2d2d2d', padding: 0 },
                footer: { borderTop: '1px solid #4a4a4a' }
            }}
        >
            {innerContent}
        </DraggableModal>
    )
}

export default GeosetEditorModal

