const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

const CODE_KEY_MAP: Record<string, string> = {
    Escape: 'Escape',
    Tab: 'Tab',
    Enter: 'Enter',
    Space: 'Space',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Backquote: 'Backquote',
    Oem3: 'Backquote',
    Minus: '-',
    OemMinus: '-',
    Equal: '=',
    OemPlus: '=',
    BracketLeft: '[',
    Oem4: '[',
    BracketRight: ']',
    Oem6: ']',
    Backslash: '\\',
    Oem5: '\\',
    Semicolon: ';',
    Oem1: ';',
    Quote: '\'',
    Oem7: '\'',
    Comma: ',',
    OemComma: ',',
    Period: '.',
    OemPeriod: '.',
    Oem2: '/',
    Slash: '/'
}

const DISPLAY_KEY_MAP: Record<string, string> = {
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Backquote: '~',
    Space: 'Space',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Del',
    Backspace: 'Backspace'
}

export const normalizeKeyComboFromEvent = (e: KeyboardEvent): string | null => {
    const key = normalizeKey(e)
    if (!key) return null

    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.shiftKey) parts.push('Shift')
    if (e.altKey) parts.push('Alt')
    if (e.metaKey) parts.push('Meta')
    parts.push(key)
    return parts.join('+')
}

export const normalizeKeyCombo = (combo: string): string => {
    return normalizeComboTokens(combo.replace(/\s+/g, ''))
}

export const formatKeyCombo = (combo: string): string => {
    const normalized = normalizeKeyCombo(combo)
    const parts = normalized.split('+')
    const formatted = parts.map((part) => DISPLAY_KEY_MAP[part] || part)
    return formatted.join('+')
}

const normalizeKey = (e: KeyboardEvent): string | null => {
    if (MODIFIER_KEYS.has(e.key)) return null

    if (e.key === '`' || e.key === '~') {
        return 'Backquote'
    }

    const code = e.code
    if (code.startsWith('Key')) {
        return code.slice(3).toUpperCase()
    }
    if (code.startsWith('Digit')) {
        return code.slice(5)
    }
    if (code.startsWith('Numpad')) {
        const tail = code.slice('Numpad'.length)
        if (/^\d$/.test(tail)) return tail
        const map: Record<string, string> = {
            Add: 'Num+',
            Subtract: 'Num-',
            Multiply: 'Num*',
            Divide: 'Num/',
            Decimal: 'Num.',
            Enter: 'NumEnter'
        }
        return map[tail] || `Num${tail}`
    }

    if (/^F\d{1,2}$/i.test(e.key)) {
        return e.key.toUpperCase()
    }

    if (CODE_KEY_MAP[code]) {
        return CODE_KEY_MAP[code]
    }

    if (e.key && e.key.length === 1) {
        return e.key.toUpperCase()
    }

    return e.key ? e.key : null
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const replaceComboToken = (combo: string, aliases: string[], canonical: string): string => {
    if (!combo) return combo
    const pattern = aliases.map(escapeRegex).join('|')
    return combo.replace(new RegExp(`(^|\\+)(${pattern})(?=\\+|$)`, 'gi'), (_, prefix: string) => `${prefix}${canonical}`)
}

const normalizeComboTokens = (combo: string): string => {
    let normalized = combo

    const tokenAliases: Array<[string[], string]> = [
        [['Control', 'Ctrl'], 'Ctrl'],
        [['Command', 'Cmd', 'Meta'], 'Meta'],
        [['Option', 'Alt'], 'Alt'],
        [['Shift'], 'Shift'],
        [['Escape', 'Esc'], 'Escape'],
        [['Tab'], 'Tab'],
        [['Enter'], 'Enter'],
        [['Spacebar', 'Space'], 'Space'],
        [['Backspace'], 'Backspace'],
        [['Delete', 'Del'], 'Delete'],
        [['Insert', 'Ins'], 'Insert'],
        [['Home'], 'Home'],
        [['End'], 'End'],
        [['PageUp', 'PgUp'], 'PageUp'],
        [['PageDown', 'PgDn'], 'PageDown'],
        [['ArrowUp', 'Up'], 'ArrowUp'],
        [['ArrowDown', 'Down'], 'ArrowDown'],
        [['ArrowLeft', 'Left'], 'ArrowLeft'],
        [['ArrowRight', 'Right'], 'ArrowRight'],
        [['Backquote', 'Oem3', '`', '~'], 'Backquote'],
        [['Minus', 'OemMinus', '-'], '-'],
        [['Equal', 'OemPlus', '='], '='],
        [['BracketLeft', 'Oem4', '['], '['],
        [['BracketRight', 'Oem6', ']'], ']'],
        [['Backslash', 'Oem5', '\\'], '\\'],
        [['Semicolon', 'Oem1', ';'], ';'],
        [['Quote', 'Oem7', '\''], '\''],
        [['Comma', 'OemComma', ','], ','],
        [['Period', 'OemPeriod', '.'], '.'],
        [['Slash', 'Oem2', '/'], '/'],
    ]

    for (const [aliases, canonical] of tokenAliases) {
        normalized = replaceComboToken(normalized, aliases, canonical)
    }

    normalized = normalized.replace(/(^|\+)(f\d{1,2})(?=\+|$)/gi, (_, prefix: string, key: string) => `${prefix}${key.toUpperCase()}`)
    normalized = normalized.replace(/(^|\+)([a-z])(?=\+|$)/g, (_, prefix: string, key: string) => `${prefix}${key.toUpperCase()}`)

    return normalized
}

export const isTextInputActive = (): boolean => {
    const el = document.activeElement
    if (!el) return false

    if (el instanceof HTMLTextAreaElement) return true
    if (el instanceof HTMLInputElement) {
        const textLikeTypes = new Set([
            'text',
            'search',
            'password',
            'email',
            'number',
            'url',
            'tel'
        ])
        return textLikeTypes.has(el.type)
    }
    return false
}
