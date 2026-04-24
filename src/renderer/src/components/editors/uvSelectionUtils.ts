export interface CanvasPoint {
    x: number
    y: number
}

export interface CanvasRect {
    minX: number
    maxX: number
    minY: number
    maxY: number
}

const EPSILON = 1e-6

export const createSelectionRect = (
    start: CanvasPoint,
    end: CanvasPoint,
    minimumSize: number = 6
): CanvasRect => {
    let minX = Math.min(start.x, end.x)
    let maxX = Math.max(start.x, end.x)
    let minY = Math.min(start.y, end.y)
    let maxY = Math.max(start.y, end.y)

    if (maxX - minX < minimumSize) {
        const centerX = (minX + maxX) / 2
        minX = centerX - minimumSize / 2
        maxX = centerX + minimumSize / 2
    }

    if (maxY - minY < minimumSize) {
        const centerY = (minY + maxY) / 2
        minY = centerY - minimumSize / 2
        maxY = centerY + minimumSize / 2
    }

    return { minX, maxX, minY, maxY }
}

export const pointInRect = (point: CanvasPoint, rect: CanvasRect): boolean => {
    return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
}

const orientation = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): number => {
    return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
}

const onSegment = (a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): boolean => {
    return (
        b.x >= Math.min(a.x, c.x) - EPSILON &&
        b.x <= Math.max(a.x, c.x) + EPSILON &&
        b.y >= Math.min(a.y, c.y) - EPSILON &&
        b.y <= Math.max(a.y, c.y) + EPSILON
    )
}

const segmentsIntersect = (a1: CanvasPoint, a2: CanvasPoint, b1: CanvasPoint, b2: CanvasPoint): boolean => {
    const o1 = orientation(a1, a2, b1)
    const o2 = orientation(a1, a2, b2)
    const o3 = orientation(b1, b2, a1)
    const o4 = orientation(b1, b2, a2)

    if ((o1 > EPSILON && o2 < -EPSILON || o1 < -EPSILON && o2 > EPSILON) &&
        (o3 > EPSILON && o4 < -EPSILON || o3 < -EPSILON && o4 > EPSILON)) {
        return true
    }

    if (Math.abs(o1) <= EPSILON && onSegment(a1, b1, a2)) return true
    if (Math.abs(o2) <= EPSILON && onSegment(a1, b2, a2)) return true
    if (Math.abs(o3) <= EPSILON && onSegment(b1, a1, b2)) return true
    if (Math.abs(o4) <= EPSILON && onSegment(b1, a2, b2)) return true

    return false
}

export const segmentIntersectsRect = (start: CanvasPoint, end: CanvasPoint, rect: CanvasRect): boolean => {
    if (pointInRect(start, rect) || pointInRect(end, rect)) {
        return true
    }

    const segmentMinX = Math.min(start.x, end.x)
    const segmentMaxX = Math.max(start.x, end.x)
    const segmentMinY = Math.min(start.y, end.y)
    const segmentMaxY = Math.max(start.y, end.y)
    if (segmentMaxX < rect.minX || segmentMinX > rect.maxX || segmentMaxY < rect.minY || segmentMinY > rect.maxY) {
        return false
    }

    const topLeft = { x: rect.minX, y: rect.minY }
    const topRight = { x: rect.maxX, y: rect.minY }
    const bottomRight = { x: rect.maxX, y: rect.maxY }
    const bottomLeft = { x: rect.minX, y: rect.maxY }

    return (
        segmentsIntersect(start, end, topLeft, topRight) ||
        segmentsIntersect(start, end, topRight, bottomRight) ||
        segmentsIntersect(start, end, bottomRight, bottomLeft) ||
        segmentsIntersect(start, end, bottomLeft, topLeft)
    )
}

const sign = (p1: CanvasPoint, p2: CanvasPoint, p3: CanvasPoint): number => {
    return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
}

export const pointInTriangle = (point: CanvasPoint, a: CanvasPoint, b: CanvasPoint, c: CanvasPoint): boolean => {
    const d1 = sign(point, a, b)
    const d2 = sign(point, b, c)
    const d3 = sign(point, c, a)

    const hasNegative = d1 < -EPSILON || d2 < -EPSILON || d3 < -EPSILON
    const hasPositive = d1 > EPSILON || d2 > EPSILON || d3 > EPSILON

    return !(hasNegative && hasPositive)
}

export const triangleIntersectsRect = (
    a: CanvasPoint,
    b: CanvasPoint,
    c: CanvasPoint,
    rect: CanvasRect
): boolean => {
    if (pointInRect(a, rect) || pointInRect(b, rect) || pointInRect(c, rect)) {
        return true
    }

    const rectCorners = [
        { x: rect.minX, y: rect.minY },
        { x: rect.maxX, y: rect.minY },
        { x: rect.maxX, y: rect.maxY },
        { x: rect.minX, y: rect.maxY }
    ]

    if (rectCorners.some((corner) => pointInTriangle(corner, a, b, c))) {
        return true
    }

    return (
        segmentIntersectsRect(a, b, rect) ||
        segmentIntersectsRect(b, c, rect) ||
        segmentIntersectsRect(c, a, rect)
    )
}
