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

    // Renderer reload trigger - increment to force Viewer to reload
    rendererReloadTrigger: number;

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
    moveNodeWithChildren: (nodeId: number, targetId: number, position: 'before' | 'after' | 'inside') => void;
    reparentNodes: (nodeIds: number[], newParentId: number) => void;
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
    setTextureAnims: (anims: any[]) => void;

    // Geometry Actions
    updateGeoset: (index: number, updates: any) => void;
    updateGeosetAnim: (index: number, updates: any) => void;
    setGeosetAnims: (anims: any[]) => void;
    updateNodes: (updates: { objectId: number, data: Partial<ModelNode> }[]) => void;

    // Renderer reload
    triggerRendererReload: () => void;
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
    updated.Bones = nodes.filter(n => n.type === NodeType.BONE);
    updated.Helpers = nodes.filter(n => n.type === NodeType.HELPER);
    updated.Attachments = nodes.filter(n => n.type === NodeType.ATTACHMENT);
    updated.Lights = nodes.filter(n => n.type === NodeType.LIGHT);
    updated.ParticleEmitters = nodes.filter(n => n.type === NodeType.PARTICLE_EMITTER);
    updated.ParticleEmitters2 = nodes.filter(n => n.type === NodeType.PARTICLE_EMITTER_2);
    updated.RibbonEmitters = nodes.filter(n => n.type === NodeType.RIBBON_EMITTER);
    updated.EventObjects = nodes.filter(n => n.type === NodeType.EVENT_OBJECT);
    updated.CollisionShapes = nodes.filter(n => n.type === NodeType.COLLISION_SHAPE);
    updated.Cameras = nodes.filter(n => n.type === NodeType.CAMERA);

    // IMPORTANT: Reconstruct the master Nodes array for ModelRenderer
    // ModelRenderer/ModelInstance constructs the scene graph hierarchy from model.Nodes
    // If we don't update this, transforms (parenting) will be broken or stale!
    // We should sort by ObjectId to hopefully match the original index structure, 
    // although ObjectId isn't strictly index-bound, typical parsers produce sorted lists.
    updated.Nodes = [...nodes].sort((a, b) => a.ObjectId - b.ObjectId);

    // IMPORTANT: Reconstruct the PivotPoints array from node.PivotPoint properties
    // PivotPoints array is indexed by node position (same order as Nodes array)
    // The renderer uses model.Nodes[i].PivotPoint OR model.PivotPoints[i] 
    // We update both to ensure consistency
    (updated as any).PivotPoints = updated.Nodes.map(node =>
        node.PivotPoint || [0, 0, 0]
    );

    if (updated.ParticleEmitters2 && updated.ParticleEmitters2.length > 0) {
        // Log removed
    }

    return updated;
}

function getDefaultNodeProperties(type: NodeType): Partial<ModelNode> {
    switch (type) {
        case NodeType.PARTICLE_EMITTER_2:
            return {
                FilterMode: 0, // 0=Blend, 1=Additive, 2=Modulate, 3=Modulate2x, 4=AlphaKey
                TextureID: -1,
                EmissionRate: 10,
                LifeSpan: 1,

                Gravity: 0,
                Latitude: 0,
                Variation: 0,
                Speed: 10,
                Width: 10,
                Length: 10,
                Rows: 1,
                Columns: 1,

                TailLength: 0,
                Time: 0.5,
                // Use typed arrays matching parse.ts output
                SegmentColor: [
                    new Float32Array([1, 1, 1]),
                    new Float32Array([1, 1, 1]),
                    new Float32Array([1, 1, 1])
                ],
                Alpha: new Uint8Array([255, 255, 255]),
                ParticleScaling: new Float32Array([10, 10, 10]),
                LifeSpanUVAnim: new Uint32Array([0, 0, 1]),
                DecayUVAnim: new Uint32Array([0, 0, 1]),
                TailUVAnim: new Uint32Array([0, 0, 1]),
                TailDecayUVAnim: new Uint32Array([0, 0, 1]),
                Head: true,
                Tail: false,
                FrameFlags: 1, // 1=Head, 2=Tail, 3=Both - REQUIRED by renderer
                Unshaded: true,
                SortPrimsFarZ: true,
                LineEmitter: false,
                Unfogged: false,
                ModelSpace: false,
                XYQuad: false,
                Squirt: false,
                PriorityPlane: 0,
                ReplaceableId: 0,
                Visibility: 1,
                // Default rotation: rotate X-axis (War3 emission direction) to Z-axis (upward)
                // This makes new particles emit along Z-axis by default
                // Rotation: -90 degrees around Y-axis rotates X to Z
                // Quaternion (x,y,z,w): (0, sin(-45°), 0, cos(-45°)) = (0, -0.7071, 0, 0.7071)
                Rotation: {
                    Keys: [{ Frame: 0, Vector: [0, -0.7071067811865476, 0, 0.7071067811865476] }],
                    LineType: 0,
                    GlobalSeqId: null
                }
            };
        case NodeType.LIGHT:
            return {
                LightType: 0, // Omnidirectional
                AttenuationStart: 80,
                AttenuationEnd: 200,
                Color: [1, 1, 1],
                Intensity: 1,
                AmbientIntensity: 0,
                AmbientColor: [1, 1, 1]
            };
        default:
            return {};
    }
}

export const useModelStore = create<ModelState>((set, get) => ({
    modelData: null,
    modelPath: null,
    nodes: [],
    isLoading: false,
    clipboardNode: null,

    // Renderer reload trigger
    rendererReloadTrigger: 0,

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

            // Always trigger lightweight renderer sync for any node update
            // The sync is now lightweight (just updates internal arrays) so it's safe to do on every change
            console.log('[ModelStore] Updated node', objectId, 'triggering lightweight sync');
            return {
                nodes: updatedNodes,
                modelData: updatedModelData,
                // Always trigger lightweight sync on any node modification
                rendererReloadTrigger: state.rendererReloadTrigger + 1
            };
        });
    },

    addNode: (nodePartial) => {
        set((state) => {
            // 1. Generate new ObjectId
            const maxObjectId = state.nodes.reduce((max, n) => {
                const id = typeof n.ObjectId === 'number' && !isNaN(n.ObjectId) ? n.ObjectId : -1;
                return Math.max(max, id);
            }, -1);
            const newObjectId = maxObjectId + 1;

            // 2. Create complete node object with defaults
            const defaults = getDefaultNodeProperties(nodePartial.type);
            const newNode: ModelNode = {
                ...defaults,
                ...nodePartial,
                ObjectId: newObjectId,
                // If Parent is not specified, default to -1 (Root)
                Parent: nodePartial.Parent ?? -1,
                // PivotPoint is REQUIRED by war3-model renderer - it accesses PivotPoint[0]
                PivotPoint: nodePartial.PivotPoint || [0, 0, 0],
                // Use defaults for transform properties if not specified in nodePartial
                // This ensures default Rotation from getDefaultNodeProperties is preserved
                Translation: nodePartial.Translation ?? defaults.Translation,
                Rotation: nodePartial.Rotation ?? defaults.Rotation,
                Scaling: nodePartial.Scaling ?? defaults.Scaling,
                Visibility: nodePartial.Visibility ?? defaults.Visibility,
            } as ModelNode;

            const updatedNodes = [...state.nodes, newNode];
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);

            console.log('[ModelStore] Added node', newNode.Name, 'with ObjectId', newNode.ObjectId);

            // Trigger renderer data sync for particle emitters to enable real-time rendering
            const isParticleNode = nodePartial.type === NodeType.PARTICLE_EMITTER_2 ||
                nodePartial.type === NodeType.PARTICLE_EMITTER ||
                nodePartial.type === NodeType.RIBBON_EMITTER;

            return {
                nodes: updatedNodes,
                modelData: updatedModelData,
                // Increment rendererReloadTrigger when adding particle nodes
                rendererReloadTrigger: isParticleNode ? state.rendererReloadTrigger + 1 : state.rendererReloadTrigger
            };
        });
    },

    deleteNode: (objectId) => {
        set((state) => {
            // Find the node to be deleted to get its parent
            const nodeToDelete = state.nodes.find(n => n.ObjectId === objectId);
            const parentOfDeletedNode = nodeToDelete?.Parent ?? -1;

            // Update child nodes to inherit the deleted node's parent (grandparent)
            // This maintains the hierarchy structure: 1 → 2 → 3, delete 2 → 1 → 3
            const nodesWithUpdatedParents = state.nodes.map(node => {
                if (node.Parent === objectId) {
                    // Child of deleted node - inherit grandparent
                    return { ...node, Parent: parentOfDeletedNode };
                }
                return node;
            });

            // Filter out the deleted node
            const updatedNodes = nodesWithUpdatedParents.filter(node => node.ObjectId !== objectId);
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);

            const orphanedCount = state.nodes.filter(n => n.Parent === objectId).length;
            console.log('[ModelStore] Deleted node', objectId,
                '- re-parented', orphanedCount, 'children to parent', parentOfDeletedNode);
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

            // Clone node with proper defaults to avoid NaN issues
            const newNode: ModelNode = {
                ...state.clipboardNode,
                ObjectId: newObjectId,
                Parent: parentId,
                Name: `${state.clipboardNode.Name}_Copy`,
                // Ensure PivotPoint exists (required by war3-model renderer)
                PivotPoint: state.clipboardNode.PivotPoint || [0, 0, 0],
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

    moveNodeWithChildren: (nodeId: number, targetId: number, position: 'before' | 'after' | 'inside') => {
        set((state) => {
            // Helper function to get all descendants of a node
            const getAllDescendants = (parentId: number, allNodes: ModelNode[]): number[] => {
                const children = allNodes.filter(n => n.Parent === parentId);
                let descendants: number[] = [];
                for (const child of children) {
                    descendants.push(child.ObjectId);
                    descendants = descendants.concat(getAllDescendants(child.ObjectId, allNodes));
                }
                return descendants;
            };

            // 1. Validation - Prevent circular reference
            let current = state.nodes.find(n => n.ObjectId === targetId);
            while (current) {
                if (current.ObjectId === nodeId) {
                    console.warn('[ModelStore] Cannot move node into its own child');
                    return {};
                }
                if (current.Parent === -1 || current.Parent === undefined) break;
                current = state.nodes.find(n => n.ObjectId === current?.Parent);
            }

            // 2. Get all descendants of the node being moved
            const descendantIds = getAllDescendants(nodeId, state.nodes);
            const allMovingIds = [nodeId, ...descendantIds];

            // Prevent moving into own descendants
            if (allMovingIds.includes(targetId)) {
                console.warn('[ModelStore] Cannot move node into its own descendant');
                return {};
            }

            // 3. Determine new Parent for the root node
            let newParentId = -1;
            let targetIndex = -1;
            const targetNode = state.nodes.find(n => n.ObjectId === targetId);

            if (position === 'inside') {
                newParentId = targetId;
                targetIndex = state.nodes.length;
            } else {
                if (targetNode) {
                    newParentId = targetNode.Parent ?? -1;
                    targetIndex = state.nodes.findIndex(n => n.ObjectId === targetId);
                    if (position === 'after') targetIndex++;
                }
            }

            // 4. Build new nodes array
            // Remove all moving nodes from their current positions
            const remainingNodes = state.nodes.filter(n => !allMovingIds.includes(n.ObjectId));

            // Get the moving nodes with updated parent for root node only
            const movingNodes = state.nodes
                .filter(n => allMovingIds.includes(n.ObjectId))
                .map(n => n.ObjectId === nodeId ? { ...n, Parent: newParentId } : n);

            // Insert moving nodes at target position
            const newNodes = [...remainingNodes];
            const insertPosition = Math.min(targetIndex, newNodes.length);
            newNodes.splice(insertPosition, 0, ...movingNodes);

            // 5. Update Model Data
            const updatedModelData = updateModelDataWithNodes(state.modelData, newNodes);

            console.log(`[ModelStore] Moved node ${nodeId} with ${descendantIds.length} children ${position} ${targetId}`);
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

    reparentNodes: (nodeIds: number[], newParentId: number) => {
        set((state) => {
            // Helper: Get world position by walking up the parent chain
            const getWorldPosition = (node: ModelNode, allNodes: ModelNode[]): [number, number, number] => {
                const pos: [number, number, number] = [
                    node.PivotPoint?.[0] || 0,
                    node.PivotPoint?.[1] || 0,
                    node.PivotPoint?.[2] || 0
                ];
                let current = allNodes.find(n => n.ObjectId === node.Parent);
                while (current) {
                    pos[0] += current.PivotPoint?.[0] || 0;
                    pos[1] += current.PivotPoint?.[1] || 0;
                    pos[2] += current.PivotPoint?.[2] || 0;
                    if (current.Parent === -1 || current.Parent === undefined) break;
                    current = allNodes.find(n => n.ObjectId === current?.Parent);
                }
                return pos;
            };

            // Helper: Get all descendants of a node (for circular reference check)
            const getDescendants = (parentId: number, allNodes: ModelNode[]): number[] => {
                const children = allNodes.filter(n => n.Parent === parentId);
                let descendants: number[] = [];
                for (const child of children) {
                    descendants.push(child.ObjectId);
                    descendants = descendants.concat(getDescendants(child.ObjectId, allNodes));
                }
                return descendants;
            };

            // Validate: Check for circular references
            for (const nodeId of nodeIds) {
                if (nodeId === newParentId) {
                    console.warn('[ModelStore] Cannot reparent node to itself');
                    return {};
                }
                const descendants = getDescendants(nodeId, state.nodes);
                if (descendants.includes(newParentId)) {
                    console.warn('[ModelStore] Cannot reparent node to its own descendant');
                    return {};
                }
            }

            // Calculate new parent's world position
            let parentWorldPos: [number, number, number] = [0, 0, 0];
            if (newParentId !== -1) {
                const parentNode = state.nodes.find(n => n.ObjectId === newParentId);
                if (parentNode) {
                    parentWorldPos = getWorldPosition(parentNode, state.nodes);
                }
            }

            // Update each node
            const updatedNodes = state.nodes.map(node => {
                if (!nodeIds.includes(node.ObjectId)) {
                    return node;
                }

                // Get current world position
                const worldPos = getWorldPosition(node, state.nodes);

                // Calculate new local position (relative to new parent)
                const newPivotPoint: [number, number, number] = [
                    worldPos[0] - parentWorldPos[0],
                    worldPos[1] - parentWorldPos[1],
                    worldPos[2] - parentWorldPos[2]
                ];

                console.log(`[ModelStore] Reparenting node ${node.ObjectId} "${node.Name}": world=[${worldPos}], newLocal=[${newPivotPoint[0].toFixed(2)}, ${newPivotPoint[1].toFixed(2)}, ${newPivotPoint[2].toFixed(2)}]`);

                return {
                    ...node,
                    Parent: newParentId,
                    PivotPoint: newPivotPoint
                };
            });

            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes);
            console.log(`[ModelStore] Reparented ${nodeIds.length} nodes to parent ${newParentId}`);
            return { nodes: updatedNodes, modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
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
    // Animation Actions Implementation
    setSequences: (sequences) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Sequences: sequences } : state.modelData;
        return { sequences, modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),
    setSequence: (index) => set({ currentSequence: index, currentFrame: 0 }), // Reset frame on sequence change
    setFrame: (frame) => set({ currentFrame: frame }),
    setPlaying: (playing) => set({ isPlaying: playing }),
    setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
    setLooping: (looping) => set({ isLooping: looping }),
    setTextures: (textures) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Textures: textures } : state.modelData;
        return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),
    setGeosets: (geosets) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Geosets: geosets } : state.modelData;
        return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),
    setMaterials: (materials) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Materials: materials } : state.modelData;
        return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),
    setTextureAnims: (anims) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, TextureAnims: anims } : state.modelData;
        return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
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

    updateGeosetAnim: (index: number, updates: any) => {
        set((state) => {
            if (!state.modelData || !state.modelData.GeosetAnims) return {};

            const newGeosetAnims = [...state.modelData.GeosetAnims];
            if (index >= 0 && index < newGeosetAnims.length) {
                newGeosetAnims[index] = { ...newGeosetAnims[index], ...updates };

                // Update modelData
                const updatedModelData = { ...state.modelData, GeosetAnims: newGeosetAnims };
                return { modelData: updatedModelData };
            }
            return {};
        });
    },

    setGeosetAnims: (anims: any[]) => {
        set((state) => {
            if (!state.modelData) return {};
            const updatedModelData = { ...state.modelData, GeosetAnims: anims };
            return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
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
    },

    triggerRendererReload: () => {
        set((state) => ({
            rendererReloadTrigger: state.rendererReloadTrigger + 1
        }));
        console.log('[ModelStore] Triggered renderer reload');
    }
}));
