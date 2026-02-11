import { mat4 } from 'gl-matrix';
import { Scene } from './scene';
import { ModelRenderer } from './modelRenderer';
import { ModelInstance } from './modelInstance';
import { Model } from '../model';

export class BatchRenderer {
    private modelRenderers: Map<Model, ModelRenderer> = new Map();

    constructor(public gl: WebGLRenderingContext | WebGL2RenderingContext) {
    }

    public render(scene: Scene, pMatrix: mat4, viewMatrix: mat4, options: {
        wireframe?: boolean;
        env?: boolean;
        levelOfDetail?: number;
        useEnvironmentMap?: boolean;
        shadowMapTexture?: WebGLTexture | GPUTexture;
        shadowMapMatrix?: mat4;
        shadowBias?: number;
        shadowSmoothingStep?: number;
        depthTextureTarget?: GPUTexture;
    }) {
        // Group instances by model
        const instancesByModel = new Map<Model, ModelInstance[]>();
        for (const instance of scene.getInstances()) {
            const model = instance.model;
            if (!instancesByModel.has(model)) {
                instancesByModel.set(model, []);
            }
            instancesByModel.get(model)!.push(instance);
        }

        // Render each group
        instancesByModel.forEach((instances, model) => {
            let renderer = this.modelRenderers.get(model);
            if (!renderer) {
                renderer = new ModelRenderer(model);
                renderer.initGL(this.gl);
                this.modelRenderers.set(model, renderer);
            }

            // Render opaque geometry (batched)
            renderer.renderInstances(instances, viewMatrix, pMatrix, options);


        });
    }
}
