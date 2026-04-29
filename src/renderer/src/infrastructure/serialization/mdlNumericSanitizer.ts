const NON_FINITE_NUMBER_TOKEN = /(?:[+-]?Infinity|NaN)/g
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/

export interface MdlTextSanitizeResult {
    text: string
    replacements: number
}

const isIdentifierChar = (value: string | undefined): boolean =>
    !!value && IDENTIFIER_CHAR.test(value)

const replaceNonFiniteTokensInPlainText = (text: string): MdlTextSanitizeResult => {
    let replacements = 0
    const nextText = text.replace(NON_FINITE_NUMBER_TOKEN, (match, offset: number, source: string) => {
        const before = source[offset - 1]
        const after = source[offset + match.length]
        if (isIdentifierChar(before) || isIdentifierChar(after)) {
            return match
        }

        replacements += 1
        return '0'
    })

    return { text: nextText, replacements }
}

export const sanitizeMdlNonFiniteNumericTokens = (text: string): MdlTextSanitizeResult => {
    let output = ''
    let chunkStart = 0
    let replacements = 0
    let inString = false
    let escaped = false

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]

        if (inString) {
            if (escaped) {
                escaped = false
            } else if (char === '\\') {
                escaped = true
            } else if (char === '"') {
                inString = false
            }
            continue
        }

        if (char !== '"') {
            continue
        }

        const sanitized = replaceNonFiniteTokensInPlainText(text.slice(chunkStart, index))
        output += sanitized.text
        replacements += sanitized.replacements

        const stringStart = index
        inString = true
        index += 1
        escaped = false
        while (index < text.length) {
            const stringChar = text[index]
            if (escaped) {
                escaped = false
            } else if (stringChar === '\\') {
                escaped = true
            } else if (stringChar === '"') {
                break
            }
            index += 1
        }
        output += text.slice(stringStart, Math.min(index + 1, text.length))
        inString = false
        chunkStart = Math.min(index + 1, text.length)
    }

    const sanitized = replaceNonFiniteTokensInPlainText(text.slice(chunkStart))
    output += sanitized.text
    replacements += sanitized.replacements

    return { text: output, replacements }
}

export const sanitizeMdlNestedSegmentColorVectors = (text: string): MdlTextSanitizeResult => {
    let replacements = 0
    const nextText = text.replace(
        /(Color\s*\{\s*)\{\s*([^{}]+?)\s*\}(\s*\})/g,
        (_match, prefix: string, values: string, suffix: string) => {
            replacements += 1
            return `${prefix}${values.trim()}${suffix}`
        }
    )

    return { text: nextText, replacements }
}

const isExpectedNumberSyntaxError = (error: unknown): boolean =>
    error instanceof Error &&
    /^SyntaxError, near \d+, expected number$/.test(error.message)

export function parseMdlWithNumericRecovery<T>(text: string, parse: (text: string) => T): T {
    try {
        return parse(text)
    } catch (error) {
        if (!isExpectedNumberSyntaxError(error)) {
            throw error
        }

        const nonFiniteSanitized = sanitizeMdlNonFiniteNumericTokens(text)
        const segmentColorSanitized = sanitizeMdlNestedSegmentColorVectors(nonFiniteSanitized.text)
        const replacements = nonFiniteSanitized.replacements + segmentColorSanitized.replacements
        if (replacements === 0) {
            throw error
        }

        try {
            return parse(segmentColorSanitized.text)
        } catch {
            throw error
        }
    }
}

const isNumericTypedArray = (value: unknown): value is Exclude<ArrayBufferView, DataView> =>
    ArrayBuffer.isView(value) && !(value instanceof DataView)

const isFloatTypedArray = (value: unknown): value is Float32Array | Float64Array =>
    value instanceof Float32Array || value instanceof Float64Array

const numberOrFallback = (value: unknown, fallback: number): number => {
    const num = Number(value)
    return Number.isFinite(num) ? num : fallback
}

const flattenVector3 = (value: unknown, fallback: [number, number, number]): Float32Array => {
    const source = Array.isArray(value) && value.length === 1 && (Array.isArray(value[0]) || isNumericTypedArray(value[0]))
        ? value[0]
        : value

    if (Array.isArray(source) || isNumericTypedArray(source)) {
        const arr = source as ArrayLike<unknown>
        return new Float32Array([
            numberOrFallback(arr[0], fallback[0]),
            numberOrFallback(arr[1], fallback[1]),
            numberOrFallback(arr[2], fallback[2]),
        ])
    }

    if (source && typeof source === 'object') {
        const record = source as Record<number, unknown>
        return new Float32Array([
            numberOrFallback(record[0], fallback[0]),
            numberOrFallback(record[1], fallback[1]),
            numberOrFallback(record[2], fallback[2]),
        ])
    }

    return new Float32Array(fallback)
}

const normalizeParticleEmitter2VectorsForSerialization = (record: Record<string, unknown>): void => {
    if (Array.isArray(record.SegmentColor)) {
        const colors = record.SegmentColor.slice(0, 3).map((color) => flattenVector3(color, [1, 1, 1]))
        while (colors.length < 3) {
            colors.push(new Float32Array([1, 1, 1]))
        }
        record.SegmentColor = colors
    }

    if (record.ParticleScaling !== undefined) {
        record.ParticleScaling = flattenVector3(record.ParticleScaling, [1, 1, 1])
    }
}

export function sanitizeModelNumericValuesForSerialization<T>(value: T): T {
    const seen = new WeakSet<object>()

    const visit = (current: unknown): void => {
        if (!current || typeof current !== 'object') {
            return
        }

        if (isFloatTypedArray(current)) {
            for (let index = 0; index < current.length; index += 1) {
                if (!Number.isFinite(current[index])) {
                    current[index] = 0
                }
            }
            return
        }

        if (isNumericTypedArray(current)) {
            return
        }

        if (seen.has(current)) {
            return
        }
        seen.add(current)

        if (Array.isArray(current)) {
            current.forEach((entry, index) => {
                if (typeof entry === 'number') {
                    if (!Number.isFinite(entry)) {
                        current[index] = 0
                    }
                } else {
                    visit(entry)
                }
            })
            return
        }

        const record = current as Record<string, unknown>
        if ('SegmentColor' in record || 'ParticleScaling' in record) {
            normalizeParticleEmitter2VectorsForSerialization(record)
        }

        Object.entries(record).forEach(([key, entry]) => {
            if (typeof entry === 'number') {
                if (!Number.isFinite(entry)) {
                    record[key] = 0
                }
            } else {
                visit(entry)
            }
        })
    }

    visit(value)
    return value
}
