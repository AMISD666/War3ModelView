import React from 'react'
import { useModelStore } from '../store/modelStore'
import { useSelectionStore } from '../store/selectionStore'

interface AnimationPanelProps {
    onImport: () => void
}

const AnimationPanel: React.FC<AnimationPanelProps> = ({
    onImport
}) => {
    const {
        modelPath,
        sequences,
        currentSequence,
        setSequence,
        setPlaying
    } = useModelStore()

    const handleSequenceSelect = (index: number) => {
        setSequence(index)
        // Auto-play if in View Mode
        if (index !== -1 && useSelectionStore.getState().mainMode === 'view') {
            setPlaying(true)
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
                <h3 style={{ margin: 0 }}>动画控制</h3>
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
                <div style={{ fontSize: '12px', wordBreak: 'break-all', color: '#aaa', marginBottom: '10px' }}>
                    当前模型: {modelPath.split(/[\\/]/).pop()}
                </div>
            )}

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ marginBottom: '10px', borderBottom: '1px solid #444', paddingBottom: '5px' }}>
                    <h4 style={{ margin: 0 }}>动画序列</h4>
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
                    {sequences.map((anim, index) => (
                        <div
                            key={index}
                            onClick={() => handleSequenceSelect(index)}
                            style={{
                                padding: '8px',
                                cursor: 'pointer',
                                backgroundColor: currentSequence === index ? '#4a90e2' : 'transparent',
                                color: currentSequence === index ? 'white' : '#eee',
                                borderBottom: '1px solid #444'
                            }}
                        >
                            {anim.Name || `动画 ${index}`} <span style={{ fontSize: '10px', color: '#ccc' }}>({(anim.Interval[1] - anim.Interval[0]).toFixed(0)}ms)</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default AnimationPanel
