import { useModelStore } from '../../store/modelStore'
import {
    NODE_EDITOR_COMMANDS,
    type ApplyNodeUpdatePayload,
    type ClearNodePreviewPayload,
    type NodeEditorNodePayload,
    type RenameNodePayload,
    type RevisionedNodeEditorCommandMetadata,
} from '../../types/nodeEditorRpc'
import type { ModelNode } from '../../types/node'
import { markCommandReceived, markCommandRejected, markToolCommandStaleRevision } from '../diagnostics'
import { previewOverlayService } from '../preview'
import { commandBus, type CommandBus } from './CommandBus'

const checkNodeCommandRevision = (
    command: string,
    payload: RevisionedNodeEditorCommandMetadata | undefined,
): boolean => {
    const state = useModelStore.getState()
    markCommandReceived({
        source: 'NodeEditorCommandHandler',
        commandName: command,
        commandDocumentId: payload?.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: payload?.baseDocumentRevision ?? '',
        activeDocumentRevision: state.documentRevision,
        stalePolicy: payload?.stalePolicy ?? '',
    })

    if (typeof payload?.baseDocumentRevision !== 'number') {
        return true
    }

    const documentMismatch =
        payload.documentId !== undefined &&
        payload.documentId !== null &&
        state.documentId !== null &&
        payload.documentId !== state.documentId
    const revisionMismatch = payload.baseDocumentRevision !== state.documentRevision

    if (!documentMismatch && !revisionMismatch) {
        return true
    }

    markToolCommandStaleRevision({
        source: 'NodeEditorCommandHandler',
        commandName: command,
        commandDocumentId: payload.documentId ?? '',
        activeDocumentId: state.documentId ?? '',
        baseDocumentRevision: payload.baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
        stalePolicy: payload.stalePolicy ?? 'warn',
    })

    if (documentMismatch || payload.stalePolicy === 'reject') {
        markCommandRejected({
            source: 'NodeEditorCommandHandler',
            commandName: command,
            commandDocumentId: payload.documentId ?? '',
            activeDocumentId: state.documentId ?? '',
            baseDocumentRevision: payload.baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
            reason: documentMismatch ? 'document_mismatch' : 'stale_revision',
        })
        console.warn('[NodeEditorCommandHandler] Rejected stale command', {
            command,
            commandDocumentId: payload.documentId,
            activeDocumentId: state.documentId,
            baseDocumentRevision: payload.baseDocumentRevision,
            activeDocumentRevision: state.documentRevision,
        })
        return false
    }

    console.warn('[NodeEditorCommandHandler] Stale command detected; applying for compatibility', {
        command,
        commandDocumentId: payload.documentId,
        activeDocumentId: state.documentId,
        baseDocumentRevision: payload.baseDocumentRevision,
        activeDocumentRevision: state.documentRevision,
    })
    return true
}

export class NodeEditorCommandHandler {
    constructor(private readonly bus: CommandBus = commandBus) {}

    handle(command: string, payload: unknown): void {
        if (!checkNodeCommandRevision(command, payload as RevisionedNodeEditorCommandMetadata | undefined)) {
            previewOverlayService.clearNodeEditorPreview()
            return
        }

        if (command === NODE_EDITOR_COMMANDS.previewNodeUpdate) {
            this.previewNodeUpdate(payload)
            return
        }

        if (command === NODE_EDITOR_COMMANDS.clearNodePreview) {
            this.clearNodePreview(payload)
            return
        }

        if (command === NODE_EDITOR_COMMANDS.applyNodeUpdate) {
            this.applyNodeUpdate(payload)
            return
        }

        if (command === NODE_EDITOR_COMMANDS.renameNode) {
            this.renameNode(payload)
        }
    }

    previewNodeUpdate<TNode extends ModelNode>(payload: NodeEditorNodePayload<TNode> | unknown): void {
        const previewPayload = payload as NodeEditorNodePayload<TNode> | undefined
        const objectId = previewPayload?.objectId
        const node = previewPayload?.node
        if (typeof objectId === 'number' && node != null) {
            previewOverlayService.setNodeEditorPreview({ objectId, node })
        }
    }

    clearNodePreview(payload: ClearNodePreviewPayload | unknown): void {
        const clearPayload = payload as ClearNodePreviewPayload | undefined
        if (clearPayload && clearPayload.objectId !== null && typeof clearPayload.objectId !== 'number') {
            return
        }
        previewOverlayService.clearNodeEditorPreview()
    }

    applyNodeUpdate<TNode extends Partial<ModelNode>>(payload: ApplyNodeUpdatePayload<TNode> | unknown): void {
        const applyPayload = payload as ApplyNodeUpdatePayload<TNode> | undefined
        const objectId = applyPayload?.objectId
        const node = applyPayload?.node
        const history = applyPayload?.history
        if (typeof objectId !== 'number' || node == null) {
            return
        }

        previewOverlayService.clearNodeEditorPreview()

        if (history && typeof history.name === 'string') {
            const undoNode = history.undoNode as Partial<ModelNode>
            const redoNode = history.redoNode as Partial<ModelNode>
            this.bus.execute({
                name: history.name,
                execute: () => useModelStore.getState().updateNode(objectId, node),
                undo: () => useModelStore.getState().updateNode(objectId, undoNode),
                redo: () => useModelStore.getState().updateNode(objectId, redoNode),
            })
            return
        }

        this.bus.execute({
            name: 'Update Node',
            execute: () => useModelStore.getState().updateNode(objectId, node),
            undo: () => {},
        }, { recordHistory: false })
    }

    renameNode(payload: RenameNodePayload | unknown): void {
        const renamePayload = payload as RenameNodePayload | undefined
        const objectId = renamePayload?.objectId
        const name = renamePayload?.name
        if (typeof objectId !== 'number' || typeof name !== 'string') {
            return
        }

        this.bus.execute({
            name: 'Rename Node',
            execute: () => useModelStore.getState().renameNode(objectId, name),
            undo: () => {},
        }, { recordHistory: false })
    }
}

export const nodeEditorCommandHandler = new NodeEditorCommandHandler()
