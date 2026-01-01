/**
 * Model State Management using Zustand
 */

import { create } from 'zustand';
import { ModelData } from '../types/model';
import { ModelNode, NodeType } from '../types/node';
import { useRendererStore } from './rendererStore';

/**
 * 重新计算 Geoset 的边界范围 (Extent)
 * 遍历所有顶点，计算 MinimumExtent, MaximumExtent 和 BoundsRadius
 */
function recalculateGeosetExtent(geoset: any): void {
    if (!geoset?.Vertices || geoset.Vertices.length === 0) return;

    const vertices = geoset.Vertices;
    const vertexCount = vertices.length / 3;

    if (vertexCount === 0) return;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < vertexCount; i++) {
        const x = vertices[i * 3];
        const y = vertices[i * 3 + 1];
        const z = vertices[i * 3 + 2];

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }

    // Update extent
    if (geoset.MinimumExtent instanceof Float32Array) {
        geoset.MinimumExtent[0] = minX;
        geoset.MinimumExtent[1] = minY;
        geoset.MinimumExtent[2] = minZ;
    } else {
        geoset.MinimumExtent = new Float32Array([minX, minY, minZ]);
    }

    if (geoset.MaximumExtent instanceof Float32Array) {
        geoset.MaximumExtent[0] = maxX;
        geoset.MaximumExtent[1] = maxY;
        geoset.MaximumExtent[2] = maxZ;
    } else {
        geoset.MaximumExtent = new Float32Array([maxX, maxY, maxZ]);
    }

    // Calculate BoundsRadius as half the diagonal
    const dx = maxX - minX;
    const dy = maxY - minY;
    const dz = maxZ - minZ;
    geoset.BoundsRadius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
}

/**
 * 重新计算 Geoset 的法线
 * 使用面法线平均法：对每个顶点，累加其所属面的法线，然后归一化
 */
function recalculateGeosetNormals(geoset: any): void {
    if (!geoset?.Vertices || !geoset?.Faces || geoset.Vertices.length === 0) return;

    const vertices = geoset.Vertices;
    const faces = geoset.Faces;
    const vertexCount = vertices.length / 3;
    const faceCount = faces.length / 3;

    if (vertexCount === 0 || faceCount === 0) return;

    // Initialize normals to zero
    const normals = new Float32Array(vertexCount * 3);

    // Accumulate face normals for each vertex
    for (let f = 0; f < faceCount; f++) {
        const i0 = faces[f * 3];
        const i1 = faces[f * 3 + 1];
        const i2 = faces[f * 3 + 2];

        // Get vertex positions
        const v0x = vertices[i0 * 3], v0y = vertices[i0 * 3 + 1], v0z = vertices[i0 * 3 + 2];
        const v1x = vertices[i1 * 3], v1y = vertices[i1 * 3 + 1], v1z = vertices[i1 * 3 + 2];
        const v2x = vertices[i2 * 3], v2y = vertices[i2 * 3 + 1], v2z = vertices[i2 * 3 + 2];

        // Calculate edge vectors
        const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
        const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

        // Cross product (face normal, not normalized yet)
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;

        // Accumulate to each vertex of the face
        normals[i0 * 3] += nx; normals[i0 * 3 + 1] += ny; normals[i0 * 3 + 2] += nz;
        normals[i1 * 3] += nx; normals[i1 * 3 + 1] += ny; normals[i1 * 3 + 2] += nz;
        normals[i2 * 3] += nx; normals[i2 * 3 + 1] += ny; normals[i2 * 3 + 2] += nz;
    }

    // Normalize all normals
    for (let i = 0; i < vertexCount; i++) {
        const x = normals[i * 3];
        const y = normals[i * 3 + 1];
        const z = normals[i * 3 + 2];
        const len = Math.sqrt(x * x + y * y + z * z);
        if (len > 0.0001) {
            normals[i * 3] = x / len;
            normals[i * 3 + 1] = y / len;
            normals[i * 3 + 2] = z / len;
        } else {
            // Default to up vector if degenerate
            normals[i * 3] = 0;
            normals[i * 3 + 1] = 0;
            normals[i * 3 + 2] = 1;
        }
    }

    geoset.Normals = normals;
}

/**
 * 重新计算模型的所有 Geoset 的 Extent
 */
function recalculateModelExtent(modelData: any): void {
    if (!modelData?.Geosets) return;

    for (const geoset of modelData.Geosets) {
        recalculateGeosetExtent(geoset);
    }

    // Also update model-level extent
    if (modelData.Geosets.length > 0) {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (const geoset of modelData.Geosets) {
            if (geoset.MinimumExtent) {
                const min = geoset.MinimumExtent;
                if (min[0] < minX) minX = min[0];
                if (min[1] < minY) minY = min[1];
                if (min[2] < minZ) minZ = min[2];
            }
            if (geoset.MaximumExtent) {
                const max = geoset.MaximumExtent;
                if (max[0] > maxX) maxX = max[0];
                if (max[1] > maxY) maxY = max[1];
                if (max[2] > maxZ) maxZ = max[2];
            }
        }

        if (modelData.Info) {
            modelData.Info.MinimumExtent = new Float32Array([minX, minY, minZ]);
            modelData.Info.MaximumExtent = new Float32Array([maxX, maxY, maxZ]);
            const dx = maxX - minX;
            const dy = maxY - minY;
            const dz = maxZ - minZ;
            modelData.Info.BoundsRadius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
        }
    }

    console.log('[ModelStore] Recalculated extent for', modelData.Geosets.length, 'geosets');
}

/**
 * 重新计算模型的所有 Geoset 的法线
 */
function recalculateModelNormals(modelData: any): void {
    if (!modelData?.Geosets) return;

    for (const geoset of modelData.Geosets) {
        recalculateGeosetNormals(geoset);
    }

    console.log('[ModelStore] Recalculated normals for', modelData.Geosets.length, 'geosets');
}

interface ModelState {
    modelData: ModelData | null;
    modelPath: string | null;
    nodes: ModelNode[];
    isLoading: boolean;
    clipboardNode: ModelNode | null;

    // Renderer reload trigger - increment to force Viewer to reload
    rendererReloadTrigger: number;

    // Geoset Visibility State
    hiddenGeosetIds: number[];
    forceShowAllGeosets: boolean;
    hoveredGeosetId: number | null;
    selectedGeosetIndex: number | null;  // Persistent selection for sync with managers

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

    // Recalculate Actions
    recalculateExtents: () => void;
    recalculateNormals: () => void;

    // Renderer reload
    triggerRendererReload: () => void;

    // Geoset Visibility Actions
    toggleGeosetVisibility: (geosetId: number) => void;
    setForceShowAllGeosets: (show: boolean) => void;
    setHoveredGeosetId: (id: number | null) => void;
    setSelectedGeosetIndex: (index: number | null) => void;
    setHiddenGeosetIds: (ids: number[]) => void;
    resetGeosetVisibility: () => void;
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

                        // Extract DontInherit flags
                        node.DontInherit = {
                            Translation: (item.Flags & 256) !== 0,  // DontInheritTranslation
                            Rotation: (item.Flags & 512) !== 0,     // DontInheritRotation
                            Scaling: (item.Flags & 1024) !== 0      // DontInheritScaling
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
                if (item.Alpha) node.SegmentAlpha = Array.from(item.Alpha);
                if (item.ParticleScaling) node.SegmentScaling = Array.from(item.ParticleScaling);
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
                    node.Squirt = (item.Flags & 256) !== 0; // Squirt is usually 0x100 (256) in Node flags, need to verify if it's different for PE2
                }

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
    nodes: ModelNode[],
    reorderIds: boolean = true
): ModelData | null {
    if (!modelData) return null;

    const updated = { ...modelData };

    // Reconstruct Flags from boolean properties before processing
    const nodesWithFlags = nodes.map(node => {
        const n = node as any;
        let flags = n.Flags || 0;

        // Clear and reset billboard/inherit flags
        flags &= ~(8 | 16 | 32 | 64 | 128 | 256 | 512 | 1024);

        if (n.Billboarded) flags |= 8;
        if (n.BillboardedLockX) flags |= 16;
        if (n.BillboardedLockY) flags |= 32;
        if (n.BillboardedLockZ) flags |= 64;
        if (n.CameraAnchored) flags |= 128;
        if (n.DontInherit?.Translation) flags |= 256;
        if (n.DontInherit?.Rotation) flags |= 512;
        if (n.DontInherit?.Scaling) flags |= 1024;

        return { ...node, Flags: flags };
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

        // Concatenate in WC3 order (excluding Camera)
        orderedNodes = [
            ...bones,
            ...lights,
            ...helpers,
            ...attachments,
            ...particleEmitters,
            ...particleEmitters2,
            ...ribbonEmitters,
            ...eventObjects,
            ...collisionShapes
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
                SortPrimsFarZ: true,
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

    // Geoset Visibility State Initial Values
    hiddenGeosetIds: [],
    forceShowAllGeosets: true,
    hoveredGeosetId: null,
    selectedGeosetIndex: null,

    // Animation State Initial Values
    sequences: [],
    currentSequence: -1,
    currentFrame: 0,
    isPlaying: true,
    playbackSpeed: 1.0,
    isLooping: true,
    autoKeyframe: false,

    setModelData: (data, path) => {
        const nodes = extractNodesFromModel(data);
        console.log('[ModelStore] Loaded model with', nodes.length, 'nodes');

        // FORCE NO REORDERING ON LOAD to prevent invalidating saved bone references
        const correctedData = updateModelDataWithNodes(data, nodes, false);

        // Auto recalculate extent and normals based on settings
        const rendererState = useRendererStore.getState();
        if (rendererState.autoRecalculateExtent) {
            recalculateModelExtent(correctedData);
        }
        if (rendererState.autoRecalculateNormals) {
            recalculateModelNormals(correctedData);
        }

        // Reset animation state on new model load
        // Initialize geosets as hidden (User request: default unchecked)
        const geosetCount = (correctedData as any)?.Geosets?.length || 0;
        const allGeosetIds = Array.from({ length: geosetCount }, (_, i) => i);

        // Extract nodes again from corrected data to get updated ObjectIds
        const correctedNodes = extractNodesFromModel(correctedData);

        set({
            modelData: correctedData,
            modelPath: path,
            nodes: correctedNodes,
            sequences: (correctedData as any)?.Sequences || [],
            currentSequence: (correctedData as any)?.Sequences?.length > 0 ? 0 : -1,
            currentFrame: 0,
            isPlaying: (correctedData as any)?.Sequences?.length > 0,
            hiddenGeosetIds: allGeosetIds,
            forceShowAllGeosets: true
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
        set({ clipboardNode: node });
    },

    pasteNode: (parentId) => {
        set((state) => {
            if (!state.clipboardNode) return {};

            // Temporary ObjectId (will be corrected by updateModelDataWithNodes)
            const maxObjectId = state.nodes.reduce((max, n) => Math.max(max, n.ObjectId), -1);
            const tempObjectId = maxObjectId + 1;

            const newNode: ModelNode = {
                ...state.clipboardNode,
                ObjectId: tempObjectId,
                Parent: parentId,
                Name: `${state.clipboardNode.Name}_Copy`,
                PivotPoint: state.clipboardNode.PivotPoint || [0, 0, 0],
            };

            const updatedNodes = [...state.nodes, newNode];
            // PASTING is adding: Must reorder
            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[], true);

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
    setSequences: (sequences) => set((state) => {
        const updatedModelData = state.modelData ? { ...state.modelData, Sequences: sequences } : state.modelData;
        return { sequences, modelData: updatedModelData, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
    }),
    setSequence: (index) => set({ currentSequence: index, currentFrame: 0 }), // Reset frame on sequence change
    setFrame: (frame) => set({ currentFrame: frame }),
    setPlaying: (playing) => set({ isPlaying: playing }),
    setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
    setLooping: (looping) => set({ isLooping: looping }),
    setAutoKeyframe: (enabled) => set({ autoKeyframe: enabled }),
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

            const updatedModelData = updateModelDataWithNodes(state.modelData, updatedNodes as any[]);
            console.log('[ModelStore] Batch updated', updates.length, 'nodes');
            return { nodes: updatedNodes as ModelNode[], modelData: updatedModelData };
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
            recalculateModelNormals(state.modelData);
            // Force update
            return { modelData: { ...state.modelData }, rendererReloadTrigger: state.rendererReloadTrigger + 1 };
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
        set({ selectedGeosetIndex: index });
    },

    setHiddenGeosetIds: (ids: number[]) => {
        set({ hiddenGeosetIds: ids });
    },

    resetGeosetVisibility: () => {
        set({ hiddenGeosetIds: [], forceShowAllGeosets: true, hoveredGeosetId: null, selectedGeosetIndex: null });
    }
}));
