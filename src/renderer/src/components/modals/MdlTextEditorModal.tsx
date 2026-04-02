import React, { useEffect, useMemo, useState } from 'react'
import { Button, Input } from 'antd'
import { generateMDL, parseMDL } from 'war3-model'
import { DraggableModal } from '../DraggableModal'

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

    const modelLabel = useMemo(() => {
        if (!modelPath) return 'Untitled Model'
        const parts = modelPath.split(/[\\/]/)
        return parts[parts.length - 1] || modelPath
    }, [modelPath])

    const hydrateFromModel = React.useCallback(() => {
        const modelData = getModelDataSource()
        if (!modelData) {
            setTextValue('')
            setLoadError('No current model data is available.')
            setApplyError(null)
            setIsDirty(false)
            return
        }

        try {
            const text = generateMDL(modelData)
            setTextValue(text)
            setLoadError(null)
            setApplyError(null)
            setIsDirty(false)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            setTextValue('')
            setLoadError(message)
            setApplyError(null)
            setIsDirty(false)
        }
    }, [getModelDataSource])

    useEffect(() => {
        if (!visible) return
        hydrateFromModel()
    }, [visible, hydrateFromModel])

    const handleApply = () => {
        try {
            const parsed = parseMDL(textValue)
            onApplyModel(parsed)
            setApplyError(null)
            setIsDirty(false)
        } catch (error) {
            setApplyError(error instanceof Error ? error.message : String(error))
        }
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
                        {loadError || applyError || (isDirty ? 'Text changed. Click Apply To Model to refresh the current model.' : 'This shows the current model as editable plain text.')}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Button onClick={hydrateFromModel}>Refresh From Current Model</Button>
                        <Button type="primary" onClick={handleApply} disabled={!!loadError}>Apply To Model</Button>
                        <Button onClick={onClose}>Close</Button>
                    </div>
                </div>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '68vh', minHeight: 360 }}>
                <div style={{ color: '#bfbfbf', fontSize: 12 }}>
                    The current model is exported as text for editing. Applying will parse the text as MDL and update the model.
                </div>
                <Input.TextArea
                    value={textValue}
                    onChange={(event) => {
                        setTextValue(event.target.value)
                        setIsDirty(true)
                        if (applyError) setApplyError(null)
                    }}
                    spellCheck={false}
                    disabled={!!loadError}
                    autoSize={false}
                    style={{
                        flex: 1,
                        minHeight: 0,
                        resize: 'none',
                        fontFamily: 'Consolas, Monaco, monospace',
                        fontSize: 12,
                        lineHeight: 1.5,
                    }}
                />
            </div>
        </DraggableModal>
    )
}

export default MdlTextEditorModal
