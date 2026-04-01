import React from 'react'
import { InputNumber } from 'antd'
import type { InputNumberProps } from 'antd'

const DEFAULT_MAX_DECIMALS = 4

const roundToDecimals = (value: number, decimals: number): number => {
    if (!Number.isFinite(value)) return 0
    const factor = 10 ** decimals
    const rounded = Math.round((value + Number.EPSILON) * factor) / factor
    return Object.is(rounded, -0) ? 0 : rounded
}

const formatDisplayNumber = (value: string | number | null | undefined, maxDecimals: number): string => {
    if (value === null || value === undefined || value === '') return ''
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) return ''
    const rounded = roundToDecimals(numeric, maxDecimals)
    if (Number.isInteger(rounded)) return String(rounded)
    return rounded.toFixed(maxDecimals).replace(/\.?0+$/, '')
}

const normalizeNumericInput = (raw: string | undefined, maxDecimals: number): string => {
    if (!raw) return ''

    let text = raw.replace(/[^\d.\-]/g, '')
    const negative = text.startsWith('-')
    text = text.replace(/-/g, '')
    if (negative) text = `-${text}`

    const dotIndex = text.indexOf('.')
    if (dotIndex >= 0) {
        const intPart = text.slice(0, dotIndex + 1)
        const fracPart = text
            .slice(dotIndex + 1)
            .replace(/\./g, '')
            .slice(0, Math.max(0, maxDecimals))
        text = intPart + fracPart
    }

    return text
}

type SmartInputNumberProps<T extends number | string = number> = InputNumberProps<T>

export const SmartInputNumber = React.forwardRef<any, SmartInputNumberProps>((props, ref) => {
    const {
        precision,
        formatter,
        parser,
        controls,
        ...rest
    } = props

    const maxDecimals = Math.max(0, Math.min(typeof precision === 'number' ? precision : DEFAULT_MAX_DECIMALS, DEFAULT_MAX_DECIMALS))

    return (
        <InputNumber
            ref={ref}
            controls={false}
            stringMode
            precision={maxDecimals}
            formatter={(value, info) => {
                if (typeof formatter === 'function') {
                    return formatter(value, info)
                }
                if (info?.userTyping) {
                    return normalizeNumericInput(info.input, maxDecimals)
                }
                return formatDisplayNumber(value, maxDecimals)
            }}
            // 不传默认 parser 时走 rc-input-number 内置解析，避免手写 parser 把中间态解析成 NaN/0（节点参数等 Form 输入一敲就变 0）
            parser={
                typeof parser === 'function'
                    ? parser
                    : undefined
            }
            {...rest}
        />
    )
})

SmartInputNumber.displayName = 'SmartInputNumber'
