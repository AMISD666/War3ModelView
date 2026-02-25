/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

import type { DdsInfo } from 'dds-parser';
import {
    Model, Layer, LayerShading, FilterMode,
    TextureFlags
} from '../model';
import { vec3, quat, mat4, mat3 } from 'gl-matrix';
import { getShader, isWebGL2 } from './util';
import { ModelInterp } from './modelInterp';
import { RendererData, NodeWrapper, LightResult } from './rendererData';
import { ModelResourceManager } from './modelResourceManager';
import { ModelInstance } from './modelInstance';
import vertexShaderHardwareSkinningSource from './shaders/webgl/sdHardwareSkinning.vs.glsl?raw';
import vertexShaderSoftwareSkinning from './shaders/webgl/sdSoftwareSkinning.vs.glsl?raw';
import fragmentShader from './shaders/webgl/sd.fs.glsl?raw';
import vertexShaderHDHardwareSkinningOldSource from './shaders/webgl/hdHardwareSkinningOld.vs.glsl?raw';
import vertexShaderHDHardwareSkinningNewSource from './shaders/webgl/hdHardwareSkinningNew.vs.glsl?raw';
import fragmentShaderHDOld from './shaders/webgl/hdOld.fs.glsl?raw';
import fragmentShaderHDNewSource from './shaders/webgl/hdNew.fs.glsl?raw';
import skeletonVertexShader from './shaders/webgl/skeleton.vs.glsl?raw';
import skeletonFragmentShader from './shaders/webgl/skeleton.fs.glsl?raw';
import envToCubemapVertexShader from './shaders/webgl/envToCubemap.vs.glsl?raw';
import envToCubemapFragmentShader from './shaders/webgl/envToCubemap.fs.glsl?raw';
import envVertexShader from './shaders/webgl/env.vs.glsl?raw';
import envFragmentShader from './shaders/webgl/env.fs.glsl?raw';
import convoluteEnvDiffuseVertexShader from './shaders/webgl/convoluteEnvDiffuse.vs.glsl?raw';
import convoluteEnvDiffuseFragmentShader from './shaders/webgl/convoluteEnvDiffuse.fs.glsl?raw';
import prefilterEnvVertexShader from './shaders/webgl/prefilterEnv.vs.glsl?raw';
import prefilterEnvFragmentShader from './shaders/webgl/prefilterEnv.fs.glsl?raw';
import integrateBRDFVertexShader from './shaders/webgl/integrateBRDF.vs.glsl?raw';
import integrateBRDFFragmentShader from './shaders/webgl/integrateBRDF.fs.glsl?raw';
import sdShaderSource from './shaders/webgpu/sd.wgsl?raw';
import hdShaderSource from './shaders/webgpu/hd.wgsl?raw';
import depthShaderSource from './shaders/webgpu/depth.wgsl?raw';
import skeletonShaderSource from './shaders/webgpu/skeleton.wgsl?raw';
import envShader from './shaders/webgpu/env.wgsl?raw';
import envToCubemapShader from './shaders/webgpu/envToCubemap.wgsl?raw';
import convoluteEnvDiffuseShader from './shaders/webgpu/convoluteEnvDiffuse.wgsl?raw';
import prefilterEnvShader from './shaders/webgpu/prefilterEnv.wgsl?raw';
import integrateBRDFFShader from './shaders/webgpu/integrateBRDF.wgsl?raw';
import { generateMips } from './generateMips';

// actually, all is number
export type DDS_FORMAT = WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT1_EXT'] |
    WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT3_EXT'] |
    WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT5_EXT'] |
    WEBGL_compressed_texture_s3tc['COMPRESSED_RGB_S3TC_DXT1_EXT'];

// With texture skinning, we can now support many more bones
// The actual limit is determined by texture size (e.g., 256x256 = 16384 bones)
const MAX_NODES = 4096;

// Bone texture dimensions: each bone matrix requires 4 RGBA pixels (4x vec4 = mat4)
// For 4096 bones, we need 4096 * 4 = 16384 pixels
// Use 128x128 texture = 16384 pixels, or 256x64 = 16384 pixels
const BONE_TEXTURE_WIDTH = 256;
const BONE_TEXTURE_HEIGHT = 64;

const ENV_MAP_SIZE = 2048;
const ENV_CONVOLUTE_DIFFUSE_SIZE = 32;
const ENV_PREFILTER_SIZE = 128;
const MAX_ENV_MIP_LEVELS = 8;
const BRDF_LUT_SIZE = 512;

// Keep MSAA disabled for now to maximize pipeline compatibility across the app render pass.
// When re-enabling MSAA, every pipeline used in the same render pass must use the same sampleCount.
const MULTISAMPLE = 1;

const FILTER_MODES_WITH_DEPTH_WRITE = new Set([0, 1]);

interface WebGLProgramObject<A extends string, U extends string> {
    program: WebGLProgram;
    vertexShader: WebGLShader;
    fragmentShader: WebGLShader;
    attributes: Record<A, GLuint>;
    uniforms: Record<U, WebGLUniformLocation>;
}

// Shader sources - no longer need MAX_NODES template replacement since shaders use texture-based bone lookup
const vertexShaderHardwareSkinning = vertexShaderHardwareSkinningSource;
const vertexShaderHDHardwareSkinningOld = vertexShaderHDHardwareSkinningOldSource;
const vertexShaderHDHardwareSkinningNew = vertexShaderHDHardwareSkinningNewSource;
const fragmentShaderHDNew = /*#__PURE__*/ fragmentShaderHDNewSource.replace(/\$\{MAX_ENV_MIP_LEVELS}/g, String(MAX_ENV_MIP_LEVELS.toFixed(1)));
// WebGPU shaders - also no longer need MAX_NODES replacement
const sdShader = sdShaderSource;
const hdShader = /*#__PURE__*/ hdShaderSource.replace(/\$\{MAX_ENV_MIP_LEVELS}/g, String(MAX_ENV_MIP_LEVELS.toFixed(1)));
const depthShader = depthShaderSource;

const tempPos: vec3 = vec3.create();

// Reusable temporary variables for raycasting and other calculations to reduce GC
const tempEdge1 = vec3.create();
const tempEdge2 = vec3.create();
const tempH = vec3.create();
const tempS = vec3.create();
const tempQ = vec3.create();
const tempV0 = vec3.create();
const tempV1 = vec3.create();
const tempV2 = vec3.create();
const tempRayToVertex = vec3.create();
const tempProjectedPoint = vec3.create();



const GPU_LAYER_PROPS: [string, GPUBlendState, GPUDepthStencilState][] = [['none', {
    color: {
        operation: 'add',
        srcFactor: 'one',
        dstFactor: 'zero'
    },
    alpha: {
        operation: 'add',
        srcFactor: 'one',
        dstFactor: 'zero'
    }
}, {
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
        format: 'depth24plus'
    }], ['transparent', {
        color: {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'zero'
        },
        alpha: {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'zero'
        }
    }, {
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
        format: 'depth24plus'
    }], ['blend', {
        color: {
            operation: 'add',
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha'
        },
        alpha: {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha'
        }
    }, {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        format: 'depth24plus'
    }], ['additive', {
        color: {
            operation: 'add',
            srcFactor: 'src-alpha',
            dstFactor: 'one'
        },
        alpha: {
            operation: 'add',
            srcFactor: 'src-alpha',
            dstFactor: 'one'
        }
    }, {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        format: 'depth24plus'
    }], ['addAlpha', {
        color: {
            operation: 'add',
            srcFactor: 'src-alpha',
            dstFactor: 'one'
        },
        alpha: {
            operation: 'add',
            srcFactor: 'src-alpha',
            dstFactor: 'one'
        }
    }, {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        format: 'depth24plus'
    }], ['modulate', {
        color: {
            operation: 'add',
            srcFactor: 'zero',
            dstFactor: 'src'
        },
        alpha: {
            operation: 'add',
            srcFactor: 'zero',
            dstFactor: 'one'
        }
    }, {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        format: 'depth24plus'
    }], ['modulate2x', {
        color: {
            operation: 'add',
            srcFactor: 'dst',
            dstFactor: 'src'
        },
        alpha: {
            operation: 'add',
            srcFactor: 'zero',
            dstFactor: 'one'
        }
    }, {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        format: 'depth24plus'
    }]];

export class ModelRenderer {
    private isHD: boolean;

    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext | WebGLRenderingContext;
    private device: GPUDevice;
    private gpuContext: GPUCanvasContext;
    private anisotropicExt: EXT_texture_filter_anisotropic | null = null;
    private colorBufferFloatExt: EXT_color_buffer_float | null = null;
    private s3tcExt: WEBGL_compressed_texture_s3tc | null = null;
    private vertexShader: WebGLShader | null;
    private fragmentShader: WebGLShader | null;
    private shaderProgram: WebGLProgram | null;
    private vsBindGroupLayout: GPUBindGroupLayout | null;
    private fsBindGroupLayout: GPUBindGroupLayout | null;
    private gpuShaderModule: GPUShaderModule | null;
    private gpuDepthShaderModule: GPUShaderModule | null;
    private gpuPipelines: Record<string, GPURenderPipeline> = {};
    private gpuWireframePipeline: GPURenderPipeline | null;
    private gpuShadowPipeline: GPURenderPipeline | null;
    private gpuPipelineLayout: GPUPipelineLayout | null;
    private gpuRenderPassDescriptor: GPURenderPassDescriptor | null;
    private shaderProgramLocations: {
        vertexPositionAttribute: number | null;
        normalsAttribute: number | null;
        textureCoordAttribute: number | null;
        groupAttribute: number | null;
        skinAttribute: number | null;
        weightAttribute: number | null;
        tangentAttribute: number | null;
        pMatrixUniform: WebGLUniformLocation | null;
        mvMatrixUniform: WebGLUniformLocation | null;
        samplerUniform: WebGLUniformLocation | null;
        normalSamplerUniform: WebGLUniformLocation | null;
        ormSamplerUniform: WebGLUniformLocation | null;
        replaceableColorUniform: WebGLUniformLocation | null;
        geosetColorUniform: WebGLUniformLocation | null;
        replaceableTypeUniform: WebGLUniformLocation | null;
        discardAlphaLevelUniform: WebGLUniformLocation | null;
        tVertexAnimUniform: WebGLUniformLocation | null;
        wireframeUniform: WebGLUniformLocation | null;
        boneTextureUniform: WebGLUniformLocation | null;
        boneTextureWidthUniform: WebGLUniformLocation | null;
        boneTextureHeightUniform: WebGLUniformLocation | null;
        lightPosUniform: WebGLUniformLocation | null;
        lightColorUniform: WebGLUniformLocation | null;
        cameraPosUniform: WebGLUniformLocation | null;
        shadowParamsUniform: WebGLUniformLocation | null;
        shadowMapSamplerUniform: WebGLUniformLocation | null;
        shadowMapLightMatrixUniform: WebGLUniformLocation | null;
        hasEnvUniform: WebGLUniformLocation | null;
        irradianceMapUniform: WebGLUniformLocation | null;
        prefilteredEnvUniform: WebGLUniformLocation | null;
        brdfLUTUniform: WebGLUniformLocation | null;
        layerAlphaUniform: WebGLUniformLocation | null;
        geosetAlphaUniform: WebGLUniformLocation | null;
        lightDirUniform: WebGLUniformLocation | null;
        ambientColorUniform: WebGLUniformLocation | null;
        unshadedUniform: WebGLUniformLocation | null;
        enableLightingUniform: WebGLUniformLocation | null;
    };
    private skeletonShaderProgram: WebGLProgram | null;
    private skeletonVertexShader: WebGLShader | null;
    private skeletonFragmentShader: WebGLShader | null;
    private skeletonShaderProgramLocations: {
        vertexPositionAttribute: number | null;
        colorAttribute: number | null;
        pMatrixUniform: WebGLUniformLocation | null;
        mvMatrixUniform: WebGLUniformLocation | null;
    };
    private skeletonVertexBuffer: WebGLBuffer | null;
    private skeletonColorBuffer: WebGLBuffer | null;
    private skeletonShaderModule: GPUShaderModule;
    private skeletonBindGroupLayout: GPUBindGroupLayout;
    private skeletonPipelineLayout: GPUPipelineLayout;
    private skeletonPipeline: GPURenderPipeline;
    private skeletonGPUVertexBuffer: GPUBuffer;
    private skeletonGPUColorBuffer: GPUBuffer;
    private skeletonGPUUniformsBuffer: GPUBuffer;

    // Bone texture for skinning (replaces uniform matrix array)
    private boneTexture: WebGLTexture | null = null;
    private boneTextureData: Float32Array;  // CPU-side buffer for bone matrix data
    // private _boneTextureDiagLogged = false; // Diagnostic flag

    // Fallback texture for missing textures (magenta color to indicate missing)
    private fallbackTexture: WebGLTexture | null = null;

    public model: Model;
    public modelInstance: ModelInstance;

    public get interp(): ModelInterp {
        return this.modelInstance.interp;
    }

    public get rendererData(): RendererData {
        return this.modelInstance.rendererData;
    }

    private softwareSkinning: boolean;
    private vertexBuffer: WebGLBuffer[] = [];
    private normalBuffer: WebGLBuffer[] = [];
    private vertices: Float32Array[] = []; // Array per geoset for software skinning
    private texCoordBuffer: WebGLBuffer[] = [];
    private indexBuffer: WebGLBuffer[] = [];
    private wireframeIndexBuffer: WebGLBuffer[] = [];
    private wireframeIndexGPUBuffer: GPUBuffer[] = [];
    private groupBuffer: WebGLBuffer[] = [];
    private skinWeightBuffer: WebGLBuffer[] = [];
    private tangentBuffer: WebGLBuffer[] = [];

    private envShaderModeule: GPUShaderModule;
    private envPiepeline: GPURenderPipeline;
    private envVSBindGroupLayout: GPUBindGroupLayout | null;
    private envFSBindGroupLayout: GPUBindGroupLayout | null;
    private envVSUniformsBuffer: GPUBuffer;
    private envVSBindGroup: GPUBindGroup;
    private envSampler: GPUSampler;
    private cubeVertexBuffer: WebGLBuffer;
    private cubeGPUVertexBuffer: GPUBuffer;
    private squareVertexBuffer: WebGLBuffer;
    private brdfLUT: WebGLTexture;
    private gpuBrdfLUT: GPUTexture;
    private gpuBrdfSampler: GPUSampler;

    private envToCubemap: WebGLProgramObject<'aPos', 'uPMatrix' | 'uMVMatrix' | 'uEquirectangularMap'>;
    private envToCubemapShaderModule: GPUShaderModule;
    private envToCubemapPiepeline: GPURenderPipeline;
    private envToCubemapVSBindGroupLayout: GPUBindGroupLayout | null;
    private envToCubemapFSBindGroupLayout: GPUBindGroupLayout | null;
    private envToCubemapSampler: GPUSampler;
    private envSphere: WebGLProgramObject<'aPos', 'uPMatrix' | 'uMVMatrix' | 'uEnvironmentMap'>;
    private convoluteDiffuseEnv: WebGLProgramObject<'aPos', 'uPMatrix' | 'uMVMatrix' | 'uEnvironmentMap'>;
    private convoluteDiffuseEnvShaderModule: GPUShaderModule;
    private convoluteDiffuseEnvPiepeline: GPURenderPipeline;
    private convoluteDiffuseEnvVSBindGroupLayout: GPUBindGroupLayout | null;
    private convoluteDiffuseEnvFSBindGroupLayout: GPUBindGroupLayout | null;
    private convoluteDiffuseEnvSampler: GPUSampler;
    private prefilterEnv: WebGLProgramObject<'aPos', 'uPMatrix' | 'uMVMatrix' | 'uEnvironmentMap' | 'uRoughness'>;
    private prefilterEnvShaderModule: GPUShaderModule;
    private prefilterEnvPiepeline: GPURenderPipeline;
    private prefilterEnvVSBindGroupLayout: GPUBindGroupLayout | null;
    private prefilterEnvFSBindGroupLayout: GPUBindGroupLayout | null;
    private prefilterEnvSampler: GPUSampler;
    private integrateBRDF: WebGLProgramObject<'aPos', never>;

    private gpuMultisampleTexture: GPUTexture;
    private gpuDepthTexture: GPUTexture;
    private gpuVertexBuffer: GPUBuffer[] = [];
    private gpuNormalBuffer: GPUBuffer[] = [];
    private gpuTexCoordBuffer: GPUBuffer[] = [];
    private gpuGroupBuffer: GPUBuffer[] = [];
    private gpuIndexBuffer: GPUBuffer[] = [];
    private gpuSkinWeightBuffer: GPUBuffer[] = [];
    private gpuTangentBuffer: GPUBuffer[] = [];
    private gpuVSUniformsBuffer: GPUBuffer;
    private gpuBoneTexture: GPUTexture;
    private gpuBoneTextureWidthBuffer: GPUBuffer;
    private gpuVSUniformsBindGroup: GPUBindGroup;
    private gpuFSUniformsBuffers: GPUBuffer[][] = [];

    // Environment Light (DNC) support
    private envLightEnabled = false;
    private envLightDirection: vec3 = vec3.fromValues(1, -1, 1);
    private envLightColor: vec3 = vec3.fromValues(1.4, 1.4, 1.4);
    private envAmbientColor: vec3 = vec3.fromValues(0.5, 0.5, 0.5);

    constructor(model: Model) {
        this.isHD = model.Geosets?.some(it => it.SkinWeights?.length > 0);

        this.shaderProgramLocations = {
            vertexPositionAttribute: null,
            normalsAttribute: null,
            textureCoordAttribute: null,
            groupAttribute: null,
            skinAttribute: null,
            weightAttribute: null,
            tangentAttribute: null,
            pMatrixUniform: null,
            mvMatrixUniform: null,
            samplerUniform: null,
            normalSamplerUniform: null,
            ormSamplerUniform: null,
            replaceableColorUniform: null,
            geosetColorUniform: null,
            replaceableTypeUniform: null,
            discardAlphaLevelUniform: null,
            tVertexAnimUniform: null,
            wireframeUniform: null,
            boneTextureUniform: null,
            boneTextureWidthUniform: null,
            boneTextureHeightUniform: null,
            lightPosUniform: null,
            lightColorUniform: null,
            cameraPosUniform: null,
            shadowParamsUniform: null,
            shadowMapSamplerUniform: null,
            shadowMapLightMatrixUniform: null,
            hasEnvUniform: null,
            irradianceMapUniform: null,
            prefilteredEnvUniform: null,
            brdfLUTUniform: null,
            layerAlphaUniform: null,

            geosetAlphaUniform: null,
            lightDirUniform: null,
            // lightColorUniform already defined at 378
            ambientColorUniform: null,
            unshadedUniform: null,
            enableLightingUniform: null
        };
        this.skeletonShaderProgramLocations = {
            vertexPositionAttribute: null,
            colorAttribute: null,
            mvMatrixUniform: null,
            pMatrixUniform: null
        };

        this.model = model;

        this.modelInstance = new ModelInstance(model);
        this.setSequence(0);
    }

    public destroy(): void {
        if (this.device) {
            for (const buffer of this.wireframeIndexGPUBuffer) {
                buffer?.destroy();
            }
            this.gpuMultisampleTexture?.destroy();
            this.gpuDepthTexture?.destroy();

            for (const buffer of this.gpuVertexBuffer) {
                buffer?.destroy();
            }
            for (const buffer of this.gpuNormalBuffer) {
                buffer?.destroy();
            }
            for (const buffer of this.gpuTexCoordBuffer) {
                buffer?.destroy();
            }
            for (const buffer of this.gpuGroupBuffer) {
                buffer?.destroy();
            }
            for (const buffer of this.gpuIndexBuffer) {
                buffer?.destroy();
            }
            for (const buffer of this.gpuSkinWeightBuffer) {
                buffer?.destroy();
            }
            for (const buffer of this.gpuTangentBuffer) {
                buffer?.destroy();
            }
            this.gpuVSUniformsBuffer?.destroy();
            this.gpuBoneTextureWidthBuffer?.destroy();
            this.gpuBoneTexture?.destroy();
            for (const materialID in this.gpuFSUniformsBuffers) {
                for (const buffer of this.gpuFSUniformsBuffers[materialID]) {
                    buffer?.destroy();
                }
            }

            if (this.skeletonGPUVertexBuffer) {
                this.skeletonGPUVertexBuffer.destroy();
                this.skeletonGPUVertexBuffer = null;
            }
            if (this.skeletonGPUColorBuffer) {
                this.skeletonGPUColorBuffer.destroy();
                this.skeletonGPUColorBuffer = null;
            }
            if (this.skeletonGPUUniformsBuffer) {
                this.skeletonGPUUniformsBuffer.destroy();
                this.skeletonGPUUniformsBuffer = null;
            }
            if (this.envVSUniformsBuffer) {
                this.envVSUniformsBuffer.destroy();
                this.envVSUniformsBuffer = null;
            }
            if (this.cubeGPUVertexBuffer) {
                this.cubeGPUVertexBuffer.destroy();
                this.cubeGPUVertexBuffer = null;
            }
        }




        if (this.boneTexture && this.gl) {
            this.gl.deleteTexture(this.boneTexture);
            this.boneTexture = null;
        }
        if (this.fallbackTexture && this.gl) {
            this.gl.deleteTexture(this.fallbackTexture);
            this.fallbackTexture = null;
        }
        if (this.gl) {
            if (this.skeletonShaderProgram) {
                if (this.skeletonVertexShader) {
                    this.gl.detachShader(this.skeletonShaderProgram, this.skeletonVertexShader);
                    this.gl.deleteShader(this.skeletonVertexShader);
                    this.skeletonVertexShader = null;
                }
                if (this.skeletonFragmentShader) {
                    this.gl.detachShader(this.skeletonShaderProgram, this.skeletonFragmentShader);
                    this.gl.deleteShader(this.skeletonFragmentShader);
                    this.skeletonFragmentShader = null;
                }
                this.gl.deleteProgram(this.skeletonShaderProgram);
                this.skeletonShaderProgram = null;
            }

            if (this.shaderProgram) {
                if (this.vertexShader) {
                    this.gl.detachShader(this.shaderProgram, this.vertexShader);
                    this.gl.deleteShader(this.vertexShader);
                    this.vertexShader = null;
                }
                if (this.fragmentShader) {
                    this.gl.detachShader(this.shaderProgram, this.fragmentShader);
                    this.gl.deleteShader(this.fragmentShader);
                    this.fragmentShader = null;
                }
                this.gl.deleteProgram(this.shaderProgram);
                this.shaderProgram = null;
            }

            this.destroyShaderProgramObject(this.envToCubemap);
            this.destroyShaderProgramObject(this.envSphere);
            this.destroyShaderProgramObject(this.convoluteDiffuseEnv);
            this.destroyShaderProgramObject(this.prefilterEnv);
            this.destroyShaderProgramObject(this.integrateBRDF);

            if (this.cubeVertexBuffer) this.gl.deleteBuffer(this.cubeVertexBuffer);
            if (this.squareVertexBuffer) this.gl.deleteBuffer(this.squareVertexBuffer);
        }
    }

    private initRequiredEnvMaps(): void {
        if (this.model.Version >= 1000 && (isWebGL2(this.gl) || this.device)) {
            this.model.Materials.forEach(material => {
                let layer;
                if (
                    material.Shader === 'Shader_HD_DefaultUnit' && material.Layers.length === 6 && typeof material.Layers[5].TextureID === 'number' ||
                    this.model.Version >= 1100 && (layer = material.Layers.find(it => it.ShaderTypeId === 1 && it.ReflectionsTextureID)) && typeof layer.ReflectionsTextureID === 'number'
                ) {
                    const id = this.model.Version >= 1100 && layer ? layer.ReflectionsTextureID : material.Layers[5].TextureID;
                    this.rendererData.requiredEnvMaps[this.model.Textures[id].Image] = true;
                }
            });
        }
    }

    public initGL(glContext: WebGL2RenderingContext | WebGLRenderingContext): void {
        this.gl = glContext;
        this.validateNormals();
        ModelResourceManager.getInstance().initGL(glContext);
        // With texture-based bone matrices, we no longer need software skinning fallback
        // The old check was: MAX_VERTEX_UNIFORM_VECTORS < 4 * (MAX_NODES + 2)
        // This is obsolete since bone matrices are now stored in a texture
        this.softwareSkinning = false;
        this.anisotropicExt = (
            this.gl.getExtension('EXT_texture_filter_anisotropic') ||
            this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
            this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
        ) as EXT_texture_filter_anisotropic;
        this.colorBufferFloatExt = this.gl.getExtension('EXT_color_buffer_float');
        this.s3tcExt = this.gl.getExtension('WEBGL_compressed_texture_s3tc');

        if (this.s3tcExt) {
            //             console.log('[ModelRenderer] S3TC Compressed Textures supported');
        }

        this.initRequiredEnvMaps();

        this.initShaders();
        this.initBuffers();
        this.initCube();
        this.initSquare();
        this.initBRDFLUT();
        this.initFallbackTexture(); // Create magenta fallback for missing textures
        this.modelInstance.particlesController.initGL(glContext);
        this.modelInstance.ribbonsController.initGL(glContext);
    }

    /**
     * Initialize a fallback magenta texture for missing textures.
     * This ensures meshes are visible even when their textures fail to load.
     */
    private initFallbackTexture(): void {
        if (this.fallbackTexture) {
            return; // Already initialized
        }
        const gl = this.gl;
        this.fallbackTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.fallbackTexture);
        // 2x2 magenta texture (FF00FF with full alpha)
        const magentaPixels = new Uint8Array([
            255, 0, 255, 255, 255, 0, 255, 255,
            255, 0, 255, 255, 255, 0, 255, 255
        ]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, magentaPixels);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this.rendererData.fallbackTexture = this.fallbackTexture;
        //         console.log('[ModelRenderer] Fallback magenta texture initialized');
    }

    /**
     * Initialize the bone texture for texture-based skinning.
     * This replaces the uniform array approach and allows for many more bones.
     */
    private initBoneTexture(): void {
        if (this.boneTexture) {
            return; // Already initialized
        }

        const gl = this.gl as WebGL2RenderingContext;

        // Create the bone texture - each bone matrix requires 4 RGBA pixels (4 vec4 = 16 floats)
        // For MAX_NODES bones, we need MAX_NODES * 4 pixels
        this.boneTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);

        // Allocate CPU-side buffer for bone matrix data
        // Each mat4 = 16 floats, stored as 4 RGBA pixels
        this.boneTextureData = new Float32Array(BONE_TEXTURE_WIDTH * BONE_TEXTURE_HEIGHT * 4);

        // Initialize with identity matrices for all bones
        for (let i = 0; i < MAX_NODES; i++) {
            const offset = i * 16; // 16 floats per mat4
            // Identity matrix (column-major order)
            this.boneTextureData[offset + 0] = 1; // col 0
            this.boneTextureData[offset + 1] = 0;
            this.boneTextureData[offset + 2] = 0;
            this.boneTextureData[offset + 3] = 0;
            this.boneTextureData[offset + 4] = 0; // col 1
            this.boneTextureData[offset + 5] = 1;
            this.boneTextureData[offset + 6] = 0;
            this.boneTextureData[offset + 7] = 0;
            this.boneTextureData[offset + 8] = 0; // col 2
            this.boneTextureData[offset + 9] = 0;
            this.boneTextureData[offset + 10] = 1;
            this.boneTextureData[offset + 11] = 0;
            this.boneTextureData[offset + 12] = 0; // col 3
            this.boneTextureData[offset + 13] = 0;
            this.boneTextureData[offset + 14] = 0;
            this.boneTextureData[offset + 15] = 1;
        }

        // Create texture with RGBA32F format (requires WebGL2)
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA32F,
            BONE_TEXTURE_WIDTH,
            BONE_TEXTURE_HEIGHT,
            0,
            gl.RGBA,
            gl.FLOAT,
            this.boneTextureData
        );

        // Configure texture parameters - must use NEAREST filtering for data textures
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    /**
     * Update bone texture with current frame's bone matrices and bind it to the shader.
     */
    private updateAndBindBoneTexture(instance: ModelInstance): void {
        const gl = this.gl as WebGL2RenderingContext;

        // Copy bone matrices from instance to texture data buffer
        const nodes = instance.rendererData.nodes;

        // Optimized copy using TypedArray.set()
        for (let i = 0; i < nodes.length && i < MAX_NODES; i++) {
            if (nodes[i]) {
                this.boneTextureData.set(nodes[i].matrix, i * 16);
            }
        }

        // Update the texture with new bone data (WebGL2)
        gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);
        gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            BONE_TEXTURE_WIDTH,
            BONE_TEXTURE_HEIGHT,
            gl.RGBA,
            gl.FLOAT,
            this.boneTextureData
        );

        // Bind texture to texture unit and set uniforms
        // Use a high texture unit to avoid conflicts with diffuse/normal/etc textures
        const boneTextureUnit = 15;
        gl.activeTexture(gl.TEXTURE0 + boneTextureUnit);
        gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);
        gl.uniform1i(this.shaderProgramLocations.boneTextureUniform, boneTextureUnit);
        gl.uniform1f(this.shaderProgramLocations.boneTextureWidthUniform, BONE_TEXTURE_WIDTH);
        if (this.shaderProgramLocations.boneTextureHeightUniform) {
            gl.uniform1f(this.shaderProgramLocations.boneTextureHeightUniform, BONE_TEXTURE_HEIGHT);
        }
    }

    public resize(width: number, height: number): void {
        if (this.gl) {
            this.gl.viewport(0, 0, width, height);
        }
    }

    /**
     * Update the normal buffer for a specific geoset after normal recalculation.
     * @param geosetIndex - Index of the geoset to update
     * @param newNormals - New vertex normals (Float32Array or number[])
     */
    public updateGeosetNormals(geosetIndex: number, newNormals: Float32Array | number[]): void {
        if (!this.gl || !this.normalBuffer[geosetIndex]) {
            //             console.warn('[ModelRenderer] Cannot update normals: GL or buffer not initialized');
            return;
        }

        const data = newNormals instanceof Float32Array ? newNormals : new Float32Array(newNormals);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalBuffer[geosetIndex]);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.DYNAMIC_DRAW);
    }

    private calculateSmoothNormals(geoset: any): Float32Array {
        const vertices = geoset.Vertices;
        const faces = geoset.Faces;
        const vertexCount = vertices.length / 3;
        const faceCount = faces.length / 3;

        const normals = new Float32Array(vertices.length);

        // Pre-allocate temporary vectors to avoid GC thrashing
        const v0 = vec3.create();
        const v1 = vec3.create();
        const v2 = vec3.create();
        const edge1 = vec3.create();
        const edge2 = vec3.create();
        const faceNormal = vec3.create();
        const tempNormal = vec3.create(); // For normalization loop

        for (let f = 0; f < faceCount; f++) {
            const i0 = faces[f * 3];
            const i1 = faces[f * 3 + 1];
            const i2 = faces[f * 3 + 2];

            // Load vertices
            v0[0] = vertices[i0 * 3]; v0[1] = vertices[i0 * 3 + 1]; v0[2] = vertices[i0 * 3 + 2];
            v1[0] = vertices[i1 * 3]; v1[1] = vertices[i1 * 3 + 1]; v1[2] = vertices[i1 * 3 + 2];
            v2[0] = vertices[i2 * 3]; v2[1] = vertices[i2 * 3 + 1]; v2[2] = vertices[i2 * 3 + 2];

            // Calculate face normal
            vec3.sub(edge1, v1, v0);
            vec3.sub(edge2, v2, v0);
            vec3.cross(faceNormal, edge1, edge2);

            // Accumulate face normal to vertex normals
            // Manual addition significantly faster than repeated vec3.add calls for array backing
            for (const idx of [i0, i1, i2]) {
                const base = idx * 3;
                normals[base] += faceNormal[0];
                normals[base + 1] += faceNormal[1];
                normals[base + 2] += faceNormal[2];
            }
        }

        // Normalize
        for (let v = 0; v < vertexCount; v++) {
            const base = v * 3;
            // Load accumulator
            tempNormal[0] = normals[base];
            tempNormal[1] = normals[base + 1];
            tempNormal[2] = normals[base + 2];

            // Normalize
            vec3.normalize(tempNormal, tempNormal);

            // Store back
            normals[base] = tempNormal[0];
            normals[base + 1] = tempNormal[1];
            normals[base + 2] = tempNormal[2];
        }

        return normals;
    }

    private validateNormals(): void {
        //         console.log('[ModelRenderer] Forcing auto-recalculation of normals on import...');
        for (let i = 0; i < this.model.Geosets.length; ++i) {
            const geoset = this.model.Geosets[i];
            // Unconditionally recalculate normals to ensure high quality lighting
            // This fixes issues with models having bad/non-normalized normals from export
            geoset.Normals = this.calculateSmoothNormals(geoset);
        }
    }

    public async initGPUDevice(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext): Promise<void> {
        this.canvas = canvas;
        this.device = device;
        this.gpuContext = context;
        this.gpuContext.configure({
            device: device,
            format: navigator.gpu.getPreferredCanvasFormat(),
            alphaMode: 'premultiplied',
        });
        this.validateNormals();
        ModelResourceManager.getInstance().initDevice(device);

        this.initRequiredEnvMaps();

        this.initGPUShaders();
        this.initGPUPipeline();
        this.initGPUBuffers();
        this.initGPUUniformBuffers();
        this.initGPUMultisampleTexture();
        this.initGPUDepthTexture();
        this.initGPUEmptyTexture();
        this.initCube();
        this.initGPUBRDFLUT();
        this.modelInstance.particlesController.initGPUDevice(device);
        this.modelInstance.ribbonsController.initGPUDevice(device);

        this.gpuRenderPassDescriptor = {
            colorAttachments: [{
                view: undefined,
                clearValue: { r: 0.2, g: 0.2, b: 0.2, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }],
            depthStencilAttachment: {
                view: undefined,
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            }
        };
    }

    public setTextureImage(path: string, img: HTMLImageElement): void {
        if (this.device) {
            let texture = ModelResourceManager.getInstance().getGPUTexture(path);
            if (!texture) {
                texture = this.device.createTexture({
                    size: [img.width, img.height],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
                });
                this.device.queue.copyExternalImageToTexture(
                    {
                        source: img
                    },
                    { texture },
                    {
                        width: img.width,
                        height: img.height
                    }
                );
                generateMips(this.device, texture);
                ModelResourceManager.getInstance().setGPUTexture(path, texture);
            }
            this.rendererData.gpuTextures[path] = texture;
            this.processEnvMaps(path);
        } else {
            let texture = ModelResourceManager.getInstance().getTexture(path);
            if (!texture) {
                texture = this.gl.createTexture();
                this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
                // this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
                // CRITICAL: Textures contain straight (non-premultiplied) alpha. Tell WebGL NOT to premultiply during upload.
                // The default UNPACK_PREMULTIPLY_ALPHA_WEBGL=true destroys RGB on transparent pixels, making them render black.
                this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
                const flags = this.model.Textures.find(it => it.Image === path)?.Flags || 0;
                this.setTextureParameters(flags, true);

                this.gl.generateMipmap(this.gl.TEXTURE_2D);
                this.gl.bindTexture(this.gl.TEXTURE_2D, null);
                ModelResourceManager.getInstance().setTexture(path, texture);
            }
            this.rendererData.textures[path] = texture;
            this.processEnvMaps(path);
        }
    }

    public setTextureImageData(path: string, imageData: ImageData[]): void {
        let count = 1;
        for (let i = 1; i < imageData.length; ++i, ++count) {
            if (
                imageData[i].width !== imageData[i - 1].width / 2 ||
                imageData[i].height !== imageData[i - 1].height / 2
            ) {
                break;
            }
        }

        if (this.device) {
            let texture = ModelResourceManager.getInstance().getGPUTexture(path);
            if (!texture) {
                texture = this.device.createTexture({
                    size: [imageData[0].width, imageData[0].height],
                    format: 'rgba8unorm',
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                    mipLevelCount: count
                });
                ModelResourceManager.getInstance().setGPUTexture(path, texture);
            }
            for (let i = 0; i < count; ++i) {
                // WebGPU requires bytesPerRow alignment (typically 256 bytes).
                // ImageData is tightly packed (width*4), so we must pad rows when not aligned.
                const w = imageData[i].width;
                const h = imageData[i].height;
                const tightBytesPerRow = w * 4;
                const alignedBytesPerRow = Math.ceil(tightBytesPerRow / 256) * 256;

                let src = imageData[i].data as unknown as Uint8Array;
                let data: Uint8Array;
                if (alignedBytesPerRow === tightBytesPerRow) {
                    data = src;
                } else {
                    data = new Uint8Array(alignedBytesPerRow * h);
                    for (let y = 0; y < h; y++) {
                        const srcOffset = y * tightBytesPerRow;
                        const dstOffset = y * alignedBytesPerRow;
                        data.set(src.subarray(srcOffset, srcOffset + tightBytesPerRow), dstOffset);
                    }
                }

                this.device.queue.writeTexture(
                    {
                        texture,
                        mipLevel: i
                    },
                    data,
                    { bytesPerRow: alignedBytesPerRow, rowsPerImage: h },
                    { width: w, height: h },
                );
            }
            this.rendererData.gpuTextures[path] = texture;
            this.processEnvMaps(path);
        } else {
            let texture = ModelResourceManager.getInstance().getTexture(path);
            let isNew = false;
            if (!texture) {
                texture = this.gl.createTexture();
                isNew = true;
                ModelResourceManager.getInstance().setTexture(path, texture);
            }
            this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
            // this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
            // CRITICAL: Textures contain straight (non-premultiplied) alpha. Tell WebGL NOT to premultiply during upload.
            // The default UNPACK_PREMULTIPLY_ALPHA_WEBGL=true destroys RGB on transparent pixels, making them render black.
            this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            for (let i = 0; i < count; ++i) {
                this.gl.texImage2D(this.gl.TEXTURE_2D, i, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, imageData[i]);
            }
            if (isNew) {
                const flags = this.model.Textures.find(it => it.Image === path)?.Flags || 0;
                this.setTextureParameters(flags, false);
            }
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
            this.rendererData.textures[path] = texture;
            this.processEnvMaps(path);
        }
    }

    /**
     * Set texture data from optimized Rust backend payload (DXT or RGBA)
     * @returns true if texture was loaded successfully, false if renderer not ready
     */
    public setOptimizedTextureData(path: string, width: number, height: number, format: string, mipmaps: Uint8Array[]): boolean {
        const count = mipmaps.length;
        if (count === 0) return false;

        // Guard: ensure renderer is initialized
        if (!this.gl && !this.device) {
            //             console.warn('[ModelRenderer] setOptimizedTextureData called before renderer initialized, skipping:', path);
            return false;
        }

        if (this.device) {
            let gpuFormat: GPUTextureFormat = 'rgba8unorm';

            if (format === 'bc1') {
                gpuFormat = 'bc1-rgba-unorm';
            } else if (format === 'bc2') {
                gpuFormat = 'bc2-rgba-unorm';
            } else if (format === 'bc3') {
                gpuFormat = 'bc3-rgba-unorm';
            }

            let texture = ModelResourceManager.getInstance().getGPUTexture(path);
            if (!texture) {
                texture = this.device.createTexture({
                    size: [width, height],
                    format: gpuFormat,
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                    mipLevelCount: count
                });
                ModelResourceManager.getInstance().setGPUTexture(path, texture);
            }

            const isBC1 = format === 'bc1';
            const isBC2 = format === 'bc2';
            const isBC3 = format === 'bc3';

            for (let i = 0; i < count; ++i) {
                const mipW = Math.max(1, width >> i);
                const mipH = Math.max(1, height >> i);

                // WebGPU BC formats require bytesPerRow to be multiple of 256 for some copyBufferToTexture 
                // but for writeTexture it just needs to match the data layout.
                // For BC1/BC3, block size is 4x4. BC1 is 8 bytes per block, BC3 is 16 bytes per block.
                let bytesPerRow = 0;
                if (isBC1) {
                    bytesPerRow = Math.max(1, Math.ceil(mipW / 4)) * 8;
                } else if (isBC2 || isBC3) {
                    bytesPerRow = Math.max(1, Math.ceil(mipW / 4)) * 16;
                } else {
                    bytesPerRow = mipW * 4;
                }

                this.device.queue.writeTexture(
                    { texture, mipLevel: i },
                    mipmaps[i] as any,
                    { bytesPerRow },
                    { width: mipW, height: mipH }
                );
            }
            this.rendererData.gpuTextures[path] = texture;
            this.processEnvMaps(path);
        } else {
            let texture = ModelResourceManager.getInstance().getTexture(path);
            let isNew = false;
            if (!texture) {
                texture = this.gl.createTexture();
                isNew = true;
                ModelResourceManager.getInstance().setTexture(path, texture);
            }
            this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

            let testIsCompressed = false;
            let internalFormat: number = this.gl.RGBA;

            if (this.s3tcExt) {
                if (format === 'bc1') {
                    internalFormat = this.s3tcExt.COMPRESSED_RGBA_S3TC_DXT1_EXT;
                    testIsCompressed = true;
                } else if (format === 'bc2') {
                    internalFormat = this.s3tcExt.COMPRESSED_RGBA_S3TC_DXT3_EXT;
                    testIsCompressed = true;
                } else if (format === 'bc3') {
                    internalFormat = this.s3tcExt.COMPRESSED_RGBA_S3TC_DXT5_EXT;
                    testIsCompressed = true;
                }
            }

            for (let i = 0; i < count; ++i) {
                const mipW = Math.max(1, width >> i);
                const mipH = Math.max(1, height >> i);

                if (testIsCompressed) {
                    this.gl.compressedTexImage2D(this.gl.TEXTURE_2D, i, internalFormat, mipW, mipH, 0, mipmaps[i]);
                } else {
                    this.gl.texImage2D(this.gl.TEXTURE_2D, i, this.gl.RGBA, mipW, mipH, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, mipmaps[i]);
                }
            }

            if (count === 1 && !testIsCompressed) {
                this.gl.generateMipmap(this.gl.TEXTURE_2D);
            }

            if (isNew) {
                const flags = this.model.Textures.find(it => it.Image === path)?.Flags || 0;
                this.setTextureParameters(flags, isWebGL2(this.gl));
            }
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
            this.rendererData.textures[path] = texture;
            this.processEnvMaps(path);
        }
        return true;
    }

    public setTextureCompressedImage(path: string, format: DDS_FORMAT, imageData: ArrayBuffer, ddsInfo: DdsInfo): void {
        let texture = ModelResourceManager.getInstance().getTexture(path);
        if (!texture) {
            texture = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

            const view = new Uint8Array(imageData);

            let count = 1;
            for (let i = 1; i < ddsInfo.images.length; ++i) {
                const image = ddsInfo.images[i];
                if (image.shape.width >= 2 && image.shape.height >= 2) {
                    count = i + 1;
                }
            }

            if (isWebGL2(this.gl)) {
                this.gl.texStorage2D(this.gl.TEXTURE_2D, count, format, ddsInfo.images[0].shape.width, ddsInfo.images[0].shape.height);

                for (let i = 0; i < count; ++i) {
                    const image = ddsInfo.images[i];
                    this.gl.compressedTexSubImage2D(this.gl.TEXTURE_2D, i, 0, 0, image.shape.width, image.shape.height, format, view.subarray(image.offset, image.offset + image.length));
                }
            } else {
                for (let i = 0; i < count; ++i) {
                    const image = ddsInfo.images[i];
                    this.gl.compressedTexImage2D(this.gl.TEXTURE_2D, i, format, image.shape.width, image.shape.height, 0, view.subarray(image.offset, image.offset + image.length));
                }
            }

            const flags = this.model.Textures.find(it => it.Image === path)?.Flags || 0;
            this.setTextureParameters(flags, isWebGL2(this.gl));
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
            ModelResourceManager.getInstance().setTexture(path, texture);
        }
        this.rendererData.textures[path] = texture;
        this.processEnvMaps(path);
    }

    public setGPUTextureCompressedImage(path: string, format: GPUTextureFormat, imageData: ArrayBuffer, ddsInfo: DdsInfo): void {
        let texture = ModelResourceManager.getInstance().getGPUTexture(path);
        if (!texture) {
            const view = new Uint8Array(imageData);

            let count = 1;
            for (let i = 1; i < ddsInfo.images.length; ++i) {
                const image = ddsInfo.images[i];
                if (image.shape.width >= 4 && image.shape.height >= 4) {
                    count = i + 1;
                }
            }
            texture = this.device.createTexture({
                size: [ddsInfo.shape.width, ddsInfo.shape.height],
                format,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                mipLevelCount: count
            });
            for (let i = 0; i < count; ++i) {
                const image = ddsInfo.images[i];
                this.device.queue.writeTexture(
                    {
                        texture,
                        mipLevel: i
                    },
                    view.subarray(image.offset, image.offset + image.length),
                    { bytesPerRow: image.shape.width * (format === 'bc1-rgba-unorm' ? 2 : 4) },
                    { width: image.shape.width, height: image.shape.height },
                );
            }
            ModelResourceManager.getInstance().setGPUTexture(path, texture);
        }
        this.rendererData.gpuTextures[path] = texture;
        this.processEnvMaps(path);
    }

    public setCamera(cameraPos: vec3, cameraQuat: quat): void {
        vec3.copy(this.rendererData.cameraPos, cameraPos);
        quat.copy(this.rendererData.cameraQuat, cameraQuat);
    }

    public setLightPosition(lightPos: vec3): void {
        vec3.copy(this.rendererData.lightPos, lightPos);
    }

    public setLightColor(lightColor: vec3): void {
        vec3.copy(this.rendererData.lightColor, lightColor);
    }

    /**
     * Set environment lighting from DNC (Day/Night Cycle) model.
     * When enabled, these values override the hardcoded lighting in renderInstances.
     */
    public setEnvironmentLight(direction: vec3, lightColor: vec3, ambientColor: vec3): void {
        vec3.copy(this.envLightDirection, direction);
        vec3.normalize(this.envLightDirection, this.envLightDirection);
        vec3.copy(this.envLightColor, lightColor);
        vec3.copy(this.envAmbientColor, ambientColor);
        this.envLightEnabled = true;
    }

    /**
     * Clear environment lighting and return to default hardcoded values.
     */
    public clearEnvironmentLight(): void {
        this.envLightEnabled = false;
        vec3.set(this.envLightDirection, 1, -1, 1);
        vec3.normalize(this.envLightDirection, this.envLightDirection);
        vec3.set(this.envLightColor, 1.4, 1.4, 1.4);
        vec3.set(this.envAmbientColor, 0.5, 0.5, 0.5);
    }

    /**
     * Check if environment lighting is enabled.
     */
    public isEnvironmentLightEnabled(): boolean {
        return this.envLightEnabled;
    }

    public setSequence(index: number): void {
        this.rendererData.animation = index;
        this.rendererData.animationInfo = this.model.Sequences ? this.model.Sequences[this.rendererData.animation] : null;
        if (this.rendererData.animationInfo && this.rendererData.animationInfo.Interval && this.rendererData.animationInfo.Interval.length >= 2) {
            this.rendererData.frame = this.rendererData.animationInfo.Interval[0];
        } else {
            this.rendererData.frame = 0;
        }
    }

    public getSequence(): number {
        return this.rendererData.animation;
    }

    public setFrame(frame: number): void {
        const index = this.model.Sequences.findIndex(it => it.Interval && it.Interval.length >= 2 && it.Interval[0] <= frame && it.Interval[1] >= frame);

        if (index < 0) {
            return;
        }

        this.rendererData.animation = index;
        this.rendererData.animationInfo = this.model.Sequences[this.rendererData.animation];
        this.rendererData.frame = frame;
    }

    public getFrame(): number {
        return this.rendererData.frame;
    }

    public setTeamColor(color: vec3): void {
        vec3.copy(this.rendererData.teamColor, color);
    }

    public setMaterials(materials: any[]): void {
        this.model.Materials = materials;
        this.modelInstance.setMaterials(materials);
    }

    /**
     * Update texture coordinates (UV data) for a specific geoset.
     * This enables real-time UV editing in the 3D viewer.
     */
    public updateGeosetTexCoords(geosetIndex: number, newTVertices: Float32Array): void {
        ModelResourceManager.getInstance().updateGeosetTexCoords(this.model, geosetIndex, newTVertices);
    }

    public update(delta: number): void {
        this.modelInstance.update(delta);
    }

    public renderInstances(instances: ModelInstance[], viewMatrix: mat4, pMatrix: mat4, {
        wireframe,

        levelOfDetail = 0,
        useEnvironmentMap = false,
        shadowMapTexture,
        shadowMapMatrix,
        shadowBias,
        shadowSmoothingStep,
        depthTextureTarget,
        enableLighting = false
    }: {
        wireframe?: boolean;

        levelOfDetail?: number;
        useEnvironmentMap?: boolean;
        shadowMapTexture?: WebGLTexture | GPUTexture;
        shadowMapMatrix?: mat4;
        shadowBias?: number;
        shadowSmoothingStep?: number;
        depthTextureTarget?: GPUTexture;
        enableLighting?: boolean;
    }): void {
        if (depthTextureTarget && !this.isHD) {
            return;
        }

        if (this.device) {
            return;
        }

        if (!this.shaderProgram) {
            return;
        }



        this.gl.useProgram(this.shaderProgram);

        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix as Float32Array);
        this.gl.uniform1f(this.shaderProgramLocations.wireframeUniform, wireframe ? 1 : 0);

        this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.normalsAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);

        if (this.isHD) {
            this.gl.enableVertexAttribArray(this.shaderProgramLocations.skinAttribute);
            this.gl.enableVertexAttribArray(this.shaderProgramLocations.weightAttribute);
            this.gl.enableVertexAttribArray(this.shaderProgramLocations.tangentAttribute);
        } else {
            if (!this.softwareSkinning) {
                this.gl.enableVertexAttribArray(this.shaderProgramLocations.groupAttribute);
            }
        }

        const renderGeoset = (i: number, renderPass: 'opaque' | 'transparent') => {
            const geoset = this.model.Geosets[i];
            if (geoset.LevelOfDetail !== undefined && geoset.LevelOfDetail !== levelOfDetail) {
                return;
            }

            const materialID = geoset.MaterialID;
            const material = this.model.Materials[materialID];
            if (!material) {
                return;
            }

            // Optimization: Check if geoset has any relevant layers for this pass
            let hasRelevantLayers = false;
            if (!material.Layers || material.Layers.length === 0) {
                return;
            }

            if (this.isHD) {
                const baseLayer = material.Layers[0];
                const mode = baseLayer.FilterMode || 0;
                if (renderPass === 'opaque' && mode <= 1) hasRelevantLayers = true;
                else if (renderPass === 'transparent' && mode > 1) hasRelevantLayers = true;
            } else {
                for (const layer of material.Layers) {
                    const mode = layer.FilterMode || 0;
                    if (renderPass === 'opaque' && mode <= 1) { hasRelevantLayers = true; break; }
                    if (renderPass === 'transparent' && mode > 1) { hasRelevantLayers = true; break; }
                }
            }
            if (!hasRelevantLayers) return;

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[i]);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalBuffer[i]);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.normalsAttribute, 3, this.gl.FLOAT, false, 0, 0);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer[i]);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

            if (this.isHD) {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.skinWeightBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.skinAttribute, 4, this.gl.UNSIGNED_BYTE, false, 8, 0);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.weightAttribute, 4, this.gl.UNSIGNED_BYTE, true, 8, 4);

                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.tangentBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.tangentAttribute, 4, this.gl.FLOAT, false, 0, 0);
            } else if (!this.softwareSkinning) {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.groupBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.groupAttribute, 4, this.gl.UNSIGNED_SHORT, false, 0, 0);
            }

            if (wireframe && !this.wireframeIndexBuffer[i]) {
                this.createWireframeBuffer(i);
            }
            this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, wireframe ? this.wireframeIndexBuffer[i] : this.indexBuffer[i]);

            if (this.isHD) {
                for (const instance of instances) {
                    if (instance.rendererData.geosetAlpha[i] < 1e-6) continue;

                    const instanceMV = mat4.create();
                    mat4.multiply(instanceMV, viewMatrix, instance.worldMatrix);
                    this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, instanceMV as Float32Array);

                    this.gl.uniform3fv(this.shaderProgramLocations.lightPosUniform, instance.rendererData.lightPos as Float32Array);
                    this.gl.uniform3fv(this.shaderProgramLocations.lightColorUniform, instance.rendererData.lightColor as Float32Array);
                    this.gl.uniform3fv(this.shaderProgramLocations.cameraPosUniform, instance.rendererData.cameraPos as Float32Array);

                    if (shadowMapTexture && shadowMapMatrix) {
                        this.gl.uniform3f(this.shaderProgramLocations.shadowParamsUniform, 1, shadowBias ?? 1e-6, shadowSmoothingStep ?? 1 / 1024);
                        this.gl.activeTexture(this.gl.TEXTURE3);
                        this.gl.bindTexture(this.gl.TEXTURE_2D, shadowMapTexture);
                        this.gl.uniform1i(this.shaderProgramLocations.shadowMapSamplerUniform, 3);
                        this.gl.uniformMatrix4fv(this.shaderProgramLocations.shadowMapLightMatrixUniform, false, shadowMapMatrix);
                    } else {
                        this.gl.uniform3f(this.shaderProgramLocations.shadowParamsUniform, 0, 0, 0);
                    }

                    // Environment Map Logic (Simplified for now, assuming shared)
                    const envTextureId = this.model.Version >= 1100 && material.Layers.find(it => it.ShaderTypeId === 1 && typeof it.ReflectionsTextureID === 'number')?.ReflectionsTextureID || material.Layers[5]?.TextureID;
                    const envTexture = this.model.Textures[envTextureId as number]?.Image;
                    const irradianceMap = instance.rendererData.irradianceMap[envTexture];
                    const prefilteredEnv = instance.rendererData.prefilteredEnvMap[envTexture];
                    if (useEnvironmentMap && irradianceMap && prefilteredEnv) {
                        this.gl.uniform1i(this.shaderProgramLocations.hasEnvUniform, 1);
                        this.gl.activeTexture(this.gl.TEXTURE4);
                        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, irradianceMap);
                        this.gl.uniform1i(this.shaderProgramLocations.irradianceMapUniform, 4);
                        this.gl.activeTexture(this.gl.TEXTURE5);
                        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, prefilteredEnv);
                        this.gl.uniform1i(this.shaderProgramLocations.prefilteredEnvUniform, 5);
                        this.gl.activeTexture(this.gl.TEXTURE6);
                        this.gl.bindTexture(this.gl.TEXTURE_2D, this.brdfLUT);
                        this.gl.uniform1i(this.shaderProgramLocations.brdfLUTUniform, 6);
                    } else {
                        this.gl.uniform1i(this.shaderProgramLocations.hasEnvUniform, 0);
                        this.gl.uniform1i(this.shaderProgramLocations.irradianceMapUniform, 4);
                        this.gl.uniform1i(this.shaderProgramLocations.prefilteredEnvUniform, 5);
                        this.gl.uniform1i(this.shaderProgramLocations.brdfLUTUniform, 6);
                    }

                    this.setLayerPropsHD(instance, materialID, material.Layers);

                    this.gl.drawElements(
                        wireframe ? this.gl.LINES : this.gl.TRIANGLES,
                        wireframe ? geoset.Faces.length * 2 : geoset.Faces.length,
                        this.gl.UNSIGNED_SHORT,
                        0
                    );
                }
            } else {
                const layerOrder = Array.from({ length: material.Layers.length }, (_, idx) => idx);
                if (renderPass === 'transparent') {
                    // Reference behavior (mdx-m3-viewer): sort translucent batches by filter mode.
                    layerOrder.sort((a, b) => (material.Layers[a].FilterMode || 0) - (material.Layers[b].FilterMode || 0));
                }

                for (const j of layerOrder) {
                    const layer = material.Layers[j];
                    const mode = layer.FilterMode || 0;

                    if (renderPass === 'opaque' && mode > 1) continue;
                    if (renderPass === 'transparent' && mode <= 1) continue;

                    for (const instance of instances) {
                        if (instance.rendererData.geosetAlpha[i] < 1e-6) continue;

                        const instanceMV = mat4.create();
                        mat4.multiply(instanceMV, viewMatrix, instance.worldMatrix);
                        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, instanceMV);

                        if (!this.softwareSkinning) {
                            // Bind bone texture and update with current frame's bone matrices
                            this.updateAndBindBoneTexture(instance);
                        }

                        const geosetColor = instance.findColor(i);
                        const layerAlpha = this.getLayerAlpha(layer, instance.interp);
                        this.gl.uniform3fv(this.shaderProgramLocations.geosetColorUniform, geosetColor);
                        this.gl.uniform1f(this.shaderProgramLocations.layerAlphaUniform, layerAlpha);
                        this.gl.uniform1f(this.shaderProgramLocations.geosetAlphaUniform, instance.rendererData.geosetAlpha[i]);

                        // --- unshaded support ---
                        // Flag 0x1 = Unshaded (LayerShading.Unshaded)
                        // FilterMode 2 (Blend) usually implies self-illumination or magic effects in War3, so we force Unshaded
                        const isUnshaded = ((layer.Shading || 0) & 1) !== 0
                            || mode === FilterMode.Blend
                            || mode === FilterMode.Additive
                            || mode === FilterMode.AddAlpha;
                        this.gl.uniform1f(this.shaderProgramLocations.unshadedUniform, isUnshaded ? 1.0 : 0.0);

                        const textureID = instance.rendererData.materialLayerTextureID[materialID][j];

                        // setLayerProps now always returns true if texture exists in model even if missing file
                        this.setLayerProps(instance, layer, textureID);

                        this.gl.drawElements(
                            wireframe ? this.gl.LINES : this.gl.TRIANGLES,
                            wireframe ? geoset.Faces.length * 2 : geoset.Faces.length,
                            this.gl.UNSIGNED_SHORT,
                            0
                        );
                    }
                }
            }
        };


        // --- Set Global Lighting Uniforms ---
        if (!this.isHD && this.shaderProgramLocations.enableLightingUniform) {
            // Start with environment light values or defaults
            let finalLightDir: vec3;
            let finalLightColor: vec3;
            let finalAmbientColor: vec3;

            if (this.envLightEnabled) {
                finalLightDir = vec3.clone(this.envLightDirection);
                finalLightColor = vec3.clone(this.envLightColor);
                finalAmbientColor = vec3.clone(this.envAmbientColor);
            } else {
                // Default values
                finalLightDir = vec3.fromValues(1, -1.0, 1.0);
                vec3.normalize(finalLightDir, finalLightDir);
                finalLightColor = vec3.fromValues(0.8, 0.8, 0.8);
                finalAmbientColor = vec3.fromValues(0.3, 0.3, 0.3);
            }

            // Note: Model's internal Light nodes are for local effects (glowing objects, etc.)
            // and require per-pixel lighting with attenuation to work correctly.
            // For now, they don't affect the global scene lighting.

            // Transform World Light Direction to View Space
            const viewRotation = mat3.create();
            mat3.fromMat4(viewRotation, viewMatrix);

            const lightDirView = vec3.create();
            vec3.transformMat3(lightDirView, finalLightDir, viewRotation);
            vec3.normalize(lightDirView, lightDirView);

            this.gl.uniform3fv(this.shaderProgramLocations.lightDirUniform, lightDirView as Float32Array);
            this.gl.uniform3fv(this.shaderProgramLocations.lightColorUniform, finalLightColor as Float32Array);
            this.gl.uniform3fv(this.shaderProgramLocations.ambientColorUniform, finalAmbientColor as Float32Array);
            this.gl.uniform1f(this.shaderProgramLocations.enableLightingUniform, enableLighting ? 1.0 : 0.0);

            // --- Set Local Lights Uniforms (Phase 2: Advanced Lighting) ---
            if (enableLighting) {
                // Collect lights from all instances (batching limitation: we pool them)
                // In most cases there is only one instance or they share the scene context.
                const allLights: LightResult[] = [];
                for (const instance of instances) {
                    allLights.push(...instance.collectActiveLights());
                }

                // Simple priority sort could be added here (e.g. by intensity / distance)

                const MAX_LIGHTS = 8;
                const lightCount = Math.min(allLights.length, MAX_LIGHTS);

                // We'll cache these locations later if performance issues arise
                // Using generic "uLights[i]" strings
                // Note: getUniformLocation is slow, but assuming 8 calls per frame is negligible for now.
                const prog = this.shaderProgram;

                this.gl.uniform1i(this.gl.getUniformLocation(prog, 'uLightCount'), lightCount);

                for (let i = 0; i < lightCount; ++i) {
                    const light = allLights[i];

                    // Transform Position to View Space
                    // light.position is World Space
                    const posView = vec3.create();
                    vec3.transformMat4(posView, light.position, viewMatrix);

                    // Transform Direction to View Space
                    // light.direction is World Space
                    const dirView = vec3.create();
                    const viewRotation = mat3.create();
                    mat3.fromMat4(viewRotation, viewMatrix);
                    vec3.transformMat3(dirView, light.direction, viewRotation);
                    vec3.normalize(dirView, dirView);

                    // Bind Uniforms
                    // We assume the shader struct has: type, position, direction, color, intensity, attenuation...
                    this.gl.uniform1i(this.gl.getUniformLocation(prog, `uLights[${i}].type`), light.type);
                    this.gl.uniform3fv(this.gl.getUniformLocation(prog, `uLights[${i}].position`), posView as Float32Array);
                    this.gl.uniform3fv(this.gl.getUniformLocation(prog, `uLights[${i}].direction`), dirView as Float32Array);
                    this.gl.uniform3fv(this.gl.getUniformLocation(prog, `uLights[${i}].color`), light.color as Float32Array);
                    this.gl.uniform1f(this.gl.getUniformLocation(prog, `uLights[${i}].intensity`), light.intensity);
                    this.gl.uniform3fv(this.gl.getUniformLocation(prog, `uLights[${i}].attenuation`), light.attenuation as Float32Array);
                    // Optional parameters
                    const locStart = this.gl.getUniformLocation(prog, `uLights[${i}].attenuationStart`);
                    if (locStart) this.gl.uniform1f(locStart, light.attenuationStart);

                    const locEnd = this.gl.getUniformLocation(prog, `uLights[${i}].attenuationEnd`);
                    if (locEnd) this.gl.uniform1f(locEnd, light.attenuationEnd);
                }
            }
        } else if (this.shaderProgramLocations.enableLightingUniform) {
            console.warn("[Lighting] Skipped (HD Mode or Uniform missing). isHD:", this.isHD);
        }

        // Pass 1: Opaque
        for (let i = 0; i < this.model.Geosets.length; ++i) {
            renderGeoset(i, 'opaque');
        }

        // Pass 2: Transparent
        if (this.isHD) {
            for (let i = 0; i < this.model.Geosets.length; ++i) {
                renderGeoset(i, 'transparent');
            }
        } else {
            const transparentLayers: { geosetIndex: number; layerIndex: number; filterMode: number; priorityPlane: number; dist2: number }[] = [];
            const distCache: number[] = [];
            let camPos: vec3 | null = null;
            let instanceWorld: mat4 | null = null;

            if (instances.length > 0) {
                camPos = instances[0].rendererData.cameraPos;
                instanceWorld = instances[0].worldMatrix;
            }

            for (let i = 0; i < this.model.Geosets.length; ++i) {
                const geoset = this.model.Geosets[i];
                if (geoset.LevelOfDetail !== undefined && geoset.LevelOfDetail !== levelOfDetail) {
                    continue;
                }
                const material = this.model.Materials[geoset.MaterialID];
                if (!material || !material.Layers || material.Layers.length === 0) {
                    continue;
                }

                if (camPos && instanceWorld) {
                    const min = geoset.MinimumExtent;
                    const max = geoset.MaximumExtent;
                    const center = vec3.create();
                    if (min && max && min.length >= 3 && max.length >= 3) {
                        center[0] = (min[0] + max[0]) * 0.5;
                        center[1] = (min[1] + max[1]) * 0.5;
                        center[2] = (min[2] + max[2]) * 0.5;
                    }
                    vec3.transformMat4(center, center, instanceWorld);
                    const dx = center[0] - camPos[0];
                    const dy = center[1] - camPos[1];
                    const dz = center[2] - camPos[2];
                    distCache[i] = dx * dx + dy * dy + dz * dz;
                } else {
                    distCache[i] = 0;
                }

                for (let j = 0; j < material.Layers.length; ++j) {
                    const layer = material.Layers[j];
                    const mode = layer.FilterMode || 0;
                    if (mode <= 1) continue;
                    transparentLayers.push({
                        geosetIndex: i,
                        layerIndex: j,
                        filterMode: mode,
                        priorityPlane: material.PriorityPlane || 0,
                        dist2: distCache[i]
                    });
                }
            }

            transparentLayers.sort((a, b) => {
                if (a.priorityPlane !== b.priorityPlane) return a.priorityPlane - b.priorityPlane;
                if (a.filterMode !== b.filterMode) return a.filterMode - b.filterMode;
                if (a.dist2 !== b.dist2) return b.dist2 - a.dist2;
                if (a.geosetIndex !== b.geosetIndex) return a.geosetIndex - b.geosetIndex;
                return a.layerIndex - b.layerIndex;
            });

            for (const entry of transparentLayers) {
                const i = entry.geosetIndex;
                const j = entry.layerIndex;
                const geoset = this.model.Geosets[i];
                const material = this.model.Materials[geoset.MaterialID];
                if (!material) continue;
                const layer = material.Layers[j];

                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);

                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.normalsAttribute, 3, this.gl.FLOAT, false, 0, 0);

                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

                if (!this.softwareSkinning) {
                    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.groupBuffer[i]);
                    this.gl.vertexAttribPointer(this.shaderProgramLocations.groupAttribute, 4, this.gl.UNSIGNED_SHORT, false, 0, 0);
                }

                if (wireframe && !this.wireframeIndexBuffer[i]) {
                    this.createWireframeBuffer(i);
                }
                this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, wireframe ? this.wireframeIndexBuffer[i] : this.indexBuffer[i]);

                for (const instance of instances) {
                    if (instance.rendererData.geosetAlpha[i] < 1e-6) continue;

                    const instanceMV = mat4.create();
                    mat4.multiply(instanceMV, viewMatrix, instance.worldMatrix);
                    this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, instanceMV);

                    if (!this.softwareSkinning) {
                        this.updateAndBindBoneTexture(instance);
                    }

                    const geosetColor = instance.findColor(i);
                    const layerAlpha = this.getLayerAlpha(layer, instance.interp);
                    this.gl.uniform3fv(this.shaderProgramLocations.geosetColorUniform, geosetColor);
                    this.gl.uniform1f(this.shaderProgramLocations.layerAlphaUniform, layerAlpha);
                    this.gl.uniform1f(this.shaderProgramLocations.geosetAlphaUniform, instance.rendererData.geosetAlpha[i]);

                    const isUnshaded = ((layer.Shading || 0) & 1) !== 0
                        || entry.filterMode === FilterMode.Blend
                        || entry.filterMode === FilterMode.Additive
                        || entry.filterMode === FilterMode.AddAlpha;
                    this.gl.uniform1f(this.shaderProgramLocations.unshadedUniform, isUnshaded ? 1.0 : 0.0);

                    const textureID = instance.rendererData.materialLayerTextureID[geoset.MaterialID][j];
                    this.setLayerProps(instance, layer, textureID);

                    this.gl.drawElements(
                        wireframe ? this.gl.LINES : this.gl.TRIANGLES,
                        wireframe ? geoset.Faces.length * 2 : geoset.Faces.length,
                        this.gl.UNSIGNED_SHORT,
                        0
                    );
                }
            }
        }

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.normalsAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        if (this.isHD) {
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.skinAttribute);
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.weightAttribute);
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.tangentAttribute);
        } else {
            if (!this.softwareSkinning) {
                this.gl.disableVertexAttribArray(this.shaderProgramLocations.groupAttribute);
            }
        }

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        if (this.isHD) {
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.skinAttribute);
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.weightAttribute);
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.tangentAttribute);
        } else {
            if (!this.softwareSkinning) {
                this.gl.disableVertexAttribArray(this.shaderProgramLocations.groupAttribute);
            }
        }

        // Reset Lighting Uniforms (optional, but good practice)
        // this.gl.uniform1f(this.shaderProgramLocations.enableLightingUniform, 0.0);
        for (const instance of instances) {
            const instanceMV = mat4.create();
            mat4.multiply(instanceMV, viewMatrix, instance.worldMatrix);

            // Calculate camera rotation quaternion for billboarding
            const cameraWorldMatrix = mat4.create();
            mat4.invert(cameraWorldMatrix, instanceMV);
            mat4.getRotation(instance.rendererData.cameraQuat, cameraWorldMatrix);

            instance.particlesController.render(instanceMV, pMatrix);
            instance.ribbonsController.render(instanceMV, pMatrix);
        }
    }

    public render(mvMatrix: mat4, pMatrix: mat4, {
        wireframe,
        env,
        levelOfDetail = 0,
        useEnvironmentMap = false,
        shadowMapTexture,
        shadowMapMatrix,
        shadowBias,
        shadowSmoothingStep,
        depthTextureTarget,
        enableLighting = false
    }: {
        wireframe?: boolean;
        env?: boolean;
        levelOfDetail?: number;
        useEnvironmentMap?: boolean;
        shadowMapTexture?: WebGLTexture | GPUTexture;
        shadowMapMatrix?: mat4;
        shadowBias?: number;
        shadowSmoothingStep?: number;
        depthTextureTarget?: GPUTexture;
        enableLighting?: boolean;
    }): void {
        if (depthTextureTarget && !this.isHD) {
            return;
        }

        if (this.device) {
            // WebGPU: keep `render()` as the stable entry point, but delegate to a compositing-aware implementation.
            // This avoids multiple `getCurrentTexture()` calls per frame when the host app wants to render overlays.
            const targetView = this.gpuContext.getCurrentTexture().createView();
            this.renderGPUComposite(
                targetView,
                mvMatrix,
                pMatrix,
                {
                    wireframe,
                    env,
                    levelOfDetail,
                    useEnvironmentMap,
                    shadowMapTexture,
                    shadowMapMatrix,
                    shadowBias,
                    shadowSmoothingStep,
                    depthTextureTarget,
                    enableLighting,
                }
            );
            return;

            if (this.gpuMultisampleTexture.width !== this.canvas.width || this.gpuMultisampleTexture.height !== this.canvas.height) {
                this.gpuMultisampleTexture.destroy();
                this.initGPUMultisampleTexture();
            }

            if (this.gpuDepthTexture.width !== this.canvas.width || this.gpuDepthTexture.height !== this.canvas.height) {
                this.gpuDepthTexture.destroy();
                this.initGPUDepthTexture();
            }

            let renderPassDescriptor: GPURenderPassDescriptor;
            if (depthTextureTarget) {
                renderPassDescriptor = {
                    label: 'shadow renderPass',
                    colorAttachments: [],
                    depthStencilAttachment: {
                        view: depthTextureTarget.createView(),
                        depthClearValue: 1,
                        depthLoadOp: 'clear',
                        depthStoreOp: 'store'
                    }
                };
            } else {
                renderPassDescriptor = this.gpuRenderPassDescriptor;
                if (MULTISAMPLE > 1) {
                    this.gpuRenderPassDescriptor.colorAttachments[0].view =
                        this.gpuMultisampleTexture.createView();
                    this.gpuRenderPassDescriptor.colorAttachments[0].resolveTarget =
                        this.gpuContext.getCurrentTexture().createView();
                } else {
                    this.gpuRenderPassDescriptor.colorAttachments[0].view =
                        this.gpuContext.getCurrentTexture().createView();
                }

                this.gpuRenderPassDescriptor.depthStencilAttachment = {
                    view: this.gpuDepthTexture.createView(),
                    depthClearValue: 1,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store'
                };
            }

            const encoder = this.device.createCommandEncoder();
            const pass = encoder.beginRenderPass(renderPassDescriptor);

            if (env) {
                this.renderEnvironmentGPU(pass, mvMatrix, pMatrix);
            }

            const VSUniformsValues = new ArrayBuffer(128);
            new Float32Array(VSUniformsValues, 0, 16).set(mvMatrix);
            new Float32Array(VSUniformsValues, 64, 16).set(pMatrix);
            this.device.queue.writeBuffer(this.gpuVSUniformsBuffer, 0, VSUniformsValues);
            this.updateGPUBoneTexture(this.modelInstance);

            for (let i = 0; i < this.model.Geosets.length; ++i) {
                const geoset = this.model.Geosets[i];
                if (this.rendererData.geosetAlpha[i] < 1e-6) {
                    continue;
                }
                if (geoset.LevelOfDetail !== undefined && geoset.LevelOfDetail !== levelOfDetail) {
                    continue;
                }

                if (wireframe && !this.wireframeIndexGPUBuffer[i]) {
                    this.createWireframeGPUBuffer(i);
                }

                const materialID = geoset.MaterialID;
                const material = this.model.Materials[materialID];
                if (!material || !material.Layers || material.Layers.length === 0) {
                    continue;
                }

                pass.setVertexBuffer(0, this.gpuVertexBuffer[i]);
                pass.setVertexBuffer(1, this.gpuNormalBuffer[i]);
                pass.setVertexBuffer(2, this.gpuTexCoordBuffer[i]);

                if (this.isHD) {
                    pass.setVertexBuffer(3, this.gpuTangentBuffer[i]);
                    pass.setVertexBuffer(4, this.gpuSkinWeightBuffer[i]);
                    pass.setVertexBuffer(5, this.gpuSkinWeightBuffer[i]);
                } else {
                    pass.setVertexBuffer(3, this.gpuGroupBuffer[i]);
                }

                pass.setIndexBuffer(wireframe ? this.wireframeIndexGPUBuffer[i] : this.gpuIndexBuffer[i], 'uint16');

                if (this.isHD) {
                    const baseLayer = material.Layers[0];
                    if (depthTextureTarget && !FILTER_MODES_WITH_DEPTH_WRITE.has(this.getNormalizedFilterMode(baseLayer.FilterMode))) {
                        continue;
                    }
                    const baseLayerAlpha = this.getLayerAlpha(baseLayer, this.modelInstance.interp) * this.rendererData.geosetAlpha[i];

                    const pipeline = depthTextureTarget ?
                        this.gpuShadowPipeline :
                        (wireframe ? this.gpuWireframePipeline : this.getGPUPipeline(baseLayer));
                    pass.setPipeline(pipeline);

                    const textures = this.rendererData.materialLayerTextureID[materialID];
                    const normalTextres = this.rendererData.materialLayerNormalTextureID[materialID];
                    const ormTextres = this.rendererData.materialLayerOrmTextureID[materialID];
                    const envTextres = this.rendererData.materialLayerReflectionTextureID[materialID];
                    const diffuseTextureID = textures[0];
                    const diffuseTexture = this.model.Textures[diffuseTextureID];
                    const normalTextureID = baseLayer?.ShaderTypeId === 1 ? normalTextres[0] : textures[1];
                    const normalTexture = this.model.Textures[normalTextureID];
                    const ormTextureID = baseLayer?.ShaderTypeId === 1 ? ormTextres[0] : textures[2];
                    const ormTexture = this.model.Textures[ormTextureID];
                    const envTextureID = baseLayer?.ShaderTypeId === 1 ? envTextres[0] : textures[5];
                    const envTexture = this.model.Textures[envTextureID];

                    const envTextureImage = envTexture?.Image;
                    const irradianceMap = this.rendererData.gpuIrradianceMap[envTextureImage];
                    const prefilteredEnv = this.rendererData.gpuPrefilteredEnvMap[envTextureImage];

                    const hasEnv = env && irradianceMap && prefilteredEnv;

                    this.gpuFSUniformsBuffers[materialID] ||= [];
                    let gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][0];

                    if (!gpuFSUniformsBuffer) {
                        gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][0] = this.device.createBuffer({
                            label: `fs uniforms ${materialID}`,
                            size: 192,
                            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                        });
                    }

                    const tVetexAnim = this.modelInstance.getTexCoordMatrix(baseLayer);

                    const FSUniformsValues = new ArrayBuffer(192);
                    const FSUniformsViews = {
                        replaceableColor: new Float32Array(FSUniformsValues, 0, 3),
                        discardAlphaLevel: new Float32Array(FSUniformsValues, 12, 1),
                        tVertexAnim: new Float32Array(FSUniformsValues, 16, 12),
                        lightPos: new Float32Array(FSUniformsValues, 64, 3),
                        hasEnv: new Uint32Array(FSUniformsValues, 76, 1),
                        lightColor: new Float32Array(FSUniformsValues, 80, 3),
                        wireframe: new Uint32Array(FSUniformsValues, 92, 1),
                        cameraPos: new Float32Array(FSUniformsValues, 96, 3),
                        shadowParams: new Float32Array(FSUniformsValues, 112, 3),
                        layerAlpha: new Float32Array(FSUniformsValues, 124, 1),
                        shadowMapLightMatrix: new Float32Array(FSUniformsValues, 128, 16),
                    };
                    FSUniformsViews.replaceableColor.set(this.rendererData.teamColor);
                    // FSUniformsViews.replaceableType.set([texture.ReplaceableId || 0]);
                    FSUniformsViews.discardAlphaLevel.set([this.getDiscardAlphaLevel(baseLayer.FilterMode)]);
                    FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(0, 3));
                    FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(3, 6), 4);
                    FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(6, 9), 8);
                    FSUniformsViews.lightPos.set(this.rendererData.lightPos);
                    FSUniformsViews.lightColor.set(this.rendererData.lightColor);
                    FSUniformsViews.cameraPos.set(this.rendererData.cameraPos);
                    if (shadowMapTexture && shadowMapMatrix) {
                        FSUniformsViews.shadowParams.set([1, shadowBias ?? 1e-6, shadowSmoothingStep ?? 1 / 1024]);
                        FSUniformsViews.shadowMapLightMatrix.set(shadowMapMatrix);
                    } else {
                        FSUniformsViews.shadowParams.set([0, 0, 0]);
                        FSUniformsViews.shadowMapLightMatrix.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
                    }
                    FSUniformsViews.layerAlpha.set([baseLayerAlpha]);
                    FSUniformsViews.hasEnv.set([hasEnv ? 1 : 0]);
                    FSUniformsViews.wireframe.set([wireframe ? 1 : 0]);
                    this.device.queue.writeBuffer(gpuFSUniformsBuffer, 0, FSUniformsValues);

                    const fsBindGroup = this.device.createBindGroup({
                        label: `fs uniforms ${materialID}`,
                        layout: this.fsBindGroupLayout,
                        entries: [
                            {
                                binding: 0,
                                resource: { buffer: gpuFSUniformsBuffer }
                            },
                            {
                                binding: 1,
                                resource: this.rendererData.gpuSamplers[diffuseTextureID]
                            },
                            {
                                binding: 2,
                                resource: (this.rendererData.gpuTextures[diffuseTexture.Image] || this.rendererData.gpuEmptyTexture).createView()
                            },
                            {
                                binding: 3,
                                resource: this.rendererData.gpuSamplers[normalTextureID]
                            },
                            {
                                binding: 4,
                                resource: (this.rendererData.gpuTextures[normalTexture?.Image] || this.rendererData.gpuEmptyTexture).createView()
                            },
                            {
                                binding: 5,
                                resource: this.rendererData.gpuSamplers[ormTextureID]
                            },
                            {
                                binding: 6,
                                resource: (this.rendererData.gpuTextures[ormTexture?.Image] || this.rendererData.gpuEmptyTexture).createView()
                            },
                            {
                                binding: 7,
                                resource: this.rendererData.gpuDepthSampler
                            },
                            {
                                binding: 8,
                                resource: (shadowMapTexture as GPUTexture || this.rendererData.gpuDepthEmptyTexture).createView()
                            },
                            {
                                binding: 9,
                                resource: this.prefilterEnvSampler
                            },
                            {
                                binding: 10,
                                resource: (irradianceMap as GPUTexture || this.rendererData.gpuEmptyCubeTexture).createView({
                                    dimension: 'cube'
                                })
                            },
                            {
                                binding: 11,
                                resource: this.prefilterEnvSampler
                            },
                            {
                                binding: 12,
                                resource: (prefilteredEnv as GPUTexture || this.rendererData.gpuEmptyCubeTexture).createView({
                                    dimension: 'cube'
                                })
                            },
                            {
                                binding: 13,
                                resource: this.gpuBrdfSampler
                            },
                            {
                                binding: 14,
                                resource: this.gpuBrdfLUT.createView()
                            }
                        ]
                    });

                    pass.setBindGroup(0, this.gpuVSUniformsBindGroup);
                    pass.setBindGroup(1, fsBindGroup);

                    pass.drawIndexed(wireframe ? geoset.Faces.length * 2 : geoset.Faces.length);
                } else {
                    // Match reference behavior: opaque first, then translucent layers sorted by filter mode.
                    const layerOrder = Array.from({ length: material.Layers.length }, (_, idx) => idx);
                    const opaqueLayers = layerOrder.filter((idx) => ((material.Layers[idx].FilterMode || 0) <= 1));
                    const transparentLayers = layerOrder.filter((idx) => ((material.Layers[idx].FilterMode || 0) > 1));
                    transparentLayers.sort((a, b) => (material.Layers[a].FilterMode || 0) - (material.Layers[b].FilterMode || 0));

                    const orderedLayers = opaqueLayers.concat(transparentLayers);

                    const geosetColor = this.modelInstance.findColor(i);
                    const geosetAlpha = this.rendererData.geosetAlpha[i];

                    for (const j of orderedLayers) {
                        const layer = material.Layers[j];
                        const textureID = this.rendererData.materialLayerTextureID[materialID][j];
                        const texture = this.model.Textures[textureID];

                        const layerAlpha = this.getLayerAlpha(layer, this.modelInstance.interp);
                        const pipeline = wireframe ? this.gpuWireframePipeline : this.getGPUPipeline(layer);
                        pass.setPipeline(pipeline);

                        this.gpuFSUniformsBuffers[materialID] ||= [];
                        let gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][j];

                        if (!gpuFSUniformsBuffer) {
                            gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][j] = this.device.createBuffer({
                                label: `fs uniforms ${materialID} ${j}`,
                                size: 112,
                                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                            });
                        }

                        const tVetexAnim = this.modelInstance.getTexCoordMatrix(layer);

                        const FSUniformsValues = new ArrayBuffer(112);
                        const FSUniformsViews = {
                            replaceableColor: new Float32Array(FSUniformsValues, 0, 3),
                            replaceableType: new Uint32Array(FSUniformsValues, 12, 1),
                            discardAlphaLevel: new Float32Array(FSUniformsValues, 16, 1),
                            wireframe: new Uint32Array(FSUniformsValues, 20, 1),
                            tVertexAnim: new Float32Array(FSUniformsValues, 32, 12),
                            geosetColor: new Float32Array(FSUniformsValues, 80, 3),
                            layerAlpha: new Float32Array(FSUniformsValues, 92, 1),
                            geosetAlpha: new Float32Array(FSUniformsValues, 96, 1),
                        };
                        FSUniformsViews.replaceableColor.set(this.rendererData.teamColor);
                        FSUniformsViews.replaceableType.set([texture.ReplaceableId || 0]);
                        FSUniformsViews.discardAlphaLevel.set([this.getDiscardAlphaLevel(layer.FilterMode)]);
                        FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(0, 3));
                        FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(3, 6), 4);
                        FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(6, 9), 8);
                        FSUniformsViews.wireframe.set([wireframe ? 1 : 0]);
                        FSUniformsViews.geosetColor.set(geosetColor as any);
                        FSUniformsViews.layerAlpha.set([layerAlpha]);
                        FSUniformsViews.geosetAlpha.set([geosetAlpha]);
                        this.device.queue.writeBuffer(gpuFSUniformsBuffer, 0, FSUniformsValues);

                        const fsBindGroup = this.device.createBindGroup({
                            label: `fs uniforms ${materialID} ${j}`,
                            layout: this.fsBindGroupLayout,
                            entries: [
                                {
                                    binding: 0,
                                    resource: { buffer: gpuFSUniformsBuffer }
                                },
                                {
                                    binding: 1,
                                    resource: this.rendererData.gpuSamplers[textureID]
                                },
                                {
                                    binding: 2,
                                    resource: (this.rendererData.gpuTextures[texture.Image] || this.rendererData.gpuEmptyTexture).createView()
                                }
                            ]
                        });

                        pass.setBindGroup(0, this.gpuVSUniformsBindGroup);
                        pass.setBindGroup(1, fsBindGroup);

                        pass.drawIndexed(wireframe ? geoset.Faces.length * 2 : geoset.Faces.length);
                    }
                }
            }

            this.modelInstance.particlesController.renderGPU(pass, mvMatrix, pMatrix);
            this.modelInstance.ribbonsController.renderGPU(pass, mvMatrix, pMatrix);

            pass.end();

            const commandBuffer = encoder.finish();
            this.device.queue.submit([commandBuffer]);

            return;
        }

        if (env) {
            this.renderEnvironment(mvMatrix, pMatrix);
        }

        this.renderInstances([this.modelInstance], mvMatrix, pMatrix, {
            wireframe,
            levelOfDetail,
            useEnvironmentMap,
            shadowMapTexture,
            shadowMapMatrix,
            shadowBias,
            shadowSmoothingStep,
            depthTextureTarget,
            enableLighting
        });

    }

    /**
     * WebGPU composition entry point.
     *
     * The host app can call this with a pre-acquired swapchain `targetView` (from a single `getCurrentTexture()`)
     * and optionally encode overlay draws inside the same render pass via `afterRender`.
     */
    public renderGPUComposite(
        targetView: GPUTextureView,
        mvMatrix: mat4,
        pMatrix: mat4,
        {
            wireframe,
            env,
            levelOfDetail = 0,
            useEnvironmentMap = false,
            shadowMapTexture,
            shadowMapMatrix,
            shadowBias,
            shadowSmoothingStep,
            depthTextureTarget,
            enableLighting = false,
        }: {
            wireframe?: boolean;
            env?: boolean;
            levelOfDetail?: number;
            useEnvironmentMap?: boolean;
            shadowMapTexture?: WebGLTexture | GPUTexture;
            shadowMapMatrix?: mat4;
            shadowBias?: number;
            shadowSmoothingStep?: number;
            depthTextureTarget?: GPUTexture;
            enableLighting?: boolean;
        },
        afterRender?: (pass: GPURenderPassEncoder) => void
    ): void {
        if (!this.device) return;
        if (depthTextureTarget && !this.isHD) return;

        if (this.gpuMultisampleTexture.width !== this.canvas.width || this.gpuMultisampleTexture.height !== this.canvas.height) {
            this.gpuMultisampleTexture.destroy();
            this.initGPUMultisampleTexture();
        }

        if (this.gpuDepthTexture.width !== this.canvas.width || this.gpuDepthTexture.height !== this.canvas.height) {
            this.gpuDepthTexture.destroy();
            this.initGPUDepthTexture();
        }

        let renderPassDescriptor: GPURenderPassDescriptor;
        if (depthTextureTarget) {
            renderPassDescriptor = {
                label: 'shadow renderPass',
                colorAttachments: [],
                depthStencilAttachment: {
                    view: depthTextureTarget.createView(),
                    depthClearValue: 1,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store'
                }
            };
        } else {
            renderPassDescriptor = this.gpuRenderPassDescriptor;
            if (MULTISAMPLE > 1) {
                this.gpuRenderPassDescriptor.colorAttachments[0].view =
                    this.gpuMultisampleTexture.createView();
                this.gpuRenderPassDescriptor.colorAttachments[0].resolveTarget =
                    targetView;
            } else {
                this.gpuRenderPassDescriptor.colorAttachments[0].view =
                    targetView;
                // Ensure we don't keep a stale resolveTarget from a previous MSAA configuration.
                (this.gpuRenderPassDescriptor.colorAttachments[0] as any).resolveTarget = undefined;
            }

            this.gpuRenderPassDescriptor.depthStencilAttachment = {
                view: this.gpuDepthTexture.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            };
        }

        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginRenderPass(renderPassDescriptor);

        if (env) {
            this.renderEnvironmentGPU(pass, mvMatrix, pMatrix);
        }

        // WebGPU shaders use texture-based bone lookup, so VS uniforms are just matrices.
        // IMPORTANT: uniform buffers are limited (~64KB), do not pack bone matrices here.
        const VSUniformsValues = new ArrayBuffer(128);
        new Float32Array(VSUniformsValues, 0, 16).set(mvMatrix);
        new Float32Array(VSUniformsValues, 64, 16).set(pMatrix);
        this.device.queue.writeBuffer(this.gpuVSUniformsBuffer, 0, VSUniformsValues);

        // Update bone matrix texture for this frame.
        this.updateGPUBoneTexture(this.modelInstance);

        for (let i = 0; i < this.model.Geosets.length; ++i) {
            const geoset = this.model.Geosets[i];
            if (this.rendererData.geosetAlpha[i] < 1e-6) {
                continue;
            }
            if (geoset.LevelOfDetail !== undefined && geoset.LevelOfDetail !== levelOfDetail) {
                continue;
            }

            if (wireframe && !this.wireframeIndexGPUBuffer[i]) {
                this.createWireframeGPUBuffer(i);
            }

            const materialID = geoset.MaterialID;
            const material = this.model.Materials[materialID];
            if (!material || !material.Layers || material.Layers.length === 0) {
                continue;
            }

            pass.setVertexBuffer(0, this.gpuVertexBuffer[i]);
            pass.setVertexBuffer(1, this.gpuNormalBuffer[i]);
            pass.setVertexBuffer(2, this.gpuTexCoordBuffer[i]);

            if (this.isHD) {
                pass.setVertexBuffer(3, this.gpuTangentBuffer[i]);
                pass.setVertexBuffer(4, this.gpuSkinWeightBuffer[i]);
                pass.setVertexBuffer(5, this.gpuSkinWeightBuffer[i]);
            } else {
                pass.setVertexBuffer(3, this.gpuGroupBuffer[i]);
            }

            pass.setIndexBuffer(wireframe ? this.wireframeIndexGPUBuffer[i] : this.gpuIndexBuffer[i], 'uint16');

            if (this.isHD) {
                const baseLayer = material.Layers[0];
                if (depthTextureTarget && !FILTER_MODES_WITH_DEPTH_WRITE.has(this.getNormalizedFilterMode(baseLayer.FilterMode))) {
                    continue;
                }
                const baseLayerAlpha = this.getLayerAlpha(baseLayer, this.modelInstance.interp) * this.rendererData.geosetAlpha[i];
                const pipeline = depthTextureTarget ?
                    this.gpuShadowPipeline :
                    (wireframe ? this.gpuWireframePipeline : this.getGPUPipeline(baseLayer));
                pass.setPipeline(pipeline);

                const textures = this.rendererData.materialLayerTextureID[materialID];
                const normalTextres = this.rendererData.materialLayerNormalTextureID[materialID];
                const ormTextres = this.rendererData.materialLayerOrmTextureID[materialID];
                const envTextres = this.rendererData.materialLayerReflectionTextureID[materialID];
                const diffuseTextureID = textures[0];
                const diffuseTexture = this.model.Textures[diffuseTextureID];
                const normalTextureID = baseLayer?.ShaderTypeId === 1 ? normalTextres[0] : textures[1];
                const normalTexture = this.model.Textures[normalTextureID];
                const ormTextureID = baseLayer?.ShaderTypeId === 1 ? ormTextres[0] : textures[2];
                const ormTexture = this.model.Textures[ormTextureID];
                const envTextureID = baseLayer?.ShaderTypeId === 1 ? envTextres[0] : textures[5];
                const envTexture = this.model.Textures[envTextureID];

                const envTextureImage = envTexture?.Image;
                const irradianceMap = this.rendererData.gpuIrradianceMap[envTextureImage];
                const prefilteredEnv = this.rendererData.gpuPrefilteredEnvMap[envTextureImage];

                const hasEnv = env && irradianceMap && prefilteredEnv;

                this.gpuFSUniformsBuffers[materialID] ||= [];
                let gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][0];

                if (!gpuFSUniformsBuffer) {
                    gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][0] = this.device.createBuffer({
                        label: `fs uniforms ${materialID}`,
                        size: 192,
                        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                    });
                }

                const tVetexAnim = this.modelInstance.getTexCoordMatrix(baseLayer);

                const FSUniformsValues = new ArrayBuffer(192);
                const FSUniformsViews = {
                    replaceableColor: new Float32Array(FSUniformsValues, 0, 3),
                    discardAlphaLevel: new Float32Array(FSUniformsValues, 12, 1),
                    tVertexAnim: new Float32Array(FSUniformsValues, 16, 12),
                    lightPos: new Float32Array(FSUniformsValues, 64, 3),
                    hasEnv: new Uint32Array(FSUniformsValues, 76, 1),
                    lightColor: new Float32Array(FSUniformsValues, 80, 3),
                    wireframe: new Uint32Array(FSUniformsValues, 92, 1),
                    cameraPos: new Float32Array(FSUniformsValues, 96, 3),
                    shadowParams: new Float32Array(FSUniformsValues, 112, 3),
                    layerAlpha: new Float32Array(FSUniformsValues, 124, 1),
                    shadowMapLightMatrix: new Float32Array(FSUniformsValues, 128, 16),
                };
                FSUniformsViews.replaceableColor.set(this.rendererData.teamColor);
                FSUniformsViews.discardAlphaLevel.set([this.getDiscardAlphaLevel(baseLayer.FilterMode)]);
                FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(0, 3));
                FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(3, 6), 4);
                FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(6, 9), 8);
                FSUniformsViews.lightPos.set(this.rendererData.lightPos);
                FSUniformsViews.lightColor.set(this.rendererData.lightColor);
                FSUniformsViews.cameraPos.set(this.rendererData.cameraPos);
                if (shadowMapTexture && shadowMapMatrix) {
                    FSUniformsViews.shadowParams.set([1, shadowBias ?? 1e-6, shadowSmoothingStep ?? 1 / 1024]);
                    FSUniformsViews.shadowMapLightMatrix.set(shadowMapMatrix);
                } else {
                    FSUniformsViews.shadowParams.set([0, 0, 0]);
                    FSUniformsViews.shadowMapLightMatrix.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
                }
                // HD: apply layer/geoset alpha via a single scalar, like WebGL.
                FSUniformsViews.layerAlpha.set([baseLayerAlpha]);
                FSUniformsViews.hasEnv.set([hasEnv ? 1 : 0]);
                FSUniformsViews.wireframe.set([wireframe ? 1 : 0]);
                this.device.queue.writeBuffer(gpuFSUniformsBuffer, 0, FSUniformsValues);

                const fsBindGroup = this.device.createBindGroup({
                    label: `fs uniforms ${materialID}`,
                    layout: this.fsBindGroupLayout,
                    entries: [
                        { binding: 0, resource: { buffer: gpuFSUniformsBuffer } },
                        { binding: 1, resource: this.rendererData.gpuSamplers[diffuseTextureID] },
                        { binding: 2, resource: (this.rendererData.gpuTextures[diffuseTexture.Image] || this.rendererData.gpuEmptyTexture).createView() },
                        { binding: 3, resource: this.rendererData.gpuSamplers[normalTextureID] },
                        { binding: 4, resource: (this.rendererData.gpuTextures[normalTexture?.Image] || this.rendererData.gpuEmptyTexture).createView() },
                        { binding: 5, resource: this.rendererData.gpuSamplers[ormTextureID] },
                        { binding: 6, resource: (this.rendererData.gpuTextures[ormTexture?.Image] || this.rendererData.gpuEmptyTexture).createView() },
                        { binding: 7, resource: this.rendererData.gpuDepthSampler },
                        { binding: 8, resource: (shadowMapTexture as GPUTexture || this.rendererData.gpuDepthEmptyTexture).createView() },
                        { binding: 9, resource: this.prefilterEnvSampler },
                        { binding: 10, resource: (irradianceMap as GPUTexture || this.rendererData.gpuEmptyCubeTexture).createView({ dimension: 'cube' }) },
                        { binding: 11, resource: this.prefilterEnvSampler },
                        { binding: 12, resource: (prefilteredEnv as GPUTexture || this.rendererData.gpuEmptyCubeTexture).createView({ dimension: 'cube' }) },
                        { binding: 13, resource: this.gpuBrdfSampler },
                        { binding: 14, resource: this.gpuBrdfLUT.createView() },
                    ]
                });

                pass.setBindGroup(0, this.gpuVSUniformsBindGroup);
                pass.setBindGroup(1, fsBindGroup);

                pass.drawIndexed(wireframe ? geoset.Faces.length * 2 : geoset.Faces.length);
            } else {
                // Match reference behavior: opaque first, then translucent layers sorted by filter mode.
                const layerOrder = Array.from({ length: material.Layers.length }, (_, idx) => idx);
                const opaqueLayers = layerOrder.filter((idx) => ((material.Layers[idx].FilterMode || 0) <= 1));
                const transparentLayers = layerOrder.filter((idx) => ((material.Layers[idx].FilterMode || 0) > 1));
                transparentLayers.sort((a, b) => (material.Layers[a].FilterMode || 0) - (material.Layers[b].FilterMode || 0));
                const orderedLayers = opaqueLayers.concat(transparentLayers);

                const geosetColor = this.modelInstance.findColor(i);
                const geosetAlpha = this.rendererData.geosetAlpha[i];

                for (const j of orderedLayers) {
                    const layer = material.Layers[j];
                    const textureID = this.rendererData.materialLayerTextureID[materialID][j];
                    const texture = this.model.Textures[textureID];

                    const layerAlpha = this.getLayerAlpha(layer, this.modelInstance.interp);
                    const pipeline = wireframe ? this.gpuWireframePipeline : this.getGPUPipeline(layer);
                    pass.setPipeline(pipeline);

                    this.gpuFSUniformsBuffers[materialID] ||= [];
                    let gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][j];

                    if (!gpuFSUniformsBuffer) {
                        gpuFSUniformsBuffer = this.gpuFSUniformsBuffers[materialID][j] = this.device.createBuffer({
                            label: `fs uniforms ${materialID} ${j}`,
                            size: 112,
                            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                        });
                    }

                    const tVetexAnim = this.modelInstance.getTexCoordMatrix(layer);

                    const FSUniformsValues = new ArrayBuffer(112);
                    const FSUniformsViews = {
                        replaceableColor: new Float32Array(FSUniformsValues, 0, 3),
                        replaceableType: new Uint32Array(FSUniformsValues, 12, 1),
                        discardAlphaLevel: new Float32Array(FSUniformsValues, 16, 1),
                        wireframe: new Uint32Array(FSUniformsValues, 20, 1),
                        tVertexAnim: new Float32Array(FSUniformsValues, 32, 12),
                        geosetColor: new Float32Array(FSUniformsValues, 80, 3),
                        layerAlpha: new Float32Array(FSUniformsValues, 92, 1),
                        geosetAlpha: new Float32Array(FSUniformsValues, 96, 1),
                    };
                    FSUniformsViews.replaceableColor.set(this.rendererData.teamColor);
                    FSUniformsViews.replaceableType.set([texture.ReplaceableId || 0]);
                    FSUniformsViews.discardAlphaLevel.set([this.getDiscardAlphaLevel(layer.FilterMode)]);
                    FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(0, 3));
                    FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(3, 6), 4);
                    FSUniformsViews.tVertexAnim.set(tVetexAnim.slice(6, 9), 8);
                    FSUniformsViews.wireframe.set([wireframe ? 1 : 0]);
                    FSUniformsViews.geosetColor.set(geosetColor as any);
                    FSUniformsViews.layerAlpha.set([layerAlpha]);
                    FSUniformsViews.geosetAlpha.set([geosetAlpha]);
                    this.device.queue.writeBuffer(gpuFSUniformsBuffer, 0, FSUniformsValues);

                    const fsBindGroup = this.device.createBindGroup({
                        label: `fs uniforms ${materialID} ${j}`,
                        layout: this.fsBindGroupLayout,
                        entries: [
                            { binding: 0, resource: { buffer: gpuFSUniformsBuffer } },
                            { binding: 1, resource: this.rendererData.gpuSamplers[textureID] },
                            { binding: 2, resource: (this.rendererData.gpuTextures[texture.Image] || this.rendererData.gpuEmptyTexture).createView() }
                        ]
                    });

                    pass.setBindGroup(0, this.gpuVSUniformsBindGroup);
                    pass.setBindGroup(1, fsBindGroup);

                    pass.drawIndexed(wireframe ? geoset.Faces.length * 2 : geoset.Faces.length);
                }
            }
        }

        this.modelInstance.particlesController.renderGPU(pass, mvMatrix, pMatrix);
        this.modelInstance.ribbonsController.renderGPU(pass, mvMatrix, pMatrix);

        afterRender?.(pass);

        pass.end();

        const commandBuffer = encoder.finish();
        this.device.queue.submit([commandBuffer]);
    }

    private renderEnvironmentGPU(pass: GPURenderPassEncoder, mvMatrix: mat4, pMatrix: mat4) {
        pass.setPipeline(this.envPiepeline);

        const VSUniformsValues = new ArrayBuffer(128);
        const VSUniformsViews = {
            mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
            pMatrix: new Float32Array(VSUniformsValues, 64, 16)
        };
        VSUniformsViews.mvMatrix.set(mvMatrix);
        VSUniformsViews.pMatrix.set(pMatrix);
        this.device.queue.writeBuffer(this.envVSUniformsBuffer, 0, VSUniformsValues);

        pass.setBindGroup(0, this.envVSBindGroup);

        for (const path in this.rendererData.gpuEnvTextures) {
            const fsUniformsBindGroup = this.device.createBindGroup({
                label: `env fs uniforms ${path}`,
                layout: this.envFSBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: this.envSampler
                    },
                    {
                        binding: 1,
                        resource: this.rendererData.gpuEnvTextures[path].createView({ dimension: 'cube' })
                    }
                ]
            });

            pass.setBindGroup(1, fsUniformsBindGroup);

            pass.setPipeline(this.envPiepeline);
            pass.setVertexBuffer(0, this.cubeGPUVertexBuffer);

            pass.draw(6 * 6);
        }
    }

    public renderEnvironment(mvMatrix: mat4, pMatrix: mat4): void {
        if (!isWebGL2(this.gl)) {
            return;
        }

        this.gl.disable(this.gl.BLEND);
        this.gl.disable(this.gl.DEPTH_TEST);
        this.gl.disable(this.gl.CULL_FACE);

        for (const path in this.rendererData.envTextures) {
            this.gl.useProgram(this.envSphere.program);

            this.gl.uniformMatrix4fv(this.envSphere.uniforms.uPMatrix, false, pMatrix);
            this.gl.uniformMatrix4fv(this.envSphere.uniforms.uMVMatrix, false, mvMatrix);

            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.rendererData.envTextures[path]);
            this.gl.uniform1i(this.envSphere.uniforms.uEnvironmentMap, 0);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
            this.gl.enableVertexAttribArray(this.envSphere.attributes.aPos);
            this.gl.vertexAttribPointer(this.envSphere.attributes.aPos, 3, this.gl.FLOAT, false, 0, 0);
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 6 * 6);
            this.gl.disableVertexAttribArray(this.envSphere.attributes.aPos);
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
        }
    }

    public raycast(rayOrigin: vec3, rayDir: vec3, mode: 'vertex' | 'face'): { geosetIndex: number, index: number, distance: number } | null {
        let closestIntersection: { geosetIndex: number, index: number, distance: number } | null = null;
        let minDistance = Infinity;

        const edge1 = tempEdge1;
        const edge2 = tempEdge2;
        const h = tempH;
        const s = tempS;
        const q = tempQ;
        const v0 = tempV0;
        const v1 = tempV1;
        const v2 = tempV2;


        for (let i = 0; i < this.model.Geosets.length; ++i) {
            const geoset = this.model.Geosets[i];
            // Skip hidden geosets
            if (this.rendererData.geosetAlpha[i] < 1e-6) continue;

            // Use current animated vertices if software skinning is active, otherwise use static vertices
            // Note: For hardware skinning, we might need to transform vertices on CPU or accept static mesh raycasting
            // For now, we'll use the static vertices from the model data, assuming T-pose or simple editing
            // TODO: Implement CPU-side skinning for accurate raycasting on animated models if needed

            const vertices = geoset.Vertices;
            const faces = geoset.Faces;

            if (mode === 'vertex') {
                for (let j = 0; j < vertices.length; j += 3) {
                    vec3.set(v0, vertices[j], vertices[j + 1], vertices[j + 2]);

                    // Transform v0 by node matrix if available (for static meshes this is usually identity or root)
                    // For rigorous implementation, we need to apply the weighted bone transformations
                    // Simplification: Check distance to ray

                    const rayToVertex = tempRayToVertex;
                    vec3.subtract(rayToVertex, v0, rayOrigin);
                    const projection = vec3.dot(rayToVertex, rayDir);

                    if (projection > 0) {
                        const projectedPoint = tempProjectedPoint;
                        vec3.scaleAndAdd(projectedPoint, rayOrigin, rayDir, projection);
                        const dist = vec3.distance(v0, projectedPoint);

                        // Threshold for vertex selection (e.g., 5 units)
                        if (dist < 5.0) {
                            const distanceToCamera = vec3.distance(rayOrigin, v0);

                            if (distanceToCamera < minDistance) {
                                minDistance = distanceToCamera;
                                closestIntersection = { geosetIndex: i, index: j / 3, distance: distanceToCamera };
                            }
                        }
                    }
                }
            } else if (mode === 'face') {
                for (let j = 0; j < faces.length; j += 3) {
                    const idx0 = faces[j] * 3;
                    const idx1 = faces[j + 1] * 3;
                    const idx2 = faces[j + 2] * 3;

                    vec3.set(v0, vertices[idx0], vertices[idx0 + 1], vertices[idx0 + 2]);
                    vec3.set(v1, vertices[idx1], vertices[idx1 + 1], vertices[idx1 + 2]);
                    vec3.set(v2, vertices[idx2], vertices[idx2 + 1], vertices[idx2 + 2]);

                    // Möller–Trumbore intersection algorithm
                    vec3.subtract(edge1, v1, v0);
                    vec3.subtract(edge2, v2, v0);
                    vec3.cross(h, rayDir, edge2);
                    const a = vec3.dot(edge1, h);

                    if (a > -1e-6 && a < 1e-6) continue; // Ray is parallel to triangle

                    const f = 1.0 / a;
                    vec3.subtract(s, rayOrigin, v0);
                    const u = f * vec3.dot(s, h);

                    if (u < 0.0 || u > 1.0) continue;

                    vec3.cross(q, s, edge1);
                    const v = f * vec3.dot(rayDir, q);

                    if (v < 0.0 || u + v > 1.0) continue;

                    const t = f * vec3.dot(edge2, q);

                    if (t > 1e-6 && t < minDistance) {
                        minDistance = t;
                        closestIntersection = { geosetIndex: i, index: j / 3, distance: t };
                    }
                }
            }
        }

        return closestIntersection;
    }

    public updateGeosetVertices(geosetIndex: number, vertices: Float32Array): void {
        if (geosetIndex < 0 || geosetIndex >= this.model.Geosets.length) {
            console.error('[ModelRenderer] Invalid geoset index:', geosetIndex);
            return;
        }

        const geoset = this.model.Geosets[geosetIndex];

        // Update local model data
        geoset.Vertices = vertices;

        // Update WebGL buffers
        if (this.softwareSkinning) {
            this.vertices[geosetIndex] = vertices;
        } else {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[geosetIndex]);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.DYNAMIC_DRAW);
        }

        // TODO: Update GPU buffers if using WebGPU
    }

    /**
     * @param mvMatrix
     * @param pMatrix
     * @param nodes Nodes to highlight. null means draw all
     */
    public renderSkeleton(mvMatrix: mat4, pMatrix: mat4, nodes: string[] | null, selectedNodeIds: number[] = []): void {
        const coords = [];
        const colors = [];
        const line = (node0: NodeWrapper, node1: NodeWrapper) => {
            vec3.transformMat4(tempPos, node0.node.PivotPoint, node0.matrix);
            coords.push(tempPos[0], tempPos[1], tempPos[2]);

            vec3.transformMat4(tempPos, node1.node.PivotPoint, node1.matrix);
            coords.push(tempPos[0], tempPos[1], tempPos[2]);

            // Default: Green [0, 1, 0]
            let r = 0, g = 1, b = 0;

            const id0 = node0.node.ObjectId;
            const id1 = node1.node.ObjectId;

            // Check relationships
            const isSelected = selectedNodeIds.includes(id0);
            const isChildOfSelected = selectedNodeIds.includes(id1);
            // Check if node0 is a parent of any selected node
            // This is O(N*M) but N (nodes) and M (selected) are usually small
            const isParentOfSelected = selectedNodeIds.some(selId => {
                const selNode = this.rendererData.nodes.find(n => n.node.ObjectId === selId);
                return selNode && selNode.node.Parent === id0;
            });

            if (isSelected) {
                // Selected: Red
                r = 1; g = 0; b = 0;
            } else if (isChildOfSelected) {
                // Child of Selected: Yellow
                r = 1; g = 1; b = 0;
            } else if (isParentOfSelected) {
                // Parent of Selected: Black
                r = 0; g = 0; b = 0;
            }

            // Push colors for both vertices of the line
            colors.push(r, g, b, r, g, b);
        };
        const updateNode = (node: NodeWrapper) => {
            if ((node.node.Parent !== undefined && node.node.Parent !== -1) && (!nodes || nodes.includes(node.node.Name))) {
                const parentNode = this.rendererData.nodes[node.node.Parent];
                if (parentNode) {
                    line(node, parentNode);
                }
            }
            for (const child of node.childs) {
                updateNode(child);
            }
        };
        updateNode(this.rendererData.rootNode);
        if (!coords.length) {
            return;
        }
        const vertexBuffer = new Float32Array(coords);
        const colorBuffer = new Float32Array(colors);

        if (this.device) {
            if (!this.skeletonShaderModule) {
                this.skeletonShaderModule = this.device.createShaderModule({
                    label: 'skeleton',
                    code: skeletonShaderSource
                });
            }

            if (!this.skeletonBindGroupLayout) {
                this.skeletonBindGroupLayout = this.device.createBindGroupLayout({
                    label: 'skeleton bind group layout',
                    entries: [{
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX,
                        buffer: {
                            type: 'uniform',
                            hasDynamicOffset: false,
                            minBindingSize: 128
                        }
                    }] as const
                });
            }

            if (!this.skeletonPipelineLayout) {
                this.skeletonPipelineLayout = this.device.createPipelineLayout({
                    label: 'skeleton pipeline layout',
                    bindGroupLayouts: [
                        this.skeletonBindGroupLayout
                    ]
                });
            }

            if (!this.skeletonPipeline) {
                this.skeletonPipeline = this.device.createRenderPipeline({
                    label: 'skeleton pipeline',
                    layout: this.skeletonPipelineLayout,
                    vertex: {
                        module: this.skeletonShaderModule,
                        entryPoint: 'vs',
                        buffers: [{
                            // vertices
                            arrayStride: 12,
                            attributes: [{
                                shaderLocation: 0,
                                offset: 0,
                                format: 'float32x3' as const
                            }]
                        }, {
                            // colors
                            arrayStride: 12,
                            attributes: [{
                                shaderLocation: 1,
                                offset: 0,
                                format: 'float32x3' as const
                            }]
                        }]
                    },
                    fragment: {
                        module: this.skeletonShaderModule,
                        entryPoint: 'fs',
                        targets: [{
                            format: navigator.gpu.getPreferredCanvasFormat(),
                            blend: {
                                color: {
                                    operation: 'add',
                                    srcFactor: 'src-alpha',
                                    dstFactor: 'one-minus-src-alpha'
                                },
                                alpha: {
                                    operation: 'add',
                                    srcFactor: 'one',
                                    dstFactor: 'one-minus-src-alpha'
                                }
                            } as const
                        }]
                    },
                    primitive: {
                        topology: 'line-list'
                    }
                });
            }

            // Reuse existing buffers if they are large enough to avoid expensive recreation
            if (!this.skeletonGPUVertexBuffer || this.skeletonGPUVertexBuffer.size < vertexBuffer.byteLength) {
                this.skeletonGPUVertexBuffer?.destroy();
                this.skeletonGPUVertexBuffer = this.device.createBuffer({
                    label: 'skeleton vertex',
                    size: Math.max(vertexBuffer.byteLength, 1024), // Minimum 1KB
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                });
            }
            this.device.queue.writeBuffer(this.skeletonGPUVertexBuffer, 0, vertexBuffer);

            if (!this.skeletonGPUColorBuffer || this.skeletonGPUColorBuffer.size < colorBuffer.byteLength) {
                this.skeletonGPUColorBuffer?.destroy();
                this.skeletonGPUColorBuffer = this.device.createBuffer({
                    label: 'skeleton color',
                    size: Math.max(colorBuffer.byteLength, 1024),
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                });
            }
            this.device.queue.writeBuffer(this.skeletonGPUColorBuffer, 0, colorBuffer);

            if (!this.skeletonGPUUniformsBuffer) {
                this.skeletonGPUUniformsBuffer = this.device.createBuffer({
                    label: 'skeleton vs uniforms',
                    size: 128,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                });
            }

            const uniformsBuffer = this.skeletonGPUUniformsBuffer;
            const vertex = this.skeletonGPUVertexBuffer;
            const color = this.skeletonGPUColorBuffer;

            const uniformsBindGroup = this.device.createBindGroup({
                label: 'skeleton uniforms bind group',
                layout: this.skeletonBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: uniformsBuffer }
                    }
                ]
            });


            const renderPassDescriptor: GPURenderPassDescriptor = {
                label: 'skeleton renderPass',
                colorAttachments: [{
                    view: this.gpuContext.getCurrentTexture().createView(),
                    clearValue: [0.15, 0.15, 0.15, 1],
                    loadOp: 'load',
                    storeOp: 'store'
                }] as const
            };

            const encoder = this.device.createCommandEncoder();
            const pass = encoder.beginRenderPass(renderPassDescriptor);

            const VSUniformsValues = new ArrayBuffer(128);
            const VSUniformsViews = {
                mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
                pMatrix: new Float32Array(VSUniformsValues, 64, 16),
            };
            VSUniformsViews.mvMatrix.set(mvMatrix);
            VSUniformsViews.pMatrix.set(pMatrix);
            this.device.queue.writeBuffer(uniformsBuffer, 0, VSUniformsValues);

            pass.setVertexBuffer(0, vertex);
            pass.setVertexBuffer(1, color);
            pass.setPipeline(this.skeletonPipeline);
            pass.setBindGroup(0, uniformsBindGroup);

            pass.draw(vertexBuffer.length / 3);
            pass.end();

            const commandBuffer = encoder.finish();
            this.device.queue.submit([commandBuffer]);

            return;
        }

        if (!this.skeletonShaderProgram) {
            this.skeletonShaderProgram = this.initSkeletonShaderProgram();
        }

        this.gl.disable(this.gl.BLEND);
        this.gl.disable(this.gl.DEPTH_TEST);

        this.gl.useProgram(this.skeletonShaderProgram);

        this.gl.uniformMatrix4fv(this.skeletonShaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.skeletonShaderProgramLocations.mvMatrixUniform, false, mvMatrix);

        this.gl.enableVertexAttribArray(this.skeletonShaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.skeletonShaderProgramLocations.colorAttribute);

        if (!this.skeletonVertexBuffer) {
            this.skeletonVertexBuffer = this.gl.createBuffer();
        }
        if (!this.skeletonColorBuffer) {
            this.skeletonColorBuffer = this.gl.createBuffer();
        }

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.skeletonVertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexBuffer, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.skeletonShaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.skeletonColorBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, colorBuffer, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.skeletonShaderProgramLocations.colorAttribute, 3, this.gl.FLOAT, false, 0, 0);

        this.gl.drawArrays(this.gl.LINES, 0, vertexBuffer.length / 3);

        this.gl.disableVertexAttribArray(this.skeletonShaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.skeletonShaderProgramLocations.colorAttribute);
    }

    private initSkeletonShaderProgram(): WebGLProgram {
        const vertex = this.skeletonVertexShader = getShader(this.gl, skeletonVertexShader, this.gl.VERTEX_SHADER);
        const fragment = this.skeletonFragmentShader = getShader(this.gl, skeletonFragmentShader, this.gl.FRAGMENT_SHADER);

        const shaderProgram = this.gl.createProgram();
        this.gl.attachShader(shaderProgram, vertex);
        this.gl.attachShader(shaderProgram, fragment);
        this.gl.linkProgram(shaderProgram);

        if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) {
            alert('Could not initialise shaders');
        }

        this.gl.useProgram(shaderProgram);

        this.skeletonShaderProgramLocations.vertexPositionAttribute = this.gl.getAttribLocation(shaderProgram, 'aVertexPosition');
        this.skeletonShaderProgramLocations.colorAttribute = this.gl.getAttribLocation(shaderProgram, 'aColor');
        this.skeletonShaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uPMatrix');
        this.skeletonShaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uMVMatrix');

        return shaderProgram;
    }



    private setTextureParameters(flags: TextureFlags | 0, hasMipmaps: boolean) {
        if (flags & TextureFlags.WrapWidth) {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
        } else {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        }
        if (flags & TextureFlags.WrapHeight) {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
        } else {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        }
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, hasMipmaps ? this.gl.LINEAR_MIPMAP_NEAREST : this.gl.LINEAR);

        if (this.anisotropicExt) {
            const max = this.gl.getParameter(this.anisotropicExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
            this.gl.texParameterf(this.gl.TEXTURE_2D, this.anisotropicExt.TEXTURE_MAX_ANISOTROPY_EXT, max);
        }
    }

    private processEnvMaps(path: string): void {
        if (
            !this.rendererData.requiredEnvMaps[path] ||
            !(this.rendererData.textures[path] || this.rendererData.gpuTextures[path]) ||
            !(isWebGL2(this.gl) || this.device) ||
            !(this.colorBufferFloatExt || this.device)
        ) {
            return;
        }

        if (this.gl) {
            this.gl.disable(this.gl.BLEND);
            this.gl.disable(this.gl.DEPTH_TEST);
            this.gl.disable(this.gl.CULL_FACE);
        }

        const pMatrix = mat4.create();
        const mvMatrix = mat4.create();
        const eye = vec3.fromValues(0, 0, 0);
        let center;
        let up;
        if (this.device) {
            center = [
                vec3.fromValues(1, 0, 0),
                vec3.fromValues(-1, 0, 0),
                vec3.fromValues(0, -1, 0),
                vec3.fromValues(0, 1, 0),
                vec3.fromValues(0, 0, 1),
                vec3.fromValues(0, 0, -1)
            ];
            up = [
                vec3.fromValues(0, -1, 0),
                vec3.fromValues(0, -1, 0),
                vec3.fromValues(0, 0, -1),
                vec3.fromValues(0, 0, 1),
                vec3.fromValues(0, -1, 0),
                vec3.fromValues(0, -1, 0)
            ];
        } else {
            center = [
                vec3.fromValues(1, 0, 0),
                vec3.fromValues(-1, 0, 0),
                vec3.fromValues(0, 1, 0),
                vec3.fromValues(0, -1, 0),
                vec3.fromValues(0, 0, 1),
                vec3.fromValues(0, 0, -1)
            ];
            up = [
                vec3.fromValues(0, -1, 0),
                vec3.fromValues(0, -1, 0),
                vec3.fromValues(0, 0, 1),
                vec3.fromValues(0, 0, -1),
                vec3.fromValues(0, -1, 0),
                vec3.fromValues(0, -1, 0)
            ];
        }

        mat4.perspective(pMatrix, Math.PI / 2, 1, .1, 10);

        let framebuffer: WebGLFramebuffer;
        let cubemap: WebGLTexture;
        let gpuCubemap: GPUTexture;

        if (this.device) {
            gpuCubemap = this.rendererData.gpuEnvTextures[path] = this.device.createTexture({
                label: `env cubemap ${path}`,
                size: [ENV_MAP_SIZE, ENV_MAP_SIZE, 6],
                format: navigator.gpu.getPreferredCanvasFormat(),
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                mipLevelCount: MAX_ENV_MIP_LEVELS
            });

            const encoder = this.device.createCommandEncoder({
                label: 'env to cubemap'
            });
            const buffers: GPUBuffer[] = [];

            for (let i = 0; i < 6; ++i) {
                mat4.lookAt(mvMatrix, eye, center[i], up[i]);

                const pass = encoder.beginRenderPass({
                    label: 'env to cubemap',
                    colorAttachments: [{
                        view: gpuCubemap.createView({
                            dimension: '2d',
                            baseArrayLayer: i,
                            baseMipLevel: 0,
                            mipLevelCount: 1
                        }),
                        clearValue: [0, 0, 0, 1],
                        loadOp: 'clear',
                        storeOp: 'store'
                    }] as const
                });

                const VSUniformsValues = new ArrayBuffer(128);
                const VSUniformsViews = {
                    mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
                    pMatrix: new Float32Array(VSUniformsValues, 64, 16)
                };
                VSUniformsViews.mvMatrix.set(mvMatrix);
                VSUniformsViews.pMatrix.set(pMatrix);
                const buffer = this.device.createBuffer({
                    label: `env to cubemap vs uniforms ${i}`,
                    size: 128,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                });
                buffers.push(buffer);
                this.device.queue.writeBuffer(buffer, 0, VSUniformsValues);

                const bindGroup = this.device.createBindGroup({
                    label: `env to cubemap vs bind group ${i}`,
                    layout: this.envToCubemapVSBindGroupLayout,
                    entries: [
                        {
                            binding: 0,
                            resource: { buffer }
                        }
                    ]
                });

                pass.setBindGroup(0, bindGroup);

                const fsUniformsBindGroup = this.device.createBindGroup({
                    label: `env to cubemap fs uniforms ${i}`,
                    layout: this.envToCubemapFSBindGroupLayout,
                    entries: [
                        {
                            binding: 0,
                            resource: this.envToCubemapSampler
                        },
                        {
                            binding: 1,
                            resource: this.rendererData.gpuTextures[path].createView()
                        }
                    ]
                });

                pass.setBindGroup(1, fsUniformsBindGroup);

                pass.setPipeline(this.envToCubemapPiepeline);
                pass.setVertexBuffer(0, this.cubeGPUVertexBuffer);

                pass.draw(6 * 6);

                pass.end();
            }

            const commandBuffer = encoder.finish();
            this.device.queue.submit([commandBuffer]);
            this.device.queue.onSubmittedWorkDone().finally(() => {
                buffers.forEach(buffer => {
                    buffer.destroy();
                });
            });
        } else if (isWebGL2(this.gl)) {
            framebuffer = this.gl.createFramebuffer();

            this.gl.useProgram(this.envToCubemap.program);

            cubemap = this.rendererData.envTextures[path] = this.gl.createTexture();
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, cubemap);
            for (let i = 0; i < 6; ++i) {
                this.gl.texImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, this.gl.RGBA16F, ENV_MAP_SIZE, ENV_MAP_SIZE, 0, this.gl.RGBA, this.gl.FLOAT, null);
            }

            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_R, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
            this.gl.enableVertexAttribArray(this.envToCubemap.attributes.aPos);
            this.gl.vertexAttribPointer(this.envToCubemap.attributes.aPos, 3, this.gl.FLOAT, false, 0, 0);

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);

            this.gl.uniformMatrix4fv(this.envToCubemap.uniforms.uPMatrix, false, pMatrix);
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[path]);
            this.gl.uniform1i(this.envToCubemap.uniforms.uEquirectangularMap, 0);
            this.gl.viewport(0, 0, ENV_MAP_SIZE, ENV_MAP_SIZE);
            for (let i = 0; i < 6; ++i) {
                this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, cubemap, 0);
                this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

                mat4.lookAt(mvMatrix, eye, center[i], up[i]);
                this.gl.uniformMatrix4fv(this.envToCubemap.uniforms.uMVMatrix, false, mvMatrix);

                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6 * 6);
            }

            this.gl.disableVertexAttribArray(this.envToCubemap.attributes.aPos);

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        }

        // generate mips
        if (this.device) {
            generateMips(this.device, gpuCubemap);
        } else {
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, cubemap);
            this.gl.generateMipmap(this.gl.TEXTURE_CUBE_MAP);

            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
        }

        // Diffuse env convolution

        if (this.device) {
            gpuCubemap = this.rendererData.gpuIrradianceMap[path] = this.device.createTexture({
                label: `convolute diffuse ${path}`,
                size: [ENV_CONVOLUTE_DIFFUSE_SIZE, ENV_CONVOLUTE_DIFFUSE_SIZE, 6],
                format: navigator.gpu.getPreferredCanvasFormat(),
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                mipLevelCount: 5
            });

            const encoder = this.device.createCommandEncoder({
                label: 'convolute diffuse'
            });
            const buffers: GPUBuffer[] = [];

            for (let i = 0; i < 6; ++i) {
                mat4.lookAt(mvMatrix, eye, center[i], up[i]);

                const pass = encoder.beginRenderPass({
                    label: 'convolute diffuse',
                    colorAttachments: [{
                        view: gpuCubemap.createView({
                            dimension: '2d',
                            baseArrayLayer: i,
                            baseMipLevel: 0,
                            mipLevelCount: 1
                        }),
                        clearValue: [0, 0, 0, 1],
                        loadOp: 'clear',
                        storeOp: 'store'
                    }] as const
                });

                const VSUniformsValues = new ArrayBuffer(128);
                const VSUniformsViews = {
                    mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
                    pMatrix: new Float32Array(VSUniformsValues, 64, 16)
                };
                VSUniformsViews.mvMatrix.set(mvMatrix);
                VSUniformsViews.pMatrix.set(pMatrix);
                const buffer = this.device.createBuffer({
                    label: `convolute diffuse vs uniforms ${i}`,
                    size: 128,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                });
                buffers.push(buffer);
                this.device.queue.writeBuffer(buffer, 0, VSUniformsValues);

                const bindGroup = this.device.createBindGroup({
                    label: `convolute diffuse vs bind group ${i}`,
                    layout: this.convoluteDiffuseEnvVSBindGroupLayout,
                    entries: [
                        {
                            binding: 0,
                            resource: { buffer }
                        }
                    ]
                });

                pass.setBindGroup(0, bindGroup);

                const fsUniformsBindGroup = this.device.createBindGroup({
                    label: `convolute diffuse fs uniforms ${i}`,
                    layout: this.convoluteDiffuseEnvFSBindGroupLayout,
                    entries: [
                        {
                            binding: 0,
                            resource: this.convoluteDiffuseEnvSampler
                        },
                        {
                            binding: 1,
                            resource: this.rendererData.gpuEnvTextures[path].createView({
                                dimension: 'cube'
                            })
                        }
                    ]
                });

                pass.setBindGroup(1, fsUniformsBindGroup);

                pass.setPipeline(this.convoluteDiffuseEnvPiepeline);
                pass.setVertexBuffer(0, this.cubeGPUVertexBuffer);

                pass.draw(6 * 6);

                pass.end();
            }

            const commandBuffer = encoder.finish();
            this.device.queue.submit([commandBuffer]);
            this.device.queue.onSubmittedWorkDone().finally(() => {
                buffers.forEach(buffer => {
                    buffer.destroy();
                });
            });
        } else if (isWebGL2(this.gl)) {
            this.gl.useProgram(this.convoluteDiffuseEnv.program);
            const diffuseCubemap = this.rendererData.irradianceMap[path] = this.gl.createTexture();

            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, diffuseCubemap);
            for (let i = 0; i < 6; ++i) {
                this.gl.texImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, this.gl.RGBA16F, ENV_CONVOLUTE_DIFFUSE_SIZE, ENV_CONVOLUTE_DIFFUSE_SIZE, 0, this.gl.RGBA, this.gl.FLOAT, null);
            }

            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_R, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
            this.gl.enableVertexAttribArray(this.convoluteDiffuseEnv.attributes.aPos);
            this.gl.vertexAttribPointer(this.convoluteDiffuseEnv.attributes.aPos, 3, this.gl.FLOAT, false, 0, 0);

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);

            this.gl.uniformMatrix4fv(this.convoluteDiffuseEnv.uniforms.uPMatrix, false, pMatrix);
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.rendererData.envTextures[path]);
            this.gl.uniform1i(this.convoluteDiffuseEnv.uniforms.uEnvironmentMap, 0);
            this.gl.viewport(0, 0, ENV_CONVOLUTE_DIFFUSE_SIZE, ENV_CONVOLUTE_DIFFUSE_SIZE);
            for (let i = 0; i < 6; ++i) {
                this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, diffuseCubemap, 0);
                this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

                mat4.lookAt(mvMatrix, eye, center[i], up[i]);
                this.gl.uniformMatrix4fv(this.convoluteDiffuseEnv.uniforms.uMVMatrix, false, mvMatrix);

                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6 * 6);
            }

            this.gl.disableVertexAttribArray(this.convoluteDiffuseEnv.attributes.aPos);

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, diffuseCubemap);
            this.gl.generateMipmap(this.gl.TEXTURE_CUBE_MAP);
        }

        // Prefilter env map with different roughness

        if (this.device) {
            const prefilterEnv = this.rendererData.gpuPrefilteredEnvMap[path] = this.device.createTexture({
                label: `prefilter env ${path}`,
                size: [ENV_PREFILTER_SIZE, ENV_PREFILTER_SIZE, 6],
                format: navigator.gpu.getPreferredCanvasFormat(),
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                mipLevelCount: MAX_ENV_MIP_LEVELS
            });

            const encoder = this.device.createCommandEncoder({
                label: 'prefilter env'
            });
            const buffers: GPUBuffer[] = [];

            for (let mip = 0; mip < MAX_ENV_MIP_LEVELS; ++mip) {
                const FSUniformsValues = new ArrayBuffer(4);
                const FSUniformsViews = {
                    roughness: new Float32Array(FSUniformsValues),
                };
                const roughness = mip / (MAX_ENV_MIP_LEVELS - 1);
                FSUniformsViews.roughness.set([roughness]);
                const fsBuffer = this.device.createBuffer({
                    label: `prefilter env fs uniforms ${mip}`,
                    size: 4,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                });
                buffers.push(fsBuffer);
                this.device.queue.writeBuffer(fsBuffer, 0, FSUniformsValues);

                const fsUniformsBindGroup = this.device.createBindGroup({
                    label: `prefilter env fs uniforms ${mip}`,
                    layout: this.prefilterEnvFSBindGroupLayout,
                    entries: [
                        {
                            binding: 0,
                            resource: {
                                buffer: fsBuffer
                            }
                        },
                        {
                            binding: 1,
                            resource: this.prefilterEnvSampler
                        },
                        {
                            binding: 2,
                            resource: this.rendererData.gpuEnvTextures[path].createView({
                                dimension: 'cube'
                            })
                        }
                    ]
                });

                for (let i = 0; i < 6; ++i) {
                    const pass = encoder.beginRenderPass({
                        label: 'prefilter env',
                        colorAttachments: [{
                            view: prefilterEnv.createView({
                                dimension: '2d',
                                baseArrayLayer: i,
                                baseMipLevel: mip,
                                mipLevelCount: 1
                            }),
                            clearValue: [0, 0, 0, 1],
                            loadOp: 'clear',
                            storeOp: 'store'
                        }] as const
                    });

                    mat4.lookAt(mvMatrix, eye, center[i], up[i]);

                    const VSUniformsValues = new ArrayBuffer(128);
                    const VSUniformsViews = {
                        mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
                        pMatrix: new Float32Array(VSUniformsValues, 64, 16)
                    };
                    VSUniformsViews.mvMatrix.set(mvMatrix);
                    VSUniformsViews.pMatrix.set(pMatrix);
                    const vsBuffer = this.device.createBuffer({
                        label: 'prefilter env vs uniforms',
                        size: 128,
                        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                    });
                    buffers.push(vsBuffer);
                    this.device.queue.writeBuffer(vsBuffer, 0, VSUniformsValues);

                    const fsBindGroup = this.device.createBindGroup({
                        label: 'prefilter env vs bind group',
                        layout: this.prefilterEnvVSBindGroupLayout,
                        entries: [
                            {
                                binding: 0,
                                resource: { buffer: vsBuffer }
                            }
                        ]
                    });

                    pass.setPipeline(this.prefilterEnvPiepeline);

                    pass.setBindGroup(0, fsBindGroup);
                    pass.setBindGroup(1, fsUniformsBindGroup);

                    pass.setVertexBuffer(0, this.cubeGPUVertexBuffer);

                    pass.draw(6 * 6);

                    pass.end();
                }
            }

            const commandBuffer = encoder.finish();
            this.device.queue.submit([commandBuffer]);
            this.device.queue.onSubmittedWorkDone().finally(() => {
                buffers.forEach(buffer => {
                    buffer.destroy();
                });
            });
        } else if (isWebGL2(this.gl)) {
            this.gl.useProgram(this.prefilterEnv.program);

            const prefilterCubemap = this.rendererData.prefilteredEnvMap[path] = this.gl.createTexture();
            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, prefilterCubemap);
            this.gl.texStorage2D(this.gl.TEXTURE_CUBE_MAP, MAX_ENV_MIP_LEVELS, this.gl.RGBA16F, ENV_PREFILTER_SIZE, ENV_PREFILTER_SIZE);
            // for (let i = 0; i < 6; ++i) {
            // this.gl.texImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, this.gl.RGB, ENV_PREFILTER_SIZE, ENV_PREFILTER_SIZE, 0, this.gl.RGB, this.gl.UNSIGNED_BYTE, null);
            // }
            for (let mip = 0; mip < MAX_ENV_MIP_LEVELS; ++mip) {
                for (let i = 0; i < 6; ++i) {
                    const size = ENV_PREFILTER_SIZE * .5 ** mip;
                    const data = new Float32Array(size * size * 4);
                    this.gl.texSubImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, mip, 0, 0, size, size, this.gl.RGBA, this.gl.FLOAT, data);
                }
            }

            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_WRAP_R, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
            this.gl.enableVertexAttribArray(this.prefilterEnv.attributes.aPos);
            this.gl.vertexAttribPointer(this.prefilterEnv.attributes.aPos, 3, this.gl.FLOAT, false, 0, 0);

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);

            this.gl.uniformMatrix4fv(this.prefilterEnv.uniforms.uPMatrix, false, pMatrix);
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.rendererData.envTextures[path]);
            this.gl.uniform1i(this.prefilterEnv.uniforms.uEnvironmentMap, 0);

            for (let mip = 0; mip < MAX_ENV_MIP_LEVELS; ++mip) {
                const mipWidth = ENV_PREFILTER_SIZE * .5 ** mip;
                const mipHeight = ENV_PREFILTER_SIZE * .5 ** mip;
                this.gl.viewport(0, 0, mipWidth, mipHeight);

                const roughness = mip / (MAX_ENV_MIP_LEVELS - 1);

                this.gl.uniform1f(this.prefilterEnv.uniforms.uRoughness, roughness);

                for (let i = 0; i < 6; ++i) {
                    this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, prefilterCubemap, mip);
                    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

                    mat4.lookAt(mvMatrix, eye, center[i], up[i]);
                    this.gl.uniformMatrix4fv(this.prefilterEnv.uniforms.uMVMatrix, false, mvMatrix);

                    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6 * 6);
                }
            }

            // cleanup

            this.gl.activeTexture(this.gl.TEXTURE1);
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
            this.gl.deleteFramebuffer(framebuffer);
        }
    }

    private initShaderProgram<A extends string, U extends string>(
        vertex: string,
        fragment: string,
        attributesDesc: Record<A, string>,
        uniformsDesc: Record<U, string>
    ): WebGLProgramObject<A, U> {
        const vertexShader = getShader(this.gl, vertex, this.gl.VERTEX_SHADER);
        const fragmentShader = getShader(this.gl, fragment, this.gl.FRAGMENT_SHADER);
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            throw new Error('Could not initialise shaders');
        }

        const attributes = {} as Record<A, GLuint>;
        for (const name in attributesDesc) {
            attributes[name] = this.gl.getAttribLocation(program, name);
            if (attributes[name] < 0) {
                throw new Error('Missing shader attribute location: ' + name);
            }
        }

        const uniforms = {} as Record<U, WebGLUniformLocation>;
        for (const name in uniformsDesc) {
            uniforms[name] = this.gl.getUniformLocation(program, name);
            if (!uniforms[name]) {
                throw new Error('Missing shader uniform location: ' + name);
            }
        }

        return {
            program,
            vertexShader,
            fragmentShader,
            attributes,
            uniforms
        };
    }

    private destroyShaderProgramObject<A extends string, U extends string>(object: WebGLProgramObject<A, U>): void {
        if (object && object.program) {
            if (object.vertexShader) {
                this.gl.detachShader(object.program, object.vertexShader);
                this.gl.deleteShader(object.vertexShader);
                object.vertexShader = null;
            }
            if (object.fragmentShader) {
                this.gl.detachShader(object.program, object.fragmentShader);
                this.gl.deleteShader(object.fragmentShader);
                object.fragmentShader = null;
            }
            this.gl.deleteProgram(object.program);
            object.program = null;
        }
    }

    private initShaders(): void {
        if (this.shaderProgram) {
            return;
        }

        let vertexShaderSource;
        if (this.isHD) {
            vertexShaderSource = isWebGL2(this.gl) ? vertexShaderHDHardwareSkinningNew : vertexShaderHDHardwareSkinningOld;
        } else if (this.softwareSkinning) {
            vertexShaderSource = vertexShaderSoftwareSkinning;
        } else {
            vertexShaderSource = vertexShaderHardwareSkinning;
        }

        let fragmentShaderSource;
        if (this.isHD) {
            fragmentShaderSource = isWebGL2(this.gl) ? fragmentShaderHDNew : fragmentShaderHDOld;
        } else {
            fragmentShaderSource = fragmentShader;
        }

        const vertex = this.vertexShader = getShader(this.gl, vertexShaderSource, this.gl.VERTEX_SHADER);
        const fragment = this.fragmentShader = getShader(this.gl, fragmentShaderSource, this.gl.FRAGMENT_SHADER);

        const shaderProgram = this.shaderProgram = this.gl.createProgram();
        this.gl.attachShader(shaderProgram, vertex);
        this.gl.attachShader(shaderProgram, fragment);
        this.gl.linkProgram(shaderProgram);

        if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) {
            const linkError = this.gl.getProgramInfoLog(shaderProgram);
            console.error('Shader Program Link Error:', linkError);
            alert('Could not initialise shaders: ' + linkError);
        }

        this.gl.useProgram(shaderProgram);

        this.shaderProgramLocations.vertexPositionAttribute = this.gl.getAttribLocation(shaderProgram, 'aVertexPosition');
        this.shaderProgramLocations.normalsAttribute = this.gl.getAttribLocation(shaderProgram, 'aNormal');
        this.shaderProgramLocations.textureCoordAttribute = this.gl.getAttribLocation(shaderProgram, 'aTextureCoord');

        /*
        //         console.log('[initShaders] Attribute locations:', {
                    vertexPosition: this.shaderProgramLocations.vertexPositionAttribute,
                    normals: this.shaderProgramLocations.normalsAttribute,
                    textureCoord: this.shaderProgramLocations.textureCoordAttribute,
                    isHD: this.isHD,
                    softwareSkinning: this.softwareSkinning
                });
        */
        if (this.isHD) {
            this.shaderProgramLocations.skinAttribute = this.gl.getAttribLocation(shaderProgram, 'aSkin');
            this.shaderProgramLocations.weightAttribute = this.gl.getAttribLocation(shaderProgram, 'aBoneWeight');
            this.shaderProgramLocations.tangentAttribute = this.gl.getAttribLocation(shaderProgram, 'aTangent');
        } else {
            if (!this.softwareSkinning) {
                this.shaderProgramLocations.groupAttribute = this.gl.getAttribLocation(shaderProgram, 'aGroup');
            }
        }

        this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uPMatrix');
        this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uMVMatrix');
        this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(shaderProgram, 'uSampler');
        this.shaderProgramLocations.replaceableColorUniform = this.gl.getUniformLocation(shaderProgram, 'uReplaceableColor');
        this.shaderProgramLocations.geosetColorUniform = this.gl.getUniformLocation(shaderProgram, 'uGeosetColor');
        if (this.isHD) {
            this.shaderProgramLocations.normalSamplerUniform = this.gl.getUniformLocation(shaderProgram, 'uNormalSampler');
            this.shaderProgramLocations.ormSamplerUniform = this.gl.getUniformLocation(shaderProgram, 'uOrmSampler');
            this.shaderProgramLocations.lightPosUniform = this.gl.getUniformLocation(shaderProgram, 'uLightPos');
            this.shaderProgramLocations.lightColorUniform = this.gl.getUniformLocation(shaderProgram, 'uLightColor');
            this.shaderProgramLocations.cameraPosUniform = this.gl.getUniformLocation(shaderProgram, 'uCameraPos');

            this.shaderProgramLocations.shadowParamsUniform = this.gl.getUniformLocation(shaderProgram, 'uShadowParams');
            this.shaderProgramLocations.shadowMapSamplerUniform = this.gl.getUniformLocation(shaderProgram, 'uShadowMapSampler');
            this.shaderProgramLocations.shadowMapLightMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uShadowMapLightMatrix');

            this.shaderProgramLocations.hasEnvUniform = this.gl.getUniformLocation(shaderProgram, 'uHasEnv');
            this.shaderProgramLocations.irradianceMapUniform = this.gl.getUniformLocation(shaderProgram, 'uIrradianceMap');
            this.shaderProgramLocations.prefilteredEnvUniform = this.gl.getUniformLocation(shaderProgram, 'uPrefilteredEnv');
            this.shaderProgramLocations.brdfLUTUniform = this.gl.getUniformLocation(shaderProgram, 'uBRDFLUT');
        } else {
            this.shaderProgramLocations.replaceableTypeUniform = this.gl.getUniformLocation(shaderProgram, 'uReplaceableType');
        }
        this.shaderProgramLocations.discardAlphaLevelUniform = this.gl.getUniformLocation(shaderProgram, 'uDiscardAlphaLevel');
        this.shaderProgramLocations.layerAlphaUniform = this.gl.getUniformLocation(shaderProgram, 'uLayerAlpha');
        this.shaderProgramLocations.geosetAlphaUniform = this.gl.getUniformLocation(shaderProgram, 'uGeosetAlpha');
        this.shaderProgramLocations.tVertexAnimUniform = this.gl.getUniformLocation(shaderProgram, 'uTVertexAnim');
        this.shaderProgramLocations.wireframeUniform = this.gl.getUniformLocation(shaderProgram, 'uWireframe');

        if (!this.isHD) {
            this.shaderProgramLocations.lightDirUniform = this.gl.getUniformLocation(shaderProgram, 'uLightDir');
            this.shaderProgramLocations.lightColorUniform = this.gl.getUniformLocation(shaderProgram, 'uLightColor');
            this.shaderProgramLocations.ambientColorUniform = this.gl.getUniformLocation(shaderProgram, 'uAmbientColor');
            this.shaderProgramLocations.unshadedUniform = this.gl.getUniformLocation(shaderProgram, 'uUnshaded');
            this.shaderProgramLocations.enableLightingUniform = this.gl.getUniformLocation(shaderProgram, 'uEnableLighting');
        }

        // Bone texture uniforms (replaces per-bone uniform locations)
        if (!this.softwareSkinning) {
            this.shaderProgramLocations.boneTextureUniform = this.gl.getUniformLocation(shaderProgram, 'uBoneTexture');
            this.shaderProgramLocations.boneTextureWidthUniform = this.gl.getUniformLocation(shaderProgram, 'uBoneTextureWidth');
            this.shaderProgramLocations.boneTextureHeightUniform = this.gl.getUniformLocation(shaderProgram, 'uBoneTextureHeight');
            // Initialize bone texture
            this.initBoneTexture();
        }

        if (this.isHD && isWebGL2(this.gl)) {
            this.envToCubemap = this.initShaderProgram(envToCubemapVertexShader, envToCubemapFragmentShader, {
                aPos: 'aPos'
            }, {
                uPMatrix: 'uPMatrix',
                uMVMatrix: 'uMVMatrix',
                uEquirectangularMap: 'uEquirectangularMap'
            });

            this.envSphere = this.initShaderProgram(envVertexShader, envFragmentShader, {
                aPos: 'aPos'
            }, {
                uPMatrix: 'uPMatrix',
                uMVMatrix: 'uMVMatrix',
                uEnvironmentMap: 'uEnvironmentMap'
            });

            this.convoluteDiffuseEnv = this.initShaderProgram(convoluteEnvDiffuseVertexShader, convoluteEnvDiffuseFragmentShader, {
                aPos: 'aPos'
            }, {
                uPMatrix: 'uPMatrix',
                uMVMatrix: 'uMVMatrix',
                uEnvironmentMap: 'uEnvironmentMap'
            });

            this.prefilterEnv = this.initShaderProgram(prefilterEnvVertexShader, prefilterEnvFragmentShader, {
                aPos: 'aPos'
            }, {
                uPMatrix: 'uPMatrix',
                uMVMatrix: 'uMVMatrix',
                uEnvironmentMap: 'uEnvironmentMap',
                uRoughness: 'uRoughness'
            });

            this.integrateBRDF = this.initShaderProgram(integrateBRDFVertexShader, integrateBRDFFragmentShader, {
                aPos: 'aPos'
            }, {});
        }
    }

    private initGPUShaders(): void {
        if (this.gpuShaderModule) {
            return;
        }

        this.gpuShaderModule = this.device.createShaderModule({
            label: 'main',
            code: this.isHD ? hdShader : sdShader
        });

        this.gpuDepthShaderModule = this.device.createShaderModule({
            label: 'depth',
            code: depthShader
        });

        for (let i = 0; i < this.model.Textures.length; ++i) {
            const texture = this.model.Textures[i];
            const flags = texture.Flags;
            const addressModeU: GPUAddressMode = flags & TextureFlags.WrapWidth ? 'repeat' : 'clamp-to-edge';
            const addressModeV: GPUAddressMode = flags & TextureFlags.WrapHeight ? 'repeat' : 'clamp-to-edge';
            this.rendererData.gpuSamplers[i] = this.device.createSampler({
                label: `texture sampler ${i}`,
                minFilter: 'linear',
                magFilter: 'linear',
                mipmapFilter: 'linear',
                maxAnisotropy: 16,
                addressModeU,
                addressModeV
            });
        }

        this.rendererData.gpuDepthSampler = this.device.createSampler({
            label: 'texture depth sampler',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            compare: 'less',
            minFilter: 'nearest',
            magFilter: 'nearest'
        });

        if (this.isHD) {
            // Render env runtime
            this.envShaderModeule = this.device.createShaderModule({
                label: 'env',
                code: envShader
            });

            this.envPiepeline = this.device.createRenderPipeline({
                label: 'env',
                layout: 'auto',
                vertex: {
                    module: this.envShaderModeule,
                    entryPoint: 'vs',
                    buffers: [{
                        arrayStride: 12,
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3' as const
                        }]
                    }]
                },
                fragment: {
                    module: this.envShaderModeule,
                    entryPoint: 'fs',
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat()
                    }]
                },
                depthStencil: {
                    depthWriteEnabled: false,
                    depthCompare: 'always',
                    format: 'depth24plus'
                },
                multisample: {
                    count: MULTISAMPLE
                }
            });

            this.envVSUniformsBuffer = this.device.createBuffer({
                label: 'env vs uniforms',
                size: 128,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            this.envVSBindGroupLayout = this.envPiepeline.getBindGroupLayout(0);
            this.envVSBindGroup = this.device.createBindGroup({
                label: 'env vs bind group',
                layout: this.envVSBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: this.envVSUniformsBuffer }
                    }
                ]
            });

            this.envSampler = this.device.createSampler({
                label: 'env cube sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                minFilter: 'linear',
                magFilter: 'linear'
            });

            this.envFSBindGroupLayout = this.envPiepeline.getBindGroupLayout(1);

            // Convert env equirectangular map to the cube map
            this.envToCubemapShaderModule = this.device.createShaderModule({
                label: 'env to cubemap',
                code: envToCubemapShader
            });

            this.envToCubemapPiepeline = this.device.createRenderPipeline({
                label: 'env to cubemap',
                layout: 'auto',
                vertex: {
                    module: this.envToCubemapShaderModule,
                    entryPoint: 'vs',
                    buffers: [{
                        arrayStride: 12,
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3' as const
                        }]
                    }]
                },
                fragment: {
                    module: this.envToCubemapShaderModule,
                    entryPoint: 'fs',
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat()
                    }]
                }
            });

            this.envToCubemapVSBindGroupLayout = this.envToCubemapPiepeline.getBindGroupLayout(0);

            this.envToCubemapSampler = this.device.createSampler({
                label: 'env to cubemap sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                minFilter: 'linear',
                magFilter: 'linear'
            });

            this.envToCubemapFSBindGroupLayout = this.envToCubemapPiepeline.getBindGroupLayout(1);

            this.convoluteDiffuseEnvShaderModule = this.device.createShaderModule({
                label: 'convolute diffuse',
                code: convoluteEnvDiffuseShader
            });
            this.convoluteDiffuseEnvPiepeline = this.device.createRenderPipeline({
                label: 'convolute diffuse',
                layout: 'auto',
                vertex: {
                    module: this.convoluteDiffuseEnvShaderModule,
                    entryPoint: 'vs',
                    buffers: [{
                        arrayStride: 12,
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3' as const
                        }]
                    }]
                },
                fragment: {
                    module: this.convoluteDiffuseEnvShaderModule,
                    entryPoint: 'fs',
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat()
                    }]
                }
            });
            this.convoluteDiffuseEnvVSBindGroupLayout = this.convoluteDiffuseEnvPiepeline.getBindGroupLayout(0);
            this.convoluteDiffuseEnvFSBindGroupLayout = this.convoluteDiffuseEnvPiepeline.getBindGroupLayout(1);
            this.convoluteDiffuseEnvSampler = this.device.createSampler({
                label: 'convolute diffuse',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                minFilter: 'linear',
                magFilter: 'linear'
            });


            this.prefilterEnvShaderModule = this.device.createShaderModule({
                label: 'prefilter env',
                code: prefilterEnvShader
            });
            this.prefilterEnvPiepeline = this.device.createRenderPipeline({
                label: 'prefilter env',
                layout: 'auto',
                vertex: {
                    module: this.prefilterEnvShaderModule,
                    entryPoint: 'vs',
                    buffers: [{
                        arrayStride: 12,
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3' as const
                        }]
                    }]
                },
                fragment: {
                    module: this.prefilterEnvShaderModule,
                    entryPoint: 'fs',
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat()
                    }]
                }
            });
            this.prefilterEnvVSBindGroupLayout = this.prefilterEnvPiepeline.getBindGroupLayout(0);
            this.prefilterEnvFSBindGroupLayout = this.prefilterEnvPiepeline.getBindGroupLayout(1);
            this.prefilterEnvSampler = this.device.createSampler({
                label: 'prefilter env',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                minFilter: 'linear',
                magFilter: 'linear'
            });
        }
    }

    private createWireframeBuffer(index: number): void {
        const faces = this.model.Geosets[index].Faces;
        const lines = new Uint16Array(faces.length * 2);

        for (let i = 0; i < faces.length; i += 3) {
            lines[i * 2] = faces[i];
            lines[i * 2 + 1] = faces[i + 1];
            lines[i * 2 + 2] = faces[i + 1];
            lines[i * 2 + 3] = faces[i + 2];
            lines[i * 2 + 4] = faces[i + 2];
            lines[i * 2 + 5] = faces[i];
        }

        this.wireframeIndexBuffer[index] = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.wireframeIndexBuffer[index]);
        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, lines, this.gl.STATIC_DRAW);
    }

    private createWireframeGPUBuffer(index: number): void {
        const faces = this.model.Geosets[index].Faces;
        const lines = new Uint16Array(faces.length * 2);

        for (let i = 0; i < faces.length; i += 3) {
            lines[i * 2] = faces[i];
            lines[i * 2 + 1] = faces[i + 1];
            lines[i * 2 + 2] = faces[i + 1];
            lines[i * 2 + 3] = faces[i + 2];
            lines[i * 2 + 4] = faces[i + 2];
            lines[i * 2 + 5] = faces[i];
        }

        this.wireframeIndexGPUBuffer[index] = this.device.createBuffer({
            label: `wireframe ${index}`,
            size: lines.byteLength,
            usage: GPUBufferUsage.INDEX,
            mappedAtCreation: true
        });
        new Uint16Array(
            this.wireframeIndexGPUBuffer[index].getMappedRange(0, this.wireframeIndexGPUBuffer[index].size)
        ).set(lines);
        this.wireframeIndexGPUBuffer[index].unmap();
    }

    private initBuffers(): void {
        const sharedBuffers = ModelResourceManager.getInstance().getBuffers(this.model, this.softwareSkinning);
        if (!sharedBuffers) return;

        if (this.softwareSkinning) {
            for (let i = 0; i < this.model.Geosets.length; ++i) {
                const geoset = this.model.Geosets[i];
                this.vertexBuffer[i] = this.gl.createBuffer();
                this.vertices[i] = new Float32Array(geoset.Vertices.length);
            }
            this.normalBuffer = sharedBuffers.normalBuffer;
            this.texCoordBuffer = sharedBuffers.texCoordBuffer;
            this.indexBuffer = sharedBuffers.indexBuffer;
        } else {
            this.vertexBuffer = sharedBuffers.vertexBuffer;
            this.normalBuffer = sharedBuffers.normalBuffer;
            this.texCoordBuffer = sharedBuffers.texCoordBuffer;
            this.skinWeightBuffer = sharedBuffers.skinWeightBuffer;
            this.tangentBuffer = sharedBuffers.tangentBuffer;
            this.groupBuffer = sharedBuffers.groupBuffer;
            this.indexBuffer = sharedBuffers.indexBuffer;
            this.wireframeIndexBuffer = sharedBuffers.wireframeIndexBuffer;
        }
    }

    private createGPUPipeline(
        name: string,
        blend: GPUBlendState | undefined,
        depth: GPUDepthStencilState,
        shaderModule: GPUShaderModule = this.gpuShaderModule,
        extra: Partial<GPURenderPipelineDescriptor> = {}
    ): GPURenderPipeline {
        const base: GPURenderPipelineDescriptor = {
            label: `pipeline ${name}`,
            layout: this.gpuPipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs',
                buffers: [{
                    // vertices
                    arrayStride: 12,
                    attributes: [{
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x3' as const
                    }]
                }, {
                    // normals
                    arrayStride: 12,
                    attributes: [{
                        shaderLocation: 1,
                        offset: 0,
                        format: 'float32x3' as const
                    }]
                }, {
                    // textureCoord
                    arrayStride: 8,
                    attributes: [{
                        shaderLocation: 2,
                        offset: 0,
                        format: 'float32x2' as const
                    }]
                }, ...(this.isHD ? [{
                    // tangents
                    arrayStride: 16,
                    attributes: [{
                        shaderLocation: 3,
                        offset: 0,
                        format: 'float32x4' as const
                    }]
                }, {
                    // skin
                    arrayStride: 8,
                    attributes: [{
                        shaderLocation: 4,
                        offset: 0,
                        format: 'uint8x4' as const
                    }]
                }, {
                    // boneWeight
                    arrayStride: 8,
                    attributes: [{
                        shaderLocation: 5,
                        offset: 4,
                        format: 'unorm8x4' as const
                    }]
                }] : [{
                    // group
                    arrayStride: 8,
                    attributes: [{
                        shaderLocation: 3,
                        offset: 0,
                        format: 'uint16x4' as const
                    }]
                }])]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs',
                targets: [{
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    blend
                }]
            },
            depthStencil: depth,
            multisample: {
                count: MULTISAMPLE
            }
        };

        // Merge `extra` while preserving entryPoint defaults if caller overrides vertex/fragment objects.
        const merged: GPURenderPipelineDescriptor = {
            ...base,
            ...extra,
            vertex: { ...base.vertex, ...(extra.vertex || {}) } as any,
            fragment: extra.fragment === null ? null as any : { ...base.fragment, ...(extra.fragment || {}) } as any,
        };
        (merged.vertex as any).entryPoint ||= 'vs';
        if (merged.fragment) (merged.fragment as any).entryPoint ||= 'fs';

        return this.device.createRenderPipeline(merged);
    }

    private createGPUPipelineByLayer(filterMode: FilterMode, twoSided: boolean): GPURenderPipeline {
        return this.createGPUPipeline(...GPU_LAYER_PROPS[filterMode], undefined, {
            primitive: {
                cullMode: twoSided ? 'none' : 'back'
            }
        });
    }

    private getGPUPipeline(layer: Layer): GPURenderPipeline {
        const filterMode = this.getNormalizedFilterMode(layer.FilterMode);
        const twoSided = Boolean((layer.Shading || 0) & LayerShading.TwoSided);

        const key = `${filterMode}-${twoSided}`;

        if (!this.gpuPipelines[key]) {
            this.gpuPipelines[key] = this.createGPUPipelineByLayer(filterMode, twoSided);
        }

        return this.gpuPipelines[key];
    }

    private initGPUPipeline(): void {
        this.vsBindGroupLayout = this.device.createBindGroupLayout({
            label: 'vs bind group layout',
            // Matches `@group(0)` declarations in webgpu/*.wgsl (vsUniforms + boneTexture + boneTextureWidth).
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    // mvMatrix + pMatrix
                    minBindingSize: 128
                }
            }, {
                binding: 1,
                visibility: GPUShaderStage.VERTEX,
                texture: {
                    // rgba32float bone matrix texture (loaded via textureLoad)
                    sampleType: 'unfilterable-float',
                    viewDimension: '2d',
                    multisampled: false
                }
            }, {
                binding: 2,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    // uniform scalars are 16-byte aligned in UBOs
                    minBindingSize: 16
                }
            }] as const
        });
        this.fsBindGroupLayout = this.device.createBindGroupLayout({
            label: 'fs bind group layout2',
            entries: this.isHD ? [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 192
                    }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'filtering'
                    }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false
                    }
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'filtering'
                    }
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false
                    }
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'filtering'
                    }
                },
                {
                    binding: 6,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false
                    }
                },
                {
                    binding: 7,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'comparison'
                    }
                },
                {
                    binding: 8,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'depth',
                        viewDimension: '2d',
                        multisampled: false
                    }
                },
                {
                    binding: 9,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'filtering'
                    }
                },
                {
                    binding: 10,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                        viewDimension: 'cube',
                        multisampled: false
                    }
                },
                {
                    binding: 11,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'filtering'
                    }
                },
                {
                    binding: 12,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                        viewDimension: 'cube',
                        multisampled: false
                    }
                },
                {
                    binding: 13,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'filtering'
                    }
                },
                {
                    binding: 14,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false
                    }
                }
            ] as const : [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        // sd.wgsl FSUniforms (includes tVertexAnim + geosetColor + layer/geoset alpha)
                        minBindingSize: 112
                    }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    sampler: {
                        type: 'filtering'
                    }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                        viewDimension: '2d',
                        multisampled: false
                    }
                }
            ] as const
        });

        this.gpuPipelineLayout = this.device.createPipelineLayout({
            label: 'pipeline layout',
            bindGroupLayouts: [
                this.vsBindGroupLayout,
                this.fsBindGroupLayout
            ]
        });

        this.gpuWireframePipeline = this.createGPUPipeline('wireframe', {
            color: {
                operation: 'add',
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha'
            },
            alpha: {
                operation: 'add',
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha'
            }
        }, {
            depthWriteEnabled: true,
            depthCompare: 'less-equal',
            format: 'depth24plus'
        }, undefined, {
            primitive: {
                topology: 'line-list'
            }
        });

        if (this.isHD) {
            this.gpuShadowPipeline = this.createGPUPipeline('shadow', undefined, {
                depthWriteEnabled: true,
                depthCompare: 'less-equal',
                format: 'depth32float'
            }, this.gpuDepthShaderModule, {
                fragment: {
                    module: this.gpuDepthShaderModule,
                    targets: []
                },
                multisample: {
                    count: 1
                }
            });
        }

        this.gpuRenderPassDescriptor = {
            label: 'basic renderPass',
            colorAttachments: [
                {
                    view: null,
                    clearValue: [0.15, 0.15, 0.15, 1],
                    loadOp: 'clear' as const,
                    storeOp: 'store' as const
                }
            ]
        };
    }

    private initGPUBuffers(): void {
        const sharedBuffers = ModelResourceManager.getInstance().getGPUBuffers(this.model);
        if (!sharedBuffers) return;

        this.gpuVertexBuffer = sharedBuffers.vertexBuffer;
        this.gpuNormalBuffer = sharedBuffers.normalBuffer;
        this.gpuTexCoordBuffer = sharedBuffers.texCoordBuffer;
        this.gpuSkinWeightBuffer = sharedBuffers.skinWeightBuffer;
        this.gpuTangentBuffer = sharedBuffers.tangentBuffer;
        this.gpuGroupBuffer = sharedBuffers.groupBuffer;
        this.gpuIndexBuffer = sharedBuffers.indexBuffer;
        this.wireframeIndexGPUBuffer = sharedBuffers.wireframeIndexBuffer;
    }

    private initGPUUniformBuffers(): void {
        this.gpuVSUniformsBuffer = this.device.createBuffer({
            label: 'vs uniforms',
            size: 128,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Align to 16 bytes for UBO rules.
        this.gpuBoneTextureWidthBuffer = this.device.createBuffer({
            label: 'bone texture width',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(this.gpuBoneTextureWidthBuffer, 0, new Float32Array([BONE_TEXTURE_WIDTH]));

        // Bone texture + bind group are initialized here because pipelines reference these bindings.
        this.initGPUBoneTexture();
        this.gpuVSUniformsBindGroup = this.device.createBindGroup({
            label: 'vs uniforms bind group',
            layout: this.vsBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.gpuVSUniformsBuffer } },
                { binding: 1, resource: this.gpuBoneTexture.createView() },
                { binding: 2, resource: { buffer: this.gpuBoneTextureWidthBuffer } }
            ]
        });
    }

    private initGPUBoneTexture(): void {
        if (this.gpuBoneTexture) return;

        // Allocate CPU-side bone buffer if needed (doesn't require WebGL).
        if (!this.boneTextureData) {
            this.boneTextureData = new Float32Array(BONE_TEXTURE_WIDTH * BONE_TEXTURE_HEIGHT * 4);
            for (let i = 0; i < MAX_NODES; i++) {
                const offset = i * 16;
                this.boneTextureData[offset + 0] = 1;
                this.boneTextureData[offset + 5] = 1;
                this.boneTextureData[offset + 10] = 1;
                this.boneTextureData[offset + 15] = 1;
            }
        }

        this.gpuBoneTexture = this.device.createTexture({
            label: 'bone texture',
            size: [BONE_TEXTURE_WIDTH, BONE_TEXTURE_HEIGHT],
            format: 'rgba32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });

        // Initialize with identity matrices.
        this.device.queue.writeTexture(
            { texture: this.gpuBoneTexture },
            this.boneTextureData,
            { bytesPerRow: BONE_TEXTURE_WIDTH * 16 },
            { width: BONE_TEXTURE_WIDTH, height: BONE_TEXTURE_HEIGHT }
        );
    }

    private updateGPUBoneTexture(instance: ModelInstance): void {
        const nodes = instance.rendererData.nodes;
        if (!nodes || !this.boneTextureData) return;

        for (let i = 0; i < nodes.length && i < MAX_NODES; i++) {
            const m = nodes[i]?.matrix;
            if (m) {
                this.boneTextureData.set(m, i * 16);
            }
        }

        this.device.queue.writeTexture(
            { texture: this.gpuBoneTexture },
            this.boneTextureData,
            { bytesPerRow: BONE_TEXTURE_WIDTH * 16 },
            { width: BONE_TEXTURE_WIDTH, height: BONE_TEXTURE_HEIGHT }
        );
    }

    private initGPUMultisampleTexture(): void {
        this.gpuMultisampleTexture = this.device.createTexture({
            label: 'multisample texutre',
            size: [this.canvas.width, this.canvas.height],
            format: navigator.gpu.getPreferredCanvasFormat(),
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            sampleCount: MULTISAMPLE
        });
    }

    private initGPUDepthTexture(): void {
        this.gpuDepthTexture = this.device.createTexture({
            label: 'depth texture',
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            sampleCount: MULTISAMPLE
        });
    }

    private initGPUEmptyTexture(): void {
        const texture = this.rendererData.gpuEmptyTexture = this.device.createTexture({
            label: 'empty texture',
            size: [1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        // Use an aligned bytesPerRow to satisfy WebGPU validation rules.
        const emptyRow = new Uint8Array(256);
        emptyRow[0] = 255;
        emptyRow[1] = 255;
        emptyRow[2] = 255;
        emptyRow[3] = 255;
        this.device.queue.writeTexture(
            { texture },
            emptyRow,
            { bytesPerRow: 256, rowsPerImage: 1 },
            { width: 1, height: 1 },
        );

        this.rendererData.gpuEmptyCubeTexture = this.device.createTexture({
            label: 'empty cube texture',
            size: [1, 1, 6],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });

        this.rendererData.gpuDepthEmptyTexture = this.device.createTexture({
            label: 'empty depth texture',
            size: [1, 1],
            format: 'depth32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
    }

    private initCube(): void {
        const data = new Float32Array([
            -0.5, -0.5, -0.5,
            -0.5, 0.5, -0.5,
            0.5, -0.5, -0.5,
            -0.5, 0.5, -0.5,
            0.5, 0.5, -0.5,
            0.5, -0.5, -0.5,

            -0.5, -0.5, 0.5,
            0.5, -0.5, 0.5,
            -0.5, 0.5, 0.5,
            -0.5, 0.5, 0.5,
            0.5, -0.5, 0.5,
            0.5, 0.5, 0.5,

            -0.5, 0.5, -0.5,
            -0.5, 0.5, 0.5,
            0.5, 0.5, -0.5,
            -0.5, 0.5, 0.5,
            0.5, 0.5, 0.5,
            0.5, 0.5, -0.5,

            -0.5, -0.5, -0.5,
            0.5, -0.5, -0.5,
            -0.5, -0.5, 0.5,
            -0.5, -0.5, 0.5,
            0.5, -0.5, -0.5,
            0.5, -0.5, 0.5,

            -0.5, -0.5, -0.5,
            -0.5, -0.5, 0.5,
            -0.5, 0.5, -0.5,
            -0.5, 0.5, 0.5,
            -0.5, 0.5, 0.5,
            -0.5, 0.5, -0.5,

            0.5, -0.5, -0.5,
            0.5, 0.5, -0.5,
            0.5, -0.5, 0.5,
            0.5, -0.5, 0.5,
            0.5, 0.5, -0.5,
            0.5, 0.5, 0.5,
        ]);

        if (this.device) {
            const vertex = this.cubeGPUVertexBuffer = this.device.createBuffer({
                label: 'skeleton vertex',
                size: data.byteLength,
                usage: GPUBufferUsage.VERTEX,
                mappedAtCreation: true
            });
            new Float32Array(
                vertex.getMappedRange(0, vertex.size)
            ).set(data);
            vertex.unmap();
        } else {
            this.cubeVertexBuffer = this.gl.createBuffer();
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.cubeVertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
        }
    }

    private initSquare(): void {
        this.squareVertexBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.squareVertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0,
            1.0, -1.0,
            -1.0, 1.0,
            1.0, -1.0,
            1.0, 1.0,
            -1.0, 1.0,
        ]), this.gl.STATIC_DRAW);
    }

    private initBRDFLUT(): void {
        if (!isWebGL2(this.gl) || !this.isHD || !this.colorBufferFloatExt) {
            return;
        }

        this.brdfLUT = this.gl.createTexture();
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.brdfLUT);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RG16F, BRDF_LUT_SIZE, BRDF_LUT_SIZE, 0, this.gl.RG, this.gl.FLOAT, null);

        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

        const framebuffer = this.gl.createFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
        this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, this.brdfLUT, 0);

        this.gl.useProgram(this.integrateBRDF.program);

        this.gl.viewport(0, 0, BRDF_LUT_SIZE, BRDF_LUT_SIZE);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.squareVertexBuffer);
        this.gl.enableVertexAttribArray(this.integrateBRDF.attributes.aPos);
        this.gl.vertexAttribPointer(this.integrateBRDF.attributes.aPos, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        this.gl.deleteFramebuffer(framebuffer);
    }

    private initGPUBRDFLUT(): void {
        const shaderModule = this.device.createShaderModule({
            label: 'integrate brdf',
            code: integrateBRDFFShader
        });

        this.gpuBrdfLUT = this.device.createTexture({
            label: 'brdf',
            size: [BRDF_LUT_SIZE, BRDF_LUT_SIZE],
            format: 'rg16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });

        const square = new Float32Array([
            -1.0, -1.0,
            1.0, -1.0,
            -1.0, 1.0,
            1.0, -1.0,
            1.0, 1.0,
            -1.0, 1.0,
        ]);
        const buffer = this.device.createBuffer({
            label: 'brdf square',
            size: square.byteLength,
            usage: GPUBufferUsage.VERTEX,
            mappedAtCreation: true
        });
        new Float32Array(
            buffer.getMappedRange(0, buffer.size)
        ).set(square);
        buffer.unmap();

        const encoder = this.device.createCommandEncoder({
            label: 'integrate brdf'
        });

        const pass = encoder.beginRenderPass({
            label: 'integrate brdf',
            colorAttachments: [{
                view: this.gpuBrdfLUT.createView(),
                clearValue: [0, 0, 0, 1],
                loadOp: 'clear',
                storeOp: 'store'
            }] as const
        });

        pass.setPipeline(this.device.createRenderPipeline({
            label: 'integrate brdf',
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs',
                buffers: [{
                    arrayStride: 8,
                    attributes: [{
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x2' as const
                    }]
                }]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs',
                targets: [{
                    format: 'rg16float'
                }] as const
            }
        }));

        pass.setVertexBuffer(0, buffer);
        pass.draw(6);
        pass.end();

        const commandBuffer = encoder.finish();
        this.device.queue.submit([commandBuffer]);
        this.device.queue.onSubmittedWorkDone().finally(() => {
            buffer.destroy();
        });

        this.gpuBrdfSampler = this.device.createSampler({
            label: 'brdf lut',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            minFilter: 'linear',
            magFilter: 'linear'
        });
    }

    /*private resetGlobalSequences (): void {
        for (let i = 0; i < this.rendererData.globalSequencesFrames.length; ++i) {
            this.rendererData.globalSequencesFrames[i] = 0;
        }
    }*/

    public get enableGeosetAnimColor(): boolean {
        return this.modelInstance.enableGeosetAnimColor;
    }

    public set enableGeosetAnimColor(value: boolean) {
        this.modelInstance.enableGeosetAnimColor = value;
    }

    private getDiscardAlphaLevel(filterMode: number | undefined): number {
        const mode = this.getNormalizedFilterMode(filterMode);
        if (mode === FilterMode.Transparent) {
            return 0.75;
        }
        if (mode === FilterMode.Modulate || mode === FilterMode.Modulate2x) {
            return 0.02;
        }
        return 0.0;
    }

    private getNormalizedFilterMode(filterMode: number | undefined): FilterMode {
        const mode = filterMode || 0;
        if (mode > FilterMode.Modulate2x) {
            return FilterMode.Blend;
        }
        return mode as FilterMode;
    }

    private setLayerProps(instance: ModelInstance, layer: Layer, textureID: number): boolean {
        const texture = this.model.Textures[textureID];
        // If texture is null/undefined, it means the textureID was invalid or out of bounds.
        // We should still proceed to set other properties and use fallback texture if needed.
        // The fallback logic is handled below.

        if (layer.Shading & LayerShading.TwoSided) {
            this.gl.disable(this.gl.CULL_FACE);
        } else {
            this.gl.enable(this.gl.CULL_FACE);
        }

        this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, this.getDiscardAlphaLevel(layer.FilterMode));

        const filterMode = this.getNormalizedFilterMode(layer.FilterMode);

        if (filterMode === FilterMode.None) {
            this.gl.disable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.depthMask(true);
        } else if (filterMode === FilterMode.Transparent) {
            // Transparent is alpha-test style, not blended.
            this.gl.disable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.depthMask(true);
        } else if (filterMode === FilterMode.Blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(false);
        } else if (filterMode === FilterMode.Additive) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (filterMode === FilterMode.AddAlpha) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (filterMode === FilterMode.Modulate) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.ZERO, this.gl.SRC_COLOR);
            this.gl.depthMask(false);
        } else if (filterMode === FilterMode.Modulate2x) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.DST_COLOR, this.gl.SRC_COLOR);
            this.gl.depthMask(false);
        }

        if (texture && texture.Image) {
            const gpuTexture = instance.rendererData.textures[texture.Image];
            if (!gpuTexture) {
                // Texture not yet loaded - silently use fallback (loading may still be in progress)
                // No warning logged to avoid console spam during async texture loading
            }
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, gpuTexture || this.fallbackTexture);
            this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
            this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, 0);
        } else if (texture.ReplaceableId === 1 || texture.ReplaceableId === 2) {
            this.gl.uniform3fv(this.shaderProgramLocations.replaceableColorUniform, instance.rendererData.teamColor);
            this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, texture.ReplaceableId);
        }

        if (layer.Shading & LayerShading.NoDepthTest) {
            this.gl.disable(this.gl.DEPTH_TEST);
        }
        if (layer.Shading & LayerShading.NoDepthSet) {
            this.gl.depthMask(false);
        }

        this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, instance.getTexCoordMatrix(layer));
        return true;
    }

    private getLayerAlpha(layer: Layer, interp: ModelInterp): number {
        // Handle layer alpha animation
        let layerAlpha = 1.0;
        if (layer.Alpha !== undefined && layer.Alpha !== null) {
            if (typeof layer.Alpha === 'number') {
                layerAlpha = layer.Alpha;
            } else {
                // It's an AnimVector, need to interpolate
                const alphaValue = interp.num(layer.Alpha);
                if (alphaValue !== null) {
                    layerAlpha = alphaValue;
                }
            }
        }

        // Safety: prevent invalid alpha from breaking blend/discard behavior.
        if (!Number.isFinite(layerAlpha)) {
            return 1.0;
        }

        return layerAlpha;
    }

    private setLayerPropsHD(instance: ModelInstance, materialID: number, layers: Layer[]): void {
        const baseLayer = layers[0];
        const textures = instance.rendererData.materialLayerTextureID[materialID];
        const normalTextres = instance.rendererData.materialLayerNormalTextureID[materialID];
        const ormTextres = instance.rendererData.materialLayerOrmTextureID[materialID];
        const diffuseTextureID = textures[0];
        const diffuseTexture = this.model.Textures[diffuseTextureID];
        if (!diffuseTexture) return;

        const normalTextureID = baseLayer?.ShaderTypeId === 1 ? normalTextres[0] : textures[1];
        const normalTexture = this.model.Textures[normalTextureID];
        const ormTextureID = baseLayer?.ShaderTypeId === 1 ? ormTextres[0] : textures[2];
        const ormTexture = this.model.Textures[ormTextureID];
        if (!normalTexture || !ormTexture) return;
        // const emissiveTextureID = textures[3];
        // const emissiveTexture = this.model.Textures[emissiveTextureID];
        // const teamColorTextureID = textures[4];
        // const teamColorTexture = this.model.Textures[teamColorTextureID];
        // const envTextureID = textures[5];
        // const envTexture = this.model.Textures[envTextureID];

        if (baseLayer.Shading & LayerShading.TwoSided) {
            this.gl.disable(this.gl.CULL_FACE);
        } else {
            this.gl.enable(this.gl.CULL_FACE);
        }

        this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, this.getDiscardAlphaLevel(baseLayer.FilterMode));

        const filterMode = this.getNormalizedFilterMode(baseLayer.FilterMode);

        if (filterMode === FilterMode.None) {
            this.gl.disable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.depthMask(true);
        } else if (filterMode === FilterMode.Transparent) {
            // Transparent is alpha-test style, not blended.
            this.gl.disable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.depthMask(true);
        } else if (filterMode === FilterMode.Blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(false);
        } else if (filterMode === FilterMode.Additive) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (filterMode === FilterMode.AddAlpha) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (filterMode === FilterMode.Modulate) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.ZERO, this.gl.SRC_COLOR);
            this.gl.depthMask(false);
        } else if (filterMode === FilterMode.Modulate2x) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.DST_COLOR, this.gl.SRC_COLOR);
            this.gl.depthMask(false);
        }

        this.gl.activeTexture(this.gl.TEXTURE0);
        const diffuseTex = instance.rendererData.textures[diffuseTexture.Image] || this.fallbackTexture;
        this.gl.bindTexture(this.gl.TEXTURE_2D, diffuseTex);
        this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);

        if (baseLayer.Shading & LayerShading.NoDepthTest) {
            this.gl.disable(this.gl.DEPTH_TEST);
        }
        if (baseLayer.Shading & LayerShading.NoDepthSet) {
            this.gl.depthMask(false);
        }

        this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, instance.getTexCoordMatrix(baseLayer));

        this.gl.activeTexture(this.gl.TEXTURE1);
        const normalTex = (normalTexture && instance.rendererData.textures[normalTexture.Image]) || this.rendererData.fallbackTexture;
        this.gl.bindTexture(this.gl.TEXTURE_2D, normalTex);
        this.gl.uniform1i(this.shaderProgramLocations.normalSamplerUniform, 1);

        this.gl.activeTexture(this.gl.TEXTURE2);
        const ormTex = (ormTexture && instance.rendererData.textures[ormTexture.Image]) || this.rendererData.fallbackTexture;
        this.gl.bindTexture(this.gl.TEXTURE_2D, ormTex);
        this.gl.uniform1i(this.shaderProgramLocations.ormSamplerUniform, 2);

        this.gl.uniform3fv(this.shaderProgramLocations.replaceableColorUniform, instance.rendererData.teamColor);
    }
    public setReplaceableTexture(id: number, img: HTMLImageElement | ImageBitmap): void {
        if (this.device) {
            const texture = this.rendererData.replaceableTextures[id] = this.device.createTexture({
                size: [img.width, img.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            this.device.queue.copyExternalImageToTexture(
                {
                    source: img
                },
                { texture },
                {
                    width: img.width,
                    height: img.height
                }
            );
        } else {
            const texture = this.rendererData.replaceableTextures[id] = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
            // CRITICAL: img is ImageBitmap with straight alpha (premultiplyAlpha:'none'). Tell WebGL NOT to premultiply during upload.
            this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);

            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_NEAREST);

            this.gl.generateMipmap(this.gl.TEXTURE_2D);

            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        }
    }

    public renderGeosetHighlight(i: number, color: vec3, alpha: number, viewMatrix: mat4, pMatrix: mat4): void {
        if (!this.shaderProgram || this.device) return;

        this.gl.useProgram(this.shaderProgram);

        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);

        this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.normalsAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);

        if (this.isHD) {
            this.gl.enableVertexAttribArray(this.shaderProgramLocations.skinAttribute);
            this.gl.enableVertexAttribArray(this.shaderProgramLocations.weightAttribute);
            this.gl.enableVertexAttribArray(this.shaderProgramLocations.tangentAttribute);
        } else {
            if (!this.softwareSkinning) {
                this.gl.enableVertexAttribArray(this.shaderProgramLocations.groupAttribute);
            }
        }

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[i]);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.normalBuffer[i]);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.normalsAttribute, 3, this.gl.FLOAT, false, 0, 0);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer[i]);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

        if (this.isHD) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.skinWeightBuffer[i]);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.skinAttribute, 4, this.gl.UNSIGNED_BYTE, false, 8, 0);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.weightAttribute, 4, this.gl.UNSIGNED_BYTE, true, 8, 4);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.tangentBuffer[i]);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.tangentAttribute, 4, this.gl.FLOAT, false, 0, 0);
        } else if (!this.softwareSkinning) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.groupBuffer[i]);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.groupAttribute, 4, this.gl.UNSIGNED_SHORT, false, 0, 0);
        }

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer[i]);

        const instance = this.modelInstance;
        const instanceMV = mat4.create();
        mat4.multiply(instanceMV, viewMatrix, instance.worldMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, instanceMV);

        if (!this.softwareSkinning) {
            // Bind bone texture and update with current frame's bone matrices
            this.updateAndBindBoneTexture(instance);
        }

        this.gl.uniform3fv(this.shaderProgramLocations.geosetColorUniform, color);
        this.gl.uniform1f(this.shaderProgramLocations.layerAlphaUniform, 1.0);
        this.gl.uniform1f(this.shaderProgramLocations.geosetAlphaUniform, alpha);
        this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.0);

        // --- Lighting Uniforms (Fixes flat/faceted highlight appearance) ---
        if (!this.isHD && this.shaderProgramLocations.enableLightingUniform) {
            // World-Space Sun Direction (same as main render)
            const lightDirWorld = vec3.fromValues(1, -1.0, 1);
            vec3.normalize(lightDirWorld, lightDirWorld);

            // Transform to View Space
            const viewRotation = mat3.create();
            mat3.fromMat4(viewRotation, viewMatrix);

            const lightDirView = vec3.create();
            vec3.transformMat3(lightDirView, lightDirWorld, viewRotation);
            vec3.normalize(lightDirView, lightDirView);

            this.gl.uniform3fv(this.shaderProgramLocations.lightDirUniform, lightDirView);
            this.gl.uniform3fv(this.shaderProgramLocations.lightColorUniform, [1.4, 1.4, 1.4]);
            this.gl.uniform3fv(this.shaderProgramLocations.ambientColorUniform, [1.3, 1.3, 1.3]);
            this.gl.uniform1f(this.shaderProgramLocations.enableLightingUniform, 1.0); // Always enable lighting for highlight
            this.gl.uniform1f(this.shaderProgramLocations.unshadedUniform, 0.0); // Not unshaded
        }

        const geoset = this.model.Geosets[i];
        const materialID = geoset.MaterialID;
        const material = this.model.Materials[materialID];
        if (material && material.Layers.length > 0) {
            const textureID = instance.rendererData.materialLayerTextureID[materialID][0];
            const texName = this.model.Textures[textureID]?.Image;
            if (texName && this.rendererData.textures[texName]) {
                this.gl.activeTexture(this.gl.TEXTURE0);
                this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[texName]);
                this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
            }
        }

        this.gl.drawElements(this.gl.TRIANGLES, geoset.Faces.length, this.gl.UNSIGNED_SHORT, 0);

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.normalsAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        if (this.isHD) {
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.skinAttribute);
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.weightAttribute);
            this.gl.disableVertexAttribArray(this.shaderProgramLocations.tangentAttribute);
        } else {
            if (!this.softwareSkinning) {
                this.gl.disableVertexAttribArray(this.shaderProgramLocations.groupAttribute);
            }
        }
    }

    public setClearColor(r: number, g: number, b: number, a: number): void {
        if (this.gpuRenderPassDescriptor && this.gpuRenderPassDescriptor.colorAttachments[0]) {
            this.gpuRenderPassDescriptor.colorAttachments[0].clearValue = { r, g, b, a };
        }
    }

}
