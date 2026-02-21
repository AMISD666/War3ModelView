/**
 * Selection State Management using Zustand
 */

import { create } from 'zustand';

export interface SelectionId {
    geosetIndex: number;
    index: number; // Vertex index or Face index
}

export type AppMode = 'view' | 'geometry' | 'uv' | 'animation' | 'batch';
export type GeometrySubMode = 'vertex' | 'face' | 'group';
export type TransformMode = 'translate' | 'rotate' | 'scale' | null;
export type KeyframeDisplayMode = 'node' | 'geosetAnim' | 'particle' | 'textureAnim';

export type SelectionMode = 'object' | 'vertex' | 'face' | 'group'; // Deprecated in favor of AppMode + SubMode, keeping for compatibility for now
export type GizmoMode = 'translate' | 'rotate' | 'scale'; // Deprecated in favor of TransformMode
export type GlobalTransformPivot = 'origin' | 'modelCenter';

interface SelectionState {
    // New Mode System
    mainMode: AppMode;
    geometrySubMode: GeometrySubMode;
    animationSubMode: 'binding' | 'keyframe';
    timelineKeyframeDisplayMode: KeyframeDisplayMode;
    transformMode: TransformMode;
    multiMoveMode: 'relative' | 'worldUniform';
    selectedTextureAnimIndex: number | null;

    setMainMode: (mode: AppMode) => void;
    setGeometrySubMode: (mode: GeometrySubMode) => void;
    setAnimationSubMode: (mode: 'binding' | 'keyframe') => void;
    setTimelineKeyframeDisplayMode: (mode: KeyframeDisplayMode) => void;
    setTransformMode: (mode: TransformMode) => void;
    setMultiMoveMode: (mode: 'relative' | 'worldUniform') => void;
    setSelectedTextureAnimIndex: (index: number | null) => void;

    // Legacy (to be refactored)
    selectionMode: SelectionMode;
    selectedNodeIds: number[];
    selectedVertexIds: SelectionId[];
    selectedFaceIds: SelectionId[];

    // Mode
    setSelectionMode: (mode: SelectionMode) => void;

    gizmoMode: GizmoMode;
    setGizmoMode: (mode: GizmoMode) => void;

    // 节点选择
    selectNode: (id: number, multi?: boolean) => void;
    selectNodes: (ids: number[]) => void;
    clearNodeSelection: () => void;
    isNodeSelected: (id: number) => boolean;

    // 顶点选择
    selectVertex: (id: SelectionId, multi?: boolean) => void;
    selectVertices: (ids: SelectionId[]) => void;
    addVertexSelection: (ids: SelectionId[]) => void;
    removeVertexSelection: (ids: SelectionId[]) => void;
    clearVertexSelection: () => void;
    isVertexSelected: (id: SelectionId) => boolean;

    // 面选择
    selectFace: (id: SelectionId, multi?: boolean) => void;
    selectFaces: (ids: SelectionId[]) => void;
    addFaceSelection: (ids: SelectionId[]) => void;
    removeFaceSelection: (ids: SelectionId[]) => void;
    clearFaceSelection: () => void;
    isFaceSelected: (id: SelectionId) => boolean;

    // Picking Parent Mode
    isPickingParent: boolean;
    setIsPickingParent: (isPicking: boolean) => void;

    // Geoset Picking (Ctrl+Click in 3D view)
    pickedGeosetIndex: number | null;
    setPickedGeosetIndex: (index: number | null) => void;

    // Global Transform Toggle
    isGlobalTransformMode: boolean;
    setIsGlobalTransformMode: (isGlobal: boolean) => void;
    globalTransformPivot: GlobalTransformPivot;
    setGlobalTransformPivot: (pivot: GlobalTransformPivot) => void;

    // 清除所有选择
    clearAllSelections: () => void;
    reset: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
    // New Mode System Init
    mainMode: 'view',
    geometrySubMode: 'vertex',
    animationSubMode: 'binding',
    timelineKeyframeDisplayMode: 'node',
    transformMode: 'translate',
    multiMoveMode: 'relative',
    selectedTextureAnimIndex: null,

    setMainMode: (mode) => {
        set({ mainMode: mode });
        // Auto-switch legacy selectionMode for compatibility
        if (mode === 'geometry') {
            set({ selectionMode: get().geometrySubMode });
        } else {
            set({ selectionMode: 'object' });
        }
    },
    setGeometrySubMode: (mode) => {
        set({ geometrySubMode: mode });
        if (get().mainMode === 'geometry') {
            set({ selectionMode: mode });
        }
    },
    setAnimationSubMode: (mode) => {
        set({ animationSubMode: mode });
    },
    setTimelineKeyframeDisplayMode: (mode) => {
        set({ timelineKeyframeDisplayMode: mode });
    },
    setTransformMode: (mode) => {
        set({ transformMode: mode });
        if (mode) {
            set({ gizmoMode: mode });
        }
    },
    setMultiMoveMode: (mode) => {
        set({ multiMoveMode: mode });
    },
    setSelectedTextureAnimIndex: (index) => {
        set({ selectedTextureAnimIndex: index });
    },

    // Legacy Init
    selectionMode: 'object',
    selectedNodeIds: [],
    selectedVertexIds: [],
    selectedFaceIds: [],

    setSelectionMode: (mode) => {
        set({ selectionMode: mode });
    },

    gizmoMode: 'translate',
    setGizmoMode: (mode) => set({ gizmoMode: mode }),

    // 节点选择实现
    selectNode: (id, multi = false) => {
        set((state) => {
            if (multi) {
                // 多选模式：切换选择状态
                const isSelected = state.selectedNodeIds.includes(id);
                return {
                    selectedNodeIds: isSelected
                        ? state.selectedNodeIds.filter(nid => nid !== id)
                        : [...state.selectedNodeIds, id]
                };
            } else {
                // 单选模式
                return { selectedNodeIds: [id] };
            }
        });
    },

    selectNodes: (ids) => {
        set({ selectedNodeIds: ids });
    },

    clearNodeSelection: () => {
        set({ selectedNodeIds: [] });
    },

    isNodeSelected: (id) => {
        return get().selectedNodeIds.includes(id);
    },

    // 顶点选择实现
    selectVertex: (id, multi = false) => {
        set((state) => {
            if (multi) {
                const isSelected = state.selectedVertexIds.some(
                    v => v.geosetIndex === id.geosetIndex && v.index === id.index
                );
                return {
                    selectedVertexIds: isSelected
                        ? state.selectedVertexIds.filter(v => !(v.geosetIndex === id.geosetIndex && v.index === id.index))
                        : [...state.selectedVertexIds, id]
                };
            } else {
                return { selectedVertexIds: [id] };
            }
        });
    },

    selectVertices: (ids) => {
        set({ selectedVertexIds: ids });
    },

    addVertexSelection: (ids) => {
        set((state) => {
            const current = new Set(state.selectedVertexIds.map(v => `${v.geosetIndex}-${v.index}`));
            const newIds = ids.filter(v => !current.has(`${v.geosetIndex}-${v.index}`));
            return { selectedVertexIds: [...state.selectedVertexIds, ...newIds] };
        });
    },

    clearVertexSelection: () => {
        set({ selectedVertexIds: [] });
    },

    isVertexSelected: (id) => {
        return get().selectedVertexIds.some(
            v => v.geosetIndex === id.geosetIndex && v.index === id.index
        );
    },

    removeVertexSelection: (ids) => {
        set((state) => {
            const toRemove = new Set(ids.map(v => `${v.geosetIndex}-${v.index}`));
            return {
                selectedVertexIds: state.selectedVertexIds.filter(v => !toRemove.has(`${v.geosetIndex}-${v.index}`))
            };
        });
    },

    // 面选择实现
    selectFace: (id, multi = false) => {
        set((state) => {
            if (multi) {
                const isSelected = state.selectedFaceIds.some(
                    f => f.geosetIndex === id.geosetIndex && f.index === id.index
                );
                return {
                    selectedFaceIds: isSelected
                        ? state.selectedFaceIds.filter(f => !(f.geosetIndex === id.geosetIndex && f.index === id.index))
                        : [...state.selectedFaceIds, id]
                };
            } else {
                return { selectedFaceIds: [id] };
            }
        });
    },

    selectFaces: (ids) => {
        set({ selectedFaceIds: ids });
    },

    addFaceSelection: (ids) => {
        set((state) => {
            const current = new Set(state.selectedFaceIds.map(f => `${f.geosetIndex}-${f.index}`));
            const newIds = ids.filter(f => !current.has(`${f.geosetIndex}-${f.index}`));
            return { selectedFaceIds: [...state.selectedFaceIds, ...newIds] };
        });
    },

    removeFaceSelection: (ids) => {
        set((state) => {
            const toRemove = new Set(ids.map(f => `${f.geosetIndex}-${f.index}`));
            return {
                selectedFaceIds: state.selectedFaceIds.filter(f => !toRemove.has(`${f.geosetIndex}-${f.index}`))
            };
        });
    },

    clearFaceSelection: () => {
        set({ selectedFaceIds: [] });
    },

    isFaceSelected: (id) => {
        return get().selectedFaceIds.some(
            f => f.geosetIndex === id.geosetIndex && f.index === id.index
        );
    },

    // Picking Parent Mode
    isPickingParent: false,
    setIsPickingParent: (isPicking) => set({ isPickingParent: isPicking }),

    // Geoset Picking (Ctrl+Click in 3D view)
    pickedGeosetIndex: null,
    setPickedGeosetIndex: (index) => set({ pickedGeosetIndex: index }),

    // Global Transform Toggle
    isGlobalTransformMode: false,
    setIsGlobalTransformMode: (isGlobal) => set({ isGlobalTransformMode: isGlobal }),
    globalTransformPivot: 'origin',
    setGlobalTransformPivot: (pivot) => set({ globalTransformPivot: pivot }),

    // 清除所有选择
    clearAllSelections: () => {
        set({
            selectedNodeIds: [],
            selectedVertexIds: [],
            selectedFaceIds: [],
            isPickingParent: false,
            pickedGeosetIndex: null
        });
    },

    reset: () => {
        set({
            mainMode: 'view',
            geometrySubMode: 'vertex',
            animationSubMode: 'binding',
            timelineKeyframeDisplayMode: 'node',
            transformMode: 'translate',
            multiMoveMode: 'relative',
            selectedTextureAnimIndex: null,
            selectionMode: 'object',
            selectedNodeIds: [],
            selectedVertexIds: [],
            selectedFaceIds: [],
            gizmoMode: 'translate',
            isPickingParent: false,
            pickedGeosetIndex: null,
            isGlobalTransformMode: false,
            globalTransformPivot: 'origin'
        });
    }
}));
