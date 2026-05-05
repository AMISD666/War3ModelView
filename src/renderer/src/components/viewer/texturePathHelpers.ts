/** Texture path helpers for War3 model texture loading. */

import {
    normalizeTextureAdjustments,
    TEXTURE_ADJUSTMENTS_KEY,
    TextureAdjustments
} from '../../utils/textureAdjustments'

/**
 * Normalize path separators to backslashes
 */
export function normalizePath(p: string): string {
    if (!p) return ''
    let out = p.replace(/\0/g, '').trim()
    out = out.replace(/\//g, '\\')
    if (out.startsWith('.\\')) {
        out = out.slice(2)
    }
    if (!out.startsWith('\\\\')) {
        while (out.startsWith('\\')) {
            out = out.slice(1)
        }
    }
    out = out.replace(/\\\\+/g, '\\')
    return out
}

const MPQ_PATH_PREFIXES = [
    'Abilities',
    'BattleNet',
    'Buildings',
    'Characters',
    'Doodads',
    'Environment',
    'Font',
    'Fonts',
    'Maps',
    'Objects',
    'PathTextures',
    'ReplaceableTextures',
    'Scripts',
    'SharedModels',
    'Sound',
    'Splats',
    'SpawnedEffects',
    'TerrainArt',
    'Textures',
    'UI',
    'Units',
]

const MPQ_PATH_REGEX = new RegExp(`^(${MPQ_PATH_PREFIXES.join('|')})[\\\\/]`, 'i')

export const REPLACEABLE_TEXTURES: Record<number, string> = {
    1: 'TeamColor\\TeamColor00',
    2: 'TeamGlow\\TeamGlow00',
    11: 'Cliff\\Cliff0',
    21: '', // Used by cursors
    31: 'LordaeronTree\\LordaeronSummerTree',
    32: 'AshenvaleTree\\AshenTree',
    33: 'BarrensTree\\BarrensTree',
    34: 'NorthrendTree\\NorthTree',
    35: 'Mushroom\\MushroomTree',
    36: 'RuinsTree\\RuinsTree',
    37: 'OutlandMushroomTree\\MushroomTree',
}

export function isMPQPath(path: string): boolean {
    return MPQ_PATH_REGEX.test(path)
}

function isAbsoluteTexturePath(path: string): boolean {
    return /^[a-zA-Z]:\\/.test(path) || path.startsWith('\\\\')
}

/**
 * Generate candidate paths for a texture relative to the model directory
 */
export function getTextureCandidatePaths(modelPath: string, texturePath: string): string[] {
    const textureRelPath = normalizePath(texturePath)
    if (isAbsoluteTexturePath(textureRelPath)) {
        return [textureRelPath]
    }

    const normalizedModelPath = normalizePath(modelPath)
    const lastSlash = normalizedModelPath.lastIndexOf('\\')
    const modelDir = lastSlash >= 0 ? normalizedModelPath.substring(0, lastSlash) : normalizedModelPath

    const candidates: string[] = []

    candidates.push(`${modelDir}\\${textureRelPath}`)

    const filename = textureRelPath.split('\\').pop() || ''
    if (filename !== textureRelPath) {
        candidates.push(`${modelDir}\\${filename}`)
    }

    let currentDir = modelDir
    while (true) {
        const lastSlash = currentDir.lastIndexOf('\\')
        if (lastSlash === -1) break
        currentDir = currentDir.substring(0, lastSlash)
        if (currentDir === '' || currentDir.endsWith(':')) {
            candidates.push(`${currentDir}\\${textureRelPath}`)
            break
        }
        candidates.push(`${currentDir}\\${textureRelPath}`)
    }

    return Array.from(new Set(candidates))
}

/** 与 loadAllTextures 内部一致的贴图加载上下文，供 Viewer 在创建渲染器前预取 Rust 批量读取 */
export type TextureLoadContext = {
    effectiveTexturePaths: string[]
    alphaRequiredTexturePaths: Set<string>
    textureAdjustmentsByPath: Map<string, TextureAdjustments>
}

/**
 * 解析 Replaceable、收集路径与 Alpha 需求（会修改 model 上的贴图路径）
 * 与 loadAllTextures 首段逻辑保持一致
 */
export function prepareModelForTextureLoad(
    model: any,
    options?: { targetPaths?: string[] }
): TextureLoadContext {
    const empty: TextureLoadContext = {
        effectiveTexturePaths: [],
        alphaRequiredTexturePaths: new Set<string>(),
        textureAdjustmentsByPath: new Map<string, TextureAdjustments>()
    }
    if (!model?.Textures) {
        return empty
    }

    model.Textures.forEach((texture: any) => {
        if ((!texture.Image || texture.Image === '') && texture.ReplaceableId !== 0) {
            const replaceablePath = REPLACEABLE_TEXTURES[texture.ReplaceableId]
            if (replaceablePath !== undefined) {
                texture.Image = `ReplaceableTextures\\${replaceablePath}.blp`
            }
        }
    })

    const texturePaths = new Set<string>(
        model.Textures.map((texture: any) => texture.Image as string).filter((path: string) => !!path)
    )

    if (model.ParticleEmitters) {
        model.ParticleEmitters.forEach((emitter: any) => {
            if (emitter.FileName && typeof emitter.FileName === 'string') {
                texturePaths.add(emitter.FileName)
            }
        })
    }

    if (model.ParticleEmitters2) {
        model.ParticleEmitters2.forEach((emitter: any) => {
            if (emitter.ReplaceableId > 0 && (emitter.TextureID === -1 || emitter.TextureID === undefined)) {
                const replaceablePath = REPLACEABLE_TEXTURES[emitter.ReplaceableId]
                if (replaceablePath !== undefined) {
                    const fullPath = `ReplaceableTextures\\${replaceablePath}.blp`
                    texturePaths.add(fullPath)
                }
            }
        })
    }

    const uniqueTexturePaths: string[] = Array.from(texturePaths)
    if (uniqueTexturePaths.length === 0) {
        return empty
    }

    const targetPathSet = new Set((options?.targetPaths || []).filter(Boolean))
    const hasTargetPaths = targetPathSet.size > 0
    let effectiveTexturePaths: string[] = uniqueTexturePaths
    if (hasTargetPaths) {
        const fromModel = uniqueTexturePaths.filter((path) => targetPathSet.has(path))
        const extras = Array.from(targetPathSet).filter((path) => !fromModel.includes(path))
        effectiveTexturePaths = [...fromModel, ...extras]
    }
    if (effectiveTexturePaths.length === 0) {
        return empty
    }

    const alphaRequiredTexturePaths = new Set<string>()

    if (model.Materials) {
        model.Materials.forEach((material: any) => {
            if (material.Layers) {
                material.Layers.forEach((layer: any) => {
                    if (layer.FilterMode > 0 && layer.TextureID !== undefined && model.Textures[layer.TextureID]) {
                        const img = model.Textures[layer.TextureID].Image
                        if (img) alphaRequiredTexturePaths.add(img)
                    }
                })
            }
        })
    }

    if (model.ParticleEmitters2) {
        model.ParticleEmitters2.forEach((emitter: any) => {
            if (emitter.TextureID !== undefined && model.Textures[emitter.TextureID]) {
                const img = model.Textures[emitter.TextureID].Image
                if (img) alphaRequiredTexturePaths.add(img)
            }
        })
    }

    if (model.ParticleEmitters) {
        model.ParticleEmitters.forEach((emitter: any) => {
            if (emitter.FileName && typeof emitter.FileName === 'string') {
                alphaRequiredTexturePaths.add(emitter.FileName)
            }
        })
    }

    const textureAdjustmentsByPath = new Map<string, TextureAdjustments>()
    if (Array.isArray(model.Textures)) {
        for (const texture of model.Textures) {
            const texturePath = texture?.Image
            if (!texturePath || textureAdjustmentsByPath.has(texturePath)) continue
            const raw = texture?.[TEXTURE_ADJUSTMENTS_KEY]
            if (!raw) continue
            textureAdjustmentsByPath.set(texturePath, normalizeTextureAdjustments(raw))
        }
    }

    return {
        effectiveTexturePaths,
        alphaRequiredTexturePaths,
        textureAdjustmentsByPath
    }
}
