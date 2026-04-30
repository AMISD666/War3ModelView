import React from 'react'
import { Select, Slider } from 'antd'
import { PauseOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { ShortcutBindableButton } from '../common/ShortcutBindableButton'
import type { RetargetPlaybackState, RetargetSequenceOption } from './retargetPlayback'

interface RetargetPlaybackBarProps {
    actionId: string
    state: RetargetPlaybackState
    sequenceOptions: RetargetSequenceOption[]
    interval: [number, number]
    disabled: boolean
    onSequenceChange: (sequenceIndex: number) => void
    onFrameChange: (frame: number) => void
    onTogglePlay: () => void
}

export const RetargetPlaybackBar: React.FC<RetargetPlaybackBarProps> = ({
    actionId,
    state,
    sequenceOptions,
    interval,
    disabled,
    onSequenceChange,
    onFrameChange,
    onTogglePlay,
}) => {
    const [start, end] = interval
    const canPlay = !disabled && end > start
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <Select
                size="small"
                value={state.sequenceIndex}
                options={sequenceOptions.map((option) => ({ value: option.value, label: option.label }))}
                onChange={onSequenceChange}
                disabled={disabled}
                style={{ width: 180, flex: '0 0 180px' }}
                popupClassName="dark-theme-select-dropdown"
            />
            <ShortcutBindableButton
                shortcutActionId={actionId}
                size="small"
                type="text"
                icon={state.isPlaying ? <PauseOutlined /> : <PlayCircleOutlined />}
                onClick={onTogglePlay}
                disabled={!canPlay}
                title={state.isPlaying ? '暂停' : '播放'}
                style={{ color: canPlay ? '#eee' : '#777', width: 28 }}
            />
            <Slider
                min={start}
                max={Math.max(start, end)}
                step={1}
                value={Math.round(state.frame)}
                onChange={(value) => onFrameChange(Number(value))}
                disabled={disabled || end <= start}
                tooltip={{ formatter: (value) => `${value ?? start}` }}
                style={{ flex: 1, minWidth: 80, margin: '0 4px' }}
            />
            <span style={{ width: 86, color: '#aaa', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(state.frame)} / {Math.round(end)}
            </span>
        </div>
    )
}

export default RetargetPlaybackBar
