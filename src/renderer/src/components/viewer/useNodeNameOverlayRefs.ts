import { useRef } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import type { NodeScreenLabel } from './nodeNameOverlay'

export interface NodeNameOverlayRefs {
    overlayRef: RefObject<HTMLCanvasElement>
    labelsRef: MutableRefObject<NodeScreenLabel[]>
    hoveredIdRef: MutableRefObject<number | null>
}

export const useNodeNameOverlayRefs = (): NodeNameOverlayRefs => ({
    overlayRef: useRef<HTMLCanvasElement>(null),
    labelsRef: useRef<NodeScreenLabel[]>([]),
    hoveredIdRef: useRef<number | null>(null),
})
