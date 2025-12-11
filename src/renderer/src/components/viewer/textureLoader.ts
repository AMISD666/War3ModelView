/**
 * textureLoader - Utility functions for loading model textures
 * Consolidates texture loading logic from Viewer.tsx
 */

// @ts-ignore
import { decodeBLP, getBLPImageData } from 'war3-model'
import { readFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'

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
 * Load a texture from MPQ archive
 */
export async function loadTextureFromMPQ(texturePath: string): Promise<ImageData | null> {
    try {
        const mpqData = await invoke<number[]>('read_mpq_file', { path: texturePath })

        if (mpqData && mpqData.length > 0) {
            const mpqBuffer = new Uint8Array(mpqData).buffer
            const blp = decodeBLP(mpqBuffer)
            const mipLevel0 = getBLPImageData(blp, 0)
            return new ImageData(
                new Uint8ClampedArray(mipLevel0.data),
                mipLevel0.width,
                mipLevel0.height
            )
        }
    } catch (e) {
        // MPQ loading failed
    }
    return null
}

/**
 * Load a texture from local file system
 */
export async function loadTextureFromFile(filePath: string): Promise<ImageData | null> {
    try {
        const texBuffer = await readFile(filePath)
        const blp = decodeBLP(texBuffer.buffer)
        const mipLevel0 = getBLPImageData(blp, 0)
        return new ImageData(
            new Uint8ClampedArray(mipLevel0.data),
            mipLevel0.width,
            mipLevel0.height
        )
    } catch (e) {
        // File loading failed
    }
    return null
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
 * Load a texture for a model renderer
 * Tries MPQ first for standard War3 paths, then falls back to local file system
 */
export async function loadTextureForRenderer(
    renderer: any,
    texturePath: string,
    modelPath: string
): Promise<boolean> {
    if (!texturePath) return false

    // Strategy 1: Try MPQ first for standard War3 paths
    if (isMPQPath(texturePath)) {
        const imageData = await loadTextureFromMPQ(texturePath)
        if (imageData && renderer.setTextureImageData) {
            renderer.setTextureImageData(texturePath, [imageData])
            return true
        }
    }

    // Strategy 2: Try local file system
    if (modelPath) {
        const candidates = getTextureCandidatePaths(modelPath, texturePath)

        for (const candidate of candidates) {
            const imageData = await loadTextureFromFile(candidate)
            if (imageData && renderer.setTextureImageData) {
                renderer.setTextureImageData(texturePath, [imageData])
                return true
            }
        }
    }

    console.warn(`[textureLoader] Failed to load texture: ${texturePath}`)
    return false
}

/**
 * Load all textures for a model
 */
export async function loadAllTextures(
    model: any,
    renderer: any,
    modelPath: string
): Promise<TextureLoadResult[]> {
    const results: TextureLoadResult[] = []

    if (!model.Textures) return results

    for (const texture of model.Textures) {
        const texturePath = texture.Image
        if (!texturePath) continue

        try {
            const loaded = await loadTextureForRenderer(renderer, texturePath, modelPath)
            results.push({ path: texturePath, loaded })
        } catch (e: any) {
            results.push({ path: texturePath, loaded: false, error: e.message })
        }
    }

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

    const loadReplaceable = async (path: string, id: number) => {
        const imageData = await loadTextureFromMPQ(path)
        if (imageData) {
            // Create a canvas to get ImageBitmap
            const texCanvas = document.createElement('canvas')
            texCanvas.width = imageData.width
            texCanvas.height = imageData.height
            const ctx = texCanvas.getContext('2d')
            if (ctx) {
                ctx.putImageData(imageData, 0, 0)
                const img = await createImageBitmap(texCanvas)
                if (renderer.setReplaceableTexture) {
                    renderer.setReplaceableTexture(id, img)
                }
            }
        }
    }

    await loadReplaceable(teamColorPath, 1)
    await loadReplaceable(teamGlowPath, 2)
}
