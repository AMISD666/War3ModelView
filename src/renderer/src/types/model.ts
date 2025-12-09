/**
 * War3 Model Data Type Definitions
 */

import { ModelNode } from './node';
import { Geoset, GeosetAnimation } from './geoset';

// 纹理
export interface Texture {
    Image: string;
    ReplaceableId?: number;
    WrapWidth?: boolean;
    WrapHeight?: boolean;
    Flags?: number;
}

// 材质层
export interface MaterialLayer {
    FilterMode: string;  // 'None' | 'Transparent' | 'Blend' | 'Additive' | 'AddAlpha' | 'Modulate' etc.
    TextureID: number;
    Alpha?: number;
    TextureAnimationId?: number;
    Unshaded?: boolean;
    Unfogged?: boolean;
    TwoSided?: boolean;
    SphereEnvMap?: boolean;
    NoDepthTest?: boolean;
    NoDepthSet?: boolean;
}

// 材质
export interface Material {
    Layers: MaterialLayer[];
    PriorityPlane?: number;
    ConstantColor?: boolean;
    SortPrimitivesFarZ?: boolean;
    FullResolution?: boolean;
}

// 动画序列
export interface Sequence {
    Name: string;
    Interval: [number, number];  // [start, end]
    MoveSpeed?: number;
    NonLooping?: boolean;
    Rarity?: number;
    MinimumExtent?: [number, number, number];
    MaximumExtent?: [number, number, number];
    BoundsRadius?: number;
}

// 纹理动画
export interface TextureAnimation {
    Translation?: any;
    Rotation?: any;
    Scaling?: any;
}

// 全局序列
export interface GlobalSequence {
    Duration: number;
}

// 模型数据
export interface ModelData {
    Version: {
        FormatVersion: number;
    };
    Model: {
        Name: string;
        NumGeosets?: number;
        NumGeosetAnims?: number;
        NumHelpers?: number;
        NumBones?: number;
        NumLights?: number;
        NumAttachments?: number;
        NumParticleEmitters?: number;
        NumParticleEmitters2?: number;
        NumRibbonEmitters?: number;
        NumEventObjects?: number;
        NumCameras?: number;
        BlendTime?: number;
        MinimumExtent?: [number, number, number];
        MaximumExtent?: [number, number, number];
        BoundsRadius?: number;
    };
    Sequences?: Sequence[];
    GlobalSequences?: GlobalSequence[];
    Textures?: Texture[];
    Materials?: Material[];
    TextureAnims?: TextureAnimation[];
    Geosets?: Geoset[];
    GeosetAnims?: GeosetAnimation[];
    Nodes?: ModelNode[];
    Bones?: ModelNode[];
    Helpers?: ModelNode[];
    Attachments?: ModelNode[];
    Lights?: ModelNode[];
    ParticleEmitters?: ModelNode[];
    ParticleEmitters2?: ModelNode[];
    RibbonEmitters?: ModelNode[];
    EventObjects?: ModelNode[];
    CollisionShapes?: ModelNode[];
    Cameras?: ModelNode[];
    _updateCounter?: number;
}

// 模型统计信息
export interface ModelStats {
    geosets: number;
    vertices: number;
    faces: number;
    textures: number;
    materials: number;
    sequences: number;
    nodes: {
        total: number;
        bones: number;
        helpers: number;
        attachments: number;
        lights: number;
        particleEmitters: number;
        particleEmitters2: number;
        ribbonEmitters: number;
        eventObjects: number;
        collisionShapes: number;
        cameras: number;
    };
}
