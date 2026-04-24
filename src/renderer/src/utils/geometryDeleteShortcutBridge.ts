/**
 * Fallback bridge for geometry vertex deletion when the shortcut binding path
 * does not consume Delete in the current environment.
 */

type GeometryDeleteListener = (event: KeyboardEvent) => boolean

let listener: GeometryDeleteListener | null = null

export function registerGeometryDeleteKeyListener(fn: GeometryDeleteListener): () => void {
    listener = fn
    return () => {
        if (listener === fn) {
            listener = null
        }
    }
}

export function tryConsumeGeometryDeleteKey(event: KeyboardEvent): boolean {
    if (event.key !== 'Delete' && event.key !== 'Del' && event.code !== 'Delete') {
        return false
    }
    return listener?.(event) ?? false
}
