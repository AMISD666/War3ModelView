import { useEffect, useState } from 'react'
import { windowGateway } from '../infrastructure/window'
import {
    GLOBAL_SEQUENCES_CHANGED_EVENT,
    type GlobalSequencesChangedPayload,
} from '../application/window-bridge/KeyframeEvents'
import { normalizeGlobalSequenceDurations } from '../application/window-bridge/GlobalSequenceCommandPayload'

type SyncedGlobalSequenceState = {
    documentId: string | null | undefined
    documentRevision: number | undefined
    globalSequences: number[] | undefined
}

const shouldApplyGlobalSequencePayload = (
    previousDocumentId: string | null | undefined,
    payloadDocumentId: string | null | undefined,
): boolean => {
    if (!previousDocumentId || !payloadDocumentId) {
        return true
    }
    return previousDocumentId === payloadDocumentId
}

export const useGlobalSequenceSync = (initialState: SyncedGlobalSequenceState) => {
    const [state, setState] = useState<SyncedGlobalSequenceState>({
        documentId: initialState.documentId,
        documentRevision: initialState.documentRevision,
        globalSequences: initialState.globalSequences
            ? normalizeGlobalSequenceDurations(initialState.globalSequences)
            : undefined,
    })

    useEffect(() => {
        setState((previous) => ({
            documentId: initialState.documentId ?? previous.documentId,
            documentRevision: initialState.documentRevision ?? previous.documentRevision,
            globalSequences: initialState.globalSequences
                ? normalizeGlobalSequenceDurations(initialState.globalSequences)
                : previous.globalSequences,
        }))
    }, [initialState.documentId, initialState.documentRevision, initialState.globalSequences])

    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | null = null

        void windowGateway.listen(GLOBAL_SEQUENCES_CHANGED_EVENT, (event) => {
            const payload = (event as { payload?: GlobalSequencesChangedPayload }).payload
            const nextSequences = Array.isArray(payload?.globalSequences)
                ? normalizeGlobalSequenceDurations(payload.globalSequences)
                : null
            if (!nextSequences) return

            setState((previous) => {
                if (!shouldApplyGlobalSequencePayload(previous.documentId, payload?.documentId)) {
                    return previous
                }
                return {
                    documentId: payload?.documentId ?? previous.documentId,
                    documentRevision: payload?.documentRevision ?? previous.documentRevision,
                    globalSequences: nextSequences,
                }
            })
        }).then((nextUnlisten) => {
            if (disposed) {
                nextUnlisten()
                return
            }
            unlisten = nextUnlisten
        })

        return () => {
            disposed = true
            unlisten?.()
        }
    }, [])

    const replaceGlobalSequences = (globalSequences: number[]) => {
        setState((previous) => ({
            ...previous,
            globalSequences: normalizeGlobalSequenceDurations(globalSequences),
        }))
    }

    return {
        ...state,
        replaceGlobalSequences,
    }
}
