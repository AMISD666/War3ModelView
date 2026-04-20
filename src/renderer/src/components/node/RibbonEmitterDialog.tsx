import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, Col, Form, Row, Select } from 'antd'
import { ColorPicker } from '@renderer/components/common/EnhancedColorPicker'
import type { Color } from 'antd/es/color-picker'
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell'
import { DraggableModal } from '../DraggableModal'
import { uiText } from '../../constants/uiText'
import { useModelStore } from '../../store/modelStore'
import type { RibbonEmitterNode } from '../../types/node'
import { NODE_EDITOR_COMMANDS, type NodeEditorCommandSender } from '../../types/nodeEditorRpc'
import { nodeEditorCommandHandler } from '../../application/commands'

interface RibbonEmitterDialogProps {
    visible: boolean
    nodeId: number | null
    onClose: () => void
    isStandalone?: boolean
    standaloneNode?: RibbonEmitterNode | null
    standaloneEmit?: NodeEditorCommandSender
    standaloneModelData?: { Materials?: any[]; Textures?: any[]; GlobalSequences?: any[]; Sequences?: any[] } | null
}

const fieldsetStyle: React.CSSProperties = {
    border: '1px solid #484848',
    padding: '8px 12px',
    marginBottom: 8,
    backgroundColor: 'transparent',
    borderRadius: 0,
    height: '100%',
}

const legendStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#ccc',
    padding: '0 6px',
    width: 'auto',
    marginLeft: 4,
    marginBottom: 0,
}

const inputStyle: React.CSSProperties = {
    backgroundColor: '#2b2b2b',
    borderColor: '#484848',
    color: '#fff',
    width: '100%',
}

const DynamicField = ({
    label,
    isDynamic,
    onDynamicChange,
    children,
    buttonLabel,
}: {
    label: string
    isDynamic: boolean
    onDynamicChange: (checked: boolean) => void
    children: React.ReactNode
    buttonLabel?: string
}) => (
    <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>{label}</legend>
        <div style={{ marginBottom: 6 }}>
            <Checkbox checked={isDynamic} onChange={(e) => onDynamicChange(e.target.checked)} style={{ color: '#888', fontSize: 12 }}>
                {uiText.ribbonEmitterDialog.dynamic}
            </Checkbox>
        </div>
        <Button
            size="small"
            disabled={!isDynamic}
            style={{ width: '100%', marginBottom: 6, backgroundColor: '#333', borderColor: '#484848', color: isDynamic ? '#fff' : '#666' }}
        >
            {buttonLabel || label}
        </Button>
        {children}
    </fieldset>
)

const isAnimVector = (val: any): boolean =>
    val !== null && val !== undefined && typeof val === 'object' && ('Keys' in val || Array.isArray(val?.Keys))

const getStaticValue = (val: any, defaultVal: number): number => {
    if (isAnimVector(val)) {
        const keys = val.Keys
        if (!Array.isArray(keys) || keys.length === 0) return defaultVal
        const vec = keys[0]?.Vector ?? keys[0]?.Value
        if (Array.isArray(vec) || ArrayBuffer.isView(vec)) {
            const n = Number((vec as any)[0])
            return Number.isFinite(n) ? n : defaultVal
        }
        if (vec !== undefined && vec !== null) {
            const n = Number(vec)
            return Number.isFinite(n) ? n : defaultVal
        }
        return defaultVal
    }
    if (typeof val === 'number' && Number.isFinite(val)) return val
    const n = Number(val)
    return Number.isFinite(n) ? n : defaultVal
}

const RibbonEmitterDialog: React.FC<RibbonEmitterDialogProps> = ({
    visible,
    nodeId,
    onClose,
    isStandalone,
    standaloneNode,
    standaloneEmit,
    standaloneModelData,
}) => {
    const [form] = Form.useForm()
    const { getNodeById, modelData: storeModelData } = useModelStore()
    const modelData = isStandalone ? standaloneModelData : storeModelData

    const currentNode =
        nodeId !== null
            ? isStandalone
                ? (standaloneNode as RibbonEmitterNode | null)
                : (getNodeById(nodeId) as RibbonEmitterNode)
            : null

    const getCurrentSourceNode = useCallback((): RibbonEmitterNode | null => {
        if (nodeId === null) return null
        if (isStandalone) {
            return (standaloneNode as RibbonEmitterNode | null) ?? null
        }
        return (useModelStore.getState().getNodeById(nodeId) as RibbonEmitterNode | undefined) ?? null
    }, [isStandalone, nodeId, standaloneNode])

    const applyNodeToStore = useCallback(
        (next: RibbonEmitterNode) => {
            if (nodeId === null) return
            if (isStandalone && standaloneEmit) {
                standaloneEmit(NODE_EDITOR_COMMANDS.applyNodeUpdate, { objectId: nodeId, node: next })
                return
            }
            nodeEditorCommandHandler.applyNodeUpdate({ objectId: nodeId, node: next })
        },
        [isStandalone, nodeId, standaloneEmit]
    )

    const [dynamicProps, setDynamicProps] = useState<Record<string, boolean>>({})
    const toggleDynamic = (prop: string, checked: boolean) => setDynamicProps((prev) => ({ ...prev, [prop]: checked }))

    const toAntdColor = (rgb?: number[] | Float32Array) => {
        if (!rgb || rgb.length < 3) return 'rgb(255, 255, 255)'
        const arr = Array.from(rgb)
        return `rgb(${Math.round(arr[0] * 255)}, ${Math.round(arr[1] * 255)}, ${Math.round(arr[2] * 255)})`
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

    const materialOptions = [
        { label: '(None)', value: -1 },
        ...((modelData?.Materials?.map((_mat: any, index: number) => ({
            label: `${uiText.ribbonEmitterDialog.materialLabelPrefix}${index}`,
            value: index,
        })) || []) as Array<{ label: string; value: number }>),
    ]

    const colorToFormString = (c: any): string => {
        if (isAnimVector(c)) {
            const keys = c.Keys
            if (!Array.isArray(keys) || keys.length === 0) return 'rgb(255, 255, 255)'
            const vec = keys[0]?.Vector ?? keys[0]?.Value
            if (Array.isArray(vec) && vec.length >= 3) {
                return `rgb(${Math.round(Number(vec[0]) * 255)}, ${Math.round(Number(vec[1]) * 255)}, ${Math.round(Number(vec[2]) * 255)})`
            }
        }
        if (Array.isArray(c) && c.length >= 3) return toAntdColor([c[0], c[1], c[2]] as [number, number, number])
        return 'rgb(255, 255, 255)'
    }

    const formHydratedForNodeIdRef = React.useRef<number | null>(null)
    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null
            return
        }
        if (nodeId === null || formHydratedForNodeIdRef.current === nodeId) return
        const sourceNode: RibbonEmitterNode | null = isStandalone
            ? (standaloneNode as RibbonEmitterNode | null)
            : ((useModelStore.getState().getNodeById(nodeId) as RibbonEmitterNode | undefined) ?? null)
        if (!sourceNode) return
        formHydratedForNodeIdRef.current = nodeId
        setDynamicProps({
            Alpha: isAnimVector(sourceNode.Alpha),
            Visibility: isAnimVector((sourceNode as any).Visibility),
            HeightAbove: isAnimVector(sourceNode.HeightAbove),
            HeightBelow: isAnimVector(sourceNode.HeightBelow),
            TextureSlot: isAnimVector(sourceNode.TextureSlot),
            Color: isAnimVector(sourceNode.Color),
        })
        form.setFieldsValue({
            HeightAbove: getStaticValue(sourceNode.HeightAbove, 0),
            HeightBelow: getStaticValue(sourceNode.HeightBelow, 0),
            Alpha: getStaticValue(sourceNode.Alpha, 1),
            Visibility: getStaticValue((sourceNode as any).Visibility, 1),
            TextureSlot: getStaticValue(sourceNode.TextureSlot, 0),
            Color: colorToFormString(sourceNode.Color),
            MaterialID: sourceNode.MaterialID ?? -1,
            EmissionRate: sourceNode.EmissionRate ?? 0,
            LifeSpan: sourceNode.LifeSpan ?? 0,
            Rows: sourceNode.Rows ?? 1,
            Columns: sourceNode.Columns ?? 1,
            Gravity: sourceNode.Gravity ?? 0,
        })
    }, [visible, nodeId, isStandalone, standaloneNode, form])

    const handleOk = async () => {
        try {
            const values = await form.validateFields()
            const sourceNode = getCurrentSourceNode()
            if (!sourceNode || nodeId === null) return
            const currentAny = sourceNode as any
            const toFiniteNumber = (val: any, fallback: number): number => typeof val === 'number' && Number.isFinite(val) ? val : fallback
            const preserveAnimOrUseStatic = (prop: string, formVal: any, fallback: number): any =>
                dynamicProps[prop] && isAnimVector(currentAny[prop]) ? currentAny[prop] : toFiniteNumber(formVal, fallback)
            const rows = Math.max(1, Math.round(toFiniteNumber(values.Rows, toFiniteNumber(currentAny.Rows, 1))))
            const columns = Math.max(1, Math.round(toFiniteNumber(values.Columns, toFiniteNumber(currentAny.Columns, 1))))
            const materialIdRaw = toFiniteNumber(values.MaterialID, toFiniteNumber(currentAny.MaterialID, 0))
            const updatedNode: RibbonEmitterNode = {
                ...sourceNode,
                HeightAbove: preserveAnimOrUseStatic('HeightAbove', values.HeightAbove, getStaticValue(currentAny.HeightAbove, 0)),
                HeightBelow: preserveAnimOrUseStatic('HeightBelow', values.HeightBelow, getStaticValue(currentAny.HeightBelow, 0)),
                Alpha: preserveAnimOrUseStatic('Alpha', values.Alpha, getStaticValue(currentAny.Alpha, 1)),
                Visibility: preserveAnimOrUseStatic('Visibility', values.Visibility, getStaticValue(currentAny.Visibility, 1)),
                Color: dynamicProps.Color && isAnimVector(currentAny.Color) ? currentAny.Color : fromAntdColor(values.Color),
                TextureSlot: preserveAnimOrUseStatic('TextureSlot', values.TextureSlot, getStaticValue(currentAny.TextureSlot, 0)),
                EmissionRate: toFiniteNumber(values.EmissionRate, toFiniteNumber(currentAny.EmissionRate, 10)),
                MaterialID: materialIdRaw >= 0 ? materialIdRaw : undefined,
                LifeSpan: toFiniteNumber(values.LifeSpan, toFiniteNumber(currentAny.LifeSpan, 1)),
                Rows: rows,
                Columns: columns,
                Gravity: toFiniteNumber(values.Gravity, toFiniteNumber(currentAny.Gravity, 0)),
            }
            applyNodeToStore(updatedNode)
            onClose()
        } catch (e) {
            console.error('Validation failed', e)
        }
    }

    const ribbonFormInner = (
        <Form form={form} layout="vertical">
            <Row gutter={8}>
                <Col span={8}>
                    <DynamicField label={uiText.ribbonEmitterDialog.color} isDynamic={!!dynamicProps.Color} onDynamicChange={(c) => toggleDynamic('Color', c)} buttonLabel={uiText.ribbonEmitterDialog.color}>
                        <Form.Item name="Color" noStyle><ColorPicker size="small" showText format="rgb" disabled={dynamicProps.Color} /></Form.Item>
                    </DynamicField>
                </Col>
                <Col span={8}>
                    <DynamicField label={uiText.ribbonEmitterDialog.alpha} isDynamic={!!dynamicProps.Alpha} onDynamicChange={(c) => toggleDynamic('Alpha', c)} buttonLabel={uiText.ribbonEmitterDialog.alpha}>
                        <Form.Item name="Alpha" noStyle><InputNumber style={inputStyle} size="small" min={0} max={1} step={0.1} disabled={dynamicProps.Alpha} /></Form.Item>
                    </DynamicField>
                </Col>
                <Col span={8}>
                    <DynamicField label={uiText.ribbonEmitterDialog.visibility} isDynamic={!!dynamicProps.Visibility} onDynamicChange={(c) => toggleDynamic('Visibility', c)} buttonLabel={uiText.ribbonEmitterDialog.visibility}>
                        <Form.Item name="Visibility" noStyle><InputNumber style={inputStyle} size="small" min={0} max={1} step={0.1} disabled={dynamicProps.Visibility} /></Form.Item>
                    </DynamicField>
                </Col>
            </Row>
            <Row gutter={8}>
                <Col span={8}>
                    <DynamicField label={uiText.ribbonEmitterDialog.heightAbove} isDynamic={!!dynamicProps.HeightAbove} onDynamicChange={(c) => toggleDynamic('HeightAbove', c)} buttonLabel={uiText.ribbonEmitterDialog.height}>
                        <Form.Item name="HeightAbove" noStyle><InputNumber style={inputStyle} size="small" disabled={dynamicProps.HeightAbove} /></Form.Item>
                    </DynamicField>
                </Col>
                <Col span={8}>
                    <DynamicField label={uiText.ribbonEmitterDialog.heightBelow} isDynamic={!!dynamicProps.HeightBelow} onDynamicChange={(c) => toggleDynamic('HeightBelow', c)} buttonLabel={uiText.ribbonEmitterDialog.height}>
                        <Form.Item name="HeightBelow" noStyle><InputNumber style={inputStyle} size="small" disabled={dynamicProps.HeightBelow} /></Form.Item>
                    </DynamicField>
                </Col>
                <Col span={8}>
                    <DynamicField label={uiText.ribbonEmitterDialog.textureSlot} isDynamic={!!dynamicProps.TextureSlot} onDynamicChange={(c) => toggleDynamic('TextureSlot', c)} buttonLabel={uiText.ribbonEmitterDialog.position}>
                        <Form.Item name="TextureSlot" noStyle><InputNumber style={inputStyle} size="small" min={0} disabled={dynamicProps.TextureSlot} /></Form.Item>
                    </DynamicField>
                </Col>
            </Row>
            <fieldset style={{ ...fieldsetStyle, marginBottom: 16 }}>
                <legend style={legendStyle}>{uiText.ribbonEmitterDialog.other}</legend>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ width: 80, color: '#888' }}>{uiText.ribbonEmitterDialog.materialId}</span>
                    <Form.Item name="MaterialID" noStyle><Select options={materialOptions} style={{ flex: 1 }} size="small" /></Form.Item>
                </div>
                <Row gutter={16} style={{ marginBottom: 4 }}>
                    <Col span={12}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ flex: 1, color: '#666', fontSize: 11 }}>{uiText.ribbonEmitterDialog.rowsHint}</span>
                            <Form.Item name="Rows" noStyle><InputNumber style={{ ...inputStyle, width: 60 }} size="small" min={1} /></Form.Item>
                        </div>
                    </Col>
                    <Col span={12}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ flex: 1, color: '#666', fontSize: 11 }}>{uiText.ribbonEmitterDialog.columnsHint}</span>
                            <Form.Item name="Columns" noStyle><InputNumber style={{ ...inputStyle, width: 60 }} size="small" min={1} /></Form.Item>
                        </div>
                    </Col>
                </Row>
                <Row gutter={16}>
                    <Col span={12}>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ width: 70, color: '#888' }}>{uiText.ribbonEmitterDialog.emissionRate}</span>
                            <Form.Item name="EmissionRate" noStyle><InputNumber style={{ ...inputStyle, flex: 1 }} size="small" min={0} /></Form.Item>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ width: 70, color: '#888' }}>{uiText.ribbonEmitterDialog.lifeSpan}</span>
                            <Form.Item name="LifeSpan" noStyle><InputNumber style={{ ...inputStyle, flex: 1 }} size="small" min={0} step={0.01} precision={2} /></Form.Item>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ width: 70, color: '#888' }}>{uiText.ribbonEmitterDialog.gravity}</span>
                            <Form.Item name="Gravity" noStyle><InputNumber style={{ ...inputStyle, flex: 1 }} size="small" /></Form.Item>
                        </div>
                    </Col>
                    <Col span={12} style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <Button onClick={handleOk} style={{ minWidth: 70 }}>{uiText.ribbonEmitterDialog.confirm}</Button>
                            <Button onClick={onClose} style={{ minWidth: 70 }}>{uiText.ribbonEmitterDialog.cancel}</Button>
                        </div>
                    </Col>
                </Row>
            </fieldset>
        </Form>
    )

    if (isStandalone) return <NodeEditorStandaloneShell>{ribbonFormInner}</NodeEditorStandaloneShell>

    return (
        <DraggableModal
            title={uiText.ribbonEmitterDialog.title}
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            footer={null}
            width={550}
            maskClosable={false}
            wrapClassName="dark-theme-modal"
            styles={{ body: { padding: '12px 16px', backgroundColor: '#1f1f1f', color: '#ccc' } }}
        >
            {ribbonFormInner}
        </DraggableModal>
    )
}

export default RibbonEmitterDialog
