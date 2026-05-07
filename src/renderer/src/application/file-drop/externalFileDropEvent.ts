export type ExternalFileDropPosition = { x: number; y: number } | null

export interface ExternalFileDropDetail {
    paths: string[]
    position: ExternalFileDropPosition
}

export type ExternalFileDropClaimKind = 'claim' | 'release' | 'consume'

export interface ExternalFileDropClaimDetail {
    kind: ExternalFileDropClaimKind
    paths: string[]
    sourceWindowLabel?: string
}

export const EXTERNAL_FILE_DROP_EVENT = 'war3-external-file-drop'
export const EXTERNAL_FILE_DROP_CLAIM_EVENT = 'war3-external-file-drop-claim'

export const dispatchExternalFileDrop = (detail: ExternalFileDropDetail): boolean => {
    const event = new CustomEvent<ExternalFileDropDetail>(EXTERNAL_FILE_DROP_EVENT, {
        detail,
        cancelable: true,
    })

    window.dispatchEvent(event)
    return event.defaultPrevented
}

export const isExternalFileDropEvent = (event: Event): event is CustomEvent<ExternalFileDropDetail> => (
    event.type === EXTERNAL_FILE_DROP_EVENT
)

export const normalizeExternalFileDropPath = (path: string): string => path.replace(/\//g, '\\').toLowerCase()
