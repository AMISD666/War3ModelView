import { debugLog as writeDebugLog } from './debugLog'

export async function debugLog(message: string, color?: 'green' | 'red'): Promise<void> {
    await writeDebugLog(color ? `[${color}] ${message}` : message)
}

export async function logModelInfo(
    modelPath: string,
    model: any,
    parseTime: number
): Promise<void> {
    await writeDebugLog(`[Model] parsed ${modelPath} in ${parseTime.toFixed(1)}ms sequences=${model?.Sequences?.length ?? 0} geosets=${model?.Geosets?.length ?? 0} nodes=${model?.Nodes?.length ?? 0}`)
}

export async function logTextureInfo(
    textures: { path: string; loaded: boolean; time?: number }[]
): Promise<void> {
    await writeDebugLog(`[Textures] ${textures.map((texture) => `${texture.loaded ? 'ok' : 'fail'}:${texture.path}${texture.time ? `(${texture.time.toFixed(1)}ms)` : ''}`).join(', ')}`)
}

export async function logTextureLoadComplete(
    totalTextures: number,
    loadedCount: number,
    totalTime: number
): Promise<void> {
    await writeDebugLog(`[Textures] complete ${loadedCount}/${totalTextures} in ${totalTime.toFixed(1)}ms`)
}
