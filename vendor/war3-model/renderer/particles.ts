import {
    ParticleEmitter2, ParticleEmitter2FilterMode, ParticleEmitter2Flags,
    ParticleEmitter2FramesFlags
} from '../model';
import { mat4, vec3, vec4, mat3, quat } from 'gl-matrix';
import { ModelInterp } from './modelInterp';
import { degToRad, rand, getShader } from './util';
import { RendererData } from './rendererData';
import { lerp } from './interp';
import vertexShader from './shaders/webgl/particles.vs.glsl?raw';
import fragmentShader from './shaders/webgl/particles.fs.glsl?raw';
import particlesShader from './shaders/webgpu/particles.wgsl?raw';

const rotateCenter: vec3 = vec3.fromValues(0, 0, 0);
const firstColor = vec4.create();
const secondColor = vec4.create();
const color = vec4.create();
const tailPos = vec3.create();
const tailCross = vec3.create();
const particleWorldPos = vec3.create();
const particleWorldSpeed = vec3.create();
const tailCameraVec = vec3.create();
const particleHeadVec = vec3.create();
const emitterScaleVec = vec3.create();
const emitterRotationQuat = quat.create();
const particleRotationQuat = quat.create();
const planeTiltQuat = quat.create();
const localDirection = vec3.create();
const emitterOrientationMat3 = mat3.create();
const particlePlaneNormal = vec3.create();
const cameraDirectionZ = vec3.create();
const worldUnitZ = vec3.fromValues(0, 0, 1);
const identityEmitterMatrix = mat4.create();

/**
 * Helper to check particle emitter flags from both Flags bitmask and individual boolean properties.
 * This ensures compatibility with both parsed model data (uses Flags bitmask) and
 * UI-edited data (uses individual boolean properties like XYQuad, ModelSpace, etc.)
 */
function hasParticleFlag(props: ParticleEmitter2, flag: ParticleEmitter2Flags): boolean {
    // First check the Flags bitmask
    if ((props.Flags & flag) !== 0) {
        return true;
    }
    // Also check individual boolean properties for UI compatibility
    switch (flag) {
        case ParticleEmitter2Flags.XYQuad:
            return (props as any).XYQuad === true;
        case ParticleEmitter2Flags.ModelSpace:
            return (props as any).ModelSpace === true;
        case ParticleEmitter2Flags.LineEmitter:
            return (props as any).LineEmitter === true;
        case ParticleEmitter2Flags.Unshaded:
            return (props as any).Unshaded === true;
        case ParticleEmitter2Flags.Unfogged:
            return (props as any).Unfogged === true;
        case ParticleEmitter2Flags.SortPrimsFarZ:
            return (props as any).SortPrimsFarZ === true;
        default:
            return false;
    }
}

function getEmitterMatrix(rendererData: RendererData, objectId: number): mat4 {
    const nodeWrapper = rendererData?.nodes?.[objectId];
    const matrix = nodeWrapper?.matrix;
    return matrix || identityEmitterMatrix;
}

const ZERO_PIVOT: [number, number, number] = [0, 0, 0];

/** 解析发射器局部轴心：节点包装器 → 发射器 props → 全局 PIVT 表（避免热同步后 node 与 PE2 对象引用分裂导致误用 [0,0,0]） */
function resolveEmitterPivot(rendererData: RendererData, emitterProps: ParticleEmitter2): [number, number, number] {
    const oid = emitterProps.ObjectId;
    if (typeof oid !== 'number' || oid < 0) {
        return ZERO_PIVOT;
    }

    const fromAnyPivot = (p: unknown): [number, number, number] | null => {
        if (p == null) {
            return null;
        }
        if (ArrayBuffer.isView(p)) {
            const v = p as ArrayBufferView;
            if (v.length < 3) {
                return null;
            }
            return [Number(v[0]), Number(v[1]), Number(v[2])];
        }
        if (Array.isArray(p) && p.length >= 3) {
            return [Number(p[0]), Number(p[1]), Number(p[2])];
        }
        return null;
    };

    const wrap = rendererData.nodes?.[oid];
    const fromNode = fromAnyPivot(wrap?.node?.PivotPoint as unknown);
    if (fromNode) {
        return fromNode;
    }

    const fromProps = fromAnyPivot((emitterProps as any).PivotPoint);
    if (fromProps) {
        return fromProps;
    }

    const globalPiv = (rendererData.model as { PivotPoints?: unknown[] })?.PivotPoints?.[oid];
    const fromGlobal = fromAnyPivot(globalPiv);
    if (fromGlobal) {
        return fromGlobal;
    }

    return ZERO_PIVOT;
}


interface Particle {
    emitter: ParticleEmitterWrapper;
    // xyz
    pos: vec3;
    // xyz
    speed: vec3;
    angle: number;
    gravity: number;
    lifeSpan: number;
    orientation: mat3;
}

interface ParticleEmitterWrapper {
    index: number;

    emission: number;
    squirtFrame: number;
    particles: Particle[];
    props: ParticleEmitter2;
    capacity: number;
    baseCapacity: number;
    // head or tail or both
    type: number;

    // xyz
    tailVertices: Float32Array;
    tailVertexBuffer: WebGLBuffer;
    tailVertexGPUBuffer: GPUBuffer;
    // xyz
    headVertices: Float32Array;
    headVertexBuffer: WebGLBuffer;
    headVertexGPUBuffer: GPUBuffer;
    // xy
    tailTexCoords: Float32Array;
    tailTexCoordBuffer: WebGLBuffer;
    tailTexCoordGPUBuffer: GPUBuffer;
    // xy
    headTexCoords: Float32Array;
    headTexCoordBuffer: WebGLBuffer;
    headTexCoordGPUBuffer: GPUBuffer;
    // rgba
    colors: Float32Array;
    colorBuffer: WebGLBuffer;
    colorGPUBuffer: GPUBuffer;
    // 2 * triangles
    indices: Uint16Array;
    indexBuffer: WebGLBuffer;
    indexGPUBuffer: GPUBuffer;

    fsUniformsBuffer: GPUBuffer;

    // Debug logging flags
    _xyQuadLogged?: boolean;
    _velocityLogged?: boolean;
    _syncLogged?: boolean;
    _needsInitialSync?: boolean; // Force refresh on first sync after creation
    _uvAnimLogged?: boolean; // UV animation debug logging
    _uvLogCounter?: number; // UV animation log counter for periodic logging
}

const DISCARD_ALPHA_KEY_LEVEL = 0.75;
const DISCARD_MODULATE_LEVEL = 0.01;

export class ParticlesController {
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
        vertexPositionAttribute: number | null;
        textureCoordAttribute: number | null;
        colorAttribute: number | null;
        pMatrixUniform: WebGLUniformLocation | null;
        mvMatrixUniform: WebGLUniformLocation | null;
        samplerUniform: WebGLUniformLocation | null;
        replaceableColorUniform: WebGLUniformLocation | null;
        replaceableTypeUniform: WebGLUniformLocation | null;
        discardAlphaLevelUniform: WebGLUniformLocation | null;
    };

    private particleStorage: Particle[];

    private interp: ModelInterp;
    private rendererData: RendererData;
    private emitters: ParticleEmitterWrapper[];

    private particleBaseVectors: vec3[];

    constructor(interp: ModelInterp, rendererData: RendererData) {
        this.shaderProgramLocations = {
            vertexPositionAttribute: null,
            textureCoordAttribute: null,
            colorAttribute: null,
            pMatrixUniform: null,
            mvMatrixUniform: null,
            samplerUniform: null,
            replaceableColorUniform: null,
            replaceableTypeUniform: null,
            discardAlphaLevelUniform: null
        };
        this.particleStorage = [];
        this.interp = interp;
        this.rendererData = rendererData;
        this.emitters = [];

        if (rendererData.model.ParticleEmitters2.length) {
            this.particleBaseVectors = [
                vec3.create(),
                vec3.create(),
                vec3.create(),
                vec3.create()
            ];

            for (let i = 0; i < rendererData.model.ParticleEmitters2.length; ++i) {
                const particleEmitter = rendererData.model.ParticleEmitters2[i];
                // Apply same defaults as syncEmitters to ensure consistency
                const frameFlags = particleEmitter.FrameFlags || 1;
                const lifeSpan = particleEmitter.LifeSpan || 1;

                const emitter: ParticleEmitterWrapper = {
                    index: i,
                    emission: 0,
                    squirtFrame: 0,
                    particles: [],
                    props: particleEmitter,
                    capacity: 0,
                    baseCapacity: 0,
                    type: frameFlags,
                    tailVertices: null,
                    tailVertexBuffer: null,
                    tailVertexGPUBuffer: null,
                    headVertices: null,
                    headVertexBuffer: null,
                    headVertexGPUBuffer: null,
                    tailTexCoords: null,
                    tailTexCoordBuffer: null,
                    tailTexCoordGPUBuffer: null,
                    headTexCoords: null,
                    headTexCoordBuffer: null,
                    headTexCoordGPUBuffer: null,
                    colors: null,
                    colorBuffer: null,
                    colorGPUBuffer: null,
                    indices: null,
                    indexBuffer: null,
                    indexGPUBuffer: null,
                    fsUniformsBuffer: null
                };

                emitter.baseCapacity = Math.ceil(
                    ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) * lifeSpan
                );

                // Mark for initial sync to ensure props are properly applied
                emitter._needsInitialSync = true;

                this.emitters.push(emitter);
            }
        }
    }

    private createEmitterWrapper(particleEmitter: ParticleEmitter2, index: number): ParticleEmitterWrapper {
        const frameFlags = particleEmitter.FrameFlags || 1;
        const lifeSpan = particleEmitter.LifeSpan || 1;

        const emitter: ParticleEmitterWrapper = {
            index,
            emission: 0,
            squirtFrame: 0,
            particles: [],
            props: particleEmitter,
            capacity: 0,
            baseCapacity: 0,
            type: frameFlags,
            tailVertices: null,
            tailVertexBuffer: null,
            tailVertexGPUBuffer: null,
            headVertices: null,
            headVertexBuffer: null,
            headVertexGPUBuffer: null,
            tailTexCoords: null,
            tailTexCoordBuffer: null,
            tailTexCoordGPUBuffer: null,
            headTexCoords: null,
            headTexCoordBuffer: null,
            headTexCoordGPUBuffer: null,
            colors: null,
            colorBuffer: null,
            colorGPUBuffer: null,
            indices: null,
            indexBuffer: null,
            indexGPUBuffer: null,
            fsUniformsBuffer: null,
            _needsInitialSync: true
        };

        emitter.baseCapacity = Math.ceil(
            ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) * lifeSpan
        );

        return emitter;
    }

    private destroyEmitterWrapper(emitter: ParticleEmitterWrapper): void {
        if (!emitter) return;

        if (emitter.colorGPUBuffer) emitter.colorGPUBuffer.destroy();
        if (emitter.indexGPUBuffer) emitter.indexGPUBuffer.destroy();
        if (emitter.headVertexGPUBuffer) emitter.headVertexGPUBuffer.destroy();
        if (emitter.tailVertexGPUBuffer) emitter.tailVertexGPUBuffer.destroy();
        if (emitter.headTexCoordGPUBuffer) emitter.headTexCoordGPUBuffer.destroy();
        if (emitter.tailTexCoordGPUBuffer) emitter.tailTexCoordGPUBuffer.destroy();
        if (emitter.fsUniformsBuffer) emitter.fsUniformsBuffer.destroy();

        for (const particle of emitter.particles) {
            this.particleStorage.push(particle);
        }

        emitter.particles = [];
        emitter.capacity = 0;
        emitter.baseCapacity = 0;
        emitter.headVertices = null;
        emitter.tailVertices = null;
        emitter.headTexCoords = null;
        emitter.tailTexCoords = null;
        emitter.colors = null;
        emitter.indices = null;
        emitter.headVertexBuffer = null;
        emitter.tailVertexBuffer = null;
        emitter.headTexCoordBuffer = null;
        emitter.tailTexCoordBuffer = null;
        emitter.colorBuffer = null;
        emitter.indexBuffer = null;
        emitter.headVertexGPUBuffer = null;
        emitter.tailVertexGPUBuffer = null;
        emitter.headTexCoordGPUBuffer = null;
        emitter.tailTexCoordGPUBuffer = null;
        emitter.colorGPUBuffer = null;
        emitter.indexGPUBuffer = null;
        emitter.fsUniformsBuffer = null;
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
        this.particleStorage = [];

        if (this.gpuVSUniformsBuffer) {
            this.gpuVSUniformsBuffer.destroy();
            this.gpuVSUniformsBuffer = null;
        }

        for (const emitter of this.emitters) {
            if (emitter.colorGPUBuffer) {
                emitter.colorGPUBuffer.destroy();
            }
            if (emitter.indexGPUBuffer) {
                emitter.indexGPUBuffer.destroy();
            }
            if (emitter.headVertexGPUBuffer) {
                emitter.headVertexGPUBuffer.destroy();
            }
            if (emitter.tailVertexGPUBuffer) {
                emitter.tailVertexGPUBuffer.destroy();
            }
            if (emitter.headTexCoordGPUBuffer) {
                emitter.headTexCoordGPUBuffer.destroy();
            }
            if (emitter.tailTexCoordGPUBuffer) {
                emitter.tailTexCoordGPUBuffer.destroy();
            }
            if (emitter.fsUniformsBuffer) {
                emitter.fsUniformsBuffer.destroy();
            }
        }

        this.emitters = [];
    }

    /**
     * Synchronizes the internal emitters array with the model's ParticleEmitters2.
     * This allows newly added particle emitters to be detected and rendered without
     * needing to recreate the entire renderer.
     */
    public syncEmitters(): void {
        const model = this.rendererData.model;
        const particleEmitters = model.ParticleEmitters2 || [];

        if (particleEmitters.length && !this.particleBaseVectors) {
            this.particleBaseVectors = [
                vec3.create(),
                vec3.create(),
                vec3.create(),
                vec3.create()
            ];
        }

        if (!particleEmitters.length) {
            for (const emitter of this.emitters) {
                this.destroyEmitterWrapper(emitter);
            }
            this.emitters = [];
            return;
        }

        // 仅按长度与槽位 ObjectId 判断结构变化。勿用 emitter.type !== FrameFlags：
        // 轻量同步用 Object.assign 原地改 props 时，wrapper.type 可能未与 props.FrameFlags 同步，会误判为结构变化并整表销毁 → 粒子消失。
        const structuralMismatch =
            this.emitters.length !== particleEmitters.length ||
            this.emitters.some((emitter, index) => {
                const nextProps = particleEmitters[index];
                return !nextProps || emitter.props.ObjectId !== nextProps.ObjectId;
            });

        if (structuralMismatch) {
            for (const emitter of this.emitters) {
                this.destroyEmitterWrapper(emitter);
            }
            this.emitters = particleEmitters.map((particleEmitter, index) => this.createEmitterWrapper(particleEmitter, index));
            return;
        }

        for (let i = 0; i < this.emitters.length; ++i) {
            const newProps = particleEmitters[i];
            const oldProps = this.emitters[i].props;

            this.emitters[i].index = i;
            this.emitters[i].props = newProps;

            const needsInitialSync = this.emitters[i]._needsInitialSync === true;
            const propsChanged = needsInitialSync ||
                oldProps !== newProps ||
                oldProps.LifeSpan !== newProps.LifeSpan ||
                oldProps.FrameFlags !== newProps.FrameFlags ||
                oldProps.EmissionRate !== newProps.EmissionRate ||
                oldProps.Speed !== newProps.Speed ||
                oldProps.Variation !== newProps.Variation ||
                oldProps.Latitude !== newProps.Latitude ||
                oldProps.Width !== newProps.Width ||
                oldProps.Length !== newProps.Length ||
                oldProps.Gravity !== newProps.Gravity ||
                oldProps.LineEmitter !== newProps.LineEmitter ||
                oldProps.ModelSpace !== newProps.ModelSpace ||
                oldProps.XYQuad !== newProps.XYQuad;

            if (propsChanged) {
                for (const particle of this.emitters[i].particles) {
                    this.particleStorage.push(particle);
                }
                this.emitters[i].particles = [];
                this.emitters[i]._xyQuadLogged = false;
                this.emitters[i]._velocityLogged = false;
                this.emitters[i]._needsInitialSync = false;
            }

            // Object.assign 原地更新时 EmissionRate 引用可能不变 → propsChanged 为 false，但 Keys 已修复，须每帧重算容量
            const emissionRate = newProps.EmissionRate;
            const lifeSpan = newProps.LifeSpan || 1;
            this.emitters[i].baseCapacity = Math.ceil(
                ModelInterp.maxAnimVectorVal(emissionRate) * lifeSpan
            );
            // 每帧与 props 对齐 Head/Tail 位，避免 type 漂移导致渲染路径与数据不一致
            this.emitters[i].type = newProps.FrameFlags || 1;
        }
    }

    public initGL(glContext: WebGLRenderingContext): void {
        this.gl = glContext;

        this.initShaders();
    }

    public initGPUDevice(device: GPUDevice): void {
        this.device = device;

        this.gpuShaderModule = device.createShaderModule({
            label: 'particles shader module',
            code: particlesShader
        });

        this.vsBindGroupLayout = this.device.createBindGroupLayout({
            label: 'particles vs bind group layout',
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
            label: 'particles bind group layout2',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 32
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
            label: 'particles pipeline layout',
            bindGroupLayouts: [
                this.vsBindGroupLayout,
                this.fsBindGroupLayout
            ]
        });

        const createPipeline = (name: string, blend: GPUBlendState, depth: GPUDepthStencilState) => {
            return device.createRenderPipeline({
                label: `particles pipeline ${name}`,
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
                    }, {
                        arrayStride: 16,
                        attributes: [{
                            shaderLocation: 2,
                            offset: 0,
                            format: 'float32x4' as const
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
                depthStencil: depth
            });
        };

        this.gpuPipelines = [
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
            }),
            createPipeline('alphaKey', {
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
        ];

        this.gpuVSUniformsBuffer = this.device.createBuffer({
            label: 'particles vs uniforms',
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
        this.shaderProgramLocations.colorAttribute =
            this.gl.getAttribLocation(shaderProgram, 'aColor');

        this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uPMatrix');
        this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(shaderProgram, 'uMVMatrix');
        this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(shaderProgram, 'uSampler');
        this.shaderProgramLocations.replaceableColorUniform =
            this.gl.getUniformLocation(shaderProgram, 'uReplaceableColor');
        this.shaderProgramLocations.replaceableTypeUniform =
            this.gl.getUniformLocation(shaderProgram, 'uReplaceableType');
        this.shaderProgramLocations.discardAlphaLevelUniform =
            this.gl.getUniformLocation(shaderProgram, 'uDiscardAlphaLevel');
    }

    private updateParticle(particle: Particle, delta: number): void {
        delta /= 1000;

        particle.lifeSpan -= delta;
        if (particle.lifeSpan <= 0) {
            return;
        }

        // gravity is a scalar affecting Z speed
        particle.speed[2] -= particle.gravity * delta;

        // pos += speed * delta
        vec3.scaleAndAdd(particle.pos, particle.pos, particle.speed, delta);
    }


    private resizeEmitterBuffers(emitter: ParticleEmitterWrapper, size: number): void {
        if (size <= emitter.capacity) {
            return;
        }

        size = Math.max(size, emitter.baseCapacity);

        let tailVertices;
        let headVertices;
        let tailTexCoords;
        let headTexCoords;

        if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
            tailVertices = new Float32Array(size * 4 * 3);  // 4 vertices * xyz
            tailTexCoords = new Float32Array(size * 4 * 2); // 4 vertices * xy
        }
        if (emitter.type & ParticleEmitter2FramesFlags.Head) {
            headVertices = new Float32Array(size * 4 * 3);  // 4 vertices * xyz
            headTexCoords = new Float32Array(size * 4 * 2); // 4 vertices * xy
        }

        const colors = new Float32Array(size * 4 * 4);    // 4 vertices * rgba
        const indices = new Uint16Array(size * 6);        // 4 vertices * 2 triangles

        if (emitter.capacity) {
            indices.set(emitter.indices);
        }

        for (let i = emitter.capacity; i < size; ++i) {
            indices[i * 6] = i * 4;
            indices[i * 6 + 1] = i * 4 + 1;
            indices[i * 6 + 2] = i * 4 + 2;
            indices[i * 6 + 3] = i * 4;
            indices[i * 6 + 4] = i * 4 + 2;
            indices[i * 6 + 5] = i * 4 + 3;
        }

        if (tailVertices) {
            emitter.tailVertices = tailVertices;
            emitter.tailTexCoords = tailTexCoords;
        }
        if (headVertices) {
            emitter.headVertices = headVertices;
            emitter.headTexCoords = headTexCoords;
        }
        emitter.colors = colors;
        emitter.indices = indices;

        emitter.capacity = size;

        if (!emitter.indexBuffer) {
            if (this.gl) {
                if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
                    emitter.tailVertexBuffer = this.gl.createBuffer();
                    emitter.tailTexCoordBuffer = this.gl.createBuffer();
                }
                if (emitter.type & ParticleEmitter2FramesFlags.Head) {
                    emitter.headVertexBuffer = this.gl.createBuffer();
                    emitter.headTexCoordBuffer = this.gl.createBuffer();
                }
                emitter.colorBuffer = this.gl.createBuffer();
                emitter.indexBuffer = this.gl.createBuffer();
            } else if (this.device) {
                if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
                    emitter.tailVertexGPUBuffer?.destroy();
                    emitter.tailVertexGPUBuffer = this.device.createBuffer({
                        label: `particles tail vertex buffer ${emitter.index}`,
                        size: tailVertices.byteLength,
                        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                    });
                    emitter.tailTexCoordGPUBuffer?.destroy();
                    emitter.tailTexCoordGPUBuffer = this.device.createBuffer({
                        label: `particles tail texCoords buffer ${emitter.index}`,
                        size: tailTexCoords.byteLength,
                        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                    });
                }
                if (emitter.type & ParticleEmitter2FramesFlags.Head) {
                    emitter.headVertexGPUBuffer?.destroy();
                    emitter.headVertexGPUBuffer = this.device.createBuffer({
                        label: `particles head vertex buffer ${emitter.index}`,
                        size: headVertices.byteLength,
                        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                    });
                    this.device.queue.writeBuffer(emitter.headVertexGPUBuffer, 0, headVertices as any);
                    emitter.headTexCoordGPUBuffer?.destroy();
                    emitter.headTexCoordGPUBuffer = this.device.createBuffer({
                        label: `particles head texCoords buffer ${emitter.index}`,
                        size: headTexCoords.byteLength,
                        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                    });
                    this.device.queue.writeBuffer(emitter.headTexCoordGPUBuffer, 0, headTexCoords as any);
                }
                emitter.colorGPUBuffer?.destroy();
                emitter.colorGPUBuffer = this.device.createBuffer({
                    label: `particles color buffer ${emitter.index}`,
                    size: colors.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
                this.device.queue.writeBuffer(emitter.colorGPUBuffer, 0, colors as any);
                emitter.indexGPUBuffer?.destroy();
                emitter.indexGPUBuffer = this.device.createBuffer({
                    label: `particles index buffer ${emitter.index}`,
                    size: indices.byteLength,
                    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
                });
                this.device.queue.writeBuffer(emitter.indexGPUBuffer, 0, indices as any);
            }
        }
    }

    public update(delta: number): void {
        // Sync emitters with model data to detect newly added particles
        this.syncEmitters();

        for (const emitter of this.emitters) {
            this.updateEmitter(emitter, delta);
        }
    }

    public render(mvMatrix: mat4, pMatrix: mat4): void {
        // Particle quads/tails must be effectively double-sided.
        // Negative TailLength (valid in Warcraft models) flips winding,
        // so back-face culling would incorrectly hide them.
        this.gl.disable(this.gl.CULL_FACE);
        this.gl.useProgram(this.shaderProgram);

        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);

        this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.colorAttribute);

        for (const emitter of this.emitters) {
            if (!emitter.particles.length) {
                continue;
            }

            this.setLayerProps(emitter);
            this.setGeneralBuffers(emitter);

            if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
                this.renderEmitterType(emitter, ParticleEmitter2FramesFlags.Tail);
            }
            if (emitter.type & ParticleEmitter2FramesFlags.Head) {
                this.renderEmitterType(emitter, ParticleEmitter2FramesFlags.Head);
            }
        }

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.colorAttribute);
    }

    private renderGPUEmitterType(pass: GPURenderPassEncoder, emitter: ParticleEmitterWrapper, type: ParticleEmitter2FramesFlags): void {
        if (type === ParticleEmitter2FramesFlags.Tail) {
            this.device.queue.writeBuffer(emitter.tailTexCoordGPUBuffer, 0, emitter.tailTexCoords as any);
            pass.setVertexBuffer(1, emitter.tailTexCoordGPUBuffer);
        } else {
            this.device.queue.writeBuffer(emitter.headTexCoordGPUBuffer, 0, emitter.headTexCoords as any);
            pass.setVertexBuffer(1, emitter.headTexCoordGPUBuffer);
        }

        if (type === ParticleEmitter2FramesFlags.Tail) {
            this.device.queue.writeBuffer(emitter.tailVertexGPUBuffer, 0, emitter.tailVertices as any);
            pass.setVertexBuffer(0, emitter.tailVertexGPUBuffer);
        } else {
            this.device.queue.writeBuffer(emitter.headVertexGPUBuffer, 0, emitter.headVertices as any);
            pass.setVertexBuffer(0, emitter.headVertexGPUBuffer);
        }

        pass.drawIndexed(emitter.particles.length * 6);
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

        pass.setBindGroup(0, this.gpuVSUniformsBindGroup);

        for (const emitter of this.emitters) {
            if (!emitter.particles.length) {
                continue;
            }

            const pipeline = this.gpuPipelines[emitter.props.FilterMode] || this.gpuPipelines[0];
            pass.setPipeline(pipeline);

            const textureID = emitter.props.TextureID;
            const texture = this.rendererData.model.Textures[textureID];

            const fsUniformsValues = new ArrayBuffer(32);
            const fsUniformsViews = {
                replaceableColor: new Float32Array(fsUniformsValues, 0, 3),
                replaceableType: new Uint32Array(fsUniformsValues, 12, 1),
                discardAlphaLevel: new Float32Array(fsUniformsValues, 16, 1),
            };

            fsUniformsViews.replaceableColor.set(this.rendererData.teamColor);
            fsUniformsViews.replaceableType.set([texture.ReplaceableId || 0]);
            if (emitter.props.FilterMode === ParticleEmitter2FilterMode.AlphaKey) {
                fsUniformsViews.discardAlphaLevel.set([DISCARD_ALPHA_KEY_LEVEL]);
            } else if (
                emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate ||
                emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate2x
            ) {
                fsUniformsViews.discardAlphaLevel.set([DISCARD_MODULATE_LEVEL]);
            } else {
                fsUniformsViews.discardAlphaLevel.set([0]);
            }

            if (!emitter.fsUniformsBuffer) {
                emitter.fsUniformsBuffer = this.device.createBuffer({
                    label: `particles fs uniforms ${emitter.index}`,
                    size: 32,
                    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
                });
            }

            this.device.queue.writeBuffer(emitter.fsUniformsBuffer, 0, fsUniformsValues);

            const fsUniformsBindGroup = this.device.createBindGroup({
                label: `particles fs uniforms ${emitter.index}`,
                layout: this.fsBindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: emitter.fsUniformsBuffer }
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

            this.device.queue.writeBuffer(emitter.colorGPUBuffer, 0, emitter.colors as any);
            this.device.queue.writeBuffer(emitter.indexGPUBuffer, 0, emitter.indices as any);
            pass.setVertexBuffer(2, emitter.colorGPUBuffer);
            pass.setIndexBuffer(emitter.indexGPUBuffer, 'uint16');

            if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
                this.renderGPUEmitterType(pass, emitter, ParticleEmitter2FramesFlags.Tail);
            }
            if (emitter.type & ParticleEmitter2FramesFlags.Head) {
                this.renderGPUEmitterType(pass, emitter, ParticleEmitter2FramesFlags.Head);
            }
        }
    }

    private updateEmitter(emitter: ParticleEmitterWrapper, delta: number): void {
        const p = emitter.props as any;
        const visRaw =
            p.Visibility !== undefined && p.Visibility !== null ? p.Visibility : p.VisibilityAnim;
        const visibility = this.interp.animVectorVal(visRaw, 1);

        if (visibility > 0) {
            if (emitter.props.Squirt && typeof emitter.props.EmissionRate !== 'number') {
                const interp = this.interp.findKeyframes(emitter.props.EmissionRate);

                if (interp && interp.left && interp.left.Frame !== emitter.squirtFrame) {
                    emitter.squirtFrame = interp.left.Frame;
                    if (interp.left.Vector[0] > 0) {
                        emitter.emission += interp.left.Vector[0] * 1000;
                    }
                }
            } else {
                const emissionRate = this.interp.animVectorVal(emitter.props.EmissionRate, 0);

                emitter.emission += emissionRate * delta;
            }

            while (emitter.emission >= 1000) {
                emitter.emission -= 1000;
                emitter.particles.push(
                    this.createParticle(emitter, getEmitterMatrix(this.rendererData, emitter.props.ObjectId))
                );
            }
        }

        if (emitter.particles.length) {
            const updatedParticles = [];
            for (const particle of emitter.particles) {
                this.updateParticle(particle, delta);
                if (particle.lifeSpan > 0) {
                    updatedParticles.push(particle);
                } else {
                    this.particleStorage.push(particle);
                }
            }
            emitter.particles = updatedParticles;

            if (emitter.type & ParticleEmitter2FramesFlags.Head) {
                const isXYQuad = hasParticleFlag(emitter.props, ParticleEmitter2Flags.XYQuad);

                // Base vectors in XY plane - same order for both modes
                vec3.set(this.particleBaseVectors[0], -1, -1, 0);
                vec3.set(this.particleBaseVectors[1], -1, 1, 0);
                vec3.set(this.particleBaseVectors[2], 1, 1, 0);
                vec3.set(this.particleBaseVectors[3], 1, -1, 0);

                if (isXYQuad) {
                    // XYQuad: Keep particles flat in XY plane (parallel to ground/grid)
                    // Base vectors are already in XY plane (Z=0), so no rotation needed
                    // Just keep them as-is for horizontal flat orientation
                } else {
                    // Billboarded particles: rotate to face the camera
                    for (let i = 0; i < 4; ++i) {
                        vec3.transformQuat(this.particleBaseVectors[i], this.particleBaseVectors[i],
                            this.rendererData.cameraQuat);
                    }
                }
            }

            this.resizeEmitterBuffers(emitter, emitter.particles.length);
            for (let i = 0; i < emitter.particles.length; ++i) {
                this.updateParticleBuffers(emitter.particles[i], i, emitter);
            }
        }
    }

    private createParticle(emitter: ParticleEmitterWrapper, emitterMatrix: mat4) {
        let particle: Particle;
        if (this.particleStorage.length) {
            particle = this.particleStorage.pop();
        } else {
            particle = {
                emitter: null,
                pos: vec3.create(),
                angle: 0,
                speed: vec3.create(),
                gravity: null,
                lifeSpan: null,
                orientation: mat3.create()
            };
        }

        const width: number = this.interp.animVectorVal(emitter.props.Width, 0) * 0.5;
        const length: number = this.interp.animVectorVal(emitter.props.Length, 0) * 0.5;
        const latitude: number = degToRad(this.interp.animVectorVal(emitter.props.Latitude, 0));
        const variation: number = this.interp.animVectorVal(emitter.props.Variation, 0);
        const baseSpeed: number = this.interp.animVectorVal(emitter.props.Speed, 0);
        const isModelSpace = hasParticleFlag(emitter.props, ParticleEmitter2Flags.ModelSpace);

        const pivot = resolveEmitterPivot(this.rendererData, emitter.props);

        particle.emitter = emitter;
        particle.angle = 0;

        const speed = baseSpeed * (1 + rand(-variation, variation));

        const localPos = vec3.fromValues(
            pivot[0] + rand(-width, width),
            pivot[1] + rand(-length, length),
            pivot[2]
        );

        quat.identity(particleRotationQuat);
        quat.rotateZ(particleRotationQuat, particleRotationQuat, Math.PI / 2);
        quat.rotateY(particleRotationQuat, particleRotationQuat, rand(-latitude, latitude));

        if (!hasParticleFlag(emitter.props, ParticleEmitter2Flags.LineEmitter)) {
            quat.rotateX(particleRotationQuat, particleRotationQuat, rand(-latitude, latitude));
        }

        vec3.set(localDirection, 0, 0, 1);
        vec3.transformQuat(localDirection, localDirection, particleRotationQuat);
        vec3.scale(localDirection, localDirection, speed);

        if (isModelSpace) {
            vec3.copy(particle.pos, localPos);
            vec3.copy(particle.speed, localDirection);
            mat3.identity(particle.orientation);
        } else {
            vec3.transformMat4(particle.pos, localPos, emitterMatrix);

            mat4.getRotation(emitterRotationQuat, emitterMatrix);
            mat4.getScaling(emitterScaleVec, emitterMatrix);

            vec3.transformQuat(particle.speed, localDirection, emitterRotationQuat);
            vec3.multiply(particle.speed, particle.speed, emitterScaleVec);
            mat3.fromQuat(particle.orientation, emitterRotationQuat);
        }

        mat4.getScaling(emitterScaleVec, emitterMatrix);
        particle.gravity = this.interp.animVectorVal(emitter.props.Gravity, 0) * (emitterScaleVec[2] || 1);

        if (hasParticleFlag(emitter.props, ParticleEmitter2Flags.XYQuad)) {
            particle.angle = Math.atan2(particle.speed[1], particle.speed[0]) - Math.PI + Math.PI / 8;
        }

        particle.lifeSpan = (typeof emitter.props.LifeSpan === 'number' && emitter.props.LifeSpan > 0)
            ? emitter.props.LifeSpan : 1;

        return particle;
    }
    private updateParticleBuffers(particle: Particle, index: number, emitter: ParticleEmitterWrapper): void {
        // Defensive: Ensure LifeSpan and Time are valid non-zero numbers
        const lifeSpan = (typeof emitter.props.LifeSpan === 'number' && emitter.props.LifeSpan > 0)
            ? emitter.props.LifeSpan : 1;
        const time = (typeof emitter.props.Time === 'number' && emitter.props.Time > 0 && emitter.props.Time < 1)
            ? emitter.props.Time : 0.5;

        const globalT: number = 1 - particle.lifeSpan / lifeSpan;
        const firstHalf: boolean = globalT < time;
        let t: number;

        if (firstHalf) {
            t = globalT / time;
        } else {
            t = (globalT - time) / (1 - time);
        }

        this.updateParticleVertices(particle, index, emitter, firstHalf, t);
        this.updateParticleTexCoords(index, emitter, firstHalf, t);
        this.updateParticleColor(index, emitter, firstHalf, t);
    }

    private updateParticleVertices(particle: Particle, index: number, emitter: ParticleEmitterWrapper,
        firstHalf: boolean, t: number) {
        let firstScale;
        let secondScale;
        let scale;

        const scaling = emitter.props.ParticleScaling;
        const hasValidScaling = scaling && (Array.isArray(scaling) || scaling instanceof Float32Array) && scaling.length >= 3;
        const defaultScale = 10;

        if (firstHalf) {
            firstScale = hasValidScaling ? (scaling[0] ?? defaultScale) : defaultScale;
            secondScale = hasValidScaling ? (scaling[1] ?? defaultScale) : defaultScale;
        } else {
            firstScale = hasValidScaling ? (scaling[1] ?? defaultScale) : defaultScale;
            secondScale = hasValidScaling ? (scaling[2] ?? defaultScale) : defaultScale;
        }

        if (typeof firstScale !== 'number' || isNaN(firstScale)) firstScale = defaultScale;
        if (typeof secondScale !== 'number' || isNaN(secondScale)) secondScale = defaultScale;
        if (Math.abs(firstScale) < 0.01) firstScale = defaultScale;
        if (Math.abs(secondScale) < 0.01) secondScale = defaultScale;

        scale = lerp(firstScale, secondScale, t);

        const isModelSpace = hasParticleFlag(emitter.props, ParticleEmitter2Flags.ModelSpace);

        if (isModelSpace) {
            const currentEmitterMatrix = getEmitterMatrix(this.rendererData, emitter.props.ObjectId);
            vec3.transformMat4(particleWorldPos, particle.pos, currentEmitterMatrix);
            mat4.getRotation(emitterRotationQuat, currentEmitterMatrix);
            mat4.getScaling(emitterScaleVec, currentEmitterMatrix);
            vec3.transformQuat(particleWorldSpeed, particle.speed, emitterRotationQuat);
            vec3.multiply(particleWorldSpeed, particleWorldSpeed, emitterScaleVec);
        } else {
            vec3.copy(particleWorldPos, particle.pos);
            vec3.copy(particleWorldSpeed, particle.speed);
        }

        if (emitter.type & ParticleEmitter2FramesFlags.Head) {
            const isXYQuad = hasParticleFlag(emitter.props, ParticleEmitter2Flags.XYQuad);
            const cosA = Math.cos(particle.angle);
            const sinA = Math.sin(particle.angle);

            for (let i = 0; i < 4; ++i) {
                const baseX = this.particleBaseVectors[i][0] * scale;
                const baseY = this.particleBaseVectors[i][1] * scale;
                const baseZ = this.particleBaseVectors[i][2] * scale;
                if (isXYQuad) {
                    vec3.set(particleHeadVec, baseX * cosA - baseY * sinA, baseX * sinA + baseY * cosA, 0);

                    if (isModelSpace) {
                        const currentEmitterMatrix = getEmitterMatrix(this.rendererData, emitter.props.ObjectId);
                        mat4.getRotation(emitterRotationQuat, currentEmitterMatrix);
                        vec3.transformQuat(particlePlaneNormal, worldUnitZ, emitterRotationQuat);
                    } else {
                        vec3.transformMat3(particlePlaneNormal, worldUnitZ, particle.orientation);
                    }

                    vec3.normalize(particlePlaneNormal, particlePlaneNormal);
                    quat.rotationTo(planeTiltQuat, worldUnitZ, particlePlaneNormal);
                    mat3.fromQuat(emitterOrientationMat3, planeTiltQuat);
                    vec3.transformMat3(particleHeadVec, particleHeadVec, emitterOrientationMat3);

                    emitter.headVertices[index * 12 + i * 3] = particleHeadVec[0];
                    emitter.headVertices[index * 12 + i * 3 + 1] = particleHeadVec[1];
                    emitter.headVertices[index * 12 + i * 3 + 2] = particleHeadVec[2];
                } else {
                    emitter.headVertices[index * 12 + i * 3] = baseX;
                    emitter.headVertices[index * 12 + i * 3 + 1] = baseY;
                    emitter.headVertices[index * 12 + i * 3 + 2] = baseZ;
                }
            }
        }

        if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
            tailPos[0] = -particleWorldSpeed[0] * emitter.props.TailLength;
            tailPos[1] = -particleWorldSpeed[1] * emitter.props.TailLength;
            tailPos[2] = -particleWorldSpeed[2] * emitter.props.TailLength;

            vec3.set(cameraDirectionZ, 0, 0, 1);
            vec3.transformQuat(cameraDirectionZ, cameraDirectionZ, this.rendererData.cameraQuat);
            vec3.cross(tailCross, cameraDirectionZ, particleWorldSpeed);
            if (vec3.length(tailCross) < 0.0001) {
                vec3.set(tailCross, scale, 0, 0);
            } else {
                vec3.normalize(tailCross, tailCross);
                vec3.scale(tailCross, tailCross, scale);
            }

            // Match the reference tail vertex order:
            // 0 = p0 - boundary, 1 = p1 - boundary, 2 = p1 + boundary, 3 = p0 + boundary
            emitter.tailVertices[index * 12] = -tailCross[0];
            emitter.tailVertices[index * 12 + 1] = -tailCross[1];
            emitter.tailVertices[index * 12 + 2] = -tailCross[2];

            emitter.tailVertices[index * 12 + 3] = tailPos[0] - tailCross[0];
            emitter.tailVertices[index * 12 + 3 + 1] = tailPos[1] - tailCross[1];
            emitter.tailVertices[index * 12 + 3 + 2] = tailPos[2] - tailCross[2];

            emitter.tailVertices[index * 12 + 2 * 3] = tailPos[0] + tailCross[0];
            emitter.tailVertices[index * 12 + 2 * 3 + 1] = tailPos[1] + tailCross[1];
            emitter.tailVertices[index * 12 + 2 * 3 + 2] = tailPos[2] + tailCross[2];

            emitter.tailVertices[index * 12 + 3 * 3] = tailCross[0];
            emitter.tailVertices[index * 12 + 3 * 3 + 1] = tailCross[1];
            emitter.tailVertices[index * 12 + 3 * 3 + 2] = tailCross[2];
        }

        for (let i = 0; i < 4; ++i) {
            if (emitter.headVertices) {
                emitter.headVertices[index * 12 + i * 3] += particleWorldPos[0];
                emitter.headVertices[index * 12 + i * 3 + 1] += particleWorldPos[1];
                emitter.headVertices[index * 12 + i * 3 + 2] += particleWorldPos[2];
            }
            if (emitter.tailVertices) {
                emitter.tailVertices[index * 12 + i * 3] += particleWorldPos[0];
                emitter.tailVertices[index * 12 + i * 3 + 1] += particleWorldPos[1];
                emitter.tailVertices[index * 12 + i * 3 + 2] += particleWorldPos[2];
            }
        }
    }
    private updateParticleTexCoords(index: number, emitter: ParticleEmitterWrapper, firstHalf: boolean, t: number) {
        if (emitter.type & ParticleEmitter2FramesFlags.Head) {
            this.updateParticleTexCoordsByType(index, emitter, firstHalf, t, ParticleEmitter2FramesFlags.Head);
        }
        if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
            this.updateParticleTexCoordsByType(index, emitter, firstHalf, t, ParticleEmitter2FramesFlags.Tail);
        }
    }

    private updateParticleTexCoordsByType(index: number, emitter: ParticleEmitterWrapper, firstHalf: boolean,
        t: number, type: ParticleEmitter2FramesFlags) {
        let uvAnim;
        let texCoords;
        if (type === ParticleEmitter2FramesFlags.Tail) {
            uvAnim = firstHalf ? emitter.props.TailUVAnim : emitter.props.TailDecayUVAnim;
            texCoords = emitter.tailTexCoords;
        } else {
            uvAnim = firstHalf ? emitter.props.LifeSpanUVAnim : emitter.props.DecayUVAnim;
            texCoords = emitter.headTexCoords;
        }

        // Defensive: Ensure Rows and Columns are valid positive numbers
        const columns = (typeof emitter.props.Columns === 'number' && emitter.props.Columns > 0)
            ? emitter.props.Columns : 1;
        const rows = (typeof emitter.props.Rows === 'number' && emitter.props.Rows > 0)
            ? emitter.props.Rows : 1;
        const totalTextureFrames = rows * columns;

        // Parse UV anim array [start, end, repeat]
        // Defensive: Handle undefined, invalid arrays, and object-style arrays from store
        let start = 0, end = 0, repeat = 1;

        if (uvAnim) {
            if (Array.isArray(uvAnim) || uvAnim instanceof Float32Array || uvAnim instanceof Uint32Array) {
                if (uvAnim.length >= 1) start = uvAnim[0] ?? 0;
                if (uvAnim.length >= 2) end = uvAnim[1] ?? 0;
                if (uvAnim.length >= 3) repeat = uvAnim[2] ?? 1;
            } else if (typeof uvAnim === 'object' && '0' in uvAnim) {
                // Handle object-style array from store (due to spread operations)
                start = uvAnim['0'] ?? 0;
                end = uvAnim['1'] ?? 0;
                repeat = uvAnim['2'] ?? 1;
            }
        }

        // Ensure repeat is at least 1
        if (repeat < 1) repeat = 1;

        // Support both classic 0-based intervals and common 1-based atlas numbering.
        // Many particle atlases are authored as 1..N in tools (e.g. 4x4 => 1..16).
        let startFrame = start;
        let endFrame = end;

        if (start > 0 && end > 0) {
            startFrame = start - 1;
            endFrame = end - 1;
        }

        let frame = startFrame;
        const spriteCount = endFrame - startFrame + 1;

        if (spriteCount > 1) {
            const animPosition = Math.floor(spriteCount * repeat * t);
            frame = startFrame + (animPosition % spriteCount);
        }

        // CRITICAL: Clamp frame to valid texture range to prevent UV overflow
        // This prevents sampling outside texture bounds when frame indices exceed rows*columns
        if (frame >= totalTextureFrames) {
            frame = frame % totalTextureFrames;
        }
        if (frame < 0) {
            frame = 0;
        }

        const texCoordX = frame % columns;
        const texCoordY = Math.floor(frame / columns);
        const cellWidth = 1 / columns;
        const cellHeight = 1 / rows;

        // Inset atlas UVs slightly to avoid linear-filter bleeding from adjacent cells.
        const insetX = cellWidth * 0.001;
        const insetY = cellHeight * 0.001;
        const left = texCoordX * cellWidth + insetX;
        const right = (texCoordX + 1) * cellWidth - insetX;
        const top = texCoordY * cellHeight + insetY;
        const bottom = (texCoordY + 1) * cellHeight - insetY;

        texCoords[index * 8] = right;
        texCoords[index * 8 + 1] = top;

        texCoords[index * 8 + 2] = left;
        texCoords[index * 8 + 3] = top;

        texCoords[index * 8 + 4] = left;
        texCoords[index * 8 + 5] = bottom;

        texCoords[index * 8 + 6] = right;
        texCoords[index * 8 + 7] = bottom;
    }

    private updateParticleColor(index: number, emitter: ParticleEmitterWrapper, firstHalf: boolean, t: number) {
        // Defensive: Ensure SegmentColor and Alpha are valid with default fallbacks
        const segColor = emitter.props.SegmentColor;
        const alpha = emitter.props.Alpha;

        // Default white color and full opacity
        const defaultColor = [1, 1, 1];
        const defaultAlpha = 255;

        // SegmentColor：MDX 解析后为 RGB 顺序，与着色器顶点色一致，不做 R/B 交换（此前交换会导致红蓝对调）

        // Get safe color values
        const getColor = (idx: number): number[] => {
            if (segColor && Array.isArray(segColor) && segColor[idx]) {
                const c = segColor[idx];
                if (Array.isArray(c) || c instanceof Float32Array) {
                    return [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1];
                }
            }
            return defaultColor;
        };

        // Get safe alpha value
        const getAlpha = (idx: number): number => {
            if (alpha && (Array.isArray(alpha) || alpha instanceof Uint8Array) && alpha.length > idx) {
                const a = alpha[idx];
                return (typeof a === 'number' && !isNaN(a)) ? a : defaultAlpha;
            }
            return defaultAlpha;
        };

        if (firstHalf) {
            const c0 = getColor(0);
            const c1 = getColor(1);
            firstColor[0] = c0[0];
            firstColor[1] = c0[1];
            firstColor[2] = c0[2];
            firstColor[3] = getAlpha(0) / 255;

            secondColor[0] = c1[0];
            secondColor[1] = c1[1];
            secondColor[2] = c1[2];
            secondColor[3] = getAlpha(1) / 255;
        } else {
            const c1 = getColor(1);
            const c2 = getColor(2);
            firstColor[0] = c1[0];
            firstColor[1] = c1[1];
            firstColor[2] = c1[2];
            firstColor[3] = getAlpha(1) / 255;

            secondColor[0] = c2[0];
            secondColor[1] = c2[1];
            secondColor[2] = c2[2];
            secondColor[3] = getAlpha(2) / 255;
        }

        vec4.lerp(color, firstColor, secondColor, t);

        for (let i = 0; i < 4; ++i) {
            emitter.colors[index * 16 + i * 4] = color[0];
            emitter.colors[index * 16 + i * 4 + 1] = color[1];
            emitter.colors[index * 16 + i * 4 + 2] = color[2];
            emitter.colors[index * 16 + i * 4 + 3] = color[3];
        }
    }

    private setLayerProps(emitter: ParticleEmitterWrapper): void {
        if (emitter.props.FilterMode === ParticleEmitter2FilterMode.AlphaKey) {
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DISCARD_ALPHA_KEY_LEVEL);
        } else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate ||
            emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate2x) {
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DISCARD_MODULATE_LEVEL);
        } else {
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.);
        }

        if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(false);
        } else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Additive) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.AlphaKey) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFuncSeparate(this.gl.ZERO, this.gl.SRC_COLOR, this.gl.ZERO, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (emitter.props.FilterMode === ParticleEmitter2FilterMode.Modulate2x) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.blendFuncSeparate(this.gl.DST_COLOR, this.gl.SRC_COLOR, this.gl.ZERO, this.gl.ONE);
            this.gl.depthMask(false);
        }

        const texture = this.rendererData.model.Textures[emitter.props.TextureID];
        if (texture) {
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
        }
    }

    private setGeneralBuffers(emitter: ParticleEmitterWrapper): void {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.colorBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.colors, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.colorAttribute, 4, this.gl.FLOAT, false, 0, 0);

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, emitter.indexBuffer);
        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, emitter.indices, this.gl.DYNAMIC_DRAW);
    }

    private renderEmitterType(emitter: ParticleEmitterWrapper, type: ParticleEmitter2FramesFlags): void {
        if (type === ParticleEmitter2FramesFlags.Tail) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.tailTexCoordBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.tailTexCoords, this.gl.DYNAMIC_DRAW);
        } else {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.headTexCoordBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.headTexCoords, this.gl.DYNAMIC_DRAW);
        }
        this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

        if (type === ParticleEmitter2FramesFlags.Tail) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.tailVertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.tailVertices, this.gl.DYNAMIC_DRAW);
        } else {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.headVertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.headVertices, this.gl.DYNAMIC_DRAW);
        }
        this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);

        this.gl.drawElements(this.gl.TRIANGLES, emitter.particles.length * 6, this.gl.UNSIGNED_SHORT, 0);
    }
}













