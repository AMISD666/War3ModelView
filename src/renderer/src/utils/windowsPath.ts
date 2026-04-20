export const normalizeWindowsPath = (path: string): string => path.replace(/\//g, '\\')

export const isAbsoluteWindowsPath = (path: string): boolean =>
    /^[a-zA-Z]:\\/.test(path) || path.startsWith('\\\\')

export const getDirname = (path: string): string => {
    const normalized = normalizeWindowsPath(path)
    const idx = normalized.lastIndexOf('\\')
    return idx >= 0 ? normalized.slice(0, idx) : normalized
}

export const getBasename = (path: string): string => {
    const normalized = normalizeWindowsPath(path)
    const idx = normalized.lastIndexOf('\\')
    return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

export const splitPathFileName = (path: string): { stem: string; ext: string } => {
    const name = getBasename(path)
    const dot = name.lastIndexOf('.')
    if (dot <= 0) return { stem: name, ext: '' }
    return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

export const getPathDir = (path: string): string => {
    const normalized = normalizeWindowsPath(path)
    const idx = normalized.lastIndexOf('\\')
    return idx >= 0 ? normalized.slice(0, idx) : ''
}

export const joinPath = (dir: string, file: string): string => {
    if (!dir) return file
    const normalizedDir = dir.replace(/[\\]+$/, '')
    return `${normalizedDir}\\${file}`
}

export const buildTargetAssetPath = (targetModelDir: string, relativePath: string): string => {
    const sanitizedDir = targetModelDir.replace(/[\\/]+$/, '')
    const sanitizedRelative = normalizeWindowsPath(relativePath).replace(/^[\\/]+/, '')
    return `${sanitizedDir}\\${sanitizedRelative}`
}
