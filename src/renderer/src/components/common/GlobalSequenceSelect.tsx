import React, { useState } from 'react';
import { Select, Button, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { SmartInputNumber as InputNumber } from './SmartInputNumber';
import { useModelStore } from '../../store/modelStore';
import { useRpcClient } from '../../hooks/useRpc';

interface GlobalSequenceSelectProps {
    value: number | null;
    onChange: (val: number | null) => void;
    isStandalone?: boolean;
    style?: React.CSSProperties;
    size?: 'small' | 'middle' | 'large';
    placeholder?: string;
}

export const GlobalSequenceSelect: React.FC<GlobalSequenceSelectProps> = ({
    value,
    onChange,
    isStandalone,
    style,
    size = 'small',
    placeholder = '选择全局序列'
}) => {
    const [isEditing, setIsEditing] = useState(false);

    // Fine-grained updater — does NOT trigger full model reload
    const updateGlobalSequences = useModelStore(state => state.updateGlobalSequences);
    const modelData = useModelStore(state => state.modelData);

    // Access RPC for standalone windows
    const { state: rpcState, emitCommand } = useRpcClient<{ globalSequences: number[] }>(
        'globalSequenceManager',
        { globalSequences: [] }
    );

    // Resolve sequences based on current environment
    const rawSeqs = isStandalone ? (rpcState.globalSequences || []) : ((modelData as any)?.GlobalSequences || []);
    // Support both simple number arrays and potential future object-based sequences
    const sequences: number[] = Array.isArray(rawSeqs)
        ? rawSeqs.map((s: any) => typeof s === 'number' ? s : (s.Duration || 1000))
        : [];

    const options = [
        { label: '(空)', value: -1 },
        ...sequences.map((dur, idx) => ({
            label: `全局序列 ${idx} (${dur}ms)`,
            value: idx
        }))
    ];

    const saveSequences = (newSeqs: number[]) => {
        if (isStandalone) {
            emitCommand('EXECUTE_GLOBAL_SEQ_ACTION', { action: 'SAVE', globalSequences: newSeqs });
        } else {
            // Use targeted update — no full model reload, no side-effects
            updateGlobalSequences(newSeqs);
        }
    };

    const handleAdd = () => {
        const newSeqs = [...sequences, 1000];
        saveSequences(newSeqs);
        // Automatically select the new sequence
        onChange(newSeqs.length - 1);
    };

    const handleUpdateDuration = (newDur: number | null) => {
        if (newDur === null || value === null || value < 0) {
            setIsEditing(false);
            return;
        }
        const newSeqs = [...sequences];
        newSeqs[value] = Math.max(0, Math.floor(newDur));
        saveSequences(newSeqs);
        setIsEditing(false);
    };

    if (isEditing && value !== null && value >= 0) {
        return (
            <InputNumber
                value={sequences[value]}
                size={size}
                autoFocus
                onPressEnter={(e: any) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) handleUpdateDuration(val);
                }}
                onBlur={(e: any) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) handleUpdateDuration(val);
                    else setIsEditing(false);
                }}
                style={{ ...style, width: '100%' }}
                min={0}
                step={100}
            />
        );
    }

    return (
        <div
            style={{ width: '100%', ...style }}
            onDoubleClick={(e) => {
                if (value !== null && value >= 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsEditing(true);
                }
            }}
        >
            <Select
                value={value === null || value === -1 ? -1 : value}
                onChange={(v) => onChange(v === -1 ? null : v)}
                options={options}
                size={size}
                placeholder={placeholder}
                style={{ width: '100%', pointerEvents: isEditing ? 'none' : 'auto' }}
                dropdownRender={(menu) => (
                    <div onMouseDown={e => e.stopPropagation()}>
                        <Button
                            type="text"
                            size="small"
                            icon={<PlusOutlined />}
                            onClick={handleAdd}
                            style={{
                                width: '100%',
                                textAlign: 'left',
                                padding: '4px 12px',
                                height: '32px',
                                color: '#5a9cff'
                            }}
                        >
                            新建全局序列
                        </Button>
                        <Divider style={{ margin: '4px 0', borderColor: '#484848' }} />
                        {menu}
                    </div>
                )}
            />
        </div>
    );
};
