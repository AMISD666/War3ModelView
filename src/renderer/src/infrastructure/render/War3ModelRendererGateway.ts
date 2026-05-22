import { ModelRenderer, ModelResourceManager } from 'war3-model'

export type War3ModelRenderer = InstanceType<typeof ModelRenderer>
type War3ModelRendererModel = ConstructorParameters<typeof ModelRenderer>[0]

export const createWar3ModelRenderer = (model: unknown): War3ModelRenderer =>
    new ModelRenderer(model as War3ModelRendererModel)

export const addWar3GeosetBuffers = (model: unknown, geosetIndex: number): void => {
    ModelResourceManager.getInstance().addGeosetBuffers(model as War3ModelRendererModel, geosetIndex)
}

export const rebuildWar3GeosetBuffers = (renderer: War3ModelRenderer): void => {
    const rendererWithRebuild = renderer as War3ModelRenderer & { rebuildGeosetBuffers?: () => void }
    if (typeof rendererWithRebuild.rebuildGeosetBuffers === 'function') {
        rendererWithRebuild.rebuildGeosetBuffers()
        return
    }

    renderer.model?.Geosets?.forEach((_geoset, geosetIndex) => {
        ModelResourceManager.getInstance().addGeosetBuffers(renderer.model, geosetIndex)
    })
}
