import React, { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import Viewer, { ViewerRef } from './Viewer'
import MenuBar from './MenuBar'
import EditorPanel from './EditorPanel'
// Lazy load modal components for faster startup
const GeosetAnimationModal = React.lazy(() => import('./modals/GeosetAnimationModal'))
const TextureEditorModal = React.lazy(() => import('./modals/TextureEditorModal'))
const TextureAnimationManagerModal = React.lazy(() => import('./modals/TextureAnimationManagerModal'))
const SequenceEditorModal = React.lazy(() => import('./modals/SequenceEditorModal'))
const CameraManagerModal = React.lazy(() => import('./modals/CameraManagerModal'))
const UVModeLayout = React.lazy(() => import('./UVModeLayout'))
const AnimationModeLayout = React.lazy(() => import('./animation/AnimationModeLayout'))
import AnimationPanel from './AnimationPanel'
const MaterialEditorModal = React.lazy(() => import('./modals/MaterialEditorModal'))
const GeosetEditorModal = React.lazy(() => import('./modals/GeosetEditorModal'))
const GlobalSequenceModal = React.lazy(() => import('./modals/GlobalSequenceModal'))
import { GeosetVisibilityPanel } from './GeosetVisibilityPanel'
import { open } from '@tauri-apps/plugin-dialog'
import { generateMDL, generateMDX } from 'war3-model'
import { useModelStore } from '../store/modelStore'
import { NodeType } from '../types/node'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'
import { useRendererStore } from '../store/rendererStore'

/**
 * Normalize model data before saving to ensure typed arrays are correct.
 * The war3-model library expects Uint32Array for Intervals and Float32Array for extents,
 * but JSON.stringify/parse (used for cloning in editors) converts these to regular arrays.
 * 
 * Uses structuredClone to preserve existing typed arrays while only converting
 * regular arrays that need to be typed arrays.
 */
function prepareModelDataForSave(modelData: any): any {
    if (!modelData) return modelData;

    // Use structuredClone to preserve typed arrays (available in modern browsers)
    // Falls back to the original data if structuredClone isn't available
    let data: any;
    try {
        data = structuredClone(modelData);
    } catch {
        // Fallback: work with original data (will mutate it)
        console.warn('[MainLayout] structuredClone not available, modifying original data');
        data = modelData;
    }

    // Helper to convert array-like to typed array if needed
    const toUint32Array = (arr: any): Uint32Array => {
        if (arr instanceof Uint32Array) return arr;
        if (Array.isArray(arr)) return new Uint32Array(arr);
        // Handle object-like {"0": x, "1": y} from bad clones
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Uint32Array(values);
        }
        return new Uint32Array([0, 0]);
    };

    const toFloat32Array = (arr: any, size: number = 3): Float32Array => {
        // Always ensure output array is exactly 'size' elements
        const result = new Float32Array(size);

        if (arr instanceof Float32Array) {
            for (let i = 0; i < Math.min(size, arr.length); i++) {
                result[i] = arr[i];
            }
            return result;
        }
        if (Array.isArray(arr)) {
            for (let i = 0; i < Math.min(size, arr.length); i++) {
                result[i] = Number(arr[i]) || 0;
            }
            return result;
        }
        // Handle object-like {0: x, 1: y, 2: z} from bad clones
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            for (let i = 0; i < Math.min(size, values.length); i++) {
                result[i] = values[i] || 0;
            }
            return result;
        }
        return result; // Returns zero-filled array of correct size
    };

    const toUint16Array = (arr: any): Uint16Array => {
        if (arr instanceof Uint16Array) return arr;
        if (Array.isArray(arr)) return new Uint16Array(arr);
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Uint16Array(values);
        }
        return new Uint16Array(0);
    };

    const toUint8Array = (arr: any): Uint8Array => {
        if (arr instanceof Uint8Array) return arr;
        if (Array.isArray(arr)) return new Uint8Array(arr);
        if (arr && typeof arr === 'object') {
            const values = Object.values(arr).map(Number);
            return new Uint8Array(values);
        }
        return new Uint8Array(0);
    };

    // Fix AnimVector to ensure Keys is a real array and Vectors are typed arrays
    const fixAnimVector = (animVec: any, vectorSize: number = 3, isInt: boolean = false): any => {
        if (!animVec) return null;
        // If it's not an object, return null
        if (typeof animVec !== 'object') return null;
        // If Keys is not a proper array, convert or return null
        if (animVec.Keys) {
            if (!Array.isArray(animVec.Keys)) {
                // Try to convert object-like {0: k1, 1: k2} to array
                if (typeof animVec.Keys === 'object') {
                    animVec.Keys = Object.values(animVec.Keys);
                } else {
                    animVec.Keys = [];
                }
            }
            // Fix each Key's Vector, InTan, OutTan to be typed arrays
            animVec.Keys.forEach((key: any) => {
                if (key.Vector && !(key.Vector instanceof Float32Array) && !(key.Vector instanceof Int32Array)) {
                    // Convert object-like {0: v} to typed array
                    const values = Array.isArray(key.Vector) ? key.Vector : Object.values(key.Vector).map(Number);
                    key.Vector = isInt ? new Int32Array(values) : new Float32Array(values);
                }
                if (key.InTan && !(key.InTan instanceof Float32Array) && !(key.InTan instanceof Int32Array)) {
                    const values = Array.isArray(key.InTan) ? key.InTan : Object.values(key.InTan).map(Number);
                    key.InTan = isInt ? new Int32Array(values) : new Float32Array(values);
                }
                if (key.OutTan && !(key.OutTan instanceof Float32Array) && !(key.OutTan instanceof Int32Array)) {
                    const values = Array.isArray(key.OutTan) ? key.OutTan : Object.values(key.OutTan).map(Number);
                    key.OutTan = isInt ? new Int32Array(values) : new Float32Array(values);
                }
            });
        } else {
            // No Keys, this AnimVector is invalid - make it empty
            animVec.Keys = [];
        }
        // Ensure LineType is valid
        if (animVec.LineType === undefined) {
            animVec.LineType = 1; // Default to Linear
        }
        return animVec;
    };

    // Fix Node's animation properties (Translation, Rotation, Scaling)
    const fixNode = (node: any): void => {
        if (!node) return;
        if (node.Translation) {
            node.Translation = fixAnimVector(node.Translation);
            if (!node.Translation || node.Translation.Keys.length === 0) {
                node.Translation = null;
            }
        }
        if (node.Rotation) {
            node.Rotation = fixAnimVector(node.Rotation);
            if (!node.Rotation || node.Rotation.Keys.length === 0) {
                node.Rotation = null;
            }
        }
        if (node.Scaling) {
            node.Scaling = fixAnimVector(node.Scaling);
            if (!node.Scaling || node.Scaling.Keys.length === 0) {
                node.Scaling = null;
            }
        }
        // Ensure required fields
        if (node.Flags === undefined) node.Flags = 0;
        if (node.ObjectId === undefined) node.ObjectId = 0;
        if (node.Parent === undefined) node.Parent = -1;
        if (!node.Name) node.Name = 'UnnamedNode';
    };

    // Fix Sequences - most critical for animation fix
    if (data.Sequences && Array.isArray(data.Sequences)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Sequences.length} sequences`);
        data.Sequences.forEach((seq: any, index: number) => {
            // Always log interval info for debugging
            const intervalType = seq.Interval ? (seq.Interval instanceof Uint32Array ? 'Uint32Array' : Array.isArray(seq.Interval) ? 'Array' : typeof seq.Interval) : 'undefined';
            const intervalValues = seq.Interval ? `[${seq.Interval[0]}, ${seq.Interval[1]}]` : 'N/A';
            console.log(`[MainLayout] Sequence ${index} "${seq.Name}" Interval (${intervalType}): ${intervalValues}`);

            if (seq.Interval && !(seq.Interval instanceof Uint32Array)) {
                seq.Interval = toUint32Array(seq.Interval);
                console.log(`[MainLayout] -> Converted to Uint32Array: [${seq.Interval[0]}, ${seq.Interval[1]}]`);
            }
            if (seq.MinimumExtent && !(seq.MinimumExtent instanceof Float32Array)) {
                seq.MinimumExtent = toFloat32Array(seq.MinimumExtent);
            }
            if (seq.MaximumExtent && !(seq.MaximumExtent instanceof Float32Array)) {
                seq.MaximumExtent = toFloat32Array(seq.MaximumExtent);
            }
        });
    }

    // Fix Model Info extents
    if (data.Info) {
        if (data.Info.MinimumExtent && !(data.Info.MinimumExtent instanceof Float32Array)) {
            data.Info.MinimumExtent = toFloat32Array(data.Info.MinimumExtent);
        }
        if (data.Info.MaximumExtent && !(data.Info.MaximumExtent instanceof Float32Array)) {
            data.Info.MaximumExtent = toFloat32Array(data.Info.MaximumExtent);
        }
    }

    // Fix Geoset data
    if (data.Geosets && Array.isArray(data.Geosets)) {
        data.Geosets.forEach((geoset: any) => {
            if (!geoset) return;
            if (geoset.Vertices && !(geoset.Vertices instanceof Float32Array)) {
                geoset.Vertices = toFloat32Array(geoset.Vertices, geoset.Vertices.length || 0);
            }
            if (geoset.Normals && !(geoset.Normals instanceof Float32Array)) {
                geoset.Normals = toFloat32Array(geoset.Normals, geoset.Normals.length || 0);
            }
            if (geoset.Faces && !(geoset.Faces instanceof Uint16Array)) {
                geoset.Faces = toUint16Array(geoset.Faces);
            }
            if (geoset.VertexGroup && !(geoset.VertexGroup instanceof Uint8Array)) {
                geoset.VertexGroup = toUint8Array(geoset.VertexGroup);
            }
            if (geoset.MinimumExtent && !(geoset.MinimumExtent instanceof Float32Array)) {
                geoset.MinimumExtent = toFloat32Array(geoset.MinimumExtent);
            }
            if (geoset.MaximumExtent && !(geoset.MaximumExtent instanceof Float32Array)) {
                geoset.MaximumExtent = toFloat32Array(geoset.MaximumExtent);
            }
            if (geoset.TVertices && Array.isArray(geoset.TVertices)) {
                geoset.TVertices = geoset.TVertices.map((tv: any) =>
                    tv instanceof Float32Array ? tv : toFloat32Array(tv, tv?.length || 0)
                );
            }
            if (geoset.Anims && Array.isArray(geoset.Anims)) {
                geoset.Anims.forEach((anim: any) => {
                    if (anim.MinimumExtent && !(anim.MinimumExtent instanceof Float32Array)) {
                        anim.MinimumExtent = toFloat32Array(anim.MinimumExtent);
                    }
                    if (anim.MaximumExtent && !(anim.MaximumExtent instanceof Float32Array)) {
                        anim.MaximumExtent = toFloat32Array(anim.MaximumExtent);
                    }
                });
            }
        });
    }

    // Fix PivotPoints
    if (data.PivotPoints && Array.isArray(data.PivotPoints)) {
        data.PivotPoints = data.PivotPoints.map((pp: any) =>
            pp instanceof Float32Array ? pp : toFloat32Array(pp)
        );
    }

    // Fix Node PivotPoints
    const nodeArrays = ['Nodes', 'Bones', 'Helpers', 'Attachments', 'Lights',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes', 'Cameras'];
    nodeArrays.forEach(key => {
        if (data[key] && Array.isArray(data[key])) {
            data[key].forEach((node: any) => {
                if (node.PivotPoint && !(node.PivotPoint instanceof Float32Array)) {
                    node.PivotPoint = toFloat32Array(node.PivotPoint);
                }
            });
        }
    });

    // Fix Light node properties - ensure Color/AmbColor are Float32Array or valid AnimVector, and Visibility is valid
    if (data.Lights && Array.isArray(data.Lights)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Lights.length} lights`);
        data.Lights.forEach((light: any) => {
            // FIRST: Map our naming convention to war3-model naming convention
            // This must happen BEFORE we process/default the war3-model properties!

            // Map AmbientColor (our naming) to AmbColor (war3-model naming)
            if (light.AmbientColor !== undefined) {
                if (Array.isArray(light.AmbientColor)) {
                    light.AmbColor = new Float32Array(light.AmbientColor);
                } else if (light.AmbientColor instanceof Float32Array) {
                    light.AmbColor = light.AmbientColor;
                }
                // Don't delete AmbientColor - keep for UI compatibility
            }

            // Map AmbientIntensity to AmbIntensity
            if (light.AmbientIntensity !== undefined) {
                light.AmbIntensity = light.AmbientIntensity;
            }

            // SECOND: Process Color - should be Float32Array or AnimVector with Keys array
            if (light.Color) {
                if (Array.isArray(light.Color)) {
                    light.Color = new Float32Array(light.Color);
                } else if (typeof light.Color === 'object' && !(light.Color instanceof Float32Array)) {
                    // It might be an AnimVector - validate it has Keys
                    if (!light.Color.Keys || !Array.isArray(light.Color.Keys)) {
                        // Invalid AnimVector, convert to static color
                        light.Color = new Float32Array([1, 1, 1]);
                    }
                }
            } else {
                light.Color = new Float32Array([1, 1, 1]);
            }

            // THIRD: Process AmbColor (after mapping from AmbientColor)
            if (light.AmbColor) {
                if (Array.isArray(light.AmbColor)) {
                    light.AmbColor = new Float32Array(light.AmbColor);
                } else if (typeof light.AmbColor === 'object' && !(light.AmbColor instanceof Float32Array)) {
                    if (!light.AmbColor.Keys || !Array.isArray(light.AmbColor.Keys)) {
                        light.AmbColor = new Float32Array([1, 1, 1]);
                    }
                }
            } else {
                light.AmbColor = new Float32Array([1, 1, 1]);
            }

            // Ensure AmbIntensity exists (after mapping from AmbientIntensity)
            if (light.AmbIntensity === undefined) {
                light.AmbIntensity = 0;
            }

            // Ensure static numeric properties exist as numbers (not AnimVector if they're simple values)
            if (light.Intensity !== undefined && typeof light.Intensity === 'object' && light.Intensity !== null) {
                if (!light.Intensity.Keys || !Array.isArray(light.Intensity.Keys)) {
                    light.Intensity = 1; // Default to 1 if malformed
                }
            }

            if (light.AmbIntensity !== undefined && typeof light.AmbIntensity === 'object' && light.AmbIntensity !== null) {
                if (!light.AmbIntensity.Keys || !Array.isArray(light.AmbIntensity.Keys)) {
                    light.AmbIntensity = 0; // Default ambient intensity
                }
            }

            if (light.AttenuationStart !== undefined && typeof light.AttenuationStart === 'object' && light.AttenuationStart !== null) {
                if (!light.AttenuationStart.Keys || !Array.isArray(light.AttenuationStart.Keys)) {
                    light.AttenuationStart = 80;
                }
            }

            if (light.AttenuationEnd !== undefined && typeof light.AttenuationEnd === 'object' && light.AttenuationEnd !== null) {
                if (!light.AttenuationEnd.Keys || !Array.isArray(light.AttenuationEnd.Keys)) {
                    light.AttenuationEnd = 200;
                }
            }

            // Visibility - must be undefined or a valid AnimVector, NOT a number
            // In war3-model, if Visibility is present, it must be an AnimVector
            if (light.Visibility !== undefined) {
                if (typeof light.Visibility === 'number') {
                    // Static visibility - just remove it (defaults to visible)
                    delete light.Visibility;
                } else if (typeof light.Visibility === 'object' && light.Visibility !== null) {
                    if (!light.Visibility.Keys || !Array.isArray(light.Visibility.Keys)) {
                        // Malformed AnimVector - remove it
                        delete light.Visibility;
                    }
                }
            }

            // LightType should be a number (0=Omni, 1=Directional, 2=Ambient)
            if (light.LightType !== undefined && typeof light.LightType === 'string') {
                const typeMap: Record<string, number> = { 'Omnidirectional': 0, 'Directional': 1, 'Ambient': 2 };
                light.LightType = typeMap[light.LightType] ?? 0;
            }

            console.log(`[MainLayout] Light "${light.Name}": Type=${light.LightType}, Intensity=${light.Intensity}, AmbIntensity=${light.AmbIntensity}, AmbColor=[${light.AmbColor[0]?.toFixed(2)},${light.AmbColor[1]?.toFixed(2)},${light.AmbColor[2]?.toFixed(2)}]`);
        });
    }
    // Fix ParticleEmitter2 Flags - convert boolean properties to bitmask
    // ParticleEmitter2Flags: Unshaded=32768, SortPrimsFarZ=65536, LineEmitter=131072,
    //                        Unfogged=262144, ModelSpace=524288, XYQuad=1048576
    // ParticleEmitter2FramesFlags: Head=1, Tail=2  
    if (data.ParticleEmitters2 && Array.isArray(data.ParticleEmitters2)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.ParticleEmitters2.length} particle emitters`);
        data.ParticleEmitters2.forEach((emitter: any) => {
            // Reconstruct Flags bitmask from individual boolean properties
            let flags = emitter.Flags || 0;
            if (emitter.Unshaded === true) flags |= 32768;
            if (emitter.SortPrimsFarZ === true) flags |= 65536;
            if (emitter.LineEmitter === true) flags |= 131072;
            if (emitter.Unfogged === true) flags |= 262144;
            if (emitter.ModelSpace === true) flags |= 524288;
            if (emitter.XYQuad === true) flags |= 1048576;
            emitter.Flags = flags;

            // Reconstruct FrameFlags from Head/Tail booleans
            let frameFlags = emitter.FrameFlags || 0;
            if (emitter.Head === true) frameFlags |= 1;
            if (emitter.Tail === true) frameFlags |= 2;
            // Default to Head if neither is set
            if (frameFlags === 0) frameFlags = 1;
            emitter.FrameFlags = frameFlags;

            console.log(`[MainLayout] ParticleEmitter2 "${emitter.Name}": Flags=${flags}, FrameFlags=${frameFlags}`);
        });
    }

    // Fix Cameras - ensure Position and TargetPosition are Float32Arrays
    if (data.Cameras && Array.isArray(data.Cameras)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Cameras.length} cameras`);
        data.Cameras.forEach((camera: any) => {
            if (camera.Position) {
                camera.Position = toFloat32Array(camera.Position, 3);
            } else {
                camera.Position = new Float32Array([0, 0, 0]);
            }
            if (camera.TargetPosition) {
                camera.TargetPosition = toFloat32Array(camera.TargetPosition, 3);
            } else {
                camera.TargetPosition = new Float32Array([0, 0, 0]);
            }
            if (camera.Target !== undefined && !(camera.Target instanceof Float32Array)) {
                camera.Target = toFloat32Array(camera.Target, 3);
            }
        });
    }

    // Fix CollisionShapes - ensure Vertices are Float32Arrays
    if (data.CollisionShapes && Array.isArray(data.CollisionShapes)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.CollisionShapes.length} collision shapes`);
        data.CollisionShapes.forEach((shape: any) => {
            // Shape 0 = Box (6 floats), Shape 2 = Sphere (3 floats)
            const vertexCount = shape.Shape === 0 ? 6 : 3;
            if (shape.Vertices) {
                shape.Vertices = toFloat32Array(shape.Vertices, vertexCount);
            } else {
                shape.Vertices = new Float32Array(vertexCount);
            }
            fixNode(shape); // CollisionShapes are also Nodes
        });
    }

    // Fix all node-type arrays to ensure AnimVector data is valid
    const nodeArrayNames = ['Bones', 'Helpers', 'Attachments', 'EventObjects', 'Lights', 'RibbonEmitters', 'ParticleEmitters', 'ParticleEmitters2', 'Cameras'];
    nodeArrayNames.forEach(arrayName => {
        if (data[arrayName] && Array.isArray(data[arrayName])) {
            data[arrayName].forEach((node: any) => fixNode(node));
        }
    });

    // Fix Geosets - ensure TotalGroupsCount is consistent with Groups array
    if (data.Geosets && Array.isArray(data.Geosets)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Geosets.length} geosets`);
        data.Geosets.forEach((geoset: any, index: number) => {
            // Recalculate TotalGroupsCount from Groups array
            if (geoset.Groups && Array.isArray(geoset.Groups)) {
                const totalCount = geoset.Groups.reduce((sum: number, group: any) => {
                    return sum + (Array.isArray(group) ? group.length : 0);
                }, 0);
                if (geoset.TotalGroupsCount !== totalCount) {
                    console.log(`[MainLayout] Geoset ${index}: Updating TotalGroupsCount from ${geoset.TotalGroupsCount} to ${totalCount}`);
                    geoset.TotalGroupsCount = totalCount;
                }
            }
            // Ensure VertexGroup is Uint8Array
            if (geoset.VertexGroup && !(geoset.VertexGroup instanceof Uint8Array)) {
                geoset.VertexGroup = toUint8Array(geoset.VertexGroup);
            }
            // Ensure Faces is Uint16Array
            if (geoset.Faces && !(geoset.Faces instanceof Uint16Array)) {
                geoset.Faces = toUint16Array(geoset.Faces);
            }
        });
    }

    // Fix Materials - ensure all layer properties are valid for MDX generator
    if (data.Materials && Array.isArray(data.Materials)) {
        console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Materials.length} materials`);
        data.Materials.forEach((material: any, matIndex: number) => {
            // Ensure material properties
            if (material.PriorityPlane === undefined) material.PriorityPlane = 0;
            if (material.RenderMode === undefined) material.RenderMode = 0;

            if (material.Layers && Array.isArray(material.Layers)) {
                material.Layers.forEach((layer: any, layerIndex: number) => {
                    // FilterMode - required, default to 0 (None)
                    if (layer.FilterMode === undefined || layer.FilterMode === null) {
                        layer.FilterMode = 0;
                    }

                    // Shading - required, default to 0
                    // Rebuild from boolean flags if they exist
                    if (layer.Shading === undefined) {
                        let shading = 0;
                        if (layer.Unshaded) shading |= 1;
                        if (layer.SphereEnvMap) shading |= 2;
                        if (layer.TwoSided) shading |= 16;
                        if (layer.Unfogged) shading |= 32;
                        if (layer.NoDepthTest) shading |= 64;
                        if (layer.NoDepthSet) shading |= 128;
                        layer.Shading = shading;
                    }

                    // TextureID - can be number or AnimVector, default to 0
                    if (layer.TextureID === undefined || layer.TextureID === null) {
                        layer.TextureID = 0;
                    } else if (typeof layer.TextureID === 'object') {
                        // Fix AnimVector Key Vectors to be Int32Array
                        layer.TextureID = fixAnimVector(layer.TextureID, 1, true);
                    }

                    // TVertexAnimId - can be null or number, convert undefined to null
                    if (layer.TVertexAnimId === undefined) {
                        layer.TVertexAnimId = null;
                    }

                    // CoordId - required, default to 0
                    if (layer.CoordId === undefined || layer.CoordId === null) {
                        layer.CoordId = 0;
                    }

                    // Alpha - required, default to 1
                    if (layer.Alpha === undefined || layer.Alpha === null) {
                        layer.Alpha = 1;
                    } else if (typeof layer.Alpha === 'object') {
                        // Fix AnimVector Key Vectors to be Float32Array
                        layer.Alpha = fixAnimVector(layer.Alpha, 1, false);
                    }

                    console.log(`[MainLayout] Material[${matIndex}].Layer[${layerIndex}]: FilterMode=${layer.FilterMode}, Shading=${layer.Shading}, TextureID=${typeof layer.TextureID === 'number' ? layer.TextureID : 'AnimVector'}, TVertexAnimId=${layer.TVertexAnimId}, CoordId=${layer.CoordId}, Alpha=${typeof layer.Alpha === 'number' ? layer.Alpha : 'AnimVector'}`);
                });
            }
        });
    }

    return data;
}

/**
 * Validate model data before export to catch potential format errors.
 * Returns an array of warning/error messages, empty array if valid.
 */
function validateModelData(data: any): string[] {
    const errors: string[] = [];

    if (!data) {
        errors.push('Model data is null or undefined');
        return errors;
    }

    // 1. Check ObjectId uniqueness
    const allNodeArrays = [
        ...(data.Bones || []),
        ...(data.Lights || []),
        ...(data.Helpers || []),
        ...(data.Attachments || []),
        ...(data.ParticleEmitters || []),
        ...(data.ParticleEmitters2 || []),
        ...(data.RibbonEmitters || []),
        ...(data.EventObjects || []),
        ...(data.CollisionShapes || [])
    ];

    const objectIds = allNodeArrays.map((n: any) => n.ObjectId);
    const uniqueIds = new Set(objectIds);
    if (uniqueIds.size !== objectIds.length) {
        errors.push(`Duplicate ObjectIds detected: ${objectIds.length} nodes but only ${uniqueIds.size} unique IDs`);
    }

    // 2. Check for gaps in ObjectId sequence
    const sortedIds = [...uniqueIds].filter(id => typeof id === 'number').sort((a, b) => a - b);
    for (let i = 0; i < sortedIds.length; i++) {
        if (sortedIds[i] !== i) {
            errors.push(`ObjectId sequence has gaps: expected ${i}, found ${sortedIds[i]}`);
            break;
        }
    }

    // 3. Validate Parent references
    const validIds = new Set(sortedIds);
    validIds.add(-1); // -1 is valid (root)
    for (const node of allNodeArrays) {
        if (node.Parent !== undefined && node.Parent !== null && !validIds.has(node.Parent)) {
            errors.push(`Node "${node.Name}" (ObjectId=${node.ObjectId}) has invalid Parent=${node.Parent}`);
        }
    }

    // 4. Check PivotPoints count
    const expectedPivotCount = sortedIds.length > 0 ? sortedIds[sortedIds.length - 1] + 1 : 0;
    const actualPivotCount = data.PivotPoints?.length || 0;
    if (actualPivotCount !== expectedPivotCount) {
        errors.push(`PivotPoints count mismatch: expected ${expectedPivotCount}, found ${actualPivotCount}`);
    }

    // 5. Check node type order (WC3 format requirement)
    const typeOrder = ['Bone', 'Light', 'Helper', 'Attachment', 'ParticleEmitter', 'ParticleEmitter2', 'RibbonEmitter', 'EventObject', 'CollisionShape'];
    let lastTypeIndex = -1;
    let lastObjectId = -1;

    for (const typeName of typeOrder) {
        const arrayName = typeName === 'Bone' ? 'Bones' :
            typeName === 'Light' ? 'Lights' :
                typeName === 'Helper' ? 'Helpers' :
                    typeName === 'Attachment' ? 'Attachments' :
                        typeName === 'ParticleEmitter' ? 'ParticleEmitters' :
                            typeName === 'ParticleEmitter2' ? 'ParticleEmitters2' :
                                typeName === 'RibbonEmitter' ? 'RibbonEmitters' :
                                    typeName === 'EventObject' ? 'EventObjects' :
                                        'CollisionShapes';

        const nodes = data[arrayName] || [];
        for (const node of nodes) {
            if (node.ObjectId < lastObjectId) {
                // This is okay if it's within the same type, but not across types
            }
            lastObjectId = Math.max(lastObjectId, node.ObjectId);
        }
    }

    // 6. Check for missing required fields
    for (const node of allNodeArrays) {
        if (node.ObjectId === undefined || node.ObjectId === null) {
            errors.push(`Node "${node.Name}" is missing ObjectId`);
        }
        if (!node.PivotPoint && !data.PivotPoints?.[node.ObjectId]) {
            errors.push(`Node "${node.Name}" (ObjectId=${node.ObjectId}) is missing PivotPoint`);
        }
    }

    // 7. Check Geoset integrity
    if (data.Geosets) {
        for (let i = 0; i < data.Geosets.length; i++) {
            const geoset = data.Geosets[i];
            if (!geoset.Vertices || geoset.Vertices.length === 0) {
                errors.push(`Geoset ${i} has no vertices`);
            }
            if (!geoset.Faces || geoset.Faces.length === 0) {
                errors.push(`Geoset ${i} has no faces`);
            }
            // Check bone references in Groups
            if (geoset.Groups) {
                for (let g = 0; g < geoset.Groups.length; g++) {
                    const group = geoset.Groups[g];
                    if (Array.isArray(group)) {
                        for (const boneId of group) {
                            if (!validIds.has(boneId) && boneId !== -1) {
                                errors.push(`Geoset ${i} Group ${g} references invalid bone ObjectId=${boneId}`);
                            }
                        }
                    }
                }
            }
        }
    }

    return errors;
}

const MainLayout: React.FC = () => {
    // Zustand stores
    const modelPath = useModelStore(state => state.modelPath)
    const setZustandModelData = useModelStore(state => state.setModelData)
    const setZustandLoading = useModelStore(state => state.setLoading)
    const currentSequence = useModelStore(state => state.currentSequence)
    const isPlaying = useModelStore(state => state.isPlaying)
    const playbackSpeed = useModelStore(state => state.playbackSpeed)
    const setPlaying = useModelStore(state => state.setPlaying)
    const { toggleNodeManager, toggleModelInfo } = useUIStore()
    const { mainMode, setMainMode } = useSelectionStore()



    const [activeEditor, setActiveEditor] = useState<string | null>(null)
    const [showGeosetAnimModal, setShowGeosetAnimModal] = useState<boolean>(false)
    const [showTextureModal, setShowTextureModal] = useState<boolean>(false)
    const [showTextureAnimModal, setShowTextureAnimModal] = useState<boolean>(false)
    const [showSequenceModal, setShowSequenceModal] = useState<boolean>(false)
    const [showCameraModal, setShowCameraModal] = useState<boolean>(false)

    const [showMaterialModal, setShowMaterialModal] = useState<boolean>(false)
    const [showGeosetModal, setShowGeosetModal] = useState<boolean>(false)
    const [showGlobalSeqModal, setShowGlobalSeqModal] = useState<boolean>(false)


    // Use modelData directly from store to ensure updates from NodeManager are reflected
    const modelData = useModelStore(state => state.modelData)


    // Persistent settings
    // Persistent settings replaced by store
    const {
        showGridXY,
        showNodes, setShowNodes,
        showSkeleton, setShowSkeleton,
        showFPS, setShowFPS,
        showGeosetVisibility, setShowGeosetVisibility,
        showCollisionShapes, setShowCollisionShapes,
        showCameras, setShowCameras,
        showLights, setShowLights,
        renderMode, setRenderMode,
        backgroundColor, setBackgroundColor,
        teamColor, setTeamColor,
        mpqLoaded, setMpqLoaded
    } = useRendererStore();

    // Load initial settings into store (optional, or rely on store defaults)
    // Settings are now handled by rendererStore persistence
    const [viewPreset, setViewPreset] = useState<{ type: string, time: number } | null>(null)
    // removed local mpqLoaded


    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [isDragging, setIsDragging] = useState<boolean>(false) // For drag-drop visual feedback

    // Editor Panel Resizing
    const [editorWidth, setEditorWidth] = useState<number>(400)
    const [isResizingEditor, setIsResizingEditor] = useState<boolean>(false)

    const viewerRef = useRef<ViewerRef>(null)

    // Check for pending model path after page refresh
    useEffect(() => {
        const pendingPath = localStorage.getItem('pending_model_path');
        if (pendingPath) {
            console.log('[MainLayout] Loading pending model from refresh:', pendingPath);
            // Clear the pending path
            localStorage.removeItem('pending_model_path');
            // Load the model
            setIsLoading(true);
            setZustandLoading(true);
            setZustandModelData(null, pendingPath);
            setIsLoading(false);
            setZustandLoading(false);
        }

        // Check for file path from command line (Tauri - context menu launch)
        const checkCliFilePath = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const cliPath = await invoke<string | null>('get_cli_file_path');
                if (cliPath) {
                    console.log('[MainLayout] File opened from command line:', cliPath);

                    // CRITICAL: Load MPQ first before loading model (for textures)
                    const savedPaths = localStorage.getItem('mpq_paths');
                    if (savedPaths && !mpqLoaded) {
                        console.log('[MainLayout] Loading MPQs before model...');
                        try {
                            const paths = JSON.parse(savedPaths);
                            const results = await Promise.allSettled(
                                paths.map((path: string) => invoke('load_mpq', { path }))
                            );
                            const successCount = results.filter(r => r.status === 'fulfilled').length;
                            if (successCount > 0) {
                                setMpqLoaded(true);
                                console.log(`[MainLayout] Loaded ${successCount} MPQs before opening model`);
                            }
                        } catch (e) {
                            console.error('[MainLayout] MPQ pre-load failed:', e);
                        }
                    }

                    // Now load the model
                    setIsLoading(true);
                    setZustandLoading(true);
                    setZustandModelData(null, cliPath);
                    setIsLoading(false);
                    setZustandLoading(false);
                }
            } catch (e) {
                console.error('[MainLayout] Failed to get CLI file path:', e);
            }
        };
        checkCliFilePath();
    }, []); // Run once on mount

    // Listen for file open from Electron context menu (right-click "Open with")
    useEffect(() => {
        // Check if running in Electron and api is available
        const api = (window as any).api;
        if (api && api.onOpenFile) {
            console.log('[MainLayout] Registering Electron file open listener');
            api.onOpenFile((filePath: string) => {
                console.log('[MainLayout] File opened from context menu:', filePath);
                if (filePath && (filePath.endsWith('.mdx') || filePath.endsWith('.mdl'))) {
                    // Check if a model is already loaded - if so, save path and refresh page
                    const currentModelPath = useModelStore.getState().modelPath;
                    if (currentModelPath) {
                        console.log('[MainLayout] Model already loaded, refreshing page before importing new model');
                        localStorage.setItem('pending_model_path', filePath);
                        window.location.reload();
                        return;
                    }

                    setIsLoading(true);
                    setZustandLoading(true);
                    setZustandModelData(null, filePath);
                    setIsLoading(false);
                    setZustandLoading(false);
                }
            });
        }
    }, [setZustandModelData, setZustandLoading]);

    const handleAddCameraFromView = () => {
        if (viewerRef.current) {
            const cam = viewerRef.current.getCamera()
            const { addNode, nodes } = useModelStore.getState()

            // Calculate Position and Target
            // In War3 MDX, Camera has Position and Target.
            // Viewer uses Orbit Camera: Target, Distance, Theta, Phi.
            // Position = Target + SphericalToCartesian(Distance, Theta, Phi)

            const { distance, theta, phi, target } = cam

            // Calculate Camera Position
            const cx = distance * Math.sin(phi) * Math.cos(theta)
            const cy = distance * Math.sin(phi) * Math.sin(theta)
            const cz = distance * Math.cos(phi)

            const cameraPos = [cx + target[0], cy + target[1], cz + target[2]]

            // Create camera with required Position/TargetPosition (Float32Array) for MDX generator
            // And optional Translation/TargetTranslation (AnimVector) for animation
            const newCamera = {
                Name: `Camera ${nodes.filter((n: any) => n.type === NodeType.CAMERA).length + 1}`,
                type: NodeType.CAMERA,
                FieldOfView: 0.7853, // 45 deg
                NearClip: 16,
                FarClip: 5000,
                // Static Position/TargetPosition required by MDX format (Float32Array)
                Position: new Float32Array([cameraPos[0], cameraPos[1], cameraPos[2]]),
                TargetPosition: new Float32Array([target[0], target[1], target[2]]),
                // Animated Translation/TargetTranslation (optional, for camera animation keyframes)
                Translation: {
                    LineType: 0,
                    GlobalSeqId: null,
                    Keys: [{ Frame: 0, Vector: new Float32Array([cameraPos[0], cameraPos[1], cameraPos[2]]) }]
                },
                TargetTranslation: {
                    LineType: 0,
                    GlobalSeqId: null,
                    Keys: [{ Frame: 0, Vector: new Float32Array([target[0], target[1], target[2]]) }]
                }
            }

            addNode(newCamera as any)
        }
    }

    const handleViewCamera = (cameraNode: any) => {
        if (viewerRef.current && cameraNode) {
            console.log('handleViewCamera', cameraNode)

            const isArrayLike = (v: any) => Array.isArray(v) || v instanceof Float32Array || ArrayBuffer.isView(v);
            const toArray = (v: any) => v instanceof Float32Array ? Array.from(v) : v;

            const getPos = (prop: any, directProp?: any) => {
                if (directProp && isArrayLike(directProp)) return toArray(directProp)
                if (isArrayLike(prop)) return toArray(prop)
                if (prop && prop.Keys && prop.Keys.length > 0) {
                    const v = prop.Keys[0].Vector
                    return v ? toArray(v) : [0, 0, 0]
                }
                return [0, 0, 0]
            }

            const pos = getPos(cameraNode.Translation, cameraNode.Position)
            const target = getPos(cameraNode.TargetTranslation, cameraNode.TargetPosition)

            console.log('Camera Pos:', pos, 'Target:', target)

            const dx = pos[0] - target[0]
            const dy = pos[1] - target[1]
            const dz = pos[2] - target[2]

            let distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (distance < 0.1) distance = 100;

            let phi = Math.acos(dz / distance)
            if (isNaN(phi)) phi = Math.PI / 4;
            phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi))

            let theta = Math.atan2(dy, dx)
            if (isNaN(theta)) theta = 0;

            console.log(' Calculated:', { distance, theta, phi })

            viewerRef.current.setCamera({
                distance,
                theta,
                phi,
                target: [target[0], target[1], target[2]]
            })
        }
    }

    const handleEditorResizeStart = (e: React.MouseEvent) => {
        setIsResizingEditor(true)
        e.preventDefault()
    }

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingEditor) return
            const newWidth = window.innerWidth - e.clientX
            if (newWidth >= 300 && newWidth <= 800) {
                setEditorWidth(newWidth)
            }
        }

        const handleMouseUp = () => {
            setIsResizingEditor(false)
        }

        if (isResizingEditor) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizingEditor])

    // Save settings when they change
    useEffect(() => localStorage.setItem('teamColor', JSON.stringify(teamColor)), [teamColor])
    useEffect(() => localStorage.setItem('showGrid', JSON.stringify(showGridXY)), [showGridXY])
    useEffect(() => localStorage.setItem('showNodes', JSON.stringify(showNodes)), [showNodes])
    useEffect(() => localStorage.setItem('showSkeleton', JSON.stringify(showSkeleton)), [showSkeleton])
    useEffect(() => localStorage.setItem('showLights', JSON.stringify(showLights)), [showLights])
    useEffect(() => localStorage.setItem('renderMode', JSON.stringify(renderMode)), [renderMode])
    useEffect(() => localStorage.setItem('backgroundColor', JSON.stringify(backgroundColor)), [backgroundColor])
    useEffect(() => localStorage.setItem('showFPS', JSON.stringify(showFPS)), [showFPS])

    // Auto-load MPQs (DEFERRED for faster startup)
    useEffect(() => {
        const loadSavedMpqs = async () => {
            const { invoke } = await import('@tauri-apps/api/core')
            const savedPaths = localStorage.getItem('mpq_paths')

            if (savedPaths) {
                try {
                    const paths = JSON.parse(savedPaths)
                    // OPTIMIZATION: Load all MPQs in parallel
                    const results = await Promise.allSettled(
                        paths.map((path: string) => invoke('load_mpq', { path }))
                    )
                    const successCount = results.filter(r => r.status === 'fulfilled').length
                    if (successCount > 0) {
                        setMpqLoaded(true)
                    }
                } catch (e) {
                    console.error('[MainLayout] Failed to auto-load saved MPQs:', e)
                    setMpqLoaded(false)
                }
            } else {
                // Try auto-detection from Registry
                try {
                    console.log('[MainLayout] Attempting to auto-detect Warcraft III path...')
                    const installPath = await invoke<string>('detect_warcraft_path')
                    if (installPath) {
                        console.log('[MainLayout] Detected Warcraft III path:', installPath)
                        const mpqs = ['war3.mpq', 'War3Patch.mpq', 'War3x.mpq', 'War3xLocal.mpq']
                        const basePath = installPath.endsWith('\\') ? installPath : `${installPath}\\`
                        const pathsToLoad = mpqs.map(mpq => `${basePath}${mpq}`)

                        // OPTIMIZATION: Load all MPQs in parallel
                        const results = await Promise.allSettled(
                            pathsToLoad.map(path => invoke('load_mpq', { path }))
                        )

                        const validPaths = pathsToLoad.filter((_, i) => results[i].status === 'fulfilled')
                        const successCount = validPaths.length

                        if (successCount > 0) {
                            console.log(`[MainLayout] Loaded ${successCount} MPQ files in parallel`)
                            localStorage.setItem('mpq_paths', JSON.stringify(validPaths))
                            setMpqLoaded(true)
                        }
                    }
                } catch (e) {
                    console.log('[MainLayout] Auto-detection failed (registry key not found or error):', e)
                    setMpqLoaded(false)
                }
            }
        }
        // OPTIMIZATION: Defer MPQ loading by 500ms to allow UI to render first
        const timer = setTimeout(() => {
            loadSavedMpqs()
        }, 500)
        return () => clearTimeout(timer)
    }, [])
    // Manager Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return

            // Skip if Ctrl/Meta is pressed (used for copy/paste operations)
            if (e.ctrlKey || e.metaKey) return

            const key = e.key.toLowerCase()

            switch (key) {
                case 'n': toggleNodeManager(); break;
                case 'c': setShowCameraModal(prev => !prev); break;
                case 'g': setShowGeosetModal(prev => !prev); break;
                case 'u': setShowGeosetAnimModal(prev => !prev); break;
                case 't': setShowTextureModal(prev => !prev); break;
                case 'x': setShowTextureAnimModal(prev => !prev); break;
                case 'm': setShowMaterialModal(prev => !prev); break;
                case 's': setShowSequenceModal(prev => !prev); break;
                case 'l': setShowGlobalSeqModal(prev => !prev); break;
                // Mode Switching Shortcuts
                case 'f1': e.preventDefault(); useSelectionStore.getState().setMainMode('view'); break;
                case 'f2': e.preventDefault(); useSelectionStore.getState().setMainMode('geometry'); break;
                case 'f3': e.preventDefault(); useSelectionStore.getState().setMainMode('uv'); break;
                case 'f4': e.preventDefault(); useSelectionStore.getState().setMainMode('animation'); break;
                // View Preset Shortcuts (0=perspective, 1-6=orthographic)
                case '0': setViewPreset({ type: 'perspective', time: Date.now() }); break;
                case '1': setViewPreset({ type: 'top', time: Date.now() }); break;
                case '2': setViewPreset({ type: 'bottom', time: Date.now() }); break;
                case '3': setViewPreset({ type: 'front', time: Date.now() }); break;
                case '4': setViewPreset({ type: 'back', time: Date.now() }); break;
                case '5': setViewPreset({ type: 'left', time: Date.now() }); break;
                case '6': setViewPreset({ type: 'right', time: Date.now() }); break;
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [toggleNodeManager])

    const handleImport = useCallback(async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: '魔兽争霸3模型',
                    extensions: ['mdx', 'mdl']
                }]
            })

            if (selected && typeof selected === 'string') {
                // Check if a model is already loaded - if so, save path and refresh page
                const currentModelPath = useModelStore.getState().modelPath;
                if (currentModelPath) {
                    console.log('[MainLayout] Model already loaded, refreshing page before importing new model');
                    // Save the new path to localStorage for auto-load after refresh
                    localStorage.setItem('pending_model_path', selected);
                    // Trigger page reload
                    window.location.reload();
                    return;
                }

                setIsLoading(true)
                setZustandLoading(true)
                // Clear modelData to ensure fresh load from file
                setZustandModelData(null, selected)

                setIsLoading(false)
                setZustandLoading(false)
            }
        } catch (error) {
            console.error('Failed to open file dialog:', error)
            setIsLoading(false)
            setZustandLoading(false)
        }
    }, [setZustandModelData, setZustandLoading])

    const handleModelLoaded = useCallback((data: any) => {
        console.log('Model loaded:', data)
        // setModelData(data) // No longer needed as we use store
        setZustandModelData(data, data.path || modelPath) // Ensure store is updated
        setIsLoading(false)
        setZustandLoading(false)

        // Reset State on New Model Load FIRST (before auto-play)
        // Reset State on New Model Load FIRST (before auto-play)
        // Guard: If model path is same, don't reset state (it's a reload/update)
        const isSameModel = data.path === modelPath
        if (!isSameModel) {
            setMainMode('view')
            useSelectionStore.getState().clearAllSelections()
        }

        // Auto-play first animation if available
        if (data && data.Sequences && data.Sequences.length > 0) {
            // Use a small timeout to ensure the renderer is ready
            setTimeout(() => {
                // Only reset sequence if it's a new model or we aren't playing anything valid
                // This prevents resetting to 0 when deleting particles on same model
                if (!isSameModel || useModelStore.getState().currentSequence === -1) {
                    console.log('[MainLayout] Auto-playing first animation (New Model or Reset)')
                    useModelStore.getState().setSequence(0)
                    useModelStore.getState().setPlaying(true)
                } else {
                    console.log('[MainLayout] Preserving existing animation sequence:', useModelStore.getState().currentSequence)
                }
            }, 300)
        } else {
            // No sequences available, reset to no animation
            useModelStore.getState().setSequence(-1)
            setPlaying(false)
        }

        // Reset Camera (using a custom event or store if possible, but for now we rely on Viewer's internal reset if path changes)
        // Actually Viewer handles camera reset on new model path if we implement it there, 
        // but we can also force it here if we had access. 
        // For now, the Viewer component will see the new modelPath and re-init.
    }, [setZustandModelData, setZustandLoading, modelPath, setMainMode, setPlaying])


    const handleOpen = handleImport // Alias for MenuBar

    // Tauri file drag-drop listeners (works with dragDropEnabled: true and mouse-based node tree drag)
    useEffect(() => {
        let unlistenDrop: (() => void) | undefined
        let unlistenEnter: (() => void) | undefined
        let unlistenLeave: (() => void) | undefined

        const setupDragDropListeners = async () => {
            try {
                const { listen } = await import('@tauri-apps/api/event')

                // Listen for file drop
                unlistenDrop = await listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
                    setIsDragging(false)
                    const paths = event.payload.paths
                    if (!paths || paths.length === 0) return

                    const filePath = paths[0]
                    const ext = filePath.toLowerCase().split('.').pop()

                    if (ext !== 'mdx' && ext !== 'mdl') {
                        console.warn('[MainLayout] Invalid file type:', ext, '- only .mdx and .mdl are supported')
                        return
                    }

                    console.log('[MainLayout] File dropped (Tauri):', filePath)

                    // Check if a model is already loaded - if so, save path and refresh page
                    const currentModelPath = useModelStore.getState().modelPath
                    if (currentModelPath) {
                        console.log('[MainLayout] Model already loaded, refreshing page before importing new model')
                        localStorage.setItem('pending_model_path', filePath)
                        window.location.reload()
                        return
                    }

                    setIsLoading(true)
                    setZustandLoading(true)
                    setZustandModelData(null, filePath)
                    setIsLoading(false)
                    setZustandLoading(false)
                })

                // Listen for drag enter
                unlistenEnter = await listen('tauri://drag-enter', () => {
                    setIsDragging(true)
                })

                // Listen for drag leave
                unlistenLeave = await listen('tauri://drag-leave', () => {
                    setIsDragging(false)
                })

            } catch (error) {
                console.error('[MainLayout] Failed to setup drag-drop listeners:', error)
            }
        }

        setupDragDropListeners()

        return () => {
            unlistenDrop?.()
            unlistenEnter?.()
            unlistenLeave?.()
        }
    }, [setZustandModelData, setZustandLoading])



    const handleSave = async () => {
        if (!modelPath || !modelData) return
        try {
            const { writeFile } = await import('@tauri-apps/plugin-fs')

            // Prepare model data with correct typed arrays
            const preparedData = prepareModelDataForSave(modelData);

            // Validate model data before export
            const validationErrors = validateModelData(preparedData);
            if (validationErrors.length > 0) {
                console.warn('[MainLayout] Model validation warnings:', validationErrors);
                // Show first 3 errors to user
                const errorMsg = validationErrors.slice(0, 3).join('\n');
                const proceed = confirm(`模型验证发现以下问题:\n${errorMsg}\n${validationErrors.length > 3 ? `...还有 ${validationErrors.length - 3} 个问题` : ''}\n\n是否仍然保存?`);
                if (!proceed) return;
            }

            // Fix FrameFlags for ParticleEmitter2 to prevent save corruption
            if (preparedData.ParticleEmitters2) {
                preparedData.ParticleEmitters2.forEach((emitter: any) => {
                    if (typeof emitter.Head === 'boolean' || typeof emitter.Tail === 'boolean') {
                        let flags = 0
                        if (emitter.Head) flags |= 1
                        if (emitter.Tail) flags |= 2
                        if (flags === 0) flags = 1
                        emitter.FrameFlags = flags
                    } else if (emitter.FrameFlags === undefined) {
                        emitter.FrameFlags = 1
                    }
                })
            }

            if (modelPath.toLowerCase().endsWith('.mdl')) {
                const content = generateMDL(preparedData)
                await writeFile(modelPath, new TextEncoder().encode(content))
            } else {
                const buffer = generateMDX(preparedData)
                await writeFile(modelPath, new Uint8Array(buffer))
            }

            alert('模型已保存')
        } catch (err) {
            console.error('Failed to save file:', err)
            alert('保存失败: ' + err)
        }
    }

    const handleSaveAs = async () => {
        if (!modelData) return
        try {
            const { save } = await import('@tauri-apps/plugin-dialog')
            const { writeFile } = await import('@tauri-apps/plugin-fs')

            const selected = await save({
                filters: [{
                    name: 'Warcraft 3 Models',
                    extensions: ['mdx', 'mdl']
                }]
            })

            if (selected) {
                // Prepare model data with correct typed arrays
                const preparedData = prepareModelDataForSave(modelData);

                // Validate model data before export
                const validationErrors = validateModelData(preparedData);
                if (validationErrors.length > 0) {
                    console.warn('[MainLayout] SaveAs validation warnings:', validationErrors);
                    const errorMsg = validationErrors.slice(0, 3).join('\n');
                    const proceed = confirm(`模型验证发现以下问题:\n${errorMsg}\n${validationErrors.length > 3 ? `...还有 ${validationErrors.length - 3} 个问题` : ''}\n\n是否仍然保存?`);
                    if (!proceed) return;
                }

                // Fix FrameFlags for ParticleEmitter2
                if (preparedData.ParticleEmitters2) {
                    preparedData.ParticleEmitters2.forEach((emitter: any) => {
                        if (typeof emitter.Head === 'boolean' || typeof emitter.Tail === 'boolean') {
                            let flags = 0
                            if (emitter.Head) flags |= 1
                            if (emitter.Tail) flags |= 2
                            if (flags === 0) flags = 1
                            emitter.FrameFlags = flags
                        } else if (emitter.FrameFlags === undefined) {
                            emitter.FrameFlags = 1
                        }
                    })
                }

                if (selected.toLowerCase().endsWith('.mdl')) {
                    const content = generateMDL(preparedData)
                    await writeFile(selected, new TextEncoder().encode(content))
                } else {
                    const buffer = generateMDX(preparedData)
                    await writeFile(selected, new Uint8Array(buffer))
                }
                // Update store with new path if needed, but for now just alert
                alert('模型已另存为: ' + selected)
            }
        } catch (err) {
            console.error('Failed to save file as:', err)
            alert('另存为失�? ' + err)
        }
    }

    // Helper function to get model name from path or default
    const getModelBaseName = (): string => {
        if (modelPath) {
            const filename = modelPath.split(/[/\\]/).pop() || 'model'
            // Remove extension
            return filename.replace(/\.(mdx|mdl)$/i, '')
        }
        return 'model'
    }

    const handleExportMDL = async () => {
        if (!modelData) return
        try {
            const { save } = await import('@tauri-apps/plugin-dialog')
            const { writeFile } = await import('@tauri-apps/plugin-fs')

            const defaultName = getModelBaseName() + '.mdl'

            const selected = await save({
                defaultPath: defaultName,
                filters: [{
                    name: 'MDL Models',
                    extensions: ['mdl']
                }]
            })

            if (selected) {
                // Ensure .mdl extension
                let filePath = selected
                if (!filePath.toLowerCase().endsWith('.mdl')) {
                    filePath += '.mdl'
                }

                const preparedData = prepareModelDataForSave(modelData)

                // Validate before export
                const validationErrors = validateModelData(preparedData);
                if (validationErrors.length > 0) {
                    console.warn('[MainLayout] Export MDL validation warnings:', validationErrors);
                    const errorMsg = validationErrors.slice(0, 3).join('\n');
                    const proceed = confirm(`模型验证发现以下问题:\n${errorMsg}\n${validationErrors.length > 3 ? `...还有 ${validationErrors.length - 3} 个问题` : ''}\n\n是否仍然导出?`);
                    if (!proceed) return;
                }

                fixParticleEmitterFlags(preparedData)

                const content = generateMDL(preparedData)
                await writeFile(filePath, new TextEncoder().encode(content))
                alert('已导出为 MDL: ' + filePath)
            }
        } catch (err) {
            console.error('Failed to export MDL:', err)
            alert('导出 MDL 失败: ' + err)
        }
    }

    const handleExportMDX = async () => {
        if (!modelData) return
        try {
            const { save } = await import('@tauri-apps/plugin-dialog')
            const { writeFile } = await import('@tauri-apps/plugin-fs')

            const defaultName = getModelBaseName() + '.mdx'

            const selected = await save({
                defaultPath: defaultName,
                filters: [{
                    name: 'MDX Models',
                    extensions: ['mdx']
                }]
            })

            if (selected) {
                // Ensure .mdx extension
                let filePath = selected
                if (!filePath.toLowerCase().endsWith('.mdx')) {
                    filePath += '.mdx'
                }

                const preparedData = prepareModelDataForSave(modelData)

                // Validate before export
                const validationErrors = validateModelData(preparedData);
                if (validationErrors.length > 0) {
                    console.warn('[MainLayout] Export MDX validation warnings:', validationErrors);
                    const errorMsg = validationErrors.slice(0, 3).join('\n');
                    const proceed = confirm(`模型验证发现以下问题:\n${errorMsg}\n${validationErrors.length > 3 ? `...还有 ${validationErrors.length - 3} 个问题` : ''}\n\n是否仍然导出?`);
                    if (!proceed) return;
                }

                fixParticleEmitterFlags(preparedData)

                const buffer = generateMDX(preparedData)
                await writeFile(filePath, new Uint8Array(buffer))
                alert('已导出为 MDX: ' + filePath)
            }
        } catch (err) {
            console.error('Failed to export MDX:', err)
            alert('导出 MDX 失败: ' + err)
        }
    }

    // Helper to fix ParticleEmitter2 flags (extracted from save functions)
    const fixParticleEmitterFlags = (preparedData: any) => {
        if (preparedData.ParticleEmitters2) {
            preparedData.ParticleEmitters2.forEach((emitter: any) => {
                if (typeof emitter.Head === 'boolean' || typeof emitter.Tail === 'boolean') {
                    let flags = 0
                    if (emitter.Head) flags |= 1
                    if (emitter.Tail) flags |= 2
                    if (flags === 0) flags = 1
                    emitter.FrameFlags = flags
                } else if (emitter.FrameFlags === undefined) {
                    emitter.FrameFlags = 1
                }
            })
        }
    }

    const toggleEditor = (editor: string) => {
        setActiveEditor(activeEditor === editor ? null : editor)
    }

    // Debug Console State
    const [showDebugConsole, setShowDebugConsole] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('showDebugConsole');
            return saved ? JSON.parse(saved) : false;
        } catch { return false; }
    })
    const [showAbout, setShowAbout] = useState<boolean>(false)
    const [activationStatus, setActivationStatus] = useState<{
        is_activated: boolean;
        license_type: string;
        expiration_date: string | null;
        days_remaining: number | null;
        level: number;
        level_name: string;
    } | null>(null)
    const [activationCode, setActivationCode] = useState<string>('')
    const [activationLoading, setActivationLoading] = useState<boolean>(false)
    const [activationError, setActivationError] = useState<string | null>(null)

    useEffect(() => {
        localStorage.setItem('showDebugConsole', JSON.stringify(showDebugConsole))
        import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('toggle_console', { show: showDebugConsole }).catch(e => console.error('Failed to toggle console:', e))
        })
    }, [showDebugConsole])

    // Fetch activation status when About modal opens
    const fetchActivationStatus = useCallback(async () => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const status: any = await invoke('get_activation_status');
            setActivationStatus(status);
        } catch (e) {
            console.error('Failed to get activation status:', e);
        }
    }, []);

    useEffect(() => {
        if (showAbout) {
            fetchActivationStatus();
            setActivationError(null);
        }
    }, [showAbout, fetchActivationStatus])

    // Handle activation
    const handleActivate = async () => {
        if (!activationCode.trim()) {
            setActivationError('请输入激活码');
            return;
        }

        setActivationLoading(true);
        setActivationError(null);

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result: any = await invoke('activate_software', { licenseCode: activationCode.trim() });
            setActivationStatus(result);
            setActivationCode('');

            if (result.is_activated) {
                alert(`激活成功！\n\n版本: ${result.level_name}\n授权类型: ${result.license_type === 'PERM' ? '永久授权' : '时限授权'}`);
            }
        } catch (e: any) {
            setActivationError(typeof e === 'string' ? e : (e.message || '激活失败'));
        } finally {
            setActivationLoading(false);
        }
    }

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                width: '100%',
                overflow: 'hidden',
                backgroundColor: '#1e1e1e',
                color: '#eee',
                fontFamily: 'Segoe UI, sans-serif',
                position: 'relative'
            }}
        >
            {/* Drag-and-drop overlay */}
            {isDragging && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 120, 215, 0.3)',
                    border: '3px dashed #0078d7',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none'
                }}>
                    <div style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        padding: '20px 40px',
                        borderRadius: '8px',
                        fontSize: '18px',
                        fontWeight: 'bold',
                        color: '#fff'
                    }}>
                        拖放 MDX/MDL 文件以导入模型
                    </div>
                </div>
            )}
            <MenuBar
                onOpen={handleOpen}
                onSave={handleSave}
                onSaveAs={handleSaveAs}
                onExportMDL={handleExportMDL}
                onExportMDX={handleExportMDX}
                // onLoadMPQ={handleLoadMPQ} // Removed
                // mpqLoaded={mpqLoaded} // Removed
                teamColor={teamColor}
                onSelectTeamColor={setTeamColor}
                showGrid={showGridXY}
                onToggleGrid={() => useRendererStore.getState().setShowGridXY(!showGridXY)}
                showNodes={showNodes}
                onToggleNodes={() => setShowNodes(!showNodes)}
                showSkeleton={showSkeleton}
                onToggleSkeleton={() => setShowSkeleton(!showSkeleton)}
                renderMode={renderMode}
                onChangeRenderMode={setRenderMode}
                backgroundColor={backgroundColor}
                onChangeBackgroundColor={setBackgroundColor}
                showFPS={showFPS}
                onToggleFPS={() => setShowFPS(!showFPS)}
                showGeosetVisibility={showGeosetVisibility}
                onToggleGeosetVisibility={() => {
                    const newValue = !showGeosetVisibility;
                    setShowGeosetVisibility(newValue);
                }}
                showCollisionShapes={showCollisionShapes}
                onToggleCollisionShapes={() => {
                    const newVal = !showCollisionShapes
                    setShowCollisionShapes(newVal)
                }}
                showCameras={showCameras}
                onToggleCameras={() => {
                    const newVal = !showCameras
                    setShowCameras(newVal)
                }}
                showLights={showLights}
                onToggleLights={() => {
                    const newVal = !showLights
                    setShowLights(newVal)
                }}
                onSetViewPreset={(preset) => setViewPreset({ type: preset, time: Date.now() })}
                onToggleEditor={(editor) => {
                    console.log('[MainLayout] onToggleEditor called with:', editor)
                    if (editor === 'nodeManager') {
                        toggleNodeManager()
                    } else if (editor === 'modelInfo') {
                        toggleModelInfo()
                    } else if (editor === 'geosetAnim') {
                        setShowGeosetAnimModal(true)
                    } else if (editor === 'texture') {
                        setShowTextureModal(true)
                    } else if (editor === 'textureAnim') {
                        setShowTextureAnimModal(true)
                    } else if (editor === 'sequence') {
                        setShowSequenceModal(true)
                    } else if (editor === 'camera') {
                        setShowCameraModal(true)
                    } else if (editor === 'material') {

                        setShowMaterialModal(true)
                    } else if (editor === 'geoset') {
                        setShowGeosetModal(true)
                    } else if (editor === 'globalSequence') {
                        setShowGlobalSeqModal(true)
                    } else if (editor === 'geosetVisibility') {
                        setShowGeosetVisibility(!showGeosetVisibility)
                    } else {
                        console.log('[MainLayout] Toggling editor:', editor)
                        toggleEditor(editor)
                    }
                }}
                mainMode={mainMode}
                onSetMainMode={setMainMode}
                showDebugConsole={showDebugConsole}
                onToggleDebugConsole={() => setShowDebugConsole(!showDebugConsole)}
                onShowAbout={() => setShowAbout(true)}
            />

            {/* About Dialog */}
            {showAbout && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2000
                }} onClick={() => setShowAbout(false)}>
                    <div style={{
                        backgroundColor: '#333',
                        padding: '20px',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        minWidth: '300px',
                        textAlign: 'center',
                        border: '1px solid #555'
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0, marginBottom: '15px' }}>关于</h3>
                        <p style={{ fontSize: '18px', margin: '10px 0' }}>咕咕War3模型编辑器 v1.0.0</p>

                        {/* Activation Status */}
                        <div style={{
                            marginTop: '15px',
                            padding: '12px',
                            backgroundColor: '#2a2a2a',
                            borderRadius: '4px',
                            textAlign: 'left'
                        }}>
                            <div style={{ marginBottom: '8px', color: '#aaa', fontSize: '12px' }}>授权状态</div>
                            {activationStatus ? (
                                activationStatus.is_activated ? (
                                    <>
                                        <div style={{
                                            color: activationStatus.level >= 2 ? '#ffc53d' : '#52c41a',
                                            fontWeight: 'bold',
                                            marginBottom: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <span>✓ {activationStatus.level_name}</span>
                                            <span style={{
                                                fontSize: '11px',
                                                padding: '2px 6px',
                                                backgroundColor: activationStatus.level >= 2 ? '#ffc53d22' : '#52c41a22',
                                                borderRadius: '3px',
                                                color: activationStatus.level >= 2 ? '#ffc53d' : '#52c41a'
                                            }}>
                                                {activationStatus.license_type === 'PERM' ? '永久' : '时限'}
                                            </span>
                                        </div>
                                        {activationStatus.license_type === 'TIME' && activationStatus.days_remaining !== null && (
                                            <div style={{ color: activationStatus.days_remaining <= 7 ? '#ff7875' : '#eee', fontSize: '13px' }}>
                                                到期日期: {activationStatus.expiration_date} (剩余 {activationStatus.days_remaining} 天)
                                            </div>
                                        )}
                                        {activationStatus.level < 2 && (
                                            <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
                                                输入高级版激活码可升级
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div style={{ color: '#ff7875' }}>未激活</div>
                                )
                            ) : (
                                <div style={{ color: '#888' }}>加载中...</div>
                            )}
                        </div>

                        {/* Activation Input */}
                        <div style={{
                            marginTop: '15px',
                            padding: '12px',
                            backgroundColor: '#2a2a2a',
                            borderRadius: '4px',
                            textAlign: 'left'
                        }}>
                            <div style={{ marginBottom: '8px', color: '#aaa', fontSize: '12px' }}>
                                {activationStatus?.is_activated ? '升级/更换激活码' : '输入激活码'}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    value={activationCode}
                                    onChange={(e) => setActivationCode(e.target.value)}
                                    placeholder="请输入激活码"
                                    style={{
                                        flex: 1,
                                        padding: '6px 10px',
                                        backgroundColor: '#1e1e1e',
                                        border: '1px solid #555',
                                        borderRadius: '4px',
                                        color: '#eee',
                                        fontSize: '13px'
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !activationLoading) {
                                            handleActivate();
                                        }
                                    }}
                                />
                                <button
                                    onClick={handleActivate}
                                    disabled={activationLoading}
                                    style={{
                                        padding: '6px 12px',
                                        backgroundColor: activationLoading ? '#555' : '#52c41a',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: activationLoading ? 'not-allowed' : 'pointer',
                                        fontSize: '13px'
                                    }}
                                >
                                    {activationLoading ? '验证中...' : '激活'}
                                </button>
                            </div>
                            {activationError && (
                                <div style={{ marginTop: '8px', color: '#ff7875', fontSize: '12px' }}>
                                    {activationError}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => setShowAbout(false)}
                            style={{
                                marginTop: '20px',
                                padding: '6px 16px',
                                backgroundColor: '#007acc',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            确定
                        </button>
                    </div>
                </div>
            )}

            <GeosetAnimationModal
                visible={showGeosetAnimModal}
                onClose={() => setShowGeosetAnimModal(false)}
            />
            <TextureEditorModal
                visible={showTextureModal}
                onClose={() => setShowTextureModal(false)}
                modelPath={modelPath || undefined}
            />
            <TextureAnimationManagerModal
                visible={showTextureAnimModal}
                onClose={() => setShowTextureAnimModal(false)}
            />
            <CameraManagerModal
                visible={showCameraModal}
                onClose={() => setShowCameraModal(false)}
                onAddFromView={handleAddCameraFromView}
                onViewCamera={handleViewCamera}
            />
            <SequenceEditorModal
                visible={showSequenceModal}
                onClose={() => setShowSequenceModal(false)}
            />
            <MaterialEditorModal
                visible={showMaterialModal}
                onClose={() => setShowMaterialModal(false)}
            />
            <GeosetEditorModal
                visible={showGeosetModal}
                onClose={() => setShowGeosetModal(false)}
            />
            <GlobalSequenceModal
                visible={showGlobalSeqModal}
                onClose={() => setShowGlobalSeqModal(false)}
            />

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                {/* Left Panel - Animation Panel (hidden in UV mode) */}
                {mainMode !== 'uv' && mainMode !== 'animation' && (
                    <div style={{ width: '280px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
                        <AnimationPanel
                            onImport={handleImport}
                        />
                    </div>
                )}

                {/* Center - 3D Viewer or Animation/UV Mode Layout */}
                <div style={{ flex: 1, position: 'relative', backgroundColor }}>
                    <AnimationModeLayout isActive={mainMode === 'animation'}>
                        <UVModeLayout

                            modelPath={modelPath}
                            isActive={mainMode === 'uv'}
                        >
                            <Viewer
                                ref={viewerRef}
                                modelPath={modelPath}
                                modelData={modelData}
                                teamColor={teamColor}
                                showGrid={showGridXY}
                                showNodes={mainMode !== 'uv' && showNodes}
                                showSkeleton={mainMode !== 'uv' && showSkeleton}
                                showCollisionShapes={mainMode !== 'uv' && showCollisionShapes}
                                showCameras={mainMode !== 'uv' && showCameras}
                                showLights={mainMode !== 'uv' && mainMode !== 'animation' && showLights}
                                showWireframe={mainMode !== 'uv' && renderMode === 'wireframe'}
                                onToggleWireframe={() => setRenderMode(renderMode === 'textured' ? 'wireframe' : 'textured')}
                                backgroundColor={backgroundColor}
                                animationIndex={currentSequence}
                                isPlaying={mainMode !== 'uv' && isPlaying}
                                onTogglePlay={() => setPlaying(!isPlaying)}
                                onModelLoaded={handleModelLoaded}
                                showFPS={mainMode !== 'uv' && showFPS}
                                playbackSpeed={playbackSpeed}
                                viewPreset={viewPreset}
                            />
                        </UVModeLayout>
                    </AnimationModeLayout>


                    <GeosetVisibilityPanel
                        visible={showGeosetVisibility}
                        onClose={() => setShowGeosetVisibility(false)}
                    />

                    {isLoading && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            color: 'white',
                            zIndex: 10
                        }}>
                            加载�?..
                        </div>
                    )}
                </div>

                {/* Right Panel - Editors */}
                {activeEditor && (
                    <div style={{
                        width: editorWidth,
                        display: 'flex',
                        flexDirection: 'column',
                        borderLeft: '1px solid #333',
                        backgroundColor: '#222',
                        position: 'relative' // Needed for resize handle
                    }}>
                        {/* Resize Handle */}
                        <div
                            onMouseDown={handleEditorResizeStart}
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: '4px',
                                cursor: 'ew-resize',
                                zIndex: 100,
                                backgroundColor: isResizingEditor ? '#007acc' : 'transparent',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => { if (!isResizingEditor) e.currentTarget.style.backgroundColor = '#007acc40' }}
                            onMouseLeave={(e) => { if (!isResizingEditor) e.currentTarget.style.backgroundColor = 'transparent' }}
                        />
                        <EditorPanel
                            activeTab={activeEditor}
                            onClose={() => setActiveEditor(null)}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

export default MainLayout
