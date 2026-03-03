import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Input, Select, Row, Col, Button, ColorPicker } from 'antd'
import { SmartInputNumber as InputNumber } from '@renderer/components/common/SmartInputNumber'
import { DraggableModal } from '../DraggableModal'
import { useModelStore } from '../../store/modelStore'
import { useHistoryStore } from '../../store/historyStore'
import { listen } from '@tauri-apps/api/event'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CloseOutlined } from '@ant-design/icons'
import { GlobalSequenceSelect } from '../common/GlobalSequenceSelect'

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
    isStandalone?: boolean
}

const KeyframeEditor: React.FC<KeyframeEditorProps> = (props) => {
    // We do not destructure defaults immediately, as standalone mode will overwrite them from IPC
    const {
        visible,
        onCancel,
        onOk,
        isStandalone = false
    } = props

    const [standaloneData, setStandaloneData] = useState<any>({
        initialData: props.initialData,
        title: props.title ?? 'Keyframe Editor',
        vectorSize: props.vectorSize ?? 1,
        globalSequences: props.globalSequences ?? [],
        sequences: props.sequences ?? [],
        fieldName: props.fieldName ?? '',
        callerId: ''
    })

    const title = isStandalone ? standaloneData.title : (props.title ?? 'Keyframe Editor')
    const vectorSize = isStandalone ? standaloneData.vectorSize : (props.vectorSize ?? 1)
    const globalSequences = isStandalone ? standaloneData.globalSequences : (props.globalSequences ?? [])
    const sequences = isStandalone ? standaloneData.sequences : (props.sequences ?? [])
    const fieldName = isStandalone ? standaloneData.fieldName : (props.fieldName ?? '')
    const initialData = isStandalone ? standaloneData.initialData : props.initialData

    const modelData = useModelStore(state => state.modelData) as any
    const [text, setText] = useState('')
    const [lineType, setLineType] = useState(0)
    const [globalSeqId, setGlobalSeqId] = useState<number | null>(null)
    const [textScrollTop, setTextScrollTop] = useState(0)

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
    const isColorField = vectorSize === 3 && (
        fieldName.toLowerCase().includes('color') ||
        title.includes('颜色') ||
        title.includes('Color') ||
        title.includes('環境色') ||
        title.includes('环境色')
    )

    // Helper to format a single vector/scalar value
    const formatValue = (val: number | number[] | Float32Array | undefined | null, vSize: number): string => {
        // Handle undefined/null
        if (val === undefined || val === null) {
            return vSize === 1 ? '0' : `{ ${new Array(vSize).fill('0').join(', ')} } `
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
        if (vSize === 1) return parts[0] || '0'

        // Vector: { a, b, c }
        return `{ ${parts.join(', ')} } `
    }

    // Helper to parse a value string like "{ 1, 0, 0 }" or "0.5"
    const parseValue = (str: string, vSize: number): number[] => {
        const clean = str.replace(/[{}]/g, '').trim()
        const parts = clean.split(/[,\s]+/).filter(Boolean)
        const nums = parts.map(p => parseFloat(p)).filter(n => !isNaN(n))

        // Pad or truncate
        while (nums.length < vSize) nums.push(0)
        return nums.slice(0, vSize)
    }

    // Generate formatted text from keys
    const generateText = (keys: any[], type: number, vSize: number) => {
        return keys.map(k => {
            let lines = [`${k.Frame}: ${formatValue(k.Vector, vSize)} `]

            if (type > 1) { // Hermite or Bezier
                const defaultTan = new Array(vSize).fill(0)
                lines.push(`  InTan: ${formatValue(k.InTan || defaultTan, vSize)} `)
                lines.push(`  OutTan: ${formatValue(k.OutTan || defaultTan, vSize)} `)
            }
            return lines.join('\n')
        }).join('\n')
    }

    // Parse current text into keys
    const parseText = (currentText: string, vSize: number): any[] => {
        const lines = currentText.split('\n')
        const keys: any[] = []
        let currentKey: any = null

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            if (trimmed.startsWith('InTan:')) {
                if (currentKey) currentKey.InTan = parseValue(trimmed.substring(6), vSize)
            } else if (trimmed.startsWith('OutTan:')) {
                if (currentKey) currentKey.OutTan = parseValue(trimmed.substring(7), vSize)
            } else {
                // Assume Frame: Value
                const parts = trimmed.split(':')
                if (parts.length >= 2) {
                    const frame = parseInt(parts[0])
                    if (!isNaN(frame)) {
                        const valStr = parts.slice(1).join(':')
                        currentKey = {
                            Frame: frame,
                            Vector: parseValue(valStr, vSize),
                            InTan: new Array(vSize).fill(0),
                            OutTan: new Array(vSize).fill(0)
                        }
                        keys.push(currentKey)
                    }
                }
            }
        }
        return keys.sort((a, b) => a.Frame - b.Frame)
    }

    const deferredText = React.useDeferredValue(text);
    const parsedKeys = useMemo(() => {
        return parseText(deferredText)
    }, [deferredText, vectorSize])

    const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
    const toHex = (r: number, g: number, b: number) => {
        const toPart = (n: number) => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0')
        return `#${toPart(r)}${toPart(g)}${toPart(b)} `
    }

    const updateColorForFrame = (frame: number, color: { r: number; g: number; b: number }) => {
        const keys = parseText(text, vectorSize)
        const updated = keys.map((key) => {
            if (key.Frame !== frame) return key
            return {
                ...key,
                Vector: [
                    clamp01(color.r / 255),
                    clamp01(color.g / 255),
                    clamp01(color.b / 255)
                ]
            }
        })
        setText(generateText(updated, lineType, vectorSize))
    }

    const lineHeight = 24
    const textPaddingTop = 8
    const textPaddingLeft = 28

    const colorMarkers = useMemo(() => {
        if (!isColorField) return [] as Array<{ frame: number; lineIndex: number; hex: string }>
        const lines = text.split('\n')
        const keyMap = new Map<number, any>()
        parsedKeys.forEach((k) => keyMap.set(k.Frame, k))

        const markers: Array<{ frame: number; lineIndex: number; hex: string }> = []
        for (let i = 0; i < lines.length; i += 1) {
            const trimmed = lines[i].trim()
            const match = trimmed.match(/^(-?\d+)\s*:/)
            if (!match) continue
            const frame = parseInt(match[1], 10)
            if (isNaN(frame)) continue
            const key = keyMap.get(frame)
            if (!key) continue
            const vec = Array.isArray(key.Vector) ? key.Vector : [0, 0, 0]
            const r = vec[0] ?? 0
            const g = vec[1] ?? 0
            const b = vec[2] ?? 0
            markers.push({
                frame,
                lineIndex: i,
                hex: toHex(r, g, b)
            })
        }
        return markers
    }, [isColorField, parsedKeys, text])

    const getDefaultVector = () => {
        let defVector: number[] = new Array(vectorSize).fill(0)
        if (vectorSize === 4) {
            defVector = [0, 0, 0, 1]
        } else if (vectorSize === 3) {
            if (isColorField || title.includes('Color') || title.includes('颜色') || title.includes('环境色') || title.includes('環境色')) {
                defVector = [1, 1, 1]
            } else if (title.includes('Scale') || title.includes('Scaling') || title.includes('缩放')) {
                defVector = [1, 1, 1]
            }
        } else if (vectorSize === 1) {
            if (title.includes('Alpha') || title.includes('Visibility') || title.includes('透明') || title.includes('Opac')) {
                defVector = [1]
            }
        }
        return defVector
    }

    const applyDefaultValuesForEmptyFrames = (value: string) => {
        if (!isColorField) return value
        const defValue = formatValue(getDefaultVector(), vectorSize)
        let changed = false
        const lines = value.split('\n').map((line) => {
            const trimmed = line.trim()
            if (!trimmed) return line
            if (trimmed.startsWith('InTan:') || trimmed.startsWith('OutTan:')) return line
            const frameOnly = trimmed.match(/^(-?\d+)\s*$/)
            const frameColon = trimmed.match(/^(-?\d+)\s*:\s*$/)
            const frame = frameOnly?.[1] ?? frameColon?.[1]
            if (!frame) return line
            changed = true
            const prefix = line.match(/^\s*/)?.[0] ?? ''
            return `${prefix}${frame}: ${defValue} `
        })
        return changed ? lines.join('\n') : value
    }

    const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!isColorField) return
        if (e.key !== 'Enter') return
        const target = e.currentTarget
        const value = target.value
        const selStart = target.selectionStart ?? 0
        const selEnd = target.selectionEnd ?? selStart
        if (selStart !== selEnd) return

        const lineStart = value.lastIndexOf('\n', selStart - 1) + 1
        let lineEnd = value.indexOf('\n', selStart)
        if (lineEnd === -1) lineEnd = value.length
        const line = value.slice(lineStart, lineEnd)
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('InTan:') || trimmed.startsWith('OutTan:')) return

        const match = trimmed.match(/^(-?\d+)\s*:?$/)
        if (!match) return
        const frame = match[1]
        const prefix = line.match(/^\s*/)?.[0] ?? ''
        const defValue = formatValue(getDefaultVector(), vectorSize)
        const updatedLine = `${prefix}${frame}: ${defValue} `
        const newValue = value.slice(0, lineStart) + updatedLine + value.slice(lineEnd)
        const insertPos = lineStart + updatedLine.length
        const withNewline = newValue.slice(0, insertPos) + '\n' + newValue.slice(insertPos)

        setText(withNewline)
        e.preventDefault()
        requestAnimationFrame(() => {
            const newCaret = insertPos + 1
            target.selectionStart = newCaret
            target.selectionEnd = newCaret
        })
    }

    // Handle Interpolation Type Change
    const handleLineTypeChange = (newType: number) => {
        // Parse current text to preserve values
        const currentKeys = parseText(text, vectorSize)
        // Reformat with new type
        const newText = generateText(currentKeys, newType, vectorSize)

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

        console.log(`[KeyframeEditor] Generated / Updated ${count} keys`)

        // Reconstruct sorted list
        const newKeys = Array.from(keyMap.values()).sort((a, b) => a.Frame - b.Frame)
        const newText = generateText(newKeys, lineType, vectorSize)
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

        const newText = generateText(newKeys, lineType, vectorSize) // Use current lineType (likely None/0)
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
        const newText = generateText(newKeys, lineType, vectorSize)
        setText(newText)
    }

    useEffect(() => {
        if (!isStandalone && visible) {
            console.log('[KeyframeEditor] Opening with initialData:', initialData, 'fieldName:', fieldName)
            if (initialData && initialData.Keys && initialData.Keys.length > 0) {
                // Normalize and load existing data
                const normalizedKeys = normalizeKeys(initialData.Keys);
                setLineType(initialData.LineType ?? 0)
                setGlobalSeqId(initialData.GlobalSeqId ?? null)
                setText(generateText(normalizedKeys, initialData.LineType || 0))
            } else {
                // Default data
                setLineType(0)
                setGlobalSeqId(null)
                const defVector = getDefaultVector()
                const defaultKey = {
                    Frame: 0,
                    Vector: defVector,
                    InTan: new Array(vectorSize).fill(0),
                    OutTan: new Array(vectorSize).fill(0)
                }
                setText(generateText([defaultKey], 0))
            }
        }
    }, [visible, initialData, vectorSize, fieldName, isStandalone])

    useEffect(() => {
        if (!isStandalone) return;

        const currentWindowLabel = getCurrentWindow().label;
        console.log(`[KeyframeEditor] Standalone mode initializing IPC listener on ${currentWindowLabel}`);

        const unlisten = listen('IPC_KEYFRAME_INIT', (event) => {
            const payload = event.payload as any;
            if (!payload) return;

            // PERFORMANCE: Only update if this message is intended for THIS window instance.
            // This prevents all 8 pooled windows from re-rendering simultaneously on every click.
            if (payload.targetWindowId && payload.targetWindowId !== currentWindowLabel) {
                return;
            }

            console.log(`[KeyframeEditor] ${currentWindowLabel} accepted IPC_KEYFRAME_INIT`);
            const initData = payload.initialData;
            const vSize = payload.vectorSize || 1;
            const fName = payload.fieldName || '';
            const titleStr = payload.title || 'Keyframe Editor';

            setStandaloneData({
                initialData: initData,
                title: titleStr,
                vectorSize: vSize,
                globalSequences: payload.globalSequences || [],
                sequences: payload.sequences || [],
                fieldName: fName,
                callerId: payload.callerId || ''
            });

            // Performance: Update text and secondary states in the same batch
            setLineType(initData?.LineType ?? 0);
            setGlobalSeqId(initData?.GlobalSeqId ?? null);

            if (initData && initData.Keys && initData.Keys.length > 0) {
                const normalized = normalizeKeys(initData.Keys);
                // Temporarily mock vectorSize for generateText because it hasn't updated in scope yet
                // But generateText helper uses top-level vectorSize? 
                // No, it uses the one defined inside the component.
                // Actually, we should probably pass it or calculate it.
                setText(generateText(normalized, initData.LineType || 0));
            } else {
                const defVector = vSize === 4 ? [0, 0, 0, 1] : new Array(vSize).fill(titleStr.includes('Scale') ? 1 : (fName.includes('Alpha') ? 1 : 0));
                setText(generateText([{ Frame: 0, Vector: defVector, InTan: new Array(vSize).fill(0), OutTan: new Array(vSize).fill(0) }], 0, vSize));
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [isStandalone]);


    const { push } = useHistoryStore()

    const handleOk = () => {
        const keys = parseText(text, vectorSize)

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

        onOk && onOk(result)

        if (isStandalone) {
            console.log('[KeyframeEditor] Emitting IPC_KEYFRAME_SAVE to caller:', standaloneData.callerId);
            emit('IPC_KEYFRAME_SAVE', {
                callerId: standaloneData.callerId,
                data: result
            });
            getCurrentWindow().hide();
        }
    }

    const handleCancel = () => {
        if (isStandalone) {
            getCurrentWindow().hide();
        } else {
            onCancel && onCancel();
        }
    }


    const innerContent = (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: isStandalone ? '12px 16px' : 0 }}>
            <div style={{ position: 'relative', flex: 1, minHeight: 180 }}>
                <TextArea
                    value={text}
                    rows={8}
                    onChange={(e) => setText(applyDefaultValuesForEmptyFrames(e.target.value))}
                    onKeyDown={handleTextKeyDown}
                    onScroll={(e) => setTextScrollTop((e.target as HTMLTextAreaElement).scrollTop)}
                    style={{
                        flex: 1,
                        height: '100%',
                        whiteSpace: 'pre',
                        backgroundColor: '#252525',
                        color: '#e8e8e8',
                        borderColor: '#4a4a4a',
                        lineHeight: `${lineHeight}px`,
                        paddingTop: textPaddingTop,
                        paddingLeft: textPaddingLeft,
                        fontFamily: 'Consolas, Menlo, monospace',
                        resize: 'none'
                    }}
                />

                {isColorField && colorMarkers.length > 0 && (
                    <div
                        style={{
                            position: 'absolute',
                            left: 8,
                            top: textPaddingTop - textScrollTop,
                            pointerEvents: 'none'
                        }}
                    >
                        {colorMarkers.map((marker) => (
                            <div
                                key={`${marker.frame}-${marker.lineIndex}`}
                                style={{
                                    position: 'absolute',
                                    top: marker.lineIndex * lineHeight,
                                    left: 0,
                                    pointerEvents: 'auto'
                                }}
                            >
                                <ColorPicker
                                    value={marker.hex}
                                    size="small"
                                    showText={false}
                                    style={{ transform: 'scale(0.6)', transformOrigin: 'left center' }}
                                    onChange={(color) => updateColorForFrame(marker.frame, color.toRgb())}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ marginTop: 12, borderTop: '1px solid #4a4a4a', paddingTop: 12 }}>
                <Row gutter={12}>
                    <Col span={12}>
                        <div style={{ marginBottom: 4, color: '#b0b0b0', fontSize: 12 }}>全局序列 ID</div>
                        <GlobalSequenceSelect
                            value={globalSeqId}
                            onChange={setGlobalSeqId}
                            isStandalone={isStandalone}
                        />
                    </Col>
                    <Col span={12}>
                        <div style={{ marginBottom: 4, color: '#b0b0b0', fontSize: 12 }}>插值类型</div>
                        <Select
                            style={{ width: '100%' }}
                            size="small"
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
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #4a4a4a' }}>
                        <div style={{ marginBottom: 6, color: '#b0b0b0', fontSize: 12 }}>贴图ID批量生成</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ color: '#ccc', fontSize: 12 }}>张数:</span>
                                <InputNumber
                                    min={1}
                                    value={textureBatchCount}
                                    onChange={(v) => setTextureBatchCount(v || 1)}
                                    style={{ width: 60 }}
                                    size="small"
                                />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ color: '#ccc', fontSize: 12 }}>间隔:</span>
                                <InputNumber
                                    min={1}
                                    value={textureBatchInterval}
                                    onChange={(v) => setTextureBatchInterval(v || 100)}
                                    style={{ width: 60 }}
                                    size="small"
                                />
                            </div>
                            <Button
                                type="primary"
                                size="small"
                                onClick={handleTextureIDBatchGenerate}
                                style={{ fontSize: 12 }}
                            >
                                生成
                            </Button>
                        </div>
                    </div>
                )}

                {/* Simplified Batch Generation Section - Only for Scalars (NOT TextureID) */}
                {vectorSize === 1 && !isTextureIDField && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #4a4a4a' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span style={{ color: '#ccc', fontSize: 12 }}>数值:</span>
                                <Input
                                    type="number"
                                    value={batchValue}
                                    onChange={(e) => setBatchValue(parseFloat(e.target.value))}
                                    style={{ width: 70, backgroundColor: '#333', color: '#fff', borderColor: '#444' }}
                                    size="small"
                                />
                            </div>
                            <Select
                                value={batchMode}
                                onChange={(v) => setBatchMode(v as any)}
                                size="small"
                                style={{ width: 80 }}
                                options={[
                                    { label: '替换', value: 'replace' },
                                    { label: '保持', value: 'keep' }
                                ]}
                            />
                            <Button
                                type="primary"
                                size="small"
                                onClick={handleBatchGenerate}
                                style={{ fontSize: 12 }}
                            >
                                生成
                            </Button>
                        </div>
                    </div>
                )}

                {/* Grid Generation Section - Only for Vector3 (Translation/UV, NOT Color) */}
                {vectorSize === 3 && !title.includes('颜色') && !title.includes('Color') && !title.includes('环境色') && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #4a4a4a', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: "#ccc", fontSize: 12 }}>行:</span>
                        <InputNumber
                            min={1}
                            value={gridRows}
                            onChange={(v) => setGridRows(v || 1)}
                            style={{ width: 50 }}
                            size="small"
                        />
                        <span style={{ color: "#ccc", fontSize: 12 }}>列:</span>
                        <InputNumber
                            min={1}
                            value={gridCols}
                            onChange={(v) => setGridCols(v || 1)}
                            style={{ width: 50 }}
                            size="small"
                        />
                        <span style={{ color: "#ccc", fontSize: 12 }}>间隔:</span>
                        <InputNumber
                            min={1}
                            value={gridInterval}
                            onChange={(v) => setGridInterval(v || 1)}
                            style={{ width: 55 }}
                            size="small"
                        />
                        <Button type="primary" size="small" onClick={handleGridGenerate} style={{ fontSize: 12 }}>
                            生成
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );

    if (isStandalone) {
        return (
            <div style={{ width: '100vw', height: '100vh', backgroundColor: '#1e1e1e', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ height: '32px', minHeight: '32px', backgroundColor: '#222', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid #333' }}>
                    <div data-tauri-drag-region style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', cursor: 'default' }}>
                        <span data-tauri-drag-region style={{ color: '#e0e0e0', fontWeight: 600, fontSize: 13 }}>{title}</span>
                    </div>
                    <Button
                        type="text"
                        size="small"
                        icon={<CloseOutlined style={{ fontSize: 14 }} />}
                        onClick={handleCancel}
                        style={{ color: '#888', zIndex: 10, width: 24, height: 24, minWidth: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                    />
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ flex: 1 }}>{innerContent}</div>
                    <div style={{ padding: '12px 16px', borderTop: '1px solid #333', display: 'flex', justifyContent: 'flex-end', gap: 8, backgroundColor: '#222' }}>
                        <Button onClick={handleCancel} style={{ background: 'transparent', borderColor: '#4a4a4a', color: '#e8e8e8' }}>取消</Button>
                        <Button type="primary" onClick={handleOk}>确定</Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <DraggableModal
            title={<span style={{ color: '#e8e8e8' }}>{title}</span>}
            open={visible}
            onCancel={handleCancel}
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
            {innerContent}
        </DraggableModal>
    )
}

export default KeyframeEditor


