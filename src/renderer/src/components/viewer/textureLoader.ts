/**
 * textureLoader - Utility for loading model textures
 * Uses JS-side BLP decoding via decodeBLP
 */

import { invoke } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
import { logTextureInfo, logTextureLoadComplete } from '../../utils/debugLogger'
import { decodeBLP, getBLPImageData } from 'war3-model'

export interface TextureLoadResult {
    path: string
    loaded: boolean
    error?: string
}

/**
 * Normalize path separators to backslashes
 */
function normalizePath(p: string): string {
    return p.replace(/\//g, '\\')
}

/**
 * Check if a path looks like a standard War3 MPQ path
 */
function isMPQPath(path: string): boolean {
    return /^(Textures|UI|ReplaceableTextures|Units|Buildings|Doodads|Environment)[\\\/]/i.test(path)
}

/**
 * Generate candidate paths for a texture relative to the model directory
 */
export function getTextureCandidatePaths(modelPath: string, texturePath: string): string[] {
    const textureRelPath = normalizePath(texturePath)
    const modelDir = normalizePath(modelPath.substring(0, modelPath.lastIndexOf('\\')))

    const candidates: string[] = []

    // Primary: model dir + texture relative path
    candidates.push(`${modelDir}\\${textureRelPath}`)

    // Fallback: just filename in model dir
    const filename = textureRelPath.split('\\').pop() || ''
    if (filename !== textureRelPath) {
        candidates.push(`${modelDir}\\${filename}`)
    }

    // Try parent directories (up to 3 levels)
    let currentDir = modelDir
    for (let depth = 0; depth < 3; depth++) {
        const lastSlash = currentDir.lastIndexOf('\\')
        if (lastSlash === -1) break
        currentDir = currentDir.substring(0, lastSlash)
        candidates.push(`${currentDir}\\${textureRelPath}`)
    }

    return candidates
}

/**
 * Load a single texture using JS-based BLP decoding
 */
async function loadSingleTexture(
    renderer: any,
    logicalPath: string,
    modelPath: string
): Promise<boolean> {
    // Determine candidates to try
    let candidates: string[]
    if (isMPQPath(logicalPath)) {
        candidates = [logicalPath]
    } else {
        candidates = getTextureCandidatePaths(modelPath, logicalPath)
    }

    for (const candidatePath of candidates) {
        try {
            // Try MPQ first
            let buffer: Uint8Array | null = null
            try {
                const mpqData = await invoke<number[]>('read_mpq_file', { path: candidatePath })
                if (mpqData) {
                    buffer = new Uint8Array(mpqData)
                }
            } catch {
                // MPQ read failed, try local file
            }

            // Try local file if MPQ failed
            if (!buffer) {
                try {
                    // Use Tauri FS plugin to read local file
                    const localData = await readFile(candidatePath)
                    if (localData) {
                        buffer = localData
                    }
                } catch {
                    // Local file read also failed
                }
            }

            if (!buffer) continue

            // Decode BLP using JS
            const lower = candidatePath.toLowerCase()
            if (lower.endsWith('.blp')) {
                const blp = decodeBLP(buffer.buffer)
                const imageData = getBLPImageData(blp, 0)

                // Create canvas and upload to renderer
                const texCanvas = document.createElement('canvas')
                texCanvas.width = imageData.width
                texCanvas.height = imageData.height
                const ctx = texCanvas.getContext('2d')
                if (ctx) {
                    const idata = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
                    ctx.putImageData(idata, 0, 0)
                    const img = await createImageBitmap(texCanvas)
                    renderer.setTextureImage(logicalPath, img)
                    return true
                }
            } else if (lower.endsWith('.tga')) {
                // For TGA, create a blob and load as image
                const blob = new Blob([buffer], { type: 'image/tga' })
                const url = URL.createObjectURL(blob)
                try {
                    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                        const image = new Image()
                        image.onload = () => resolve(image)
                        image.onerror = reject
                        image.src = url
                    })
                    renderer.setTextureImage(logicalPath, img)
                    return true
                } finally {
                    URL.revokeObjectURL(url)
                }
            }
        } catch (e) {
            // This candidate failed, try next
        }
    }

    return false
}

/**
 * Load all textures for a model using JS-based BLP decoding
 */
export async function loadAllTextures(
    model: any,
    renderer: any,
    modelPath: string
): Promise<TextureLoadResult[]> {
    console.time('[Viewer] Texture Load')
    const batchStart = performance.now()
    const results: TextureLoadResult[] = []

    if (!model.Textures) {
        console.timeEnd('[Viewer] Texture Load')
        return results
    }

    const texturePaths = model.Textures
        .filter((texture: any) => texture.Image)
        .map((texture: any) => texture.Image as string)

    if (texturePaths.length === 0) {
        console.timeEnd('[Viewer] Texture Load')
        return results
    }

    // Load textures in parallel
    const loadPromises = texturePaths.map(async (logicalPath: string) => {
        const loaded = await loadSingleTexture(renderer, logicalPath, modelPath)
        return { path: logicalPath, loaded, error: loaded ? undefined : 'Not found' }
    })

    const loadResults = await Promise.all(loadPromises)
    results.push(...loadResults)

    // Log results
    const textureResults = results.map((r) => ({
        path: r.path,
        loaded: r.loaded,
        time: undefined
    }))
    await logTextureInfo(textureResults)
    const loadedCount = results.filter(r => r.loaded).length
    await logTextureLoadComplete(texturePaths.length, loadedCount, performance.now() - batchStart)

    console.timeEnd('[Viewer] Texture Load')
    return results
}

/**
 * Load team color textures (replaceable textures 1 and 2)
 */
export async function loadTeamColorTextures(
    renderer: any,
    colorIndex: number
): Promise<void> {
    if (!renderer) return

    const idStr = colorIndex.toString().padStart(2, '0')
    const teamColorPath = `ReplaceableTextures\\TeamColor\\TeamColor${idStr}.blp`
    const teamGlowPath = `ReplaceableTextures\\TeamGlow\\TeamGlow${idStr}.blp`

    const loadTexture = async (path: string, id: number) => {
        try {
            const mpqData = await invoke<number[]>('read_mpq_file', { path }).catch(() => null)
            if (mpqData) {
                const buffer = new Uint8Array(mpqData)
                const blp = decodeBLP(buffer.buffer)
                const imageData = getBLPImageData(blp, 0)

                const texCanvas = document.createElement('canvas')
                texCanvas.width = imageData.width
                texCanvas.height = imageData.height
                const ctx = texCanvas.getContext('2d')
                if (ctx) {
                    const idata = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
                    ctx.putImageData(idata, 0, 0)
                    const img = await createImageBitmap(texCanvas)
                    if (renderer.setReplaceableTexture) {
                        renderer.setReplaceableTexture(id, img)
                    }
                }
            }
        } catch (e) {
            console.warn(`[Viewer] Failed to load team color texture: ${path}`, e)
        }
    }

    await loadTexture(teamColorPath, 1)
    await loadTexture(teamGlowPath, 2)
}

/**
 * Load a single texture for the renderer
 */
export async function loadTextureForRenderer(
    renderer: any,
    texturePath: string,
    modelPath: string
): Promise<boolean> {
    if (!texturePath) return false
    return loadSingleTexture(renderer, texturePath, modelPath)
}
