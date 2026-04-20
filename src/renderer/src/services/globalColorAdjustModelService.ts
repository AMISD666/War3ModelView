import { cloneStructured } from '../utils/materialTextureRelations'
import type { ModelData } from '../types/model'
import type { ModelNode } from '../types/node'
import { NodeType } from '../types/node'
import { TEXTURE_ADJUSTMENTS_KEY, type TextureAdjustments } from '../utils/textureAdjustments'
import {
    adjustNormalizedRgb,
    hasActiveGlobalColorAdjustSettings,
    scaleBrightness,
    scaleByteOpacity,
    scaleUnitOpacity,
    type GlobalColorAdjustSettings,
} from '../utils/globalColorAdjustCore'

const isAnimVector = (value: unknown): value is { Keys: any[] } =>
    !!value && typeof value === 'object' && Array.isArray((value as { Keys?: unknown[] }).Keys)

const mapVectorLike = (value: any, mapper: (input: number[]) => number[]): any => {
    const source = ArrayBuffer.isView(value)
        ? Array.from(value as unknown as ArrayLike<number>)
        : Array.isArray(value)
            ? [...value]
            : [Number(value ?? 0)]
    const mapped = mapper(source)
    if (ArrayBuffer.isView(value)) {
        const ctor = (value as unknown as { constructor: new (items: number[]) => ArrayLike<number> }).constructor
        return new ctor(mapped)
    }
    return mapped
}

const transformAnimVector = (value: any, mapper: (input: number[]) => number[]): any => {
    if (!isAnimVector(value)) return value
    return {
        ...value,
        Keys: value.Keys.map((key: any) => ({
            ...key,
            ...(key.Vector !== undefined ? { Vector: mapVectorLike(key.Vector, mapper) } : {}),
            ...(key.Value !== undefined ? { Value: mapVectorLike(key.Value, mapper) } : {}),
            ...(key.InTan !== undefined ? { InTan: mapVectorLike(key.InTan, mapper) } : {}),
            ...(key.OutTan !== undefined ? { OutTan: mapVectorLike(key.OutTan, mapper) } : {}),
        })),
    }
}

const transformColorField = (holder: Record<string, any>, key: string, settings: GlobalColorAdjustSettings) => {
    const current = holder[key]
    if (isAnimVector(current)) {
        holder[key] = transformAnimVector(current, (input) => adjustNormalizedRgb(input, settings))
        return
    }
    if (Array.isArray(current) || ArrayBuffer.isView(current)) {
        holder[key] = mapVectorLike(current, (input) => adjustNormalizedRgb(input, settings))
    }
}

const transformUnitScalarField = (holder: Record<string, any>, key: string, settings: GlobalColorAdjustSettings) => {
    const current = holder[key]
    if (isAnimVector(current)) {
        holder[key] = transformAnimVector(current, (input) => [scaleUnitOpacity(Number(input[0] ?? 0), settings)])
        return
    }
    if (typeof current === 'number') {
        holder[key] = scaleUnitOpacity(current, settings)
    }
}

const transformByteTripletField = (holder: Record<string, any>, key: string, settings: GlobalColorAdjustSettings) => {
    const current = holder[key]
    if (Array.isArray(current) || ArrayBuffer.isView(current)) {
        holder[key] = mapVectorLike(current, (input) => input.map((item) => scaleByteOpacity(Number(item), settings)))
    }
}

const transformBrightnessScalarField = (holder: Record<string, any>, key: string, settings: GlobalColorAdjustSettings) => {
    const current = holder[key]
    if (isAnimVector(current)) {
        holder[key] = transformAnimVector(current, (input) => [scaleBrightness(Number(input[0] ?? 0), settings)])
        return
    }
    if (typeof current === 'number') {
        holder[key] = scaleBrightness(current, settings)
    }
}

const toTextureAdjustments = (settings: GlobalColorAdjustSettings): TextureAdjustments => ({
    hue: settings.hue,
    brightness: settings.brightness,
    saturation: settings.saturation,
    opacity: settings.opacity,
    colorize: settings.colorize,
})

const transformSegmentColors = (node: Record<string, any>, settings: GlobalColorAdjustSettings) => {
    if (!Array.isArray(node.SegmentColor)) return
    node.SegmentColor = node.SegmentColor.map((segment: any) =>
        mapVectorLike(segment, (input) => adjustNormalizedRgb(input, settings))
    )
}

const applyNodeAdjustments = (node: Record<string, any>, settings: GlobalColorAdjustSettings) => {
    switch (node.type) {
        case NodeType.LIGHT:
            transformColorField(node, 'Color', settings)
            transformColorField(node, 'AmbientColor', settings)
            transformColorField(node, 'AmbColor', settings)
            transformBrightnessScalarField(node, 'Intensity', settings)
            transformBrightnessScalarField(node, 'AmbientIntensity', settings)
            transformBrightnessScalarField(node, 'AmbIntensity', settings)
            transformUnitScalarField(node, 'Visibility', settings)
            break
        case NodeType.RIBBON_EMITTER:
            transformColorField(node, 'Color', settings)
            transformUnitScalarField(node, 'Alpha', settings)
            transformUnitScalarField(node, 'Visibility', settings)
            break
        case NodeType.PARTICLE_EMITTER:
            transformColorField(node, 'Color', settings)
            transformUnitScalarField(node, 'Visibility', settings)
            break
        case NodeType.PARTICLE_EMITTER_2:
            transformColorField(node, 'Color', settings)
            transformSegmentColors(node, settings)
            transformByteTripletField(node, 'Alpha', settings)
            transformUnitScalarField(node, 'Visibility', settings)
            break
        case NodeType.PARTICLE_EMITTER_POPCORN:
            transformColorField(node, 'Color', settings)
            transformUnitScalarField(node, 'Alpha', settings)
            transformUnitScalarField(node, 'Visibility', settings)
            break
        default:
            break
    }
}

const applyModelAdjustmentsInPlace = (model: Record<string, any>, settings: GlobalColorAdjustSettings) => {
    if (settings.targets.materialLayers && Array.isArray(model.Materials)) {
        model.Materials = model.Materials.map((material: Record<string, any>) => ({
            ...material,
            Layers: Array.isArray(material?.Layers)
                ? material.Layers.map((layer: Record<string, any>) => {
                    const nextLayer = { ...layer }
                    transformUnitScalarField(nextLayer, 'Alpha', settings)
                    transformColorField(nextLayer, 'FresnelColor', settings)
                    transformUnitScalarField(nextLayer, 'FresnelOpacity', settings)
                    transformBrightnessScalarField(nextLayer, 'EmissiveGain', settings)
                    return nextLayer
                })
                : material?.Layers,
        }))
    }

    if (settings.targets.textures && Array.isArray(model.Textures)) {
        const adjustments = toTextureAdjustments(settings)
        model.Textures = model.Textures.map((texture: Record<string, any>) => {
            if (!texture || typeof texture !== 'object' || typeof texture.Image !== 'string' || texture.Image.length === 0) {
                return texture
            }
            return {
                ...texture,
                [TEXTURE_ADJUSTMENTS_KEY]: adjustments,
            }
        })
    }

    if (settings.targets.geosetAnimations && Array.isArray(model.GeosetAnims)) {
        model.GeosetAnims = model.GeosetAnims.map((anim: Record<string, any>) => {
            const nextAnim = { ...anim }
            transformColorField(nextAnim, 'Color', settings)
            transformUnitScalarField(nextAnim, 'Alpha', settings)
            return nextAnim
        })
    }

    if (settings.targets.lights && Array.isArray(model.Lights)) {
        model.Lights = model.Lights.map((light: Record<string, any>) => {
            const nextLight = { ...light, type: NodeType.LIGHT } as Record<string, any>
            applyNodeAdjustments(nextLight, settings)
            const { type: _type, ...rest } = nextLight
            void _type
            return rest
        })
    }

    if (settings.targets.ribbons && Array.isArray(model.RibbonEmitters)) {
        model.RibbonEmitters = model.RibbonEmitters.map((ribbon: Record<string, any>) => {
            const nextRibbon = { ...ribbon, type: NodeType.RIBBON_EMITTER } as Record<string, any>
            applyNodeAdjustments(nextRibbon, settings)
            const { type: _type, ...rest } = nextRibbon
            void _type
            return rest
        })
    }

    if (settings.targets.particles) {
        if (Array.isArray(model.ParticleEmitters)) {
            model.ParticleEmitters = model.ParticleEmitters.map((emitter: Record<string, any>) => {
                const nextEmitter = { ...emitter, type: NodeType.PARTICLE_EMITTER } as Record<string, any>
                applyNodeAdjustments(nextEmitter, settings)
                const { type: _type, ...rest } = nextEmitter
                void _type
                return rest
            })
        }
        if (Array.isArray(model.ParticleEmitters2)) {
            model.ParticleEmitters2 = model.ParticleEmitters2.map((emitter: Record<string, any>) => {
                const nextEmitter = { ...emitter, type: NodeType.PARTICLE_EMITTER_2 } as Record<string, any>
                applyNodeAdjustments(nextEmitter, settings)
                const { type: _type, ...rest } = nextEmitter
                void _type
                return rest
            })
        }
        if (Array.isArray(model.ParticleEmitterPopcorns)) {
            model.ParticleEmitterPopcorns = model.ParticleEmitterPopcorns.map((emitter: Record<string, any>) => {
                const nextEmitter = { ...emitter, type: NodeType.PARTICLE_EMITTER_POPCORN } as Record<string, any>
                applyNodeAdjustments(nextEmitter, settings)
                const { type: _type, ...rest } = nextEmitter
                void _type
                return rest
            })
        }
    }

    if (Array.isArray(model.Nodes)) {
        model.Nodes = model.Nodes.map((node: Record<string, any>) => {
            const shouldAdjust =
                (settings.targets.lights && node.type === NodeType.LIGHT) ||
                (settings.targets.ribbons && node.type === NodeType.RIBBON_EMITTER) ||
                (settings.targets.particles && (
                    node.type === NodeType.PARTICLE_EMITTER ||
                    node.type === NodeType.PARTICLE_EMITTER_2 ||
                    node.type === NodeType.PARTICLE_EMITTER_POPCORN
                ))
            if (!shouldAdjust) return node
            const nextNode = { ...node }
            applyNodeAdjustments(nextNode, settings)
            return nextNode
        })
    }
}

export const applyGlobalColorAdjustmentsToModel = (
    modelData: ModelData | null,
    settings: GlobalColorAdjustSettings,
    options?: { forceFullReload?: boolean }
): ModelData | null => {
    if (!modelData || !hasActiveGlobalColorAdjustSettings(settings)) return modelData
    const cloned = cloneStructured(modelData) as ModelData
    applyModelAdjustmentsInPlace(cloned as unknown as Record<string, any>, settings)
    if (options?.forceFullReload) {
        ; (cloned as any).__forceFullReload = true
    }
    return cloned
}

export const applyGlobalColorAdjustmentsToNodes = (
    nodes: ModelNode[],
    settings: GlobalColorAdjustSettings
): ModelNode[] => {
    if (!hasActiveGlobalColorAdjustSettings(settings)) return nodes
    return nodes.map((node) => {
        const shouldAdjust =
            (settings.targets.lights && node.type === NodeType.LIGHT) ||
            (settings.targets.ribbons && node.type === NodeType.RIBBON_EMITTER) ||
            (settings.targets.particles && (
                node.type === NodeType.PARTICLE_EMITTER ||
                node.type === NodeType.PARTICLE_EMITTER_2 ||
                node.type === NodeType.PARTICLE_EMITTER_POPCORN
            ))
        if (!shouldAdjust) return node
        const nextNode = cloneStructured(node) as ModelNode
        applyNodeAdjustments(nextNode as unknown as Record<string, any>, settings)
        return nextNode
    })
}
