import { useEffect } from 'react'
import {
    EXTERNAL_FILE_DROP_CLAIM_EVENT,
    EXTERNAL_FILE_DROP_EVENT,
    isExternalFileDropEvent,
    type ExternalFileDropClaimDetail,
} from '../../../application/file-drop'
import { windowGateway } from '../../../infrastructure/window'

type ElementRef = {
    current: HTMLElement | null
}

interface UseMaterialEditorMainWindowFileDropArgs {
    visible: boolean
    selectedMaterialIndexRef: { current: number }
    selectedLayerIndexRef: { current: number }
    isSupportedTextureFile: (path: string) => boolean
    detailsDropSurfaceRef: ElementRef
    layerTextureDropSurfaceRef: ElementRef
    textureDropZoneRef: ElementRef
    isPointInsideElement: (x: number, y: number, element: HTMLElement | null) => boolean
    handleExternalTexturePaths: (paths: string[]) => Promise<void>
}

export function useMaterialEditorMainWindowFileDrop({
    visible,
    selectedMaterialIndexRef,
    selectedLayerIndexRef,
    isSupportedTextureFile,
    detailsDropSurfaceRef,
    layerTextureDropSurfaceRef,
    textureDropZoneRef,
    isPointInsideElement,
    handleExternalTexturePaths,
}: UseMaterialEditorMainWindowFileDropArgs): void {
    useEffect(() => {
        if (!visible) return

        const onExternalFileDrop = async (event: Event) => {
            if (selectedMaterialIndexRef.current < 0 || selectedLayerIndexRef.current < 0) return
            if (!isExternalFileDropEvent(event)) return

            const paths = Array.isArray(event.detail?.paths) ? event.detail.paths : []
            if (paths.length === 0) return

            const supportedPaths = paths.filter(isSupportedTextureFile)
            if (supportedPaths.length === 0) return

            const position = event.detail?.position
            if (position && ![
                detailsDropSurfaceRef.current,
                layerTextureDropSurfaceRef.current,
                textureDropZoneRef.current,
            ].some((element) => isPointInsideElement(position.x, position.y, element))) {
                return
            }

            event.preventDefault()
            void windowGateway.emit<ExternalFileDropClaimDetail>(EXTERNAL_FILE_DROP_CLAIM_EVENT, {
                kind: 'consume',
                paths: supportedPaths,
                sourceWindowLabel: windowGateway.getCurrentWindowLabel(),
            })
            await handleExternalTexturePaths(supportedPaths)
        }

        window.addEventListener(EXTERNAL_FILE_DROP_EVENT, onExternalFileDrop as EventListener)
        return () => window.removeEventListener(EXTERNAL_FILE_DROP_EVENT, onExternalFileDrop as EventListener)
    }, [
        detailsDropSurfaceRef,
        handleExternalTexturePaths,
        isPointInsideElement,
        isSupportedTextureFile,
        layerTextureDropSurfaceRef,
        selectedLayerIndexRef,
        selectedMaterialIndexRef,
        textureDropZoneRef,
        visible,
    ])
}
