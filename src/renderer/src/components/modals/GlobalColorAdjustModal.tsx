import React, { useEffect, useState } from 'react'
import { Button, Checkbox, Col, InputNumber, Modal, Row, Slider, Space, Switch, Tooltip } from 'antd'
import { BgColorsOutlined, ReloadOutlined } from '@ant-design/icons'
import { useGlobalColorAdjustStore } from '../../store/globalColorAdjustStore'
import { useRpcClient } from '../../hooks/useRpc'
import { StandaloneWindowFrame } from '../common/StandaloneWindowFrame'
import {
    DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS,
    DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS,
    normalizeGlobalColorAdjustSettings,
    type GlobalColorAdjustSettings,
    type GlobalColorAdjustTarget,
} from '../../utils/globalColorAdjustCore'

interface GlobalColorAdjustModalProps {
    visible: boolean
    onClose: () => void
    isStandalone?: boolean
}

const TARGET_ITEMS: Array<{ key: GlobalColorAdjustTarget; label: string }> = [
    { key: 'materialLayers', label: '材质层' },
    { key: 'geosetAnimations', label: '多边形动画' },
    { key: 'textures', label: '贴图' },
    { key: 'particles', label: '粒子' },
    { key: 'ribbons', label: '丝带' },
    { key: 'lights', label: '灯光' },
]

const ADJUST_ITEMS = [
    { key: 'hue' as const, label: '色相', min: -180, max: 180, step: 1, suffix: '°' },
    { key: 'saturation' as const, label: '饱和度', min: 0, max: 200, step: 1, suffix: '%' },
    { key: 'brightness' as const, label: '明暗度', min: 0, max: 200, step: 1, suffix: '%' },
    { key: 'opacity' as const, label: '透明度', min: 0, max: 200, step: 1, suffix: '%' },
]

const toPositiveHue = (value: number): number => {
    const normalized = value % 360
    return normalized < 0 ? normalized + 360 : normalized
}

const getSliderStyles = (
    key: 'hue' | 'brightness' | 'saturation' | 'opacity',
    settings: GlobalColorAdjustSettings
): NonNullable<React.ComponentProps<typeof Slider>['styles']> => {
    const hue = toPositiveHue(settings.hue)
    const accent = `hsl(${hue}deg 92% 58%)`
    const accentSoft = `hsla(${hue}deg 92% 58% / 0.35)`

    if (key === 'hue') {
        return {
            rail: {
                background:
                    'linear-gradient(90deg, #ff4d4f 0%, #ffa940 16%, #fadb14 32%, #73d13d 48%, #36cfc9 64%, #597ef7 80%, #eb2f96 100%)',
            },
            track: { background: 'rgba(255,255,255,0.18)' },
            handle: { backgroundColor: '#fff', borderColor: '#ff85c0' },
        }
    }

    if (key === 'saturation') {
        return {
            rail: {
                background: `linear-gradient(90deg, hsl(${hue}deg 3% 55%), ${accent})`,
            },
            track: { background: 'rgba(255,255,255,0.16)' },
            handle: { backgroundColor: accent, borderColor: '#ffffff' },
        }
    }

    if (key === 'brightness') {
        return {
            rail: {
                background: 'linear-gradient(90deg, #000000 0%, #6f6f6f 52%, #ffffff 100%)',
            },
            track: { background: 'rgba(255,255,255,0.16)' },
            handle: { backgroundColor: accent, borderColor: '#ffffff' },
        }
    }

    return {
        rail: {
            backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 100%),
linear-gradient(45deg, #2f2f2f 25%, transparent 25%, transparent 75%, #2f2f2f 75%, #2f2f2f),
linear-gradient(45deg, #7a7a7a 25%, transparent 25%, transparent 75%, #7a7a7a 75%, #7a7a7a)`,
            backgroundSize: '100% 100%, 8px 8px, 8px 8px',
            backgroundPosition: '0 0, 0 0, 4px 4px',
            backgroundColor: '#505050',
        },
        track: { background: 'rgba(255,255,255,0.16)' },
        handle: { backgroundColor: accent, borderColor: '#ffffff' },
    }
}

export const GlobalColorAdjustModal: React.FC<GlobalColorAdjustModalProps> = ({
    visible,
    onClose,
    isStandalone = false,
}) => {
    const storeSettings = useGlobalColorAdjustStore((state) => state.settings)
    const replaceStoreSettings = useGlobalColorAdjustStore((state) => state.replaceSettings)
    const resetStoreSettings = useGlobalColorAdjustStore((state) => state.resetSettings)
    const { state: rpcState, emitCommand } = useRpcClient<{ settings: GlobalColorAdjustSettings }>(
        'globalColorAdjust',
        { settings: DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS }
    )

    const appliedSettings = isStandalone ? rpcState.settings : storeSettings

    const [draftSettings, setDraftSettings] = useState<GlobalColorAdjustSettings>(appliedSettings)

    useEffect(() => {
        if (visible) {
            setDraftSettings(appliedSettings)
        }
    }, [appliedSettings, visible])

    const commitSettings = (nextSettings: GlobalColorAdjustSettings) => {
        const normalized = normalizeGlobalColorAdjustSettings(nextSettings)
        setDraftSettings(normalized)
        if (isStandalone) {
            emitCommand('SET_GLOBAL_COLOR_ADJUST_SETTINGS', normalized)
            return
        }
        replaceStoreSettings(normalized)
    }

    const updateDraftValue = (key: 'hue' | 'brightness' | 'saturation' | 'opacity', value: number) => {
        setDraftSettings((current) => normalizeGlobalColorAdjustSettings({ ...current, [key]: value }))
    }

    const commitScalarValue = (key: 'hue' | 'brightness' | 'saturation' | 'opacity', value: number) => {
        commitSettings({ ...draftSettings, [key]: value })
    }

    const resetField = (key: 'hue' | 'brightness' | 'saturation' | 'opacity' | 'colorize') => {
        const next = { ...draftSettings, [key]: DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS[key] }
        commitSettings(next)
    }

    const sectionHeaderStyle: React.CSSProperties = {
        height: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 4px',
        marginBottom: 4,
    }

    const sectionTitleStyle: React.CSSProperties = {
        color: '#888',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
    }

    const itemContainerStyle: React.CSSProperties = {
        backgroundColor: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: 4,
        padding: '6px 10px',
    }

    const innerContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Targets Section */}
            <div>
                <div style={sectionHeaderStyle}>
                    <div style={sectionTitleStyle}>适用对象</div>
                    <Space size={4}>
                        <Button
                            size="small"
                            type="text"
                            style={{ fontSize: 11, padding: '0 4px', height: 20, color: '#2f7dff' }}
                            onClick={() => commitSettings({ ...draftSettings, targets: DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS })}
                        >
                            全选
                        </Button>
                        <div style={{ width: 1, height: 10, backgroundColor: '#444' }} />
                        <Button
                            size="small"
                            type="text"
                            style={{ fontSize: 11, padding: '0 4px', height: 20, color: '#888' }}
                            onClick={() => commitSettings({
                                ...draftSettings,
                                targets: {
                                    materialLayers: false,
                                    geosetAnimations: false,
                                    textures: false,
                                    particles: false,
                                    ribbons: false,
                                    lights: false,
                                },
                            })}
                        >
                            清除
                        </Button>
                    </Space>
                </div>
                <div style={{ ...itemContainerStyle, padding: '8px 12px' }}>
                    <Row gutter={[12, 8]}>
                        {TARGET_ITEMS.map((item) => (
                            <Col span={12} key={item.key}>
                                <Checkbox
                                    checked={draftSettings.targets[item.key]}
                                    onChange={(event) => commitSettings({
                                        ...draftSettings,
                                        targets: {
                                            ...draftSettings.targets,
                                            [item.key]: event.target.checked,
                                        },
                                    })}
                                >
                                    <span style={{ color: '#ccc', fontSize: 12 }}>{item.label}</span>
                                </Checkbox>
                            </Col>
                        ))}
                    </Row>
                </div>
            </div>

            {/* Adjustments Section */}
            <div>
                <div style={sectionHeaderStyle}>
                    <div style={sectionTitleStyle}>参数调整</div>
                    <Tooltip title="启用着色模式 (Colorize)">
                        <Space size={6}>
                            <span style={{ color: '#888', fontSize: 11 }}>着色</span>
                            <Switch
                                size="small"
                                checked={draftSettings.colorize}
                                onChange={(checked) => commitSettings({ ...draftSettings, colorize: checked })}
                            />
                        </Space>
                    </Tooltip>
                </div>
                <div style={{ ...itemContainerStyle, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {ADJUST_ITEMS.map((item) => (
                        <div
                            key={item.key}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '4px 0',
                                borderBottom: item.key === 'opacity' ? 'none' : '1px solid #282828'
                            }}
                        >
                            <div style={{ width: 44, color: '#aaa', fontSize: 12, flexShrink: 0 }}>
                                {item.label}
                            </div>


                            <div style={{ flex: 1, minWidth: 0, padding: '0 4px' }}>
                                <Slider
                                    min={item.min}
                                    max={item.max}
                                    step={item.step}
                                    value={draftSettings[item.key]}
                                    onChange={(value) => updateDraftValue(item.key, Number(value))}
                                    onChangeComplete={(value) => commitScalarValue(item.key, Number(value))}
                                    tooltip={{ formatter: (value) => `${value}${item.suffix}` }}
                                    styles={getSliderStyles(item.key, draftSettings)}
                                />
                            </div>

                            <InputNumber
                                size="small"
                                min={item.min}
                                max={item.max}
                                step={item.step}
                                value={draftSettings[item.key]}
                                onChange={(value) => {
                                    if (typeof value === 'number') {
                                        updateDraftValue(item.key, value)
                                    }
                                }}
                                onBlur={(event) => commitScalarValue(item.key, Number(event.target.value))}
                                onPressEnter={(event) => {
                                    commitScalarValue(item.key, Number(event.currentTarget.value))
                                    event.currentTarget.blur()
                                }}
                                style={{ width: 56, fontSize: 11, backgroundColor: '#000', borderColor: '#333', color: '#eee' }}
                                controls={false}
                            />

                            <Button 
                                size="small" 
                                type="text"
                                icon={<ReloadOutlined style={{ fontSize: 12 }} />} 
                                onClick={() => resetField(item.key)}
                                style={{ color: '#666', width: 20, height: 20, padding: 0 }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => {
                    setDraftSettings(DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS)
                    if (isStandalone) {
                        emitCommand('RESET_GLOBAL_COLOR_ADJUST_SETTINGS')
                        return
                    }
                    resetStoreSettings()
                }} style={{ color: '#888', fontSize: 12 }}>
                    重置全部
                </Button>
                {!isStandalone && (
                    <Button size="small" type="primary" onClick={onClose} style={{ minWidth: 64 }}>
                        确认
                    </Button>
                )}
            </div>
        </div>
    )


    if (isStandalone) {
        return (
            <StandaloneWindowFrame title="全局颜色调整" onClose={onClose}>
                <div style={{ padding: '10px 14px', flex: 1, overflow: 'hidden', backgroundColor: '#1f1f1f' }}>
                    {innerContent}
                </div>
            </StandaloneWindowFrame>
        )
    }

    return (
        <Modal
            open={visible}
            title={(
                <Space size={6}>
                    <BgColorsOutlined style={{ color: '#4080ff' }} />
                    <span style={{ fontSize: 14 }}>全局颜色调整</span>
                </Space>
            )}
            onCancel={onClose}
            width={380}
            footer={null}
            styles={{
                body: {
                    backgroundColor: '#1f1f1f',
                    padding: '12px 14px 14px',
                },
                header: {
                    backgroundColor: '#1f1f1f',
                    borderBottom: '1px solid #333',
                    padding: '10px 14px',
                    margin: 0
                },
                content: {
                    backgroundColor: '#1f1f1f',
                    borderRadius: 8,
                    overflow: 'hidden'
                },
            }}
        >
            {innerContent}
        </Modal>
    )
}

export default GlobalColorAdjustModal
