import React, { useCallback, useMemo, useState } from 'react'
import { ColorPicker as AntColorPicker } from 'antd'
import type { ColorPickerProps } from 'antd'
import { AggregationColor } from 'antd/es/color-picker/color'
import ColorHexInput from 'antd/es/color-picker/components/ColorHexInput'
import ColorHsbInput from 'antd/es/color-picker/components/ColorHsbInput'

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

    const mergedPanelRender = useCallback<NonNullable<ColorPickerProps['panelRender']>>((panel, extra) => {
        const enhancedPanel = (
            <div className="war3-enhanced-color-picker-panel">
                {panel}
                <div className="war3-enhanced-color-picker-extra">
                    <div className="war3-enhanced-color-picker-row">
                        <span className="war3-enhanced-color-picker-label">HSB</span>
                        <div className="war3-enhanced-color-picker-field">
                            <ColorHsbInput
                                prefixCls="ant-color-picker"
                                value={aggregationColor}
                                onChange={handleExtendedInputChange}
                            />
                        </div>
                    </div>
                    <div className="war3-enhanced-color-picker-row">
                        <span className="war3-enhanced-color-picker-label">HEX</span>
                        <div className="war3-enhanced-color-picker-field">
                            <ColorHexInput
                                prefixCls="ant-color-picker"
                                value={aggregationColor}
                                onChange={handleExtendedInputChange}
                            />
                        </div>
                    </div>
                </div>
            </div>
        )

        return panelRender ? panelRender(enhancedPanel, extra) : enhancedPanel
    }, [aggregationColor, handleExtendedInputChange, panelRender])

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
