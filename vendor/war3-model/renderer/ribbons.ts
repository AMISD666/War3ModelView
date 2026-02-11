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
const tempPivotSecond = vec3.create();


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

                emitter.baseCapacity = Math.ceil(
                    ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) * (emitter.props.LifeSpan ?? 0)
                ) + 1; // extra points

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
                    entryPoint: 'vs',
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
                    entryPoint: 'fs',
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
                baseCapacity: Math.ceil(
                    ModelInterp.maxAnimVectorVal(ribbonEmitter.EmissionRate) * (ribbonEmitter.LifeSpan ?? 0)
                ) + 1,
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
            const visibility = this.interp.animVectorVal(emitter.props.Visibility, 1);
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
            const materialID = typeof emitter.props.MaterialID === 'number' ? emitter.props.MaterialID : 0;
            const material: Material | undefined = this.rendererData.model.Materials?.[materialID];
            if (!material || !Array.isArray(material.Layers)) {
                continue;
            }
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

            const materialID = typeof emitter.props.MaterialID === 'number' ? emitter.props.MaterialID : 0;
            const material: Material | undefined = this.rendererData.model.Materials?.[materialID];
            if (!material || !Array.isArray(material.Layers)) {
                continue;
            }

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
                const rawColor = emitter.props.Color as any;
                const color = (rawColor && rawColor.length >= 3) ? rawColor : [1, 1, 1];
                fsUniformsViews.color.set([
                    color[0],
                    color[1],
                    color[2],
                    this.interp.animVectorVal(emitter.props.Alpha, 1)
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

    private updateEmitter(emitter: RibbonEmitterWrapper, delta: number): void {
        const now = Date.now();
        // Visibility default should be 1 (visible), not 0
        const visibility = this.interp.animVectorVal(emitter.props.Visibility, 1);



        if (visibility > 0) {
            // EmissionRate can be animated, use animVectorVal
            const emissionRate = this.interp.animVectorVal(emitter.props.EmissionRate, 0);

            emitter.emission += emissionRate * delta;

            if (emitter.emission >= 1000) {
                // only once per tick
                emitter.emission = emitter.emission % 1000;

                if (emitter.creationTimes.length + 1 > emitter.capacity) {
                    this.resizeEmitterBuffers(emitter, emitter.creationTimes.length + 1);
                }

                this.appendVertices(emitter);

                emitter.creationTimes.push(now);
            }
        }

        if (emitter.creationTimes.length) {
            const lifeSpan = emitter.props.LifeSpan ?? 0;
            while (emitter.creationTimes[0] + lifeSpan * 1000 < now) {
                emitter.creationTimes.shift();
                // Performance fix: Use typed array set to shift vertices instead of manual loop
                // Each point has 6 floats (3 for first, 3 for second)
                if (emitter.vertices.length > 6) {
                    emitter.vertices.set(emitter.vertices.subarray(6), 0);
                }
            }
        }


        // still exists
        if (emitter.creationTimes.length) {
            this.updateEmitterTexCoords(emitter, now);
        }
    }

    private appendVertices(emitter: RibbonEmitterWrapper): void {
        const first = tempPivotFirst;
        const second = tempPivotSecond;
        vec3.copy(first, emitter.props.PivotPoint as vec3);
        vec3.copy(second, emitter.props.PivotPoint as vec3);

        const heightBelow = this.interp.animVectorVal(emitter.props.HeightBelow, 0);
        const heightAbove = this.interp.animVectorVal(emitter.props.HeightAbove, 0);

        first[1] -= heightBelow;
        second[1] += heightAbove;

        const emitterMatrix: mat4 = this.rendererData.nodes[emitter.props.ObjectId].matrix;
        vec3.transformMat4(first, first, emitterMatrix);
        vec3.transformMat4(second, second, emitterMatrix);


        const currentSize = emitter.creationTimes.length;
        emitter.vertices[currentSize * 6] = first[0];
        emitter.vertices[currentSize * 6 + 1] = first[1];
        emitter.vertices[currentSize * 6 + 2] = first[2];
        emitter.vertices[currentSize * 6 + 3] = second[0];
        emitter.vertices[currentSize * 6 + 4] = second[1];
        emitter.vertices[currentSize * 6 + 5] = second[2];
    }

    private updateEmitterTexCoords(emitter: RibbonEmitterWrapper, now: number): void {
        for (let i = 0; i < emitter.creationTimes.length; ++i) {
            const rawLifeSpan = emitter.props.LifeSpan;
            const lifeSpan = (typeof rawLifeSpan === 'number' && isFinite(rawLifeSpan) && rawLifeSpan > 0) ? rawLifeSpan : 1;

            const rawColumns = emitter.props.Columns;
            const columns = (typeof rawColumns === 'number' && isFinite(rawColumns) && rawColumns > 0) ? rawColumns : 1;

            const rawRows = emitter.props.Rows;
            const rows = (typeof rawRows === 'number' && isFinite(rawRows) && rawRows > 0) ? rawRows : 1;

            let relativePos = (now - emitter.creationTimes[i]) / (lifeSpan * 1000);
            const textureSlot = this.interp.animVectorVal(emitter.props.TextureSlot, 0);

            const texCoordX = textureSlot % columns;
            const texCoordY = Math.floor(textureSlot / rows);
            const cellWidth = 1 / columns;
            const cellHeight = 1 / rows;

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
