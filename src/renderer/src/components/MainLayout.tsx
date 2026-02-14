import React, { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import Viewer, { ViewerRef } from './Viewer'
import MenuBar from './MenuBar'
import EditorPanel from './EditorPanel'
// Lazy load modal components for faster startup
const GeosetAnimationModal = React.lazy(() => import('./modals/GeosetAnimationModal'))
const GeosetVisibilityToolModal = React.lazy(() => import('./modals/GeosetVisibilityToolModal'))
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
const TransformModelDialog = React.lazy(() => import('./node/TransformModelDialog').then(m => ({ default: m.TransformModelDialog })))

import { GeosetVisibilityPanel } from './GeosetVisibilityPanel'
import { open } from '@tauri-apps/plugin-dialog'
import { generateMDL, generateMDX } from 'war3-model'
import { useModelStore } from '../store/modelStore'
import { NodeType } from '../types/node'
import { useUIStore } from '../store/uiStore'
import { useSelectionStore } from '../store/selectionStore'
import { useRendererStore } from '../store/rendererStore'
import { useHistoryStore } from '../store/historyStore'
import { GlobalMessageLayer } from './GlobalMessageLayer'
import { showMessage, showConfirm } from '../store/messageStore'
import { registerShortcutHandler } from '../shortcuts/manager'
import { checkGiteeUpdate, showChangelog as showUpdateLog, checkGiteeUpdateSilent } from '../services/updateService';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo, listen } from '@tauri-apps/api/event';
import { Button, Modal } from 'antd';
import {
    DETACHED_CAMERA_EVENTS,
    DETACHED_MANAGER_TYPES,
    DETACHED_MANAGER_EVENTS,
    DetachedCameraViewPayload,
    DetachedManagerApplyPayload,
    DetachedManagerLifecyclePayload,
    DetachedManagerRequestSnapshotPayload,
    DetachedManagerType,
    DETACHED_TEXTURE_EDITOR_EVENTS,
    DETACHED_TEXTURE_EDITOR_LABEL,
    DETACHED_TEXTURE_EDITOR_QUERY,
    DetachedTextureDeltaOp,
    DetachedTextureEditorDeltaPayload,
    DetachedTextureEditorApplyPayload,
    getDetachedManagerLabel,
    getDetachedManagerQuery
} from '../constants/detachedWindows';

type DetachedSnapshotField = {
    key: string
    aliases?: string[]
}

const readDetachedFieldValue = (source: any, field: DetachedSnapshotField): any => {
    if (!source || typeof source !== 'object') return undefined
    if (Object.prototype.hasOwnProperty.call(source, field.key)) {
        return source[field.key]
    }
    for (const alias of field.aliases || []) {
        if (Object.prototype.hasOwnProperty.call(source, alias)) {
            return source[alias]
        }
    }
    return undefined
}

const toSlimGeoset = (geoset: any) => ({
    MaterialID: typeof geoset?.MaterialID === 'number' ? geoset.MaterialID : 0,
    SelectionGroup: typeof geoset?.SelectionGroup === 'number' ? geoset.SelectionGroup : 0,
    VertexCount: ArrayBuffer.isView(geoset?.Vertices) || Array.isArray(geoset?.Vertices)
        ? Math.floor((geoset.Vertices.length || 0) / 3)
        : 0,
    FaceCount: ArrayBuffer.isView(geoset?.Faces) || Array.isArray(geoset?.Faces)
        ? Math.floor((geoset.Faces.length || 0) / 3)
        : 0
})

const toSlimMaterialsForTextureAnim = (materials: any[]): any[] => {
    if (!Array.isArray(materials)) return []
    return materials.map((material) => ({
        Layers: Array.isArray(material?.Layers)
            ? material.Layers.map((layer: any) => ({
                TVertexAnimId: layer?.TVertexAnimId ?? layer?.TextureAnimationId ?? layer?.TextureAnimId ?? null
            }))
            : []
    }))
}

const DETACHED_MANAGER_SEQUENCE_FIELDS: DetachedSnapshotField[] = [
    { key: 'Sequences', aliases: ['Sequence'] },
    { key: 'GeosetAnims', aliases: ['GeosetAnim'] },
    { key: 'TextureAnims', aliases: ['TextureAnim'] },
    { key: 'Materials', aliases: ['Material'] },
    { key: 'Cameras', aliases: ['Camera'] },
    { key: 'Bones', aliases: ['Bone'] },
    { key: 'Helpers', aliases: ['Helper'] },
    { key: 'Attachments', aliases: ['Attachment'] },
    { key: 'Lights', aliases: ['Light'] },
    { key: 'ParticleEmitters', aliases: ['ParticleEmitter'] },
    { key: 'ParticleEmitters2', aliases: ['ParticleEmitter2'] },
    { key: 'ParticleEmitterPopcorns', aliases: ['ParticleEmitterPopcorn'] },
    { key: 'RibbonEmitters', aliases: ['RibbonEmitter'] },
    { key: 'EventObjects', aliases: ['EventObject'] },
    { key: 'CollisionShapes', aliases: ['CollisionShape'] }
]

const buildDetachedManagerSnapshotModelData = (managerType: DetachedManagerType, source: any): any => {
    if (!source || typeof source !== 'object') return null

    switch (managerType) {
        case 'camera':
            return {
                Cameras: readDetachedFieldValue(source, { key: 'Cameras', aliases: ['Camera'] }) || [],
                GlobalSequences: readDetachedFieldValue(source, { key: 'GlobalSequences', aliases: ['GlobalSequence'] }) || []
            }
        case 'geoset': {
            const geosets = readDetachedFieldValue(source, { key: 'Geosets', aliases: ['Geoset'] }) || []
            const materials = readDetachedFieldValue(source, { key: 'Materials', aliases: ['Material'] }) || []
            return {
                Geosets: Array.isArray(geosets) ? geosets.map(toSlimGeoset) : [],
                Materials: Array.isArray(materials) ? materials.map(() => ({})) : []
            }
        }
        case 'geosetAnim': {
            const geosetAnims = readDetachedFieldValue(source, { key: 'GeosetAnims', aliases: ['GeosetAnim'] }) || []
            const geosets = readDetachedFieldValue(source, { key: 'Geosets', aliases: ['Geoset'] }) || []
            const globalSequences = readDetachedFieldValue(source, { key: 'GlobalSequences', aliases: ['GlobalSequence'] }) || []
            return {
                GeosetAnims: Array.isArray(geosetAnims) ? geosetAnims : [],
                Geosets: Array.isArray(geosets) ? geosets.map(toSlimGeoset) : [],
                GlobalSequences: Array.isArray(globalSequences) ? globalSequences : []
            }
        }
        case 'textureAnim': {
            const textureAnims = readDetachedFieldValue(source, { key: 'TextureAnims', aliases: ['TextureAnim'] }) || []
            const geosets = readDetachedFieldValue(source, { key: 'Geosets', aliases: ['Geoset'] }) || []
            const materials = readDetachedFieldValue(source, { key: 'Materials', aliases: ['Material'] }) || []
            const globalSequences = readDetachedFieldValue(source, { key: 'GlobalSequences', aliases: ['GlobalSequence'] }) || []
            return {
                TextureAnims: Array.isArray(textureAnims) ? textureAnims : [],
                Geosets: Array.isArray(geosets) ? geosets.map(toSlimGeoset) : [],
                Materials: toSlimMaterialsForTextureAnim(materials),
                GlobalSequences: Array.isArray(globalSequences) ? globalSequences : []
            }
        }
        case 'material': {
            const materials = readDetachedFieldValue(source, { key: 'Materials', aliases: ['Material'] }) || []
            const textures = readDetachedFieldValue(source, { key: 'Textures', aliases: ['Texture'] }) || []
            const geosets = readDetachedFieldValue(source, { key: 'Geosets', aliases: ['Geoset'] }) || []
            const textureAnims = readDetachedFieldValue(source, { key: 'TextureAnims', aliases: ['TextureAnim'] }) || []
            const globalSequences = readDetachedFieldValue(source, { key: 'GlobalSequences', aliases: ['GlobalSequence'] }) || []
            return {
                Materials: Array.isArray(materials) ? materials : [],
                Textures: Array.isArray(textures) ? textures : [],
                Geosets: Array.isArray(geosets) ? geosets.map(toSlimGeoset) : [],
                TextureAnims: Array.isArray(textureAnims) ? textureAnims : [],
                GlobalSequences: Array.isArray(globalSequences) ? globalSequences : []
            }
        }
        case 'sequence': {
            const snapshot: any = {}
            for (const field of DETACHED_MANAGER_SEQUENCE_FIELDS) {
                const value = readDetachedFieldValue(source, field)
                if (value !== undefined) {
                    snapshot[field.key] = value
                }
            }
            return snapshot
        }
        case 'globalSequence':
            return {
                GlobalSequences: readDetachedFieldValue(source, { key: 'GlobalSequences', aliases: ['GlobalSequence'] }) || []
            }
        default:
            return null
    }
}

const mergeGeosetBindings = (
    baseGeosets: any[] | undefined,
    incomingGeosets: any[] | undefined,
    options: { includeSelectionGroup: boolean }
): any[] => {
    if (!Array.isArray(baseGeosets)) return Array.isArray(incomingGeosets) ? incomingGeosets : []
    if (!Array.isArray(incomingGeosets)) return baseGeosets

    const nextGeosets = [...baseGeosets]
    const count = Math.min(nextGeosets.length, incomingGeosets.length)
    for (let index = 0; index < count; index++) {
        const incoming = incomingGeosets[index]
        if (!incoming || typeof incoming !== 'object') continue
        const patch: any = {}
        if (typeof incoming.MaterialID === 'number') {
            patch.MaterialID = incoming.MaterialID
        }
        if (options.includeSelectionGroup && typeof incoming.SelectionGroup === 'number') {
            patch.SelectionGroup = incoming.SelectionGroup
        }
        if (Object.keys(patch).length > 0) {
            nextGeosets[index] = { ...nextGeosets[index], ...patch }
        }
    }
    return nextGeosets
}

const mergeDetachedManagerModelData = (
    managerType: DetachedManagerType,
    baseModelData: any,
    incomingModelData: any
): any => {
    if (!incomingModelData) return baseModelData
    if (!baseModelData) return incomingModelData

    const merged = { ...baseModelData }

    switch (managerType) {
        case 'camera': {
            const cameras = readDetachedFieldValue(incomingModelData, { key: 'Cameras', aliases: ['Camera'] })
            if (cameras !== undefined) merged.Cameras = cameras
            return merged
        }
        case 'geoset': {
            const geosets = readDetachedFieldValue(incomingModelData, { key: 'Geosets', aliases: ['Geoset'] })
            merged.Geosets = mergeGeosetBindings(baseModelData.Geosets, geosets, { includeSelectionGroup: true })
            return merged
        }
        case 'geosetAnim': {
            const geosetAnims = readDetachedFieldValue(incomingModelData, { key: 'GeosetAnims', aliases: ['GeosetAnim'] })
            if (geosetAnims !== undefined) merged.GeosetAnims = geosetAnims
            return merged
        }
        case 'textureAnim': {
            const textureAnims = readDetachedFieldValue(incomingModelData, { key: 'TextureAnims', aliases: ['TextureAnim'] })
            if (textureAnims !== undefined) merged.TextureAnims = textureAnims
            return merged
        }
        case 'material': {
            const materials = readDetachedFieldValue(incomingModelData, { key: 'Materials', aliases: ['Material'] })
            const textures = readDetachedFieldValue(incomingModelData, { key: 'Textures', aliases: ['Texture'] })
            const geosets = readDetachedFieldValue(incomingModelData, { key: 'Geosets', aliases: ['Geoset'] })

            if (materials !== undefined) merged.Materials = materials
            if (textures !== undefined) merged.Textures = textures
            merged.Geosets = mergeGeosetBindings(baseModelData.Geosets, geosets, { includeSelectionGroup: false })
            return merged
        }
        case 'sequence': {
            for (const field of DETACHED_MANAGER_SEQUENCE_FIELDS) {
                const value = readDetachedFieldValue(incomingModelData, field)
                if (value !== undefined) {
                    merged[field.key] = value
                }
            }
            return merged
        }
        case 'globalSequence': {
            const globalSequences = readDetachedFieldValue(incomingModelData, { key: 'GlobalSequences', aliases: ['GlobalSequence'] })
            if (globalSequences !== undefined) merged.GlobalSequences = globalSequences
            return merged
        }
        default:
            return merged
    }
}

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
    const typeMap: Record<number, number> = { 0: 0, 1: 1, 2: 2 };
    try {
        data = structuredClone(modelData);
    } catch {
        // Fallback: work with original data (will mutate it)
        console.warn('[MainLayout] structuredClone not available, modifying original data');
        data = modelData;
    }

    // Helper to robustly convert object-like arrays (possibly sparse) to TypedArray
    const objectToTypedArray = (obj: any, Constructor: any) => {
        const keys = Object.keys(obj);
        const numKeys = keys.filter(k => !isNaN(Number(k)) && Number(k) >= 0).map(Number);

        // If we found numeric keys, use them to reconstruct array respecting indices
        if (numKeys.length > 0) {
            const maxKey = Math.max(...numKeys);
            const arr = new Constructor(maxKey + 1);
            numKeys.forEach(k => arr[k] = Number(obj[k]));
            return arr;
        }

        // Fallback: just use values
        return new Constructor(Object.values(obj).map(Number));
    };

    // Helper to convert array-like to typed array if needed
    const toUint32Array = (arr: any): Uint32Array => {
        if (arr instanceof Uint32Array) return arr;
        if (Array.isArray(arr)) return new Uint32Array(arr);
        if (arr && typeof arr === 'object') {
            return objectToTypedArray(arr, Uint32Array);
        }
        return new Uint32Array([0, 0]);
    };

    const normalizeInterval = (interval: any): Uint32Array => {
        let start = 0;
        let end = 0;
        if (interval instanceof Uint32Array || ArrayBuffer.isView(interval)) {
            start = Number((interval as ArrayLike<number>)[0]);
            end = Number((interval as ArrayLike<number>)[1]);
        } else if (Array.isArray(interval)) {
            start = Number(interval[0]);
            end = Number(interval[1]);
        } else if (interval && typeof interval === 'object') {
            const values = Object.values(interval).map(Number);
            start = Number(values[0]);
            end = Number(values[1]);
        }
        if (!Number.isFinite(start)) start = 0;
        if (!Number.isFinite(end)) end = 0;
        start = Math.max(0, Math.floor(start));
        end = Math.max(0, Math.floor(end));
        if (start > end) {
            const temp = start;
            start = end;
            end = temp;
        }
        return new Uint32Array([start, end]);
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

    // Helper for variable-length float arrays (Vertices, Normals, etc.)
    const toDynamicFloat32Array = (arr: any): Float32Array => {
        if (arr instanceof Float32Array) return arr;
        if (Array.isArray(arr)) return new Float32Array(arr);
        if (arr && typeof arr === 'object') {
            return objectToTypedArray(arr, Float32Array);
        }
        return new Float32Array(0);
    };

    const toUint16Array = (arr: any): Uint16Array => {
        if (arr instanceof Uint16Array) return arr;
        if (Array.isArray(arr)) return new Uint16Array(arr);
        if (arr && typeof arr === 'object') {
            return objectToTypedArray(arr, Uint16Array);
        }
        return new Uint16Array(0);
    };

    const toUint8Array = (arr: any): Uint8Array => {
        if (arr instanceof Uint8Array) return arr;
        if (Array.isArray(arr)) return new Uint8Array(arr);
        if (arr && typeof arr === 'object') {
            return objectToTypedArray(arr, Uint8Array);
        }
        return new Uint8Array(0);
    };

    // Clamp numeric values to [0,255] to avoid Uint8 wraparound on save
    const toUint8ClampedArray = (arr: any): Uint8Array => {
        if (arr instanceof Uint8Array) return arr;
        let values: number[] = [];
        if (ArrayBuffer.isView(arr)) {
            values = Array.from(arr as ArrayLike<number>);
        } else if (Array.isArray(arr)) {
            values = arr;
        } else if (arr && typeof arr === 'object') {
            values = Object.values(arr).map(Number);
        }
        const result = new Uint8Array(values.length);
        for (let i = 0; i < values.length; i++) {
            const num = Number(values[i]);
            if (!Number.isFinite(num) || num < 0) {
                result[i] = 0;
            } else if (num > 255) {
                result[i] = 255;
            } else {
                result[i] = num;
            }
        }
        return result;
    };

    const toTypedVector = (
        value: any,
        vectorSize: number,
        isInt: boolean,
        defaultVec?: number[] | ArrayLike<number>
    ): Int32Array | Float32Array => {
        const Type = isInt ? Int32Array : Float32Array;
        const result = new Type(vectorSize);
        if (defaultVec) {
            const defArr = ArrayBuffer.isView(defaultVec) ? Array.from(defaultVec as ArrayLike<number>) : Array.from(defaultVec as number[]);
            for (let i = 0; i < vectorSize; i++) {
                const num = Number(defArr[i]);
                if (Number.isFinite(num)) {
                    result[i] = num;
                }
            }
        }

        if (value === undefined || value === null) {
            return result;
        }

        const assignValue = (index: number, val: any) => {
            const num = Number(val);
            if (Number.isFinite(num) && index >= 0 && index < vectorSize) {
                result[index] = num;
            }
        };

        if (typeof value === 'number') {
            assignValue(0, value);
            return result;
        }

        if (value instanceof Type || ArrayBuffer.isView(value)) {
            const arr = Array.from(value as ArrayLike<number>);
            for (let i = 0; i < Math.min(vectorSize, arr.length); i++) {
                assignValue(i, arr[i]);
            }
            return result;
        }

        if (Array.isArray(value)) {
            for (let i = 0; i < Math.min(vectorSize, value.length); i++) {
                assignValue(i, value[i]);
            }
            return result;
        }

        if (typeof value === 'object') {
            const numericKeys = Object.keys(value)
                .map(k => Number(k))
                .filter(k => Number.isFinite(k));
            if (numericKeys.length > 0) {
                numericKeys.forEach(k => assignValue(k, value[k]));
            } else {
                const arr = Object.values(value) as any[];
                for (let i = 0; i < Math.min(vectorSize, arr.length); i++) {
                    assignValue(i, arr[i]);
                }
            }
        }

        return result;
    };

    // Fix AnimVector to ensure Keys is a real array and Vectors are typed arrays
    const fixAnimVector = (
        animVec: any,
        vectorSize: number = 3,
        isInt: boolean = false,
        defaultVec?: number[] | ArrayLike<number>,
        globalSeqCount?: number
    ): any => {
        if (!animVec) return null;
        // If it's not an object, return null
        if (typeof animVec !== 'object') return null;
        const lineTypeMap: Record<string, number> = {
            DontInterp: 0,
            Linear: 1,
            Hermite: 2,
            Bezier: 3
        };
        if (typeof animVec.LineType === 'string' && animVec.LineType in lineTypeMap) {
            animVec.LineType = lineTypeMap[animVec.LineType];
        }
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
                const frame = Number(key.Frame ?? key.Time ?? 0);
                key.Frame = Number.isFinite(frame) && frame >= 0 ? Math.floor(frame) : 0;

                key.Vector = toTypedVector(key.Vector, vectorSize, isInt, defaultVec);

                const needsTangents = animVec.LineType === 2 || animVec.LineType === 3;
                if (needsTangents) {
                    key.InTan = toTypedVector(key.InTan, vectorSize, isInt);
                    key.OutTan = toTypedVector(key.OutTan, vectorSize, isInt);
                } else {
                    if (key.InTan && !(key.InTan instanceof Float32Array) && !(key.InTan instanceof Int32Array)) {
                        key.InTan = toTypedVector(key.InTan, vectorSize, isInt);
                    }
                    if (key.OutTan && !(key.OutTan instanceof Float32Array) && !(key.OutTan instanceof Int32Array)) {
                        key.OutTan = toTypedVector(key.OutTan, vectorSize, isInt);
                    }
                }
            });
        } else {
            // No Keys, this AnimVector is invalid - make it empty
            animVec.Keys = [];
        }
        // Ensure LineType is valid
        if (animVec.LineType === undefined || animVec.LineType === null || ![0, 1, 2, 3].includes(animVec.LineType)) {
            animVec.LineType = 1; // Default to Linear
        }
        if (animVec.GlobalSeqId === undefined) {
            animVec.GlobalSeqId = null;
        } else if (typeof animVec.GlobalSeqId !== 'number' || !Number.isFinite(animVec.GlobalSeqId)) {
            animVec.GlobalSeqId = null;
        }
        if (typeof globalSeqCount === 'number' && globalSeqCount > 0 && typeof animVec.GlobalSeqId === 'number') {
            if (animVec.GlobalSeqId < 0 || animVec.GlobalSeqId >= globalSeqCount) {
                animVec.GlobalSeqId = null;
            }
        }
        return animVec;
    };

    // Ensure any value becomes a valid AnimVector (or null)
    const ensureAnimVector = (
        value: any,
        vectorSize: number = 3,
        isInt: boolean = false,
        defaultVec?: number[] | ArrayLike<number>,
        globalSeqCount?: number
    ): any => {
        if (!value) return null;
        if (value && typeof value === 'object' && Array.isArray(value.Keys)) {
            return fixAnimVector(value, vectorSize, isInt, defaultVec, globalSeqCount);
        }
        const vec = toTypedVector(value, vectorSize, isInt, defaultVec);
        return {
            LineType: 1,
            GlobalSeqId: null,
            Keys: [{ Frame: 0, Vector: vec }]
        };
    };

    // Fix Node's animation properties (Translation, Rotation, Scaling)
    const fixNode = (node: any, globalSeqCount?: number): void => {
        if (!node) return;
        if (node.Translation) {
            node.Translation = ensureAnimVector(node.Translation, 3, false, [0, 0, 0], globalSeqCount);
            if (!node.Translation || !node.Translation.Keys || node.Translation.Keys.length === 0) {
                node.Translation = null;
            }
        }
        if (node.Rotation) {
            node.Rotation = ensureAnimVector(node.Rotation, 4, false, [0, 0, 0, 1], globalSeqCount);
            if (!node.Rotation || !node.Rotation.Keys || node.Rotation.Keys.length === 0) {
                node.Rotation = null;
            }
        }
        if (node.Scaling) {
            node.Scaling = ensureAnimVector(node.Scaling, 3, false, [1, 1, 1], globalSeqCount);
            if (!node.Scaling || !node.Scaling.Keys || node.Scaling.Keys.length === 0) {
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
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Sequences.length} sequences`);
        data.Sequences.forEach((seq: any, index: number) => {
            // Always log interval info for debugging
            const intervalType = seq.Interval ? (seq.Interval instanceof Uint32Array ? 'Uint32Array' : Array.isArray(seq.Interval) ? 'Array' : typeof seq.Interval) : 'undefined';
            const intervalValues = seq.Interval ? `[${seq.Interval[0]}, ${seq.Interval[1]}]` : 'N/A';
            // console.log(`[MainLayout] Sequence ${index} "${seq.Name}" Interval (${intervalType}): ${intervalValues}`);

            seq.Interval = normalizeInterval(seq.Interval);
            if (seq.MinimumExtent && !(seq.MinimumExtent instanceof Float32Array)) {
                seq.MinimumExtent = toFloat32Array(seq.MinimumExtent);
            }
            if (seq.MaximumExtent && !(seq.MaximumExtent instanceof Float32Array)) {
                seq.MaximumExtent = toFloat32Array(seq.MaximumExtent);
            }
            if (!seq.MinimumExtent) seq.MinimumExtent = new Float32Array(3);
            if (!seq.MaximumExtent) seq.MaximumExtent = new Float32Array(3);
            if (seq.BoundsRadius === undefined || seq.BoundsRadius === null) {
                seq.BoundsRadius = 0;
            }
            if (seq.MoveSpeed === undefined || seq.MoveSpeed === null) {
                seq.MoveSpeed = 0;
            }
            if (seq.Rarity === undefined || seq.Rarity === null) {
                seq.Rarity = 0;
            }
            if (seq.NonLooping === undefined || seq.NonLooping === null) {
                seq.NonLooping = false;
            } else {
                seq.NonLooping = !!seq.NonLooping;
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
        if (!data.Info.MinimumExtent) data.Info.MinimumExtent = new Float32Array(3);
        if (!data.Info.MaximumExtent) data.Info.MaximumExtent = new Float32Array(3);
        if (data.Info.BoundsRadius === undefined || data.Info.BoundsRadius === null) {
            data.Info.BoundsRadius = 0;
        }
        if (data.Info.BlendTime === undefined || data.Info.BlendTime === null) {
            data.Info.BlendTime = 0;
        }
        if (!data.Info.Name) {
            data.Info.Name = '';
        }
    }

    // Fix GlobalSequences
    if (data.GlobalSequences && Array.isArray(data.GlobalSequences)) {
        data.GlobalSequences = data.GlobalSequences.map((value: any) => {
            const num = Number(value);
            return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
        });
    }
    const globalSeqCount = data.GlobalSequences?.length || 0;

    // Fix Textures
    if (data.Textures && Array.isArray(data.Textures)) {
        data.Textures.forEach((texture: any) => {
            if (texture.ReplaceableId === undefined || texture.ReplaceableId === null) {
                texture.ReplaceableId = 0;
            }
            if (typeof texture.ReplaceableId === 'number' && texture.ReplaceableId < 0) {
                texture.ReplaceableId = 0;
            }
            const normalizeTexturePath = (value: any): string => {
                if (typeof value === 'string') return value;
                if (Array.isArray(value)) return value.join('');
                if (value && typeof value === 'object') {
                    return Object.values(value).join('');
                }
                return '';
            };
            const rawImage = texture.Image ?? texture.Path ?? '';
            const normalizedImage = normalizeTexturePath(rawImage).replace(/\//g, '\\');
            texture.Image = normalizedImage;
            if (!texture.Path) {
                texture.Path = normalizedImage;
            }
            if (texture.Flags === undefined || texture.Flags === null) {
                texture.Flags = 0;
            }

            const baseFlags = typeof texture.Flags === 'number' ? texture.Flags : 0;
            let flags = baseFlags & ~(1 | 2);
            const applyFlag = (prop: string, bit: number) => {
                if (texture[prop] === true) {
                    flags |= bit;
                } else if (texture[prop] === false) {
                    // Explicitly cleared
                } else if (baseFlags & bit) {
                    flags |= bit;
                }
            };
            applyFlag('WrapWidth', 1);
            applyFlag('WrapHeight', 2);
            texture.Flags = flags;
        });
    }

    // Fix Geoset data
    if (data.Geosets && Array.isArray(data.Geosets)) {
        data.Geosets.forEach((geoset: any) => {
            if (!geoset) return;
            // Use toDynamicFloat32Array for variable length arrays
            if (geoset.Vertices && !(geoset.Vertices instanceof Float32Array)) {
                geoset.Vertices = toDynamicFloat32Array(geoset.Vertices);
            }
            if (geoset.Normals && !(geoset.Normals instanceof Float32Array)) {
                geoset.Normals = toDynamicFloat32Array(geoset.Normals);
            }
            if (geoset.Faces && !(geoset.Faces instanceof Uint16Array)) {
                geoset.Faces = toUint16Array(geoset.Faces);
            }
            if (geoset.VertexGroup && !(geoset.VertexGroup instanceof Uint8Array)) {
                geoset.VertexGroup = toUint8ClampedArray(geoset.VertexGroup);
            }
            if (geoset.MinimumExtent && !(geoset.MinimumExtent instanceof Float32Array)) {
                geoset.MinimumExtent = toFloat32Array(geoset.MinimumExtent);
            }
            if (geoset.MaximumExtent && !(geoset.MaximumExtent instanceof Float32Array)) {
                geoset.MaximumExtent = toFloat32Array(geoset.MaximumExtent);
            }
            if (geoset.TVertices) {
                if (Array.isArray(geoset.TVertices)) {
                    // Array of arrays format (from mdx parser usually)
                    geoset.TVertices = geoset.TVertices.map((tv: any) =>
                        tv instanceof Float32Array ? tv : toDynamicFloat32Array(tv)
                    );
                } else if (geoset.TVertices instanceof Float32Array) {
                    // Single large array already typed
                    geoset.TVertices = [geoset.TVertices];
                } else {
                    // Single object-like array or unknown format
                    geoset.TVertices = [toDynamicFloat32Array(geoset.TVertices)];
                }
            }
            if (geoset.Tangents && !(geoset.Tangents instanceof Float32Array)) {
                geoset.Tangents = toDynamicFloat32Array(geoset.Tangents);
            }
            if (geoset.SkinWeights && !(geoset.SkinWeights instanceof Uint8Array)) {
                geoset.SkinWeights = toUint8Array(geoset.SkinWeights);
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

            // Sanity checks for array lengths (prevent corrupt exports)
            const vertexCount = geoset.Vertices ? Math.floor(geoset.Vertices.length / 3) : 0;
            if (geoset.Vertices && geoset.Vertices.length % 3 !== 0) {
                geoset.Vertices = geoset.Vertices.subarray(0, vertexCount * 3);
            }
            if (geoset.Normals) {
                const expected = vertexCount * 3;
                if (geoset.Normals.length !== expected) {
                    const fixed = new Float32Array(expected);
                    fixed.set(geoset.Normals.subarray(0, expected));
                    geoset.Normals = fixed;
                }
            }
            if (geoset.VertexGroup) {
                if (geoset.VertexGroup.length !== vertexCount) {
                    const fixed = new Uint8Array(vertexCount);
                    fixed.set(geoset.VertexGroup.subarray(0, vertexCount));
                    geoset.VertexGroup = fixed;
                }
            }
            if (geoset.Faces) {
                const faceCount = Math.floor(geoset.Faces.length / 3);
                if (geoset.Faces.length % 3 !== 0) {
                    geoset.Faces = geoset.Faces.subarray(0, faceCount * 3);
                }
                for (let i = 0; i < geoset.Faces.length; i++) {
                    if (geoset.Faces[i] >= vertexCount || geoset.Faces[i] < 0) {
                        geoset.Faces[i] = 0;
                    }
                }
            }
            if (geoset.TVertices && Array.isArray(geoset.TVertices)) {
                geoset.TVertices = geoset.TVertices.map((tv: any) => {
                    const typed = tv instanceof Float32Array ? tv : toDynamicFloat32Array(tv);
                    const expected = vertexCount * 2;
                    if (typed.length === expected) return typed;
                    const fixed = new Float32Array(expected);
                    fixed.set(typed.subarray(0, expected));
                    return fixed;
                });
            }
            if (geoset.Tangents && geoset.Tangents.length % 4 !== 0) {
                const tangentCount = Math.floor(geoset.Tangents.length / 4);
                geoset.Tangents = geoset.Tangents.subarray(0, tangentCount * 4);
            }
        });
    }

    // Fix GeosetAnims
    if (data.GeosetAnims && Array.isArray(data.GeosetAnims)) {
        const geosetCount = data.Geosets?.length || 0;
        data.GeosetAnims.forEach((anim: any) => {
            if (typeof anim.Flags !== 'number') {
                anim.Flags = 0;
            }
            if (anim.GeosetId === undefined || anim.GeosetId === null) {
                anim.GeosetId = null;
            } else if (typeof anim.GeosetId !== 'number' || anim.GeosetId < 0 || anim.GeosetId >= geosetCount) {
                anim.GeosetId = geosetCount > 0 ? 0 : null;
            }
            if (anim.Color instanceof Float32Array) {
                // Keep static color
            } else if (anim.Color && Array.isArray(anim.Color)) {
                anim.Color = new Float32Array(anim.Color.slice(0, 3));
            } else if (anim.Color && typeof anim.Color === 'object') {
                if (Array.isArray((anim.Color as any).Keys)) {
                    anim.Color = ensureAnimVector(anim.Color, 3, false, [1, 1, 1], globalSeqCount) ?? new Float32Array([1, 1, 1]);
                } else {
                    anim.Color = toFloat32Array(anim.Color, 3);
                }
            }
            if (anim.Alpha && typeof anim.Alpha === 'object') {
                anim.Alpha = ensureAnimVector(anim.Alpha, 1, false, undefined, globalSeqCount) ?? anim.Alpha;
            }
            if (typeof anim.Alpha === 'number') {
                if (anim.Alpha < 0) anim.Alpha = 0;
                if (anim.Alpha > 1) anim.Alpha = 1;
            }
            if (typeof anim.UseColor === 'boolean') {
                const flags = typeof anim.Flags === 'number' ? anim.Flags : 0;
                anim.Flags = anim.UseColor ? (flags | 2) : (flags & ~2);
            }
            if (typeof anim.DropShadow === 'boolean') {
                const flags = typeof anim.Flags === 'number' ? anim.Flags : 0;
                anim.Flags = anim.DropShadow ? (flags | 1) : (flags & ~1);
            }
        });
    }

    // Fix TextureAnims (TVertexAnim)
    if (data.TextureAnims && Array.isArray(data.TextureAnims)) {
        data.TextureAnims.forEach((anim: any) => {
            if (anim.Translation) {
                anim.Translation = ensureAnimVector(anim.Translation, 3, false, [0, 0, 0], globalSeqCount);
            }
            if (anim.Rotation) {
                anim.Rotation = ensureAnimVector(anim.Rotation, 4, false, [0, 0, 0, 1], globalSeqCount);
            }
            if (anim.Scaling) {
                anim.Scaling = ensureAnimVector(anim.Scaling, 3, false, [1, 1, 1], globalSeqCount);
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
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Lights.length} lights`);
        data.Lights.forEach((light: any) => {
            const isAnimVector = (val: any): boolean => {
                return val && typeof val === 'object' && Array.isArray(val.Keys);
            };
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
                    if (isAnimVector(light.Color)) {
                        light.Color = fixAnimVector(light.Color, 3, false, [1, 1, 1], globalSeqCount);
                    } else {
                        // Invalid AnimVector, convert to static color
                        light.Color = toFloat32Array(light.Color, 3);
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
                    if (isAnimVector(light.AmbColor)) {
                        light.AmbColor = fixAnimVector(light.AmbColor, 3, false, [1, 1, 1], globalSeqCount);
                    } else {
                        light.AmbColor = toFloat32Array(light.AmbColor, 3);
                    }
                }
            } else {
                light.AmbColor = new Float32Array([1, 1, 1]);
            }

            // Ensure AmbIntensity exists (after mapping from AmbientIntensity)
            if (light.AmbIntensity === undefined) {
                light.AmbIntensity = 0;
            }
            if (light.Intensity === undefined) {
                light.Intensity = 1;
            }
            if (light.AttenuationStart === undefined || light.AttenuationStart === null) {
                light.AttenuationStart = 80;
            }
            if (light.AttenuationEnd === undefined || light.AttenuationEnd === null) {
                light.AttenuationEnd = 200;
            }

            // Ensure static numeric properties exist as numbers (not AnimVector if they're simple values)
            if (light.Intensity !== undefined && typeof light.Intensity === 'object' && light.Intensity !== null) {
                if (isAnimVector(light.Intensity)) {
                    light.Intensity = fixAnimVector(light.Intensity, 1, false, undefined, globalSeqCount);
                } else {
                    light.Intensity = 1; // Default to 1 if malformed
                }
            }

            if (light.AmbIntensity !== undefined && typeof light.AmbIntensity === 'object' && light.AmbIntensity !== null) {
                if (isAnimVector(light.AmbIntensity)) {
                    light.AmbIntensity = fixAnimVector(light.AmbIntensity, 1, false, undefined, globalSeqCount);
                } else {
                    light.AmbIntensity = 0; // Default ambient intensity
                }
            }

            if (light.AttenuationStart !== undefined && typeof light.AttenuationStart === 'object' && light.AttenuationStart !== null) {
                if (isAnimVector(light.AttenuationStart)) {
                    light.AttenuationStart = fixAnimVector(light.AttenuationStart, 1, true, undefined, globalSeqCount);
                } else {
                    light.AttenuationStart = 80;
                }
            }

            if (light.AttenuationEnd !== undefined && typeof light.AttenuationEnd === 'object' && light.AttenuationEnd !== null) {
                if (isAnimVector(light.AttenuationEnd)) {
                    light.AttenuationEnd = fixAnimVector(light.AttenuationEnd, 1, true, undefined, globalSeqCount);
                } else {
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
                    if (isAnimVector(light.Visibility)) {
                        light.Visibility = fixAnimVector(light.Visibility, 1, false, undefined, globalSeqCount);
                    } else {
                        // Malformed AnimVector - remove it
                        delete light.Visibility;
                    }
                }
            }

            light.LightType = typeMap[light.LightType] ?? 0;


            // console.log(`[MainLayout] Light "${light.Name}": Type=${light.LightType}, Intensity=${light.Intensity}, AmbIntensity=${light.AmbIntensity}, AmbColor=[${light.AmbColor[0]?.toFixed(2)},${light.AmbColor[1]?.toFixed(2)},${light.AmbColor[2]?.toFixed(2)}]`);
        });
    }
    // Fix ParticleEmitter2 Flags - convert boolean properties to bitmask
    // ParticleEmitter2Flags: Unshaded=32768, SortPrimsFarZ=65536, LineEmitter=131072,
    //                        Unfogged=262144, ModelSpace=524288, XYQuad=1048576
    // ParticleEmitter2FramesFlags: Head=1, Tail=2
    if (data.ParticleEmitters2 && Array.isArray(data.ParticleEmitters2)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.ParticleEmitters2.length} particle emitters`);
        data.ParticleEmitters2.forEach((emitter: any) => {
            const isAnimVector = (val: any): boolean => {
                return val && typeof val === 'object' && Array.isArray(val.Keys);
            };
            const animProps: Array<{ prop: string, animKey: string }> = [
                { prop: 'EmissionRate', animKey: 'EmissionRateAnim' },
                { prop: 'Speed', animKey: 'SpeedAnim' },
                { prop: 'Variation', animKey: 'VariationAnim' },
                { prop: 'Latitude', animKey: 'LatitudeAnim' },
                { prop: 'Width', animKey: 'WidthAnim' },
                { prop: 'Length', animKey: 'LengthAnim' },
                { prop: 'Gravity', animKey: 'GravityAnim' },
                { prop: 'Visibility', animKey: 'VisibilityAnim' },
            ];

            const fixEmitterAnimProps = (emitter: any, props: typeof animProps) => {
                props.forEach(({ prop, animKey }) => {
                    if (!emitter[prop] && emitter[animKey]) {
                        emitter[prop] = emitter[animKey];
                    }
                    if (isAnimVector(emitter[prop])) {
                        emitter[prop] = fixAnimVector(emitter[prop], 1, false, undefined, globalSeqCount);
                    }
                    if (isAnimVector(emitter[animKey])) {
                        emitter[animKey] = fixAnimVector(emitter[animKey], 1, false, undefined, globalSeqCount);
                    }
                });
            };

            fixEmitterAnimProps(emitter, animProps);

            // Reconstruct Flags bitmask from individual boolean properties.
            // Preserve existing bits if the boolean is undefined (raw parser output doesn't include booleans).
            const particleFlagMask = 32768 | 65536 | 131072 | 262144 | 524288 | 1048576;
            const baseFlags = typeof emitter.Flags === 'number' ? emitter.Flags : 0;
            let flags = baseFlags & ~particleFlagMask;

            const applyFlag = (prop: string, bit: number) => {
                if (emitter[prop] === true) {
                    flags |= bit;
                } else if (emitter[prop] === false) {
                    // Explicitly cleared
                } else if (baseFlags & bit) {
                    flags |= bit;
                }
            };

            applyFlag('Unshaded', 32768);
            applyFlag('SortPrimsFarZ', 65536);
            applyFlag('LineEmitter', 131072);
            applyFlag('Unfogged', 262144);
            applyFlag('ModelSpace', 524288);
            applyFlag('XYQuad', 1048576);

            emitter.Flags = flags;

            // Reconstruct FrameFlags from Head/Tail booleans
            let frameFlags = 0;
            if (emitter.Head === true) frameFlags |= 1;
            if (emitter.Tail === true) frameFlags |= 2;
            if (emitter.Head === undefined && emitter.Tail === undefined) {
                frameFlags = emitter.FrameFlags || 0;
            }
            emitter.FrameFlags = frameFlags;

            // Fix Squirt
            if (emitter.Squirt !== undefined) {
                emitter.Squirt = !!emitter.Squirt;
            }

            // Fix SegmentColor - must be array of 3 Float32Array(3) color vectors
            if (emitter.SegmentColor) {
                if (Array.isArray(emitter.SegmentColor)) {
                    emitter.SegmentColor = emitter.SegmentColor.map((color: any) => {
                        if (color instanceof Float32Array) return color;
                        if (Array.isArray(color)) return new Float32Array(color);
                        if (color && typeof color === 'object') {
                            return new Float32Array([color[0] || 1, color[1] || 1, color[2] || 1]);
                        }
                        return new Float32Array([1, 1, 1]); // Default white
                    });
                    // Ensure exactly 3 colors
                    while (emitter.SegmentColor.length < 3) {
                        emitter.SegmentColor.push(new Float32Array([1, 1, 1]));
                    }
                } else {
                    // Invalid SegmentColor, set default
                    emitter.SegmentColor = [
                        new Float32Array([1, 1, 1]),
                        new Float32Array([1, 1, 1]),
                        new Float32Array([1, 1, 1])
                    ];
                }
            }

            // Fix Alpha - must be Uint8Array(3) or array of 3 numbers
            if (emitter.Alpha) {
                if (!(emitter.Alpha instanceof Uint8Array)) {
                    if (Array.isArray(emitter.Alpha)) {
                        emitter.Alpha = new Uint8Array(emitter.Alpha);
                    } else if (typeof emitter.Alpha === 'object') {
                        emitter.Alpha = new Uint8Array([emitter.Alpha[0] || 255, emitter.Alpha[1] || 255, emitter.Alpha[2] || 0]);
                    } else {
                        emitter.Alpha = new Uint8Array([255, 255, 0]);
                    }
                }
            }

            // Fix ParticleScaling - must be Float32Array(3)
            if (emitter.ParticleScaling) {
                if (!(emitter.ParticleScaling instanceof Float32Array)) {
                    if (Array.isArray(emitter.ParticleScaling)) {
                        emitter.ParticleScaling = new Float32Array(emitter.ParticleScaling);
                    } else if (typeof emitter.ParticleScaling === 'object') {
                        emitter.ParticleScaling = new Float32Array([
                            emitter.ParticleScaling[0] || 1,
                            emitter.ParticleScaling[1] || 1,
                            emitter.ParticleScaling[2] || 1
                        ]);
                    } else {
                        emitter.ParticleScaling = new Float32Array([1, 1, 1]);
                    }
                }
            }

            // Fix UV animations - must be Uint32Array(3)
            const uvAnims = ['LifeSpanUVAnim', 'DecayUVAnim', 'TailUVAnim', 'TailDecayUVAnim'];
            uvAnims.forEach(animName => {
                if (emitter[animName]) {
                    if (!(emitter[animName] instanceof Uint32Array)) {
                        emitter[animName] = new Uint32Array(emitter[animName]);
                    }
                } else {
                    emitter[animName] = new Uint32Array([0, 0, 1]); // Default start, end, repeat
                }
            });

            // Fix Squirt
            if (emitter.Squirt !== undefined) {
                emitter.Squirt = !!emitter.Squirt;
            }

            // console.log(`[MainLayout] ParticleEmitter2 "${emitter.Name}": Flags=${flags}, FrameFlags=${frameFlags}`);
        });
    }

    // Fix ParticleEmitterPopcorn
    if (data.ParticleEmitterPopcorns && Array.isArray(data.ParticleEmitterPopcorns)) {
        data.ParticleEmitterPopcorns.forEach((emitter: any) => {
            const isAnimVector = (val: any): boolean => {
                return val && typeof val === 'object' && Array.isArray(val.Keys);
            };
            const animProps: Array<{ prop: string, animKey: string }> = [
                { prop: 'LifeSpan', animKey: 'LifeSpanAnim' },
                { prop: 'EmissionRate', animKey: 'EmissionRateAnim' },
                { prop: 'Speed', animKey: 'SpeedAnim' },
                { prop: 'Color', animKey: 'ColorAnim' },
                { prop: 'Alpha', animKey: 'AlphaAnim' },
                { prop: 'Visibility', animKey: 'VisibilityAnim' },
            ];

            animProps.forEach(({ prop, animKey }) => {
                if (!emitter[prop] && emitter[animKey]) {
                    emitter[prop] = emitter[animKey];
                }
                if (isAnimVector(emitter[prop])) {
                    emitter[prop] = fixAnimVector(emitter[prop], 1, false, undefined, globalSeqCount);
                }
                if (isAnimVector(emitter[animKey])) {
                    emitter[animKey] = fixAnimVector(emitter[animKey], 1, false, undefined, globalSeqCount);
                }
            });

            // Ensure Color is Float32Array if static
            if (emitter.Color && Array.isArray(emitter.Color)) {
                emitter.Color = new Float32Array(emitter.Color);
            }
        });
    }

    // Fix RibbonEmitters
    if (data.RibbonEmitters && Array.isArray(data.RibbonEmitters)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.RibbonEmitters.length} ribbon emitters`);
        data.RibbonEmitters.forEach((emitter: any) => {
            const isAnimVector = (val: any): boolean => {
                return val && typeof val === 'object' && Array.isArray(val.Keys);
            };
            const animProps: Array<{ prop: string, animKey: string }> = [
                { prop: 'Height', animKey: 'HeightAnim' },
                { prop: 'Alpha', animKey: 'AlphaAnim' },
                { prop: 'Color', animKey: 'ColorAnim' },
                { prop: 'Visibility', animKey: 'VisibilityAnim' },
            ];

            animProps.forEach(({ prop, animKey }) => {
                if (!emitter[prop] && emitter[animKey]) {
                    emitter[prop] = emitter[animKey];
                }
                if (isAnimVector(emitter[prop])) {
                    emitter[prop] = fixAnimVector(emitter[prop], 1, false, undefined, globalSeqCount);
                }
                if (isAnimVector(emitter[animKey])) {
                    emitter[animKey] = fixAnimVector(emitter[animKey], 1, false, undefined, globalSeqCount);
                }
            });

            // Ensure Color is Float32Array if static
            if (emitter.Color && Array.isArray(emitter.Color)) {
                emitter.Color = new Float32Array(emitter.Color);
            }
        });
    }

    // Fix Cameras - ensure Position and TargetPosition are Float32Arrays
    if (data.Cameras && Array.isArray(data.Cameras)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Cameras.length} cameras`);
        data.Cameras.forEach((camera: any) => {
            if (camera.FieldOfView === undefined || camera.FieldOfView === null) {
                camera.FieldOfView = 0.7853; // ~45 deg
            }
            if (camera.NearClip === undefined || camera.NearClip === null) {
                camera.NearClip = 16;
            }
            if (camera.FarClip === undefined || camera.FarClip === null) {
                camera.FarClip = 5000;
            }
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
            if (camera.Translation) {
                camera.Translation = ensureAnimVector(camera.Translation, 3, false, [0, 0, 0], globalSeqCount);
            }
            if (camera.TargetTranslation) {
                camera.TargetTranslation = ensureAnimVector(camera.TargetTranslation, 3, false, [0, 0, 0], globalSeqCount);
            }
            if (camera.Rotation) {
                camera.Rotation = ensureAnimVector(camera.Rotation, 1, false, [0], globalSeqCount);
            }
        });
    }

    // Fix CollisionShapes - ensure Vertices are Float32Arrays
    if (data.CollisionShapes && Array.isArray(data.CollisionShapes)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.CollisionShapes.length} collision shapes`);
        data.CollisionShapes.forEach((shape: any) => {
            // Shape 0 = Box (6 floats), Shape 2 = Sphere (3 floats)
            const vertexCount = shape.Shape === 0 ? 6 : 3;
            if (shape.Vertices) {
                // Fix: Vertex1/Vertex2/Vertices in CollisionShape are vectors [x, y, z]
                // and should NOT be flattened into a single large Float32Array if they are stored as arrays of arrays.
                // However, war3-model MDX generator expects a flattened Float32Array for 'Vertices' field.
                if (Array.isArray(shape.Vertices[0])) {
                    // It's [[x,y,z], [x,y,z]] - flatten it
                    const flattened = new Float32Array(shape.Vertices.length * 3);
                    for (let i = 0; i < shape.Vertices.length; i++) {
                        flattened[i * 3] = shape.Vertices[i][0];
                        flattened[i * 3 + 1] = shape.Vertices[i][1];
                        flattened[i * 3 + 2] = shape.Vertices[i][2];
                    }
                    shape.Vertices = flattened;
                } else {
                    shape.Vertices = toFloat32Array(shape.Vertices, vertexCount);
                }
            } else {
                shape.Vertices = new Float32Array(vertexCount);
            }
            fixNode(shape, globalSeqCount); // CollisionShapes are also Nodes
        });
    }

    // Fix all node-type arrays to ensure AnimVector data is valid
    const nodeArrayNames = ['Bones', 'Helpers', 'Attachments', 'EventObjects', 'Lights', 'RibbonEmitters', 'ParticleEmitters', 'ParticleEmitters2', 'ParticleEmitterPopcorns'];
    nodeArrayNames.forEach(arrayName => {
        if (data[arrayName] && Array.isArray(data[arrayName])) {
            data[arrayName].forEach((node: any) => fixNode(node, globalSeqCount));
        }
    });

    // Fix Attachment-specific properties
    if (data.Attachments && Array.isArray(data.Attachments)) {
        data.Attachments.forEach((attachment: any) => {
            // Ensure AttachmentID is defined
            if (attachment.AttachmentID === undefined) {
                attachment.AttachmentID = 0;
            }
            // Path must be a string (empty is fine for war3-model)
            if (attachment.Path === undefined) {
                attachment.Path = '';
            }
            // Visibility is an AnimVector - fix or remove if invalid
            if (attachment.Visibility) {
                attachment.Visibility = fixAnimVector(attachment.Visibility, 1, false, undefined, globalSeqCount);
                if (!attachment.Visibility || !attachment.Visibility.Keys || attachment.Visibility.Keys.length === 0) {
                    delete attachment.Visibility;
                }
            }
        });
    }

    // Fix Geosets - ensure TotalGroupsCount is consistent with Groups array
    if (data.Geosets && Array.isArray(data.Geosets)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Geosets.length} geosets`);
        const materialCount = data.Materials?.length || 0;
        data.Geosets.forEach((geoset: any, index: number) => {
            const vertexCount = geoset.Vertices ? Math.floor(geoset.Vertices.length / 3) : 0;

            // Normalize Groups to number[][]
            if (geoset.Groups && Array.isArray(geoset.Groups)) {
                geoset.Groups = geoset.Groups.map((group: any) => {
                    const matrices = Array.isArray(group)
                        ? group
                        : Array.isArray(group?.matrices)
                            ? group.matrices
                            : [];
                    return matrices.map((value: any) => {
                        const num = Number(value);
                        if (!Number.isFinite(num) || num < 0) return 0;
                        return Math.floor(num);
                    });
                });
            } else if (!geoset.Groups) {
                geoset.Groups = [];
            }

            if (geoset.Groups.length === 0 && vertexCount > 0) {
                geoset.Groups = [[0]];
            }

            // Recalculate TotalGroupsCount from Groups array
            const totalCount = geoset.Groups.reduce((sum: number, group: any) => {
                return sum + (Array.isArray(group) ? group.length : 0);
            }, 0);
            if (geoset.TotalGroupsCount !== totalCount) {
                console.log(`[MainLayout] Geoset ${index}: Updating TotalGroupsCount from ${geoset.TotalGroupsCount} to ${totalCount}`);
                geoset.TotalGroupsCount = totalCount;
            }

            // Ensure VertexGroup exists and is Uint8Array (MDX uses uint8)
            if (!geoset.VertexGroup) {
                geoset.VertexGroup = new Uint8Array(vertexCount);
            } else if (!(geoset.VertexGroup instanceof Uint8Array)) {
                geoset.VertexGroup = toUint8ClampedArray(geoset.VertexGroup);
            }
            if (geoset.VertexGroup.length !== vertexCount) {
                const fixed = new Uint8Array(vertexCount);
                fixed.set(geoset.VertexGroup.subarray(0, vertexCount));
                geoset.VertexGroup = fixed;
            }

            const maxGroupIndex = geoset.Groups.length - 1;
            if (maxGroupIndex >= 0) {
                for (let i = 0; i < geoset.VertexGroup.length; i++) {
                    if (geoset.VertexGroup[i] > maxGroupIndex) {
                        geoset.VertexGroup[i] = 0;
                    }
                }
            }

            // MaterialID bounds
            if (typeof geoset.MaterialID !== 'number' || geoset.MaterialID < 0 || (materialCount > 0 && geoset.MaterialID >= materialCount)) {
                geoset.MaterialID = 0;
            }
            if (geoset.SelectionGroup === undefined || geoset.SelectionGroup === null) {
                geoset.SelectionGroup = 0;
            }
            if (geoset.Unselectable === undefined) {
                geoset.Unselectable = false;
            }

            // Ensure Faces is Uint16Array
            if (geoset.Faces && !(geoset.Faces instanceof Uint16Array)) {
                geoset.Faces = toUint16Array(geoset.Faces);
            }
        });
    }

    // Fix Materials - ensure all layer properties are valid for MDX generator
    if (data.Materials && Array.isArray(data.Materials)) {
        // console.log(`[MainLayout] prepareModelDataForSave: Processing ${data.Materials.length} materials`);
        data.Materials.forEach((material: any, matIndex: number) => {
            // Ensure material properties
            if (material.PriorityPlane === undefined) material.PriorityPlane = 0;
            if (material.RenderMode === undefined) material.RenderMode = 0;

            // Rebuild RenderMode from boolean flags when provided
            const renderMask = 1 | 16 | 32;
            const baseRenderMode = typeof material.RenderMode === 'number' ? material.RenderMode : 0;
            let renderMode = baseRenderMode & ~renderMask;
            const applyRenderFlag = (value: any, bit: number) => {
                if (value === true) {
                    renderMode |= bit;
                } else if (value === false) {
                    // Explicitly cleared
                } else if (baseRenderMode & bit) {
                    renderMode |= bit;
                }
            };
            applyRenderFlag(material.ConstantColor, 1);
            const sortPrims = material.SortPrimsFarZ ?? material.SortPrimitivesFarZ;
            applyRenderFlag(sortPrims, 16);
            applyRenderFlag(material.FullResolution, 32);
            material.RenderMode = renderMode;

            if (material.Layers && Array.isArray(material.Layers)) {
                material.Layers.forEach((layer: any, layerIndex: number) => {
                    // FilterMode - required, default to 0 (None)
                    let filterModeValue: any = layer.FilterMode;
                    if (filterModeValue === undefined && layer.filterMode !== undefined) {
                        filterModeValue = layer.filterMode;
                    }
                    if (filterModeValue && typeof filterModeValue === 'object' && 'value' in filterModeValue) {
                        filterModeValue = (filterModeValue as any).value;
                    }
                    if (filterModeValue === undefined || filterModeValue === null) {
                        filterModeValue = 0;
                    }
                    if (typeof filterModeValue === 'string') {
                        const normalized = filterModeValue.replace(/\s+/g, '').toLowerCase();
                        const map: Record<string, number> = {
                            none: 0,
                            transparent: 1,
                            blend: 2,
                            additive: 3,
                            addalpha: 4,
                            modulate: 5,
                            modulate2x: 6
                        };
                        if (/^\d+$/.test(normalized)) {
                            filterModeValue = Number.parseInt(normalized, 10);
                        } else {
                            filterModeValue = map[normalized] ?? 0;
                        }
                    }
                    if (typeof filterModeValue !== 'number' || !Number.isFinite(filterModeValue)) {
                        filterModeValue = 0;
                    }
                    layer.FilterMode = Math.max(0, Math.min(6, Math.floor(filterModeValue)));

                    // Shading - required, default to 0
                    const shadingMask = 1 | 2 | 16 | 32 | 64 | 128;
                    const baseShading = typeof layer.Shading === 'number' ? layer.Shading : 0;
                    let shading = baseShading & ~shadingMask;
                    const applyShadingFlag = (value: any, bit: number) => {
                        if (value === true) {
                            shading |= bit;
                        } else if (value === false) {
                            // Explicitly cleared
                        } else if (baseShading & bit) {
                            shading |= bit;
                        }
                    };
                    applyShadingFlag(layer.Unshaded, 1);
                    const sphereEnv = layer.SphereEnvMap ?? layer.SphereEnvironmentMap;
                    applyShadingFlag(sphereEnv, 2);
                    applyShadingFlag(layer.TwoSided, 16);
                    applyShadingFlag(layer.Unfogged, 32);
                    applyShadingFlag(layer.NoDepthTest, 64);
                    applyShadingFlag(layer.NoDepthSet, 128);
                    layer.Shading = shading;

                    // TextureID - can be number or AnimVector, default to 0
                    if (layer.TextureID === undefined || layer.TextureID === null) {
                        layer.TextureID = 0;
                    } else if (typeof layer.TextureID === 'object') {
                        // Fix AnimVector Key Vectors to be Int32Array
                        layer.TextureID = ensureAnimVector(layer.TextureID, 1, true, undefined, globalSeqCount) ?? layer.TextureID;
                    }
                    if (typeof layer.TextureID === 'number') {
                        const texCount = data.Textures?.length || 0;
                        if (texCount > 0 && (layer.TextureID < 0 || layer.TextureID >= texCount)) {
                            layer.TextureID = 0;
                        }
                    }

                    // TVertexAnimId - can be null or number, convert undefined to null
                    if (layer.TVertexAnimId === undefined && layer.TextureAnimationId !== undefined) {
                        layer.TVertexAnimId = layer.TextureAnimationId;
                    }
                    if (layer.TVertexAnimId === undefined) {
                        layer.TVertexAnimId = null;
                    }
                    if (typeof layer.TVertexAnimId === 'number') {
                        const tvAnimCount = data.TextureAnims?.length || 0;
                        if (layer.TVertexAnimId < 0 || (tvAnimCount > 0 && layer.TVertexAnimId >= tvAnimCount)) {
                            layer.TVertexAnimId = null;
                        }
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
                        layer.Alpha = ensureAnimVector(layer.Alpha, 1, false, undefined, globalSeqCount) ?? layer.Alpha;
                    } else if (typeof layer.Alpha === 'number') {
                        if (layer.Alpha < 0) layer.Alpha = 0;
                        if (layer.Alpha > 1) layer.Alpha = 1;
                    }

                    // Optional HD/extended layer properties
                    if (layer.EmissiveGain !== undefined && layer.EmissiveGain !== null) {
                        if (typeof layer.EmissiveGain === 'object') {
                            layer.EmissiveGain = ensureAnimVector(layer.EmissiveGain, 1, false, undefined, globalSeqCount) ?? layer.EmissiveGain;
                        }
                    }
                    if (layer.FresnelColor !== undefined && layer.FresnelColor !== null) {
                        if (layer.FresnelColor instanceof Float32Array) {
                            // ok
                        } else if (layer.FresnelColor && typeof layer.FresnelColor === 'object' && Array.isArray(layer.FresnelColor.Keys)) {
                            layer.FresnelColor = fixAnimVector(layer.FresnelColor, 3, false, [1, 1, 1], globalSeqCount);
                        } else {
                            layer.FresnelColor = toFloat32Array(layer.FresnelColor, 3);
                        }
                    }
                    if (layer.FresnelOpacity !== undefined && layer.FresnelOpacity !== null) {
                        if (typeof layer.FresnelOpacity === 'object') {
                            layer.FresnelOpacity = ensureAnimVector(layer.FresnelOpacity, 1, false, undefined, globalSeqCount) ?? layer.FresnelOpacity;
                        }
                    }
                    if (layer.FresnelTeamColor !== undefined && layer.FresnelTeamColor !== null) {
                        if (typeof layer.FresnelTeamColor === 'object') {
                            layer.FresnelTeamColor = ensureAnimVector(layer.FresnelTeamColor, 1, false, undefined, globalSeqCount) ?? layer.FresnelTeamColor;
                        }
                    }

                    const extraTextureIds = [
                        'NormalTextureID',
                        'ORMTextureID',
                        'EmissiveTextureID',
                        'TeamColorTextureID',
                        'ReflectionsTextureID'
                    ];
                    extraTextureIds.forEach((key) => {
                        if (layer[key] === undefined || layer[key] === null) return;
                        if (typeof layer[key] === 'object') {
                            layer[key] = ensureAnimVector(layer[key], 1, true, undefined, globalSeqCount) ?? layer[key];
                        }
                        if (typeof layer[key] === 'number') {
                            const texCount = data.Textures?.length || 0;
                            if (texCount > 0 && (layer[key] < 0 || layer[key] >= texCount)) {
                                layer[key] = 0;
                            }
                        }
                    });

                    // console.log(`[MainLayout] Material[${matIndex}].Layer[${layerIndex}]: FilterMode=${layer.FilterMode}, Shading=${layer.Shading}, TextureID=${typeof layer.TextureID === 'number' ? layer.TextureID : 'AnimVector'}, TVertexAnimId=${layer.TVertexAnimId}, CoordId=${layer.CoordId}, Alpha=${typeof layer.Alpha === 'number' ? layer.Alpha : 'AnimVector'}`);
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
        ...(data.CollisionShapes || []),
        ...(data.ParticleEmitterPopcorns || []) // Added Popcorn emitters
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
    const typeOrder = ['Bone', 'Light', 'Helper', 'Attachment', 'ParticleEmitter', 'ParticleEmitter2', 'RibbonEmitter', 'EventObject', 'CollisionShape', 'ParticleEmitterPopcorn'];
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
                                        typeName === 'CollisionShape' ? 'CollisionShapes' :
                                            'ParticleEmitterPopcorns'; // Added Popcorn

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
            const vertexCount = geoset.Vertices ? Math.floor(geoset.Vertices.length / 3) : 0;
            if (geoset.Vertices && geoset.Vertices.length % 3 !== 0) {
                errors.push(`Geoset ${i} vertex buffer length is not divisible by 3`);
            }
            if (geoset.Faces && geoset.Faces.length % 3 !== 0) {
                errors.push(`Geoset ${i} face index count is not divisible by 3`);
            }
            if (geoset.VertexGroup && geoset.VertexGroup.length !== vertexCount) {
                errors.push(`Geoset ${i} VertexGroup length mismatch (expected ${vertexCount}, found ${geoset.VertexGroup.length})`);
            }
            if (geoset.Groups && geoset.VertexGroup) {
                const maxGroupIndex = geoset.Groups.length - 1;
                if (maxGroupIndex >= 0) {
                    for (let v = 0; v < geoset.VertexGroup.length; v++) {
                        if (geoset.VertexGroup[v] > maxGroupIndex) {
                            errors.push(`Geoset ${i} VertexGroup index out of range at vertex ${v}`);
                            break;
                        }
                    }
                }
            }
            if (typeof geoset.MaterialID === 'number') {
                const materialCount = data.Materials?.length || 0;
                if (materialCount > 0 && (geoset.MaterialID < 0 || geoset.MaterialID >= materialCount)) {
                    errors.push(`Geoset ${i} MaterialID out of range`);
                }
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

    // 8. Check texture paths
    if (data.Textures && Array.isArray(data.Textures)) {
        for (let i = 0; i < data.Textures.length; i++) {
            const tex = data.Textures[i];
            const image = typeof tex?.Image === 'string' ? tex.Image : '';
            if (!image || image.trim() === '') {
                errors.push(`Texture ${i} has empty Image path (Image="${tex?.Image ?? ''}", Path="${tex?.Path ?? ''}")`);
            }
        }
    }

    // 9. Check Sequences integrity
    if (data.Sequences && Array.isArray(data.Sequences)) {
        data.Sequences.forEach((seq: any, index: number) => {
            if (!seq.Interval || seq.Interval.length !== 2) {
                errors.push(`Sequence ${index} "${seq.Name || ''}" has invalid Interval`);
                return;
            }
            const start = Number(seq.Interval[0]);
            const end = Number(seq.Interval[1]);
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
                errors.push(`Sequence ${index} "${seq.Name || ''}" Interval has non-numeric values`);
            } else if (start > end) {
                errors.push(`Sequence ${index} "${seq.Name || ''}" Interval start > end`);
            }
        });
    }

    return errors;
}



const MainLayout: React.FC = () => {
    // Zustand stores
    const modelPath = useModelStore(state => state.modelPath)
    const setZustandModelData = useModelStore(state => state.setModelData)
    const addTab = useModelStore(state => state.addTab)
    const setZustandLoading = useModelStore(state => state.setLoading)
    const showCreateNodeDialog = useUIStore(state => state.showCreateNodeDialog);
    const setCreateNodeDialogVisible = useUIStore(state => state.setCreateNodeDialogVisible);
    const showTransformModelDialog = useUIStore(state => state.showTransformModelDialog);
    const setTransformModelDialogVisible = useUIStore(state => state.setTransformModelDialogVisible);
    const currentSequence = useModelStore(state => state.currentSequence)
    const isPlaying = useModelStore(state => state.isPlaying)
    const playbackSpeed = useModelStore(state => state.playbackSpeed)
    const setPlaying = useModelStore(state => state.setPlaying)
    const { toggleNodeManager, toggleModelInfo } = useUIStore()
    const { mainMode, setMainMode } = useSelectionStore()



    const [activeEditor, setActiveEditor] = useState<string | null>(null)
    const [showGeosetAnimModal, setShowGeosetAnimModal] = useState<boolean>(false)
    const [showGeosetVisibilityToolModal, setShowGeosetVisibilityToolModal] = useState<boolean>(false)
    const [showTextureModal, setShowTextureModal] = useState<boolean>(false)
    const [showTextureAnimModal, setShowTextureAnimModal] = useState<boolean>(false)
    const [showSequenceModal, setShowSequenceModal] = useState<boolean>(false)
    const [showCameraModal, setShowCameraModal] = useState<boolean>(false)

    const [showMaterialModal, setShowMaterialModal] = useState<boolean>(false)
    const [showGeosetModal, setShowGeosetModal] = useState<boolean>(false)
    const [showGlobalSeqModal, setShowGlobalSeqModal] = useState<boolean>(false)
    const [showAbout, setShowAbout] = useState<boolean>(false)


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
        showAttachments, setShowAttachments,
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
    const [closeConfirmVisible, setCloseConfirmVisible] = useState<boolean>(false)

    // Editor Panel Resizing
    const [editorWidth, setEditorWidth] = useState<number>(400)
    const [isResizingEditor, setIsResizingEditor] = useState<boolean>(false)

    const viewerRef = useRef<ViewerRef>(null)
    const hasCheckedCli = useRef(false);
    const processedHotOpenPaths = useRef<Set<string>>(new Set())
    const isSavingRef = useRef(false); // Track if a save operation is in progress
    const isExternalModelDragRef = useRef(false);
    const closeConfirmVisibleRef = useRef(false);
    const bypassClosePromptRef = useRef(false);
    const panelStateRef = useRef({
        activeEditor: null as string | null,
        showGeosetAnimModal: false,
        showGeosetVisibilityToolModal: false,
        showTextureModal: false,
        showTextureAnimModal: false,
        showSequenceModal: false,
        showCameraModal: false,
        showMaterialModal: false,
        showGeosetModal: false,
        showGlobalSeqModal: false,
        showAbout: false
    })
    const handleImportRef = useRef<(() => void) | (() => Promise<void>)>(() => { })
    const handleSaveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))
    const handleSaveAsRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))
    const handleCopyModelRef = useRef<() => void>(() => { })
    const detachedTextureWindowPromiseRef = useRef<Promise<WebviewWindow> | null>(null)
    const detachedManagerWindowPromiseRef = useRef<Partial<Record<DetachedManagerType, Promise<WebviewWindow> | null>>>({})
    const detachedManagerHydratedRef = useRef<Partial<Record<DetachedManagerType, boolean>>>({})
    const detachedTextureSyncRevisionRef = useRef(0)
    const detachedTextureLastSyncedModelPathRef = useRef<string | undefined>(undefined)
    const detachedTextureLastSyncedTexturesRef = useRef<any[]>([])
    const openModelAsTab = useCallback((filePath: string) => {
        console.log('[MainLayout] Opening model as tab:', filePath)
        setIsLoading(true)
        setZustandLoading(true)
        const added = addTab(filePath)
        if (!added) {
            setIsLoading(false)
            setZustandLoading(false)
        }
        return added
    }, [addTab])
    const hasModelData = Boolean(modelData)

    const cloneTexturesForSync = useCallback((textures: any[]): any[] => {
        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(textures)
            }
        } catch {
            // Fallback to JSON clone.
        }
        return JSON.parse(JSON.stringify(textures))
    }, [])

    const getTextureSignature = useCallback((texture: any): string => {
        if (texture === null || texture === undefined) return String(texture)
        if (typeof texture !== 'object') return String(texture)
        try {
            return JSON.stringify(texture)
        } catch {
            return `${texture.Image ?? ''}|${texture.ReplaceableId ?? ''}|${texture.Flags ?? ''}`
        }
    }, [])

    const buildTextureDeltaOps = useCallback((previousTextures: any[], nextTextures: any[]): DetachedTextureDeltaOp[] => {
        const ops: DetachedTextureDeltaOp[] = []
        const previousLength = previousTextures.length
        const nextLength = nextTextures.length
        const commonLength = Math.min(previousLength, nextLength)

        for (let index = 0; index < commonLength; index++) {
            if (getTextureSignature(previousTextures[index]) !== getTextureSignature(nextTextures[index])) {
                ops.push({
                    type: 'update',
                    index,
                    texture: nextTextures[index]
                })
            }
        }

        if (nextLength > previousLength) {
            for (let index = previousLength; index < nextLength; index++) {
                ops.push({
                    type: 'add',
                    index,
                    texture: nextTextures[index]
                })
            }
        } else if (nextLength < previousLength) {
            for (let index = previousLength - 1; index >= nextLength; index--) {
                ops.push({
                    type: 'remove',
                    index
                })
            }
        }

        return ops
    }, [getTextureSignature])

    const emitTextureSnapshotToDetachedWindow = useCallback(async (textures?: any[], path?: string) => {
        const state = useModelStore.getState()
        const syncTextures = Array.isArray(textures)
            ? textures
            : (Array.isArray(state.modelData?.Textures) ? state.modelData?.Textures : [])
        const syncPath = path ?? state.modelPath ?? undefined
        const revision = ++detachedTextureSyncRevisionRef.current

        await emitTo(DETACHED_TEXTURE_EDITOR_LABEL, DETACHED_TEXTURE_EDITOR_EVENTS.snapshot, {
            textures: syncTextures,
            modelPath: syncPath,
            revision
        })

        detachedTextureLastSyncedModelPathRef.current = syncPath
        detachedTextureLastSyncedTexturesRef.current = cloneTexturesForSync(syncTextures)
    }, [cloneTexturesForSync])

    const emitTextureDeltaToDetachedWindow = useCallback(async (payload: DetachedTextureEditorDeltaPayload) => {
        if (!Array.isArray(payload.ops) || payload.ops.length === 0) {
            return
        }
        await emitTo(DETACHED_TEXTURE_EDITOR_LABEL, DETACHED_TEXTURE_EDITOR_EVENTS.delta, payload)
    }, [])

    const ensureDetachedTextureEditorWindow = useCallback(async (showOnReady: boolean) => {
        let windowInstance = await WebviewWindow.getByLabel(DETACHED_TEXTURE_EDITOR_LABEL)

        if (!windowInstance) {
            if (!detachedTextureWindowPromiseRef.current) {
                detachedTextureWindowPromiseRef.current = (async () => {
                    const detachedWindow = new WebviewWindow(DETACHED_TEXTURE_EDITOR_LABEL, {
                        title: '纹理管理器',
                        url: `/?detached=${DETACHED_TEXTURE_EDITOR_QUERY}`,
                        width: 980,
                        height: 720,
                        minWidth: 800,
                        minHeight: 560,
                        center: false,
                        focus: false,
                        visible: false,
                        resizable: true
                    })

                    await new Promise<void>((resolve, reject) => {
                        detachedWindow.once('tauri://created', () => resolve())
                        detachedWindow.once('tauri://error', (error) => reject(error))
                    })

                    return detachedWindow
                })().finally(() => {
                    detachedTextureWindowPromiseRef.current = null
                })
            }

            windowInstance = await detachedTextureWindowPromiseRef.current
        }

        if (!windowInstance) {
            throw new Error('Failed to create detached texture window')
        }

        if (showOnReady) {
            await windowInstance.show()
            await windowInstance.setFocus()
            emitTextureSnapshotToDetachedWindow().catch((error) => {
                console.error('[MainLayout] detached texture snapshot failed:', error)
            })
        } else {
            emitTextureSnapshotToDetachedWindow().catch((error) => {
                console.error('[MainLayout] detached texture prewarm snapshot failed:', error)
            })
        }

        return windowInstance
    }, [emitTextureSnapshotToDetachedWindow])

    const openDetachedTextureEditor = useCallback(async () => {
        try {
            setShowTextureModal(false)
            await ensureDetachedTextureEditorWindow(true)
        } catch (error) {
            console.error('[MainLayout] openDetachedTextureEditor failed:', error)
            showMessage('error', '错误', '无法打开独立纹理管理器窗口')
        }
    }, [ensureDetachedTextureEditorWindow])

    const getDetachedManagerWindowTitle = useCallback((managerType: DetachedManagerType): string => {
        const windowTitles: Record<DetachedManagerType, string> = {
            camera: '镜头管理器',
            geoset: '多边形管理器',
            geosetAnim: '多边形动画管理器',
            textureAnim: '贴图动画管理器',
            material: '材质管理器',
            sequence: '模型动作管理器',
            globalSequence: '模型全局动作管理器'
        }
        return windowTitles[managerType]
    }, [])

    const ensureDetachedManagerWindow = useCallback(async (managerType: DetachedManagerType, showOnReady: boolean) => {
        const windowLabel = getDetachedManagerLabel(managerType)
        const windowQuery = getDetachedManagerQuery(managerType)
        const windowTitle = getDetachedManagerWindowTitle(managerType)

        let windowInstance = await WebviewWindow.getByLabel(windowLabel)
        const hadExistingWindow = Boolean(windowInstance)

        if (!windowInstance) {
            detachedManagerHydratedRef.current[managerType] = false
            if (!detachedManagerWindowPromiseRef.current[managerType]) {
                detachedManagerWindowPromiseRef.current[managerType] = (async () => {
                    const windowOptions: any = {
                        title: windowTitle,
                        url: `/?detached=${windowQuery}`,
                        width: 980,
                        height: 720,
                        minWidth: 760,
                        minHeight: 540,
                        center: false,
                        focus: false,
                        visible: false,
                        resizable: true,
                        backgroundColor: '#1f1f1f'
                    }
                    const detachedWindow = new WebviewWindow(windowLabel, windowOptions)

                    await new Promise<void>((resolve, reject) => {
                        detachedWindow.once('tauri://created', () => resolve())
                        detachedWindow.once('tauri://error', (error) => reject(error))
                    })

                    return detachedWindow
                })().finally(() => {
                    detachedManagerWindowPromiseRef.current[managerType] = null
                })
            }

            windowInstance = await detachedManagerWindowPromiseRef.current[managerType]
        }

        if (!windowInstance) {
            throw new Error(`Failed to create detached manager window: ${managerType}`)
        }

        const pushSnapshot = async () => {
            const { modelData: currentModelData, modelPath: currentModelPath } = useModelStore.getState()
            if (!currentModelData) return
            const snapshotModelData = buildDetachedManagerSnapshotModelData(managerType, currentModelData)
            if (!snapshotModelData) return

            try {
                await emitTo(windowLabel, DETACHED_MANAGER_EVENTS.snapshot, {
                    managerType,
                    modelData: snapshotModelData,
                    modelPath: currentModelPath || undefined
                })
                return
            } catch {
                // Fallback to serializable clone path.
            }

            let serializableModelData: any = null
            try {
                if (typeof structuredClone === 'function') {
                    serializableModelData = structuredClone(snapshotModelData)
                }
            } catch {
                // Fallback to JSON clone.
            }
            if (!serializableModelData) {
                try {
                    serializableModelData = JSON.parse(JSON.stringify(snapshotModelData))
                } catch {
                    serializableModelData = null
                }
            }
            if (!serializableModelData) return

            await emitTo(windowLabel, DETACHED_MANAGER_EVENTS.snapshot, {
                managerType,
                modelData: serializableModelData,
                modelPath: currentModelPath || undefined
            })
        }

        if (showOnReady) {
            await windowInstance.show()
            await windowInstance.setFocus()
        }
        // New windows receive snapshot via "ready" handshake from detached side.
        // Existing hidden windows need an immediate refresh when reopened.
        const shouldPushSnapshotNow =
            (showOnReady && hadExistingWindow) ||
            detachedManagerHydratedRef.current[managerType] === true
        if (shouldPushSnapshotNow) {
            pushSnapshot().catch((error) => {
                console.warn(`[MainLayout] detached manager snapshot push failed (${managerType}):`, error)
            })
        }

        return windowInstance
    }, [getDetachedManagerWindowTitle])

    const openDetachedManagerWindow = useCallback(async (managerType: DetachedManagerType) => {
        try {
            await ensureDetachedManagerWindow(managerType, true)
        } catch (error) {
            console.error(`[MainLayout] openDetachedManagerWindow failed (${managerType}):`, error)
            showMessage('error', '错误', '无法打开独立管理器窗口')
        }
    }, [ensureDetachedManagerWindow])

    const toDetachedSerializableModelData = useCallback((data: any) => {
        if (!data) return null
        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(data)
            }
        } catch {
            // Fallback to JSON clone.
        }
        try {
            return JSON.parse(JSON.stringify(data))
        } catch (error) {
            console.error('[MainLayout] model snapshot serialization failed:', error)
            return null
        }
    }, [])

    const emitManagerSnapshot = useCallback(async (managerType: DetachedManagerType, targetLabel?: string) => {
        const { modelData: currentModelData, modelPath: currentModelPath } = useModelStore.getState()
        if (!currentModelData) return
        const snapshotModelData = buildDetachedManagerSnapshotModelData(managerType, currentModelData)
        if (!snapshotModelData) return

        const label = targetLabel ?? getDetachedManagerLabel(managerType)
        try {
            await emitTo(label, DETACHED_MANAGER_EVENTS.snapshot, {
                managerType,
                modelData: snapshotModelData,
                modelPath: currentModelPath || undefined
            })
            return
        } catch (error) {
            console.warn(`[MainLayout] manager raw snapshot failed, fallback clone (${managerType}):`, error)
        }

        const serializableModelData = toDetachedSerializableModelData(snapshotModelData)
        if (!serializableModelData) return
        await emitTo(label, DETACHED_MANAGER_EVENTS.snapshot, {
            managerType,
            modelData: serializableModelData,
            modelPath: currentModelPath || undefined
        })
    }, [toDetachedSerializableModelData])

    const closeAuxiliaryWindows = useCallback(async () => {
        try {
            const allWindows = await WebviewWindow.getAll()
            const childWindows = allWindows.filter((window) => window.label !== 'main')
            await Promise.all(
                childWindows.map(async (window) => {
                    try {
                        await window.destroy()
                    } catch (error) {
                        console.warn(`[MainLayout] failed to destroy child window "${window.label}", fallback to close:`, error)
                        try {
                            await window.close()
                        } catch (closeError) {
                            console.warn(`[MainLayout] failed to close child window "${window.label}":`, closeError)
                        }
                    }
                })
            )
            detachedManagerHydratedRef.current = {}
        } catch (error) {
            console.error('[MainLayout] closeAuxiliaryWindows failed:', error)
        }
    }, [])

    useEffect(() => {
        let unlistenSnapshotRequest: (() => void) | null = null
        let unlistenApply: (() => void) | null = null

        const setup = async () => {
            unlistenSnapshotRequest = await listen(
                DETACHED_TEXTURE_EDITOR_EVENTS.requestSnapshot,
                async () => {
                    await emitTextureSnapshotToDetachedWindow()
                }
            )

            unlistenApply = await listen<DetachedTextureEditorApplyPayload>(
                DETACHED_TEXTURE_EDITOR_EVENTS.apply,
                async (event) => {
                    const textures = Array.isArray(event.payload?.textures) ? event.payload.textures : []
                    const { modelData, setTextures } = useModelStore.getState()
                    if (!modelData) {
                        showMessage('warning', '提示', '当前没有可编辑的模型')
                        return
                    }
                    setTextures(textures)
                    showMessage('success', '成功', '纹理修改已应用')
                    await emitTextureSnapshotToDetachedWindow()
                }
            )
        }

        setup().catch((error) => {
            console.error('[MainLayout] detached texture listeners setup failed:', error)
        })

        return () => {
            unlistenSnapshotRequest?.()
            unlistenApply?.()
        }
    }, [emitTextureSnapshotToDetachedWindow])

    useEffect(() => {
        let unlistenSnapshotRequest: (() => void) | null = null
        let unlistenApply: (() => void) | null = null
        let unlistenReady: (() => void) | null = null
        let unlistenHydrated: (() => void) | null = null

        const setup = async () => {
            unlistenSnapshotRequest = await listen<DetachedManagerRequestSnapshotPayload>(
                DETACHED_MANAGER_EVENTS.requestSnapshot,
                async (event) => {
                    const managerType = event.payload?.managerType
                    if (!managerType) return
                    const fallbackLabel = getDetachedManagerLabel(managerType)
                    await emitManagerSnapshot(managerType, event.payload?.windowLabel || fallbackLabel)
                }
            )

            unlistenApply = await listen<DetachedManagerApplyPayload>(
                DETACHED_MANAGER_EVENTS.apply,
                async (event) => {
                    const managerType = event.payload?.managerType
                    const nextModelData = event.payload?.modelData
                    if (!managerType || !nextModelData) return
                    const { setModelData, modelPath: currentModelPath, modelData: currentModelData } = useModelStore.getState()
                    const mergedModelData = mergeDetachedManagerModelData(
                        managerType,
                        currentModelData,
                        nextModelData
                    )
                    if (!mergedModelData) return
                    setModelData(mergedModelData, currentModelPath || event.payload?.modelPath || null, {
                        skipAutoRecalculate: true,
                        skipModelRebuild: true
                    })
                }
            )

            unlistenReady = await listen<DetachedManagerLifecyclePayload>(
                DETACHED_MANAGER_EVENTS.ready,
                async (event) => {
                    const managerType = event.payload?.managerType
                    if (!managerType) return
                    if (detachedManagerHydratedRef.current[managerType] === undefined) {
                        detachedManagerHydratedRef.current[managerType] = false
                    }
                    try {
                        await emitManagerSnapshot(
                            managerType,
                            event.payload?.windowLabel || getDetachedManagerLabel(managerType)
                        )
                    } catch (error) {
                        console.warn(`[MainLayout] detached manager ready snapshot failed (${managerType}):`, error)
                    }
                }
            )

            unlistenHydrated = await listen<DetachedManagerLifecyclePayload>(
                DETACHED_MANAGER_EVENTS.hydrated,
                (event) => {
                    const managerType = event.payload?.managerType
                    if (!managerType) return
                    detachedManagerHydratedRef.current[managerType] = true
                }
            )
        }

        setup().catch((error) => {
            console.error('[MainLayout] detached manager listeners setup failed:', error)
        })

        return () => {
            unlistenSnapshotRequest?.()
            unlistenApply?.()
            unlistenReady?.()
            unlistenHydrated?.()
        }
    }, [emitManagerSnapshot])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const syncAllOpenManagerWindows = async () => {
                await Promise.all(
                    DETACHED_MANAGER_TYPES.map(async (managerType) => {
                        const managerLabel = getDetachedManagerLabel(managerType)
                        const managerWindow = await WebviewWindow.getByLabel(managerLabel)
                        if (!managerWindow) return
                        const isVisible = await managerWindow.isVisible()
                        if (!isVisible) return
                        await emitManagerSnapshot(managerType, managerLabel)
                    })
                )
            }

            syncAllOpenManagerWindows().catch((error) => {
                console.error('[MainLayout] detached manager sync failed:', error)
            })
        }, 160)

        return () => window.clearTimeout(timer)
    }, [modelPath, modelData, emitManagerSnapshot])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const syncIfOpen = async () => {
                const detachedWindow = await WebviewWindow.getByLabel(DETACHED_TEXTURE_EDITOR_LABEL)
                if (!detachedWindow) {
                    return
                }

                const nextTextures = cloneTexturesForSync(Array.isArray(modelData?.Textures) ? modelData?.Textures : [])
                const nextModelPath = modelPath || undefined
                const previousTextures = detachedTextureLastSyncedTexturesRef.current
                const previousModelPath = detachedTextureLastSyncedModelPathRef.current

                if (nextModelPath !== previousModelPath || previousTextures.length === 0) {
                    await emitTextureSnapshotToDetachedWindow(nextTextures, nextModelPath)
                    return
                }

                const ops = buildTextureDeltaOps(previousTextures, nextTextures)
                if (ops.length === 0) {
                    return
                }

                const revision = ++detachedTextureSyncRevisionRef.current
                await emitTextureDeltaToDetachedWindow({
                    ops,
                    modelPath: nextModelPath,
                    revision
                })
                detachedTextureLastSyncedModelPathRef.current = nextModelPath
                detachedTextureLastSyncedTexturesRef.current = nextTextures
            }
            syncIfOpen().catch((error) => {
                console.error('[MainLayout] detached texture sync failed:', error)
            })
        }, 120)

        return () => window.clearTimeout(timer)
    }, [modelPath, modelData?.Textures, buildTextureDeltaOps, cloneTexturesForSync, emitTextureDeltaToDetachedWindow, emitTextureSnapshotToDetachedWindow])

    useEffect(() => {
        const win = window as any
        let timeoutId: number | null = null
        let idleId: number | null = null

        const prewarm = () => {
            ensureDetachedTextureEditorWindow(false).catch((error) => {
                console.warn('[MainLayout] detached texture prewarm skipped:', error)
            })
        }

        if (typeof win.requestIdleCallback === 'function') {
            idleId = win.requestIdleCallback(() => prewarm())
        } else {
            timeoutId = window.setTimeout(() => prewarm(), 350)
        }

        return () => {
            if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
                win.cancelIdleCallback(idleId)
            }
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId)
            }
        }
    }, [ensureDetachedTextureEditorWindow])

    useEffect(() => {
        const win = window as any
        let timeoutId: number | null = null
        let idleId: number | null = null
        let cancelled = false

        const prewarmManagers = async () => {
            const queue = [...DETACHED_MANAGER_TYPES]
            const workerCount = 2
            const workers = Array.from({ length: workerCount }, async () => {
                while (!cancelled) {
                    const managerType = queue.shift()
                    if (!managerType) break
                    try {
                        await ensureDetachedManagerWindow(managerType, false)
                        if (hasModelData) {
                            await emitManagerSnapshot(managerType, getDetachedManagerLabel(managerType))
                        }
                    } catch (error) {
                        console.warn(`[MainLayout] detached manager prewarm skipped (${managerType}):`, error)
                    }
                }
            })
            await Promise.all(workers)
        }

        if (typeof win.requestIdleCallback === 'function') {
            idleId = win.requestIdleCallback(() => {
                prewarmManagers().catch((error) => {
                    console.warn('[MainLayout] detached manager prewarm failed:', error)
                })
            }, { timeout: hasModelData ? 800 : 1600 })
        } else {
            timeoutId = window.setTimeout(() => {
                prewarmManagers().catch((error) => {
                    console.warn('[MainLayout] detached manager prewarm failed:', error)
                })
            }, hasModelData ? 80 : 350)
        }

        return () => {
            cancelled = true
            if (idleId !== null && typeof win.cancelIdleCallback === 'function') {
                win.cancelIdleCallback(idleId)
            }
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId)
            }
        }
    }, [ensureDetachedManagerWindow, emitManagerSnapshot, hasModelData, modelPath])

    const hasResetStore = useRef(false);
    useEffect(() => {
        closeConfirmVisibleRef.current = closeConfirmVisible;
    }, [closeConfirmVisible]);

    useEffect(() => {
        panelStateRef.current = {
            activeEditor,
            showGeosetAnimModal,
            showGeosetVisibilityToolModal,
            showTextureModal,
            showTextureAnimModal,
            showSequenceModal,
            showCameraModal,
            showMaterialModal,
            showGeosetModal,
            showGlobalSeqModal,
            showAbout
        }
    }, [
        activeEditor,
        showGeosetAnimModal,
        showGeosetVisibilityToolModal,
        showTextureModal,
        showTextureAnimModal,
        showSequenceModal,
        showCameraModal,
        showMaterialModal,
        showGeosetModal,
        showGlobalSeqModal,
        showAbout
    ])

    // Intercept native window close during save operations and reset state on refresh
    useEffect(() => {
        if (hasResetStore.current) return;
        hasResetStore.current = true;

        // Full state reset on initialization (handles refresh/F5)
        // We do this BEFORE potentially loading CLI files
        const doReset = async () => {
            const { useModelStore } = await import('../store/modelStore');
            const { useBatchStore } = await import('../store/batchStore');
            const { useSelectionStore } = await import('../store/selectionStore');
            const { useUIStore } = await import('../store/uiStore');
            const { useRendererStore } = await import('../store/rendererStore');
            const { useHistoryStore } = await import('../store/historyStore');
            const { useMessageStore } = await import('../store/messageStore');

            useModelStore.getState().reset();
            useBatchStore.getState().reset();
            useSelectionStore.getState().reset();
            useUIStore.getState().reset();
            useRendererStore.getState().reset();
            useHistoryStore.getState().clear();
            useMessageStore.getState().clearAll();

            console.log('[MainLayout] Stores reset successfully');
        };

        doReset();

        let unlisten: (() => void) | undefined;
        (async () => {
            const win = getCurrentWindow();
            unlisten = await win.onCloseRequested(async (event) => {
                if (bypassClosePromptRef.current) {
                    await closeAuxiliaryWindows();
                    return;
                }
                if (isSavingRef.current) {
                    event.preventDefault();
                    showMessage('warning', '提示', '正在保存模型，请稍候再关闭...');
                    return;
                }
                const { modelData } = useModelStore.getState();
                const { isDirty } = useHistoryStore.getState();
                if (modelData && isDirty && !closeConfirmVisibleRef.current) {
                    event.preventDefault();
                    setCloseConfirmVisible(true);
                    return;
                }
                await closeAuxiliaryWindows();
            });
        })();
        return () => {
            unlisten?.();
        };
    }, [closeAuxiliaryWindows, openDetachedManagerWindow, openDetachedTextureEditor]);


    // Check for copy-model context menu
    useEffect(() => {
        const checkCliCopyPath = async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const copyPath = await invoke<string | null>('get_cli_copy_path');
                if (copyPath) {
                    const result = await invoke<string>('copy_model_with_textures', { modelPath: copyPath });
                    showMessage('success', '??', result);
                    return true;
                }
            } catch (e) {
                console.error('[MainLayout] Failed to handle copy CLI:', e);
            }
            return false;
        };

        // Check for file path from command line (Tauri - context menu launch)
        const checkCliFilePath = async () => {
            if (hasCheckedCli.current) return;
            hasCheckedCli.current = true;

            const copyHandled = await checkCliCopyPath();
            if (copyHandled) return;
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const cliPaths = await invoke<string[]>('get_cli_file_paths');
                const pendingPaths = await invoke<string[]>('get_pending_open_files');

                // Combine and unique
                const allPaths = Array.from(new Set([...cliPaths, ...pendingPaths]));

                if (allPaths.length > 0) {
                    console.log('[MainLayout] Files opened from CLI/Pending:', allPaths);

                    // ... (MPQ loading logic) ...
                    const savedPaths = localStorage.getItem('mpq_paths');
                    if (savedPaths && !mpqLoaded) {
                        console.log('[MainLayout] Loading MPQs before model...');
                        try {
                            const paths = JSON.parse(savedPaths);
                            try {
                                await invoke('set_mpq_paths', { paths });
                            } catch (e) {
                                console.warn('[MainLayout] Failed to sync MPQ paths:', e);
                            }
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

                    // Now load all models via tab system sequentially
                    for (const cliPath of allPaths) {
                        if (processedHotOpenPaths.current.has(cliPath)) {
                            console.log('[MainLayout] CLI path already processed, skipping:', cliPath);
                            continue;
                        }
                        processedHotOpenPaths.current.add(cliPath);
                        openModelAsTab(cliPath);
                        // Small delay between tabs to allow state to settle
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            } catch (e) {
                console.error('[MainLayout] Failed to get CLI file paths:', e);
            }
        };
        checkCliFilePath();
    }, [addTab, mpqLoaded, setZustandLoading]); // Dependency added for addTab and mpqLoaded

    // Listen for file open from Electron context menu (right-click "Open with")
    useEffect(() => {
        // Check if running in Electron and api is available
        const api = (window as any).api;
        if (api && api.onOpenFile) {
            console.log('[MainLayout] Registering Electron file open listener');
            api.onOpenFile((filePath: string) => {
                console.log('[MainLayout] File opened from context menu:', filePath);
                if (!filePath || !(filePath.endsWith('.mdx') || filePath.endsWith('.mdl'))) {
                    return;
                }

                if (processedHotOpenPaths.current.has(filePath)) {
                    console.log('[MainLayout] Skipping duplicate hot-open path:', filePath);
                    return;
                }

                processedHotOpenPaths.current.add(filePath);
                openModelAsTab(filePath);
            });
        }
    }, [openModelAsTab]);

    const handleAddCameraFromView = useCallback(() => {
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
    }, [])

    const handleViewCamera = useCallback((cameraNode: any) => {
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
    }, [])

    useEffect(() => {
        let unlistenAddFromView: (() => void) | null = null
        let unlistenView: (() => void) | null = null

        const setup = async () => {
            unlistenAddFromView = await listen(
                DETACHED_CAMERA_EVENTS.addFromView,
                () => {
                    handleAddCameraFromView()
                }
            )

            unlistenView = await listen<DetachedCameraViewPayload>(
                DETACHED_CAMERA_EVENTS.view,
                (event) => {
                    const camera = event.payload?.camera
                    if (!camera) return
                    handleViewCamera(camera)
                }
            )
        }

        setup().catch((error) => {
            console.error('[MainLayout] detached camera listeners setup failed:', error)
        })

        return () => {
            unlistenAddFromView?.()
            unlistenView?.()
        }
    }, [handleAddCameraFromView, handleViewCamera])

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
                    try {
                        await invoke('set_mpq_paths', { paths })
                    } catch (e) {
                        console.warn('[MainLayout] Failed to sync MPQ paths:', e)
                    }
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
                            try {
                                await invoke('set_mpq_paths', { paths: validPaths })
                            } catch (e) {
                                console.warn('[MainLayout] Failed to sync MPQ paths:', e)
                            }
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
    const handleCopyModel = useCallback(async () => {
        if (!modelPath) {
            showMessage('warning', '提示', '没有可复制的模型');
            return;
        }
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const result = await invoke<string>('copy_model_with_textures', { modelPath });
            showMessage('success', '成功', result);
        } catch (err) {
            console.error('Copy failed:', err);
            showMessage('error', '错误', '复制失败');
        }
    }, [modelPath]);
    handleCopyModelRef.current = handleCopyModel;

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
                openModelAsTab(selected)
            }
        } catch (error) {
            console.error('Failed to open file dialog:', error)
            setIsLoading(false)
            setZustandLoading(false)
        }
    }, [openModelAsTab])
    handleImportRef.current = handleImport;

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
            // CRITICAL: Do not switch away from batch mode when loading a model
            const currentMode = useSelectionStore.getState().mainMode;
            if (currentMode !== 'batch') {
                setMainMode('view')
            }
            useSelectionStore.getState().clearAllSelections()
        }

        // Auto-play first animation if available
        if (data && data.Sequences && data.Sequences.length > 0) {
            // Use a small timeout to ensure the renderer is ready
            setTimeout(() => {
                // Only reset sequence if it's a new model or we aren't playing anything valid
                // This prevents resetting to 0 when deleting particles on same model
                if (!isSameModel || useModelStore.getState().currentSequence === -1) {
                    const preferredSequence = useModelStore.getState().currentSequence
                    const nextSequence = preferredSequence >= 0 ? preferredSequence : 0
                    console.log('[MainLayout] Auto-playing preferred animation:', nextSequence)
                    useModelStore.getState().setSequence(nextSequence)
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
        const isSupportedModelFile = (filePath: string): boolean => {
            const ext = filePath.toLowerCase().split('.').pop()
            return ext === 'mdx' || ext === 'mdl'
        }

        const setupDragDropListeners = async () => {
            try {
                const { listen } = await import('@tauri-apps/api/event')

                // Listen for file drop
                unlistenDrop = await listen<{ paths?: string[]; position?: { x: number; y: number } }>('tauri://drag-drop', async (event) => {
                    setIsDragging(false)
                    isExternalModelDragRef.current = false
                    const paths = Array.isArray(event.payload?.paths) ? event.payload.paths : []
                    if (!paths || paths.length === 0) return

                    const filePath = paths.find(isSupportedModelFile)
                    if (!filePath) {
                        // Forward non-model external drops to feature-specific handlers (e.g. texture drop zones)
                        window.dispatchEvent(new CustomEvent('war3-external-file-drop', {
                            detail: {
                                paths,
                                position: event.payload?.position ?? null
                            }
                        }))
                        return
                    }

                    console.log('[MainLayout] File dropped (Tauri):', filePath)
                    openModelAsTab(filePath)
                })

                // Listen for drag enter
                unlistenEnter = await listen<{ paths?: string[] }>('tauri://drag-enter', (event) => {
                    const paths = Array.isArray(event.payload?.paths) ? event.payload.paths : []
                    const hasSupportedModel = paths.some(isSupportedModelFile)
                    isExternalModelDragRef.current = hasSupportedModel
                    if (hasSupportedModel) {
                        setIsDragging(true)
                    }
                })

                // Listen for drag leave
                unlistenLeave = await listen('tauri://drag-leave', () => {
                    if (!isExternalModelDragRef.current) return
                    isExternalModelDragRef.current = false
                    setIsDragging(false)
                })

            } catch (error) {
                console.error('[MainLayout] Failed to setup drag-drop listeners:', error)
            }
        }

        setupDragDropListeners()

        return () => {
            isExternalModelDragRef.current = false
            unlistenDrop?.()
            unlistenEnter?.()
            unlistenLeave?.()
        }
    }, [openModelAsTab])



    const handleSave = async (): Promise<boolean> => {
        if (!modelPath || !modelData) return false

        try {
            isSavingRef.current = true;
            const { writeFile } = await import('@tauri-apps/plugin-fs')

            console.time('[MainLayout] SavePrep')
            // Prepare model data with correct typed arrays
            const normalizedData = useModelStore.getState().getModelDataForSave?.() ?? modelData;
            const preparedData = prepareModelDataForSave(normalizedData);

            // Cleanup invalid geosets BEFORE validation
            cleanupInvalidGeosets(preparedData)

            // Validate model data before export
            const validationErrors = validateModelData(preparedData);
            if (validationErrors.length > 0) {
                console.warn('[MainLayout] Model validation warnings:', validationErrors);
                // Show first 3 errors to user
                const errorMsg = validationErrors.slice(0, 3).join('\n');
                const proceed = confirm(`模型验证发现以下问题:\n${errorMsg}\n${validationErrors.length > 3 ? `...还有 ${validationErrors.length - 3} 个问题` : ''}\n\n是否仍然保存?`);
                if (!proceed) {
                    isSavingRef.current = false;
                    return false;
                }
            }

            console.timeEnd('[MainLayout] SavePrep')

            if (modelPath.toLowerCase().endsWith('.mdl')) {
                cleanupInvalidGeosets(preparedData)
                console.time('[MainLayout] GenMDL')
                const content = generateMDL(preparedData)
                console.timeEnd('[MainLayout] GenMDL')

                console.time('[MainLayout] FileWrite')
                await writeFile(modelPath, new TextEncoder().encode(content))
                console.timeEnd('[MainLayout] FileWrite')
            } else {
                cleanupInvalidGeosets(preparedData)
                console.time('[MainLayout] GenMDX')
                const buffer = generateMDX(preparedData)
                console.timeEnd('[MainLayout] GenMDX')

                console.time('[MainLayout] FileWrite')
                await writeFile(modelPath, new Uint8Array(buffer))
                console.timeEnd('[MainLayout] FileWrite')
            }

            useHistoryStore.getState().markSaved();
            showMessage('success', '保存成功', '模型已保存')
            return true;
        } catch (err) {
            console.error('Failed to save file:', err)
            showMessage('error', '保存失败', '详细信息: ' + err)
            return false;
        } finally {
            isSavingRef.current = false;
        }
    }
    handleSaveRef.current = handleSave;

    const handleSaveAs = async (): Promise<boolean> => {
        if (!modelData) return false
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
                isSavingRef.current = true;
                // Prepare model data with correct typed arrays
                const normalizedData = useModelStore.getState().getModelDataForSave?.() ?? modelData;
                const preparedData = prepareModelDataForSave(normalizedData);

                // Cleanup invalid geosets BEFORE validation
                cleanupInvalidGeosets(preparedData)

                // Validate model data before export
                const validationErrors = validateModelData(preparedData);
                if (validationErrors.length > 0) {
                    console.warn('[MainLayout] SaveAs validation warnings:', validationErrors);
                    const errorMsg = validationErrors.slice(0, 3).map(e => <div key={e}>{e}</div>);
                    const hasMore = validationErrors.length > 3;
                    const proceed = await showConfirm('模型验证警告', (
                        <div>
                            <div>发现以下问题:</div>
                            <div style={{ color: '#ff4d4f', margin: '10px 0' }}>
                                {errorMsg}
                                {hasMore && <div>...还有 {validationErrors.length - 3} 个问题</div>}
                            </div>
                            <div>是否仍然保存?</div>
                        </div>
                    ));
                    if (!proceed) return false;
                }


                if (selected.toLowerCase().endsWith('.mdl')) {
                    cleanupInvalidGeosets(preparedData)
                    const content = generateMDL(preparedData)
                    await writeFile(selected, new TextEncoder().encode(content))
                } else {
                    cleanupInvalidGeosets(preparedData)
                    const buffer = generateMDX(preparedData)
                    await writeFile(selected, new Uint8Array(buffer))
                }
                // Update store with new path if needed, but for now just alert
                useHistoryStore.getState().markSaved();
                showMessage('success', '另存为成功', '模型已另存为: ' + selected)
                return true;
            }
        } catch (err) {
            console.error('Failed to save file as:', err)
            showMessage('error', '另存为失败', '详细信息: ' + err)
            return false;
        } finally {
            isSavingRef.current = false;
        }
        return false;
    }
    handleSaveAsRef.current = handleSaveAs;

    useEffect(() => {
        const requestClose = () => {
            if (isSavingRef.current) {
                showMessage('warning', '提示', '正在保存模型，请稍候再关闭...');
                return true;
            }
            closeAuxiliaryWindows().finally(() => {
                getCurrentWindow().close();
            });
            return true;
        };

        const requestCloseIfNoPanels = () => {
            const uiState = useUIStore.getState();
            const rendererState = useRendererStore.getState();
            const panelState = panelStateRef.current;
            const hasPanels = !!panelState.activeEditor
                || panelState.showGeosetAnimModal
                || panelState.showGeosetVisibilityToolModal
                || panelState.showTextureModal
                || panelState.showTextureAnimModal
                || panelState.showSequenceModal
                || panelState.showCameraModal
                || panelState.showMaterialModal
                || panelState.showGeosetModal
                || panelState.showGlobalSeqModal
                || panelState.showAbout
                || rendererState.showSettingsPanel
                || rendererState.showGeosetVisibility
                || uiState.showNodeManager
                || uiState.showModelInfo
                || uiState.showVertexEditor
                || uiState.showFaceEditor
                || uiState.showNodeDialog
                || uiState.showCreateNodeDialog
                || uiState.showTransformModelDialog;

            if (hasPanels) return false;
            return requestClose();
        };

        const unsubscribeHandlers = [
            registerShortcutHandler('file.open', () => {
                handleImportRef.current();
                return true;
            }),
            registerShortcutHandler('file.save', () => {
                const { modelPath: currentModelPath } = useModelStore.getState();
                if (!currentModelPath) {
                    handleSaveAsRef.current();
                } else {
                    handleSaveRef.current();
                }
                return true;
            }),
            registerShortcutHandler('file.saveAs', () => {
                handleSaveAsRef.current();
                return true;
            }),
            registerShortcutHandler('file.copyModel', () => {
                handleCopyModelRef.current();
                return true;
            }),
            registerShortcutHandler('window.closeTab', () => {
                const { activeTabId, closeTab } = useModelStore.getState();
                if (activeTabId) {
                    closeTab(activeTabId);
                }
                return true;
            }),
            registerShortcutHandler('window.closeApp', () => requestClose()),
            registerShortcutHandler('window.closeAppEsc', () => requestCloseIfNoPanels()),
            registerShortcutHandler('mode.view', () => {
                useSelectionStore.getState().setMainMode('view');
                return true;
            }),
            registerShortcutHandler('mode.geometry', () => {
                useSelectionStore.getState().setMainMode('geometry');
                return true;
            }),
            registerShortcutHandler('mode.uv', () => {
                useSelectionStore.getState().setMainMode('uv');
                return true;
            }),
            registerShortcutHandler('mode.animation', () => {
                useSelectionStore.getState().setMainMode('animation');
                return true;
            }),
            registerShortcutHandler('editor.nodeManager', () => {
                toggleNodeManager();
                return true;
            }),
            registerShortcutHandler('editor.cameraManager', () => {
                openDetachedManagerWindow('camera');
                return true;
            }),
            registerShortcutHandler('editor.geosetManager', () => {
                openDetachedManagerWindow('geoset');
                return true;
            }),
            registerShortcutHandler('editor.geosetAnimManager', () => {
                openDetachedManagerWindow('geosetAnim');
                return true;
            }),
            registerShortcutHandler('editor.textureManager', () => {
                openDetachedTextureEditor();
                return true;
            }),
            registerShortcutHandler('editor.textureAnimManager', () => {
                openDetachedManagerWindow('textureAnim');
                return true;
            }),
            registerShortcutHandler('editor.materialManager', () => {
                openDetachedManagerWindow('material');
                return true;
            }),
            registerShortcutHandler('editor.sequenceManager', () => {
                openDetachedManagerWindow('sequence');
                return true;
            }),
            registerShortcutHandler('editor.globalSequenceManager', () => {
                openDetachedManagerWindow('globalSequence');
                return true;
            }),
            registerShortcutHandler('view.perspective', () => {
                setViewPreset({ type: 'perspective', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.orthographic', () => {
                setViewPreset({ type: 'orthographic', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.top', () => {
                setViewPreset({ type: 'top', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.bottom', () => {
                setViewPreset({ type: 'bottom', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.front', () => {
                setViewPreset({ type: 'front', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.back', () => {
                setViewPreset({ type: 'back', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.left', () => {
                setViewPreset({ type: 'left', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.right', () => {
                setViewPreset({ type: 'right', time: Date.now() });
                return true;
            }),
            registerShortcutHandler('view.toggleVertices', () => {
                const { mainMode } = useSelectionStore.getState();
                const { animationSubMode } = useSelectionStore.getState();
                const {
                    showVerticesByMode,
                    setShowVerticesForMode,
                    showVerticesInAnimationBinding,
                    showVerticesInAnimationKeyframe,
                    setShowVerticesForAnimationSubMode
                } = useRendererStore.getState() as any;

                if (mainMode === 'animation') {
                    const current =
                        animationSubMode === 'binding'
                            ? (showVerticesInAnimationBinding ?? true)
                            : (showVerticesInAnimationKeyframe ?? false);
                    setShowVerticesForAnimationSubMode(animationSubMode, !current);
                } else {
                    const current = showVerticesByMode[mainMode] ?? true;
                    setShowVerticesForMode(mainMode, !current);
                }
                return true;
            }),
            registerShortcutHandler('edit.undo', () => {
                useHistoryStore.getState().undo();
                return true;
            }),
            registerShortcutHandler('edit.redo', () => {
                useHistoryStore.getState().redo();
                return true;
            })
        ];

        return () => {
            unsubscribeHandlers.forEach((unsubscribe) => unsubscribe());
        };
    }, [closeAuxiliaryWindows]);

    const handleCloseWithSave = async () => {
        setCloseConfirmVisible(false);
        const ok = modelPath ? await handleSave() : await handleSaveAs();
        if (!ok) return;
        await closeAuxiliaryWindows();
        bypassClosePromptRef.current = true;
        getCurrentWindow().close();
    };

    const handleCloseWithoutSave = async () => {
        setCloseConfirmVisible(false);
        await closeAuxiliaryWindows();
        bypassClosePromptRef.current = true;
        getCurrentWindow().close();
    };

    const handleCloseCancel = () => {
        setCloseConfirmVisible(false);
    };

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

                const normalizedData = useModelStore.getState().getModelDataForSave?.() ?? modelData;
                const preparedData = prepareModelDataForSave(normalizedData)

                // Cleanup invalid geosets BEFORE validation
                cleanupInvalidGeosets(preparedData)

                // Validate before export
                const validationErrors = validateModelData(preparedData);
                if (validationErrors.length > 0) {
                    console.warn('[MainLayout] Export MDL validation warnings:', validationErrors);
                    const errorMsg = validationErrors.slice(0, 3).map(e => <div key={e}>{e}</div>);
                    const hasMore = validationErrors.length > 3;
                    const proceed = await showConfirm('模型验证警告', (
                        <div>
                            <div>发现以下问题:</div>
                            <div style={{ color: '#ff4d4f', margin: '10px 0' }}>
                                {errorMsg}
                                {hasMore && <div>...还有 {validationErrors.length - 3} 个问题</div>}
                            </div>
                            <div>是否仍然导出?</div>
                        </div>
                    ));
                    if (!proceed) return;
                }

                cleanupInvalidGeosets(preparedData)

                const content = generateMDL(preparedData)
                await writeFile(filePath, new TextEncoder().encode(content))
                showMessage('success', '导出成功', '已导出为 MDL: ' + filePath)
            }
        } catch (err) {
            console.error('Failed to export MDL:', err)
            showMessage('error', '导出 MDL 失败', '详细信息: ' + err)
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

                const normalizedData = useModelStore.getState().getModelDataForSave?.() ?? modelData;
                const preparedData = prepareModelDataForSave(normalizedData)

                // Cleanup invalid geosets BEFORE validation
                cleanupInvalidGeosets(preparedData)

                // Validate before export
                const validationErrors = validateModelData(preparedData);
                if (validationErrors.length > 0) {
                    console.warn('[MainLayout] Export MDX validation warnings:', validationErrors);
                    const errorMsg = validationErrors.slice(0, 3).map(e => <div key={e}>{e}</div>);
                    const hasMore = validationErrors.length > 3;
                    const proceed = await showConfirm('模型验证警告', (
                        <div>
                            <div>发现以下问题:</div>
                            <div style={{ color: '#ff4d4f', margin: '10px 0' }}>
                                {errorMsg}
                                {hasMore && <div>...还有 {validationErrors.length - 3} 个问题</div>}
                            </div>
                            <div>是否仍然导出?</div>
                        </div>
                    ));
                    if (!proceed) return;
                }


                // Cleanup invalid geosets before export (e.g., empty geosets from split operations)
                cleanupInvalidGeosets(preparedData)

                const buffer = generateMDX(preparedData)
                await writeFile(filePath, new Uint8Array(buffer))
                showMessage('success', '导出成功', '已导出为 MDX: ' + filePath)
            }
        } catch (err) {
            console.error('Failed to export MDX:', err)
            showMessage('error', '导出 MDX 失败', '详细信息: ' + err)
        }
    }


    // Helper to remove empty/invalid geosets before export
    const cleanupInvalidGeosets = (preparedData: any) => {
        if (!preparedData.Geosets) return

        const originalCount = preparedData.Geosets.length

        // Debug: Log all geosets before filtering
        // console.log(`[MainLayout] cleanupInvalidGeosets: Checking ${originalCount} geosets`)
        preparedData.Geosets.forEach((geoset: any, index: number) => {
            // console.log(`[MainLayout] Geoset ${index}: Vertices=${geoset.Vertices?.length || 'undefined'}, Faces=${geoset.Faces?.length || 'undefined'}, type(V)=${typeof geoset.Vertices}, type(F)=${typeof geoset.Faces}`)
        })

        preparedData.Geosets = preparedData.Geosets.filter((geoset: any, index: number) => {
            // Only remove geosets that are truly empty (no vertices or no faces)
            // This handles geosets that were emptied by split operations
            const hasVertices = geoset.Vertices && geoset.Vertices.length > 0
            const hasFaces = geoset.Faces && geoset.Faces.length > 0

            const isValid = hasVertices && hasFaces

            if (!isValid) {
                console.warn(`[MainLayout] Removing empty Geoset ${index}: vertices=${geoset.Vertices?.length || 0}, faces=${geoset.Faces?.length || 0}`)
            }
            return isValid
        })

        // Ensure all remaining geosets have required properties for MDX generator
        preparedData.Geosets.forEach((geoset: any, index: number) => {
            // Anims is required by generate.ts:575
            if (!geoset.Anims) {
                geoset.Anims = []
                console.log(`[MainLayout] Fixed Geoset ${index}: Added missing Anims array`)
            }
            // VertexGroup is required
            if (!geoset.VertexGroup) {
                geoset.VertexGroup = new Uint8Array(geoset.Vertices.length / 3)
                console.log(`[MainLayout] Fixed Geoset ${index}: Added missing VertexGroup`)
            }
            // Groups is required
            if (!geoset.Groups) {
                geoset.Groups = [[0]]
                console.log(`[MainLayout] Fixed Geoset ${index}: Added missing Groups`)
            }
        })

        if (preparedData.Geosets.length !== originalCount) {
            console.log(`[MainLayout] Cleaned up ${originalCount - preparedData.Geosets.length} invalid geosets.`)
        }
    }

    const toggleEditor = (editor: string) => {
        setActiveEditor(activeEditor === editor ? null : editor)
    }

    // Debug Console State
    const [showDebugConsole, setShowDebugConsole] = useState<boolean>(false)
    const [showChangelog, setShowChangelog] = useState<boolean>(false)
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
        import('../utils/debugConsoleState').then(({ setDebugConsoleEnabled }) => {
            setDebugConsoleEnabled(showDebugConsole)
        })
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

    // Daily automatic update check
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        checkGiteeUpdateSilent();
        localStorage.setItem('lastUpdateCheck', today);
    }, []);

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
                onCheckUpdate={() => checkGiteeUpdate()}
                onShowChangelog={() => showUpdateLog()}
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
                showAttachments={showAttachments}
                onToggleAttachments={() => {
                    const newVal = !showAttachments
                    setShowAttachments(newVal)
                }}
                onSetViewPreset={(preset) => setViewPreset({ type: preset, time: Date.now() })}
                onToggleEditor={(editor) => {
                    console.log('[MainLayout] onToggleEditor called with:', editor)
                    if (editor === 'nodeManager') {
                        toggleNodeManager()
                    } else if (editor === 'modelInfo') {
                        toggleModelInfo()
                    } else if (editor === 'geosetAnim') {
                        openDetachedManagerWindow('geosetAnim')
                    } else if (editor === 'geosetVisibilityTool') {
                        setShowGeosetVisibilityToolModal(true)
                    } else if (editor === 'texture') {
                        openDetachedTextureEditor()
                    } else if (editor === 'textureAnim') {
                        openDetachedManagerWindow('textureAnim')
                    } else if (editor === 'sequence') {
                        openDetachedManagerWindow('sequence')
                    } else if (editor === 'camera') {
                        openDetachedManagerWindow('camera')
                    } else if (editor === 'material') {

                        openDetachedManagerWindow('material')
                    } else if (editor === 'geoset') {
                        openDetachedManagerWindow('geoset')
                    } else if (editor === 'globalSequence') {
                        openDetachedManagerWindow('globalSequence')
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
                onRecalculateNormals={() => {
                    useModelStore.getState().recalculateNormals();
                    showMessage('success', '成功', '已重新计算法线');
                }}
                onRecalculateExtents={() => {
                    useModelStore.getState().recalculateExtents();
                    showMessage('success', '成功', '已重新计算模型顶点范围');
                }}
                onRepairModel={() => {
                    useModelStore.getState().repairModel();
                    showMessage('success', '成功', '模型修复完成');
                }}
                onMergeSameMaterials={async () => {
                    if (!modelData) return;
                    const { mergeSameMaterials } = await import('../services/modelCleanupService');
                    const result = mergeSameMaterials(modelData);
                    if (result.removed > 0) {
                        useModelStore.getState().setMaterials([...(modelData.Materials || [])]);
                        showMessage('success', '成功', result.message);
                    } else {
                        showMessage('info', '提示', result.message);
                    }
                }}
                onCleanUnusedMaterials={async () => {
                    if (!modelData) return;
                    const { cleanUnusedMaterials } = await import('../services/modelCleanupService');
                    const result = cleanUnusedMaterials(modelData);
                    if (result.removed > 0) {
                        useModelStore.getState().setMaterials([...(modelData.Materials || [])]);
                        showMessage('success', '成功', result.message);
                    } else {
                        showMessage('info', '提示', result.message);
                    }
                }}
                onCleanUnusedTextures={async () => {
                    if (!modelData) return;
                    const { cleanUnusedTextures } = await import('../services/modelCleanupService');
                    const result = cleanUnusedTextures(modelData);
                    if (result.removed > 0) {
                        useModelStore.getState().setTextures([...(modelData.Textures || [])]);
                        showMessage('success', '成功', result.message);
                    } else {
                        showMessage('info', '提示', result.message);
                    }
                }}
                onTransformModel={() => setTransformModelDialogVisible(true)}
                onAddDeathAnimation={() => {
                    useModelStore.getState().addDeathAnimation();
                    showMessage('success', '成功', '已添加/更新死亡动画');
                }}
                onRemoveLights={() => {
                    useModelStore.getState().removeLights();
                    showMessage('success', '成功', '已删除所有光照节点');
                }}
                onCopyModel={handleCopyModel}
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
            <GeosetVisibilityToolModal
                visible={showGeosetVisibilityToolModal}
                onClose={() => setShowGeosetVisibilityToolModal(false)}
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

            <Suspense fallback={null}>
                <TransformModelDialog />
            </Suspense>


            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
                {/* Left Panel - Animation Panel (hidden in UV mode) */}
                {mainMode !== 'uv' && mainMode !== 'animation' && (
                    <div style={{ width: '230px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
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
                                showAttachments={mainMode !== 'uv' && showAttachments}
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
                            加载中...
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
            <Modal
                open={closeConfirmVisible}
                onCancel={handleCloseCancel}
                title="未保存的修改"
                footer={[
                    <Button key="cancel" onClick={handleCloseCancel}>取消</Button>,
                    <Button key="discard" onClick={handleCloseWithoutSave}>不保存</Button>,
                    <Button key="save" type="primary" onClick={handleCloseWithSave}>保存并退出</Button>
                ]}
            >
                <div>模型已修改，是否保存后再退出？</div>
            </Modal>
            {/* Global Message Layer */}
            <GlobalMessageLayer />
        </div>
    )
}

export default MainLayout
