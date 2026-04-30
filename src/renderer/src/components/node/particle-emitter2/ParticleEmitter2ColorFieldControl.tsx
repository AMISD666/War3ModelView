import React, { useCallback, useEffect, useState } from 'react';
import { Input } from 'antd';
import { ColorPicker } from '@renderer/components/common/EnhancedColorPicker';
import type { Color } from 'antd/es/color-picker';
import type { ParticleEmitter2Node } from '../../../types/node';
import type { SegmentColorTuple } from './types';

interface ParticleEmitter2ColorFieldControlProps {
    name: string;
    committedValue: string;
    form: any;
    getCurrentSegmentColors: () => SegmentColorTuple;
    flushPreviewNowWithOverrides: (overrides?: Partial<ParticleEmitter2Node>) => void;
    resetOverallHueState: () => void;
    fromAntdColor: (color: Color | string) => [number, number, number];
}

export const ParticleEmitter2ColorFieldControl: React.FC<ParticleEmitter2ColorFieldControlProps> = ({
    name,
    committedValue,
    form,
    getCurrentSegmentColors,
    flushPreviewNowWithOverrides,
    resetOverallHueState,
    fromAntdColor,
}) => {
    const [draftValue, setDraftValue] = useState(committedValue);
    const [pickerOpen, setPickerOpen] = useState(false);

    useEffect(() => {
        if (!pickerOpen) {
            setDraftValue(committedValue);
        }
    }, [committedValue, pickerOpen]);

    const commitColorValue = useCallback((rawValue: string) => {
        const nextValue = rawValue.trim() || 'rgb(255, 255, 255)';
        resetOverallHueState();
        if (nextValue !== committedValue) {
            const nextSegmentColors = getCurrentSegmentColors();
            const nextRgb = fromAntdColor(nextValue);
            if (name === 'Seg1Color') nextSegmentColors[0] = nextRgb;
            if (name === 'Seg2Color') nextSegmentColors[1] = nextRgb;
            if (name === 'Seg3Color') nextSegmentColors[2] = nextRgb;
            form.setFieldsValue({ [name]: nextValue });
            flushPreviewNowWithOverrides({ SegmentColor: nextSegmentColors });
        }
        setDraftValue(nextValue);
    }, [committedValue, flushPreviewNowWithOverrides, form, fromAntdColor, getCurrentSegmentColors, name, resetOverallHueState]);

    const commitDraftValue = useCallback(() => {
        commitColorValue(draftValue);
    }, [commitColorValue, draftValue]);

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <ColorPicker
                size="small"
                showText={false}
                format="rgb"
                value={draftValue}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onChange={(color: Color) => {
                    setDraftValue(
                        color && typeof color.toRgbString === 'function'
                            ? color.toRgbString()
                            : committedValue
                    );
                }}
                onChangeComplete={(color: Color) => {
                    const nextValue =
                        color && typeof color.toRgbString === 'function'
                            ? color.toRgbString()
                            : committedValue;
                    commitColorValue(nextValue);
                }}
            />
            <Input
                size="small"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                onBlur={commitDraftValue}
                onPressEnter={commitDraftValue}
                placeholder="rgb(255, 255, 255)"
                style={{ flex: 1, minWidth: 0 }}
            />
        </div>
    );
};
