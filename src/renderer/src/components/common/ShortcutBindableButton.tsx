import React, { useMemo } from 'react'
import { Button, type ButtonProps } from 'antd'
import { beginShortcutBindingCapture } from '../../shortcuts/binding'
import { useShortcutStore } from '../../store/shortcutStore'
import { formatShortcutTooltipTitle } from './ShortcutTooltip'

interface ShortcutBindableButtonProps extends ButtonProps {
    shortcutActionId: string
}

export const ShortcutBindableButton: React.FC<ShortcutBindableButtonProps> = ({
    shortcutActionId,
    ...buttonProps
}) => {
    const bindings = useShortcutStore((state) => state.bindings)
    const title = useMemo(
        () => formatShortcutTooltipTitle(buttonProps.title, shortcutActionId, bindings),
        [buttonProps.title, shortcutActionId, bindings]
    )

    const handleMouseDown = (event: React.MouseEvent<HTMLSpanElement>) => {
        if (event.button !== 1) return
        event.preventDefault()
        event.stopPropagation()
        beginShortcutBindingCapture(shortcutActionId)
    }

    return (
        <span onMouseDown={handleMouseDown} style={{ display: 'inline-flex' }}>
            <Button {...buttonProps} title={typeof title === 'string' ? title : buttonProps.title} />
        </span>
    )
}
