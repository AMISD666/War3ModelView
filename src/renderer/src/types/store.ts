/**
 * Zustand Store Type Definitions
 */

import { ModelData } from './model';
import { ModelNode } from './node';

export interface SetModelDataOptions {
    skipAutoRecalculate?: boolean;
    skipModelRebuild?: boolean;
}

// 编辑模式
export enum EditMode {
    OBJECT = 'object',
    VERTEX = 'vertex',
    EDGE = 'edge',
    FACE = 'face'
}

// 工具模式
export enum ToolMode {
    SELECT = 'select',
    TRANSLATE = 'translate',
    ROTATE = 'rotate',
    SCALE = 'scale'
}

// 模型状态
export interface ModelState {
    modelData: ModelData | null;
    modelPath: string | null;
    nodes: ModelNode[];
    isLoading: boolean;

    // Global Preview Transform (unbaked gizmo state)
    previewTransform: {
        translation: [number, number, number],
        rotation: [number, number, number],
        scale: [number, number, number]
    };
    setPreviewTransform: (transform: Partial<ModelState['previewTransform']>) => void;
    resetPreviewTransform: () => void;

    setModelData: (data: ModelData | null, path: string | null, options?: SetModelDataOptions) => void;
    setLoading: (loading: boolean) => void;
    updateNode: (node: ModelNode) => void;
    addNode: (node: ModelNode) => void;
    deleteNode: (objectId: number) => void;
    getNodeById: (objectId: number) => ModelNode | undefined;
    getNodeChildren: (objectId: number) => ModelNode[];
    getAllNodes: () => ModelNode[];

    // Data processing and repair
    recalculateExtents: () => void;
    recalculateNormals: () => void;
    repairModel: () => void;
    triggerRendererReload: () => void;
    removeLights: () => void;
    addDeathAnimation: () => void;

    // Visibility
    hiddenGeosetIds: number[];
    toggleGeosetVisibility: (id: number) => void;
}

// 选择状态
export interface SelectionState {
    selectedNodeIds: number[];
    selectedVertexIds: number[];
    selectedFaceIds: number[];

    selectNode: (id: number, multi?: boolean) => void;
    selectNodes: (ids: number[]) => void;
    clearNodeSelection: () => void;
    isNodeSelected: (id: number) => boolean;

    selectVertex: (id: number, multi?: boolean) => void;
    selectVertices: (ids: number[]) => void;
    clearVertexSelection: () => void;

    selectFace: (id: number, multi?: boolean) => void;
    selectFaces: (ids: number[]) => void;
    clearFaceSelection: () => void;
}

// UI 状态
export interface UIState {
    // 窗口显示状态
    showNodeManager: boolean;
    showModelInfo: boolean;
    showVertexEditor: boolean;
    showFaceEditor: boolean;

    // 节点Dialog状态
    nodeDialogVisible: boolean;
    currentEditingNodeId: number | null;
    createNodeDialogVisible: boolean;

    // 侧边栏状态
    leftSidebarCollapsed: boolean;
    rightSidebarCollapsed: boolean;

    // 编辑模式
    editMode: EditMode;
    toolMode: ToolMode;

    // Actions
    toggleNodeManager: () => void;
    toggleModelInfo: () => void;
    toggleVertexEditor: () => void;
    toggleFaceEditor: () => void;

    setNodeDialogVisible: (visible: boolean, nodeId?: number) => void;
    setCreateNodeDialogVisible: (visible: boolean) => void;

    toggleLeftSidebar: () => void;
    toggleRightSidebar: () => void;

    setEditMode: (mode: EditMode) => void;
    setToolMode: (mode: ToolMode) => void;
}

// Tab State Snapshot (for saving/restoring when switching tabs)
export interface TabSnapshot {
    modelData: ModelData | null;
    modelPath: string | null;
    nodes: ModelNode[];
    sequences: any[];
    currentSequence: number;
    currentFrame: number;
    hiddenGeosetIds: number[];
    // Camera state (captured from Viewer)
    cameraState: {
        distance: number;
        theta: number;
        phi: number;
        target: [number, number, number];
    } | null;
    // Cache for optimized tab switching
    renderer: any | null;
    lastActive: number;
}

// Tab definition
export interface Tab {
    id: string;
    path: string;
    name: string;
    snapshot: TabSnapshot;
}
