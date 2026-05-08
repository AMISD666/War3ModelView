export type ModelOptimizeStalePolicy = 'warn' | 'reject'

export type ModelOptimizeCommandName = 'EXECUTE_POLYGON_OPT' | 'EXECUTE_KEYFRAME_OPT'

export interface ModelOptimizeCommandEnvelope {
    type: 'model-optimize-command'
    documentId: string | null
    baseDocumentRevision?: number
    stalePolicy: ModelOptimizeStalePolicy
}

export interface PolygonOptimizeOptions {
    removeRedundantVertices: boolean
    decimateModel: boolean
    decimateRatio: number
}

export interface KeyframeOptimizeOptions {
    removeRedundantFrames: boolean
    optimizeKeyframes: boolean
}

export interface PolygonOptimizeCommandPayload extends ModelOptimizeCommandEnvelope {
    kind: 'polygon'
    options: PolygonOptimizeOptions
}

export interface KeyframeOptimizeCommandPayload extends ModelOptimizeCommandEnvelope {
    kind: 'keyframe'
    options: KeyframeOptimizeOptions
}

export type ModelOptimizeCommandPayload = PolygonOptimizeCommandPayload | KeyframeOptimizeCommandPayload

export type CreateModelOptimizeCommandInput =
    | {
        documentId: string | null
        documentRevision: number
        stalePolicy?: ModelOptimizeStalePolicy
        kind: 'polygon'
        options: PolygonOptimizeOptions
    }
    | {
        documentId: string | null
        documentRevision: number
        stalePolicy?: ModelOptimizeStalePolicy
        kind: 'keyframe'
        options: KeyframeOptimizeOptions
    }

export type ParseModelOptimizeCommandResult =
    | { ok: true; payload: ModelOptimizeCommandPayload }
    | { ok: false; reason: string }

const clampDecimateRatio = (value: unknown): number => {
    const ratio = Number(value)
    if (!Number.isFinite(ratio)) {
        return 75
    }
    return Math.max(0, Math.min(100, Math.round(ratio)))
}

export const createModelOptimizeCommandPayload = (
    input: CreateModelOptimizeCommandInput,
): ModelOptimizeCommandPayload => ({
    type: 'model-optimize-command',
    documentId: input.documentId,
    baseDocumentRevision: input.documentRevision,
    stalePolicy: input.stalePolicy ?? 'reject',
    kind: input.kind,
    options: input.kind === 'polygon'
        ? {
            removeRedundantVertices: input.options.removeRedundantVertices,
            decimateModel: input.options.decimateModel,
            decimateRatio: clampDecimateRatio(input.options.decimateRatio),
        }
        : {
            removeRedundantFrames: input.options.removeRedundantFrames,
            optimizeKeyframes: input.options.optimizeKeyframes,
        },
} as ModelOptimizeCommandPayload)

export const parseModelOptimizeCommandPayload = (
    commandName: string,
    payload: unknown,
): ParseModelOptimizeCommandResult => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, reason: 'Payload must be an object' }
    }

    const candidate = payload as {
        type?: unknown
        kind?: unknown
        options?: unknown
        documentId?: unknown
        baseDocumentRevision?: unknown
        stalePolicy?: unknown
    }

    if (candidate.type !== 'model-optimize-command') {
        return { ok: false, reason: 'Unsupported model optimize payload type' }
    }

    const options = candidate.options && typeof candidate.options === 'object' && !Array.isArray(candidate.options)
        ? candidate.options as Record<string, unknown>
        : null
    if (!options) {
        return { ok: false, reason: 'Options must be an object' }
    }

    const envelope = {
        type: 'model-optimize-command' as const,
        documentId: typeof candidate.documentId === 'string' || candidate.documentId === null
            ? candidate.documentId
            : null,
        baseDocumentRevision: typeof candidate.baseDocumentRevision === 'number'
            ? candidate.baseDocumentRevision
            : undefined,
        stalePolicy: candidate.stalePolicy === 'warn' ? 'warn' as const : 'reject' as const,
    }

    if (commandName === 'EXECUTE_POLYGON_OPT' && candidate.kind === 'polygon') {
        return {
            ok: true,
            payload: {
                ...envelope,
                kind: 'polygon',
                options: {
                    removeRedundantVertices: options.removeRedundantVertices !== false,
                    decimateModel: options.decimateModel !== false,
                    decimateRatio: clampDecimateRatio(options.decimateRatio),
                },
            },
        }
    }

    if (commandName === 'EXECUTE_KEYFRAME_OPT' && candidate.kind === 'keyframe') {
        return {
            ok: true,
            payload: {
                ...envelope,
                kind: 'keyframe',
                options: {
                    removeRedundantFrames: options.removeRedundantFrames !== false,
                    optimizeKeyframes: options.optimizeKeyframes !== false,
                },
            },
        }
    }

    return { ok: false, reason: 'Command name and optimize kind do not match' }
}
