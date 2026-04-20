import React, { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Input } from 'antd'

interface PositiveStepInputProps {
    value: number
    min: number
    step: number
    onCommit: (value: number) => void
    autoFocus?: boolean
    size?: 'small' | 'middle' | 'large'
    precision?: number
    style?: CSSProperties
}

const inferPrecisionFromStep = (step: number): number => {
    const normalized = String(step)
    const dotIndex = normalized.indexOf('.')
    return dotIndex >= 0 ? normalized.length - dotIndex - 1 : 0
}

const normalizeDraft = (
    value: string | number | null | undefined,
    precision: number
): string => {
    if (value === null || value === undefined) return ''

    const raw = String(value).replace(/[^\d.]/g, '')
    if (!raw) return ''

    const parts = raw.split('.')
    const integerPart = parts[0] ?? ''
    if (precision <= 0) {
        return integerPart
    }

    const fractionPart = parts.slice(1).join('').slice(0, precision)
    return parts.length > 1 ? `${integerPart}.${fractionPart}` : integerPart
}

const parsePositiveNumber = (value: string | number | null | undefined): number | null => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value !== 'string') return null

    const trimmed = value.trim()
    if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
        return null
    }

    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
}

export const PositiveStepInput: React.FC<PositiveStepInputProps> = ({
    value,
    min,
    step,
    onCommit,
    autoFocus,
    size = 'small',
    precision,
    style
}) => {
    const resolvedPrecision = typeof precision === 'number' ? precision : inferPrecisionFromStep(step)
    const [draftValue, setDraftValue] = useState(() => String(value))
    const [isEditing, setIsEditing] = useState(false)

    useEffect(() => {
        if (!isEditing) {
            setDraftValue(String(value))
        }
    }, [isEditing, value])

    const commitValue = useCallback((rawValue: string | number | null | undefined) => {
        const parsed = parsePositiveNumber(rawValue)
        const nextValue = parsed !== null && parsed >= min ? parsed : min
        setDraftValue(String(nextValue))
        onCommit(nextValue)
    }, [min, onCommit])

    return (
        <Input
            size={size}
            value={draftValue}
            autoFocus={autoFocus}
            inputMode={resolvedPrecision === 0 ? 'numeric' : 'decimal'}
            onFocus={() => setIsEditing(true)}
            onChange={(event) => {
                setDraftValue(normalizeDraft(event.target.value, resolvedPrecision))
            }}
            onBlur={(event) => {
                setIsEditing(false)
                commitValue(event.target.value)
            }}
            onPressEnter={(event) => {
                commitValue(event.currentTarget.value)
                event.currentTarget.blur()
            }}
            style={style}
        />
    )
}
