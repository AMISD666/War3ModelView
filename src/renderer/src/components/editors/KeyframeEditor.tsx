import React, { useState, useEffect } from 'react'
import { Input, Select, Modal, Row, Col } from 'antd'

const { TextArea } = Input

interface KeyframeEditorProps {
    visible: boolean
    onCancel: () => void
    onOk: (animVector: any) => void
    initialData: any
    title?: string
    vectorSize?: number
    globalSequences?: number[]
}

const KeyframeEditor: React.FC<KeyframeEditorProps> = ({
    visible,
    onCancel,
    onOk,
    initialData,
    title = 'Keyframe Editor',
    vectorSize = 1,
    globalSequences = []
}) => {
    const [text, setText] = useState('')
    const [lineType, setLineType] = useState(0)
    const [globalSeqId, setGlobalSeqId] = useState<number | null>(null)

    useEffect(() => {
        if (visible && initialData) {
            // Format initial data to text
            // Format: "Frame: Value" or "Frame: V1 V2 V3"
            let formattedText = ''
            if (initialData.Keys) {
                formattedText = initialData.Keys.map((k: any) => {
                    let vector: number[] = []
                    if (Array.isArray(k.Vector)) {
                        vector = k.Vector
                    } else if (typeof k.Vector === 'object' && k.Vector !== null) {
                        // Handle object format {0: x, 1: y, ...}
                        for (let i = 0; i < vectorSize; i++) {
                            vector.push(Number(k.Vector[i] || 0))
                        }
                    } else if (typeof k.Vector === 'number') {
                        vector = [k.Vector]
                    }

                    const valStr = vector.map((v: number) => {
                        // Format number to remove trailing zeros if integer, or keep precision
                        return Number(v.toFixed(4)).toString()
                    }).join(' ')

                    let line = `${k.Frame}: ${valStr}`

                    // TODO: Handle Tangents if LineType is Hermite/Bezier?
                    // The reference image is simple "0: 1", implying no tangents shown or simple linear/none.
                    // If we need to support tangents in text, we might need a more complex format.
                    // For now, let's stick to value.

                    return line
                }).join('\n')
            }
            setText(formattedText)
            setLineType(initialData.LineType || 0)
            setGlobalSeqId(initialData.GlobalSeqId)
        } else if (visible) {
            setText('')
            setLineType(0)
            setGlobalSeqId(null)
        }
    }, [visible, initialData])

    const handleOk = () => {
        // Parse text
        const lines = text.split('\n')
        const keys: any[] = []

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            // Expected format: "Frame: Value"
            const parts = trimmed.split(':')
            if (parts.length !== 2) continue

            const frame = parseInt(parts[0].trim())
            if (isNaN(frame)) continue

            const valParts = parts[1].trim().split(/\s+/)
            const vector: number[] = []
            for (const vStr of valParts) {
                const v = parseFloat(vStr)
                if (!isNaN(v)) vector.push(v)
            }

            // Pad or truncate vector to vectorSize
            while (vector.length < vectorSize) vector.push(0)
            while (vector.length > vectorSize) vector.pop()

            const key: any = {
                Frame: frame,
                Vector: vector
            }

            // Add default tangents if needed (though we don't edit them in text yet)
            if (lineType > 1) {
                key.InTan = new Array(vectorSize).fill(0)
                key.OutTan = new Array(vectorSize).fill(0)
            }

            keys.push(key)
        }

        // Sort keys by frame
        keys.sort((a, b) => a.Frame - b.Frame)

        const result = {
            Keys: keys,
            LineType: lineType,
            GlobalSeqId: globalSeqId === -1 ? null : globalSeqId
        }

        onOk(result)
    }

    const globalSeqOptions = [
        { value: -1, label: '(None)' },
        ...globalSequences.map((duration, index) => ({
            value: index,
            label: `GlobalSequence ${index} (${duration})`
        }))
    ]

    return (
        <Modal
            title={title}
            open={visible}
            onCancel={onCancel}
            onOk={handleOk}
            width={600}
            destroyOnClose
            maskClosable={false}
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: 400 }}>
                <TextArea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    style={{ flex: 1, fontFamily: 'monospace', whiteSpace: 'pre' }}
                    placeholder="Format: Frame: Value"
                />

                <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 16 }}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <div style={{ marginBottom: 8 }}>全局序列 ID (Global Sequence ID)</div>
                            <Select
                                style={{ width: '100%' }}
                                value={globalSeqId === null ? -1 : globalSeqId}
                                onChange={(v) => setGlobalSeqId(v === -1 ? null : v)}
                                options={globalSeqOptions}
                            />
                        </Col>
                        <Col span={12}>
                            <div style={{ marginBottom: 8 }}>插值类型 (Interpolation Type)</div>
                            <Select
                                style={{ width: '100%' }}
                                value={lineType}
                                onChange={setLineType}
                                options={[
                                    { value: 0, label: 'None' },
                                    { value: 1, label: 'Linear' },
                                    { value: 2, label: 'Hermite' },
                                    { value: 3, label: 'Bezier' }
                                ]}
                            />
                        </Col>
                    </Row>
                </div>
            </div>
        </Modal>
    )
}

export default KeyframeEditor
