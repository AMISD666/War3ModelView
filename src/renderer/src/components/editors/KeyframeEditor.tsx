import React, { useState, useEffect } from 'react'
import { Input, Select, Row, Col } from 'antd'
import { DraggableModal } from '../DraggableModal'
import { useModelStore } from '../../store/modelStore'

const { TextArea } = Input

interface KeyframeEditorProps {
    visible: boolean
    onCancel: () => void
    onOk: (animVector: any) => void
    initialData: any
    title?: string
    vectorSize?: number
    globalSequences?: number[]
    sequences?: any[]
}

const KeyframeEditor: React.FC<KeyframeEditorProps> = ({
    visible,
    onCancel,
    onOk,
    initialData,
    title = 'Keyframe Editor',
    vectorSize = 1,
    globalSequences = [],
    sequences = []
}) => {
    const [text, setText] = useState('')
    const [lineType, setLineType] = useState(0)
    const [globalSeqId, setGlobalSeqId] = useState<number | null>(null)

    // Batch Generation State
    const [batchValue, setBatchValue] = useState<number>(1)
    const [batchMode, setBatchMode] = useState<'replace' | 'keep'>('replace')

    // Helper to format a single vector/scalar value
    const formatValue = (val: number | number[] | Float32Array): string => {
        let nums: number[] = []
        if (typeof val === 'number') {
            nums = [val]
        } else if (Array.isArray(val)) {
            nums = val
        } else {
            nums = Array.from(val)
        }

        // Format numbers
        const parts = nums.map(n => Number((n || 0).toFixed(4)).toString())

        // Scalar: just the number
        if (vectorSize === 1) return parts[0]

        // Vector: { a, b, c }
        return `{ ${parts.join(', ')} }`
    }

    // Helper to parse a value string like "{ 1, 0, 0 }" or "0.5"
    const parseValue = (str: string): number[] => {
        const clean = str.replace(/[{}]/g, '').trim()
        const parts = clean.split(/[,\s]+/).filter(Boolean)
        const nums = parts.map(p => parseFloat(p)).filter(n => !isNaN(n))

        // Pad or truncate
        while (nums.length < vectorSize) nums.push(0)
        return nums.slice(0, vectorSize)
    }

    // Generate formatted text from keys
    const generateText = (keys: any[], type: number) => {
        return keys.map(k => {
            let lines = [`${k.Frame}: ${formatValue(k.Vector)}`]

            if (type > 1) { // Hermite or Bezier
                const defaultTan = new Array(vectorSize).fill(0)
                lines.push(`  InTan: ${formatValue(k.InTan || defaultTan)}`)
                lines.push(`  OutTan: ${formatValue(k.OutTan || defaultTan)}`)
            }
            return lines.join('\n')
        }).join('\n')
    }

    // Parse current text into keys
    const parseText = (currentText: string): any[] => {
        const lines = currentText.split('\n')
        const keys: any[] = []
        let currentKey: any = null

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            if (trimmed.startsWith('InTan:')) {
                if (currentKey) currentKey.InTan = parseValue(trimmed.substring(6))
            } else if (trimmed.startsWith('OutTan:')) {
                if (currentKey) currentKey.OutTan = parseValue(trimmed.substring(7))
            } else {
                // Assume Frame: Value
                const parts = trimmed.split(':')
                if (parts.length >= 2) {
                    const frame = parseInt(parts[0])
                    if (!isNaN(frame)) {
                        const valStr = parts.slice(1).join(':') // Rejoin rest in case of nested colons? Unlikely given format
                        currentKey = {
                            Frame: frame,
                            Vector: parseValue(valStr),
                            InTan: new Array(vectorSize).fill(0),
                            OutTan: new Array(vectorSize).fill(0)
                        }
                        keys.push(currentKey)
                    }
                }
            }
        }
        return keys.sort((a, b) => a.Frame - b.Frame)
    }

    // Handle Interpolation Type Change
    const handleLineTypeChange = (newType: number) => {
        // Parse current text to preserve values
        const currentKeys = parseText(text)
        // Reformat with new type
        const newText = generateText(currentKeys, newType)

        setLineType(newType)
        setText(newText)
    }

    // Handle Batch Generation
    const handleBatchGenerate = () => {
        // Direct store access fallback if props are missing
        let targetSequences = sequences;
        if (!targetSequences || targetSequences.length === 0) {
            const storeData = useModelStore.getState().modelData as any;
            if (storeData && storeData.Sequences) {
                targetSequences = storeData.Sequences;
            }
        }

        console.log('[KeyframeEditor] Batch Generate clicked')
        console.log('Target Sequences:', targetSequences)
        console.log('VectorSize:', vectorSize)

        if (!targetSequences || targetSequences.length === 0) {
            console.warn('[KeyframeEditor] No sequences found')
            return
        }

        const currentKeys = parseText(text)
        const keyMap = new Map<number, any>()

        // Index existing keys
        currentKeys.forEach(k => keyMap.set(k.Frame, k))

        // Process sequences
        let count = 0
        targetSequences.forEach((seq: any) => {
            if (!seq.Interval || seq.Interval.length < 2) return

            const frames = [seq.Interval[0], seq.Interval[1]]
            frames.forEach(frame => {
                if (keyMap.has(frame)) {
                    // Update existing
                    if (batchMode === 'replace') {
                        const k = keyMap.get(frame)
                        k.Vector = [batchValue] // Only for scalar
                        count++
                    }
                } else {
                    // Create new
                    keyMap.set(frame, {
                        Frame: frame,
                        Vector: [batchValue],
                        InTan: new Array(vectorSize).fill(0),
                        OutTan: new Array(vectorSize).fill(0)
                    })
                    count++
                }
            })
        })

        console.log(`[KeyframeEditor] Generated/Updated ${count} keys`)

        // Reconstruct sorted list
        const newKeys = Array.from(keyMap.values()).sort((a, b) => a.Frame - b.Frame)
        const newText = generateText(newKeys, lineType)
        setText(newText)
    }

    useEffect(() => {
        if (visible) {
            if (initialData && initialData.Keys && initialData.Keys.length > 0) {
                // Existing data
                setLineType(initialData.LineType || 0)
                setGlobalSeqId(initialData.GlobalSeqId)
                setText(generateText(initialData.Keys, initialData.LineType || 0))
            } else {
                // Default data
                setLineType(0)
                setGlobalSeqId(null)

                // Smart defaults
                let defVector: number[] = new Array(vectorSize).fill(0)

                if (vectorSize === 4) {
                    // Rotation quaternion identity
                    defVector = [0, 0, 0, 1]
                } else if (vectorSize === 3) {
                    // Scale defaults to 1s
                    if (title.includes('Scale') || title.includes('Scaling') || title.includes('缩放')) {
                        defVector = [1, 1, 1]
                    }
                } else if (vectorSize === 1) {
                    // Alpha/Visibility defaults to 1
                    if (title.includes('Alpha') || title.includes('Visibility') || title.includes('透明') || title.includes('Opac')) {
                        defVector = [1]
                    }
                }

                const defaultKey = {
                    Frame: 0,
                    Vector: defVector,
                    InTan: new Array(vectorSize).fill(0),
                    OutTan: new Array(vectorSize).fill(0)
                }

                setText(generateText([defaultKey], 0))
            }
        }
    }, [visible, initialData])

    const handleOk = () => {
        const keys = parseText(text)

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
        <DraggableModal
            title={<span style={{ color: '#e8e8e8' }}>{title}</span>}
            open={visible}
            onCancel={onCancel}
            onOk={handleOk}
            width={600}
            destroyOnClose
            maskClosable={false}
            okText="确定"
            cancelText="取消"
            styles={{
                content: { backgroundColor: '#333333', border: '1px solid #4a4a4a' },
                header: { backgroundColor: '#333333', borderBottom: '1px solid #4a4a4a' },
                body: { backgroundColor: '#2d2d2d' },
                footer: { borderTop: '1px solid #4a4a4a' }
            }}
            wrapClassName="dark-theme-modal"
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: 400 }}>
                <TextArea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    style={{
                        flex: 1,
                        fontFamily: 'monospace',
                        whiteSpace: 'pre',
                        backgroundColor: '#252525',
                        color: '#e8e8e8',
                        borderColor: '#4a4a4a'
                    }}
                />

                <div style={{ marginTop: 16, borderTop: '1px solid #4a4a4a', paddingTop: 16 }}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <div style={{ marginBottom: 8, color: '#b0b0b0' }}>全局序列 ID (Global Sequence ID)</div>
                            <Select
                                style={{ width: '100%' }}
                                value={globalSeqId === null ? -1 : globalSeqId}
                                onChange={(v) => setGlobalSeqId(v === -1 ? null : v)}
                                options={globalSeqOptions}
                            />
                        </Col>
                        <Col span={12}>
                            <div style={{ marginBottom: 8, color: '#b0b0b0' }}>插值类型 (Interpolation Type)</div>
                            <Select
                                style={{ width: '100%' }}
                                value={lineType}
                                onChange={handleLineTypeChange}
                                options={[
                                    { value: 0, label: 'None' },
                                    { value: 1, label: 'Linear' },
                                    { value: 2, label: 'Hermite' },
                                    { value: 3, label: 'Bezier' }
                                ]}
                            />
                        </Col>
                    </Row>

                    {/* Simplified Batch Generation Section - Only for Scalars */}
                    {vectorSize === 1 && (
                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #4a4a4a' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: '#ccc' }}>数值:</span>
                                    <Input
                                        type="number"
                                        value={batchValue}
                                        onChange={(e) => setBatchValue(parseFloat(e.target.value))}
                                        style={{ width: 80, backgroundColor: '#333', color: '#fff', borderColor: '#444' }}
                                        size="small"
                                    />
                                </div>
                                <Select
                                    value={batchMode}
                                    onChange={(v) => setBatchMode(v as any)}
                                    size="small"
                                    style={{ width: 100 }}
                                    options={[
                                        { label: '替换', value: 'replace' },
                                        { label: '保持', value: 'keep' }
                                    ]}
                                />
                                <button
                                    onClick={handleBatchGenerate}
                                    style={{
                                        cursor: 'pointer',
                                        background: '#1890ff',
                                        border: 'none',
                                        color: '#fff',
                                        padding: '4px 12px',
                                        borderRadius: 2
                                    }}
                                >
                                    生成
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </DraggableModal>
    )
}

export default KeyframeEditor
