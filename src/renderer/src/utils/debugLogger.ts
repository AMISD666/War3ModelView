export async function debugLog(_message: string, _color?: 'green' | 'red'): Promise<void> {
    return
}

export async function logModelInfo(
    _modelPath: string,
    _model: any,
    _parseTime: number
): Promise<void> {
    return
}

export async function logTextureInfo(
    _textures: { path: string; loaded: boolean; time?: number }[]
): Promise<void> {
    return
}

export async function logTextureLoadComplete(
    _totalTextures: number,
    _loadedCount: number,
    _totalTime: number
): Promise<void> {
    return
}
