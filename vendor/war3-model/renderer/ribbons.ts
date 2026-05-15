/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

import { getShader } from './util';
import { RendererData } from './rendererData';
import { ModelInterp } from './modelInterp';
import { FilterMode, Layer, LayerShading, Material, RibbonEmitter } from '../model';
import { mat4, vec3 } from 'gl-matrix';
import vertexShader from './shaders/webgl/ribbon.vs.glsl?raw';
import fragmentShader from './shaders/webgl/ribbon.fs.glsl?raw';
import ribbonShader from './shaders/webgpu/ribbons.wgsl?raw';

// Reusable temporary variables for ribbon calculations to reduce GC
const tempPivotFirst = vec3.create();
const tempRibbonOrigin = vec3.create();
const tempRibbonAxis = vec3.create();
const tempRibbonAbove = vec3.create();
const tempRibbonBelow = vec3.create();
const tempRibbonFallbackReference = vec3.create();
const tempRibbonFallbackTangent = vec3.create();

const MIN_RIBBON_LIFESPAN = 0.02;
const RIBBON_EMISSION_QUALITY_SCALE = 2;


interface RibbonEmitterWrapper {
    index: number;

    emission: number;
    props: RibbonEmitter;
    capacity: number;
    baseCapacity: number;
    creationTimes: number[];

    // xyz
    vertices: Float32Array;
    vertexBuffer: WebGLBuffer;
    vertexGPUBuffer: GPUBuffer;
    // xy
    texCoords: Float32Array;
    texCoordBuffer: WebGLBuffer;
    texCoordGPUBuffer: GPUBuffer;

    fsUnifrmsPerLayer: GPUBuffer[];
}

export interface RibbonRenderItem {
    emitterIndex: number;
    layerIndex: number;
    filterMode: number;
    priorityPlane: number;
    dist2: number;
}

export class RibbonsController {
    private gl: WebGL2RenderingContext | WebGLRenderingContext;
    private shaderProgram: WebGLProgram;
    private vertexShader: WebGLShader;
    private fragmentShader: WebGLShader;

    private device: GPUDevice;
    private gpuShaderModule: GPUShaderModule;
    private gpuPipelineLayout: GPUPipelineLayout;
    private gpuPipelines: GPURenderPipeline[];
    private vsBindGroupLayout: GPUBindGroupLayout | null;
    private fsBindGroupLayout: GPUBindGroupLayout | null;
    private gpuVSUniformsBuffer: GPUBuffer;
    private gpuVSUniformsBindGroup: GPUBindGroup;

    private shaderProgramLocations: {
        vertexPositionAttribute: number,
        textureCoordAttribute: number,
        pMatrixUniform: WebGLUniformLocation | null,
        mvMatrixUniform: WebGLUniformLocation | null,
        samplerUniform: WebGLUniformLocation | null,
        replaceableColorUniform: WebGLUniformLocation | null,
        replaceableTypeUniform: WebGLUniformLocation | null,
        discardAlphaLevelUniform: WebGLUniformLocation | null,
        colorUniform: WebGLUniformLocation | null
    };

    private interp: ModelInterp;
    private rendererData: RendererData;
    private emitters: RibbonEmitterWrapper[];
    private forcePreviewVisibility = false;
    private nodeMatrixRefresh: (() => void) | null = null;

    constructor(interp: ModelInterp, rendererData: RendererData) {
        this.shaderProgramLocations = {
            vertexPositionAttribute: null,
            textureCoordAttribute: null,
            pMatrixUniform: null,
            mvMatrixUniform: null,
            samplerUniform: null,
            replaceableColorUniform: null,
            replaceableTypeUniform: null,
            discardAlphaLevelUniform: null,
            colorUniform: null
        };

        this.interp = interp;
        this.rendererData = rendererData;
        this.emitters = [];

        if (rendererData.model.RibbonEmitters.length) {
            for (let i = 0; i < rendererData.model.RibbonEmitters.length; ++i) {
                const ribbonEmitter = rendererData.model.RibbonEmitters[i];

                const emitter: RibbonEmitterWrapper = {
                    index: i,

                    emission: 0,
                    props: ribbonEmitter,
                    capacity: 0,
                    baseCapacity: 0,
                    creationTimes: [],
                    vertices: null,
                    vertexBuffer: null,
                    vertexGPUBuffer: null,
                    texCoords: null,
                    texCoordBuffer: null,
                    texCoordGPUBuffer: null,
                    fsUnifrmsPerLayer: []
                };

                emitter.baseCapacity = Math.max(2, Math.ceil(
                    ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) *
                    RIBBON_EMISSION_QUALITY_SCALE *
                    emitter.props.LifeSpan
                ) + 1); // extra points

                this.emitters.push(emitter);
            }
        }
    }

    public destroy(): void {
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
        if (this.gpuVSUniformsBuffer) {
            this.gpuVSUniformsBuffer.destroy();
            this.gpuVSUniformsBuffer = null;
        }
        for (const emitter of this.emitters) {
            for (const buffer of emitter.fsUnifrmsPerLayer) {
                buffer.destroy();
            }
        }
        this.emitters = [];
    }

    public initGL(glContext: WebGLRenderingContext): void {
        this.gl = glContext;

        this.initShaders();
    }

    public initGPUDevice(device: GPUDevice): void {
        this.device = device;

        this.gpuShaderModule = device.createShaderModule({
            label: 'ribbons shader module',
            code: ribbonShader
        });

        this.vsBindGroupLayout = this.device.createBindGroupLayout({
            label: 'ribbons vs bind group layout',
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
        this.fsBindGroupLayout = this.device.createBindGroupLayout({
            label: 'ribbons bind group layout2',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 48
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
                        viewDimension: "2d",
                        multisampled: false
                    }
                }
            ] as const
        });

        this.gpuPipelineLayout = this.device.createPipelineLayout({
            label: 'ribbons pipeline layout',
            bindGroupLayouts: [
                this.vsBindGroupLayout,
                this.fsBindGroupLayout
            ]
        });

        const createPipeline = (name: string, blend: GPUBlendState, depth: GPUDepthStencilState) => {
            return device.createRenderPipeline({
                label: `ribbons pipeline ${name}`,
                layout: this.gpuPipelineLayout,
                vertex: {
                    module: this.gpuShaderModule,
                    buffers: [{
                        arrayStride: 12,
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x3' as const
                        }]
                    }, {
                        arrayStride: 8,
                        attributes: [{
                            shaderLocation: 1,
                            offset: 0,
                            format: 'float32x2' as const
                        }]
                    }]
                },
                fragment: {
                    module: this.gpuShaderModule,
                    targets: [{
                        format: navigator.gpu.getPreferredCanvasFormat(),
                        blend
                    }]
                },
                depthStencil: depth,
                primitive: {
                    topology: 'triangle-strip'
                }
            });
        };

        this.gpuPipelines = [
            createPipeline('none', {
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
            }),
            createPipeline('transparent', {
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
            }),
            createPipeline('blend', {
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
            }),
            createPipeline('additive', {
                color: {
                    operation: 'add',
                    srcFactor: 'src',
                    dstFactor: 'one'
                },
                alpha: {
                    operation: 'add',
                    srcFactor: 'src',
                    dstFactor: 'one'
                }
            }, {
                depthWriteEnabled: false,
                depthCompare: 'less-equal',
                format: 'depth24plus'
            }),
            createPipeline('addAlpha', {
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
            }),
            createPipeline('modulate', {
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
            }),
            createPipeline('modulate2x', {
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
            })
        ];

        this.gpuVSUniformsBuffer = this.device.createBuffer({
            label: 'ribbons vs uniforms',
            size: 128,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.gpuVSUniformsBindGroup = this.device.createBindGroup({
            layout: this.vsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.gpuVSUniformsBuffer }
                }
            ]
        });
    }

    /**
     * Synchronizes the internal emitters array with the model's RibbonEmitters.
     * This ensures dynamically added/removed emitters are properly handled.
     */
    public syncEmitters(): void {
        const model = this.rendererData.model;
        if (!model.RibbonEmitters) return;

        // Remove excess emitters
        if (this.emitters.length > model.RibbonEmitters.length) {
            this.emitters.length = model.RibbonEmitters.length;
        }

        // Update existing emitters' properties
        for (let i = 0; i < this.emitters.length && i < model.RibbonEmitters.length; ++i) {
            this.emitters[i].props = model.RibbonEmitters[i];
        }

        // Add new emitters
        for (let i = this.emitters.length; i < model.RibbonEmitters.length; ++i) {
            const ribbonEmitter = model.RibbonEmitters[i];
            const emitter: RibbonEmitterWrapper = {
                index: i,
                emission: 0,
                props: ribbonEmitter,
                capacity: 0,
                baseCapacity: Math.max(2, Math.ceil(
                    ModelInterp.maxAnimVectorVal(ribbonEmitter.EmissionRate) *
                    RIBBON_EMISSION_QUALITY_SCALE *
                    ribbonEmitter.LifeSpan
                ) + 1),
                creationTimes: [],
                vertices: null,
                vertexBuffer: null,
                vertexGPUBuffer: null,
                texCoords: null,
                texCoordBuffer: null,
                texCoordGPUBuffer: null,
                fsUnifrmsPerLayer: []
            };
            this.emitters.push(emitter);
        }
    }

    public update(delta: number): void {
        this.syncEmitters();
        for (const emitter of this.emitters) {
            this.updateEmitter(emitter, delta);
        }
    }

    public setPreviewVisibility(forceVisible: boolean): void {
        this.forcePreviewVisibility = forceVisible;
    }

    public setNodeMatrixRefresh(refresh: () => void): void {
        this.nodeMatrixRefresh = refresh;
    }

    public resetEmitters(): void {
        for (const emitter of this.emitters) {
            this.clearEmitter(emitter);
        }
    }

    public buildHistoryAt(frame: number): void {
        this.syncEmitters();
        const now = Date.now();
        const originalFrame = this.rendererData.frame;
        for (const emitter of this.emitters) {
            if (!this.rebuildEmitterHistoryAt(emitter, frame, now)) {
                this.rendererData.frame = frame;
                this.nodeMatrixRefresh?.();
                this.ensurePreviewRibbon(emitter, now);
            }
        }
        this.rendererData.frame = originalFrame;
        this.nodeMatrixRefresh?.();
    }

    public render(mvMatrix: mat4, pMatrix: mat4): void {
        this.gl.useProgram(this.shaderProgram);

        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);

        this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);

        for (const emitter of this.emitters) {
            if (emitter.creationTimes.length < 2) {
                continue;
            }

            // Check visibility before rendering
            const visibility = this.getEmitterVisibility(emitter);
            if (visibility <= 0) {
                continue;
            }

            // Handle Color - ensure it's an array-like object with 3 elements, default to white
            const rawColor = emitter.props.Color;
            const color = (rawColor && rawColor.length >= 3) ? rawColor : [1, 1, 1];
            const alpha = this.interp.animVectorVal(emitter.props.Alpha, 1);

            this.gl.uniform4f(
                this.shaderProgramLocations.colorUniform,
                color[0], color[1], color[2],
                alpha * visibility
            );

            this.setGeneralBuffers(emitter);
            const materialID: number = emitter.props.MaterialID;
            const material: Material = this.rendererData.model.Materials[materialID];
            for (let j = 0; j < material.Layers.length; ++j) {
                this.setLayerProps(material.Layers[j], this.rendererData.materialLayerTextureID[materialID][j]);
                this.renderEmitter(emitter);
            }
        }

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
    }

    public renderGPU(pass: GPURenderPassEncoder, mvMatrix: mat4, pMatrix: mat4): void {
        const VSUniformsValues = new ArrayBuffer(128);
        const VSUniformsViews = {
            mvMatrix: new Float32Array(VSUniformsValues, 0, 16),
            pMatrix: new Float32Array(VSUniformsValues, 64, 16)
        };
        VSUniformsViews.mvMatrix.set(mvMatrix);
        VSUniformsViews.pMatrix.set(pMatrix);
        this.device.queue.writeBuffer(this.gpuVSUniformsBuffer, 0, VSUniformsValues);

        for (const emitter of this.emitters) {
            if (emitter.creationTimes.length < 2) {
                continue;
            }

            this.device.queue.writeBuffer(emitter.vertexGPUBuffer, 0, emitter.vertices);
            this.device.queue.writeBuffer(emitter.texCoordGPUBuffer, 0, emitter.texCoords);

            pass.setVertexBuffer(0, emitter.vertexGPUBuffer);
            pass.setVertexBuffer(1, emitter.texCoordGPUBuffer);

            pass.setBindGroup(0, this.gpuVSUniformsBindGroup);

            const materialID: number = emitter.props.MaterialID;
            const material: Material = this.rendererData.model.Materials[materialID];

            for (let j = 0; j < material.Layers.length; ++j) {
                const textureID = this.rendererData.materialLayerTextureID[materialID][j];
                const texture = this.rendererData.model.Textures[textureID];
                const layer = material.Layers[j];

                const pipeline = this.gpuPipelines[layer.FilterMode] || this.gpuPipelines[0];
                pass.setPipeline(pipeline);

                const fsUniformsValues = new ArrayBuffer(48);
                const fsUniformsViews = {
                    replaceableColor: new Float32Array(fsUniformsValues, 0, 3),
                    replaceableType: new Uint32Array(fsUniformsValues, 12, 1),
                    discardAlphaLevel: new Float32Array(fsUniformsValues, 16, 1),
                    color: new Float32Array(fsUniformsValues, 32, 4),
                };

                fsUniformsViews.replaceableColor.set(this.rendererData.teamColor);
                fsUniformsViews.replaceableType.set([texture.ReplaceableId || 0]);
                fsUniformsViews.discardAlphaLevel.set([layer.FilterMode === FilterMode.Transparent ? .75 : 0]);
                fsUniformsViews.color.set([
                    emitter.props.Color[0],
                    emitter.props.Color[1],
                    emitter.props.Color[2],
                    this.interp.animVectorVal(emitter.props.Alpha, 1) * this.getEmitterVisibility(emitter)
                ]);

                if (!emitter.fsUnifrmsPerLayer[j]) {
                    emitter.fsUnifrmsPerLayer[j] = this.device.createBuffer({
                        label: `ribbons fs uniforms ${emitter.index} layer ${j}`,
                        size: 48,
                        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                    });
                }
                const fsUniformsBuffer = emitter.fsUnifrmsPerLayer[j];

                this.device.queue.writeBuffer(fsUniformsBuffer, 0, fsUniformsValues);

                const fsUniformsBindGroup = this.device.createBindGroup({
                    label: `ribbons fs uniforms ${emitter.index}`,
                    layout: this.fsBindGroupLayout,
                    entries: [
                        {
                            binding: 0,
                            resource: { buffer: fsUniformsBuffer }
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

                pass.setBindGroup(1, fsUniformsBindGroup);

                pass.draw(emitter.creationTimes.length * 2);
            }
        }
    }

    public getRenderItems(cameraPos: vec3 | null): RibbonRenderItem[] {
        const items: RibbonRenderItem[] = [];

        for (const emitter of this.emitters) {
            if (emitter.creationTimes.length < 2 || this.getEmitterVisibility(emitter) <= 0) {
                continue;
            }

            const materialID = emitter.props.MaterialID;
            const material: Material | undefined = this.rendererData.model.Materials[materialID];
            if (!material?.Layers?.length) {
                continue;
            }

            let dist2 = 0;
            if (cameraPos) {
                let count = 0;
                const center = vec3.create();
                for (let i = 0; i < emitter.creationTimes.length; ++i) {
                    const base = i * 6;
                    center[0] += (emitter.vertices[base] + emitter.vertices[base + 3]) * 0.5;
                    center[1] += (emitter.vertices[base + 1] + emitter.vertices[base + 4]) * 0.5;
                    center[2] += (emitter.vertices[base + 2] + emitter.vertices[base + 5]) * 0.5;
                    count++;
                }
                if (count > 0) {
                    vec3.scale(center, center, 1 / count);
                    const dx = center[0] - cameraPos[0];
                    const dy = center[1] - cameraPos[1];
                    const dz = center[2] - cameraPos[2];
                    dist2 = dx * dx + dy * dy + dz * dz;
                }
            }

            for (let layerIndex = 0; layerIndex < material.Layers.length; ++layerIndex) {
                const layer = material.Layers[layerIndex];
                items.push({
                    emitterIndex: emitter.index,
                    layerIndex,
                    filterMode: layer.FilterMode || FilterMode.None,
                    priorityPlane: material.PriorityPlane || 0,
                    dist2
                });
            }
        }

        return items;
    }

    public renderEmitterLayerByIndex(
        emitterIndex: number,
        layerIndex: number,
        mvMatrix: mat4,
        pMatrix: mat4
    ): void {
        const emitter = this.emitters.find((item) => item.index === emitterIndex);
        if (!emitter || emitter.creationTimes.length < 2 || this.getEmitterVisibility(emitter) <= 0) {
            return;
        }

        const materialID = emitter.props.MaterialID;
        const material: Material | undefined = this.rendererData.model.Materials[materialID];
        const layer = material?.Layers?.[layerIndex];
        if (!material || !layer) {
            return;
        }

        this.gl.useProgram(this.shaderProgram);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);

        this.setEmitterColorUniform(emitter);
        this.setGeneralBuffers(emitter);
        this.setLayerProps(layer, this.rendererData.materialLayerTextureID[materialID][layerIndex]);
        this.renderEmitter(emitter);

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
    }

    private initShaders(): void {
        const vertex = this.vertexShader = getShader(this.gl, vertexShader, this.gl.VERTEX_SHADER);
        const fragment = this.fragmentShader = getShader(this.gl, fragmentShader, this.gl.FRAGMENT_SHADER);

        const shaderProgram = this.shaderProgram = this.gl.createProgram();
        this.gl.attachShader(shaderProgram, vertex);
        this.gl.attachShader(shaderProgram, fragment);
        this.gl.linkProgram(shaderProgram);

        if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) {
            alert('Could not initialise shaders');
        }

        this.gl.useProgram(shaderProgram);

        this.shaderProgramLocations.vertexPositionAttribute =
            this.gl.getAttribLocation(shaderProgram, 'aVertexPosition');
        this.shaderProgramLocations.textureCoordAttribute =
            this.gl.getAttribLocation(shaderProgram, 'aTextureCoord');

        this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uPMatrix');
        this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uMVMatrix');
        this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(shaderProgram, 'uSampler');
        this.shaderProgramLocations.replaceableColorUniform =
            this.gl.getUniformLocation(shaderProgram, 'uReplaceableColor');
        this.shaderProgramLocations.replaceableTypeUniform =
            this.gl.getUniformLocation(shaderProgram, 'uReplaceableType');
        this.shaderProgramLocations.discardAlphaLevelUniform =
            this.gl.getUniformLocation(shaderProgram, 'uDiscardAlphaLevel');
        this.shaderProgramLocations.colorUniform =
            this.gl.getUniformLocation(shaderProgram, 'uColor');
    }

    private resizeEmitterBuffers(emitter: RibbonEmitterWrapper, size: number): void {
        if (size <= emitter.capacity) {
            return;
        }

        size = Math.min(size, emitter.baseCapacity);

        const vertices = new Float32Array(size * 2 * 3);  // 2 vertices * xyz
        const texCoords = new Float32Array(size * 2 * 2); // 2 vertices * xy

        if (emitter.vertices) {
            vertices.set(emitter.vertices);
        }

        emitter.vertices = vertices;
        emitter.texCoords = texCoords;

        emitter.capacity = size;

        if (this.gl) {
            if (!emitter.vertexBuffer) {
                emitter.vertexBuffer = this.gl.createBuffer();
                emitter.texCoordBuffer = this.gl.createBuffer();
            }
        } else if (this.device) {
            emitter.vertexGPUBuffer?.destroy();
            emitter.texCoordGPUBuffer?.destroy();

            emitter.vertexGPUBuffer = this.device.createBuffer({
                label: `ribbon vertex buffer ${emitter.index}`,
                size: vertices.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
            emitter.texCoordGPUBuffer = this.device.createBuffer({
                label: `ribbon texCoord buffer ${emitter.index}`,
                size: texCoords.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            });
        }
    }

    private clearEmitter(emitter: RibbonEmitterWrapper): void {
        emitter.emission = 0;
        emitter.creationTimes = [];

        if (emitter.vertices) {
            emitter.vertices.fill(0);
        }
        if (emitter.texCoords) {
            emitter.texCoords.fill(0);
        }
    }

    private dropOldestPoint(emitter: RibbonEmitterWrapper): void {
        emitter.creationTimes.shift();
        if (emitter.vertices && emitter.vertices.length > 6) {
            emitter.vertices.set(emitter.vertices.subarray(6), 0);
        }
    }

    private getEmitterVisibility(emitter: RibbonEmitterWrapper): number {
        if (this.forcePreviewVisibility) {
            return 1;
        }
        return this.interp.animVectorVal(emitter.props.Visibility, 1);
    }

    private getEmitterLifeSpan(emitter: RibbonEmitterWrapper): number {
        const lifeSpan = Number(emitter.props.LifeSpan);
        return Number.isFinite(lifeSpan) && lifeSpan > 0 ? lifeSpan : MIN_RIBBON_LIFESPAN;
    }

    private getEmitterHistoryPointCount(emitter: RibbonEmitterWrapper): number {
        const lifeSpan = this.getEmitterLifeSpan(emitter);
        const emissionRate = Math.max(1, this.interp.animVectorVal(emitter.props.EmissionRate, 0) * RIBBON_EMISSION_QUALITY_SCALE);
        return Math.max(2, Math.min(emitter.baseCapacity, Math.ceil(emissionRate * lifeSpan) + 1));
    }

    private normalizeHistoryFrame(frame: number): number {
        const info = this.rendererData.animationInfo;
        const interval = info?.Interval;
        if (!interval || interval.length < 2) {
            return frame;
        }

        const start = Number(interval[0]);
        const end = Number(interval[1]);
        const duration = end - start;
        if (!Number.isFinite(start) || !Number.isFinite(end) || duration <= 0) {
            return frame;
        }

        if (info.NonLooping) {
            return Math.max(start, Math.min(end, frame));
        }

        let wrapped = (frame - start) % duration;
        if (wrapped < 0) {
            wrapped += duration;
        }
        return start + wrapped;
    }

    private getRibbonOrigin(emitter: RibbonEmitterWrapper, out: vec3): vec3 | null {
        const nodeWrapper = this.rendererData.nodes[emitter.props.ObjectId];
        if (!nodeWrapper?.matrix) {
            return null;
        }

        const pivot = (emitter.props.PivotPoint && (emitter.props.PivotPoint as any).length >= 3)
            ? emitter.props.PivotPoint as vec3
            : null;
        vec3.set(out, pivot?.[0] ?? 0, pivot?.[1] ?? 0, pivot?.[2] ?? 0);
        vec3.transformMat4(out, out, nodeWrapper.matrix);
        return out;
    }

    private getRibbonAxis(emitter: RibbonEmitterWrapper, out: vec3): vec3 {
        const nodeWrapper = this.rendererData.nodes[emitter.props.ObjectId];
        const matrix = nodeWrapper?.matrix;
        if (matrix) {
            vec3.set(out, matrix[4], matrix[5], matrix[6]);
            if (vec3.squaredLength(out) > 0.000001) {
                return vec3.normalize(out, out);
            }
        }

        vec3.set(out, 0, 1, 0);
        return out;
    }

    private getRibbonFallbackTangent(axis: vec3, out: vec3): vec3 {
        if (Math.abs(axis[2]) < 0.9) {
            vec3.set(tempRibbonFallbackReference, 0, 0, 1);
        } else {
            vec3.set(tempRibbonFallbackReference, 0, 1, 0);
        }

        vec3.cross(out, axis, tempRibbonFallbackReference);
        if (vec3.squaredLength(out) <= 0.000001) {
            vec3.set(out, 1, 0, 0);
            return out;
        }

        return vec3.normalize(out, out);
    }

    private setEmitterColorUniform(emitter: RibbonEmitterWrapper): void {
        const rawColor = emitter.props.Color;
        const color = (rawColor && rawColor.length >= 3) ? rawColor : [1, 1, 1];
        const alpha = this.interp.animVectorVal(emitter.props.Alpha, 1);
        const visibility = this.getEmitterVisibility(emitter);

        this.gl.uniform4f(
            this.shaderProgramLocations.colorUniform,
            color[0],
            color[1],
            color[2],
            alpha * visibility
        );
    }

    private rebuildEmitterHistoryAt(emitter: RibbonEmitterWrapper, frame: number, now: number): boolean {
        const originalFrame = this.rendererData.frame;
        this.clearEmitter(emitter);

        this.rendererData.frame = frame;
        this.nodeMatrixRefresh?.();

        const visibility = this.getEmitterVisibility(emitter);
        const alpha = this.interp.animVectorVal(emitter.props.Alpha, 1);
        const heightBelow = this.interp.animVectorVal(emitter.props.HeightBelow, 0);
        const heightAbove = this.interp.animVectorVal(emitter.props.HeightAbove, 0);
        if (visibility <= 0 || alpha <= 0 || Math.abs(heightBelow) + Math.abs(heightAbove) <= 0.0001) {
            this.rendererData.frame = originalFrame;
            this.nodeMatrixRefresh?.();
            return false;
        }

        const count = this.getEmitterHistoryPointCount(emitter);
        const lifeSpanMs = this.getEmitterLifeSpan(emitter) * 1000;
        this.resizeEmitterBuffers(emitter, count);

        for (let i = 0; i < count; ++i) {
            const ageRatio = count === 1 ? 0 : (count - 1 - i) / (count - 1);
            const ageMs = ageRatio * lifeSpanMs;
            this.rendererData.frame = this.normalizeHistoryFrame(frame - ageMs);
            this.nodeMatrixRefresh?.();

            const origin = this.getRibbonOrigin(emitter, tempRibbonOrigin);
            if (!origin) {
                continue;
            }

            const pointIndex = emitter.creationTimes.length;
            this.writeRibbonPoint(emitter, pointIndex, origin);
            emitter.creationTimes.push(now - ageMs);
        }

        this.rendererData.frame = originalFrame;
        this.nodeMatrixRefresh?.();

        if (emitter.creationTimes.length < 2) {
            this.clearEmitter(emitter);
            return false;
        }

        this.updateEmitterTexCoords(emitter, now);
        return true;
    }

    private writeRibbonPoint(emitter: RibbonEmitterWrapper, pointIndex: number, origin: vec3): void {
        const heightBelow = this.interp.animVectorVal(emitter.props.HeightBelow, 0);
        const heightAbove = this.interp.animVectorVal(emitter.props.HeightAbove, 0);
        const nodeWrapper = this.rendererData.nodes[emitter.props.ObjectId];
        const matrix = nodeWrapper?.matrix;
        const base = pointIndex * 6;

        if (matrix) {
            const pivot = (emitter.props.PivotPoint && (emitter.props.PivotPoint as any).length >= 3)
                ? emitter.props.PivotPoint as vec3
                : null;
            vec3.set(tempRibbonAbove, pivot?.[0] ?? 0, (pivot?.[1] ?? 0) + heightAbove, pivot?.[2] ?? 0);
            vec3.set(tempRibbonBelow, pivot?.[0] ?? 0, (pivot?.[1] ?? 0) - heightBelow, pivot?.[2] ?? 0);
            vec3.transformMat4(tempRibbonAbove, tempRibbonAbove, matrix);
            vec3.transformMat4(tempRibbonBelow, tempRibbonBelow, matrix);
        } else {
            const axis = this.getRibbonAxis(emitter, tempRibbonAxis);
            vec3.scaleAndAdd(tempRibbonAbove, origin, axis, heightAbove);
            vec3.scaleAndAdd(tempRibbonBelow, origin, axis, -heightBelow);
        }

        emitter.vertices[base] = tempRibbonAbove[0];
        emitter.vertices[base + 1] = tempRibbonAbove[1];
        emitter.vertices[base + 2] = tempRibbonAbove[2];
        emitter.vertices[base + 3] = tempRibbonBelow[0];
        emitter.vertices[base + 4] = tempRibbonBelow[1];
        emitter.vertices[base + 5] = tempRibbonBelow[2];
    }

    private ensurePreviewRibbon(emitter: RibbonEmitterWrapper, now: number): void {
        const visibility = this.getEmitterVisibility(emitter);
        const alpha = this.interp.animVectorVal(emitter.props.Alpha, 1);
        const heightBelow = this.interp.animVectorVal(emitter.props.HeightBelow, 0);
        const heightAbove = this.interp.animVectorVal(emitter.props.HeightAbove, 0);
        if (visibility <= 0 || alpha <= 0 || Math.abs(heightBelow) + Math.abs(heightAbove) <= 0.0001) {
            return;
        }

        const origin = this.getRibbonOrigin(emitter, tempRibbonOrigin);
        if (!origin) {
            return;
        }

        const axis = this.getRibbonAxis(emitter, tempRibbonAxis);
        const tangent = this.getRibbonFallbackTangent(axis, tempRibbonFallbackTangent);
        const reach = Math.max(1, Math.abs(heightAbove) + Math.abs(heightBelow));
        const lifeSpan = this.getEmitterLifeSpan(emitter);

        this.resizeEmitterBuffers(emitter, 2);
        const firstOrigin = tempPivotFirst;
        vec3.scaleAndAdd(firstOrigin, origin, tangent, -reach);
        this.writeRibbonPoint(emitter, 0, firstOrigin);
        this.writeRibbonPoint(emitter, 1, origin);
        emitter.creationTimes = [now - lifeSpan * 500, now];
        this.updateEmitterTexCoords(emitter, now);
    }

    private updateEmitter(emitter: RibbonEmitterWrapper, delta: number): void {
        const now = Date.now();
        // Visibility default should be 1 (visible), not 0
        const visibility = this.getEmitterVisibility(emitter);



        if (visibility > 0) {
            // EmissionRate can be animated, use animVectorVal
            const emissionRate = Math.max(0, this.interp.animVectorVal(emitter.props.EmissionRate, 0) * RIBBON_EMISSION_QUALITY_SCALE);

            emitter.emission += emissionRate * delta;

            if (emitter.emission >= 1000) {
                // only once per tick
                emitter.emission = emitter.emission % 1000;

                if (emitter.creationTimes.length >= emitter.baseCapacity) {
                    this.dropOldestPoint(emitter);
                }

                if (emitter.creationTimes.length + 1 > emitter.capacity) {
                    this.resizeEmitterBuffers(emitter, emitter.creationTimes.length + 1);
                }

                this.appendVertices(emitter);

                emitter.creationTimes.push(now);
            }
        }

        if (emitter.creationTimes.length) {
            const lifeSpan = this.getEmitterLifeSpan(emitter);
            while (emitter.creationTimes[0] + lifeSpan * 1000 < now) {
                this.dropOldestPoint(emitter);
            }
        }


        // still exists
        if (emitter.creationTimes.length) {
            this.updateEmitterTexCoords(emitter, now);
        } else if (visibility > 0) {
            if (!this.rebuildEmitterHistoryAt(emitter, this.rendererData.frame, now)) {
                this.ensurePreviewRibbon(emitter, now);
            }
        }
    }

    private appendVertices(emitter: RibbonEmitterWrapper): void {
        const origin = tempPivotFirst;
        const emitterMatrix: mat4 = this.rendererData.nodes[emitter.props.ObjectId].matrix;
        vec3.copy(origin, emitter.props.PivotPoint as vec3);
        vec3.transformMat4(origin, origin, emitterMatrix);

        const currentSize = emitter.creationTimes.length;
        this.writeRibbonPoint(emitter, currentSize, origin);
    }

    private updateEmitterTexCoords(emitter: RibbonEmitterWrapper, now: number): void {
        for (let i = 0; i < emitter.creationTimes.length; ++i) {
            let relativePos = (now - emitter.creationTimes[i]) / (emitter.props.LifeSpan * 1000);
            const textureSlot = this.interp.animVectorVal(emitter.props.TextureSlot, 0);

            const texCoordX = textureSlot % emitter.props.Columns;
            const texCoordY = Math.floor(textureSlot / emitter.props.Rows);
            const cellWidth = 1 / emitter.props.Columns;
            const cellHeight = 1 / emitter.props.Rows;

            relativePos = texCoordX * cellWidth + relativePos * cellWidth;

            emitter.texCoords[i * 2 * 2] = relativePos;
            emitter.texCoords[i * 2 * 2 + 1] = texCoordY * cellHeight;
            emitter.texCoords[i * 2 * 2 + 2] = relativePos;
            emitter.texCoords[i * 2 * 2 + 3] = (1 + texCoordY) * cellHeight;
        }
    }

    private setLayerProps(layer: Layer, textureID: number): void {
        const texture = this.rendererData.model.Textures[textureID];

        if (layer.Shading & LayerShading.TwoSided) {
            this.gl.disable(this.gl.CULL_FACE);
        } else {
            this.gl.enable(this.gl.CULL_FACE);
        }

        if (layer.FilterMode === FilterMode.Transparent) {
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.75);
        } else {
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.);
        }

        if (layer.FilterMode === FilterMode.None) {
            this.gl.disable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            // this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(true);
        } else if (layer.FilterMode === FilterMode.Transparent) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(true);
        } else if (layer.FilterMode === FilterMode.Blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(false);
        } else if (layer.FilterMode === FilterMode.Additive) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_COLOR, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (layer.FilterMode === FilterMode.AddAlpha) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (layer.FilterMode === FilterMode.Modulate) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFuncSeparate(this.gl.ZERO, this.gl.SRC_COLOR, this.gl.ZERO, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (layer.FilterMode === FilterMode.Modulate2x) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFuncSeparate(this.gl.DST_COLOR, this.gl.SRC_COLOR, this.gl.ZERO, this.gl.ONE);
            this.gl.depthMask(false);
        }

        if (texture.Image) {
            this.gl.activeTexture(this.gl.TEXTURE0);
            const gpuTex = this.rendererData.textures[texture.Image] || this.rendererData.fallbackTexture;
            this.gl.bindTexture(this.gl.TEXTURE_2D, gpuTex);
            this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
            this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, 0);
        } else if (texture.ReplaceableId === 1 || texture.ReplaceableId === 2) {
            this.gl.uniform3fv(this.shaderProgramLocations.replaceableColorUniform, this.rendererData.teamColor);
            this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, texture.ReplaceableId);
        }

        if (layer.Shading & LayerShading.NoDepthTest) {
            this.gl.disable(this.gl.DEPTH_TEST);
        }
        if (layer.Shading & LayerShading.NoDepthSet) {
            this.gl.depthMask(false);
        }

        /*if (typeof layer.TVertexAnimId === 'number') {
            let anim: TVertexAnim = this.rendererData.model.TextureAnims[layer.TVertexAnimId];
            let translationRes = this.interp.vec3(translation, anim.Translation);
            let rotationRes = this.interp.quat(rotation, anim.Rotation);
            let scalingRes = this.interp.vec3(scaling, anim.Scaling);
            mat4.fromRotationTranslationScale(
                texCoordMat4,
                rotationRes || defaultRotation,
                translationRes || defaultTranslation,
                scalingRes || defaultScaling
            );
            mat3.set(
                texCoordMat3,
                texCoordMat4[0], texCoordMat4[1], 0,
                texCoordMat4[4], texCoordMat4[5], 0,
                texCoordMat4[12], texCoordMat4[13], 0
            );

            this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, texCoordMat3);
        } else {
            this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, identifyMat3);
        }*/
    }

    private setGeneralBuffers(emitter: RibbonEmitterWrapper): void {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.texCoordBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.texCoords, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.vertices, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
    }

    private renderEmitter(emitter: RibbonEmitterWrapper): void {
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, emitter.creationTimes.length * 2);
    }
}
