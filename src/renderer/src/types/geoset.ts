/**
 * War3 Model Geoset Type Definitions
 */

export interface Vertex {
    index: number;
    position: [number, number, number];
    normal: [number, number, number];
    textureCoords: [number, number];
    vertexGroup?: number;
}

export interface Face {
    index: number;
    vertices: [number, number, number];
}

export type MatrixGroup = number[];

export interface Extent {
    Min: [number, number, number];
    Max: [number, number, number];
    BoundsRadius: number;
}

export interface Geoset {
    Vertices: number[] | Float32Array;
    Normals: number[] | Float32Array;
    TVertices?: Array<number[] | Float32Array>;
    VertexGroup?: number[] | Uint8Array | Uint16Array;
    Faces: number[] | Uint16Array | Uint32Array;
    Groups?: MatrixGroup[];
    TotalGroupsCount?: number;
    MinimumExtent: [number, number, number];
    MaximumExtent: [number, number, number];
    BoundsRadius: number;
    MaterialID: number;
    SelectionGroup: number;
    Unselectable?: boolean;
    Anim?: any;
    Tangents?: number[] | Float32Array;
    SkinWeights?: number[] | Uint8Array;
}

export interface GeosetAnimation {
    GeosetId: number;
    Color?: [number, number, number];
    Alpha?: number;
    UseColor?: boolean;
    DropShadow?: boolean;
}
