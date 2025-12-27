import React, { useState, useEffect } from 'react'
import { Input, Select, Row, Col, InputNumber, Button } from 'antd'
import { DraggableModal } from '../DraggableModal'
import { useModelStore } from '../../store/modelStore'
import { useHistoryStore } from '../../store/historyStore'

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
    fieldName?: string  // 'TextureID', 'Alpha', etc.
}

const KeyframeEditor: React.FC<KeyframeEditorProps> = ({
    visible,
    onCancel,
    onOk,
    initialData,
    title = 'Keyframe Editor',
    vectorSize = 1,
    globalSequences = [],
    sequences = [],
    fieldName = ''
}) => {
    const modelData = useModelStore(state => state.modelData) as any
    const [text, setText] = useState('')
    const [lineType, setLineType] = useState(0)
    const [globalSeqId, setGlobalSeqId] = useState<number | null>(null)

    // Batch Generation State
    const [batchValue, setBatchValue] = useState<number>(1)
    const [batchMode, setBatchMode] = useState<'replace' | 'keep'>('replace')

    // Grid Generation State
    const [gridRows, setGridRows] = useState<number>(4)
    const [gridCols, setGridCols] = useState<number>(4)
    const [gridInterval, setGridInterval] = useState<number>(66)

    // TextureID Batch Generation State
    const textureCount = modelData?.Textures?.length || 1
    const [textureBatchCount, setTextureBatchCount] = useState<number>(textureCount)
    const [textureBatchInterval, setTextureBatchInterval] = useState<number>(100)

    // Check if editing TextureID
    const isTextureIDField = fieldName === 'TextureID' || title.includes('TextureID')

    // Helper to format a single vector/scalar value
    const formatValue = (val: number | number[] | Float32Array | undefined | null): string => {
        // Handle undefined/null
        if (val === undefined || val === null) {
            return vectorSize === 1 ? '0' : `{ ${new Array(vectorSize).fill('0').join(', ')} }`
        }

        let nums: number[] = []
        if (typeof val === 'number') {
            nums = [val]
        } else if (Array.isArray(val)) {
            nums = val
        } else {
            nums = Array.from(val as Float32Array)
        }

        // Format numbers
        const parts = nums.map(n => {
            const num = n ?? 0
            return Number(num.toFixed(4)).toString()
        })

        // Scalar: just the number
        if (vectorSize === 1) return parts[0] || '0'

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

    // Handle Grid Generation
    const handleGridGenerate = () => {
        let time = 0
        const stepX = 1 / gridCols
        const stepY = 1 / gridRows
        const newKeys: any[] = []

        // User requested: Clear text then generate
        // Iteration order logic:
        // Based on example: 0, 66, 133... 
        // 0: {0,0,0}, 66: {0.25, 0, 0}
        // This means Inner loop is Columns (X), Outer loop is Rows (Y).
        // Coordinates grow X first, then Y.

        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                // Vector 3: [U, V, Z]
                // InterpolationType forced to 0 (None) conceptually, but here we just generate keys.
                // The parent logic sets InterpolationType or we set it here if we were controlling object.
                // But this editor just sets text. User can change InterpType in dropdown.

                newKeys.push({
                    Frame: time,
                    Vector: [c * stepX, r * stepY, 0],
                    InTan: [0, 0, 0],
                    OutTan: [0, 0, 0]
                })

                time += gridInterval
            }
        }

        // Add final closing frame same as user example (1067: {1, 1, 0})
        newKeys.push({
            Frame: time,
            Vector: [1, 1, 0],
            InTan: [0, 0, 0],
            OutTan: [0, 0, 0]
        })

        const newText = generateText(newKeys, lineType) // Use current lineType (likely None/0)
        setText(newText)
    }

    // Helper to normalize keys (handle Frame/Time and Vector/Value aliases)
    const normalizeKeys = (keys: any[]): any[] => {
        if (!Array.isArray(keys)) return [];
        return keys.map(k => {
            // Handle various data formats: Vector, Value, or direct number
            let vector = k.Vector ?? k.Value;

            if (vector === undefined || vector === null) {
                vector = new Array(vectorSize).fill(0);
            } else if (typeof vector === 'number') {
                vector = [vector];
            } else if (Array.isArray(vector)) {
                // Already an array, use as-is
            } else if (typeof vector === 'object') {
                // Handle object format like {"0": 0, "1": 1} - convert to array
                // This happens with Int32Array or similar typed arrays serialized as objects
                const objKeys = Object.keys(vector).sort((a, b) => parseInt(a) - parseInt(b));
                vector = objKeys.map(key => vector[key]);
                if (vector.length === 0) {
                    vector = new Array(vectorSize).fill(0);
                }
            } else {
                // Fallback to default
                vector = new Array(vectorSize).fill(0);
            }

            return {
                Frame: k.Frame ?? k.Time ?? 0,
                Vector: vector,
                InTan: k.InTan ?? new Array(vectorSize).fill(0),
                OutTan: k.OutTan ?? new Array(vectorSize).fill(0)
            };
        });
    };

    // Handle TextureID Batch Generation
    const handleTextureIDBatchGenerate = () => {
        const newKeys: any[] = []
        // Generate frames for each texture (0 to textureBatchCount inclusive)
        // This creates textureBatchCount+1 keyframes: 0, 1, 2, ..., textureBatchCount
        for (let i = 0; i <= textureBatchCount; i++) {
            newKeys.push({
                Frame: i * textureBatchInterval,
                Vector: [i],
                InTan: [0],
                OutTan: [0]
            })
        }
        const newText = generateText(newKeys, lineType)
        setText(newText)
    }

    useEffect(() => {
        if (visible) {
            console.log('[KeyframeEditor] Opening with initialData:', initialData, 'fieldName:', fieldName)
            if (initialData && initialData.Keys && initialData.Keys.length > 0) {
                console.log('[KeyframeEditor] Raw Keys:', JSON.stringify(initialData.Keys))
                // Normalize and load existing data
                const normalizedKeys = normalizeKeys(initialData.Keys);
                console.log('[KeyframeEditor] Normalized Keys:', JSON.stringify(normalizedKeys))
                setLineType(initialData.LineType || 0)
                setGlobalSeqId(initialData.GlobalSeqId)
                setText(generateText(normalizedKeys, initialData.LineType || 0))
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

    const { push } = useHistoryStore()

    const handleOk = () => {
        const keys = parseText(text)

        const result = {
            Keys: keys,
            LineType: lineType,
            GlobalSeqId: globalSeqId === -1 ? null : globalSeqId
        }

        // --- History Logic ---
        // Note: initialData is the "before" state. result is the "new" state.
        // We need to know WHICH property of WHICH node we are editing to make the history restoration work.
        // KeyframeEditor doesn't strictly know 'nodeId' unless passed, but usually the parent component 
        // calling KeyframeEditor handles the actual store update (onOk).
        // 
        // HOWEVER, KeyframeEditor is used in many places. The `onOk` usually calls `updateNode`.
        // Ideally, the CALLER should push the history because the caller knows the context (nodeId, propertyName).

        // But the user asked to "Check all operations".
        // Let's look at `NodeParameterPanel` or where this opened.
        // Actually, `KeyframeEditor` is a dumb component? No, it calls `onOk`.
        // The `onOk` prop usually contains the logic to update the store.

        // Strategy: We can't easily push history HERE because we don't know the update function.
        // We should add history in the `onOk` handlers in the PARENT components.
        // Or, we ask the parents to pass a "historyContext" prop?
        // Or we inspect `NodeManagerWindow` / `NodeParameterPanel` where it is used.

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

                    {/* TextureID Batch Generation Section */}
                    {isTextureIDField && (
                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #4a4a4a' }}>
                            <div style={{ marginBottom: 8, color: '#b0b0b0' }}>贴图ID批量生成</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: '#ccc' }}>图片张数:</span>
                                    <InputNumber
                                        min={1}
                                        value={textureBatchCount}
                                        onChange={(v) => setTextureBatchCount(v || 1)}
                                        style={{ width: 70 }}
                                        size="small"
                                    />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: '#ccc' }}>间隔帧:</span>
                                    <InputNumber
                                        min={1}
                                        value={textureBatchInterval}
                                        onChange={(v) => setTextureBatchInterval(v || 100)}
                                        style={{ width: 70 }}
                                        size="small"
                                    />
                                </div>
                                <Button
                                    type="primary"
                                    size="small"
                                    onClick={handleTextureIDBatchGenerate}
                                >
                                    生成
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Simplified Batch Generation Section - Only for Scalars (NOT TextureID) */}
                    {vectorSize === 1 && !isTextureIDField && (
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

                    {/* Grid Generation Section - Only for Vector3 (Translation/UV, NOT Color) */}
                    {vectorSize === 3 && !title.includes('颜色') && !title.includes('Color') && !title.includes('环境色') && (
                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #4a4a4a', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: "#ccc" }}>行:</span>
                            <InputNumber
                                min={1}
                                value={gridRows}
                                onChange={(v) => setGridRows(v || 1)}
                                style={{ width: 60 }}
                                size="small"
                            />
                            <span style={{ color: "#ccc" }}>列:</span>
                            <InputNumber
                                min={1}
                                value={gridCols}
                                onChange={(v) => setGridCols(v || 1)}
                                style={{ width: 60 }}
                                size="small"
                            />
                            <span style={{ color: "#ccc" }}>间隔:</span>
                            <InputNumber
                                min={1}
                                value={gridInterval}
                                onChange={(v) => setGridInterval(v || 1)}
                                style={{ width: 60 }}
                                size="small"
                            />
                            <Button type="primary" size="small" onClick={handleGridGenerate}>
                                生成
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </DraggableModal>
    )
}

export default KeyframeEditor
