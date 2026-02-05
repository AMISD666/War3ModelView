import { parseMDX, parseMDL, generateMDX, generateMDL } from 'war3-model';

/**
 * Checks if a value is an animation vector (contains keys).
 */
export const isAnimVector = (value: any): boolean => {
    return value && typeof value === 'object' && Array.isArray(value.Keys);
};

/**
 * Gets the animation value at a specific frame.
 */
export const getAnimValueAtFrame = (anim: any, frame: number, fallback: number): number => {
    if (!anim?.Keys || anim.Keys.length === 0) return fallback;
    const keys = [...anim.Keys].sort((a: any, b: any) => a.Frame - b.Frame);
    let result = fallback;
    for (const key of keys) {
        if (typeof key.Frame !== 'number') continue;
        if (key.Frame <= frame) {
            if (Array.isArray(key.Vector)) result = Number(key.Vector[0] ?? result);
            else if (key.Vector?.length !== undefined) result = Number(key.Vector[0] ?? result);
            else result = Number(key.Vector ?? result);
        } else {
            break;
        }
    }
    return result;
};

/**
 * Builds an animation vector from a set of frames and a value.
 */
export const buildAnimVector = (frames: number[], value: number, endValue?: number, endFrame?: number) => {
    const map = new Map<number, number>();
    frames.forEach((frame) => map.set(frame, value));
    if (endFrame !== undefined && endValue !== undefined) {
        map.set(endFrame, endValue);
    }
    const keys = Array.from(map.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([frame, val]) => ({
            Frame: frame,
            Vector: new Float32Array([val])
        }));
    return {
        LineType: 1,
        Keys: keys
    };
};

/**
 * Helper to convert various vector types to Float32Array.
 */
export const toFloat32Array = (value: any, size: number): Float32Array => {
    if (value instanceof Float32Array) return value;
    if (Array.isArray(value)) return new Float32Array(value);
    if (value && typeof value === 'object') {
        const arr = Object.values(value).map(Number);
        const padded = arr.length >= size ? arr : [...arr, ...new Array(size - arr.length).fill(0)];
        return new Float32Array(padded);
    }
    return new Float32Array(new Array(size).fill(0));
};

/**
 * Updates an animation vector to fade out during the death sequence.
 */
const updateAnimVector = (anim: any, baseValue: number, deathStart: number, deathEnd: number) => {
    const map = new Map<number, number>();
    for (const key of anim.Keys || []) {
        if (typeof key.Frame !== 'number') continue;
        if (key.Frame > deathStart) continue;
        let val = baseValue;
        if (Array.isArray(key.Vector)) val = Number(key.Vector[0] ?? baseValue);
        else if (key.Vector?.length !== undefined) val = Number(key.Vector[0] ?? baseValue);
        else val = Number(key.Vector ?? baseValue);
        map.set(key.Frame, val);
    }
    map.set(deathStart, 0);
    map.set(deathEnd, 0);
    anim.LineType = 0;
    anim.GlobalSeqId = null;
    if ('GlobalSequenceId' in anim) delete anim.GlobalSequenceId;
    anim.Keys = Array.from(map.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([frame, val]) => ({
            Frame: frame,
            Vector: new Float32Array([val])
        }));
    return anim;
};

/**
 * Collects all base frames (start/end of sequences) to ensure smooth interpolation.
 */
const collectBaseFrames = (sequences: any[]): number[] => {
    const frames = new Set<number>([0]);
    sequences.forEach((seq) => {
        const interval = Array.isArray(seq.Interval) ? seq.Interval : seq.Interval?.length ? Array.from(seq.Interval) : [];
        if (interval.length >= 2) {
            frames.add(Number(interval[0]));
            frames.add(Number(interval[1]));
        }
    });
    return Array.from(frames).sort((a, b) => a - b);
};

const applyScalarAnim = (animSource: any, baseFrames: number[], baseValue: number, deathStart: number, deathEnd: number) => {
    if (isAnimVector(animSource)) {
        return updateAnimVector(animSource, baseValue, deathStart, deathEnd);
    }
    const frames = Array.from(new Set([0, ...baseFrames, deathStart, deathEnd])).sort((a, b) => a - b);
    const anim = buildAnimVector(frames, baseValue);
    return updateAnimVector(anim, baseValue, deathStart, deathEnd);
};

const applyVisibility = (animSource: any, baseFrames: number[], baseValue: number, deathStart: number, deathEnd: number) => {
    return applyScalarAnim(animSource, baseFrames, baseValue, deathStart, deathEnd);
};

const getStaticEmissionRate = (node: any): number => {
    if (typeof node.EmissionRate === 'number') return node.EmissionRate;
    if (typeof node.EmissionRateAnim === 'number') return node.EmissionRateAnim;
    const animValue = isAnimVector(node.EmissionRate) ? node.EmissionRate : node.EmissionRateAnim;
    return isAnimVector(animValue) ? getAnimValueAtFrame(animValue, 0, 0) : 0;
};

/**
 * Core logic to add death animation to a model object.
 * Returns { model, status }
 */
/**
 * Deeply searches for and removes all keyframes within a specific time range.
 * Used when deleting a sequence to clean up all animation traces.
 */
export const pruneModelKeyframes = (model: any, start: number, end: number) => {
    const pruneKeys = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;

        // If it's an array, prune each element
        if (Array.isArray(obj)) {
            obj.forEach(pruneKeys);
            return;
        }

        // If it's an animation vector (contains Keys)
        if (isAnimVector(obj)) {
            const originalLength = obj.Keys.length;
            obj.Keys = obj.Keys.filter((key: any) => {
                if (typeof key.Frame !== 'number') return true;
                return key.Frame < start || key.Frame > end;
            });
            return;
        }

        // Recursively prune all properties
        // Skip known large data arrays that cannot contain keys for performance
        const skip = ['Vertices', 'Faces', 'Normals', 'TVertices', 'VertexGroup', 'Groups', 'PivotPoints'];
        for (const key in obj) {
            if (skip.includes(key)) continue;
            pruneKeys(obj[key]);
        }
    };

    pruneKeys(model);
};

/**
 * Extracts all texture paths from a model and resolves them to absolute paths.
 * @param modelPath Absolute path to the model file.
 * @param model Parsed model object.
 * @returns Array of absolute texture file paths.
 */
export const getModelTexturePaths = (modelPath: string, model: any): string[] => {
    const textures: string[] = [];
    const modelDir = modelPath.substring(0, modelPath.lastIndexOf('\\'));

    if (model.Textures && Array.isArray(model.Textures)) {
        for (const tex of model.Textures) {
            // Textures can have a "Path" or "Image" property
            const texPath = tex.Image || tex.Path;
            if (texPath && typeof texPath === 'string' && texPath.trim() !== '') {
                // Normalize slashes and resolve relative to model directory
                const normalized = texPath.replace(/\//g, '\\');
                // If it's an absolute path, use as-is; otherwise resolve relative to model dir
                const absolutePath = normalized.includes(':') ? normalized : `${modelDir}\\${normalized}`;
                textures.push(absolutePath);
            }
        }
    }

    return textures;
};

export const processDeathAnimation = (model: any) => {
    const sequences = model.Sequences || [];
    const deathIndex = sequences.findIndex((seq: any) => String(seq.Name || '').toLowerCase() === 'death');
    const deathSequence = deathIndex >= 0 ? sequences[deathIndex] : null;
    const nonDeathSequences = sequences.filter((_: any, index: number) => index != deathIndex);

    const lastEnd = nonDeathSequences.reduce((max: number, seq: any) => {
        const interval = Array.isArray(seq.Interval) ? seq.Interval : seq.Interval?.length ? Array.from(seq.Interval) : [];
        const end = interval.length >= 2 ? Number(interval[1]) : 0;
        return Math.max(max, end);
    }, 0);

    let deathStart = lastEnd + 1000;
    let deathEnd = deathStart + 3000;

    if (deathSequence) {
        const interval = Array.isArray(deathSequence.Interval)
            ? deathSequence.Interval
            : deathSequence.Interval?.length
                ? Array.from(deathSequence.Interval)
                : [];
        if (interval.length >= 2) {
            deathStart = Number(interval[0]);
            deathEnd = Number(interval[1]);
        } else {
            deathSequence.Interval = new Uint32Array([deathStart, deathEnd]);
        }
    } else {
        const infoMin = model.Info?.MinimumExtent;
        const infoMax = model.Info?.MaximumExtent;
        const infoBounds = model.Info?.BoundsRadius;
        const refSequence = nonDeathSequences[nonDeathSequences.length - 1];
        const minimumExtent = toFloat32Array(refSequence?.MinimumExtent ?? infoMin ?? [0, 0, 0], 3);
        const maximumExtent = toFloat32Array(refSequence?.MaximumExtent ?? infoMax ?? [0, 0, 0], 3);
        const boundsRadius = typeof refSequence?.BoundsRadius == 'number'
            ? refSequence.BoundsRadius
            : (typeof infoBounds == 'number' ? infoBounds : 0);

        const newDeathSequence = {
            Name: 'Death',
            Interval: new Uint32Array([deathStart, deathEnd]),
            NonLooping: 1,
            MinimumExtent: minimumExtent,
            MaximumExtent: maximumExtent,
            BoundsRadius: boundsRadius,
            MoveSpeed: 0,
            Rarity: 0
        };

        model.Sequences = [...sequences, newDeathSequence];
    }

    const baseFrames = collectBaseFrames(model.Sequences || []);

    if (!model.GeosetAnims) model.GeosetAnims = [];
    const geosetAnimMap = new Map<number, any>();
    model.GeosetAnims.forEach((anim: any) => {
        if (typeof anim.GeosetId == 'number') geosetAnimMap.set(anim.GeosetId, anim);
    });

    (model.Geosets || []).forEach((geoset: any, index: number) => {
        let anim = geosetAnimMap.get(index);
        if (!anim) {
            anim = {
                GeosetId: index,
                Alpha: 1,
                Flags: 0
            };
            model.GeosetAnims.push(anim);
            geosetAnimMap.set(index, anim);
        }

        const currentAlpha = anim.Alpha;
        let baseValue = 1;
        if (typeof currentAlpha == 'number') {
            baseValue = currentAlpha;
        } else if (isAnimVector(currentAlpha)) {
            baseValue = getAnimValueAtFrame(currentAlpha, lastEnd, 1);
        }

        anim.Alpha = applyVisibility(currentAlpha, baseFrames, baseValue, deathStart, deathEnd);
    });

    const updateNodeVisibility = (node: any) => {
        const animValue = isAnimVector(node.Visibility) ? node.Visibility : node.VisibilityAnim;
        let baseValue = 1;
        if (typeof node.Visibility == 'number') baseValue = node.Visibility;
        else if (typeof node.VisibilityAnim == 'number') baseValue = node.VisibilityAnim;
        else if (isAnimVector(animValue)) baseValue = getAnimValueAtFrame(animValue, lastEnd, 1);

        const anim = applyVisibility(animValue, baseFrames, baseValue, deathStart, deathEnd);
        node.Visibility = anim;
        node.VisibilityAnim = anim;
    };

    const updateEmissionRate = (node: any) => {
        const animValue = isAnimVector(node.EmissionRate) ? node.EmissionRate : node.EmissionRateAnim;
        const baseValue = getStaticEmissionRate(node);
        const anim = applyScalarAnim(animValue, baseFrames, baseValue, deathStart, deathEnd);
        node.EmissionRate = anim;
        node.EmissionRateAnim = anim;
    };

    (model.ParticleEmitters2 || []).forEach(updateNodeVisibility);
    (model.RibbonEmitters || []).forEach(updateNodeVisibility);
    (model.ParticleEmitters || []).forEach(updateNodeVisibility);
    (model.ParticleEmitters2 || []).forEach(updateEmissionRate);
    (model.ParticleEmitters || []).forEach(updateEmissionRate);

    return { model, status: deathSequence ? 'updated' : 'added' };
};

/**
 * Re-indexes all nodes in the model to ensure a continuous sequence of ObjectIds.
 * Also updates parent references and geoset group references.
 */
const reindexNodes = (model: any) => {
    const allNodes: any[] = [];
    const nodeTypes = [
        'Bones', 'Helpers', 'Lights', 'Attachments',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes'
    ];

    nodeTypes.forEach(type => {
        if (Array.isArray(model[type])) {
            allNodes.push(...model[type]);
        }
    });

    // Sort by current ObjectId to maintain relative order
    allNodes.sort((a, b) => (a.ObjectId ?? 0) - (b.ObjectId ?? 0));

    const idMap = new Map<number, number>();
    allNodes.forEach((node, index) => {
        idMap.set(node.ObjectId, index);
        node.ObjectId = index;
    });

    // Update parent references
    allNodes.forEach(node => {
        if (node.Parent !== undefined && node.Parent !== -1) {
            const newParent = idMap.get(node.Parent);
            node.Parent = newParent !== undefined ? newParent : -1;
        }
    });

    // Update geoset group references
    if (Array.isArray(model.Geosets)) {
        model.Geosets.forEach((geoset: any) => {
            if (Array.isArray(geoset.Groups)) {
                geoset.Groups = geoset.Groups.map((group: any) => {
                    if (Array.isArray(group)) {
                        return group.map((oldId: number) => idMap.get(oldId) ?? 0);
                    }
                    return group;
                });
            }
        });
    }

    // Refresh model.Nodes array for library consistency
    if (model.Nodes) {
        model.Nodes = [...allNodes];
    }

    return model;
};

/**
 * Removes all lights from a model and cleans up references.
 */
export const processRemoveLights = (model: any) => {
    if (!model.Lights || model.Lights.length === 0) {
        return { model, count: 0 };
    }

    const lightCount = model.Lights.length;

    // Remove from Lights array
    model.Lights = [];

    // Re-index all remaining nodes to fill gaps
    reindexNodes(model);

    return { model, count: lightCount };
};
