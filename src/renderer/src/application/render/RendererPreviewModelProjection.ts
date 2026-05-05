import type { Geoset } from '../../types/geoset'
import type { ModelData } from '../../types/model'

type RendererPreviewModel = ModelData & Record<string, unknown>
type GeosetWithOptionalSkinWeights = Geoset & { SkinWeights?: unknown }

const hasSkinWeights = (geoset: unknown): geoset is { SkinWeights: unknown } =>
    !!geoset
    && typeof geoset === 'object'
    && (
        Array.isArray((geoset as { SkinWeights?: unknown }).SkinWeights)
        || ArrayBuffer.isView((geoset as { SkinWeights?: unknown }).SkinWeights)
    )

export const projectModelForRealtimeRenderer = <T extends RendererPreviewModel | null | undefined>(model: T): T => {
    if (!model || !Array.isArray(model.Geosets) || !model.Geosets.some(hasSkinWeights)) {
        return model
    }

    return {
        ...model,
        Geosets: model.Geosets.map((geoset) => {
            if (!hasSkinWeights(geoset)) {
                return geoset
            }
            const { SkinWeights: _skinWeights, ...previewGeoset } = geoset as GeosetWithOptionalSkinWeights
            return previewGeoset
        }),
    }
}
