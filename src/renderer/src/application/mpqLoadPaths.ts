export interface MpqPathExistenceGateway {
    exists(path: string): Promise<boolean>
}

export const STANDARD_WARCRAFT_MPQ_NAMES = [
    'war3.mpq',
    'War3Patch.mpq',
    'War3x.mpq',
    'War3xLocal.mpq',
] as const

const STANDARD_WARCRAFT_MPQ_NAME_KEYS = new Set(
    STANDARD_WARCRAFT_MPQ_NAMES.map((name) => name.toLowerCase()),
)

const normalizePathKey = (path: string): string =>
    path.replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase()

const getFileName = (path: string): string => {
    const normalized = path.replace(/\//g, '\\')
    return normalized.split('\\').pop() || path
}

const getDirectoryPath = (path: string): string => {
    const normalized = path.replace(/\//g, '\\')
    const index = normalized.lastIndexOf('\\')
    return index >= 0 ? normalized.slice(0, index) : ''
}

const joinPath = (directory: string, fileName: string): string =>
    directory ? `${directory}\\${fileName}` : fileName

const addUniquePath = (paths: string[], seen: Set<string>, path: string): void => {
    const normalized = path.trim()
    if (!normalized) return

    const key = normalizePathKey(normalized)
    if (seen.has(key)) return

    seen.add(key)
    paths.push(normalized)
}

export const mergeMpqPathLists = (...pathLists: string[][]): string[] => {
    const merged: string[] = []
    const seen = new Set<string>()

    for (const pathList of pathLists) {
        for (const path of pathList) {
            addUniquePath(merged, seen, path)
        }
    }

    return merged
}

export const isStandardWarcraftMpqPath = (path: string): boolean =>
    STANDARD_WARCRAFT_MPQ_NAME_KEYS.has(getFileName(path).toLowerCase())

export const expandManualMpqSelection = async (
    selectedPaths: string[],
    gateway: MpqPathExistenceGateway,
): Promise<string[]> => {
    const selected = mergeMpqPathLists(selectedPaths)
    const standardDirectories = mergeMpqPathLists(
        selected
            .filter(isStandardWarcraftMpqPath)
            .map(getDirectoryPath)
            .filter(Boolean),
    )

    if (standardDirectories.length === 0) {
        return selected
    }

    const expanded: string[] = []
    const seen = new Set<string>()

    for (const directory of standardDirectories) {
        for (const fileName of STANDARD_WARCRAFT_MPQ_NAMES) {
            const candidate = joinPath(directory, fileName)
            if (await gateway.exists(candidate)) {
                addUniquePath(expanded, seen, candidate)
            }
        }
    }

    for (const path of selected) {
        if (!isStandardWarcraftMpqPath(path)) {
            addUniquePath(expanded, seen, path)
        }
    }

    for (const path of selected) {
        addUniquePath(expanded, seen, path)
    }

    return expanded
}
