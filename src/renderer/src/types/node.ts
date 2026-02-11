/**
 * War3 Model Node Type Definitions
 */

import React from 'react';

// 节点类型枚举
export enum NodeType {
    BONE = 'Bone',
    HELPER = 'Helper',
    ATTACHMENT = 'Attachment',
    PARTICLE_EMITTER = 'ParticleEmitter',
    PARTICLE_EMITTER_2 = 'ParticleEmitter2',
    RIBBON_EMITTER = 'RibbonEmitter',
    LIGHT = 'Light',
    EVENT_OBJECT = 'EventObject',
    COLLISION_SHAPE = 'CollisionShape',
    CAMERA = 'Camera',
    PARTICLE_EMITTER_POPCORN = 'ParticleEmitterPopcorn'
}

// 节点基础接口
export interface BaseNode {
    Name: string;
    ObjectId: number;
    Parent?: number;  // 父节点的 ObjectId
    PivotPoint?: [number, number, number];

    // 标志位
    DontInherit?: {
        Translation?: boolean;
        Rotation?: boolean;
        Scaling?: boolean;
    };
    Billboarded?: boolean;
    BillboardedLockX?: boolean;
    BillboardedLockY?: boolean;
    BillboardedLockZ?: boolean;
    CameraAnchored?: boolean;

    // 动画数据（可选）
    Translation?: any;
    Rotation?: any;
    Scaling?: any;
    Visibility?: any;
}

// Bone 节点
export interface BoneNode extends BaseNode {
    type: NodeType.BONE;
    GeosetId?: number;
    GeosetAnimId?: number;
}

// Helper 节点
export interface HelperNode extends BaseNode {
    type: NodeType.HELPER;
}

// Attachment 节点
export interface AttachmentNode extends BaseNode {
    type: NodeType.ATTACHMENT;
    Path?: string;
    AttachmentID?: number;
}

// Light 节点
export interface LightNode extends BaseNode {
    type: NodeType.LIGHT;
    LightType?: 'Omnidirectional' | 'Directional' | 'Ambient' | number;

    // Static OR Animated properties (same pattern as war3-model library)
    Color?: [number, number, number] | any;  // AnimVector for RGB
    AmbientColor?: [number, number, number] | any;  // AnimVector for RGB
    Intensity?: number | any;  // AnimVector for scalar
    AmbientIntensity?: number | any;  // AnimVector for scalar
    AttenuationStart?: number | any;  // AnimVector for scalar
    AttenuationEnd?: number | any;  // AnimVector for scalar

    // Animation keys (stored separately when animated)
    ColorAnim?: any;
    AmbientColorAnim?: any;
    IntensityAnim?: any;
    AmbientIntensityAnim?: any;
    AttenuationStartAnim?: any;
    AttenuationEndAnim?: any;
    VisibilityAnim?: any;
}

// Particle Emitter 节点
export interface ParticleEmitterNode extends BaseNode {
    type: NodeType.PARTICLE_EMITTER;
    // Prefer war3-model naming for compatibility with renderer/writer:
    // Path, LifeSpan, InitVelocity.
    Path?: string;
    EmissionRate?: number;
    LifeSpan?: number;
    InitVelocity?: number;
    Gravity?: number;
    Longitude?: number;
    Latitude?: number;

    // Back-compat aliases that might exist in UI state.
    FileName?: string;
    InitialVelocity?: number;
}

// Particle Emitter 2 节点
export interface ParticleEmitter2Node extends BaseNode {
    type: NodeType.PARTICLE_EMITTER_2;
    // 基础属性
    EmissionRate?: number;
    Speed?: number;
    Variation?: number;
    Width?: number;
    Length?: number;
    Gravity?: number;
    Latitude?: number;
    LifeSpan?: number; // 这里的 LifeSpan 可能是指 Time? War3 中通常有 LifeSpan 和 Time
    Time?: number; // 中间那个 "Time" (0.5)

    // 渲染属性
    TextureID?: number;
    FilterMode?: 'Blend' | 'Additive' | 'Modulate' | 'Modulate2x' | 'AlphaKey' | 'None' | number;
    Rows?: number;
    Columns?: number;
    PriorityPlane?: number;
    ReplaceableId?: number;

    // 分段属性 (3段)
    SegmentColor?: [number, number, number][]; // [[R,G,B], [R,G,B], [R,G,B]]
    Alpha?: [number, number, number]; // [0-255, 0-255, 0-255]
    ParticleScaling?: [number, number, number];

    // 头尾属性 - Interval UV arrays [start, end, repeat]
    LifeSpanUVAnim?: [number, number, number];
    DecayUVAnim?: [number, number, number];
    TailUVAnim?: [number, number, number];
    TailDecayUVAnim?: [number, number, number];
    TailLength?: number;

    // 标志位
    SortPrimsFarZ?: boolean;
    Unshaded?: boolean;
    Unfogged?: boolean;
    LineEmitter?: boolean;
    ModelSpace?: boolean;
    XYQuad?: boolean;
    Squirt?: boolean; // 喷射
    Head?: boolean;
    Tail?: boolean;

    // 动画数据 (Dynamic Flags)
    // 这些通常存储在单独的动画块中，这里仅作为标记
    EmissionRateAnim?: any;
    SpeedAnim?: any;
    VariationAnim?: any;
    LatitudeAnim?: any;
    WidthAnim?: any;
    LengthAnim?: any;
    GravityAnim?: any;
    VisibilityAnim?: any;
}

// Ribbon Emitter 节点
export interface RibbonEmitterNode extends BaseNode {
    type: NodeType.RIBBON_EMITTER;
    Color?: [number, number, number];
    Alpha?: number;
    HeightAbove?: number;
    HeightBelow?: number;
    TextureSlot?: number;
    EmissionRate?: number;
    MaterialID?: number;
    LifeSpan?: number;
    Rows?: number;
    Columns?: number;
    Gravity?: number;
}

// Event Object 节点
export interface EventObjectNode extends BaseNode {
    type: NodeType.EVENT_OBJECT;
    GlobalSequenceId?: number;
    EventTrack?: any;
}

// Collision Shape 节点
export interface CollisionShapeNode extends BaseNode {
    type: NodeType.COLLISION_SHAPE;
    ShapeType?: 'Box' | 'Sphere';
    Shape?: number; // 0=Box, 2=Sphere
    BoundsRadius?: number;
    Vertex1?: [number, number, number];
    Vertex2?: [number, number, number];
    Vertices?: [number, number, number][];
}

// Camera 节点
export interface CameraNode extends BaseNode {
    type: NodeType.CAMERA;
    FieldOfView?: number;
    FarClip?: number;
    NearClip?: number;
    TargetPosition?: [number, number, number];
    TargetTranslation?: any; // Animation data for Target Position
}

// Particle Emitter Popcorn 节点 (Reforged)
export interface ParticleEmitterPopcornNode extends BaseNode {
    type: NodeType.PARTICLE_EMITTER_POPCORN;
    LifeSpan?: number | any;
    EmissionRate?: number | any;
    Speed?: number | any;
    Color?: [number, number, number] | any;
    Alpha?: number | any;
    ReplaceableId?: number;
    Path?: string;
    AnimVisibilityGuide?: string;

    // Animation keys
    LifeSpanAnim?: any;
    EmissionRateAnim?: any;
    SpeedAnim?: any;
    ColorAnim?: any;
    AlphaAnim?: any;
    VisibilityAnim?: any;
}

// Texture Animation 节点


// 联合类型
export type ModelNode =
    | BoneNode
    | HelperNode
    | AttachmentNode
    | LightNode
    | ParticleEmitterNode
    | ParticleEmitter2Node
    | RibbonEmitterNode
    | EventObjectNode
    | CollisionShapeNode
    | CameraNode
    | ParticleEmitterPopcornNode;

// 树形节点（用于 Ant Design Tree）
export interface TreeNode {
    key: string;          // ObjectId 的字符串形式
    value?: number;       // ObjectId 的数字形式 (用于 TreeSelect)
    title: string;        // 节点名称
    type: NodeType;       // 节点类型
    icon?: React.ReactNode;
    children?: TreeNode[];
    data: ModelNode;      // 原始节点数据
    isVirtualRoot?: boolean; // 是否为虚拟根节点
}
