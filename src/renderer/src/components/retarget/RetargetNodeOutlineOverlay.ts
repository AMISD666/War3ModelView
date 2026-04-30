import type { NodeScreenLabel } from '../viewer/nodeNameOverlay'

export const drawRetargetNodeOutline = (
    overlay: HTMLCanvasElement | null,
    labels: NodeScreenLabel[],
    nodeId: number | null
): void => {
    if (nodeId === null) return
    const ctx = overlay?.getContext('2d')
    if (!overlay || !ctx) return

    const label = labels.find((item) => item.id === nodeId)
    if (!label) return

    const dpr = window.devicePixelRatio || 1
    const x = label.x
    const y = label.y
    const radius = 15 * dpr

    ctx.save()
    ctx.shadowColor = 'rgba(255, 214, 64, 0.95)'
    ctx.shadowBlur = 10 * dpr
    ctx.lineWidth = 7 * dpr
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)'
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.shadowBlur = 0
    ctx.lineWidth = 3 * dpr
    ctx.strokeStyle = '#ffd640'
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.lineWidth = 2 * dpr
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)'
    ctx.beginPath()
    ctx.moveTo(x - radius * 0.55, y)
    ctx.lineTo(x + radius * 0.55, y)
    ctx.moveTo(x, y - radius * 0.55)
    ctx.lineTo(x, y + radius * 0.55)
    ctx.stroke()
    ctx.restore()
}
