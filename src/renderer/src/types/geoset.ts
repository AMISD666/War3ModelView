/**
 * War3 Model Geoset Type Definitions
 */

// 顶点
export interface Vertex {
    index: number;
    position: [number, number, number];
    normal: [number, number, number];
    textureCoords: [number, number];
    vertexGroup?: number;
}

// 面
export interface Face {
    index: number;
    vertices: [number, number, number];  // 顶点索引
}

// 顶点组
export interface VertexGroup {
    matrices: number[];  // Matrix 索引列表
}

// 包围盒
export interface Extent {
    Min: [number, number, number];
    Max: [number, number, number];
    BoundsRadius: number;
}

// Geoset
export interface Geoset {
    Vertices: number[][];        // [x, y, z][]
    Normals: number[][];         // [nx, ny, nz][]
    TVertices: number[][];       // [u, v][]
    VertexGroup: number[];       // 每个顶点所属的组
    Faces: number[][];           // 面的顶点索引
    Groups: VertexGroup[];
    MinimumExtent: [number, number, number];
    MaximumExtent: [number, number, number];
    BoundsRadius: number;
    MaterialID: number;
    SelectionGroup: number;
    Unselectable?: boolean;
    Anim?: any;
}

// Geoset Animation
export interface GeosetAnimation {
    GeosetId: number;
    Color?: [number, number, number];
    Alpha?: number;
    UseColor?: boolean;
    DropShadow?: boolean;
}
