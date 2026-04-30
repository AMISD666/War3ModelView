import { appMessage } from '../store/messageStore'
import { getDefaultBindings, useShortcutStore } from '../store/shortcutStore'
import { shortcutActions, shortcutActionMap, type ShortcutAction } from './actions'
import { formatKeyCombo, normalizeKeyCombo, normalizeKeyComboFromEvent } from './utils'

type ShortcutBindingResult =
    | { ok: true; combo: string; action: ShortcutAction }
    | { ok: false; reason: 'missing-action' | 'same-binding' | 'conflict' | 'invalid'; combo?: string; action?: ShortcutAction; conflict?: ShortcutAction }

const getEffectiveBindings = (bindings: Record<string, string[]>, actionId: string): string[] => {
    const override = bindings[actionId]
    if (override) return override
    return getDefaultBindings(actionId)
}

const hasContextOverlap = (a: ShortcutAction, b: ShortcutAction): boolean => {
    return a.contexts.some((ctx) => b.contexts.includes(ctx))
}

export const findShortcutConflict = (
    actionId: string,
    combo: string,
    bindings = useShortcutStore.getState().bindings
): ShortcutAction | undefined => {
    const currentAction = shortcutActionMap.get(actionId)
    if (!currentAction) return undefined

    const normalizedCombo = normalizeKeyCombo(combo)
    return shortcutActions.find((action) => {
        if (action.id === actionId) return false
        if (!hasContextOverlap(action, currentAction)) return false
        return getEffectiveBindings(bindings, action.id)
            .map(normalizeKeyCombo)
            .includes(normalizedCombo)
    })
}

export const assignShortcutBinding = (actionId: string, combo: string): ShortcutBindingResult => {
    const action = shortcutActionMap.get(actionId)
    if (!action) return { ok: false, reason: 'missing-action' }

    const normalizedCombo = normalizeKeyCombo(combo)
    if (!normalizedCombo) return { ok: false, reason: 'invalid', action }

    const { bindings, setBindings } = useShortcutStore.getState()
    const currentBindings = getEffectiveBindings(bindings, actionId).map(normalizeKeyCombo)
    if (currentBindings.includes(normalizedCombo)) {
        return { ok: false, reason: 'same-binding', combo: normalizedCombo, action }
    }

    const conflict = findShortcutConflict(actionId, normalizedCombo, bindings)
    if (conflict) {
        return { ok: false, reason: 'conflict', combo: normalizedCombo, action, conflict }
    }

    setBindings(actionId, [normalizedCombo])
    return { ok: true, combo: normalizedCombo, action }
}

let pendingActionId: string | null = null

const finishCapture = () => {
    pendingActionId = null
}

const handleCaptureKeyDown = (event: KeyboardEvent) => {
    if (!pendingActionId) return

    event.preventDefault()
    event.stopPropagation()
    if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation()
    }

    if (event.key === 'Escape') {
        finishCapture()
        appMessage.info('已取消快捷键设置')
        return
    }

    const combo = normalizeKeyComboFromEvent(event)
    if (!combo) return

    const result = assignShortcutBinding(pendingActionId, combo)
    if (result.ok) {
        finishCapture()
        appMessage.success(`已为「${result.action.label}」设置快捷键 ${formatKeyCombo(result.combo)}`)
        return
    }

    if (result.reason === 'same-binding' && result.action && result.combo) {
        finishCapture()
        appMessage.info(`「${result.action.label}」已经使用 ${formatKeyCombo(result.combo)}`)
        return
    }

    if (result.reason === 'conflict' && result.conflict && result.combo) {
        appMessage.warning(`快捷键 ${formatKeyCombo(result.combo)} 已被「${result.conflict.label}」使用，不能重复设置`)
        return
    }

    finishCapture()
    appMessage.warning('无法设置该快捷键')
}

let captureListenerInstalled = false

const ensureCaptureListener = () => {
    if (captureListenerInstalled) return
    window.addEventListener('keydown', handleCaptureKeyDown, true)
    captureListenerInstalled = true
}

export const beginShortcutBindingCapture = (actionId: string): void => {
    const action = shortcutActionMap.get(actionId)
    if (!action) {
        appMessage.warning('未找到可绑定的快捷键功能')
        return
    }

    ensureCaptureListener()
    pendingActionId = actionId
    appMessage.info(`请按下要设置给「${action.label}」的快捷键，按 Esc 取消`, 5000)
}

export const isShortcutBindingCaptureActive = (): boolean => pendingActionId !== null
