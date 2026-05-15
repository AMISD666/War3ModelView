import {
    ParticleEmitter2, ParticleEmitter2FilterMode, ParticleEmitter2Flags,
    ParticleEmitter2FramesFlags
} from '../model';
import { mat4, vec3, vec4, mat3 } from 'gl-matrix';
import { ModelInterp } from './modelInterp';
import { degToRad, rand, getShader } from './util';
import { RendererData } from './rendererData';
import { lerp } from './interp';
import { applyWar3ParticleBlendState, getParticleDiscardAlphaLevel } from './War3BlendState';
import vertexShader from './shaders/webgl/particles.vs.glsl?raw';
import fragmentShader from './shaders/webgl/particles.fs.glsl?raw';
import particlesShader from './shaders/webgpu/particles.wgsl?raw';

const rotateCenter: vec3 = vec3.fromValues(0, 0, 0);
const firstColor = vec4.create();
const secondColor = vec4.create();
const color = vec4.create();
const tailPos = vec3.create();
const tailCross = vec3.create();
const tailWorldSpeed = vec3.create();
const tailViewDir = vec3.create();
const tailWorldPos = vec3.create();
const tailFallbackAxis = vec3.create();
const emitterRotationMat3 = mat3.create();
const particleFacing2D = vec3.create();
const xyQuadLocalOffset = vec3.create();

export type ParticleQualityMode = 'full' | 'game';

const GAME_PARTICLE_EMISSION_SCALE = 0.22;
const PHASE_TIME_EPSILON = 0.0001;

function getParticleEmitter2LifeSpan(props: ParticleEmitter2): number {
    return typeof props.LifeSpan === 'number' && Number.isFinite(props.LifeSpan) && props.LifeSpan > 0
        ? props.LifeSpan
        : 1;
}

function getParticleEmitter2PhaseTime(props: ParticleEmitter2): number {
    if (typeof props.Time !== 'number' || !Number.isFinite(props.Time)) {
        return 0.5;
    }
    if (props.Time <= 0) {
        return PHASE_TIME_EPSILON;
    }
    if (props.Time >= 1) {
        return 1 - PHASE_TIME_EPSILON;
    }
    return props.Time;
}

function getParticleQualityEmissionScale(mode: ParticleQualityMode): number {
    return mode === 'game' ? GAME_PARTICLE_EMISSION_SCALE : 1;
}

function isValidAttribLocation(location: number | null): location is number {
    return typeof location === 'number' && location >= 0;
}

function setXYQuadAxesFromVelocity(velocity: vec3, outRight: vec3, outUp: vec3): boolean {
    vec3.set(particleFacing2D, velocity[0], velocity[1], 0);
    if (vec3.squaredLength(particleFacing2D) <= 0.000001) {
        return false;
    }

    vec3.normalize(outUp, particleFacing2D);
    vec3.scale(outUp, outUp, -1);
    vec3.set(outRight, -outUp[1], outUp[0], 0);
    return true;
}

export interface ParticleEmitter2RenderItem {
    emitterIndex: number;
    priorityPlane: number;
    filterMode: ParticleEmitter2FilterMode;
    dist2: number;
}

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

function getParticleEmitter2FrameFlags(props: ParticleEmitter2): ParticleEmitter2FramesFlags {
    return props.FrameFlags == null
        ? ParticleEmitter2FramesFlags.Head
        : props.FrameFlags & (ParticleEmitter2FramesFlags.Head | ParticleEmitter2FramesFlags.Tail);
}

interface Particle {
    emitter: ParticleEmitterWrapper;
    // xyz
    pos: vec3;
    // xyz
    speed: vec3;
    quadRight: vec3;
    quadUp: vec3;
    angle: number;
    gravity: number;
    lifeSpan: number;
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

const DISCARD_ALPHA_KEY_LEVEL = 0.83;
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
    private particleQualityMode: ParticleQualityMode;

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
        this.particleQualityMode = 'full';

        if (rendererData.model.ParticleEmitters2.length) {
            this.particleBaseVectors = [
                vec3.create(),
                vec3.create(),
                vec3.create(),
                vec3.create()
            ];

            for (let i = 0; i < rendererData.model.ParticleEmitters2.length; ++i) {
                const particleEmitter = rendererData.model.ParticleEmitters2[i];
                const frameFlags = getParticleEmitter2FrameFlags(particleEmitter);
                const lifeSpan = getParticleEmitter2LifeSpan(particleEmitter);

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
                    ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) * lifeSpan * this.getEmissionScale()
                );

                // Mark for initial sync to ensure props are properly applied
                emitter._needsInitialSync = true;

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
        if (!model.ParticleEmitters2) return;

        // Initialize base vectors if this is the first time we have emitters
        if (model.ParticleEmitters2.length && !this.particleBaseVectors) {
            this.particleBaseVectors = [
                vec3.create(),
                vec3.create(),
                vec3.create(),
                vec3.create()
            ];
        }

        // Handle deleted emitters - remove emitters that no longer exist in the model
        if (this.emitters.length > model.ParticleEmitters2.length) {
            console.log(`[ParticlesController] syncEmitters: Removing ${this.emitters.length - model.ParticleEmitters2.length} deleted emitters`);

            // Destroy GPU buffers for emitters being removed
            for (let i = model.ParticleEmitters2.length; i < this.emitters.length; ++i) {
                const emitter = this.emitters[i];

                // Destroy GPU buffers
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

                // Return particles to storage pool
                for (const particle of emitter.particles) {
                    this.particleStorage.push(particle);
                }
            }

            // Trim the emitters array
            this.emitters.length = model.ParticleEmitters2.length;
        }

        // Update existing emitter props references to reflect parameter changes
        // CRITICAL FIX: Always update props reference, not just when reference changes
        // The store may mutate the same object, so reference comparison fails
        for (let i = 0; i < this.emitters.length && i < model.ParticleEmitters2.length; ++i) {
            const newProps = model.ParticleEmitters2[i];
            const oldProps = this.emitters[i].props;

            // Always update props reference to ensure latest data is used
            this.emitters[i].props = newProps;

            // Check if key properties changed OR if this is the first sync after creation
            const needsInitialSync = this.emitters[i]._needsInitialSync === true;
            const propsChanged = needsInitialSync ||
                oldProps !== newProps ||
                oldProps.LifeSpan !== newProps.LifeSpan ||
                oldProps.FrameFlags !== newProps.FrameFlags ||
                oldProps.EmissionRate !== newProps.EmissionRate;

            if (propsChanged) {
                // Also update type in case FrameFlags changed
                this.emitters[i].type = getParticleEmitter2FrameFlags(newProps);
                // Recalculate base capacity
                const emissionRate = newProps.EmissionRate;
                const lifeSpan = getParticleEmitter2LifeSpan(newProps);
                this.emitters[i].baseCapacity = Math.ceil(
                    ModelInterp.maxAnimVectorVal(emissionRate) * lifeSpan * this.getEmissionScale()
                );
                // CRITICAL FIX: Clear existing particles when key props change
                // Existing particles were created with old LifeSpan values
                // They need to be replaced with new particles using updated props
                for (const particle of this.emitters[i].particles) {
                    this.particleStorage.push(particle);
                }
                this.emitters[i].particles = [];
                // Reset debug flags to re-log after props change
                this.emitters[i]._xyQuadLogged = false;
                this.emitters[i]._velocityLogged = false;
                this.emitters[i]._needsInitialSync = false; // Clear initial sync flag
            }
        }

        // Check for new emitters that aren't yet tracked
        for (let i = this.emitters.length; i < model.ParticleEmitters2.length; ++i) {
            const particleEmitter = model.ParticleEmitters2[i];

            const frameFlags = getParticleEmitter2FrameFlags(particleEmitter);

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

            // Calculate base capacity for buffer sizing
            const emissionRate = particleEmitter.EmissionRate;
            const lifeSpan = getParticleEmitter2LifeSpan(particleEmitter);
            emitter.baseCapacity = Math.ceil(
                ModelInterp.maxAnimVectorVal(emissionRate) * lifeSpan * this.getEmissionScale()
            );

            console.log(`[ParticlesController] syncEmitters: Added new emitter ${i}, FrameFlags=${frameFlags}, baseCapacity=${emitter.baseCapacity}`);
            this.emitters.push(emitter);
        }
    }

    private getEmissionScale(): number {
        return getParticleQualityEmissionScale(this.particleQualityMode);
    }

    public setParticleQualityMode(mode: ParticleQualityMode): void {
        if (mode === this.particleQualityMode) {
            return;
        }

        const previousScale = this.getEmissionScale();
        this.particleQualityMode = mode;
        const nextScale = this.getEmissionScale();

        for (const emitter of this.emitters) {
            const lifeSpan = getParticleEmitter2LifeSpan(emitter.props);
            emitter.baseCapacity = Math.ceil(
                ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) * lifeSpan * nextScale
            );
            if (nextScale < previousScale) {
                this.thinEmitterParticles(emitter, nextScale / previousScale);
            }
        }
    }

    private thinEmitterParticles(emitter: ParticleEmitterWrapper, keepRatio: number): void {
        if (keepRatio >= 1 || emitter.particles.length <= 1) {
            return;
        }

        const clampedRatio = Math.max(0, Math.min(1, keepRatio));
        const targetCount = Math.max(1, Math.floor(emitter.particles.length * clampedRatio));
        if (targetCount >= emitter.particles.length) {
            return;
        }

        const keptParticles: Particle[] = [];
        for (let i = 0; i < emitter.particles.length; ++i) {
            if (keptParticles.length < targetCount && (i * targetCount) % emitter.particles.length < targetCount) {
                keptParticles.push(emitter.particles[i]);
            } else {
                this.particleStorage.push(emitter.particles[i]);
            }
        }
        emitter.particles = keptParticles;
        emitter.emission = Math.min(emitter.emission, 999);
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
            this.ensureEmitterRenderBuffers(emitter);
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
            indices[i * 6 + 3] = i * 4 + 2;
            indices[i * 6 + 4] = i * 4 + 1;
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

        this.ensureEmitterRenderBuffers(emitter);
    }

    private ensureEmitterRenderBuffers(emitter: ParticleEmitterWrapper): void {
        if (this.gl) {
            if ((emitter.type & ParticleEmitter2FramesFlags.Tail) && (!emitter.tailVertexBuffer || !emitter.tailTexCoordBuffer)) {
                emitter.tailVertexBuffer = this.gl.createBuffer();
                emitter.tailTexCoordBuffer = this.gl.createBuffer();
            }
            if ((emitter.type & ParticleEmitter2FramesFlags.Head) && (!emitter.headVertexBuffer || !emitter.headTexCoordBuffer)) {
                emitter.headVertexBuffer = this.gl.createBuffer();
                emitter.headTexCoordBuffer = this.gl.createBuffer();
            }
            if (!emitter.colorBuffer) {
                emitter.colorBuffer = this.gl.createBuffer();
            }
            if (!emitter.indexBuffer) {
                emitter.indexBuffer = this.gl.createBuffer();
            }
        } else if (this.device) {
            if ((emitter.type & ParticleEmitter2FramesFlags.Tail) && emitter.tailVertices && emitter.tailTexCoords &&
                (!emitter.tailVertexGPUBuffer || !emitter.tailTexCoordGPUBuffer)) {
                emitter.tailVertexGPUBuffer?.destroy();
                emitter.tailVertexGPUBuffer = this.device.createBuffer({
                    label: `particles tail vertex buffer ${emitter.index}`,
                    size: emitter.tailVertices.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
                emitter.tailTexCoordGPUBuffer?.destroy();
                emitter.tailTexCoordGPUBuffer = this.device.createBuffer({
                    label: `particles tail texCoords buffer ${emitter.index}`,
                    size: emitter.tailTexCoords.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
            }
            if ((emitter.type & ParticleEmitter2FramesFlags.Head) && emitter.headVertices && emitter.headTexCoords &&
                (!emitter.headVertexGPUBuffer || !emitter.headTexCoordGPUBuffer)) {
                emitter.headVertexGPUBuffer?.destroy();
                emitter.headVertexGPUBuffer = this.device.createBuffer({
                    label: `particles head vertex buffer ${emitter.index}`,
                    size: emitter.headVertices.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
                this.device.queue.writeBuffer(emitter.headVertexGPUBuffer, 0, emitter.headVertices as any);
                emitter.headTexCoordGPUBuffer?.destroy();
                emitter.headTexCoordGPUBuffer = this.device.createBuffer({
                    label: `particles head texCoords buffer ${emitter.index}`,
                    size: emitter.headTexCoords.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
                this.device.queue.writeBuffer(emitter.headTexCoordGPUBuffer, 0, emitter.headTexCoords as any);
            }
            if (!emitter.colorGPUBuffer && emitter.colors) {
                emitter.colorGPUBuffer = this.device.createBuffer({
                    label: `particles color buffer ${emitter.index}`,
                    size: emitter.colors.byteLength,
                    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
                });
                this.device.queue.writeBuffer(emitter.colorGPUBuffer, 0, emitter.colors as any);
            }
            if (!emitter.indexGPUBuffer && emitter.indices) {
                emitter.indexGPUBuffer = this.device.createBuffer({
                    label: `particles index buffer ${emitter.index}`,
                    size: emitter.indices.byteLength,
                    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
                });
                this.device.queue.writeBuffer(emitter.indexGPUBuffer, 0, emitter.indices as any);
            }
        }
    }

    private hasEmitterGLRenderBuffers(emitter: ParticleEmitterWrapper): boolean {
        const hasTailBuffers = !(emitter.type & ParticleEmitter2FramesFlags.Tail) ||
            (!!emitter.tailVertices && !!emitter.tailTexCoords && !!emitter.tailVertexBuffer && !!emitter.tailTexCoordBuffer);
        const hasHeadBuffers = !(emitter.type & ParticleEmitter2FramesFlags.Head) ||
            (!!emitter.headVertices && !!emitter.headTexCoords && !!emitter.headVertexBuffer && !!emitter.headTexCoordBuffer);

        return hasTailBuffers && hasHeadBuffers && !!emitter.colors && !!emitter.indices && !!emitter.colorBuffer && !!emitter.indexBuffer;
    }

    private hasEmitterGPURenderBuffers(emitter: ParticleEmitterWrapper): boolean {
        const hasTailBuffers = !(emitter.type & ParticleEmitter2FramesFlags.Tail) ||
            (!!emitter.tailVertices && !!emitter.tailTexCoords && !!emitter.tailVertexGPUBuffer && !!emitter.tailTexCoordGPUBuffer);
        const hasHeadBuffers = !(emitter.type & ParticleEmitter2FramesFlags.Head) ||
            (!!emitter.headVertices && !!emitter.headTexCoords && !!emitter.headVertexGPUBuffer && !!emitter.headTexCoordGPUBuffer);

        return hasTailBuffers && hasHeadBuffers && !!emitter.colors && !!emitter.indices && !!emitter.colorGPUBuffer && !!emitter.indexGPUBuffer;
    }

    private disableAllVertexAttribArrays(): void {
        const maxAttribs = this.gl.getParameter(this.gl.MAX_VERTEX_ATTRIBS) as number;
        for (let i = 0; i < maxAttribs; ++i) {
            this.gl.disableVertexAttribArray(i);
        }
    }

    private enableParticleVertexAttribArrays(): boolean {
        const position = this.shaderProgramLocations.vertexPositionAttribute;
        const texCoord = this.shaderProgramLocations.textureCoordAttribute;
        const color = this.shaderProgramLocations.colorAttribute;

        if (!isValidAttribLocation(position) || !isValidAttribLocation(texCoord) || !isValidAttribLocation(color)) {
            return false;
        }

        this.disableAllVertexAttribArrays();
        this.gl.enableVertexAttribArray(position);
        this.gl.enableVertexAttribArray(texCoord);
        this.gl.enableVertexAttribArray(color);
        return true;
    }

    private disableParticleVertexAttribArrays(): void {
        const position = this.shaderProgramLocations.vertexPositionAttribute;
        const texCoord = this.shaderProgramLocations.textureCoordAttribute;
        const color = this.shaderProgramLocations.colorAttribute;

        if (isValidAttribLocation(position)) {
            this.gl.disableVertexAttribArray(position);
        }
        if (isValidAttribLocation(texCoord)) {
            this.gl.disableVertexAttribArray(texCoord);
        }
        if (isValidAttribLocation(color)) {
            this.gl.disableVertexAttribArray(color);
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
        this.gl.useProgram(this.shaderProgram);

        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);

        if (!this.enableParticleVertexAttribArrays()) {
            return;
        }

        for (const emitter of this.emitters) {
            if (!emitter.particles.length) {
                continue;
            }
            this.ensureEmitterRenderBuffers(emitter);
            if (!this.hasEmitterGLRenderBuffers(emitter)) {
                continue;
            }

            this.renderEmitter(emitter);
        }

        this.disableParticleVertexAttribArrays();
    }

    public getRenderItems(cameraPos: vec3 | null): ParticleEmitter2RenderItem[] {
        const items: ParticleEmitter2RenderItem[] = [];

        for (const emitter of this.emitters) {
            if (!emitter.particles.length) {
                continue;
            }

            let dist2 = 0;
            if (cameraPos) {
                const center = vec3.create();
                const isModelSpace = hasParticleFlag(emitter.props, ParticleEmitter2Flags.ModelSpace);
                const emitterMatrix = this.rendererData.nodes[emitter.props.ObjectId]?.matrix;

                for (const particle of emitter.particles) {
                    if (isModelSpace && emitterMatrix) {
                        vec3.transformMat4(tailWorldPos, particle.pos, emitterMatrix);
                        vec3.add(center, center, tailWorldPos);
                    } else {
                        vec3.add(center, center, particle.pos);
                    }
                }

                vec3.scale(center, center, 1 / emitter.particles.length);
                const dx = center[0] - cameraPos[0];
                const dy = center[1] - cameraPos[1];
                const dz = center[2] - cameraPos[2];
                dist2 = dx * dx + dy * dy + dz * dz;
            }

            items.push({
                emitterIndex: emitter.index,
                priorityPlane: emitter.props.PriorityPlane || 0,
                filterMode: emitter.props.FilterMode || ParticleEmitter2FilterMode.Blend,
                dist2
            });
        }

        return items;
    }

    public renderEmitterByIndex(emitterIndex: number, mvMatrix: mat4, pMatrix: mat4): void {
        const emitter = this.emitters.find((item) => item.index === emitterIndex);
        if (!emitter || !emitter.particles.length) {
            return;
        }
        this.ensureEmitterRenderBuffers(emitter);
        if (!this.hasEmitterGLRenderBuffers(emitter)) {
            return;
        }

        this.gl.useProgram(this.shaderProgram);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);
        if (!this.enableParticleVertexAttribArrays()) {
            return;
        }
        this.renderEmitter(emitter);
        this.disableParticleVertexAttribArrays();
    }

    private renderEmitter(emitter: ParticleEmitterWrapper): void {
        this.setLayerProps(emitter);
        this.setGeneralBuffers(emitter);

        if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
            this.renderEmitterType(emitter, ParticleEmitter2FramesFlags.Tail);
        }
        if (emitter.type & ParticleEmitter2FramesFlags.Head) {
            this.renderEmitterType(emitter, ParticleEmitter2FramesFlags.Head);
        }
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
            this.ensureEmitterRenderBuffers(emitter);
            if (!this.hasEmitterGPURenderBuffers(emitter)) {
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
        const visibility = this.interp.animVectorVal(emitter.props.Visibility, 1);

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

                emitter.emission += emissionRate * this.getEmissionScale() * delta;
            }

            while (emitter.emission >= 1000) {
                emitter.emission -= 1000;
                emitter.particles.push(
                    this.createParticle(emitter, this.rendererData.nodes[emitter.props.ObjectId].matrix)
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
                vec3.set(this.particleBaseVectors[0], 1, -1, 0);
                vec3.set(this.particleBaseVectors[1], 1, 1, 0);
                vec3.set(this.particleBaseVectors[2], -1, -1, 0);
                vec3.set(this.particleBaseVectors[3], -1, 1, 0);

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
                quadRight: vec3.create(),
                quadUp: vec3.create(),
                gravity: null,
                lifeSpan: null
            };
        }

        // Use 0.5 scalling to treat input as Diameter (matching user expectation/other tools)
        const width: number = this.interp.animVectorVal(emitter.props.Width, 0) * 0.5;
        const length: number = this.interp.animVectorVal(emitter.props.Length, 0) * 0.5;

        let speedScale: number = this.interp.animVectorVal(emitter.props.Speed, 0);
        const variation: number = this.interp.animVectorVal(emitter.props.Variation, 0);
        const latitude: number = degToRad(this.interp.animVectorVal(emitter.props.Latitude, 0));
        const isModelSpace = hasParticleFlag(emitter.props, ParticleEmitter2Flags.ModelSpace);

        // Get emitter node's pivot point (emission origin)
        const emitterNode = this.rendererData.nodes[emitter.props.ObjectId];
        const pivot = emitterNode?.node?.PivotPoint || [0, 0, 0];

        particle.emitter = emitter;

        if (variation > 0) {
            speedScale *= 1 + rand(-variation, variation);
        }

        // Start with local position (relative to pivot) and velocity
        // Add pivot point offset
        // Emit on XY plane (perpendicular to Z-axis emission)
        const localPos = vec3.fromValues(
            pivot[0] + rand(-width, width),
            pivot[1] + rand(-length, length),
            pivot[2]
        );
        // Emit along local +Z axis (standard forward direction)
        const localSpeed = vec3.fromValues(0, 0, speedScale);

        particle.angle = rand(0, Math.PI * 2);
        // Rotate around X-axis for latitude spread (cone angle from emission direction)
        vec3.rotateX(localSpeed, localSpeed, rotateCenter, rand(0, latitude));
        // Rotate around Z-axis for random distribution
        vec3.rotateZ(localSpeed, localSpeed, rotateCenter, particle.angle);

        if (hasParticleFlag(emitter.props, ParticleEmitter2Flags.LineEmitter)) {
            localSpeed[1] = 0;
        }

        if (isModelSpace) {
            // ModelSpace: Keep in local space, transform at render time
            vec3.copy(particle.pos, localPos);
            vec3.copy(particle.speed, localSpeed);
        } else {
            // Non-ModelSpace: Transform position and velocity direction to world space
            // Position: transform local pos by emitter matrix
            vec3.transformMat4(particle.pos, localPos, emitterMatrix);

            // Velocity: Transform direction to world space using endpoint method
            // This correctly rotates the velocity vector by the matrix's rotation component
            const velocityEnd = vec3.create();
            vec3.add(velocityEnd, localPos, localSpeed);
            vec3.transformMat4(velocityEnd, velocityEnd, emitterMatrix);
            vec3.subtract(particle.speed, velocityEnd, particle.pos);
        }

        vec3.set(particle.quadRight, 1, 0, 0);
        vec3.set(particle.quadUp, 0, 1, 0);
        if (!isModelSpace && hasParticleFlag(emitter.props, ParticleEmitter2Flags.XYQuad)) {
            setXYQuadAxesFromVelocity(particle.speed, particle.quadRight, particle.quadUp);
        }

        particle.gravity = this.interp.animVectorVal(emitter.props.Gravity, 0);
        particle.lifeSpan = getParticleEmitter2LifeSpan(emitter.props);

        // Debug: Log particle velocity direction (only first particle of each emitter)
        // if (!emitter._velocityLogged) {
        //     console.log(`[Particles] Emitter "${emitter.props.Name}" particle velocity: [${particle.speed[0].toFixed(2)}, ${particle.speed[1].toFixed(2)}, ${particle.speed[2].toFixed(2)}], LifeSpan: ${emitter.props.LifeSpan} (type: ${typeof emitter.props.LifeSpan}), Time: ${emitter.props.Time}`);
        //     emitter._velocityLogged = true;
        // }

        return particle;
    }

    private updateParticleBuffers(particle: Particle, index: number, emitter: ParticleEmitterWrapper): void {
        const lifeSpan = getParticleEmitter2LifeSpan(emitter.props);
        const time = getParticleEmitter2PhaseTime(emitter.props);

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

        // Defensive: Ensure ParticleScaling is valid array-like with default fallback
        // This handles cases where ParticleScaling might be undefined or not properly initialized
        const scaling = emitter.props.ParticleScaling;
        const hasValidScaling = scaling && (Array.isArray(scaling) || scaling instanceof Float32Array) && scaling.length >= 3;
        const defaultScale = 10; // Fallback scale value

        if (firstHalf) {
            firstScale = hasValidScaling ? (scaling[0] ?? defaultScale) : defaultScale;
            secondScale = hasValidScaling ? (scaling[1] ?? defaultScale) : defaultScale;
        } else {
            firstScale = hasValidScaling ? (scaling[1] ?? defaultScale) : defaultScale;
            secondScale = hasValidScaling ? (scaling[2] ?? defaultScale) : defaultScale;
        }

        if (typeof firstScale !== 'number' || !Number.isFinite(firstScale)) firstScale = defaultScale;
        if (typeof secondScale !== 'number' || !Number.isFinite(secondScale)) secondScale = defaultScale;

        // eslint-disable-next-line prefer-const
        scale = lerp(firstScale, secondScale, t);

        if (emitter.type & ParticleEmitter2FramesFlags.Head) {
            for (let i = 0; i < 4; ++i) {
                emitter.headVertices[index * 12 + i * 3] = this.particleBaseVectors[i][0] * scale;
                emitter.headVertices[index * 12 + i * 3 + 1] = this.particleBaseVectors[i][1] * scale;
                emitter.headVertices[index * 12 + i * 3 + 2] = this.particleBaseVectors[i][2] * scale;

                if (hasParticleFlag(emitter.props, ParticleEmitter2Flags.XYQuad)) {
                    const x = this.particleBaseVectors[i][0] * scale;
                    const y = this.particleBaseVectors[i][1] * scale;
                    const isModelSpace = hasParticleFlag(emitter.props, ParticleEmitter2Flags.ModelSpace);

                    if (isModelSpace) {
                        const emitterMatrix = this.rendererData.nodes[emitter.props.ObjectId]?.matrix;
                        vec3.set(xyQuadLocalOffset, x, y, 0);
                        if (emitterMatrix) {
                            mat3.fromMat4(emitterRotationMat3, emitterMatrix);
                            vec3.transformMat3(xyQuadLocalOffset, xyQuadLocalOffset, emitterRotationMat3);
                        }
                        emitter.headVertices[index * 12 + i * 3] = xyQuadLocalOffset[0];
                        emitter.headVertices[index * 12 + i * 3 + 1] = xyQuadLocalOffset[1];
                        emitter.headVertices[index * 12 + i * 3 + 2] = xyQuadLocalOffset[2];
                    } else {
                        emitter.headVertices[index * 12 + i * 3] = particle.quadRight[0] * x + particle.quadUp[0] * y;
                        emitter.headVertices[index * 12 + i * 3 + 1] = particle.quadRight[1] * x + particle.quadUp[1] * y;
                        emitter.headVertices[index * 12 + i * 3 + 2] = 0;
                    }
                }
            }
        }
        if (emitter.type & ParticleEmitter2FramesFlags.Tail) {
            const isModelSpace = hasParticleFlag(emitter.props, ParticleEmitter2Flags.ModelSpace);
            const emitterMatrix = this.rendererData.nodes[emitter.props.ObjectId]?.matrix;
            if (isModelSpace && emitterMatrix) {
                mat3.fromMat4(emitterRotationMat3, emitterMatrix);
                vec3.transformMat3(tailWorldSpeed, particle.speed, emitterRotationMat3);
                vec3.transformMat4(tailWorldPos, particle.pos, emitterMatrix);
            } else {
                vec3.copy(tailWorldSpeed, particle.speed);
                vec3.copy(tailWorldPos, particle.pos);
            }

            tailPos[0] = -tailWorldSpeed[0] * emitter.props.TailLength;
            tailPos[1] = -tailWorldSpeed[1] * emitter.props.TailLength;
            tailPos[2] = -tailWorldSpeed[2] * emitter.props.TailLength;

            vec3.subtract(tailViewDir, this.rendererData.cameraPos, tailWorldPos);
            if (vec3.squaredLength(tailViewDir) < 1e-6) {
                vec3.set(tailViewDir, 0, 0, 1);
            } else {
                vec3.normalize(tailViewDir, tailViewDir);
            }

            vec3.cross(tailCross, tailWorldSpeed, tailViewDir);
            if (vec3.squaredLength(tailCross) < 1e-6) {
                vec3.set(tailFallbackAxis, 0, 0, 1);
                vec3.cross(tailCross, tailWorldSpeed, tailFallbackAxis);
            }
            if (vec3.squaredLength(tailCross) < 1e-6) {
                vec3.set(tailFallbackAxis, 0, 1, 0);
                vec3.cross(tailCross, tailWorldSpeed, tailFallbackAxis);
            }
            vec3.normalize(tailCross, tailCross);
            vec3.scale(tailCross, tailCross, scale);

            emitter.tailVertices[index * 12] = tailCross[0];
            emitter.tailVertices[index * 12 + 1] = tailCross[1];
            emitter.tailVertices[index * 12 + 2] = tailCross[2];

            emitter.tailVertices[index * 12 + 3] = -tailCross[0];
            emitter.tailVertices[index * 12 + 3 + 1] = -tailCross[1];
            emitter.tailVertices[index * 12 + 3 + 2] = -tailCross[2];

            emitter.tailVertices[index * 12 + 2 * 3] = tailCross[0] + tailPos[0];
            emitter.tailVertices[index * 12 + 2 * 3 + 1] = tailCross[1] + tailPos[1];
            emitter.tailVertices[index * 12 + 2 * 3 + 2] = tailCross[2] + tailPos[2];

            emitter.tailVertices[index * 12 + 3 * 3] = -tailCross[0] + tailPos[0];
            emitter.tailVertices[index * 12 + 3 * 3 + 1] = -tailCross[1] + tailPos[1];
            emitter.tailVertices[index * 12 + 3 * 3 + 2] = -tailCross[2] + tailPos[2];
        }

        // Get world position based on particle space mode
        const isModelSpace = hasParticleFlag(emitter.props, ParticleEmitter2Flags.ModelSpace);
        const worldPos = vec3.create();

        if (isModelSpace) {
            // ModelSpace: Transform local pos by current emitter matrix
            const emitterMatrix = this.rendererData.nodes[emitter.props.ObjectId].matrix;
            vec3.transformMat4(worldPos, particle.pos, emitterMatrix);
        } else {
            // Non-ModelSpace: pos is already in world space, use directly
            vec3.copy(worldPos, particle.pos);
        }

        for (let i = 0; i < 4; ++i) {
            if (emitter.headVertices) {
                emitter.headVertices[index * 12 + i * 3] += worldPos[0];
                emitter.headVertices[index * 12 + i * 3 + 1] += worldPos[1];
                emitter.headVertices[index * 12 + i * 3 + 2] += worldPos[2];
            }
            if (emitter.tailVertices) {
                emitter.tailVertices[index * 12 + i * 3] += worldPos[0];
                emitter.tailVertices[index * 12 + i * 3 + 1] += worldPos[1];
                emitter.tailVertices[index * 12 + i * 3 + 2] += worldPos[2];
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

        // Calculate UV animation frame
        // War3 UV animation: frames cycle from start to end, repeated 'repeat' times over the phase
        let frame: number;

        if (start === 0 && end === 0) {
            // No UV animation - use frame 0
            frame = 0;
        } else {
            // Calculate interval (number of frames in one cycle)
            const interval = end - start + 1;

            if (interval <= 0) {
                // Invalid interval (end < start), just use start frame
                frame = start;
            } else {
                // Total frames across all repeats
                const totalAnimFrames = interval * repeat;

                // Map t (0->1) to position in total animation frames
                // Use floor to ensure we get discrete frame indices
                const animPosition = Math.floor(t * totalAnimFrames);

                // Calculate actual frame index (cycling within the interval)
                frame = start + (animPosition % interval);
            }
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

        texCoords[index * 8] = texCoordX * cellWidth;
        texCoords[index * 8 + 1] = texCoordY * cellHeight;

        texCoords[index * 8 + 2] = texCoordX * cellWidth;
        texCoords[index * 8 + 3] = (1 + texCoordY) * cellHeight;

        texCoords[index * 8 + 4] = (1 + texCoordX) * cellWidth;
        texCoords[index * 8 + 5] = texCoordY * cellHeight;

        texCoords[index * 8 + 6] = (1 + texCoordX) * cellWidth;
        texCoords[index * 8 + 7] = (1 + texCoordY) * cellHeight;
    }

    private updateParticleColor(index: number, emitter: ParticleEmitterWrapper, firstHalf: boolean, t: number) {
        // Defensive: Ensure SegmentColor and Alpha are valid with default fallbacks
        const segColor = emitter.props.SegmentColor;
        const alpha = emitter.props.Alpha;

        // Default white color and full opacity
        const defaultColor = [1, 1, 1];
        const defaultAlpha = 255;

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
        const filterMode = emitter.props.FilterMode || ParticleEmitter2FilterMode.Blend;
        this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, getParticleDiscardAlphaLevel(filterMode));
        applyWar3ParticleBlendState(this.gl, filterMode);

        const texture = this.rendererData.model.Textures[emitter.props.TextureID];
        this.gl.activeTexture(this.gl.TEXTURE0);
        if (texture?.Image) {
            const gpuTex = this.rendererData.textures[texture.Image] || this.rendererData.fallbackTexture;
            this.gl.bindTexture(this.gl.TEXTURE_2D, gpuTex);
            this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
            this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, 0);
        } else if (texture && (texture.ReplaceableId === 1 || texture.ReplaceableId === 2)) {
            this.gl.uniform3fv(this.shaderProgramLocations.replaceableColorUniform, this.rendererData.teamColor);
            this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, texture.ReplaceableId);
        } else {
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.fallbackTexture);
            this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
            this.gl.uniform1f(this.shaderProgramLocations.replaceableTypeUniform, 0);
        }
    }

    private setGeneralBuffers(emitter: ParticleEmitterWrapper): void {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.colorBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.colors, this.gl.DYNAMIC_DRAW);
        if (isValidAttribLocation(this.shaderProgramLocations.colorAttribute)) {
            this.gl.vertexAttribPointer(this.shaderProgramLocations.colorAttribute, 4, this.gl.FLOAT, false, 0, 0);
        }

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
        if (isValidAttribLocation(this.shaderProgramLocations.textureCoordAttribute)) {
            this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);
        }

        if (type === ParticleEmitter2FramesFlags.Tail) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.tailVertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.tailVertices, this.gl.DYNAMIC_DRAW);
        } else {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.headVertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.headVertices, this.gl.DYNAMIC_DRAW);
        }
        if (isValidAttribLocation(this.shaderProgramLocations.vertexPositionAttribute)) {
            this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
        }

        this.gl.drawElements(this.gl.TRIANGLES, emitter.particles.length * 6, this.gl.UNSIGNED_SHORT, 0);
    }
}

