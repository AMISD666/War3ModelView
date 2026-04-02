import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useEffect, useState } from 'react'
import { Button, Checkbox, Form, Select } from 'antd'
import { ColorPicker } from '@renderer/components/common/EnhancedColorPicker'
import { listen } from '@tauri-apps/api/event'
import type { Color } from 'antd/es/color-picker'
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell'
import { DraggableModal } from '../DraggableModal'
import { uiText } from '../../constants/uiText'
import { useHistoryStore } from '../../store/historyStore'
import { useModelStore } from '../../store/modelStore'
import type { LightNode } from '../../types/node'
import { NODE_EDITOR_COMMANDS, type NodeEditorCommandSender } from '../../types/nodeEditorRpc'
import { windowManager } from '../../utils/WindowManager'

const { Option } = Select

interface LightDialogProps {
    visible: boolean
    nodeId: number | null
    onClose: () => void
    isStandalone?: boolean
    standaloneNode?: LightNode | null
    standaloneEmit?: NodeEditorCommandSender
    standaloneModelData?: { Textures?: any[]; GlobalSequences?: any[]; Sequences?: any[] } | null
}

const PROP_TO_ANIM_KEY: Record<string, string> = {
    Color: 'ColorAnim',
    AmbientColor: 'AmbientColorAnim',
    Intensity: 'IntensityAnim',
    AmbientIntensity: 'AmbientIntensityAnim',
    AttenuationStart: 'AttenuationStartAnim',
    AttenuationEnd: 'AttenuationEndAnim',
    Visibility: 'VisibilityAnim',
}

const isAnimVector = (val: any): boolean => val && typeof val === 'object' && Array.isArray(val.Keys)

const getStaticValue = (val: any, defaultVal: any = 0): any => {
    if (isAnimVector(val)) {
        const firstKey = val.Keys?.[0]
        if (firstKey) {
            const vec = firstKey.Vector ?? firstKey.Value
            if (Array.isArray(vec)) return vec.length === 1 ? vec[0] : vec
            return vec ?? defaultVal
        }
        return defaultVal
    }
    return val ?? defaultVal
}

const LightDialog: React.FC<LightDialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
    standaloneModelData,
}) => {
    const [form] = Form.useForm()
    const { getNodeById, updateNode, modelData: storeModelData } = useModelStore()
    const modelData = isStandalone ? standaloneModelData : storeModelData
    const currentNode =
        nodeId !== null ? (isStandalone ? (standaloneNode as LightNode | null) : (getNodeById(nodeId) as LightNode)) : null

    const applyNodeToStore = React.useCallback(
        (next: any, history?: { name: string; undoNode: any; redoNode: any }) => {
            if (nodeId === null) return
            if (isStandalone && standaloneEmit) {
                standaloneEmit(NODE_EDITOR_COMMANDS.applyNodeUpdate, { objectId: nodeId, node: next, history })
                return
            }
            if (history) {
                useHistoryStore.getState().push({
                    name: history.name,
                    undo: () => updateNode(nodeId, history.undoNode),
                    redo: () => updateNode(nodeId, history.redoNode),
                })
            }
            updateNode(nodeId, next)
        },
        [isStandalone, nodeId, standaloneEmit, updateNode]
    )

    const [animDataMap, setAnimDataMap] = useState<Record<string, any>>({})
    const [currentEditingProp, setCurrentEditingProp] = useState<string | null>(null)

    const toAntdColor = (rgb?: [number, number, number] | any) => {
        if (isAnimVector(rgb)) {
            const firstKey = rgb.Keys?.[0]
            const vec = firstKey?.Vector ?? firstKey?.Value
            if (Array.isArray(vec) && vec.length >= 3) {
                return `rgb(${Math.round(vec[0] * 255)}, ${Math.round(vec[1] * 255)}, ${Math.round(vec[2] * 255)})`
            }
            return 'rgb(255, 255, 255)'
        }
        if (!rgb) return 'rgb(255, 255, 255)'
        if (Array.isArray(rgb) && rgb.length >= 3) {
            return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`
        }
        return 'rgb(255, 255, 255)'
    }

    const fromAntdColor = (color: Color | string): [number, number, number] => {
        let r = 1, g = 1, b = 1
        if (typeof color === 'string') {
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
            if (match) {
                r = parseInt(match[1]) / 255
                g = parseInt(match[2]) / 255
                b = parseInt(match[3]) / 255
            }
        } else if (color && typeof color === 'object') {
            const rgb = color.toRgb()
            r = rgb.r / 255
            g = rgb.g / 255
            b = rgb.b / 255
        }
        return [r, g, b]
    }

    const formHydratedForNodeIdRef = React.useRef<number | null>(null)
    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null
            return
        }
        if (nodeId === null || formHydratedForNodeIdRef.current === nodeId) return
        const sourceNode: LightNode | null = isStandalone
            ? (standaloneNode as LightNode | null)
            : ((useModelStore.getState().getNodeById(nodeId) as LightNode | undefined) ?? null)
        if (!sourceNode) return
        formHydratedForNodeIdRef.current = nodeId
        const defaults = {
            LightType: 'Omnidirectional',
            AttenuationStart: 0,
            AttenuationEnd: 500,
            Intensity: 1,
            AmbientIntensity: 0,
            Visibility: 1,
        }
        const newAnimDataMap: Record<string, any> = {}
        let lightTypeValue = sourceNode.LightType
        if (typeof lightTypeValue === 'number') lightTypeValue = ['Omnidirectional', 'Directional', 'Ambient'][lightTypeValue] as any
        Object.entries(PROP_TO_ANIM_KEY).forEach(([propName, animKey]) => {
            const value = (sourceNode as any)[propName]
            if (isAnimVector(value)) newAnimDataMap[propName] = value
            const animValue = (sourceNode as any)[animKey]
            if (isAnimVector(animValue)) newAnimDataMap[propName] = animValue
        })
        form.setFieldsValue({
            LightType: lightTypeValue ?? defaults.LightType,
            AttenuationStart: getStaticValue(sourceNode.AttenuationStart, defaults.AttenuationStart),
            AttenuationEnd: getStaticValue(sourceNode.AttenuationEnd, defaults.AttenuationEnd),
            Intensity: getStaticValue(sourceNode.Intensity, defaults.Intensity),
            AmbientIntensity: getStaticValue(sourceNode.AmbientIntensity, defaults.AmbientIntensity),
            Visibility: getStaticValue((sourceNode as any).Visibility, defaults.Visibility),
            Color: toAntdColor(sourceNode.Color),
            AmbientColor: toAntdColor(sourceNode.AmbientColor),
        })
        setAnimDataMap(newAnimDataMap)
    }, [visible, nodeId, isStandalone, standaloneNode, form])

    useEffect(() => {
        const unlisten = listen('IPC_KEYFRAME_SAVE', (event) => {
            const payload = event.payload as any
            if (payload && payload.callerId === 'LightDialog' && currentEditingProp) {
                setAnimDataMap((prev) => ({ ...prev, [currentEditingProp]: payload.data }))
                setCurrentEditingProp(null)
            }
        })
        return () => {
            unlisten.then((f) => f())
        }
    }, [currentEditingProp])

    const handleOpenKeyframeEditor = (propName: string, title: string, vectorSize: number = 1) => {
        setCurrentEditingProp(propName)
        const payload = {
            callerId: 'LightDialog',
            initialData: animDataMap[propName] || null,
            title: `${uiText.lightDialog.editPrefix}${title}`,
            vectorSize,
            fieldName: propName,
            globalSequences: (modelData?.GlobalSequences || []).map((g: any) => (typeof g === 'number' ? g : g?.Duration)).filter((v: any) => typeof v === 'number'),
            sequences: modelData?.Sequences || [],
        }
        const windowId = windowManager.getKeyframeWindowId(payload.fieldName)
        ;(payload as any).targetWindowId = windowId
        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload)
    }

    const handleDynamicChange = (propName: string, checked: boolean) => {
        if (checked) {
            if (!animDataMap[propName]) setAnimDataMap((prev) => ({ ...prev, [propName]: { Keys: [], LineType: 1, GlobalSeqId: null } }))
            return
        }
        setAnimDataMap((prev) => {
            const copy = { ...prev }
            delete copy[propName]
            return copy
        })
    }

    const boxStyle: React.CSSProperties = { border: '1px solid #484848', padding: '12px 6px 6px 6px', position: 'relative', marginTop: 8, backgroundColor: '#2b2b2b', borderRadius: 2 }
    const labelStyle: React.CSSProperties = { position: 'absolute', top: -9, left: 8, backgroundColor: '#1f1f1f', padding: '0 4px', fontSize: 12, color: '#ccc' }
    const inputStyle: React.CSSProperties = { width: '100%', backgroundColor: '#333', borderColor: '#444', color: '#fff' }

    const BoxedNumericField = ({ label, name, min, max, precision, width }: { label: string; name: string; min?: number; max?: number; precision?: number; width?: number | string }) => {
        const isDynamic = !!animDataMap[name]
        return (
            <div style={{ ...boxStyle, width }}>
                <span style={labelStyle}>{label}</span>
                <div style={{ marginBottom: 6 }}>
                    <Checkbox checked={isDynamic} onChange={(e) => handleDynamicChange(name, e.target.checked)} style={{ color: '#ccc', fontSize: 12 }}>{uiText.lightDialog.dynamic}</Checkbox>
                </div>
                <Button block size="small" onClick={() => handleOpenKeyframeEditor(name, label, 1)} disabled={!isDynamic} style={{ marginBottom: 6, backgroundColor: '#444', color: isDynamic ? '#fff' : '#888', borderColor: '#555', height: 28 }}>{label}</Button>
                <Form.Item name={name} noStyle><InputNumber style={inputStyle} min={min} max={max} precision={precision} disabled={isDynamic} size="small" placeholder="0" /></Form.Item>
            </div>
        )
    }

    const BoxedColorField = ({ label, name }: { label: string; name: string }) => {
        const isDynamic = !!animDataMap[name]
        return (
            <div style={boxStyle}>
                <span style={labelStyle}>{label}</span>
                <div style={{ marginBottom: 6 }}>
                    <Checkbox checked={isDynamic} onChange={(e) => handleDynamicChange(name, e.target.checked)} style={{ color: '#ccc', fontSize: 12 }}>{uiText.lightDialog.dynamic}</Checkbox>
                </div>
                <Button block size="small" onClick={() => handleOpenKeyframeEditor(name, label, 3)} disabled={!isDynamic} style={{ marginBottom: 6, backgroundColor: '#444', color: isDynamic ? '#fff' : '#888', borderColor: '#555', height: 28 }}>{label}</Button>
                <Form.Item name={name} noStyle><ColorPicker size="small" showText format="rgb" disabled={isDynamic} /></Form.Item>
            </div>
        )
    }

    const handleOk = async () => {
        try {
            const values = await form.validateFields()
            if (!currentNode || nodeId === null) return
            let lightTypeVal = 0
            if (values.LightType === 'Directional') lightTypeVal = 1
            else if (values.LightType === 'Ambient') lightTypeVal = 2
            const updatedNode: any = { ...currentNode, LightType: lightTypeVal }
            const propConfigs: Array<{ prop: string; isColor: boolean; formField: string }> = [
                { prop: 'AttenuationStart', isColor: false, formField: 'AttenuationStart' },
                { prop: 'AttenuationEnd', isColor: false, formField: 'AttenuationEnd' },
                { prop: 'Intensity', isColor: false, formField: 'Intensity' },
                { prop: 'AmbientIntensity', isColor: false, formField: 'AmbientIntensity' },
                { prop: 'Color', isColor: true, formField: 'Color' },
                { prop: 'AmbientColor', isColor: true, formField: 'AmbientColor' },
                { prop: 'Visibility', isColor: false, formField: 'Visibility' },
            ]
            propConfigs.forEach(({ prop, isColor, formField }) => {
                const animKey = PROP_TO_ANIM_KEY[prop]
                if (animDataMap[prop]) {
                    updatedNode[prop] = animDataMap[prop]
                    if (animKey) updatedNode[animKey] = animDataMap[prop]
                } else {
                    updatedNode[prop] = isColor ? fromAntdColor(values[formField]) : Number(values[formField])
                    if (animKey) delete updatedNode[animKey]
                }
            })
            applyNodeToStore(updatedNode, { name: uiText.lightDialog.editHistory, undoNode: currentNode, redoNode: updatedNode })
            onClose()
        } catch (e) {
            console.error('Validation failed', e)
        }
    }

    const lightFormInner = (
        <Form form={form} layout="vertical">
            <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><BoxedColorField label={uiText.lightDialog.color} name="Color" /></div>
                <div style={{ flex: 1 }}><BoxedColorField label={uiText.lightDialog.ambientColor} name="AmbientColor" /></div>
                <div style={{ flex: 1 }}><BoxedNumericField label={uiText.lightDialog.attenuationStart} name="AttenuationStart" min={0} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <div style={{ flex: 1 }}><BoxedNumericField label={uiText.lightDialog.intensity} name="Intensity" min={0} precision={2} /></div>
                <div style={{ flex: 1 }}><BoxedNumericField label={uiText.lightDialog.ambientIntensity} name="AmbientIntensity" min={0} precision={2} /></div>
                <div style={{ flex: 1 }}><BoxedNumericField label={uiText.lightDialog.attenuationEnd} name="AttenuationEnd" min={0} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <div style={{ flex: 1 }}><BoxedNumericField label={uiText.lightDialog.visibility} name="Visibility" min={0} max={1} precision={1} /></div>
                <div style={{ flex: 2 }}>
                    <div style={boxStyle}>
                        <span style={labelStyle}>{uiText.lightDialog.other}</span>
                        <div style={{ display: 'flex', alignItems: 'center', marginTop: 8 }}>
                            <span style={{ marginRight: 12, color: '#888' }}>{uiText.lightDialog.type}</span>
                            <Form.Item name="LightType" noStyle>
                                <Select style={{ flex: 1 }} size="small">
                                    <Option value="Omnidirectional">{uiText.lightDialog.omnidirectional}</Option>
                                    <Option value="Directional">{uiText.lightDialog.directional}</Option>
                                    <Option value="Ambient">{uiText.lightDialog.ambient}</Option>
                                </Select>
                            </Form.Item>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                            <Button onClick={handleOk} type="primary" size="small" style={{ minWidth: 70 }}>{uiText.lightDialog.confirm}</Button>
                            <Button onClick={onClose} size="small" style={{ minWidth: 70 }}>{uiText.lightDialog.cancel}</Button>
                        </div>
                    </div>
                </div>
            </div>
        </Form>
    )

    if (isStandalone) return <NodeEditorStandaloneShell>{lightFormInner}</NodeEditorStandaloneShell>

    return (
        <DraggableModal
            title={uiText.lightDialog.title}
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            footer={null}
            width={700}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '12px 16px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            {lightFormInner}
        </DraggableModal>
    )
}

export default LightDialog
