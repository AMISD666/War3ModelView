import { useRendererStore } from '../../store/rendererStore'

export const zoomNodeSizeFromWheel = (deltaY: number): number => {
    const { nodeSize, setNodeSize } = useRendererStore.getState()
    const delta = deltaY > 0 ? -0.1 : 0.1
    const nextSize = (nodeSize ?? 1.0) + delta
    setNodeSize(nextSize)
    return useRendererStore.getState().nodeSize
}
