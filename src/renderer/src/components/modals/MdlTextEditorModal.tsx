import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Spin } from 'antd'
import { DraggableModal } from '../DraggableModal'
// @ts-ignore
import MdlTextWorker from '../../workers/mdlText.worker?worker'

interface MdlTextEditorModalProps {
    visible: boolean
    getModelDataSource: () => any | null
    modelPath: string | null
    onClose: () => void
    onApplyModel: (nextModel: any) => void
}

const MdlTextEditorModal: React.FC<MdlTextEditorModalProps> = ({
    visible,
    getModelDataSource,
    modelPath,
    onClose,
    onApplyModel,
}) => {
    const [textValue, setTextValue] = useState('')
    const [loadError, setLoadError] = useState<string | null>(null)
    const [applyError, setApplyError] = useState<string | null>(null)
    const [isDirty, setIsDirty] = useState(false)
    const [isHydrating, setIsHydrating] = useState(false)
    const [isApplying, setIsApplying] = useState(false)
    const workerRef = useRef<Worker | null>(null)
    const pendingGenerateRequestIdRef = useRef(0)
    const pendingParseRequestIdRef = useRef(0)

    const modelLabel = useMemo(() => {
        if (!modelPath) return 'Untitled Model'
        const parts = modelPath.split(/[\\/]/)
        return parts[parts.length - 1] || modelPath
    }, [modelPath])

    useEffect(() => {
        const worker = new MdlTextWorker()
        workerRef.current = worker

        worker.onmessage = (event: MessageEvent<any>) => {
            const payload = event.data
            if (!payload || typeof payload !== 'object') return

            if (payload.type === 'generate-success' && payload.requestId === pendingGenerateRequestIdRef.current) {
                startTransition(() => {
                    setTextValue(payload.text ?? '')
                    setLoadError(null)
                    setApplyError(null)
                    setIsDirty(false)
                    setIsHydrating(false)
                })
                return
            }

            if (payload.type === 'parse-success' && payload.requestId === pendingParseRequestIdRef.current) {
                setApplyError(null)
                setIsApplying(false)
                setIsDirty(false)
                onApplyModel(payload.model)
                return
            }

            if (payload.type === 'error') {
                if (payload.requestId === pendingGenerateRequestIdRef.current) {
                    startTransition(() => {
                        setTextValue('')
                        setLoadError(payload.error || 'Failed to generate MDL text.')
                        setApplyError(null)
                        setIsDirty(false)
                        setIsHydrating(false)
                    })
                    return
                }

                if (payload.requestId === pendingParseRequestIdRef.current) {
                    setApplyError(payload.error || 'Failed to parse MDL text.')
                    setIsApplying(false)
                }
            }
        }

        return () => {
            worker.terminate()
            workerRef.current = null
        }
    }, [onApplyModel])

    const hydrateFromModel = React.useCallback(() => {
        const modelData = getModelDataSource()
        if (!modelData) {
            setTextValue('')
            setLoadError('No current model data is available.')
            setApplyError(null)
            setIsDirty(false)
            setIsHydrating(false)
            return
        }

        const worker = workerRef.current
        if (!worker) {
            setLoadError('MDL text worker is unavailable.')
            setIsHydrating(false)
            return
        }

        setIsHydrating(true)
        setLoadError(null)
        setApplyError(null)
        const requestId = pendingGenerateRequestIdRef.current + 1
        pendingGenerateRequestIdRef.current = requestId

        window.setTimeout(() => {
            if (pendingGenerateRequestIdRef.current !== requestId) return
            worker.postMessage({
                type: 'generate',
                requestId,
                modelData
            })
        }, 0)
    }, [getModelDataSource])

    useEffect(() => {
        if (!visible) return
        hydrateFromModel()
    }, [visible, hydrateFromModel])

    const handleApply = () => {
        const worker = workerRef.current
        if (!worker) {
            setApplyError('MDL text worker is unavailable.')
            return
        }

        const requestId = pendingParseRequestIdRef.current + 1
        pendingParseRequestIdRef.current = requestId
        setIsApplying(true)
        setApplyError(null)
        worker.postMessage({
            type: 'parse',
            requestId,
            text: textValue
        })
    }

    return (
        <DraggableModal
            open={visible}
            onCancel={onClose}
            title={`Current Model TXT View - ${modelLabel}`}
            width={960}
            minWidth={720}
            minHeight={420}
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ color: loadError || applyError ? '#ff7875' : '#8c8c8c', fontSize: 12, minHeight: 18 }}>
                        {loadError || applyError || (isHydrating
                            ? '正在后台生成模型文本...'
                            : isApplying
                                ? '正在后台解析并应用模型文本...'
                                : isDirty
                                    ? 'Text changed. Click Apply To Model to refresh the current model.'
                                    : 'This shows the current model as editable plain text.')}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Button onClick={hydrateFromModel} loading={isHydrating} disabled={isApplying}>Refresh From Current Model</Button>
                        <Button type="primary" onClick={handleApply} loading={isApplying} disabled={!!loadError || isHydrating}>Apply To Model</Button>
                        <Button onClick={onClose}>Close</Button>
                    </div>
                </div>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '68vh', minHeight: 360 }}>
                <div style={{ color: '#bfbfbf', fontSize: 12 }}>
                    The current model is exported as text for editing. Applying will parse the text as MDL and update the model.
                </div>
                <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                    {(isHydrating || isApplying) && (
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 2,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(20, 20, 20, 0.45)'
                        }}>
                            <Spin tip={isHydrating ? '正在生成 MDL 文本...' : '正在解析 MDL 文本...'} />
                        </div>
                    )}
                    <Input.TextArea
                        value={textValue}
                        onChange={(event) => {
                            setTextValue(event.target.value)
                            setIsDirty(true)
                            if (applyError) setApplyError(null)
                        }}
                        spellCheck={false}
                        disabled={!!loadError || isHydrating || isApplying}
                        autoSize={false}
                        style={{
                            flex: 1,
                            minHeight: '100%',
                            resize: 'none',
                            fontFamily: 'Consolas, Monaco, monospace',
                            fontSize: 12,
                            lineHeight: 1.5,
                        }}
                    />
                </div>
            </div>
        </DraggableModal>
    )
}

export default MdlTextEditorModal
