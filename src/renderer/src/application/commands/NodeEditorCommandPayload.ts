import {
    NODE_EDITOR_COMMANDS,
    type ApplyNodeUpdatePayload,
    type ClearNodePreviewPayload,
    type NodeEditorCommand,
    type NodeEditorCommandPayloadMap,
    type NodeEditorNodePayload,
    type RenameNodePayload,
    type RevisionedNodeEditorCommandMetadata,
} from '../../types/nodeEditorRpc'

export type NodeEditorStalePolicy = 'warn' | 'reject'

export interface NodeEditorCommandRevisionInput {
    documentId: string | null
    documentRevision: number
}

export type RevisionedNodeEditorCommandPayload<TCommand extends NodeEditorCommand = NodeEditorCommand> =
    NodeEditorCommandPayloadMap[TCommand] & RevisionedNodeEditorCommandMetadata

export type ParseNodeEditorCommandPayloadResult =
    | { ok: true; payload: RevisionedNodeEditorCommandPayload }
    | { ok: false; reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value)

const stalePolicyForNodeEditorCommand = (
    command: NodeEditorCommand,
    payload: NodeEditorCommandPayloadMap[NodeEditorCommand],
): NodeEditorStalePolicy => {
    if (command === NODE_EDITOR_COMMANDS.renameNode) {
        return 'reject'
    }
    if (command === NODE_EDITOR_COMMANDS.applyNodeUpdate && isRecord((payload as ApplyNodeUpdatePayload).history)) {
        return 'reject'
    }
    return 'warn'
}

const isNodeEditorHistoryPayload = (value: unknown): value is ApplyNodeUpdatePayload['history'] => {
    if (!isRecord(value)) {
        return false
    }
    return typeof value.name === 'string'
}

export const createRevisionedNodeEditorCommandPayload = <TCommand extends NodeEditorCommand>(
    command: TCommand,
    payload: NodeEditorCommandPayloadMap[TCommand],
    revision: NodeEditorCommandRevisionInput,
): RevisionedNodeEditorCommandPayload<TCommand> => ({
    ...payload,
    documentId: revision.documentId,
    baseDocumentRevision: revision.documentRevision,
    stalePolicy: stalePolicyForNodeEditorCommand(command, payload),
})

export const parseRevisionedNodeEditorCommandPayload = <TCommand extends NodeEditorCommand>(
    command: TCommand,
    payload: unknown,
): ParseNodeEditorCommandPayloadResult => {
    if (!isRecord(payload)) {
        return { ok: false, reason: 'Payload must be an object' }
    }

    const revision: RevisionedNodeEditorCommandMetadata = {
        documentId: typeof payload.documentId === 'string' || payload.documentId === null
            ? payload.documentId
            : undefined,
        baseDocumentRevision: typeof payload.baseDocumentRevision === 'number'
            ? payload.baseDocumentRevision
            : undefined,
        stalePolicy: payload.stalePolicy === 'reject' ? 'reject' : 'warn',
    }

    if (command === NODE_EDITOR_COMMANDS.previewNodeUpdate) {
        if (typeof payload.objectId !== 'number' || payload.node == null) {
            return { ok: false, reason: 'Preview payload requires objectId and node' }
        }
        const normalizedPayload: RevisionedNodeEditorCommandPayloadMap[TCommand] = {
            objectId: payload.objectId,
            node: payload.node,
            ...revision,
        } as RevisionedNodeEditorCommandPayloadMap[TCommand]
        return {
            ok: true,
            payload: normalizedPayload,
        }
    }

    if (command === NODE_EDITOR_COMMANDS.clearNodePreview) {
        if (payload.objectId !== null && typeof payload.objectId !== 'number') {
            return { ok: false, reason: 'Clear preview payload requires numeric or null objectId' }
        }
        const normalizedPayload: RevisionedNodeEditorCommandPayloadMap[TCommand] = {
            objectId: payload.objectId,
            ...revision,
        } as RevisionedNodeEditorCommandPayloadMap[TCommand]
        return {
            ok: true,
            payload: normalizedPayload,
        }
    }

    if (command === NODE_EDITOR_COMMANDS.applyNodeUpdate) {
        if (typeof payload.objectId !== 'number' || payload.node == null) {
            return { ok: false, reason: 'Apply payload requires objectId and node' }
        }
        const normalizedPayload: RevisionedNodeEditorCommandPayloadMap[TCommand] = {
            objectId: payload.objectId,
            node: payload.node,
            history: isNodeEditorHistoryPayload(payload.history) ? payload.history : undefined,
            ...revision,
        } as RevisionedNodeEditorCommandPayloadMap[TCommand]
        return {
            ok: true,
            payload: normalizedPayload,
        }
    }

    if (command === NODE_EDITOR_COMMANDS.renameNode) {
        if (typeof payload.objectId !== 'number' || typeof payload.name !== 'string') {
            return { ok: false, reason: 'Rename payload requires objectId and name' }
        }
        const normalizedPayload: RevisionedNodeEditorCommandPayloadMap[TCommand] = {
            objectId: payload.objectId,
            name: payload.name,
            ...revision,
        } as RevisionedNodeEditorCommandPayloadMap[TCommand]
        return {
            ok: true,
            payload: normalizedPayload,
        }
    }

    return { ok: false, reason: 'Unsupported node editor command' }
}

export type {
    ApplyNodeUpdatePayload,
    ClearNodePreviewPayload,
    NodeEditorNodePayload,
    RenameNodePayload,
}

type RevisionedNodeEditorCommandPayloadMap = {
    [TCommand in NodeEditorCommand]: NodeEditorCommandPayloadMap[TCommand] & RevisionedNodeEditorCommandMetadata
}
