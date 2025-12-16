import React, { useCallback, useEffect, useState } from 'react';
import { useModelStore } from '../../store/modelStore';
import { Button, Slider, Select, Space, Tooltip, Typography } from 'antd';
import {
    PlayCircleOutlined,
    PauseCircleOutlined,
    StepBackwardOutlined,
    RetweetOutlined
} from '@ant-design/icons';

const { Text } = Typography;
const { Option } = Select;

const TimelinePanel: React.FC = () => {
    // PERFORMANCE: Don't subscribe to currentFrame directly - use polling instead
    const {
        sequences,
        currentSequence,
        isPlaying,
        playbackSpeed,
        isLooping,
        setPlaying,
        setFrame,
        setPlaybackSpeed,
        setLooping
    } = useModelStore();

    // Poll currentFrame every 250ms to avoid per-frame re-renders
    const [displayFrame, setDisplayFrame] = useState(0);
    useEffect(() => {
        setDisplayFrame(Math.round(useModelStore.getState().currentFrame));
        const interval = setInterval(() => {
            setDisplayFrame(Math.round(useModelStore.getState().currentFrame));
        }, 250);
        return () => clearInterval(interval);
    }, []);

    const activeSequence = currentSequence !== -1 ? sequences[currentSequence] : null;
    const minFrame = activeSequence ? activeSequence.Interval[0] : 0;
    const maxFrame = activeSequence ? activeSequence.Interval[1] : 100;
    // const duration = maxFrame - minFrame;

    const handlePlayPause = useCallback(() => {
        setPlaying(!isPlaying);
    }, [isPlaying, setPlaying]);

    const handleStop = useCallback(() => {
        setPlaying(false);
        setFrame(minFrame);
    }, [setPlaying, setFrame, minFrame]);

    const handleSliderChange = useCallback((value: number) => {
        setFrame(value);
        setDisplayFrame(value); // Immediate feedback
        // Optionally pause when scrubbing
        // setPlaying(false); 
    }, [setFrame]);

    const formatTime = (frame: number) => {
        return `${frame.toFixed(0)}`;
    };

    if (!activeSequence) {
        return (
            <div style={{
                height: '60px',
                backgroundColor: '#2b2b2b',
                borderTop: '1px solid #444',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#666'
            }}>
                No Animation Selected
            </div>
        );
    }

    return (
        <div style={{
            height: '80px',
            backgroundColor: '#2b2b2b',
            borderTop: '1px solid #444',
            display: 'flex',
            flexDirection: 'column',
            padding: '5px 15px'
        }}>
            {/* Top Row: Slider and Time */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                <Text style={{ color: '#aaa', minWidth: '40px', textAlign: 'right' }}>
                    {formatTime(displayFrame)}
                </Text>
                <div style={{ flex: 1 }}>
                    <Slider
                        min={minFrame}
                        max={maxFrame}
                        value={displayFrame}
                        onChange={handleSliderChange}
                        tooltip={{ formatter: (val) => val?.toFixed(0) }}
                        styles={{
                            track: { background: '#4a90e2' },
                            rail: { background: '#444' },
                            handle: { borderColor: '#4a90e2' }
                        }}
                    />
                </div>
                <Text style={{ color: '#aaa', minWidth: '40px' }}>
                    {formatTime(maxFrame)}
                </Text>
            </div>

            {/* Bottom Row: Controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Space>
                    <Tooltip title="Stop">
                        <Button
                            type="text"
                            icon={<StepBackwardOutlined />}
                            onClick={handleStop}
                            style={{ color: '#eee' }}
                        />
                    </Tooltip>

                    <Tooltip title={isPlaying ? "Pause" : "Play"}>
                        <Button
                            type="text"
                            icon={isPlaying ? <PauseCircleOutlined style={{ fontSize: '20px' }} /> : <PlayCircleOutlined style={{ fontSize: '20px' }} />}
                            onClick={handlePlayPause}
                            style={{ color: '#4a90e2' }}
                        />
                    </Tooltip>

                    <Tooltip title="Loop">
                        <Button
                            type="text"
                            icon={<RetweetOutlined />}
                            onClick={() => setLooping(!isLooping)}
                            style={{ color: isLooping ? '#4a90e2' : '#666' }}
                        />
                    </Tooltip>
                </Space>

                <Space>
                    <Text style={{ color: '#aaa', fontSize: '12px' }}>Speed:</Text>
                    <Select
                        value={playbackSpeed}
                        onChange={setPlaybackSpeed}
                        size="small"
                        style={{ width: 70 }}
                        dropdownStyle={{ backgroundColor: '#333' }}
                    >
                        <Option value={0.25}>0.25x</Option>
                        <Option value={0.5}>0.5x</Option>
                        <Option value={1.0}>1.0x</Option>
                        <Option value={1.5}>1.5x</Option>
                        <Option value={2.0}>2.0x</Option>
                    </Select>
                </Space>
            </div>
        </div>
    );
};

export default TimelinePanel;
