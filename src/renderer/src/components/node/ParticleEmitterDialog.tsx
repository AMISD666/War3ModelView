import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Form, Input } from 'antd'
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell'
import { DraggableModal } from '../DraggableModal'
import { uiText } from '../../constants/uiText'
import { useModelStore } from '../../store/modelStore'
import type { ParticleEmitterNode } from '../../types/node'
import { NODE_EDITOR_COMMANDS, type NodeEditorCommandSender } from '../../types/nodeEditorRpc'
import { windowManager } from '../../utils/WindowManager'
import { nodeEditorCommandHandler } from '../../application/commands'
import { KEYFRAME_SAVE_EVENT, type KeyframeSavePayload } from '../../application/window-bridge'
import { useWindowEvent } from '../../hooks/useWindowEvent'

interface ParticleEmitterDialogProps {
    visible: boolean
    nodeId: number | null
    onClose: () => void
    isStandalone?: boolean
    standaloneNode?: ParticleEmitterNode | null
    standaloneEmit?: NodeEditorCommandSender
    standaloneModelData?: { Textures?: any[]; GlobalSequences?: any[]; Sequences?: any[] } | null
}

const EMITTER_USES_MDL = 32768
const EMITTER_USES_TGA = 65536

const isAnimVector = (val: any): boolean => val && typeof val === 'object' && Array.isArray(val.Keys)

const getStaticValue = (val: any, defaultVal: number = 0): number => {
    if (isAnimVector(val)) {
        const keys = val.Keys
        if (!Array.isArray(keys) || keys.length === 0) return defaultVal
        const firstKey = keys[0]
        const vec = firstKey?.Vector ?? firstKey?.Value
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

type NumericField = {
    name: string
    title: string
    min?: number
    max?: number
    precision?: number
    step?: number
}

const numericFields: NumericField[] = [
    { name: 'EmissionRate', title: uiText.particleEmitterDialog.emissionRate, min: 0 },
    { name: 'LifeSpan', title: uiText.particleEmitterDialog.lifeSpan, min: 0, precision: 3, step: 0.01 },
    { name: 'InitVelocity', title: uiText.particleEmitterDialog.initVelocity, precision: 3, step: 0.01 },
    { name: 'Gravity', title: uiText.particleEmitterDialog.gravity, precision: 3, step: 0.01 },
    { name: 'Longitude', title: uiText.particleEmitterDialog.longitude, precision: 3, step: 0.01 },
    { name: 'Latitude', title: uiText.particleEmitterDialog.latitude, precision: 3, step: 0.01 },
    { name: 'Visibility', title: uiText.particleEmitterDialog.visibility, min: 0, max: 1, precision: 3, step: 0.01 },
]

const ParticleEmitterDialog: React.FC<ParticleEmitterDialogProps> = ({
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
                ? (standaloneNode as ParticleEmitterNode | null)
                : (getNodeById(nodeId) as ParticleEmitterNode)
            : null

    const getCurrentSourceNode = React.useCallback((): ParticleEmitterNode | null => {
        if (nodeId === null) return null
        if (isStandalone) {
            return (standaloneNode as ParticleEmitterNode | null) ?? null
        }
        return (useModelStore.getState().getNodeById(nodeId) as ParticleEmitterNode | undefined) ?? null
    }, [isStandalone, nodeId, standaloneNode])

    const applyNodeToStore = React.useCallback(
        (next: ParticleEmitterNode, history?: { name: string; undoNode: any; redoNode: any }) => {
            if (nodeId === null) return
            if (isStandalone && standaloneEmit) {
                standaloneEmit(NODE_EDITOR_COMMANDS.applyNodeUpdate, { objectId: nodeId, node: next, history })
                return
            }
            nodeEditorCommandHandler.applyNodeUpdate({ objectId: nodeId, node: next, history })
        },
        [isStandalone, nodeId, standaloneEmit]
    )

    const [animDataMap, setAnimDataMap] = useState<Record<string, any>>({})
    const [currentEditingProp, setCurrentEditingProp] = useState<string | null>(null)

    const globalSequences = useMemo(
        () =>
            (modelData?.GlobalSequences || [])
                .map((g: any) => (typeof g === 'number' ? g : g?.Duration))
                .filter((v: any) => typeof v === 'number'),
        [modelData?.GlobalSequences]
    )

    useWindowEvent<KeyframeSavePayload>(KEYFRAME_SAVE_EVENT, (event) => {
        const payload = event.payload
        if (payload && payload.callerId === 'ParticleEmitterDialog' && currentEditingProp) {
            setAnimDataMap((prev) => ({ ...prev, [currentEditingProp]: payload.data }))
            setCurrentEditingProp(null)
        }
    })

    const handleOpenKeyframeEditor = (propName: string, title: string) => {
        setCurrentEditingProp(propName)
        const payload = {
            callerId: 'ParticleEmitterDialog',
            initialData: animDataMap[propName] || null,
            title: `${uiText.particleEmitterDialog.editPrefix}${title}`,
            vectorSize: 1,
            fieldName: propName,
            sequences: modelData?.Sequences || [],
            globalSequences: globalSequences as any,
        }
        const windowId = windowManager.getKeyframeWindowId(payload.fieldName)
        void windowManager.openKeyframeToolWindow(windowId, payload.title, 600, 480, payload)
    }

    const handleDynamicChange = (propName: string, checked: boolean) => {
        if (checked) {
            if (!animDataMap[propName]) {
                setAnimDataMap((prev) => ({ ...prev, [propName]: { Keys: [], LineType: 0, GlobalSeqId: null } }))
            }
            return
        }
        setAnimDataMap((prev) => {
            const copy = { ...prev }
            delete copy[propName]
            return copy
        })
    }

    const formHydratedForNodeIdRef = React.useRef<number | null>(null)
    useEffect(() => {
        if (!visible) {
            formHydratedForNodeIdRef.current = null
            return
        }
        if (nodeId === null || formHydratedForNodeIdRef.current === nodeId) return
        const sourceNode = isStandalone
            ? (standaloneNode as ParticleEmitterNode | null)
            : ((useModelStore.getState().getNodeById(nodeId) as ParticleEmitterNode | undefined) ?? null)
        if (!sourceNode) return
        formHydratedForNodeIdRef.current = nodeId

        const defaults = {
            Path: '',
            UsesMdl: false,
            UsesTga: false,
            EmissionRate: 10,
            LifeSpan: 1,
            InitVelocity: 0,
            Gravity: 0,
            Longitude: 0,
            Latitude: 0,
            Visibility: 1,
        }
        const newAnimDataMap: Record<string, any> = {}
        const flags = Number((sourceNode as any).Flags ?? 0)
        const path = (sourceNode as any).Path ?? (sourceNode as any).FileName ?? ''
        for (const field of numericFields) {
            const val = (sourceNode as any)[field.name]
            if (isAnimVector(val)) newAnimDataMap[field.name] = val
        }
        form.setFieldsValue({
            ...defaults,
            Path: path,
            UsesMdl: (flags & EMITTER_USES_MDL) !== 0,
            UsesTga: (flags & EMITTER_USES_TGA) !== 0,
            EmissionRate: getStaticValue((sourceNode as any).EmissionRate, defaults.EmissionRate),
            LifeSpan: getStaticValue((sourceNode as any).LifeSpan, defaults.LifeSpan),
            InitVelocity: getStaticValue((sourceNode as any).InitVelocity, defaults.InitVelocity),
            Gravity: getStaticValue((sourceNode as any).Gravity, defaults.Gravity),
            Longitude: getStaticValue((sourceNode as any).Longitude, defaults.Longitude),
            Latitude: getStaticValue((sourceNode as any).Latitude, defaults.Latitude),
            Visibility: getStaticValue((sourceNode as any).Visibility, defaults.Visibility),
        })
        setAnimDataMap(newAnimDataMap)
    }, [visible, nodeId, isStandalone, standaloneNode, form])

    const handleOk = async () => {
        try {
            const values = await form.validateFields()
            const sourceNode = getCurrentSourceNode()
            if (!sourceNode || nodeId === null) return
            let flags = Number((sourceNode as any).Flags ?? 0)
            if (values.UsesMdl) flags |= EMITTER_USES_MDL
            else flags &= ~EMITTER_USES_MDL
            if (values.UsesTga) flags |= EMITTER_USES_TGA
            else flags &= ~EMITTER_USES_TGA
            const updatedNode: ParticleEmitterNode = {
                ...sourceNode,
                ...(sourceNode as any),
                Flags: flags as any,
                Path: String(values.Path ?? ''),
                FileName: String(values.Path ?? ''),
            } as any
            for (const field of numericFields) {
                ;(updatedNode as any)[field.name] = animDataMap[field.name] ?? Number(values[field.name])
            }
            applyNodeToStore(updatedNode, {
                name: uiText.particleEmitterDialog.editHistory,
                undoNode: sourceNode,
                redoNode: updatedNode,
            })
            onClose()
        } catch (e) {
            console.error('Validation failed', e)
        }
    }

    const NumericGroup: React.FC<{ field: NumericField }> = ({ field }) => {
        const isDynamic = !!animDataMap[field.name]
        return (
            <fieldset className="pe1-group">
                <legend>{field.title}</legend>
                <div className="pe1-dyn-row">
                    <Checkbox checked={isDynamic} onChange={(e) => handleDynamicChange(field.name, e.target.checked)}>
                        {uiText.nodeDialog.dynamic}
                    </Checkbox>
                </div>
                <Button size="small" className="pe1-kf-btn" disabled={!isDynamic} onClick={() => handleOpenKeyframeEditor(field.name, field.title)}>
                    {field.title}
                </Button>
                <Form.Item name={field.name} style={{ marginBottom: 0 }}>
                    <InputNumber
                        size="small"
                        controls={false}
                        min={field.min}
                        max={field.max}
                        precision={field.precision}
                        step={field.step}
                        disabled={isDynamic}
                        placeholder="0"
                        className="pe1-number"
                    />
                </Form.Item>
            </fieldset>
        )
    }

    const pe1Form = (
        <Form form={form} layout="vertical">
            <div className="pe1-grid">
                {numericFields.map((field) => (
                    <NumericGroup key={field.name} field={field} />
                ))}
                <fieldset className="pe1-group pe1-other">
                    <legend>{uiText.particleEmitterDialog.other}</legend>
                    <div className="pe1-other-label">{uiText.particleEmitterDialog.pathLabel}</div>
                    <Form.Item name="Path" style={{ marginBottom: 8 }}>
                        <Input size="small" className="pe1-text" placeholder={uiText.particleEmitterDialog.pathPlaceholder} />
                    </Form.Item>
                    <div className="pe1-other-checks">
                        <Form.Item name="UsesMdl" valuePropName="checked" style={{ marginBottom: 4 }}>
                            <Checkbox>{uiText.particleEmitterDialog.usesMdl}</Checkbox>
                        </Form.Item>
                        <Form.Item name="UsesTga" valuePropName="checked" style={{ marginBottom: 0 }}>
                            <Checkbox>{uiText.particleEmitterDialog.usesTga}</Checkbox>
                        </Form.Item>
                    </div>
                </fieldset>
            </div>
        </Form>
    )

    const actions = (
        <>
            <Button onClick={handleOk} type="primary" size="small">
                {uiText.particleEmitter2Dialog.confirm}
            </Button>
            <Button onClick={onClose} size="small">
                {uiText.particleEmitter2Dialog.cancel}
            </Button>
        </>
    )

    if (isStandalone) {
        return (
            <NodeEditorStandaloneShell>
                <>
                    {pe1Form}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>{actions}</div>
                </>
            </NodeEditorStandaloneShell>
        )
    }

    return (
        <DraggableModal
            title={uiText.particleEmitterDialog.title}
            open={visible}
            onCancel={onClose}
            footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{actions}</div>}
            width={540}
            resizable={false}
            maskClosable={false}
            wrapClassName="pe1-dialog"
            styles={{ body: { padding: 10 } }}
        >
            {pe1Form}
        </DraggableModal>
    )
}

export default ParticleEmitterDialog
