import React, { useMemo } from 'react'
import { Tooltip, type TooltipProps } from 'antd'
import { getDefaultBindings, useShortcutStore } from '../../store/shortcutStore'
import { formatKeyCombo } from '../../shortcuts/utils'

const parenthesizedSuffixPattern = /^(.*?)(?:\s*)[（(]([^（）()]*)[）)]$/

const normalizeDisplayBinding = (value: string): string => value.replace(/\s+/g, '').toUpperCase()

const getBindingLabels = (actionId: string, bindings: Record<string, string[]>): string[] => {
    const effectiveBindings = bindings[actionId] ?? getDefaultBindings(actionId)
    return effectiveBindings.filter(Boolean).map(formatKeyCombo)
}

const getKnownBindingLabels = (actionId: string, bindings: Record<string, string[]>): string[] => {
    return [...getDefaultBindings(actionId), ...(bindings[actionId] ?? [])]
        .filter(Boolean)
        .map(formatKeyCombo)
}

const stripExistingShortcutSuffix = (
    title: string,
    actionId: string,
    bindings: Record<string, string[]>
): string => {
    const match = title.match(parenthesizedSuffixPattern)
    if (!match) return title

    const suffix = match[2]
    const suffixParts = suffix
        .split(/[\/、,，]/)
        .map((part) => normalizeDisplayBinding(part))
        .filter(Boolean)
    if (suffixParts.length === 0) return title

    const knownBindings = new Set(getKnownBindingLabels(actionId, bindings).map(normalizeDisplayBinding))
    const suffixIsShortcut = suffixParts.every((part) => knownBindings.has(part))
    return suffixIsShortcut ? match[1].trimEnd() : title
}

export const formatShortcutTooltipTitle = (
    title: React.ReactNode,
    actionId: string,
    bindings: Record<string, string[]>
): React.ReactNode => {
    if (typeof title !== 'string') return title

    const bindingLabels = getBindingLabels(actionId, bindings)
    if (bindingLabels.length === 0) return stripExistingShortcutSuffix(title, actionId, bindings)

    const baseTitle = stripExistingShortcutSuffix(title, actionId, bindings)
    return `${baseTitle}（${bindingLabels.join(' / ')}）`
}

export const ShortcutHint: React.FC<{
    actionId: string
    style?: React.CSSProperties
}> = ({ actionId, style }) => {
    const bindings = useShortcutStore((state) => state.bindings)
    const text = useMemo(() => getBindingLabels(actionId, bindings).join(' / '), [actionId, bindings])
    if (!text) return null
    return <span style={style}>{text}</span>
}

interface ShortcutTooltipProps extends Omit<TooltipProps, 'title'> {
    shortcutActionId?: string
    title: React.ReactNode
}

const getChildShortcutActionId = (children: React.ReactNode): string | undefined => {
    if (!React.isValidElement(children)) return undefined
    const props = children.props as { shortcutActionId?: unknown }
    return typeof props.shortcutActionId === 'string' ? props.shortcutActionId : undefined
}

export const ShortcutTooltip: React.FC<ShortcutTooltipProps> = ({
    shortcutActionId,
    title,
    children,
    ...tooltipProps
}) => {
    const bindings = useShortcutStore((state) => state.bindings)
    const actionId = shortcutActionId ?? getChildShortcutActionId(children)
    const tooltipTitle = useMemo(
        () => actionId ? formatShortcutTooltipTitle(title, actionId, bindings) : title,
        [title, actionId, bindings]
    )

    return (
        <Tooltip {...tooltipProps} title={tooltipTitle}>
            {children}
        </Tooltip>
    )
}
