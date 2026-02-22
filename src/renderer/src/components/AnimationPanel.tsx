import React, { useState, useRef, useEffect } from 'react'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'
import { useHistoryStore } from '../store/historyStore'
import { WarningOutlined, CopyOutlined } from '@ant-design/icons'
import { Tooltip, Input, message } from 'antd'

interface AnimationPanelProps {
    onImport: () => void
}

// Helper to check if a sequence has valid Interval
// Note: Interval can be a regular Array or TypedArray (Float32Array)
const isValidSequence = (anim: any): boolean => {
    if (!anim.Interval) return false
    // Check length property works for both Array and TypedArray
    if (typeof anim.Interval.length !== 'number' || anim.Interval.length < 2) return false
    // Check if values are valid numbers
    return typeof anim.Interval[0] === 'number' && typeof anim.Interval[1] === 'number'
}

const AnimationPanel: React.FC<AnimationPanelProps> = ({
    onImport
}) => {
    const {
        modelPath,
        sequences,
        currentSequence,
        setSequence,
        setPlaying,
        setSequences
    } = useModelStore()

    const { push } = useHistoryStore()

    // State for inline editing
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [editingName, setEditingName] = useState('')
    const inputRef = useRef<any>(null)

    // Focus input when editing starts
    useEffect(() => {
        if (editingIndex !== null && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [editingIndex])

    const handleSequenceSelect = (index: number) => {
        // Don't select if currently editing
        if (editingIndex !== null) return

        // Check if sequence is valid before allowing selection
        if (index >= 0 && index < sequences.length) {
            const anim = sequences[index]
            if (!isValidSequence(anim)) {
                // Don't allow selecting invalid sequences
                return
            }
        }
        setSequence(index)
        window.dispatchEvent(new Event('timeline-fit-current-sequence'))
        // Auto-play if in View Mode
        if (index !== -1 && useSelectionStore.getState().mainMode === 'view') {
            setPlaying(true)
        }
    }

    const handleDoubleClick = (index: number, e: React.MouseEvent) => {
        e.stopPropagation()
        const anim = sequences[index]
        setEditingIndex(index)
        setEditingName(anim.Name || `动画 ${index}`)
    }

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditingName(e.target.value)
    }

    const handleNameConfirm = () => {
        if (editingIndex === null) return

        const trimmedName = editingName.trim()
        if (!trimmedName) {
            message.warning('动画名称不能为空')
            setEditingIndex(null)
            return
        }

        const oldSequences = [...sequences]
        const newSequences = sequences.map((seq, idx) =>
            idx === editingIndex ? { ...seq, Name: trimmedName } : seq
        )

        // History
        push({
            name: `Rename Sequence to "${trimmedName}"`,
            undo: () => setSequences(oldSequences),
            redo: () => setSequences(newSequences)
        })

        setSequences(newSequences)
        setEditingIndex(null)
        message.success('名称已修改')
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleNameConfirm()
        } else if (e.key === 'Escape') {
            setEditingIndex(null)
        }
    }

    return (
        <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#2b2b2b',
            color: '#eee',
            padding: '15px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '15px',
            overflowY: 'auto',
            borderRight: '1px solid #444'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, whiteSpace: 'nowrap' }}>动画控制</h3>
                <button
                    onClick={onImport}
                    style={{
                        padding: '4px 8px',
                        background: '#4a90e2',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                    }}
                >
                    导入模型
                </button>
            </div>

            {modelPath && (
                <div style={{
                    fontSize: '12px',
                    wordBreak: 'break-all',
                    color: '#aaa',
                    marginBottom: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '4px',
                    background: '#333',
                    padding: '4px 8px',
                    borderRadius: '4px'
                }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        当前模型: {modelPath.split(/[\\/]/).pop()}
                    </span>
                    <Tooltip title="复制文件名">
                        <CopyOutlined
                            onClick={() => {
                                const fileName = modelPath.split(/[\\/]/).pop() || '';
                                navigator.clipboard.writeText(fileName);
                                message.success('模型名称已复制');
                            }}
                            style={{
                                cursor: 'pointer',
                                color: '#4a90e2',
                                fontSize: '14px',
                                padding: '2px'
                            }}
                        />
                    </Tooltip>
                </div>
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ marginBottom: '10px', borderBottom: '1px solid #444', paddingBottom: '5px' }}>
                    <h4 style={{ margin: 0 }}>动画序列 <span style={{ fontSize: '10px', color: '#888', fontWeight: 'normal' }}>(双击名称可编辑)</span></h4>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #444', borderRadius: '4px', background: '#333' }}>
                    <div
                        onClick={() => handleSequenceSelect(-1)}
                        style={{
                            padding: '8px',
                            cursor: 'pointer',
                            backgroundColor: currentSequence === -1 ? '#4a90e2' : 'transparent',
                            color: currentSequence === -1 ? 'white' : '#eee',
                            borderBottom: '1px solid #444'
                        }}
                    >
                        无动画 (重置)
                    </div>
                    {sequences.map((anim, index) => {
                        const isValid = isValidSequence(anim)
                        const isEditing = editingIndex === index
                        return (
                            <div
                                key={index}
                                onClick={() => handleSequenceSelect(index)}
                                style={{
                                    padding: '8px',
                                    cursor: isValid ? 'pointer' : 'not-allowed',
                                    backgroundColor: currentSequence === index ? '#4a90e2' : 'transparent',
                                    color: isValid
                                        ? (currentSequence === index ? 'white' : '#eee')
                                        : '#ff6b6b',
                                    borderBottom: '1px solid #444',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '2px'
                                }}
                            >
                                {!isValid && (
                                    <Tooltip title="该动画序列缺少时间范围数据，无法播放">
                                        <WarningOutlined style={{ color: '#ff4d4f', fontSize: '14px' }} />
                                    </Tooltip>
                                )}
                                <span style={{ fontSize: '11px', color: currentSequence === index ? '#ddd' : '#888', minWidth: 20, textAlign: 'left' }}>
                                    {index + 1}.
                                </span>
                                {isEditing ? (
                                    <Input
                                        ref={inputRef}
                                        size="small"
                                        value={editingName}
                                        onChange={handleNameChange}
                                        onBlur={handleNameConfirm}
                                        onKeyDown={handleKeyDown}
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                            flex: 1,
                                            backgroundColor: '#222',
                                            border: '1px solid #1890ff',
                                            color: '#fff',
                                            fontSize: '13px'
                                        }}
                                    />
                                ) : (
                                    <span
                                        style={{ opacity: isValid ? 1 : 0.7, cursor: isValid ? 'text' : 'not-allowed' }}
                                        onDoubleClick={(e) => isValid && handleDoubleClick(index, e)}
                                    >
                                        {anim.Name || `动画 ${index}`}
                                    </span>
                                )}
                                {isValid && !isEditing && (
                                    <span style={{ fontSize: '10px', color: currentSequence === index ? '#ddd' : '#888' }}>
                                        ({(anim.Interval[1] - anim.Interval[0]).toFixed(0)}ms)
                                    </span>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default AnimationPanel
