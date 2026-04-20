export type GlobalColorAdjustTarget =
    | 'materialLayers'
    | 'geosetAnimations'
    | 'textures'
    | 'particles'
    | 'ribbons'
    | 'lights'

export type GlobalColorAdjustTargets = Record<GlobalColorAdjustTarget, boolean>

export interface GlobalColorAdjustSettings {
    hue: number
    brightness: number
    saturation: number
    opacity: number
    colorize: boolean
    targets: GlobalColorAdjustTargets
}

export const DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS: GlobalColorAdjustTargets = {
    materialLayers: true,
    geosetAnimations: true,
    textures: true,
    particles: true,
    ribbons: true,
    lights: true,
}

export const DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS: GlobalColorAdjustSettings = {
    hue: 0,
    brightness: 100,
    saturation: 100,
    opacity: 100,
    colorize: false,
    targets: DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS,
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const normalizeGlobalColorAdjustSettings = (value: Partial<GlobalColorAdjustSettings> | null | undefined): GlobalColorAdjustSettings => ({
    hue: clamp(Number(value?.hue ?? DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.hue), -180, 180),
    brightness: clamp(Number(value?.brightness ?? DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.brightness), 0, 200),
    saturation: clamp(Number(value?.saturation ?? DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.saturation), 0, 200),
    opacity: clamp(Number(value?.opacity ?? DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.opacity), 0, 200),
    colorize: Boolean(value?.colorize ?? DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.colorize),
    targets: {
        materialLayers: value?.targets?.materialLayers ?? DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS.materialLayers,
        geosetAnimations: value?.targets?.geosetAnimations ?? DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS.geosetAnimations,
        textures: value?.targets?.textures ?? DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS.textures,
        particles: value?.targets?.particles ?? DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS.particles,
        ribbons: value?.targets?.ribbons ?? DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS.ribbons,
        lights: value?.targets?.lights ?? DEFAULT_GLOBAL_COLOR_ADJUST_TARGETS.lights,
    },
})

export const hasSelectedGlobalColorAdjustTargets = (settings: GlobalColorAdjustSettings): boolean =>
    Object.values(settings.targets).some(Boolean)

export const isDefaultGlobalColorAdjustSettings = (settings: GlobalColorAdjustSettings): boolean =>
    settings.hue === DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.hue &&
    settings.brightness === DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.brightness &&
    settings.saturation === DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.saturation &&
    settings.opacity === DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.opacity &&
    settings.colorize === DEFAULT_GLOBAL_COLOR_ADJUST_SETTINGS.colorize

export const hasActiveGlobalColorAdjustSettings = (settings: GlobalColorAdjustSettings): boolean =>
    hasSelectedGlobalColorAdjustTargets(settings) && !isDefaultGlobalColorAdjustSettings(settings)

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min

    if (d === 0) return [0, 0, l]

    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h = 0
    switch (max) {
        case r:
            h = (g - b) / d + (g < b ? 6 : 0)
            break
        case g:
            h = (b - r) / d + 2
            break
        default:
            h = (r - g) / d + 4
            break
    }
    return [h / 6, s, l]
}

const hue2rgb = (p: number, q: number, t: number): number => {
    let value = t
    if (value < 0) value += 1
    if (value > 1) value -= 1
    if (value < 1 / 6) return p + (q - p) * 6 * value
    if (value < 1 / 2) return q
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6
    return p
}

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    if (s === 0) return [l, l, l]
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    return [
        clamp(hue2rgb(p, q, h + 1 / 3), 0, 1),
        clamp(hue2rgb(p, q, h), 0, 1),
        clamp(hue2rgb(p, q, h - 1 / 3), 0, 1),
    ]
}

const hsvToRgb = (h: number, s: number, v: number): [number, number, number] => {
    const i = Math.floor(h * 6)
    const f = h * 6 - i
    const p = v * (1 - s)
    const q = v * (1 - f * s)
    const t = v * (1 - (1 - f) * s)
    switch (i % 6) {
        case 0: return [v, t, p]
        case 1: return [q, v, p]
        case 2: return [p, v, t]
        case 3: return [p, q, v]
        case 4: return [t, p, v]
        default: return [v, p, q]
    }
}

export const adjustNormalizedRgb = (
    rgb: readonly number[],
    settings: GlobalColorAdjustSettings
): [number, number, number] => {
    const hueShift = settings.hue / 360
    const saturationScale = settings.saturation / 100
    const brightnessScale = settings.brightness / 100
    const [r, g, b] = [clamp(Number(rgb[0] ?? 0), 0, 1), clamp(Number(rgb[1] ?? 0), 0, 1), clamp(Number(rgb[2] ?? 0), 0, 1)]

    if (settings.colorize) {
        let hue = hueShift
        if (hue < 0) hue += 1
        const saturation = clamp(settings.saturation / 100, 0, 1)
        const value = clamp(Math.max(r, g, b) * brightnessScale, 0, 1)
        return hsvToRgb(hue, saturation, value)
    }

    const [h0, s0, l0] = rgbToHsl(r, g, b)
    let hue = h0 + hueShift
    if (hue < 0) hue += 1
    if (hue > 1) hue -= 1
    const saturation = clamp(s0 * saturationScale, 0, 1)
    const lightness = clamp(l0 * brightnessScale, 0, 1)
    return hslToRgb(hue, saturation, lightness)
}

export const scaleUnitOpacity = (value: number, settings: GlobalColorAdjustSettings): number =>
    clamp(Number(value || 0) * (settings.opacity / 100), 0, 1)

export const scaleByteOpacity = (value: number, settings: GlobalColorAdjustSettings): number =>
    clamp(Math.round(Number(value || 0) * (settings.opacity / 100)), 0, 255)

export const scaleBrightness = (value: number, settings: GlobalColorAdjustSettings): number =>
    Math.max(0, Number(value || 0) * (settings.brightness / 100))
