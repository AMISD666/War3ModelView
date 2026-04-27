import { ModelRenderer, ModelResourceManager } from 'war3-model'

export type War3ModelRenderer = InstanceType<typeof ModelRenderer>
type War3ModelRendererModel = ConstructorParameters<typeof ModelRenderer>[0]

export const createWar3ModelRenderer = (model: unknown): War3ModelRenderer =>
    new ModelRenderer(model as War3ModelRendererModel)

export const addWar3GeosetBuffers = (model: unknown, geosetIndex: number): void => {
    ModelResourceManager.getInstance().addGeosetBuffers(model as War3ModelRendererModel, geosetIndex)
}
