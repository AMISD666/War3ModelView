import { shortcutActions, shortcutActionMap, ShortcutAction, ShortcutContext } from './actions'
import { getDefaultBindings, useShortcutStore } from '../store/shortcutStore'
import { isTextInputActive, normalizeKeyComboFromEvent, normalizeKeyCombo } from './utils'
import { tryConsumeNodeManagerDeleteKey } from '../utils/nodeManagerShortcutBridge'
import { useSelectionStore } from '../store/selectionStore'

type ShortcutHandler = (payload: { event: KeyboardEvent; action: ShortcutAction; combo: string }) => boolean | void

type ShortcutHandlerEntry = {
    handler: ShortcutHandler
    isActive?: () => boolean
    priority?: number
}

const handlers = new Map<string, ShortcutHandlerEntry[]>()

const contextPriority: ShortcutContext[] = [
    'animation',
    'geometry',
    'uv',
    'view',
    'batch',
    'viewer',
    'global'
]

const getActiveContexts = (): Set<ShortcutContext> => {
    const contexts = new Set<ShortcutContext>()
    contexts.add('global')

    const { mainMode } = useSelectionStore.getState()
    contexts.add(mainMode)

    if (mainMode !== 'batch') {
        contexts.add('viewer')
    }

    return contexts
}

const getContextPriority = (action: ShortcutAction): number => {
    let best = contextPriority.length + 1
    for (const ctx of action.contexts) {
        const idx = contextPriority.indexOf(ctx)
        if (idx !== -1 && idx < best) {
            best = idx
        }
    }
    return best
}

export const getEffectiveBindings = (actionId: string): string[] => {
    const { bindings } = useShortcutStore.getState()
    const override = bindings[actionId]
    if (override) return override
    return getDefaultBindings(actionId)
}

export const getAllEffectiveBindings = (): Record<string, string[]> => {
    const result: Record<string, string[]> = {}
    for (const action of shortcutActions) {
        result[action.id] = getEffectiveBindings(action.id)
    }
    return result
}

export const registerShortcutHandler = (
    actionId: string,
    handler: ShortcutHandler,
    options: { isActive?: () => boolean; priority?: number } = {}
): (() => void) => {
    const entry: ShortcutHandlerEntry = { handler, ...options }
    const list = handlers.get(actionId) ?? []
    list.push(entry)
    handlers.set(actionId, list)
    return () => {
        const current = handlers.get(actionId)
        if (!current) return
        const next = current.filter((item) => item !== entry)
        if (next.length === 0) {
            handlers.delete(actionId)
        } else {
            handlers.set(actionId, next)
        }
    }
}

export const dispatchShortcutEvent = (event: KeyboardEvent): boolean => {
    const combo = normalizeKeyComboFromEvent(event)
    if (!combo) return false

    const normalizedCombo = normalizeKeyCombo(combo)
    const activeContexts = getActiveContexts()
    const matchedActions: ShortcutAction[] = []

    for (const action of shortcutActions) {
        const bindings = getEffectiveBindings(action.id).map(normalizeKeyCombo)
        if (!bindings.includes(normalizedCombo)) continue
        if (!action.contexts.some((ctx) => activeContexts.has(ctx))) continue
        matchedActions.push(action)
    }

    if (matchedActions.length === 0) return false

    matchedActions.sort((a, b) => getContextPriority(a) - getContextPriority(b))

    for (const action of matchedActions) {
        if (isTextInputActive() && !action.allowInInputs) {
            continue
        }

        const entries = handlers.get(action.id)
        if (!entries || entries.length === 0) continue

        const ordered = [...entries].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        for (const entry of ordered) {
            if (entry.isActive && !entry.isActive()) continue
            const handled = entry.handler({ event, action, combo: normalizedCombo })
            if (handled !== false) {
                if (action.preventDefault) event.preventDefault()
                if (action.stopPropagation) event.stopPropagation()
                return true
            }
        }
    }

    return false
}

const blurActiveElementIfSafe = (event: KeyboardEvent): void => {
    // Blur the focused element BEFORE dispatching shortcuts so that buttons/sliders
    // don't fire a native click (or Space activation) after our shortcut handler runs.
    // e.g. Space on a focused <button> would: (1) trigger our playPause handler,
    // then (2) trigger the button's native click → double-toggle, net no change.
    // Blurring first prevents the native click entirely.
    const el = document.activeElement
    if (!el || el === document.body) return

    // Never steal focus from text inputs / editable areas.
    if (isTextInputActive()) return
    if (el instanceof HTMLSelectElement) return

    // Only blur focusable HTMLElements (buttons, sliders, custom focusable divs, etc.).
    if (el instanceof HTMLElement) {
        el.blur()
    }
}

const hasMatchingShortcut = (event: KeyboardEvent): boolean => {
    const combo = normalizeKeyComboFromEvent(event)
    if (!combo) return false
    const normalizedCombo = normalizeKeyCombo(combo)
    const activeContexts = getActiveContexts()
    for (const action of shortcutActions) {
        const bindings = getEffectiveBindings(action.id).map(normalizeKeyCombo)
        if (!bindings.includes(normalizedCombo)) continue
        if (!action.contexts.some((ctx) => activeContexts.has(ctx))) continue
        return true
    }
    return false
}

export const handleGlobalShortcutKeyDown = (event: KeyboardEvent): void => {
    // 节点管理器内 Delete 必须早于 blur / 时间轴 Delete，否则会失焦或误删关键帧
    if (tryConsumeNodeManagerDeleteKey(event)) {
        event.preventDefault()
        return
    }
    // CRITICAL: blur the focused element BEFORE dispatching the shortcut.
    // If a button/focusable element is focused, pressing Space would:
    //   1. trigger our shortcut handler (e.g. toggling play), AND
    //   2. trigger the browser's native Space→click on the element (toggling again)
    // Net effect: double-toggle = no visible change.  Blurring first prevents step 2.
    // We only do this when a shortcut actually matches (to avoid disrupting
    // intentional use of Sliders, custom controls, etc. for non-shortcut keys).
    if (hasMatchingShortcut(event)) {
        blurActiveElementIfSafe(event)
    }
    dispatchShortcutEvent(event)
}

export const getShortcutAction = (actionId: string): ShortcutAction | undefined => {
    return shortcutActionMap.get(actionId)
}
