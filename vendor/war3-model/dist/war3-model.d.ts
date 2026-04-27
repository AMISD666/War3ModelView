import { DdsInfo } from 'dds-parser';
import { mat4, vec3, quat, mat3 } from 'gl-matrix';

interface ModelInfo {
    Name: string;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    BlendTime: number;
    NumGeosets?: number;
    NumGeosetAnims?: number;
    NumBones?: number;
    NumLights?: number;
    NumAttachments?: number;
    NumEvents?: number;
    NumParticleEmitters?: number;
    NumParticleEmitters2?: number;
    NumRibbonEmitters?: number;
}
interface Sequence {
    Name: string;
    Interval: Uint32Array;
    NonLooping: boolean;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    MoveSpeed: number;
    Rarity: number;
}
declare enum TextureFlags {
    WrapWidth = 1,
    WrapHeight = 2
}
interface Texture {
    Image: string;
    ReplaceableId?: number;
    Flags?: TextureFlags;
}
declare enum FilterMode {
    None = 0,
    Transparent = 1,
    Blend = 2,
    Additive = 3,
    AddAlpha = 4,
    Modulate = 5,
    Modulate2x = 6
}
declare enum LineType {
    DontInterp = 0,
    Linear = 1,
    Hermite = 2,
    Bezier = 3
}
interface AnimKeyframe {
    Frame: number;
    Vector: Float32Array | Int32Array;
    InTan?: Float32Array | Int32Array;
    OutTan?: Float32Array | Int32Array;
}
interface AnimVector {
    LineType: LineType;
    GlobalSeqId?: number;
    Keys: AnimKeyframe[];
}
declare enum LayerShading {
    Unshaded = 1,
    SphereEnvMap = 2,
    TwoSided = 16,
    Unfogged = 32,
    NoDepthTest = 64,
    NoDepthSet = 128
}
interface Layer {
    FilterMode?: FilterMode;
    Shading?: number;
    TextureID?: AnimVector | number;
    TVertexAnimId?: number;
    CoordId: number;
    Alpha?: AnimVector | number;
    EmissiveGain?: AnimVector | number;
    FresnelColor?: AnimVector | Float32Array;
    FresnelOpacity?: AnimVector | number;
    FresnelTeamColor?: AnimVector | number;
    ShaderTypeId?: number;
    NormalTextureID?: AnimVector | number;
    ORMTextureID?: AnimVector | number;
    EmissiveTextureID?: AnimVector | number;
    TeamColorTextureID?: AnimVector | number;
    ReflectionsTextureID?: AnimVector | number;
}
declare enum MaterialRenderMode {
    ConstantColor = 1,
    SortPrimsFarZ = 16,
    FullResolution = 32
}
interface Material {
    PriorityPlane?: number;
    RenderMode?: number;
    Layers: Layer[];
    Shader?: string;
}
interface GeosetAnimInfo {
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
}
interface Geoset {
    Vertices: Float32Array;
    Normals: Float32Array;
    TVertices: Float32Array[];
    VertexGroup: Uint8Array | Uint16Array;
    Faces: Uint16Array;
    Groups: number[][];
    TotalGroupsCount: number;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    Anims: GeosetAnimInfo[];
    MaterialID: number;
    SelectionGroup: number;
    Unselectable: boolean;
    LevelOfDetail?: number;
    Name?: string;
    Tangents?: Float32Array;
    SkinWeights?: Uint8Array;
}
declare enum GeosetAnimFlags {
    DropShadow = 1,
    Color = 2
}
interface GeosetAnim {
    GeosetId: number;
    Alpha: AnimVector | number;
    Color: AnimVector | Float32Array;
    Flags: number;
}
declare enum NodeFlags {
    DontInheritTranslation = 1,
    DontInheritRotation = 2,
    DontInheritScaling = 4,
    Billboarded = 8,
    BillboardedLockX = 16,
    BillboardedLockY = 32,
    BillboardedLockZ = 64,
    CameraAnchored = 128
}
declare enum NodeType {
    Helper = 0,
    Bone = 256,
    Light = 512,
    EventObject = 1024,
    Attachment = 2048,
    ParticleEmitter = 4096,
    CollisionShape = 8192,
    RibbonEmitter = 16384
}
interface Node {
    Name: string;
    ObjectId: number;
    Parent?: number | null;
    PivotPoint: Float32Array;
    Flags: number;
    Translation?: AnimVector;
    Rotation?: AnimVector;
    Scaling?: AnimVector;
}
interface Bone extends Node {
    GeosetId?: number;
    GeosetAnimId?: number;
}
declare type Helper = Node;
interface Attachment extends Node {
    Path?: string;
    AttachmentID?: number;
    Visibility?: AnimVector;
}
interface EventObject extends Node {
    EventTrack: Uint32Array;
}
declare enum CollisionShapeType {
    Box = 0,
    Sphere = 2
}
interface CollisionShape extends Node {
    Shape: CollisionShapeType;
    Vertices: Float32Array;
    BoundsRadius?: number;
}
declare enum ParticleEmitterFlags {
    EmitterUsesMDL = 32768,
    EmitterUsesTGA = 65536
}
interface ParticleEmitter extends Node {
    EmissionRate: AnimVector | number;
    Gravity: AnimVector | number;
    Longitude: AnimVector | number;
    Latitude: AnimVector | number;
    Path: string;
    LifeSpan: AnimVector | number;
    InitVelocity: AnimVector | number;
    Visibility: AnimVector;
}
declare enum ParticleEmitter2Flags {
    Unshaded = 32768,
    SortPrimsFarZ = 65536,
    LineEmitter = 131072,
    Unfogged = 262144,
    ModelSpace = 524288,
    XYQuad = 1048576
}
declare enum ParticleEmitter2FilterMode {
    Blend = 0,
    Additive = 1,
    Modulate = 2,
    Modulate2x = 3,
    AlphaKey = 4
}
declare enum ParticleEmitter2FramesFlags {
    Head = 1,
    Tail = 2
}
interface ParticleEmitter2 extends Node {
    Speed?: AnimVector | number;
    Variation?: AnimVector | number;
    Latitude?: AnimVector | number;
    Gravity?: AnimVector | number;
    Visibility?: AnimVector | number;
    Squirt?: boolean;
    LifeSpan?: number;
    EmissionRate?: AnimVector | number;
    Width?: AnimVector | number;
    Length?: AnimVector | number;
    FilterMode?: ParticleEmitter2FilterMode;
    Rows?: number;
    Columns?: number;
    FrameFlags: number;
    TailLength?: number;
    Time?: number;
    SegmentColor?: Float32Array[];
    Alpha?: Uint8Array;
    ParticleScaling?: Float32Array;
    LifeSpanUVAnim?: Uint32Array;
    DecayUVAnim?: Uint32Array;
    TailUVAnim?: Uint32Array;
    TailDecayUVAnim?: Uint32Array;
    TextureID?: number;
    ReplaceableId?: number;
    PriorityPlane?: number;
}
interface Camera {
    Name: string;
    Position: Float32Array;
    FieldOfView: number;
    NearClip: number;
    FarClip: number;
    TargetPosition: Float32Array;
    TargetTranslation?: AnimVector;
    Translation?: AnimVector;
    Rotation?: AnimVector;
}
declare enum LightType {
    Omnidirectional = 0,
    Directional = 1,
    Ambient = 2
}
interface Light extends Node {
    LightType: LightType;
    AttenuationStart?: AnimVector | number;
    AttenuationEnd?: AnimVector | number;
    Color?: AnimVector | Float32Array;
    Intensity?: AnimVector | number;
    AmbIntensity?: AnimVector | number;
    AmbColor?: AnimVector | Float32Array;
    Visibility?: AnimVector;
}
interface RibbonEmitter extends Node {
    HeightAbove?: AnimVector | number;
    HeightBelow?: AnimVector | number;
    Alpha?: AnimVector | number;
    Color?: Float32Array;
    LifeSpan?: number;
    TextureSlot?: AnimVector | number;
    EmissionRate?: number;
    Rows?: number;
    Columns?: number;
    MaterialID?: number;
    Gravity?: number;
    Visibility?: AnimVector;
}
interface TVertexAnim {
    Translation?: AnimVector;
    Rotation?: AnimVector;
    Scaling?: AnimVector;
}
interface FaceFX {
    Name: string;
    Path: string;
}
interface BindPose {
    Matrices: Float32Array[];
}
declare enum ParticleEmitterPopcornFlags {
    Unshaded = 32768,
    SortPrimsFarZ = 65536,
    Unfogged = 262144
}
interface ParticleEmitterPopcorn extends Node {
    LifeSpan?: AnimVector | number;
    EmissionRate?: AnimVector | number;
    Speed?: AnimVector | number;
    Color?: AnimVector | Float32Array;
    Alpha?: AnimVector | number;
    ReplaceableId?: number;
    Path?: string;
    AnimVisibilityGuide?: string;
    Visibility?: AnimVector;
}
interface Model {
    Version: number;
    Info: ModelInfo;
    Sequences: Sequence[];
    Textures: Texture[];
    Materials: Material[];
    Geosets: Geoset[];
    GeosetAnims: GeosetAnim[];
    Bones: Bone[];
    Helpers: Helper[];
    Attachments: Attachment[];
    Nodes: Node[];
    PivotPoints: Float32Array[];
    EventObjects: EventObject[];
    CollisionShapes: CollisionShape[];
    GlobalSequences: number[];
    ParticleEmitters: ParticleEmitter[];
    ParticleEmitters2: ParticleEmitter2[];
    Cameras: Camera[];
    Lights: Light[];
    RibbonEmitters: RibbonEmitter[];
    TextureAnims: TVertexAnim[];
    FaceFX?: FaceFX[];
    BindPoses?: BindPose[];
    ParticleEmitterPopcorns?: ParticleEmitterPopcorn[];
}

type model_AnimKeyframe = AnimKeyframe;
type model_AnimVector = AnimVector;
type model_Attachment = Attachment;
type model_BindPose = BindPose;
type model_Bone = Bone;
type model_Camera = Camera;
type model_CollisionShape = CollisionShape;
type model_CollisionShapeType = CollisionShapeType;
declare const model_CollisionShapeType: typeof CollisionShapeType;
type model_EventObject = EventObject;
type model_FaceFX = FaceFX;
type model_FilterMode = FilterMode;
declare const model_FilterMode: typeof FilterMode;
type model_Geoset = Geoset;
type model_GeosetAnim = GeosetAnim;
type model_GeosetAnimFlags = GeosetAnimFlags;
declare const model_GeosetAnimFlags: typeof GeosetAnimFlags;
type model_GeosetAnimInfo = GeosetAnimInfo;
type model_Helper = Helper;
type model_Layer = Layer;
type model_LayerShading = LayerShading;
declare const model_LayerShading: typeof LayerShading;
type model_Light = Light;
type model_LightType = LightType;
declare const model_LightType: typeof LightType;
type model_LineType = LineType;
declare const model_LineType: typeof LineType;
type model_Material = Material;
type model_MaterialRenderMode = MaterialRenderMode;
declare const model_MaterialRenderMode: typeof MaterialRenderMode;
type model_Model = Model;
type model_ModelInfo = ModelInfo;
type model_Node = Node;
type model_NodeFlags = NodeFlags;
declare const model_NodeFlags: typeof NodeFlags;
type model_NodeType = NodeType;
declare const model_NodeType: typeof NodeType;
type model_ParticleEmitter = ParticleEmitter;
type model_ParticleEmitter2 = ParticleEmitter2;
type model_ParticleEmitter2FilterMode = ParticleEmitter2FilterMode;
declare const model_ParticleEmitter2FilterMode: typeof ParticleEmitter2FilterMode;
type model_ParticleEmitter2Flags = ParticleEmitter2Flags;
declare const model_ParticleEmitter2Flags: typeof ParticleEmitter2Flags;
type model_ParticleEmitter2FramesFlags = ParticleEmitter2FramesFlags;
declare const model_ParticleEmitter2FramesFlags: typeof ParticleEmitter2FramesFlags;
type model_ParticleEmitterFlags = ParticleEmitterFlags;
declare const model_ParticleEmitterFlags: typeof ParticleEmitterFlags;
type model_ParticleEmitterPopcorn = ParticleEmitterPopcorn;
type model_ParticleEmitterPopcornFlags = ParticleEmitterPopcornFlags;
declare const model_ParticleEmitterPopcornFlags: typeof ParticleEmitterPopcornFlags;
type model_RibbonEmitter = RibbonEmitter;
type model_Sequence = Sequence;
type model_TVertexAnim = TVertexAnim;
type model_Texture = Texture;
type model_TextureFlags = TextureFlags;
declare const model_TextureFlags: typeof TextureFlags;
declare namespace model {
  export { model_CollisionShapeType as CollisionShapeType, model_FilterMode as FilterMode, model_GeosetAnimFlags as GeosetAnimFlags, model_LayerShading as LayerShading, model_LightType as LightType, model_LineType as LineType, model_MaterialRenderMode as MaterialRenderMode, model_NodeFlags as NodeFlags, model_NodeType as NodeType, model_ParticleEmitter2FilterMode as ParticleEmitter2FilterMode, model_ParticleEmitter2Flags as ParticleEmitter2Flags, model_ParticleEmitter2FramesFlags as ParticleEmitter2FramesFlags, model_ParticleEmitterFlags as ParticleEmitterFlags, model_ParticleEmitterPopcornFlags as ParticleEmitterPopcornFlags, model_TextureFlags as TextureFlags };
  export type { model_AnimKeyframe as AnimKeyframe, model_AnimVector as AnimVector, model_Attachment as Attachment, model_BindPose as BindPose, model_Bone as Bone, model_Camera as Camera, model_CollisionShape as CollisionShape, model_EventObject as EventObject, model_FaceFX as FaceFX, model_Geoset as Geoset, model_GeosetAnim as GeosetAnim, model_GeosetAnimInfo as GeosetAnimInfo, model_Helper as Helper, model_Layer as Layer, model_Light as Light, model_Material as Material, model_Model as Model, model_ModelInfo as ModelInfo, model_Node as Node, model_ParticleEmitter as ParticleEmitter, model_ParticleEmitter2 as ParticleEmitter2, model_ParticleEmitterPopcorn as ParticleEmitterPopcorn, model_RibbonEmitter as RibbonEmitter, model_Sequence as Sequence, model_TVertexAnim as TVertexAnim, model_Texture as Texture };
}

declare function parse$1(str: string): Model;

declare function parse(arrayBuffer: ArrayBuffer): Model;

declare function generate$1(model: Model): string;

declare function generate(model: Model): ArrayBuffer;

declare enum BLPType {
    BLP0 = 0,
    BLP1 = 1,
    BLP2 = 2
}
declare enum BLPContent {
    JPEG = 0,
    Direct = 1
}
interface BLPMipMap {
    offset: number;
    size: number;
}
interface BLPImage {
    type: BLPType;
    width: number;
    height: number;
    content: BLPContent;
    alphaBits: number;
    mipmaps: BLPMipMap[];
    data: ArrayBuffer;
}

type blpimage_BLPContent = BLPContent;
declare const blpimage_BLPContent: typeof BLPContent;
type blpimage_BLPImage = BLPImage;
type blpimage_BLPMipMap = BLPMipMap;
type blpimage_BLPType = BLPType;
declare const blpimage_BLPType: typeof BLPType;
declare namespace blpimage {
  export { blpimage_BLPContent as BLPContent, blpimage_BLPType as BLPType };
  export type { blpimage_BLPImage as BLPImage, blpimage_BLPMipMap as BLPMipMap };
}

interface ImageDataLike {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    colorSpace: 'srgb' | 'display-p3' | undefined;
}
declare function decode(arrayBuffer: ArrayBuffer): BLPImage;
declare function getImageData(blp: BLPImage, mipmapLevel: number): ImageDataLike;

interface NodeWrapper {
    node: Node;
    matrix: mat4;
    childs: NodeWrapper[];
}
interface RendererData {
    model: Model;
    frame: number;
    animation: number;
    animationInfo: Sequence | null;
    globalSequencesFrames: number[];
    rootNode: NodeWrapper | null;
    nodes: NodeWrapper[];
    geosetAnims: GeosetAnim[];
    geosetAlpha: number[];
    materialLayerTextureID: number[][];
    materialLayerNormalTextureID: number[][];
    materialLayerOrmTextureID: number[][];
    materialLayerReflectionTextureID: number[][];
    teamColor: vec3;
    cameraPos: vec3;
    cameraQuat: quat;
    lightPos: vec3;
    lightColor: vec3;
    shadowBias: number;
    shadowSmoothingStep: number;
    textures: {
        [key: string]: WebGLTexture;
    };
    replaceableTextures: {
        [key: number]: WebGLTexture;
    };
    gpuTextures: {
        [key: string]: GPUTexture;
    };
    gpuSamplers: GPUSampler[];
    gpuDepthSampler: GPUSampler | null;
    requiredEnvMaps: {
        [key: string]: boolean;
    };
    envTextures: {
        [key: string]: WebGLTexture;
    };
    gpuEnvTextures: {
        [key: string]: GPUTexture;
    };
    irradianceMap: {
        [key: string]: WebGLTexture;
    };
    gpuIrradianceMap: {
        [key: string]: GPUTexture;
    };
    prefilteredEnvMap: {
        [key: string]: WebGLTexture;
    };
    gpuPrefilteredEnvMap: {
        [key: string]: GPUTexture;
    };
    gpuEmptyTexture: GPUTexture | null;
    gpuEmptyCubeTexture: GPUTexture | null;
    gpuDepthEmptyTexture: GPUTexture | null;
    fallbackTexture: WebGLTexture | null;
}
interface LightResult {
    type: number;
    position: vec3;
    direction: vec3;
    color: vec3;
    intensity: number;
    attenuation: vec3;
    attenuationStart: number;
    attenuationEnd: number;
}

declare class ModelInterp {
    static maxAnimVectorVal(vector: AnimVector | number): number;
    private rendererData;
    constructor(rendererData: RendererData);
    num(animVector: AnimVector): number | null;
    vec3(out: vec3, animVector: AnimVector): vec3 | null;
    quat(out: quat, animVector: AnimVector): quat | null;
    animVectorVal(vector: AnimVector | number, defaultVal: number): number;
    findKeyframes(animVector: AnimVector): null | {
        frame: number;
        left: AnimKeyframe;
        right: AnimKeyframe;
    };
    findLocalFrame(animVector: AnimVector): {
        frame: number;
        from: number;
        to: number;
    };
}

declare class ParticlesController {
    private gl;
    private shaderProgram;
    private vertexShader;
    private fragmentShader;
    private device;
    private gpuShaderModule;
    private gpuPipelineLayout;
    private gpuPipelines;
    private vsBindGroupLayout;
    private fsBindGroupLayout;
    private gpuVSUniformsBuffer;
    private gpuVSUniformsBindGroup;
    private shaderProgramLocations;
    private particleStorage;
    private interp;
    private rendererData;
    private emitters;
    private particleBaseVectors;
    constructor(interp: ModelInterp, rendererData: RendererData);
    destroy(): void;
    /**
     * Synchronizes the internal emitters array with the model's ParticleEmitters2.
     * This allows newly added particle emitters to be detected and rendered without
     * needing to recreate the entire renderer.
     */
    syncEmitters(): void;
    initGL(glContext: WebGLRenderingContext): void;
    initGPUDevice(device: GPUDevice): void;
    private initShaders;
    private updateParticle;
    private resizeEmitterBuffers;
    update(delta: number): void;
    render(mvMatrix: mat4, pMatrix: mat4): void;
    private renderGPUEmitterType;
    renderGPU(pass: GPURenderPassEncoder, mvMatrix: mat4, pMatrix: mat4): void;
    private updateEmitter;
    private createParticle;
    private updateParticleBuffers;
    private updateParticleVertices;
    private updateParticleTexCoords;
    private updateParticleTexCoordsByType;
    private updateParticleColor;
    private setLayerProps;
    private setGeneralBuffers;
    private renderEmitterType;
}

declare class RibbonsController {
    private gl;
    private shaderProgram;
    private vertexShader;
    private fragmentShader;
    private device;
    private gpuShaderModule;
    private gpuPipelineLayout;
    private gpuPipelines;
    private vsBindGroupLayout;
    private fsBindGroupLayout;
    private gpuVSUniformsBuffer;
    private gpuVSUniformsBindGroup;
    private shaderProgramLocations;
    private interp;
    private rendererData;
    private emitters;
    constructor(interp: ModelInterp, rendererData: RendererData);
    destroy(): void;
    initGL(glContext: WebGLRenderingContext): void;
    initGPUDevice(device: GPUDevice): void;
    /**
     * Synchronizes the internal emitters array with the model's RibbonEmitters.
     * This ensures dynamically added/removed emitters are properly handled.
     */
    syncEmitters(): void;
    update(delta: number): void;
    render(mvMatrix: mat4, pMatrix: mat4): void;
    renderGPU(pass: GPURenderPassEncoder, mvMatrix: mat4, pMatrix: mat4): void;
    private initShaders;
    private resizeEmitterBuffers;
    private updateEmitter;
    private appendVertices;
    private updateEmitterTexCoords;
    private setLayerProps;
    private setGeneralBuffers;
    private renderEmitter;
}

declare class ModelInstance {
    model: Model;
    rendererData: RendererData;
    interp: ModelInterp;
    enableGeosetAnimColor: boolean;
    particlesController: ParticlesController;
    ribbonsController: RibbonsController;
    location: vec3;
    rotation: quat;
    scale: vec3;
    worldMatrix: mat4;
    dirty: boolean;
    private _missingParentLogged;
    constructor(model: Model);
    private initNodes;
    /**
     * Reinitializes rendererData.nodes from the current model.Nodes array.
     * Call this when new nodes are added to the model to ensure they are
     * accessible for particle emitters and other node-dependent features.
     */
    syncNodes(): void;
    private initGlobalSequences;
    /**
     * Synchronizes globalSequencesFrames with model.GlobalSequences.
     * Call this when new GlobalSequences are added to ensure TextureAnimations
     * using those sequences can animate correctly.
     */
    syncGlobalSequences(): void;
    setMaterials(materials: any[]): void;
    /**
     * Reinitializes materialLayerTextureID from the current model.Materials array.
     * Call this when materials are added/modified to ensure the renderer has
     * up-to-date texture ID lookups without requiring a full renderer reload.
     */
    syncMaterials(): void;
    private initMaterialLayers;
    update(delta: number): void;
    setLocation(location: vec3): void;
    setRotation(rotation: quat): void;
    setScale(scale: vec3): void;
    updateWorldMatrix(): void;
    setSequence(index: number): void;
    setFrame(frame: number): void;
    private updateGlobalSequences;
    private updateNode;
    findAlpha(geosetId: number): number;
    findColor(geosetId: number): Float32Array;
    getTexCoordMatrix(layer: Layer): mat3;
    /**
     * Get computed properties for a Light node at the current animation frame.
     * This is used for DNC (Day/Night Cycle) environmental lighting.
     */
    getLightProps(light: Light): {
        direction: vec3;
        color: vec3;
        intensity: number;
        ambientColor: vec3;
        ambientIntensity: number;
        visibility: number;
        type: LightType;
        attenuationStart: number;
        attenuationEnd: number;
    };
    /**
     * Find the primary directional light in the model.
     * DNC models typically have one main Directional light for the sun.
     */
    findPrimaryDirectionalLight(): Light | null;
    /**
     * Get accumulated light contribution from all lights in the model.
     * This combines all visible lights' colors and intensities.
     */
    getAccumulatedLightParams(): {
        lightColor: vec3;
        ambientColor: vec3;
        lightDirection: vec3;
    };
    collectActiveLights(): LightResult[];
}

declare type DDS_FORMAT = WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT1_EXT'] | WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT3_EXT'] | WEBGL_compressed_texture_s3tc['COMPRESSED_RGBA_S3TC_DXT5_EXT'] | WEBGL_compressed_texture_s3tc['COMPRESSED_RGB_S3TC_DXT1_EXT'];
declare class ModelRenderer {
    private isHD;
    private canvas;
    private gl;
    private device;
    private gpuContext;
    private anisotropicExt;
    private colorBufferFloatExt;
    private s3tcExt;
    private vertexShader;
    private fragmentShader;
    private shaderProgram;
    private vsBindGroupLayout;
    private fsBindGroupLayout;
    private gpuShaderModule;
    private gpuDepthShaderModule;
    private gpuPipelines;
    private gpuWireframePipeline;
    private gpuShadowPipeline;
    private gpuPipelineLayout;
    private gpuRenderPassDescriptor;
    private shaderProgramLocations;
    private skeletonShaderProgram;
    private skeletonVertexShader;
    private skeletonFragmentShader;
    private skeletonShaderProgramLocations;
    private skeletonVertexBuffer;
    private skeletonColorBuffer;
    private skeletonShaderModule;
    private skeletonBindGroupLayout;
    private skeletonPipelineLayout;
    private skeletonPipeline;
    private skeletonGPUVertexBuffer;
    private skeletonGPUColorBuffer;
    private skeletonGPUUniformsBuffer;
    private boneTexture;
    private boneTextureData;
    private fallbackTexture;
    model: Model;
    modelInstance: ModelInstance;
    get interp(): ModelInterp;
    get rendererData(): RendererData;
    private softwareSkinning;
    private vertexBuffer;
    private normalBuffer;
    private vertices;
    private texCoordBuffer;
    private indexBuffer;
    private wireframeIndexBuffer;
    private wireframeIndexGPUBuffer;
    private groupBuffer;
    private skinWeightBuffer;
    private tangentBuffer;
    private envShaderModeule;
    private envPiepeline;
    private envVSBindGroupLayout;
    private envFSBindGroupLayout;
    private envVSUniformsBuffer;
    private envVSBindGroup;
    private envSampler;
    private cubeVertexBuffer;
    private cubeGPUVertexBuffer;
    private squareVertexBuffer;
    private brdfLUT;
    private gpuBrdfLUT;
    private gpuBrdfSampler;
    private envToCubemap;
    private envToCubemapShaderModule;
    private envToCubemapPiepeline;
    private envToCubemapVSBindGroupLayout;
    private envToCubemapFSBindGroupLayout;
    private envToCubemapSampler;
    private envSphere;
    private convoluteDiffuseEnv;
    private convoluteDiffuseEnvShaderModule;
    private convoluteDiffuseEnvPiepeline;
    private convoluteDiffuseEnvVSBindGroupLayout;
    private convoluteDiffuseEnvFSBindGroupLayout;
    private convoluteDiffuseEnvSampler;
    private prefilterEnv;
    private prefilterEnvShaderModule;
    private prefilterEnvPiepeline;
    private prefilterEnvVSBindGroupLayout;
    private prefilterEnvFSBindGroupLayout;
    private prefilterEnvSampler;
    private integrateBRDF;
    private gpuMultisampleTexture;
    private gpuDepthTexture;
    private gpuVertexBuffer;
    private gpuNormalBuffer;
    private gpuTexCoordBuffer;
    private gpuGroupBuffer;
    private gpuIndexBuffer;
    private gpuSkinWeightBuffer;
    private gpuTangentBuffer;
    private gpuVSUniformsBuffer;
    private gpuVSUniformsBindGroup;
    private gpuFSUniformsBuffers;
    private envLightEnabled;
    private envLightDirection;
    private envLightColor;
    private envAmbientColor;
    constructor(model: Model);
    destroy(): void;
    private initRequiredEnvMaps;
    initGL(glContext: WebGL2RenderingContext | WebGLRenderingContext): void;
    /**
     * Initialize a fallback magenta texture for missing textures.
     * This ensures meshes are visible even when their textures fail to load.
     */
    private initFallbackTexture;
    /**
     * Initialize the bone texture for texture-based skinning.
     * This replaces the uniform array approach and allows for many more bones.
     */
    private initBoneTexture;
    /**
     * Update bone texture with current frame's bone matrices and bind it to the shader.
     */
    private updateAndBindBoneTexture;
    resize(width: number, height: number): void;
    /**
     * Update the normal buffer for a specific geoset after normal recalculation.
     * @param geosetIndex - Index of the geoset to update
     * @param newNormals - New vertex normals (Float32Array or number[])
     */
    updateGeosetNormals(geosetIndex: number, newNormals: Float32Array | number[]): void;
    private calculateSmoothNormals;
    private validateNormals;
    initGPUDevice(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext): Promise<void>;
    setTextureImage(path: string, img: HTMLImageElement): void;
    setTextureImageData(path: string, imageData: ImageData[]): void;
    /**
     * Set texture data from optimized Rust backend payload (DXT or RGBA)
     * @returns true if texture was loaded successfully, false if renderer not ready
     */
    setOptimizedTextureData(path: string, width: number, height: number, format: string, mipmaps: Uint8Array[]): boolean;
    setTextureCompressedImage(path: string, format: DDS_FORMAT, imageData: ArrayBuffer, ddsInfo: DdsInfo): void;
    setGPUTextureCompressedImage(path: string, format: GPUTextureFormat, imageData: ArrayBuffer, ddsInfo: DdsInfo): void;
    setCamera(cameraPos: vec3, cameraQuat: quat): void;
    setLightPosition(lightPos: vec3): void;
    setLightColor(lightColor: vec3): void;
    /**
     * Set environment lighting from DNC (Day/Night Cycle) model.
     * When enabled, these values override the hardcoded lighting in renderInstances.
     */
    setEnvironmentLight(direction: vec3, lightColor: vec3, ambientColor: vec3): void;
    /**
     * Clear environment lighting and return to default hardcoded values.
     */
    clearEnvironmentLight(): void;
    /**
     * Check if environment lighting is enabled.
     */
    isEnvironmentLightEnabled(): boolean;
    setSequence(index: number): void;
    getSequence(): number;
    setFrame(frame: number): void;
    getFrame(): number;
    setTeamColor(color: vec3): void;
    setMaterials(materials: any[]): void;
    /**
     * Update texture coordinates (UV data) for a specific geoset.
     * This enables real-time UV editing in the 3D viewer.
     */
    updateGeosetTexCoords(geosetIndex: number, newTVertices: Float32Array): void;
    update(delta: number): void;
    renderInstances(instances: ModelInstance[], viewMatrix: mat4, pMatrix: mat4, { wireframe, levelOfDetail, useEnvironmentMap, shadowMapTexture, shadowMapMatrix, shadowBias, shadowSmoothingStep, depthTextureTarget, enableLighting }: {
        wireframe?: boolean;
        levelOfDetail?: number;
        useEnvironmentMap?: boolean;
        shadowMapTexture?: WebGLTexture | GPUTexture;
        shadowMapMatrix?: mat4;
        shadowBias?: number;
        shadowSmoothingStep?: number;
        depthTextureTarget?: GPUTexture;
        enableLighting?: boolean;
    }): void;
    render(mvMatrix: mat4, pMatrix: mat4, { wireframe, env, levelOfDetail, useEnvironmentMap, shadowMapTexture, shadowMapMatrix, shadowBias, shadowSmoothingStep, depthTextureTarget, enableLighting }: {
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
    }): void;
    private renderEnvironmentGPU;
    renderEnvironment(mvMatrix: mat4, pMatrix: mat4): void;
    raycast(rayOrigin: vec3, rayDir: vec3, mode: 'vertex' | 'face'): {
        geosetIndex: number;
        index: number;
        distance: number;
    } | null;
    updateGeosetVertices(geosetIndex: number, vertices: Float32Array): void;
    /**
     * @param mvMatrix
     * @param pMatrix
     * @param nodes Nodes to highlight. null means draw all
     */
    renderSkeleton(mvMatrix: mat4, pMatrix: mat4, nodes: string[] | null, selectedNodeIds?: number[]): void;
    private initSkeletonShaderProgram;
    private setTextureParameters;
    private processEnvMaps;
    private initShaderProgram;
    private destroyShaderProgramObject;
    private initShaders;
    private initGPUShaders;
    private createWireframeBuffer;
    private createWireframeGPUBuffer;
    private initBuffers;
    private createGPUPipeline;
    private createGPUPipelineByLayer;
    private getGPUPipeline;
    private initGPUPipeline;
    private initGPUBuffers;
    private initGPUUniformBuffers;
    private initGPUMultisampleTexture;
    private initGPUDepthTexture;
    private initGPUEmptyTexture;
    private initCube;
    private initSquare;
    private initBRDFLUT;
    private initGPUBRDFLUT;
    get enableGeosetAnimColor(): boolean;
    set enableGeosetAnimColor(value: boolean);
    private setLayerProps;
    private getLayerAlpha;
    private setLayerPropsHD;
    setReplaceableTexture(id: number, img: HTMLImageElement | ImageBitmap): void;
    renderGeosetHighlight(i: number, color: vec3, alpha: number, viewMatrix: mat4, pMatrix: mat4): void;
}

declare class Scene {
    private instances;
    add(instance: ModelInstance): void;
    remove(instance: ModelInstance): void;
    update(delta: number): void;
    clear(): void;
    getInstances(): ModelInstance[];
}

declare class BatchRenderer {
    gl: WebGLRenderingContext | WebGL2RenderingContext;
    private modelRenderers;
    constructor(gl: WebGLRenderingContext | WebGL2RenderingContext);
    render(scene: Scene, pMatrix: mat4, viewMatrix: mat4, options: {
        wireframe?: boolean;
        env?: boolean;
        levelOfDetail?: number;
        useEnvironmentMap?: boolean;
        shadowMapTexture?: WebGLTexture | GPUTexture;
        shadowMapMatrix?: mat4;
        shadowBias?: number;
        shadowSmoothingStep?: number;
        depthTextureTarget?: GPUTexture;
    }): void;
}

interface ModelBuffers {
    vertexBuffer: WebGLBuffer[];
    normalBuffer: WebGLBuffer[];
    texCoordBuffer: WebGLBuffer[];
    skinWeightBuffer: WebGLBuffer[];
    tangentBuffer: WebGLBuffer[];
    groupBuffer: WebGLBuffer[];
    indexBuffer: WebGLBuffer[];
    wireframeIndexBuffer: WebGLBuffer[];
}
interface ModelGPUBuffers {
    vertexBuffer: GPUBuffer[];
    normalBuffer: GPUBuffer[];
    texCoordBuffer: GPUBuffer[];
    skinWeightBuffer: GPUBuffer[];
    tangentBuffer: GPUBuffer[];
    groupBuffer: GPUBuffer[];
    indexBuffer: GPUBuffer[];
    wireframeIndexBuffer: GPUBuffer[];
}
declare class ModelResourceManager {
    private static instance;
    private gl;
    private device;
    private buffers;
    private gpuBuffers;
    private textures;
    private gpuTextures;
    private constructor();
    static getInstance(): ModelResourceManager;
    initGL(gl: WebGL2RenderingContext | WebGLRenderingContext): void;
    initDevice(device: GPUDevice): void;
    getBuffers(model: Model, softwareSkinning: boolean): ModelBuffers | null;
    getGPUBuffers(model: Model): ModelGPUBuffers | null;
    private initBuffers;
    private initGPUBuffers;
    getTexture(path: string): WebGLTexture | undefined;
    setTexture(path: string, texture: WebGLTexture): void;
    getGPUTexture(path: string): GPUTexture | undefined;
    setGPUTexture(path: string, texture: GPUTexture): void;
    /**
     * Update texture coordinates buffer for a specific geoset.
     * This enables real-time UV editing in the 3D viewer.
     */
    updateGeosetTexCoords(model: Model, geosetIndex: number, newTVertices: Float32Array): void;
    updateGeosetGroups(model: Model, geosetIndex: number): void;
    /**
     * Add GPU buffers for a dynamically added geoset.
     * This enables Split/Paste operations to create new geosets that can be rendered.
     * @param model - The model containing the new geoset
     * @param geosetIndex - Index of the newly added geoset
     */
    addGeosetBuffers(model: Model, geosetIndex: number): void;
}

export { BatchRenderer, ModelInstance, ModelRenderer, ModelResourceManager, Scene, blpimage as blp, decode as decodeBLP, generate$1 as generateMDL, generate as generateMDX, getImageData as getBLPImageData, model, parse$1 as parseMDL, parse as parseMDX };
