import React, { useCallback, useMemo, useState } from 'react'
import { ColorPicker as AntColorPicker, Input, InputNumber } from 'antd'
import type { ColorPickerProps } from 'antd'
import { AggregationColor } from 'antd/es/color-picker/color'
import { generateColor } from 'antd/es/color-picker/util'

const ensureEnhancedColorPickerStyles = () => {
    if (typeof document === 'undefined') return
    let style = document.getElementById('war3-enhanced-color-picker-styles') as HTMLStyleElement | null
    if (!style) {
        style = document.createElement('style')
        style.id = 'war3-enhanced-color-picker-styles'
        document.head.appendChild(style)
    }
    style.textContent = `
        .war3-enhanced-color-picker-panel {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .war3-enhanced-color-picker-extra {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .war3-enhanced-color-picker-row {
            display: grid;
            grid-template-columns: 40px minmax(0, 1fr);
            align-items: center;
            gap: 8px;
        }

        .war3-enhanced-color-picker-label {
            color: #bfbfbf;
            font-size: 12px;
            line-height: 1;
        }

        .war3-enhanced-color-picker-field {
            min-width: 0;
        }

        .war3-enhanced-color-picker-hsb-grid {
            display: grid;
            grid-template-columns: repeat(3, 108px);
            gap: 8px;
            justify-content: start;
        }

        .war3-enhanced-color-picker-field .ant-input-number,
        .war3-enhanced-color-picker-field .ant-input-affix-wrapper {
            width: 100%;
            background: #262626;
            border-color: #4a4a4a;
            color: #f0f0f0;
        }

        .war3-enhanced-color-picker-field .ant-input-number:hover,
        .war3-enhanced-color-picker-field .ant-input-affix-wrapper:hover,
        .war3-enhanced-color-picker-field .ant-input-number-focused,
        .war3-enhanced-color-picker-field .ant-input-affix-wrapper-focused {
            border-color: #5a9cff;
            box-shadow: none;
        }

        .war3-enhanced-color-picker-field .ant-input-number-input,
        .war3-enhanced-color-picker-field .ant-input,
        .war3-enhanced-color-picker-field .ant-input-prefix {
            color: #f0f0f0;
        }

        .war3-enhanced-color-picker-field .ant-input-number-input::placeholder,
        .war3-enhanced-color-picker-field .ant-input::placeholder {
            color: #7f7f7f;
        }
    `
}

const toAggregationColor = (value: ColorPickerProps['value'] | ColorPickerProps['defaultValue']) => {
    if (value instanceof AggregationColor) return value
    if (value === null || value === undefined) return new AggregationColor('#ffffff')
    return new AggregationColor(value as any)
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
    value,
    defaultValue,
    onChange,
    onChangeComplete,
    panelRender,
    styles,
    format: _format,
    onFormatChange: _onFormatChange,
    ...restProps
}) => {
    ensureEnhancedColorPickerStyles()
    const [innerValue, setInnerValue] = useState<ColorPickerProps['value'] | undefined>(defaultValue)

    const mergedValue = value === undefined ? innerValue : value
    const aggregationColor = useMemo(() => toAggregationColor(mergedValue), [mergedValue])

    const commitColorChange = useCallback((nextColor: AggregationColor, triggerComplete: boolean) => {
        if (value === undefined) {
            setInnerValue(nextColor)
        }
        onChange?.(nextColor, nextColor.toCssString())
        if (triggerComplete) {
            onChangeComplete?.(nextColor)
        }
    }, [value, onChange, onChangeComplete])

    const handlePickerChange = useCallback<NonNullable<ColorPickerProps['onChange']>>((nextColor, css) => {
        if (value === undefined) {
            setInnerValue(nextColor)
        }
        onChange?.(nextColor, css)
    }, [value, onChange])

    const handlePickerChangeComplete = useCallback<NonNullable<ColorPickerProps['onChangeComplete']>>((nextColor) => {
        if (value === undefined) {
            setInnerValue(nextColor)
        }
        onChangeComplete?.(nextColor)
    }, [value, onChangeComplete])

    const handleExtendedInputChange = useCallback((nextColor: AggregationColor) => {
        commitColorChange(nextColor, true)
    }, [commitColorChange])

    const hsbValue = useMemo(() => {
        const hsb = aggregationColor.toHsb()
        return {
            h: Number.isFinite(Number(hsb.h)) ? Math.round(Number(hsb.h)) : 0,
            s: Number.isFinite(Number(hsb.s)) ? Math.round(Number(hsb.s) * 100) : 0,
            b: Number.isFinite(Number(hsb.b)) ? Math.round(Number(hsb.b) * 100) : 0,
            a: Number.isFinite(Number(hsb.a)) ? Number(hsb.a) : 1
        }
    }, [aggregationColor])

    const handleHsbFieldChange = useCallback((field: 'h' | 's' | 'b', rawValue: number | null) => {
        const safeValue = Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0
        const nextHsb = {
            h: hsbValue.h,
            s: hsbValue.s / 100,
            b: hsbValue.b / 100,
            a: hsbValue.a
        }
        if (field === 'h') nextHsb.h = Math.max(0, Math.min(360, Math.round(safeValue)))
        if (field === 's') nextHsb.s = Math.max(0, Math.min(1, safeValue / 100))
        if (field === 'b') nextHsb.b = Math.max(0, Math.min(1, safeValue / 100))
        handleExtendedInputChange(generateColor(nextHsb))
    }, [handleExtendedInputChange, hsbValue])

    const handleHexChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value.trim()
        const normalized = raw.startsWith('#') ? raw : `#${raw}`
        if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized)) return
        handleExtendedInputChange(generateColor(normalized))
    }, [handleExtendedInputChange])

    const mergedPanelRender = useCallback<NonNullable<ColorPickerProps['panelRender']>>((panel, extra) => {
        const enhancedPanel = (
            <div className="war3-enhanced-color-picker-panel">
                {panel}
                <div className="war3-enhanced-color-picker-extra">
                    <div className="war3-enhanced-color-picker-row">
                        <span className="war3-enhanced-color-picker-label">HSB</span>
                        <div className="war3-enhanced-color-picker-field">
                            <div className="war3-enhanced-color-picker-hsb-grid" style={{ gridTemplateColumns: 'repeat(3, 54px)' }}>
                                <InputNumber min={0} max={360} value={hsbValue.h} onChange={(value) => handleHsbFieldChange('h', value)} controls={false} style={{ width: 54 }} />
                                <InputNumber min={0} max={100} value={hsbValue.s} onChange={(value) => handleHsbFieldChange('s', value)} controls={false} formatter={(value) => `${value ?? 0}%`} style={{ width: 54 }} />
                                <InputNumber min={0} max={100} value={hsbValue.b} onChange={(value) => handleHsbFieldChange('b', value)} controls={false} formatter={(value) => `${value ?? 0}%`} style={{ width: 54 }} />
                            </div>
                        </div>
                    </div>
                    <div className="war3-enhanced-color-picker-row">
                        <span className="war3-enhanced-color-picker-label">HEX</span>
                        <div className="war3-enhanced-color-picker-field">
                            <Input
                                size="small"
                                value={aggregationColor.toHexString()}
                                onChange={handleHexChange}
                                style={{ width: 170 }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        )

        return panelRender ? panelRender(enhancedPanel, extra) : enhancedPanel
    }, [aggregationColor, handleExtendedInputChange, handleHexChange, handleHsbFieldChange, hsbValue, panelRender])

    const mergedStyles = useMemo<NonNullable<ColorPickerProps['styles']>>(() => ({
        ...styles,
        popup: {
            ...styles?.popup,
        },
        popupOverlayInner: {
            background: '#1f1f1f',
            border: '1px solid #484848',
            borderRadius: 2,
            boxShadow: '0 10px 24px rgba(0, 0, 0, 0.35)',
            padding: '10px 12px',
            ...styles?.popupOverlayInner,
        },
    }), [styles])

    return (
        <AntColorPicker
            {...restProps}
            value={mergedValue}
            format="rgb"
            styles={mergedStyles}
            onChange={handlePickerChange}
            onChangeComplete={handlePickerChangeComplete}
            panelRender={mergedPanelRender}
        />
    )
}

export default ColorPicker
