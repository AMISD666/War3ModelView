/**
 * UI State Management using Zustand
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EditMode, ToolMode } from '../types/store';

interface UIState {
    // ... (rest of interface remains same)
    // 窗口显示状态
    showNodeManager: boolean;
    showModelInfo: boolean;
    showVertexEditor: boolean;
    showFaceEditor: boolean;
    showNodeDialog: boolean;
    showCreateNodeDialog: boolean;

    // 侧边栏折叠状态
    leftSiderCollapsed: boolean;
    rightSiderCollapsed: boolean;

    // 编辑模式
    editMode: EditMode;
    toolMode: ToolMode;

    // 当前编辑的节点 ID（用于对话框）
    editingNodeId: number | null;

    // UI 切换方法
    toggleNodeManager: () => void;
    toggleModelInfo: () => void;
    toggleVertexEditor: () => void;
    toggleFaceEditor: () => void;
    setNodeDialogVisible: (visible: boolean, nodeId?: number) => void;
    setCreateNodeDialogVisible: (visible: boolean) => void;

    setLeftSiderCollapsed: (collapsed: boolean) => void;
    setRightSiderCollapsed: (collapsed: boolean) => void;

    setEditMode: (mode: EditMode) => void;
    setToolMode: (mode: ToolMode) => void;
    setShowNodeManager: (visible: boolean) => void;
}

export const useUIStore = create<UIState>()(
    persist(
        (set) => ({
            // 初始窗口状态 - 默认隐藏
            showNodeManager: false,
            showModelInfo: false,
            showVertexEditor: false,
            showFaceEditor: false,
            showNodeDialog: false,
            showCreateNodeDialog: false,

            // 初始侧边栏状态
            leftSiderCollapsed: false,
            rightSiderCollapsed: false,

            // 初始编辑模式
            editMode: EditMode.OBJECT,
            toolMode: ToolMode.SELECT,

            editingNodeId: null,

            // 切换方法实现
            toggleNodeManager: () => {
                set((state) => ({ showNodeManager: !state.showNodeManager }));
            },

            toggleModelInfo: () => {
                set((state) => ({ showModelInfo: !state.showModelInfo }));
            },

            toggleVertexEditor: () => {
                set((state) => ({ showVertexEditor: !state.showVertexEditor }));
            },

            toggleFaceEditor: () => {
                set((state) => ({ showFaceEditor: !state.showFaceEditor }));
            },

            setNodeDialogVisible: (visible, nodeId) => {
                set({ showNodeDialog: visible, editingNodeId: nodeId ?? null });
            },

            setCreateNodeDialogVisible: (visible) => {
                set({ showCreateNodeDialog: visible });
            },

            setLeftSiderCollapsed: (collapsed) => {
                set({ leftSiderCollapsed: collapsed });
            },

            setRightSiderCollapsed: (collapsed) => {
                set({ rightSiderCollapsed: collapsed });
            },

            setEditMode: (mode) => {
                set({ editMode: mode });
            },

            setToolMode: (mode) => {
                set({ toolMode: mode });
            },

            setShowNodeManager: (visible: boolean) => {
                set({ showNodeManager: visible });
            }
        }),
        {
            name: 'ui-storage', // name of the item in the storage (must be unique)
            partialize: (state) => ({
                showNodeManager: state.showNodeManager,
                leftSiderCollapsed: state.leftSiderCollapsed,
                rightSiderCollapsed: state.rightSiderCollapsed
            }),
        }
    )
);
