declare module 'war3-model' {
    export const parseMDX: any;
    export const parseMDL: any;
    export const generateMDX: any;
    export const generateMDL: any;
    export class ModelRenderer {
        constructor(model: any);
        initGL(gl: WebGLRenderingContext | WebGL2RenderingContext): void;
        render(mvMatrix: any, pMatrix: any, options?: any): void;
        update(delta: number): void;
        setCamera(pos: any, quat: any): void;
        destroy(): void;
        rendererData: any;
        model: any;
        setTextureImageData(path: string, data: ImageData[]): void;
        setReplaceableTexture(id: number, img: ImageBitmap): void;
        renderSkeleton(mvMatrix: any, pMatrix: any, options?: any): void;
        updateGeosetVertices(geosetIndex: number, vertices: any): void;
        raycast(origin: any, dir: any, mode: string): any;
    }
    export class ModelResourceManager {
        static getInstance(): ModelResourceManager;
        initGL(gl: WebGLRenderingContext | WebGL2RenderingContext): void;
        addGeosetBuffers(model: any, geosetIndex: number): void;
        updateGeosetTexCoords(model: any, geosetIndex: number, newTVertices: Float32Array): void;
    }
    export const decodeBLP: any;
    export const getBLPImageData: any;
}
