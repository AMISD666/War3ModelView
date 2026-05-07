import { useEffect } from 'react'
import { useWindowEvent } from '../../../hooks/useWindowEvent'
import { windowGateway } from '../../../infrastructure/window'
import { EXTERNAL_FILE_DROP_CLAIM_EVENT, type ExternalFileDropClaimDetail } from '../../../application/file-drop'

type DropPosition = { x: number; y: number } | null | undefined

type TextureDropPayload = {
    paths?: string[]
    position?: DropPosition
}

type WindowScopedEvent<TPayload> = {
    payload?: TPayload
    windowLabel?: string
}

type ElementRef = {
    current: HTMLElement | null
}

interface UseMaterialEditorStandaloneEventsArgs {
    visible: boolean
    isStandalone?: boolean
    editingField: string | null
    selectedMaterialIndex: number
    selectedLayerIndex: number
    onApplyKeyframe: (field: string, data: unknown) => void
    onFinishKeyframeEdit: () => void
    isSupportedTextureFile: (path: string) => boolean
    detailsDropSurfaceRef: ElementRef
    layerTextureDropSurfaceRef: ElementRef
    textureDropZoneRef: ElementRef
    isPointInsideElement: (x: number, y: number, element: HTMLElement | null) => boolean
    setIsTextureDropActive: (active: boolean) => void
    handleExternalTexturePaths: (paths: string[]) => Promise<void>
}

export function useMaterialEditorStandaloneEvents({
    visible,
    isStandalone,
    editingField,
    selectedMaterialIndex,
    selectedLayerIndex,
    onApplyKeyframe,
    onFinishKeyframeEdit,
    isSupportedTextureFile,
    detailsDropSurfaceRef,
    layerTextureDropSurfaceRef,
    textureDropZoneRef,
    isPointInsideElement,
    setIsTextureDropActive,
    handleExternalTexturePaths,
}: UseMaterialEditorStandaloneEventsArgs): void {
    const standaloneEnabled = Boolean(isStandalone && visible)
    const currentWindowLabel = windowGateway.getCurrentWindowLabel()

    const isCurrentWindowEvent = (event: { windowLabel?: string }): boolean => {
        const sourceWindowLabel = event.windowLabel
        return !sourceWindowLabel || sourceWindowLabel === currentWindowLabel
    }

    const emitClaim = (kind: ExternalFileDropClaimDetail['kind'], paths: string[]): void => {
        if (paths.length === 0) return
        void windowGateway.emit<ExternalFileDropClaimDetail>(EXTERNAL_FILE_DROP_CLAIM_EVENT, {
            kind,
            paths,
            sourceWindowLabel: currentWindowLabel,
        })
    }

    const isHitTarget = (position?: DropPosition): boolean => {
        const dropTargets = [
            detailsDropSurfaceRef.current,
            layerTextureDropSurfaceRef.current,
            textureDropZoneRef.current,
        ].filter(Boolean) as HTMLElement[]

        if (dropTargets.length === 0) return false
        if (!position) return true
        return dropTargets.some((element) => isPointInsideElement(position.x, position.y, element))
    }

    useWindowEvent<any>('IPC_KEYFRAME_SAVE', (event) => {
        const payload = event.payload
        if (payload?.callerId !== 'MaterialEditorModal' || !editingField) return
        if (selectedMaterialIndex < 0 || selectedLayerIndex < 0) return

        onApplyKeyframe(editingField, payload.data)
        onFinishKeyframeEdit()
    }, visible)

    useWindowEvent<TextureDropPayload>('tauri://drag-enter', (event) => {
        const scopedEvent = event as WindowScopedEvent<TextureDropPayload>
        if (!isCurrentWindowEvent(scopedEvent)) return

        const supportedPaths = (scopedEvent.payload?.paths || []).filter(isSupportedTextureFile)
        if (supportedPaths.length === 0) return
        if (!isHitTarget(scopedEvent.payload?.position)) return
        emitClaim('claim', supportedPaths)
        setIsTextureDropActive(true)
    }, standaloneEnabled)

    useWindowEvent<TextureDropPayload>('tauri://drag-leave', (event) => {
        const scopedEvent = event as WindowScopedEvent<TextureDropPayload>
        if (!isCurrentWindowEvent(scopedEvent)) return
        const supportedPaths = (scopedEvent.payload?.paths || []).filter(isSupportedTextureFile)
        emitClaim('release', supportedPaths)
        setIsTextureDropActive(false)
    }, standaloneEnabled)

    useWindowEvent<TextureDropPayload>('tauri://drag-drop', (event) => {
        const scopedEvent = event as WindowScopedEvent<TextureDropPayload>
        if (!isCurrentWindowEvent(scopedEvent)) return

        const supportedPaths = (scopedEvent.payload?.paths || []).filter(isSupportedTextureFile)
        if (supportedPaths.length === 0) return
        if (!isHitTarget(scopedEvent.payload?.position)) return
        emitClaim('consume', supportedPaths)

        void handleExternalTexturePaths(supportedPaths).finally(() => {
            setIsTextureDropActive(false)
        })
    }, standaloneEnabled)

    useEffect(() => {
        if (!standaloneEnabled) {
            setIsTextureDropActive(false)
        }
    }, [setIsTextureDropActive, standaloneEnabled])
}
