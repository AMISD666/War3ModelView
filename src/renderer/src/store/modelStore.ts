/**
 * Model State Management using Zustand
 */

import { create } from 'zustand';
import { mat4, vec3, mat3 } from 'gl-matrix';
import { ModelData } from '../types/model';
import { ModelNode, NodeType } from '../types/node';
import { Tab, TabSnapshot } from '../types/store';
import { useRendererStore } from './rendererStore';
import { processDeathAnimation, processRemoveLights, pruneModelKeyframes } from '../utils/modelUtils';
import { calculateModelExtent, calculateModelNormals } from '../utils/geometryUtils';

const MAX_CACHED_RENDERERS = 5;

type ClipboardPayload = {
    node: ModelNode;
    sourceModelPath: string | null;
    // Sparse maps: oldIndex -> resource object from the source model.
    textures?: Record<number, any>;
    materials?: Record<number, any>;
    textureAnims?: Record<number, any>;
};

const pickDefaultSequenceIndex = (sequences: any[]) => {
    if (!Array.isArray(sequences) || sequences.length === 0) return -1;
    const standRegex = /stand/i;
    const standIndex = sequences.findIndex((seq) => {
        const name = (seq?.Name ?? seq?.name ?? '').toString();
        return standRegex.test(name);
    });
    return standIndex >= 0 ? standIndex : 0;
};


// DELETED legacy recalculateModelNormals and associated local functions.
// These are now unified in src/utils/geometryUtils.ts

function deepClone<T>(value: T): T {
    const sc = (globalThis as any).structuredClone;
    if (typeof sc === 'function') return sc(value);
    return JSON.parse(JSON.stringify(value));
}

function collectTextureIdsFromAnimVector(value: any, ids: Set<number>): void {
    if (value === undefined || value === null) return;
    if (typeof value === 'number') {
        if (value >= 0) ids.add(value);
        return;
    }
    if (value && typeof value === 'object' && Array.isArray(value.Keys)) {
        for (const key of value.Keys) {
            const v = key?.Vector;
            const id = ArrayBuffer.isView(v) ? v[0] : (Array.isArray(v) ? v[0] : undefined);
            if (typeof id === 'number' && id >= 0) ids.add(id);
        }
    }
}

function remapTextureRef(value: any, oldToNew: Map<number, number>): any {
    if (value === undefined || value === null) return value;
    if (typeof value === 'number') {
        return oldToNew.has(value) ? oldToNew.get(value)! : value;
    }
    if (value && typeof value === 'object' && Array.isArray(value.Keys)) {
        for (const key of value.Keys) {
            const vec = key?.Vector;
            const oldId = ArrayBuffer.isView(vec) ? vec[0] : (Array.isArray(vec) ? vec[0] : undefined);
            if (typeof oldId === 'number' && oldToNew.has(oldId)) {
                const newId = oldToNew.get(oldId)!;
                if (ArrayBuffer.isView(vec)) {
                    vec[0] = newId;
                } else if (Array.isArray(vec)) {
                    vec[0] = newId;
                }
            }
        }
        return value;
    }
    return value;
}

function findExistingTextureIndex(textures: any[], tex: any): number {
    if (!Array.isArray(textures)) return -1;
    const image = tex?.Image ?? tex?.image;
    const replaceableId = tex?.ReplaceableId ?? tex?.replaceableId;
    const wrapW = tex?.WrapWidth ?? tex?.wrapWidth;
    const wrapH = tex?.WrapHeight ?? tex?.wrapHeight;
    const flags = tex?.Flags ?? tex?.flags;

    for (let i = 0; i < textures.length; i++) {
        const t = textures[i];
        if (!t) continue;
        const tImage = t?.Image ?? t?.image;
        const tReplaceableId = t?.ReplaceableId ?? t?.replaceableId;
        const tWrapW = t?.WrapWidth ?? t?.wrapWidth;
        const tWrapH = t?.WrapHeight ?? t?.wrapHeight;
        const tFlags = t?.Flags ?? t?.flags;
        if (
            tImage === image &&
            tReplaceableId === replaceableId &&
            tWrapW === wrapW &&
            tWrapH === wrapH &&
            tFlags === flags
        ) {
            return i;
        }
    }
    return -1;
}

interface ModelState {
    modelData: ModelData | null;
    modelPath: string | null;
    nodes: ModelNode[];
    isLoading: boolean;
    clipboardNode: ModelNode | null;
    clipboardPayload: ClipboardPayload | null;

    // Cached renderer for the current active tab
    cachedRenderer: any | null;

    // Renderer reload trigger - increment to force Viewer to reload
    rendererReloadTrigger: number;

    // Geoset Visibility State
    hiddenGeosetIds: number[];
    forceShowAllGeosets: boolean;
    hoveredGeosetId: number | null;
    selectedGeosetIndex: number | null;  // Persistent selection for sync with managers
    selectedGeosetIndices: number[];

    // Global Preview Transform (unbaked gizmo state)
    previewTransform: {
        translation: [number, number, number],
        rotation: [number, number, number],
        scale: [number, number, number]
    };
    setPreviewTransform: (transform: Partial<ModelState['previewTransform']>) => void;
    resetPreviewTransform: () => void;
    reset: () => void;

    setModelData: (data: ModelData | null, path: string | null) => void;
    setLoading: (loading: boolean) => void;
    updateNode: (objectId: number, updates: Partial<ModelNode>) => void;
    // 静默更新节点 - 不触发 renderer reload（用于关键帧编辑等高频更新）
    updateNodeSilent: (objectId: number, updates: Partial<ModelNode>) => void;
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
    autoKeyframe: boolean;

    // Animation Actions
    setSequences: (sequences: any[]) => void;
    setSequence: (index: number) => void;
    setFrame: (frame: number) => void;
    setPlaying: (playing: boolean) => void;
    setPlaybackSpeed: (speed: number) => void;
    setLooping: (looping: boolean) => void;
    setAutoKeyframe: (enabled: boolean) => void;
    updateSequence: (index: number, updates: any) => void; // New action
    shiftSequenceDuration: (index: number, newDurationMs: number) => void;
    setTextures: (textures: any[]) => void;
    setGeosets: (geosets: any[]) => void;
    setMaterials: (materials: any[]) => void;
    setTextureAnims: (anims: any[]) => void;
    addTextureAnim: () => void;
    removeTextureAnim: (index: number) => void;
    updateTextureAnim: (index: number, updates: any) => void;

    // Geometry Actions
    updateGeoset: (index: number, updates: any) => void;
    updateGeosetAnim: (index: number, updates: any) => void;
    setGeosetAnims: (anims: any[]) => void;
    updateNodes: (updates: { objectId: number, data: Partial<ModelNode> }[]) => void;
    replaceNodes: (nodes: ModelNode[], options?: { triggerReload?: boolean }) => void;

    // Recalculate Actions
    recalculateNormals: () => void;
    repairModel: () => void;
    addDeathAnimation: () => void;
    removeLights: () => void;
    transformModel: (ops: {
        translation?: [number, number, number],
        rotation?: [number, number, number],
        scale?: [number, number, number],
        skipAnimationTracks?: boolean,
        suppressReload?: boolean
    }) => void;

    // Renderer reload
    triggerRendererReload: () => void;

    // Geoset Visibility Actions
    toggleGeosetVisibility: (geosetId: number) => void;
    setForceShowAllGeosets: (show: boolean) => void;
    setHoveredGeosetId: (id: number | null) => void;
    setSelectedGeosetIndex: (index: number | null) => void;
    setSelectedGeosetIndices: (indices: number[]) => void;
    setHiddenGeosetIds: (ids: number[]) => void;
    resetGeosetVisibility: () => void;
    removeSequence: (index: number, pruneKeyframes?: boolean) => void;

    // Tab Management
    tabs: Tab[];
    activeTabId: string | null;
    cameraStateRef: React.MutableRefObject<{ distance: number; theta: number; phi: number; target: [number, number, number] } | null> | null;
    setCameraStateRef: (ref: React.MutableRefObject<{ distance: number; theta: number; phi: number; target: [number, number, number] } | null> | null) => void;
    addTab: (path: string, modelData?: ModelData | null) => boolean;
    closeTab: (tabId: string) => void;
    setActiveTab: (tabId: string) => void;
    getModelDataForSave: (forceReorder?: boolean) => ModelData | null;
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
                    const node: any = { ...item, type };

                    // Extract Billboard flags from Flags bitfield into boolean properties
                    // NodeFlags: Billboarded=8, BillboardedLockX=16, BillboardedLockY=32, BillboardedLockZ=64, CameraAnchored=128
                    if (item.Flags !== undefined) {
                        node.Billboarded = (item.Flags & 8) !== 0;
                        node.BillboardedLockX = (item.Flags & 16) !== 0;
                        node.BillboardedLockY = (item.Flags & 32) !== 0;
                        node.BillboardedLockZ = (item.Flags & 64) !== 0;
                        node.CameraAnchored = (item.Flags & 128) !== 0;

                        // Extract DontInherit flags (NodeFlags: 1/2/4)
                        node.DontInherit = {
                            Translation: (item.Flags & 1) !== 0,  // DontInheritTranslation
                            Rotation: (item.Flags & 2) !== 0,     // DontInheritRotation
                            Scaling: (item.Flags & 4) !== 0       // DontInheritScaling
                        };
                    }

                    nodes.push(node as ModelNode);
                });
            }
        });
    };

    extract(['Bone', 'Bones'], NodeType.BONE);
    extract(['Helper', 'Helpers'], NodeType.HELPER);
    extract(['Attachment', 'Attachments'], NodeType.ATTACHMENT);

    // Special handling for Light nodes to map war3-model naming to our UI naming
    const lightKeys = ['Light', 'Lights'];
    lightKeys.forEach(key => {
        if (d[key] && Array.isArray(d[key])) {
            d[key].forEach((item: any) => {
                const node: any = { ...item, type: NodeType.LIGHT };

                // Map war3-model naming to our UI naming
                // AmbColor -> AmbientColor
                if (item.AmbColor !== undefined) {
                    node.AmbientColor = item.AmbColor instanceof Float32Array
                        ? Array.from(item.AmbColor)
                        : item.AmbColor;
                }
                // AmbIntensity -> AmbientIntensity
                if (item.AmbIntensity !== undefined) {
                    node.AmbientIntensity = item.AmbIntensity;
                }
                // Color - convert Float32Array to array for UI
                if (item.Color instanceof Float32Array) {
                    node.Color = Array.from(item.Color);
                }

                nodes.push(node as ModelNode);
            });
        }
    });

    extract(['ParticleEmitter', 'ParticleEmitters'], NodeType.PARTICLE_EMITTER);

    // Special handling for ParticleEmitter2 to map properties
    const pe2Keys = ['ParticleEmitter2', 'ParticleEmitters2'];
    pe2Keys.forEach(key => {
        if (d[key] && Array.isArray(d[key])) {
            d[key].forEach((item: any) => {
                // Map raw parser data to ParticleEmitter2Node
                const node: any = { ...item, type: NodeType.PARTICLE_EMITTER_2 };

                // Map Arrays
                // Fix: extract into ParticleEmitter2Node property names
                if (item.Alpha) node.Alpha = Array.from(item.Alpha);
                if (item.ParticleScaling) node.ParticleScaling = Array.from(item.ParticleScaling);
                if (item.SegmentColor) {
                    node.SegmentColor = item.SegmentColor.map((c: any) => Array.from(c));
                }

                // Convert UV animation TypedArrays to regular arrays for UI
                // These are Uint32Array(3) [start, end, repeat] in parsed MDX
                if (item.LifeSpanUVAnim) {
                    node.LifeSpanUVAnim = Array.from(item.LifeSpanUVAnim);
                }
                if (item.DecayUVAnim) {
                    node.DecayUVAnim = Array.from(item.DecayUVAnim);
                }
                if (item.TailUVAnim) {
                    node.TailUVAnim = Array.from(item.TailUVAnim);
                }
                if (item.TailDecayUVAnim) {
                    node.TailDecayUVAnim = Array.from(item.TailDecayUVAnim);
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
                }
                // Fix: Squirt is a separate boolean property in the library object for PE2
                node.Squirt = !!item.Squirt;

                nodes.push(node);
            });
        }
    });

    // Special handling for RibbonEmitter to convert Color Float32Array
    const ribbonKeys = ['RibbonEmitter', 'RibbonEmitters'];
    ribbonKeys.forEach(key => {
        if (d[key] && Array.isArray(d[key])) {
            d[key].forEach((item: any) => {
                const node: any = { ...item, type: NodeType.RIBBON_EMITTER };

                // Color - convert Float32Array to array for UI
                if (item.Color instanceof Float32Array) {
                    node.Color = Array.from(item.Color);
                    console.log('[ModelStore] RibbonEmitter Color converted:', node.Color);
                } else if (Array.isArray(item.Color)) {
                    node.Color = item.Color;
                }

                nodes.push(node as ModelNode);
            });
        }
    });
    extract(['EventObject', 'EventObjects'], NodeType.EVENT_OBJECT);
    extract(['CollisionShape', 'CollisionShapes'], NodeType.COLLISION_SHAPE);
    extract(['ParticleEmitterPopcorn', 'ParticleEmitterPopcorns'], NodeType.PARTICLE_EMITTER_POPCORN);
    extract(['Camera', 'Cameras'], NodeType.CAMERA);

    // Fallback: Check for a generic 'Nodes' array to ensure NO data loss
    if (d.Nodes && Array.isArray(d.Nodes)) {
        d.Nodes.forEach((node: any) => {
            // Avoid duplicates if they were already added from specific arrays
            if (!nodes.find(n => n.ObjectId === node.ObjectId)) {
                // Try to infer type or default to Helper
                const type = node.type || NodeType.HELPER;
                nodes.push({ ...node, type } as ModelNode);
                console.log(`[ModelStore] Recovered node ID=${node.ObjectId} from Nodes array (Type=${type})`);
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
    nodes: ModelNode[],
    reorderIds: boolean = true
): ModelData | null {
    if (!modelData) return null;

    const updated = { ...modelData };

    // Reconstruct Flags from boolean properties before processing
    const modelPivotPoints = (modelData as any).PivotPoints;
    const nodesWithFlags = nodes.map(node => {
        const n = node as any;
        const pivotPoint = node.PivotPoint
            ?? (typeof node.ObjectId === 'number' ? modelPivotPoints?.[node.ObjectId] : undefined)
            ?? [0, 0, 0];
        const baseFlags = typeof n.Flags === 'number' ? n.Flags : 0;
        let flags = baseFlags;

        // Clear and reset billboard/inherit flags (NodeFlags: 1/2/4/8/16/32/64/128)
        flags &= ~(1 | 2 | 4 | 8 | 16 | 32 | 64 | 128);

        // For ParticleEmitter2, also clear its specific flags before re-syncing
        if (node.type === NodeType.PARTICLE_EMITTER_2) {
            flags &= ~(32768 | 65536 | 131072 | 262144 | 524288 | 1048576);
        }

        if (n.Billboarded) flags |= 8;
        if (n.BillboardedLockX) flags |= 16;
        if (n.BillboardedLockY) flags |= 32;
        if (n.BillboardedLockZ) flags |= 64;
        if (n.CameraAnchored) flags |= 128;
        if (n.DontInherit?.Translation) flags |= 1;
        if (n.DontInherit?.Rotation) flags |= 2;
        if (n.DontInherit?.Scaling) flags |= 4;

        // ParticleEmitter2 specific flags reconstruction
        if (node.type === NodeType.PARTICLE_EMITTER_2) {
            // Rendering Flags
            const applyParticleFlag = (prop: string, bit: number) => {
                if (n[prop] === true) {
                    flags |= bit;
                } else if (n[prop] === false) {
                    // Explicitly cleared
                } else if (baseFlags & bit) {
                    flags |= bit;
                }
            };

            applyParticleFlag('Unshaded', 32768);
            applyParticleFlag('SortPrimsFarZ', 65536);
            applyParticleFlag('LineEmitter', 131072);
            applyParticleFlag('Unfogged', 262144);
            applyParticleFlag('ModelSpace', 524288);
            applyParticleFlag('XYQuad', 1048576);

            // Reconstruct FrameFlags from Head/Tail booleans
            const baseFrameFlags = typeof n.FrameFlags === 'number' ? n.FrameFlags : 0;
            let frameFlags = baseFrameFlags;
            if (n.Head === true) {
                frameFlags |= 1;
            } else if (n.Head === false) {
                frameFlags &= ~1;
            }
            if (n.Tail === true) {
                frameFlags |= 2;
            } else if (n.Tail === false) {
                frameFlags &= ~2;
            }

            // Format arrays for war3-model library
            const formattedNode = { ...node, Flags: flags, FrameFlags: frameFlags } as any;

            if (n.SegmentColor) {
                formattedNode.SegmentColor = n.SegmentColor.map((c: any) => new Float32Array(c));
            }
            if (n.Alpha) {
                formattedNode.Alpha = new Uint8Array(n.Alpha);
            }
            if (n.ParticleScaling) {
                formattedNode.ParticleScaling = new Float32Array(n.ParticleScaling);
            }

            // UV Animations
            if (n.LifeSpanUVAnim) formattedNode.LifeSpanUVAnim = new Uint32Array(n.LifeSpanUVAnim);
            if (n.DecayUVAnim) formattedNode.DecayUVAnim = new Uint32Array(n.DecayUVAnim);
            if (n.TailUVAnim) formattedNode.TailUVAnim = new Uint32Array(n.TailUVAnim);
            if (n.TailDecayUVAnim) formattedNode.TailDecayUVAnim = new Uint32Array(n.TailDecayUVAnim);

            return { ...formattedNode, PivotPoint: pivotPoint };
        }

        return { ...node, PivotPoint: pivotPoint, Flags: flags };
    });

    // CRITICAL: WC3 expects nodes in a specific type order for ObjectId assignment
    // Order: Bones → Lights → Helpers → Attachments → ParticleEmitters → ParticleEmitters2 
    //        → RibbonEmitters → EventObjects → CollisionShapes
    // Camera nodes do NOT have ObjectId and are handled separately

    const cameras = nodesWithFlags.filter(n => n.type === NodeType.CAMERA);

    let orderedNodes: ModelNode[];
    const oldToNewId = new Map<number, number>();

    if (reorderIds) {
        // Filter nodes by type (excluding Camera)
        const bones = nodesWithFlags.filter(n => n.type === NodeType.BONE);
        const lights = nodesWithFlags.filter(n => n.type === NodeType.LIGHT);
        const helpers = nodesWithFlags.filter(n => n.type === NodeType.HELPER);
        const attachments = nodesWithFlags.filter(n => n.type === NodeType.ATTACHMENT);
        const particleEmitters = nodesWithFlags.filter(n => n.type === NodeType.PARTICLE_EMITTER);
        const particleEmitters2 = nodesWithFlags.filter(n => n.type === NodeType.PARTICLE_EMITTER_2);
        const ribbonEmitters = nodesWithFlags.filter(n => n.type === NodeType.RIBBON_EMITTER);
        const eventObjects = nodesWithFlags.filter(n => n.type === NodeType.EVENT_OBJECT);
        const collisionShapes = nodesWithFlags.filter(n => n.type === NodeType.COLLISION_SHAPE);
        const popcornEmitters = nodesWithFlags.filter(n => n.type === NodeType.PARTICLE_EMITTER_POPCORN);

        // Safety: catch any nodes that might have been missed by type filtering
        const processedSet = new Set([
            ...bones, ...lights, ...helpers, ...attachments,
            ...particleEmitters, ...particleEmitters2, ...popcornEmitters,
            ...ribbonEmitters, ...eventObjects, ...collisionShapes
        ]);
        const remaining = nodesWithFlags.filter(n => n.type !== NodeType.CAMERA && !processedSet.has(n));

        // Concatenate in WC3 order (excluding Camera)
        orderedNodes = [
            ...bones,
            ...lights,
            ...helpers,
            ...attachments,
            ...particleEmitters,
            ...particleEmitters2,
            ...popcornEmitters,
            ...ribbonEmitters,
            ...eventObjects,
            ...collisionShapes,
            ...remaining
        ];

        // Build old→new ObjectId mapping and reassign ObjectIds
        orderedNodes.forEach((node, index) => {
            const oldId = node.ObjectId;
            const newId = index;
            if (oldId !== newId) {
                oldToNewId.set(oldId, newId);
            }
            node.ObjectId = newId;
        });
    } else {
        // Prepare nodes for saving without reordering 
        // We filter out Cameras (no ID) and sort the rest by their EXISTING ObjectId
        orderedNodes = nodesWithFlags
            .filter(n => n.type !== NodeType.CAMERA)
            .sort((a, b) => a.ObjectId - b.ObjectId);
    }


    // Update all Parent references to use new ObjectIds (Only if reordered)
    if (reorderIds && oldToNewId.size > 0) {
        orderedNodes.forEach(node => {
            if (node.Parent !== null && node.Parent !== undefined && node.Parent >= 0) {
                const newParentId = oldToNewId.get(node.Parent);
                if (newParentId !== undefined) {
                    node.Parent = newParentId;
                }
            }
        });
        console.log('[ModelStore] Reassigned ObjectIds for', oldToNewId.size, 'nodes to match WC3 type order');
    }

    // Update type-specific arrays with reassigned/ordered nodes
    updated.Bones = orderedNodes.filter(n => n.type === NodeType.BONE);
    updated.Lights = orderedNodes.filter(n => n.type === NodeType.LIGHT);
    updated.Helpers = orderedNodes.filter(n => n.type === NodeType.HELPER);
    updated.Attachments = orderedNodes.filter(n => n.type === NodeType.ATTACHMENT);
    updated.ParticleEmitters = orderedNodes.filter(n => n.type === NodeType.PARTICLE_EMITTER);
    updated.ParticleEmitters2 = orderedNodes.filter(n => n.type === NodeType.PARTICLE_EMITTER_2);
    updated.RibbonEmitters = orderedNodes.filter(n => n.type === NodeType.RIBBON_EMITTER);
    updated.EventObjects = orderedNodes.filter(n => n.type === NodeType.EVENT_OBJECT);
    updated.CollisionShapes = orderedNodes.filter(n => n.type === NodeType.COLLISION_SHAPE);
    (updated as any).ParticleEmitterPopcorns = orderedNodes.filter(n => n.type === NodeType.PARTICLE_EMITTER_POPCORN);
    updated.Cameras = cameras; // Camera nodes don't have ObjectId

    // Set the master Nodes array (sorted by new ObjectId)
    updated.Nodes = [...orderedNodes].sort((a, b) => a.ObjectId - b.ObjectId);

    // Rebuild PivotPoints array indexed by new ObjectId
    const maxObjectId = orderedNodes.length > 0 ? orderedNodes[orderedNodes.length - 1].ObjectId : -1;
    const pivotPoints: (Float32Array | [number, number, number])[] = []; // Sparse array

    for (const node of orderedNodes) {
        pivotPoints[node.ObjectId] = node.PivotPoint || [0, 0, 0];
    }
    // Fill any holes 
    for (let i = 0; i <= maxObjectId; i++) {
        if (!pivotPoints[i]) {
            pivotPoints[i] = [0, 0, 0];
        }
    }
    (updated as any).PivotPoints = pivotPoints;

    // CRITICAL FIX: Update Geoset Groups references to match new ObjectIds
    // When nodes are reordered and ObjectIds change, the bone indices in Geoset.Groups
    // must be updated, otherwise vertices will be skinned to the wrong bones (or lights/helpers!)
    // ONLY DO THIS IF WE REORDERED
    if (reorderIds && oldToNewId.size > 0 && updated.Geosets) {
        let updatedGroupsCount = 0;
        updated.Geosets.forEach(geoset => {
            if (geoset.Groups) {
                // Groups is number[][], representing matrix groups for vertex skinning
                for (let i = 0; i < geoset.Groups.length; i++) {
                    const group = geoset.Groups[i] as any;

                    // Handle both number[] (war3-model) and {matrices: number[]} (War3ModelView types)
                    const matrices = Array.isArray(group) ? group : (group.matrices || []);

                    for (let j = 0; j < matrices.length; j++) {
                        const oldBoneId = matrices[j];
                        const newBoneId = oldToNewId.get(oldBoneId);
                        if (newBoneId !== undefined) {
                            matrices[j] = newBoneId;
                            updatedGroupsCount++;
                        }
                    }
                }
            }
        });
        if (updatedGroupsCount > 0) {
            console.log('[ModelStore] Updated', updatedGroupsCount, 'bone references in Geoset Groups');
        }
    }

    return updated;
}

function needsReorderForSave(data: any): boolean {
    if (!data) return false;

    const allNodeArrays = [
        ...(data.Bones || []),
        ...(data.Lights || []),
        ...(data.Helpers || []),
        ...(data.Attachments || []),
        ...(data.ParticleEmitters || []),
        ...(data.ParticleEmitters2 || []),
        ...(data.RibbonEmitters || []),
        ...(data.EventObjects || []),
        ...(data.CollisionShapes || []),
        ...(data.ParticleEmitterPopcorns || [])
    ];

    if (allNodeArrays.length === 0) return false;

    const ids = allNodeArrays.map((n: any) => n?.ObjectId).filter((id: any) => typeof id === 'number');
    if (ids.length !== allNodeArrays.length) return true;

    const unique = new Set(ids);
    if (unique.size !== ids.length) return true;

    const sorted = [...unique].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] !== i) return true;
    }

    const validIds = new Set(sorted);
    validIds.add(-1);
    for (const node of allNodeArrays) {
        if (node.Parent !== undefined && node.Parent !== null && !validIds.has(node.Parent)) {
            return true;
        }
    }

    const expectedPivotCount = sorted.length > 0 ? sorted[sorted.length - 1] + 1 : 0;
    const actualPivotCount = data.PivotPoints?.length || 0;
    if (actualPivotCount !== expectedPivotCount) return true;

    return false;
}

function getDefaultNodeProperties(type: NodeType): Partial<ModelNode> {
    switch (type) {
        case NodeType.PARTICLE_EMITTER:
            return {
                // war3-model expects these property names for ParticleEmitter (type 1)
                Flags: 0,
                Path: '',
                FileName: '',
                EmissionRate: 10,
                LifeSpan: 1,
                InitVelocity: 0,
                Gravity: 0,
                Longitude: 0,
                Latitude: 0,
                Visibility: 1
            } as any;
        case NodeType.RIBBON_EMITTER:
            return {
                HeightAbove: 10,
                HeightBelow: 10,
                Alpha: 1,
                Color: [1, 1, 1],
                LifeSpan: 1,
                TextureSlot: 0,
                EmissionRate: 10,
                Rows: 1,
                Columns: 1,
                MaterialID: 0,
                Gravity: 0,
                Visibility: 1
            };
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
                    [1, 1, 1],
                    [1, 1, 1],
                    [1, 1, 1]
                ],
                Alpha: [255, 255, 255],
                ParticleScaling: [10, 10, 10],
                LifeSpanUVAnim: [0, 0, 1],
                DecayUVAnim: [0, 0, 1],
                TailUVAnim: [0, 0, 1],
                TailDecayUVAnim: [0, 0, 1],
                Head: true,
                Tail: false,
                // @ts-ignore
                FrameFlags: 1, // 1=Head, 2=Tail, 3=Both - REQUIRED by renderer
                Unshaded: true,
                SortPrimsFarZ: false,
                LineEmitter: false,
                Unfogged: false,
                ModelSpace: false,
                XYQuad: false,
                Squirt: false,
                PriorityPlane: 0,
                ReplaceableId: 0,
                Visibility: 1
                // No default Rotation - particles.ts already emits along Z-axis (line 1011)
                // Adding rotation here can cause issues when animation state affects interpolation
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
        case NodeType.ATTACHMENT:
            return {
                AttachmentID: -1, // Mark for auto-calculation in addNode
                Path: ""
            };
        case NodeType.HELPER:
            return {
                // Helpers don't strictly need extra props, but explicit is better
            };
        case NodeType.EVENT_OBJECT:
            return {
                GlobalSequenceId: -1,
                // Valid EventTrack structure required by writer
                EventTrack: {
                    LineType: 0,
                    GlobalSeqId: null,
                    Keys: []
                }
            };
        case NodeType.COLLISION_SHAPE:
            return {
                Shape: 0, // Box
                // Box needs 2 vertices (min/max) represented as [vector, vector]
                Vertices: [[0, 0, 0], [0, 0, 0]],
                BoundsRadius: 0
            };
        default:
            return {};
    }
}

function normalizeGeosetAnim(anim: any): any {
    if (!anim || typeof anim !== 'object') return anim;
    const normalized = { ...anim };
    if (Array.isArray(normalized.Color)) {
        normalized.Color = new Float32Array(normalized.Color.slice(0, 3));
    } else if (normalized.Color && typeof normalized.Color === 'object' && Array.isArray(normalized.Color.Keys)) {
        normalized.Color = normalizeAnimVector(normalized.Color, 3, false);
    }
    if (normalized.Alpha && typeof normalized.Alpha === 'object' && Array.isArray(normalized.Alpha.Keys)) {
        normalized.Alpha = normalizeAnimVector(normalized.Alpha, 1, false);
    }
    if (typeof normalized.UseColor === 'boolean') {
        const flags = typeof normalized.Flags === 'number' ? normalized.Flags : 0;
        normalized.Flags = normalized.UseColor ? (flags | 2) : (flags & ~2);
    }
    if (typeof normalized.DropShadow === 'boolean') {
        const flags = typeof normalized.Flags === 'number' ? normalized.Flags : 0;
        normalized.Flags = normalized.DropShadow ? (flags | 1) : (flags & ~1);
    }
    return normalized;
}

function normalizeAnimVector(anim: any, size: number, isInt: boolean): any {
    const normalized = { ...anim };
    const Type = isInt ? Int32Array : Float32Array;
    const toTyped = (val: any): Int32Array | Float32Array => {
        if (val instanceof Type) return val as Int32Array | Float32Array;
        if (ArrayBuffer.isView(val)) {
            return new Type(Array.from(val as ArrayLike<number>).slice(0, size)) as Int32Array | Float32Array;
        }
        if (Array.isArray(val)) {
            return new Type(val.slice(0, size)) as Int32Array | Float32Array;
        }
        if (typeof val === 'number') {
            return new Type([val]) as Int32Array | Float32Array;
        }
        if (val && typeof val === 'object') {
            const arr = new Type(size) as Int32Array | Float32Array;
            const keys = Object.keys(val)
                .map(k => Number(k))
                .filter(k => !isNaN(k));
            if (keys.length > 0) {
                for (const k of keys) {
                    if (k >= 0 && k < size) {
                        arr[k] = Number(val[k]) || 0;
                    }
                }
                return arr as Int32Array | Float32Array;
            }
        }
        return new Type(size) as Int32Array | Float32Array;
    };

    const lineType = typeof normalized.LineType === 'number' ? normalized.LineType : 0;
    normalized.LineType = lineType;
    normalized.GlobalSeqId = normalized.GlobalSeqId ?? null;

    normalized.Keys = (anim.Keys || []).map((key: any) => {
        const next = { ...key };
        next.Frame = typeof key.Frame === 'number' ? key.Frame : (key.Time ?? 0);
        next.Vector = toTyped(key.Vector ?? (size === 1 ? [0] : new Array(size).fill(0)));
        if (lineType === 2 || lineType === 3) {
            next.InTan = toTyped(key.InTan ?? new Array(size).fill(0));
            next.OutTan = toTyped(key.OutTan ?? new Array(size).fill(0));
        } else {
            if (key.InTan !== undefined) next.InTan = toTyped(key.InTan);
            if (key.OutTan !== undefined) next.OutTan = toTyped(key.OutTan);
        }
        return next;
    });
    return normalized;
}

export const useModelStore = create<ModelState>((set, get) => ({
    modelData: null,
    modelPath: null,
    nodes: [],
    isLoading: false,
    clipboardNode: null,
    clipboardPayload: null,

    // Renderer reload trigger
    rendererReloadTrigger: 0,

    // Geoset Visibility State Initial Values
    hiddenGeosetIds: [],
    forceShowAllGeosets: true,
    hoveredGeosetId: null,
    selectedGeosetIndex: null,
    selectedGeosetIndices: [],

    // Tab Management State
    tabs: [],
    activeTabId: null,
    cameraStateRef: null,

    // Global Preview Transform
    previewTransform: {
        translation: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
    },

    setPreviewTransform: (transform) => set(state => ({
        previewTransform: { ...state.previewTransform, ...transform }
    })),

    resetPreviewTransform: () => set({
        previewTransform: {
            translation: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1]
        }
    }),

    // Animation State Initial Values
    sequences: [],
    currentSequence: -1,
    currentFrame: 0,
    isPlaying: true,
    playbackSpeed: 1.0,
    isLooping: true,
    autoKeyframe: true,

    setModelData: (data, path) => {
        if (data && path) {
            (data as any).__modelPath = path;
        }
        let nodes = extractNodesFromModel(data);
        console.log('[ModelStore] Loaded model with', nodes.length, 'nodes');

        // FORCE NO REORDERING ON LOAD to prevent invalidating saved bone references
        const correctedData = updateModelDataWithNodes(data, nodes, false);

        // Auto recalculate extent and normals using optimized unified utilities
        const rendererState = useRendererStore.getState();
        if (rendererState.autoRecalculateExtent) {
            calculateModelExtent(correctedData);
        }
        if (rendererState.autoRecalculateNormals) {
            calculateModelNormals(correctedData);
        }

        // Reset animation state on new model load
        const geosetCount = (correctedData as any)?.Geosets?.length || 0;
        const allGeosetIds = Array.from({ length: geosetCount }, (_, i) => i);

        // Reuse nodes from correctedData if available, otherwise use initial extract
        const correctedNodes = (correctedData as any)?.Nodes || nodes;

        const sequences = (correctedData as any)?.Sequences || [];
        const defaultSequenceIndex = pickDefaultSequenceIndex(sequences);
        const hasSequences = sequences.length > 0;

        set({
            modelData: correctedData,
            modelPath: path || (data as any)?.path || (data as any)?.__modelPath || null,
            nodes: correctedNodes,
            sequences,
            currentSequence: hasSequences ? defaultSequenceIndex : -1,
            currentFrame: 0,
            isPlaying: hasSequences,
            hiddenGeosetIds: allGeosetIds,
            forceShowAllGeosets: true,
            selectedGeosetIndex: null,
            selectedGeosetIndices: []
        });
    },

    getModelDataForSave: (forceReorder = false) => {
        const state = get();
        if (!state.modelData) return null;

        const base = updateModelDataWithNodes(state.modelData, state.nodes as any[], false);
        if (!base) return null;

        if (forceReorder || needsReorderForSave(base)) {
            return updateModelDataWithNodes(state.modelData, state.nodes as any[], true);
        }

        return base;
    },

    removeSequence: (index, pruneKeyframes = true) => {
        set((state) => {
            if (!state.modelData || !state.modelData.Sequences || index < 0 || index >= state.modelData.Sequences.length) {
                return {};
            }

            const modelData = { ...state.modelData };
            const sequences = [...modelData.Sequences];
            const seqToDelete = sequences[index];
            if (!seqToDelete) return {};
            const rawInterval = Array.isArray(seqToDelete.Interval)
                ? seqToDelete.Interval
                : (seqToDelete.Interval ? Array.from(seqToDelete.Interval as ArrayLike<number>) : [0, 0]);
            const start = Number(rawInterval[0] ?? 0);
            const end = Number(rawInterval[1] ?? 0);

            // 1. Remove the sequence itself
            sequences.splice(index, 1);
            modelData.Sequences = sequences;

            // 2. Prune keyframes if requested
            if (pruneKeyframes) {
                pruneModelKeyframes(modelData, start, end);
                console.log(`[ModelStore] Pruned keyframes in range ${start}-${end}`);
            }

            // Sync other state
            let nextSequence = state.currentSequence;
            if (state.currentSequence === index) nextSequence = -1;
            else if (state.currentSequence > index) nextSequence = state.currentSequence - 1;

            return {
                modelData,
                sequences,
                currentSequence: nextSequence,
                rendererReloadTrigger: state.rendererReloadTrigger + 1
            };
        });
    },

    updateSequence: (index, updates) => {
        set((state) => {
            if (!state.modelData || !state.modelData.Sequences || index < 0 || index >= state.modelData.Sequences.length) {
                return {};
            }

            const newSequences = [...state.modelData.Sequences];
            newSequences[index] = { ...newSequences[index], ...updates };

            // Also update the sequences array in store root if it exists distinct from modelData
            // (In this store structure, 'sequences' seems to be a derived reference or copy? 
            // setModelData sets 'sequences: (data as any)?.Sequences'. So we updates both.)

            const updatedModelData = { ...state.modelData, Sequences: newSequences };

            return {
                modelData: updatedModelData,
                sequences: newSequences
            };
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

            // Update modelData WITHOUT reordering ObjectIds (preserve existing order)
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[], false);

            // CRITICAL: Extract corrected nodes from modelData to sync ObjectIds
            const correctedNodes = extractNodesFromModel(updatedModelData);

            console.log('[ModelStore] Updated node, triggering lightweight sync');
            return {
                nodes: correctedNodes,
                modelData: updatedModelData,
                rendererReloadTrigger: state.rendererReloadTrigger + 1
            };
        });
    },

    // Silent update - no renderer reload (for high-frequency keyframe edits)
    updateNodeSilent: (objectId, updates) => {
        set((state) => {
            const updatedNodes = state.nodes.map(node =>
                node.ObjectId === objectId ? { ...node, ...updates } : node
            );

            // No reordering
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[], false);
            const correctedNodes = extractNodesFromModel(updatedModelData);

            return {
                nodes: correctedNodes,
                modelData: updatedModelData
            };
        });
    },

    addNode: (nodePartial) => {
        set((state) => {
            // 1. Generate temporary ObjectId (will be corrected by updateModelDataWithNodes)
            const maxObjectId = state.nodes.reduce((max, n) => {
                const id = typeof n.ObjectId === 'number' && !isNaN(n.ObjectId) ? n.ObjectId : -1;
                return Math.max(max, id);
            }, -1);

            const tempObjectId = (nodePartial.ObjectId !== undefined && nodePartial.ObjectId >= 0)
                ? nodePartial.ObjectId
                : maxObjectId + 1;

            // 2. Create complete node object with defaults
            const defaults = getDefaultNodeProperties(nodePartial.type);

            // Special handling for AttachmentID to ensure uniqueness
            let attachmentId = (nodePartial as any).AttachmentID ?? (defaults as any).AttachmentID;
            if (nodePartial.type === NodeType.ATTACHMENT && (attachmentId === undefined || attachmentId === -1 || attachmentId === 0)) {
                const maxAttachmentId = state.nodes.reduce((max, n) => {
                    if (n.type === NodeType.ATTACHMENT && typeof (n as any).AttachmentID === 'number') {
                        return Math.max(max, (n as any).AttachmentID);
                    }
                    return max;
                }, -1);
                attachmentId = maxAttachmentId + 1;
                console.log('[ModelStore] Calculated unique AttachmentID:', attachmentId);
            }

            const newNode: ModelNode = {
                ...defaults,
                ...nodePartial,
                ObjectId: tempObjectId,
                Parent: nodePartial.Parent ?? -1,
                PivotPoint: nodePartial.PivotPoint || [0, 0, 0],
                Translation: nodePartial.Translation ?? defaults.Translation,
                Rotation: nodePartial.Rotation ?? defaults.Rotation,
                Scaling: nodePartial.Scaling ?? defaults.Scaling,
                Visibility: nodePartial.Visibility ?? defaults.Visibility,
                ...(nodePartial.type === NodeType.ATTACHMENT ? { AttachmentID: attachmentId } : {})
            } as ModelNode;

            const updatedNodes = [...state.nodes, newNode];
            // ADDING a node: Must reorder to maintain WC3 type groupings and fill/shift IDs
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[], true);

            // CRITICAL: Extract corrected nodes with reassigned ObjectIds
            const correctedNodes = extractNodesFromModel(updatedModelData);

            console.log('[ModelStore] Added node', newNode.Name, '(ObjectId will be corrected by type order)');

            return {
                nodes: correctedNodes,
                modelData: updatedModelData,
                rendererReloadTrigger: state.rendererReloadTrigger + 1
            };
        });
    },

    deleteNode: (objectId) => {
        set((state) => {
            const nodeToDelete = state.nodes.find(n => n.ObjectId === objectId);
            const parentOfDeletedNode = nodeToDelete?.Parent ?? -1;

            // Update child nodes to inherit deleted node's parent
            const nodesWithUpdatedParents = state.nodes.map(node => {
                if (node.Parent === objectId) {
                    return { ...node, Parent: parentOfDeletedNode };
                }
                return node;
            });

            const updatedNodes = nodesWithUpdatedParents.filter(node => node.ObjectId !== objectId);
            // DELETING a node: Must reorder to close gaps in IDs
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[], true);

            // CRITICAL: Extract corrected nodes with reassigned ObjectIds
            const correctedNodes = extractNodesFromModel(updatedModelData);

            const orphanedCount = state.nodes.filter(n => n.Parent === objectId).length;
            console.log('[ModelStore] Deleted node', objectId, '- re-parented', orphanedCount, 'children');

            return {
                nodes: correctedNodes,
                modelData: updatedModelData,
                rendererReloadTrigger: state.rendererReloadTrigger + 1
            };
        });
    },

    setClipboardNode: (node) => {
        set((state) => {
            if (!node) {
                return { clipboardNode: null, clipboardPayload: null };
            }

            const payload: ClipboardPayload = {
                node,
                sourceModelPath: state.modelPath ?? null,
            };

            const md: any = state.modelData;
            if (!md) {
                return { clipboardNode: node, clipboardPayload: payload };
            }

            const textures: Record<number, any> = {};
            const materials: Record<number, any> = {};
            const textureAnims: Record<number, any> = {};

            const addTexture = (texId: any) => {
                if (typeof texId !== 'number' || texId < 0) return;
                if (textures[texId] !== undefined) return;
                const tex = md.Textures?.[texId];
                if (tex) textures[texId] = tex;
            };

            const addTextureAnim = (animId: any) => {
                if (typeof animId !== 'number' || animId < 0) return;
                if (textureAnims[animId] !== undefined) return;
                const anim = md.TextureAnims?.[animId];
                if (anim) textureAnims[animId] = anim;
            };

            if (node.type === NodeType.PARTICLE_EMITTER_2) {
                const texId = (node as any).TextureID;
                addTexture(texId);
            } else if (node.type === NodeType.RIBBON_EMITTER) {
                const matId = (node as any).MaterialID;
                if (typeof matId === 'number' && matId >= 0 && md.Materials?.[matId]) {
                    materials[matId] = md.Materials[matId];

                    const usedTexIds = new Set<number>();
                    const layerTexKeys = [
                        'TextureID',
                        'NormalTextureID',
                        'ORMTextureID',
                        'EmissiveTextureID',
                        'TeamColorTextureID',
                        'ReflectionsTextureID',
                    ];

                    const mat = md.Materials[matId];
                    const layers = mat?.Layers ?? mat?.layers;
                    if (Array.isArray(layers)) {
                        for (const layer of layers) {
                            for (const k of layerTexKeys) {
                                collectTextureIdsFromAnimVector(layer?.[k], usedTexIds);
                            }
                            // Texture animation id field name varies; normalize to copy whichever exists.
                            addTextureAnim(layer?.TVertexAnimId ?? layer?.TextureAnimationId ?? layer?.TextureAnimId);
                        }
                    }

                    usedTexIds.forEach((id) => addTexture(id));
                }
            }

            if (Object.keys(textures).length > 0) payload.textures = textures;
            if (Object.keys(materials).length > 0) payload.materials = materials;
            if (Object.keys(textureAnims).length > 0) payload.textureAnims = textureAnims;

            return { clipboardNode: node, clipboardPayload: payload };
        });
    },

    pasteNode: (parentId) => {
        set((state) => {
            if (!state.clipboardNode) return {};
            if (!state.modelData) return {};

            let modelDataForPaste: ModelData | null = state.modelData;
            let clipboardNodeForPaste: ModelNode = state.clipboardNode;

            const payload = state.clipboardPayload;
            const isCrossModelPaste =
                !!payload &&
                (payload.sourceModelPath ?? null) !== (state.modelPath ?? null) &&
                !!modelDataForPaste;

            if (isCrossModelPaste && payload && modelDataForPaste) {
                const md: any = modelDataForPaste;

                const targetTextures: any[] = Array.isArray(md.Textures) ? [...md.Textures] : [];
                const targetMaterials: any[] = Array.isArray(md.Materials) ? [...md.Materials] : [];
                const targetTextureAnims: any[] = Array.isArray(md.TextureAnims) ? [...md.TextureAnims] : [];

                const texOldToNew = new Map<number, number>();
                const tvOldToNew = new Map<number, number>();
                const matOldToNew = new Map<number, number>();

                // 1) TextureAnims (so materials can reference them)
                if (payload.textureAnims) {
                    const ids = Object.keys(payload.textureAnims).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
                    for (const oldId of ids) {
                        if (tvOldToNew.has(oldId)) continue;
                        const anim = payload.textureAnims[oldId];
                        const newId = targetTextureAnims.length;
                        targetTextureAnims.push(deepClone(anim));
                        tvOldToNew.set(oldId, newId);
                    }
                }

                // 2) Textures
                if (payload.textures) {
                    const ids = Object.keys(payload.textures).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
                    for (const oldId of ids) {
                        if (texOldToNew.has(oldId)) continue;
                        const tex = payload.textures[oldId];
                        const existing = findExistingTextureIndex(targetTextures, tex);
                        if (existing >= 0) {
                            texOldToNew.set(oldId, existing);
                        } else {
                            const newId = targetTextures.length;
                            targetTextures.push(deepClone(tex));
                            texOldToNew.set(oldId, newId);
                        }
                    }
                }

                // 3) Materials (remap their layer TextureID + TVertexAnimId)
                if (payload.materials) {
                    const ids = Object.keys(payload.materials).map(n => Number(n)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
                    for (const oldId of ids) {
                        if (matOldToNew.has(oldId)) continue;
                        const mat = deepClone(payload.materials[oldId]);
                        const layers = mat?.Layers ?? mat?.layers;
                        if (Array.isArray(layers)) {
                            for (const layer of layers) {
                                // Remap texture refs (may be AnimVector in HD)
                                const keys = [
                                    'TextureID',
                                    'NormalTextureID',
                                    'ORMTextureID',
                                    'EmissiveTextureID',
                                    'TeamColorTextureID',
                                    'ReflectionsTextureID',
                                ];
                                for (const k of keys) {
                                    if (layer?.[k] !== undefined) {
                                        layer[k] = remapTextureRef(layer[k], texOldToNew);
                                    }
                                }

                                // Remap texture animation id
                                const oldTv = layer?.TVertexAnimId ?? layer?.TextureAnimationId ?? layer?.TextureAnimId;
                                if (typeof oldTv === 'number' && tvOldToNew.has(oldTv)) {
                                    layer.TVertexAnimId = tvOldToNew.get(oldTv)!;
                                }
                            }
                        }

                        const newId = targetMaterials.length;
                        targetMaterials.push(mat);
                        matOldToNew.set(oldId, newId);
                    }
                }

                // 4) Remap node references
                const remappedNode: any = { ...clipboardNodeForPaste };
                if (remappedNode.type === NodeType.PARTICLE_EMITTER_2) {
                    const oldTex = remappedNode.TextureID;
                    if (typeof oldTex === 'number' && texOldToNew.has(oldTex)) {
                        remappedNode.TextureID = texOldToNew.get(oldTex)!;
                    }
                } else if (remappedNode.type === NodeType.RIBBON_EMITTER) {
                    const oldMat = remappedNode.MaterialID;
                    if (typeof oldMat === 'number' && matOldToNew.has(oldMat)) {
                        remappedNode.MaterialID = matOldToNew.get(oldMat)!;
                    }
                }

                modelDataForPaste = {
                    ...(md as any),
                    Textures: targetTextures,
                    Materials: targetMaterials,
                    TextureAnims: targetTextureAnims,
                } as any;
                clipboardNodeForPaste = remappedNode as ModelNode;
            }

            // Temporary ObjectId (will be corrected by updateModelDataWithNodes)
            const maxObjectId = state.nodes.reduce((max, n) => Math.max(max, n.ObjectId), -1);
            const tempObjectId = maxObjectId + 1;

            const newNode: ModelNode = {
                ...clipboardNodeForPaste,
                ObjectId: tempObjectId,
                Parent: parentId,
                Name: `${clipboardNodeForPaste.Name}_Copy`,
                PivotPoint: clipboardNodeForPaste.PivotPoint || [0, 0, 0],
            };

            const updatedNodes = [...state.nodes, newNode];
            // PASTING is adding: Must reorder
            const updatedModelData = updateModelDataWithNodes(modelDataForPaste, updatedNodes as any[], true);

            // CRITICAL: Extract corrected nodes with reassigned ObjectIds
            const correctedNodes = extractNodesFromModel(updatedModelData);

            console.log('[ModelStore] Pasted node', newNode.Name, 'to parent', parentId);
            return { nodes: correctedNodes, modelData: updatedModelData };
        });
    },

    moveNode: (nodeId, newParentId) => {
        // Deprecated, use moveNodeTo instead
        get().moveNodeTo(nodeId, newParentId, 'inside');
    },

    moveNodeTo: (nodeId: number, targetId: number, position: 'before' | 'after' | 'inside') => {
        set((state) => {
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

            // 2. Determine new Parent and Index
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

            // 3. Reorder Nodes Array
            const nodeIndex = state.nodes.findIndex(n => n.ObjectId === nodeId);
            if (nodeIndex === -1) return {};

            const node = { ...state.nodes[nodeIndex], Parent: newParentId };
            const newNodes = [...state.nodes];
            newNodes.splice(nodeIndex, 1);
            if (nodeIndex < targetIndex) targetIndex--;
            if (targetIndex >= newNodes.length) {
                newNodes.push(node);
            } else {
                newNodes.splice(targetIndex, 0, node);
            }

            // 4. Update Model Data and extract corrected nodes
            // Moving a node in hierarchy does NOT necessarily require changing ObjectIds if we rely on type ordering.
            // If we reorderIds=true, we force canonical WC3 type sort, which might persist the user's manual "move" 
            // only if that move respects the type buckets (e.g. moving a bone within bones).
            // But if user moves a bone to be child of a helper, the IDs might shuffle if we resort.
            // To be safe and stable, let's NOT reorder IDs during move, unless the user actually wants to change order.
            // Since this function is "moveNodeTo" which implies structural change, let's keep reorder=true? 
            // Wait, the user said "Only reorder when adding new nodes". 
            // Reparenting shouldn't change IDs ideally.
            // Let's set reorder=false for stability.
            const updatedModelData = updateModelDataWithNodes(state.modelData, newNodes as any[], false);
            const correctedNodes = extractNodesFromModel(updatedModelData);

            console.log(`[ModelStore] Moved node ${nodeId} ${position} ${targetId}`);
            return { nodes: correctedNodes, modelData: updatedModelData };
        });
    },

    moveNodeWithChildren: (nodeId: number, targetId: number, position: 'before' | 'after' | 'inside') => {
        set((state) => {
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

            // 2. Get all descendants
            const descendantIds = getAllDescendants(nodeId, state.nodes);
            const allMovingIds = [nodeId, ...descendantIds];

            if (allMovingIds.includes(targetId)) {
                console.warn('[ModelStore] Cannot move node into its own descendant');
                return {};
            }

            // 3. Determine new Parent
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
            const remainingNodes = state.nodes.filter(n => !allMovingIds.includes(n.ObjectId));
            const movingNodes = state.nodes
                .filter(n => allMovingIds.includes(n.ObjectId))
                .map(n => n.ObjectId === nodeId ? { ...n, Parent: newParentId } : n);

            const newNodes = [...remainingNodes];
            const insertPosition = Math.min(targetIndex, newNodes.length);
            newNodes.splice(insertPosition, 0, ...movingNodes);

            // 5. Update Model Data and extract corrected nodes
            const updatedModelData = updateModelDataWithNodes(state.modelData, newNodes as any[]);
            const correctedNodes = extractNodesFromModel(updatedModelData);

            console.log(`[ModelStore] Moved node ${nodeId} with ${descendantIds.length} children ${position} ${targetId}`);
            return { nodes: correctedNodes, modelData: updatedModelData };
        });
    },

    renameNode: (nodeId, newName) => {
        set((state) => {
            const updatedNodes = state.nodes.map(node =>
                node.ObjectId === nodeId ? { ...node, Name: newName } : node
            );
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[]);

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

            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[]);
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
    setSequences: (sequences) => {
        set((state) => {
            const updatedModelData = state.modelData ? { ...state.modelData, Sequences: sequences } : state.modelData;
            return { sequences, modelData: updatedModelData };
        });
        const renderer = useRendererStore.getState().renderer;
        if (renderer?.model) {
            renderer.model.Sequences = sequences;
            const currentSequence = get().currentSequence;
            if (currentSequence >= 0 && typeof (renderer as any).setSequence === 'function') {
                (renderer as any).setSequence(currentSequence);
            }
        }
    },
    setSequence: (index) => set((state) => {
        const seq = state.sequences?.[index] as any
        const start = (seq && seq.Interval && typeof seq.Interval[0] === 'number') ? seq.Interval[0] : 0
        return { currentSequence: index, currentFrame: start }
    }), // Reset frame to the selected sequence start
    setFrame: (frame) => set({ currentFrame: frame }),
    setPlaying: (playing) => set({ isPlaying: playing }),
    setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
    setLooping: (looping) => set({ isLooping: looping }),
    setAutoKeyframe: () => set({ autoKeyframe: true }),

    shiftSequenceDuration: async (index: number, newDurationMs: number) => {
        const state = get()
        const sequences = state.sequences
        const modelData = state.modelData
        if (!modelData || !sequences || index < 0 || index >= sequences.length) return

        const oldSeq = sequences[index]
        const oldDuration = oldSeq.Interval[1] - oldSeq.Interval[0]
        const deltaMs = newDurationMs - oldDuration
        if (deltaMs === 0) return

        // Use external service to recursively shift modelData keyframes
        const { shiftModelKeyframes } = await import('../services/timeShiftService')
        const newModelData = shiftModelKeyframes(modelData, index, deltaMs)

        // Shift is applied to sequences inside the service, but we also update the sequences state
        const newSequences = newModelData.Sequences || sequences

        // CRITICAL FIX: We MUST extract the new nodes from the newModelData and update state.nodes 
        // Otherwise the KeyframeTimeline UI and logic will use the old non-scaled ghost nodes.
        const correctedNodes = extractNodesFromModel(newModelData)

        // CRITICAL: Force the viewer to reload the GPU buffers and animation tracks
        newModelData.__forceFullReload = true

        set({
            sequences: newSequences,
            modelData: newModelData,
            nodes: correctedNodes,
            rendererReloadTrigger: state.rendererReloadTrigger + 1
        })

        // Sync with renderer
        const renderer = useRendererStore.getState().renderer
        if (renderer?.model) {
            renderer.model.Sequences = newSequences
            try {
                // If it exposes reload method, call it to reconstruct animation tracks
                if (typeof (renderer as any).reloadModelData === 'function') {
                    // We don't have a direct reloadModelData, we use the store trigger. The store trigger will cause Viewer.tsx to reconstruct.
                }
            } catch (e) {
                console.error('Failed to sync sequence duration shift with renderer', e)
            }
        }
    },

    setTextures: (textures) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Textures: textures } : state.modelData;
        return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),
    setGeosets: (geosets) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Geosets: geosets } : state.modelData;
        return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),
    setMaterials: (materials) => set((state) => {
        console.log('[ModelStore] setMaterials called. Count:', materials ? materials.length : 0);
        const updatedModelData = state.modelData ? { ...state.modelData, Materials: materials } : state.modelData;
        return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),
    setTextureAnims: (anims) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, TextureAnims: anims } : state.modelData;
        return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),

    addTextureAnim: () => {
        set((state) => {
            if (!state.modelData) return {};
            const currentAnims = state.modelData.TextureAnims || [];
            const newAnim = {
                Translation: { InterpolationType: 0, GlobalSeqId: null, Keys: [] },
                Rotation: { InterpolationType: 0, GlobalSeqId: null, Keys: [] },
                Scaling: { InterpolationType: 0, GlobalSeqId: null, Keys: [] }
            };
            const updatedAnims = [...currentAnims, newAnim];
            const updatedModelData = { ...state.modelData, TextureAnims: updatedAnims };
            console.log('[ModelStore] Added TextureAnim, new count:', updatedAnims.length);
            return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
        });
    },



    removeTextureAnim: (index) => {
        set((state) => {
            if (!state.modelData || !state.modelData.TextureAnims) return {};
            const updatedAnims = [...state.modelData.TextureAnims];
            if (index >= 0 && index < updatedAnims.length) {
                updatedAnims.splice(index, 1);
                const updatedModelData = { ...state.modelData, TextureAnims: updatedAnims };
                console.log('[ModelStore] Removed TextureAnim at index', index);
                return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
            }
            return {};
        });
    },

    updateTextureAnim: (index, updates) => {
        set((state) => {
            if (!state.modelData || !state.modelData.TextureAnims) return {};
            const updatedAnims = [...state.modelData.TextureAnims];
            if (index >= 0 && index < updatedAnims.length) {
                updatedAnims[index] = { ...updatedAnims[index], ...updates };
                const updatedModelData = { ...state.modelData, TextureAnims: updatedAnims };
                return { modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
            }
            return {};
        });
    },

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
                newGeosetAnims[index] = normalizeGeosetAnim({
                    ...newGeosetAnims[index],
                    ...updates
                });

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
            const updatedModelData = {
                ...state.modelData,
                GeosetAnims: anims.map(normalizeGeosetAnim)
            };
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

            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[], false);
            const correctedNodes = extractNodesFromModel(updatedModelData);
            console.log('[ModelStore] Batch updated', updates.length, 'nodes');
            return { nodes: correctedNodes as ModelNode[], modelData: updatedModelData };
        });
    },

    replaceNodes: (nodes, options) => {
        set((state) => {
            if (!state.modelData) return {};
            const updatedModelData = updateModelDataWithNodes(state.modelData, nodes as any[], false);
            if (!updatedModelData) return {};
            const correctedNodes = extractNodesFromModel(updatedModelData);
            const triggerReload = options?.triggerReload !== false;
            return {
                nodes: correctedNodes as ModelNode[],
                modelData: updatedModelData,
                rendererReloadTrigger: state.rendererReloadTrigger + (triggerReload ? 1 : 0)
            };
        });
    },

    transformModel: (ops) => {
        const { translation, rotation, scale, skipAnimationTracks, suppressReload } = ops;
        console.log('[ModelStore] transformModel starting with ops:', { translation, rotation, scale, skipAnimationTracks, suppressReload });
        set((state) => {
            if (!state.modelData) {
                console.warn('[ModelStore] transformModel: No modelData loaded.');
                return {};
            }

            const modelData = state.modelData;
            // Force full renderer rebuild because geoset vertices are mutated in-place.
            // Lightweight sync does not update vertex buffers.
            (modelData as any).__forceFullReload = true;

            // 1. Construct Transformation Matrices
            // matrix: Full transformation (TRS) for absolute positions
            // rotScaleMatrix: Only Rotation + Scale for vectors/normals/offsets
            const matrix = mat4.create();
            const rotScaleMatrix = mat4.create();
            const normalMatrix = mat3.create();

            if (translation) {
                mat4.translate(matrix, matrix, translation);
            }

            const rotMatrix = mat4.create();
            if (rotation) {
                // War3 standard: Rotate X, then Y, then Z (Euler)
                mat4.rotateX(rotMatrix, rotMatrix, rotation[0] * Math.PI / 180);
                mat4.rotateY(rotMatrix, rotMatrix, rotation[1] * Math.PI / 180);
                mat4.rotateZ(rotMatrix, rotMatrix, rotation[2] * Math.PI / 180);

                mat4.multiply(matrix, matrix, rotMatrix);
                mat4.multiply(rotScaleMatrix, rotScaleMatrix, rotMatrix);
            }

            if (scale) {
                mat4.scale(matrix, matrix, scale);
                mat4.scale(rotScaleMatrix, rotScaleMatrix, scale);
            }

            mat3.normalFromMat4(normalMatrix, matrix);

            // 2. Unique Object Tracking System
            // This prevents double-transforming arrays that are shared between lists
            const transformedArrays = new Set<any>();

            const transformPosition = (p: number[] | Float32Array | any) => {
                if (!p) return;
                if (typeof p !== 'object') {
                    console.error('[ModelStore] transformPosition: expected object but got', typeof p, p);
                    return;
                }
                if (transformedArrays.has(p)) return;
                // Safety: if p is not indexable or too short, skip
                if (p.length < 3) return;

                const v = vec3.fromValues(p[0], p[1], p[2]);
                vec3.transformMat4(v, v, matrix);
                p[0] = v[0]; p[1] = v[1]; p[2] = v[2];
                transformedArrays.add(p);
            };

            const transformVector = (p: number[] | Float32Array | any) => {
                if (!p || typeof p !== 'object' || transformedArrays.has(p)) return;
                // Safety: if p is not indexable or too short, skip
                if (p.length < 3) return;

                const v = vec3.fromValues(p[0], p[1], p[2]);
                // Use rotScaleMatrix for relative offsets/vectors
                vec3.transformMat4(v, v, rotScaleMatrix);
                p[0] = v[0]; p[1] = v[1]; p[2] = v[2];
                transformedArrays.add(p);
            };

            // 3. Transform Pivot Points (Absolute Positions)
            // These must be transformed along with vertices to maintain skinning relationship.
            if (modelData.PivotPoints) {
                modelData.PivotPoints.forEach(p => transformPosition(p));
            }

            // 4. Transform Geoset Geometry (Bind Pose)
            if (modelData.Geosets) {
                for (const geoset of modelData.Geosets) {
                    if (geoset.Vertices) {
                        for (let i = 0; i < geoset.Vertices.length; i += 3) {
                            const v = vec3.fromValues(geoset.Vertices[i], geoset.Vertices[i + 1], geoset.Vertices[i + 2]);
                            vec3.transformMat4(v, v, matrix);
                            geoset.Vertices[i] = v[0];
                            geoset.Vertices[i + 1] = v[1];
                            geoset.Vertices[i + 2] = v[2];
                        }
                    }
                    if (geoset.Normals) {
                        for (let i = 0; i < geoset.Normals.length; i += 3) {
                            const n = vec3.fromValues(geoset.Normals[i], geoset.Normals[i + 1], geoset.Normals[i + 2]);
                            vec3.transformMat3(n, n, normalMatrix);
                            vec3.normalize(n, n);
                            geoset.Normals[i] = n[0];
                            geoset.Normals[i + 1] = n[1];
                            geoset.Normals[i + 2] = n[2];
                        }
                    }
                    if (geoset.MinimumExtent) transformPosition(geoset.MinimumExtent);
                    if (geoset.MaximumExtent) transformPosition(geoset.MaximumExtent);
                }
            }

            // 5. Transform All Nodes and Animations
            const allNodeGroups = [
                'Nodes', 'Bones', 'Helpers', 'Attachments', 'Lights',
                'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
                'EventObjects', 'CollisionShapes'
            ];
            for (const group of allNodeGroups) {
                const nodes = (modelData as any)[group];
                if (nodes && Array.isArray(nodes)) {
                    for (const node of nodes) {
                        const isRoot = node.Parent === -1 || node.Parent === undefined;

                        // 1. Transform PivotPoint (Absolute Position)
                        // All nodes need their PivotPoint transformed by TRS
                        if (node.PivotPoint) transformPosition(node.PivotPoint);

                        // 2. Transform Animation Tracks (Relative)
                        // CRITICAL: Only transform animation tracks for ROOT nodes.
                        // Child nodes inherit transformations through the bone hierarchy.
                        // Also only apply Rotation/Scale (RS) to relative translation tracks.
                        if (isRoot) {
                            if (node.Translation && node.Translation.Values) {
                                node.Translation.Values.forEach((val: any) => transformVector(val));
                            }

                            // Note: Rotation and Scaling tracks are not yet transformed here.
                            // Prepending global rotation to quat/euler tracks is complex and
                            // usually not needed for simple global translation/centering.
                        }
                    }
                }
            }

            // 6. Transform Collision Shapes / Cameras / etc.
            if (modelData.CollisionShapes) {
                for (const shape of modelData.CollisionShapes) {
                    const s = shape as any;
                    if (s.Vertex1) transformPosition(s.Vertex1);
                    if (s.Vertex2) transformPosition(s.Vertex2);
                    if (s.Vertices) {
                        if (s.Vertices instanceof Float32Array || (Array.isArray(s.Vertices) && typeof s.Vertices[0] === 'number')) {
                            // Flat array: transform in chunks of 3
                            for (let i = 0; i < s.Vertices.length; i += 3) {
                                const vSegment = [s.Vertices[i], s.Vertices[i + 1], s.Vertices[i + 2]];
                                const vec = vec3.fromValues(vSegment[0], vSegment[1], vSegment[2]);
                                vec3.transformMat4(vec, vec, matrix);
                                s.Vertices[i] = vec[0]; s.Vertices[i + 1] = vec[1]; s.Vertices[i + 2] = vec[2];
                            }
                        } else if (Array.isArray(s.Vertices)) {
                            // Array of vectors
                            s.Vertices.forEach((v: any) => transformPosition(v));
                        }
                    }

                    if (scale && s.BoundsRadius !== undefined) {
                        const maxScale = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]));
                        s.BoundsRadius *= maxScale;
                    }
                }
            }

            if (modelData.Cameras) {
                for (const cam of modelData.Cameras) {
                    const c = cam as any;
                    if (c.PivotPoint) transformPosition(c.PivotPoint);
                    if (c.TargetPosition) transformPosition(c.TargetPosition);
                }
            }

            // 7. Scale Size-Related Properties
            if (scale) {
                const maxScale = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]));
                const scaleProp = (obj: any, prop: string, factor: number) => {
                    if (obj[prop] !== undefined) {
                        if (typeof obj[prop] === 'number') obj[prop] *= factor;
                        else if (Array.isArray(obj[prop])) obj[prop] = obj[prop].map((v: number) => v * factor);
                    }
                };

                (modelData.ParticleEmitters2 || []).forEach((p: any) => {
                    ['Speed', 'Variation', 'Width', 'Length', 'Gravity', 'TailLength'].forEach(k => scaleProp(p, k, maxScale));
                    if (p.ParticleScaling) p.ParticleScaling = p.ParticleScaling.map((v: number) => v * maxScale);
                });

                (modelData.RibbonEmitters || []).forEach((r: any) => {
                    ['HeightAbove', 'HeightBelow', 'Gravity'].forEach(k => scaleProp(r, k, maxScale));
                });

                (modelData.ParticleEmitters || []).forEach((p: any) => {
                    ['InitialVelocity', 'Gravity'].forEach(k => scaleProp(p, k, maxScale));
                });

                (modelData.Lights || []).forEach((l: any) => {
                    ['AttenuationStart', 'AttenuationEnd'].forEach(k => scaleProp(l, k, maxScale));
                });
            }

            // 8. Re-sync nodes state and recalculate derived data
            const updatedNodes = extractNodesFromModel(modelData);
            recalculateModelExtent(modelData);

            console.log(`[ModelStore] Applied global transformation:
                Geosets: ${modelData.Geosets?.length || 0}
                Nodes processed in hierarchy: ${allNodeGroups.reduce((acc, group) => acc + ((modelData as any)[group]?.length || 0), 0)}
                CollisionShapes: ${modelData.CollisionShapes?.length || 0}
                Unique arrays transformed: ${transformedArrays.size}`);

            return {
                modelData: { ...modelData },
                nodes: updatedNodes,
                rendererReloadTrigger: state.rendererReloadTrigger + (suppressReload ? 0 : 1)
            };
        });
    },

    recalculateExtents: () => {
        set((state) => {
            if (!state.modelData) return {};
            recalculateModelExtent(state.modelData);
            // Force update
            return { modelData: { ...state.modelData }, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
        });
    },

    recalculateNormals: () => {
        set((state) => {
            if (!state.modelData) return {};
            calculateModelNormals(state.modelData);
            // Force update
            return { modelData: { ...state.modelData }, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
        });
    },

    addDeathAnimation: () => {
        set((state) => {
            if (!state.modelData) return {};
            const { status } = processDeathAnimation(state.modelData);
            console.log(`[ModelStore] Death animation ${status}`);

            // Extract nodes again as they might have been added (GeosetAnims)
            const updatedNodes = extractNodesFromModel(state.modelData);

            return {
                modelData: { ...state.modelData },
                nodes: updatedNodes,
                sequences: [...(state.modelData.Sequences || [])],
                rendererReloadTrigger: state.rendererReloadTrigger + 1
            };
        });
    },

    removeLights: () => {
        set((state) => {
            if (!state.modelData) return {};
            const { count } = processRemoveLights(state.modelData);
            console.log(`[ModelStore] Removed ${count} lights`);

            const updatedNodes = extractNodesFromModel(state.modelData);

            // Rebuild model data to ensure internal arrays (Nodes, PivotPoints) are in sync
            // and ObjectIds are reassigned if needed
            const rebuiltModelData = updateModelDataWithNodes(state.modelData, updatedNodes, true);

            return {
                modelData: rebuiltModelData ? { ...rebuiltModelData } : state.modelData,
                nodes: updatedNodes,
                rendererReloadTrigger: state.rendererReloadTrigger + 1
            };
        });
    },

    repairModel: () => {
        set((state) => {
            if (!state.nodes || state.nodes.length === 0) return {};

            console.log('[ModelStore] Starting model repair...');
            let repairCount = 0;

            // 1. Repair AttachmentIDs (Sequential starting from 0)
            let nextAttachmentId = 0;
            const updatedNodes = state.nodes.map(node => {
                if (node.type === NodeType.ATTACHMENT) {
                    const currentId = (node as any).AttachmentID;
                    if (currentId !== nextAttachmentId) {
                        repairCount++;
                        return { ...node, AttachmentID: nextAttachmentId++ };
                    }
                    nextAttachmentId++;
                }
                return node;
            });

            if (repairCount > 0) {
                // Update modelData without reordering ObjectIds (just updating properties)
                const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[], false);
                const correctedNodes = extractNodesFromModel(updatedModelData);

                console.log(`[ModelStore] Repair complete. Fixed ${repairCount} AttachmentIDs.`);
                return {
                    nodes: correctedNodes,
                    modelData: updatedModelData,
                    rendererReloadTrigger: state.rendererReloadTrigger + 1
                };
            }

            console.log('[ModelStore] No repairs needed.');
            return {};
        });
    },

    triggerRendererReload: () => {
        set((state) => ({
            rendererReloadTrigger: state.rendererReloadTrigger + 1
        }));
        console.log('[ModelStore] Triggered renderer reload');
    },

    // Geoset Visibility Actions
    toggleGeosetVisibility: (geosetId: number) => {
        set((state) => {
            const isCurrentlyHidden = state.hiddenGeosetIds.includes(geosetId);
            if (isCurrentlyHidden) {
                return { hiddenGeosetIds: state.hiddenGeosetIds.filter(id => id !== geosetId) };
            } else {
                return { hiddenGeosetIds: [...state.hiddenGeosetIds, geosetId] };
            }
        });
    },

    setForceShowAllGeosets: (show: boolean) => {
        set({ forceShowAllGeosets: show });
    },

    setHoveredGeosetId: (id: number | null) => {
        set({ hoveredGeosetId: id });
    },

    setSelectedGeosetIndex: (index: number | null) => {
        set({ selectedGeosetIndex: index, selectedGeosetIndices: index === null ? [] : [index] });
    },

    setSelectedGeosetIndices: (indices: number[]) => {
        const cleaned = Array.from(new Set(indices.filter((value) => Number.isInteger(value) && value >= 0)));
        set({
            selectedGeosetIndices: cleaned,
            selectedGeosetIndex: cleaned.length > 0 ? cleaned[0] : null
        });
    },

    setHiddenGeosetIds: (ids: number[]) => {
        set({ hiddenGeosetIds: ids });
    },

    resetGeosetVisibility: () => {
        set({ hiddenGeosetIds: [], forceShowAllGeosets: true, hoveredGeosetId: null, selectedGeosetIndex: null, selectedGeosetIndices: [] });
    },

    // Tab Management Actions
    setCameraStateRef: (ref) => {
        set({ cameraStateRef: ref });
    },

    addTab: (path, modelData = null) => {
        const state = get();

        // Check if tab with this path already exists - if so, switch to it instead
        const existingTab = state.tabs.find(t => t.path === path);
        if (existingTab) {
            console.log('[ModelStore] Tab already exists for:', path, '- switching to it');
            get().setActiveTab(existingTab.id);
            return false;
        }

        const id = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const name = path.split(/[\\/]/).pop() || 'Untitled';

        // If there's an active tab, save its current state to its snapshot
        const updatedTabs = state.tabs.map(tab => {
            if (tab.id === state.activeTabId) {
                // Capture current camera state from ref and CLONE it
                const cam = state.cameraStateRef?.current;
                const cameraState = cam ? {
                    distance: cam.distance,
                    theta: cam.theta,
                    phi: cam.phi,
                    target: vec3.clone(cam.target as vec3)
                } : null;

                return {
                    ...tab,
                    snapshot: {
                        modelData: state.modelData,
                        modelPath: state.modelPath,
                        nodes: [...state.nodes],
                        sequences: [...state.sequences],
                        currentSequence: state.currentSequence,
                        currentFrame: state.currentFrame,
                        hiddenGeosetIds: [...state.hiddenGeosetIds],
                        cameraState,
                        renderer: useRendererStore.getState().renderer,
                        lastActive: Date.now()
                    }
                };
            }
            return tab;
        });

        // Create new tab with empty snapshot (will be filled by setModelData)
        const newTab: Tab = {
            id,
            path,
            name,
            snapshot: {
                modelData: null,
                modelPath: path,
                nodes: [],
                sequences: [],
                currentSequence: -1,
                currentFrame: 0,
                hiddenGeosetIds: [],
                cameraState: null,
                renderer: modelData ? null : null, // Initial tab has no renderer yet
                lastActive: Date.now()
            }
        };

        set({
            tabs: [...updatedTabs, newTab],
            activeTabId: id,
            // Reset model state - will be filled by Viewer loading
            modelData: null,
            modelPath: path,
            nodes: [],
            sequences: [],
            currentSequence: -1,
            currentFrame: 0,
            hiddenGeosetIds: [],
            forceShowAllGeosets: true,
            cachedRenderer: null // Reset cached renderer when adding new tab
        });

        console.log('[ModelStore] Added new tab:', name, 'id:', id);
        return true;
    },

    closeTab: (tabId) => {
        const state = get();
        const tab = state.tabs.find(t => t.id === tabId);
        if (!tab) return;

        const tabIndex = state.tabs.findIndex(t => t.id === tabId);
        const newTabs = state.tabs.filter(t => t.id !== tabId);

        // CLEANUP: Destroy renderer resources if cached
        if (tab.snapshot.renderer) {
            console.log(`[ModelStore] Destroying renderer for closed tab: ${tab.name}`);
            try { (tab.snapshot.renderer as any).destroy(); } catch (e) { }
        }

        if (state.activeTabId === tabId) {
            // Need to switch to another tab
            if (newTabs.length === 0) {
                // No tabs left - clear everything
                set({
                    tabs: [],
                    activeTabId: null,
                    modelData: null,
                    modelPath: null,
                    nodes: [],
                    sequences: [],
                    currentSequence: -1,
                    currentFrame: 0,
                    hiddenGeosetIds: [],
                    forceShowAllGeosets: true
                });
            } else {
                // Switch to adjacent tab
                const newActiveIndex = Math.min(tabIndex, newTabs.length - 1);
                const newActiveTab = newTabs[newActiveIndex];
                const snapshot = newActiveTab.snapshot;

                set({
                    tabs: newTabs,
                    activeTabId: newActiveTab.id,
                    modelData: snapshot.modelData,
                    modelPath: snapshot.modelPath,
                    nodes: [...snapshot.nodes],
                    sequences: [...snapshot.sequences],
                    currentSequence: snapshot.currentSequence,
                    currentFrame: snapshot.currentFrame,
                    hiddenGeosetIds: [...snapshot.hiddenGeosetIds],
                    forceShowAllGeosets: false,
                    rendererReloadTrigger: state.rendererReloadTrigger + 1
                });

                // Restore camera if ref is available
                if (state.cameraStateRef && snapshot.cameraState) {
                    const currentCam = state.cameraStateRef.current;
                    const snap = snapshot.cameraState;
                    if (currentCam) {
                        currentCam.distance = snap.distance;
                        currentCam.theta = snap.theta;
                        currentCam.phi = snap.phi;
                        vec3.copy(currentCam.target, snap.target as vec3);
                    }
                }
            }
        }
        else {
            // Just remove the tab, no state switch needed
            set({ tabs: newTabs });
        }

        console.log('[ModelStore] Closed tab:', tabId);
    },

    setActiveTab: (tabId) => {
        const state = get();
        if (state.activeTabId === tabId) return;

        const newActiveTab = state.tabs.find(t => t.id === tabId);
        if (!newActiveTab) return;

        // Capture current state to outgoing tab's snapshot
        const cam = state.cameraStateRef?.current;
        const cameraState = cam ? {
            distance: cam.distance,
            theta: cam.theta,
            phi: cam.phi,
            target: vec3.clone(cam.target as vec3)
        } : null;

        const currentRenderer = useRendererStore.getState().renderer;

        let updatedTabs = state.tabs.map(tab => {
            if (tab.id === state.activeTabId) {
                return {
                    ...tab,
                    snapshot: {
                        ...tab.snapshot,
                        modelData: state.modelData,
                        modelPath: state.modelPath,
                        nodes: [...state.nodes],
                        sequences: [...state.sequences],
                        currentSequence: state.currentSequence,
                        currentFrame: state.currentFrame,
                        hiddenGeosetIds: [...state.hiddenGeosetIds],
                        cameraState,
                        renderer: currentRenderer,
                        lastActive: Date.now()
                    }
                };
            }
            return tab;
        });

        // LRU Eviction: Limit number of cached renderers to prevent VRAM explosion
        const tabsWithRenderer = updatedTabs
            .filter(t => t.snapshot.renderer)
            .sort((a, b) => (a.snapshot.lastActive || 0) - (b.snapshot.lastActive || 0));

        if (tabsWithRenderer.length > MAX_CACHED_RENDERERS) {
            const tabToEvict = tabsWithRenderer[0];
            updatedTabs = updatedTabs.map(t => {
                if (t.id === tabToEvict.id) {
                    console.log(`[ModelStore] LRU Evicting and DESTROYING renderer for tab: ${t.name}`);
                    // CLEANUP: Actually destroy evicted renderer
                    if (t.snapshot.renderer) {
                        try { (t.snapshot.renderer as any).destroy(); } catch (e) { }
                    }
                    return { ...t, snapshot: { ...t.snapshot, renderer: null } };
                }
                return t;
            });
        }

        // Restore state from new active tab
        const snapshot = newActiveTab.snapshot;

        // If we have a cached renderer, we can skip the full reload trigger
        const hasCachedRenderer = !!snapshot.renderer;

        set({
            tabs: updatedTabs,
            activeTabId: tabId,
            modelData: snapshot.modelData,
            modelPath: snapshot.modelPath,
            nodes: [...snapshot.nodes],
            sequences: [...snapshot.sequences],
            currentSequence: snapshot.currentSequence,
            currentFrame: snapshot.currentFrame,
            hiddenGeosetIds: [...snapshot.hiddenGeosetIds],
            forceShowAllGeosets: false, // Respect hiddenGeosetIds during restoration
            cachedRenderer: snapshot.renderer || null,
            rendererReloadTrigger: hasCachedRenderer ? state.rendererReloadTrigger : state.rendererReloadTrigger + 1
        });

        // Restore camera
        if (state.cameraStateRef && snapshot.cameraState) {
            const currentCam = state.cameraStateRef.current;
            const snap = snapshot.cameraState;
            currentCam.distance = snap.distance;
            currentCam.theta = snap.theta;
            currentCam.phi = snap.phi;
            vec3.copy(currentCam.target, snap.target as vec3);
        }

        console.log('[ModelStore] Switched to tab:', newActiveTab.name, hasCachedRenderer ? '(Cached)' : '(Reload)');
    },

    reset: () => {
        const state = get();
        // CLEANUP: Destroy all cached renderers
        state.tabs.forEach(tab => {
            if (tab.snapshot.renderer) {
                try { (tab.snapshot.renderer as any).destroy(); } catch (e) { }
            }
        });

        set({
            modelData: null,
            modelPath: null,
            nodes: [],
            tabs: [],
            activeTabId: null,
            sequences: [],
            currentSequence: -1,
            currentFrame: 0,
            hiddenGeosetIds: [],
            forceShowAllGeosets: true,
            hoveredGeosetId: null,
            selectedGeosetIndex: null,
            selectedGeosetIndices: [],
            cachedRenderer: null,
            rendererReloadTrigger: 0,
            previewTransform: {
                translation: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1]
            }
        });
    }
}));
