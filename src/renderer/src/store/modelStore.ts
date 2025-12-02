/**
 * Model State Management using Zustand
 */

import { create } from 'zustand';
import { ModelData } from '../types/model';
import { ModelNode, NodeType } from '../types/node';

interface ModelState {
    modelData: ModelData | null;
    modelPath: string | null;
    nodes: ModelNode[];
    isLoading: boolean;
    clipboardNode: ModelNode | null;

    setModelData: (data: ModelData | null, path: string | null) => void;
    setLoading: (loading: boolean) => void;
    updateNode: (objectId: number, updates: Partial<ModelNode>) => void;
    addNode: (node: Partial<ModelNode> & { Name: string; type: NodeType }) => void;
    deleteNode: (objectId: number) => void;

    // New Actions
    setClipboardNode: (node: ModelNode | null) => void;
    pasteNode: (parentId: number) => void;
    moveNode: (nodeId: number, newParentId: number) => void;
    moveNodeTo: (nodeId: number, targetId: number, position: 'before' | 'after' | 'inside') => void;
    renameNode: (nodeId: number, newName: string) => void;

    getNodeById: (objectId: number) => ModelNode | undefined;
    getNodeChildren: (objectId: number) => ModelNode[];
    getAllNodes: () => ModelNode[];

    // Animation State
    sequences: any[];
    currentSequence: number;
    currentFrame: number;
    isPlaying: boolean;
    playbackSpeed: number;
    isLooping: boolean;

    // Animation Actions
    setSequences: (sequences: any[]) => void;
    setSequence: (index: number) => void;
    setFrame: (frame: number) => void;
    setPlaying: (playing: boolean) => void;
    setPlaybackSpeed: (speed: number) => void;
    setLooping: (looping: boolean) => void;
    setTextures: (textures: any[]) => void;
    setGeosets: (geosets: any[]) => void;
    setMaterials: (materials: any[]) => void;

    // Geometry Actions
    updateGeoset: (index: number, updates: any) => void;
    updateNodes: (updates: { objectId: number, data: Partial<ModelNode> }[]) => void;
}

/**
 * 从模型数据中提取所有节点
 */
function extractNodesFromModel(data: ModelData | null): ModelNode[] {
    if (!data) return [];

    const nodes: ModelNode[] = [];
    const d = data as any; // Allow access to potential plural properties

    // Helper to extract nodes from multiple potential keys
    const extract = (keys: string[], type: NodeType) => {
        keys.forEach(key => {
            if (d[key] && Array.isArray(d[key])) {
                d[key].forEach((item: any) => {
                    nodes.push({ ...item, type } as ModelNode);
                });
            }
        });
    };

    extract(['Bone', 'Bones'], NodeType.BONE);
    extract(['Helper', 'Helpers'], NodeType.HELPER);
    extract(['Attachment', 'Attachments'], NodeType.ATTACHMENT);
    extract(['Light', 'Lights'], NodeType.LIGHT);
    extract(['ParticleEmitter', 'ParticleEmitters'], NodeType.PARTICLE_EMITTER);

    // Special handling for ParticleEmitter2 to map properties
    const pe2Keys = ['ParticleEmitter2', 'ParticleEmitters2'];
    pe2Keys.forEach(key => {
        if (d[key] && Array.isArray(d[key])) {
            d[key].forEach((item: any) => {
                // Map raw parser data to ParticleEmitter2Node
                const node: any = { ...item, type: NodeType.PARTICLE_EMITTER_2 };

                // Map Arrays
                if (item.Alpha) node.SegmentAlpha = Array.from(item.Alpha);
                if (item.ParticleScaling) node.SegmentScaling = Array.from(item.ParticleScaling);
                if (item.SegmentColor) {
                    node.SegmentColor = item.SegmentColor.map((c: any) => Array.from(c));
                }

                // Map FrameFlags
                if (item.FrameFlags !== undefined) {
                    node.Head = (item.FrameFlags & 1) !== 0;
                    node.Tail = (item.FrameFlags & 2) !== 0;
                }

                // Map Flags
                if (item.Flags !== undefined) {
                    node.Unshaded = (item.Flags & 32768) !== 0;
                    node.SortPrimsFarZ = (item.Flags & 65536) !== 0;
                    node.LineEmitter = (item.Flags & 131072) !== 0;
                    node.Unfogged = (item.Flags & 262144) !== 0;
                    node.ModelSpace = (item.Flags & 524288) !== 0;
                    node.XYQuad = (item.Flags & 1048576) !== 0;
                    node.Squirt = (item.Flags & 256) !== 0; // Squirt is usually 0x100 (256) in Node flags, need to verify if it's different for PE2
                }

                nodes.push(node);
            });
        }
    });

    extract(['RibbonEmitter', 'RibbonEmitters'], NodeType.RIBBON_EMITTER);
    extract(['EventObject', 'EventObjects'], NodeType.EVENT_OBJECT);
    extract(['CollisionShape', 'CollisionShapes'], NodeType.COLLISION_SHAPE);
    extract(['Camera', 'Cameras'], NodeType.CAMERA);

    // Fallback: Check for a generic 'Nodes' array
    if (d.Nodes && Array.isArray(d.Nodes)) {
        d.Nodes.forEach((node: any) => {
            // Avoid duplicates if they were already added
            if (!nodes.find(n => n.ObjectId === node.ObjectId)) {
                // Try to infer type or default to Helper
                nodes.push({ ...node, type: node.type || NodeType.HELPER } as ModelNode);
            }
        });
    }

    console.log('[ModelStore] Extracted nodes:', nodes.length, 'from keys:', Object.keys(data));
    return nodes;
}

/**
 * 将节点更新回模型数据
 */
function updateModelDataWithNodes(
    modelData: ModelData | null,
    nodes: ModelNode[]
): ModelData | null {
    if (!modelData) return null;

    const updated = { ...modelData };

    // 按类型分组节点
    updated.Bone = nodes.filter(n => n.type === NodeType.BONE);
    updated.Helper = nodes.filter(n => n.type === NodeType.HELPER);
    updated.Attachment = nodes.filter(n => n.type === NodeType.ATTACHMENT);
    updated.Light = nodes.filter(n => n.type === NodeType.LIGHT);
    updated.ParticleEmitter = nodes.filter(n => n.type === NodeType.PARTICLE_EMITTER);
    updated.ParticleEmitter2 = nodes.filter(n => n.type === NodeType.PARTICLE_EMITTER_2);
    updated.RibbonEmitter = nodes.filter(n => n.type === NodeType.RIBBON_EMITTER);
    updated.EventObject = nodes.filter(n => n.type === NodeType.EVENT_OBJECT);
    updated.CollisionShape = nodes.filter(n => n.type === NodeType.COLLISION_SHAPE);
    updated.Camera = nodes.filter(n => n.type === NodeType.CAMERA);

    return updated;
}

export const useModelStore = create<ModelState>((set, get) => ({
    modelData: null,
    modelPath: null,
    nodes: [],
    isLoading: false,
    clipboardNode: null,

    // Animation State Initial Values
    sequences: [],
    currentSequence: -1,
    currentFrame: 0,
    isPlaying: true,
    playbackSpeed: 1.0,
    isLooping: true,

    setModelData: (data, path) => {
        const nodes = extractNodesFromModel(data);
        console.log('[ModelStore] Loaded model with', nodes.length, 'nodes');

        // Reset animation state on new model load
        set({
            modelData: data,
            modelPath: path,
            nodes,
            sequences: (data as any)?.Sequences || [],
            currentSequence: (data as any)?.Sequences?.length > 0 ? 0 : -1,
            currentFrame: 0,
            isPlaying: (data as any)?.Sequences?.length > 0
        });
    },

    setLoading: (loading) => {
        set({ isLoading: loading });
    },

    updateNode: (objectId, updates) => {
        set((state) => {
            const updatedNodes = state.nodes.map(node =>
                node.ObjectId === objectId ? { ...node, ...updates } : node
            );

            // 同时更新 modelData
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);

            console.log('[ModelStore] Updated node', objectId);
            return { nodes: updatedNodes, modelData: updatedModelData };
        });
    },

    addNode: (nodePartial) => {
        set((state) => {
            // 1. 生成新的 ObjectId
            // 1. 生成新的 ObjectId
            const maxObjectId = state.nodes.reduce((max, n) => {
                const id = typeof n.ObjectId === 'number' && !isNaN(n.ObjectId) ? n.ObjectId : -1;
                return Math.max(max, id);
            }, -1);
            const newObjectId = maxObjectId + 1;

            // 2. 创建完整节点对象
            const newNode: ModelNode = {
                ...nodePartial,
                ObjectId: newObjectId,
                // 如果没有指定 Parent，默认为 -1 (根节点)
                Parent: nodePartial.Parent ?? -1,
                // 设置默认属性
                Translation: {},
                Rotation: {},
                Scaling: {},
                Visibility: {},
            } as ModelNode;

            const updatedNodes = [...state.nodes, newNode];
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);

            console.log('[ModelStore] Added node', newNode.Name, 'with ObjectId', newNode.ObjectId);
            return { nodes: updatedNodes, modelData: updatedModelData };
        });
    },

    deleteNode: (objectId) => {
        set((state) => {
            const updatedNodes = state.nodes.filter(node => node.ObjectId !== objectId);
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);

            console.log('[ModelStore] Deleted node', objectId);
            return { nodes: updatedNodes, modelData: updatedModelData };
        });
    },

    setClipboardNode: (node) => {
        set({ clipboardNode: node });
    },

    pasteNode: (parentId) => {
        set((state) => {
            if (!state.clipboardNode) return {};

            // Generate new ObjectId
            const maxObjectId = state.nodes.reduce((max, n) => Math.max(max, n.ObjectId), -1);
            const newObjectId = maxObjectId + 1;

            // Clone node
            const newNode: ModelNode = {
                ...state.clipboardNode,
                ObjectId: newObjectId,
                Parent: parentId,
                Name: `${state.clipboardNode.Name}_Copy`
            };

            const updatedNodes = [...state.nodes, newNode];
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);

            console.log('[ModelStore] Pasted node', newNode.Name, 'to parent', parentId);
            return { nodes: updatedNodes, modelData: updatedModelData };
        });
    },

    moveNode: (nodeId, newParentId) => {
        // Deprecated, use moveNodeTo instead
        get().moveNodeTo(nodeId, newParentId, 'inside');
    },

    moveNodeTo: (nodeId: number, targetId: number, position: 'before' | 'after' | 'inside') => {
        set((state) => {
            // 1. Validation
            // Prevent circular reference: check if targetId is a child of nodeId
            let current = state.nodes.find(n => n.ObjectId === targetId);
            while (current) {
                if (current.ObjectId === nodeId) {
                    console.warn('[ModelStore] Cannot move node into its own child');
                    return {};
                }
                if (current.Parent === -1 || current.Parent === undefined) break;
                current = state.nodes.find(n => n.ObjectId === current?.Parent);
            }

            // 2. Determine new Parent and Index
            let newParentId = -1;
            let targetIndex = -1;
            const targetNode = state.nodes.find(n => n.ObjectId === targetId);

            if (position === 'inside') {
                newParentId = targetId;
                // Append to end of children
                targetIndex = state.nodes.length;
            } else {
                if (targetNode) {
                    newParentId = targetNode.Parent ?? -1;
                    targetIndex = state.nodes.findIndex(n => n.ObjectId === targetId);
                    if (position === 'after') targetIndex++;
                }
            }

            // 3. Reorder Nodes Array
            const nodeIndex = state.nodes.findIndex(n => n.ObjectId === nodeId);
            if (nodeIndex === -1) return {};

            const node = { ...state.nodes[nodeIndex], Parent: newParentId };
            const newNodes = [...state.nodes];

            // Remove from old position
            newNodes.splice(nodeIndex, 1);

            // Adjust targetIndex if removal affected it
            if (nodeIndex < targetIndex) {
                targetIndex--;
            }

            // Insert at new position
            // If targetIndex is out of bounds (e.g. appending), splice handles it or we push
            if (targetIndex >= newNodes.length) {
                newNodes.push(node);
            } else {
                newNodes.splice(targetIndex, 0, node);
            }

            // 4. Update Model Data
            const updatedModelData = updateModelDataWithNodes(state.modelData, newNodes);

            console.log(`[ModelStore] Moved node ${nodeId} ${position} ${targetId} (New Parent: ${newParentId})`);
            return { nodes: newNodes, modelData: updatedModelData };
        });
    },

    renameNode: (nodeId, newName) => {
        set((state) => {
            const updatedNodes = state.nodes.map(node =>
                node.ObjectId === nodeId ? { ...node, Name: newName } : node
            );
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);

            console.log('[ModelStore] Renamed node', nodeId, 'to', newName);
            return { nodes: updatedNodes, modelData: updatedModelData };
        });
    },

    getNodeById: (objectId) => {
        return get().nodes.find(node => node.ObjectId === objectId);
    },

    getNodeChildren: (objectId) => {
        return get().nodes.filter(node => node.Parent === objectId);
    },

    getAllNodes: () => {
        return get().nodes;
    },

    // Animation Actions Implementation
    setSequences: (sequences) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Sequences: sequences } : state.modelData;
        return { sequences, modelData: updatedModelData };
    }),
    setSequence: (index) => set({ currentSequence: index, currentFrame: 0 }), // Reset frame on sequence change
    setFrame: (frame) => set({ currentFrame: frame }),
    setPlaying: (playing) => set({ isPlaying: playing }),
    setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
    setLooping: (looping) => set({ isLooping: looping }),
    setTextures: (textures) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Textures: textures } : state.modelData;
        return { modelData: updatedModelData };
    }),
    setGeosets: (geosets) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Geosets: geosets } : state.modelData;
        return { modelData: updatedModelData };
    }),
    setMaterials: (materials) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Materials: materials } : state.modelData;
        return { modelData: updatedModelData };
    }),

    updateGeoset: (index, updates) => {
        set((state) => {
            if (!state.modelData || !state.modelData.Geosets) return {};

            const newGeosets = [...state.modelData.Geosets];
            if (index >= 0 && index < newGeosets.length) {
                newGeosets[index] = { ...newGeosets[index], ...updates };

                // Update modelData
                const updatedModelData = { ...state.modelData, Geosets: newGeosets };
                return { modelData: updatedModelData };
            }
            return {};
        });
    },

    updateNodes: (updates) => {
        set((state) => {
            let hasChanges = false;
            const updatedNodes = state.nodes.map(node => {
                const update = updates.find(u => u.objectId === node.ObjectId);
                if (update) {
                    hasChanges = true;
                    return { ...node, ...update.data };
                }
                return node;
            });

            if (!hasChanges) return {};

            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);
            console.log('[ModelStore] Batch updated', updates.length, 'nodes');
            return { nodes: updatedNodes, modelData: updatedModelData };
        });
    }
}));
