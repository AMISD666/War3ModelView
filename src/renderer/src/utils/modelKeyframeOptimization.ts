import type { KeyframeOptimizationOptions } from './modelOptimization';
import {
    clamp,
    fromVector,
    normalizeQuaternion,
    quaternionVelocityVector,
    toVector,
    vectorMaxAbsDiff
} from './modelOptimizationShared';
import {
    computeTrackCurvatureScores,
    getAnimLineType,
    interpolateVectors,
    isDiscreteTrack,
    isRotationTrack,
    isTranslationTrack,
    sampleCollapsedIntervalErrors,
} from './modelKeyframeSampling';
import { solveSPOSSegment, type SPOSEdgeContext } from './modelKeyframeSpos';

export const GEOMETRY_SKIP_KEYS = new Set([
    'Vertices',
    'Faces',
    'Normals',
    'TVertices',
    'Tangents',
    'VertexGroup',
    'Groups',
    'PivotPoints'
]);

const DISCRETE_TRACK_TOKENS = [
    'visibility',
    'textureid',
    'replaceableid',
    'geosetid',
    'eventtrack'
];

const normalizeAndSortKeys = (keys: any[]): any[] => {
    const normalized = keys
        .filter((k) => k && Number.isFinite(Number(k.Frame)))
        .map((k) => ({ ...k, Frame: Number(k.Frame) }))
        .sort((a, b) => a.Frame - b.Frame);

    if (normalized.length <= 1) return normalized;
    const dedup: any[] = [];
    for (let i = 0; i < normalized.length; i++) {
        const key = normalized[i];
        if (dedup.length > 0 && dedup[dedup.length - 1].Frame === key.Frame) {
            dedup[dedup.length - 1] = key;
        } else {
            dedup.push(key);
        }
    }
    return dedup;
};

const normalizeQuaternionFrame = (key: any): any => {
    const vector = toVector(key?.Vector);
    if (vector.length < 4) return key;
    const next: any = {
        ...key,
        Vector: normalizeQuaternion(vector)
    };
    if (key?.InTan !== undefined) {
        const inTan = toVector(key.InTan);
        if (inTan.length >= 4) next.InTan = normalizeQuaternion(inTan);
    }
    if (key?.OutTan !== undefined) {
        const outTan = toVector(key.OutTan);
        if (outTan.length >= 4) next.OutTan = normalizeQuaternion(outTan);
    }
    return next;
};

const enforceQuaternionContinuity = (keys: any[]): any[] => {
    if (keys.length <= 1) return keys;
    const out = keys.map((k) => normalizeQuaternionFrame(k));
    for (let i = 1; i < out.length; i++) {
        const prev = toVector(out[i - 1]?.Vector);
        const curr = toVector(out[i]?.Vector);
        if (prev.length < 4 || curr.length < 4) continue;
        const dot = prev[0] * curr[0] + prev[1] * curr[1] + prev[2] * curr[2] + prev[3] * curr[3];
        if (dot >= 0) continue;
        out[i] = {
            ...out[i],
            Vector: curr.map((n) => -n),
            InTan: out[i]?.InTan !== undefined ? toVector(out[i].InTan).map((n) => -n) : out[i]?.InTan,
            OutTan: out[i]?.OutTan !== undefined ? toVector(out[i].OutTan).map((n) => -n) : out[i]?.OutTan
        };
    }
    return out;
};

const computeAdaptiveTolerance = (
    keys: any[],
    trackPath: string,
    options: Required<KeyframeOptimizationOptions>
) => {
    const lower = trackPath.toLowerCase();
    const sample = keys.length > 0 ? toVector(keys[0]?.Vector) : [0];
    const isRotationTrack = lower.includes('rotation') && sample.length >= 4;
    if (isRotationTrack) return options.rotationToleranceDeg;
    const translationTrack = isTranslationTrack(trackPath, sample);

    const dims = sample.length || 1;
    const mins = new Array<number>(dims).fill(Number.POSITIVE_INFINITY);
    const maxs = new Array<number>(dims).fill(Number.NEGATIVE_INFINITY);
    for (const key of keys) {
        const v = toVector(key?.Vector);
        for (let i = 0; i < dims; i++) {
            const cur = Number(v[i] ?? 0);
            if (cur < mins[i]) mins[i] = cur;
            if (cur > maxs[i]) maxs[i] = cur;
        }
    }
    let peakRange = 0;
    for (let i = 0; i < dims; i++) {
        const range = Number.isFinite(mins[i]) && Number.isFinite(maxs[i]) ? (maxs[i] - mins[i]) : 0;
        if (range > peakRange) peakRange = range;
    }
    if (translationTrack) {
        const scale = clamp(Math.pow(Math.max(peakRange, 1e-8), 0.25), 0.5, 2.4);
        return options.vectorTolerance * scale;
    }
    const scale = clamp(Math.sqrt(Math.max(peakRange, 1e-8)), 0.6, 10);
    if (dims <= 1) return options.scalarTolerance * scale;
    return options.vectorTolerance * scale;
};

const computeVelocityTolerance = (
    keys: any[],
    trackPath: string,
    valueTolerance: number,
    options: Required<KeyframeOptimizationOptions>
) => {
    let totalDt = 0;
    let count = 0;
    for (let i = 1; i < keys.length; i++) {
        const dt = Number(keys[i].Frame) - Number(keys[i - 1].Frame);
        if (Number.isFinite(dt) && dt > 0) {
            totalDt += dt;
            count++;
        }
    }
    const avgDt = Math.max(1, count > 0 ? totalDt / count : 33);
    const sample = keys.length > 0 ? toVector(keys[0]?.Vector) : [0];
    const rotationTrack = isRotationTrack(trackPath, sample);
    if (rotationTrack) {
        return Math.max((options.rotationToleranceDeg / avgDt) * 2.5, 0.0015);
    }
    const translationTrack = isTranslationTrack(trackPath, sample);
    if (translationTrack) {
        return Math.max((valueTolerance / avgDt) * 1.5, options.vectorTolerance / Math.max(avgDt * 1.6, 1));
    }
    return Math.max((valueTolerance / avgDt) * 2.5, options.scalarTolerance / avgDt);
};

const collectExtremaFrames = (keys: any[], tolerance: number): Set<number> => {
    const protectedFrames = new Set<number>();
    if (keys.length <= 2) return protectedFrames;

    const dims = Math.max(1, toVector(keys[0]?.Vector).length);
    for (let i = 1; i < keys.length - 1; i++) {
        const prev = toVector(keys[i - 1]?.Vector);
        const curr = toVector(keys[i]?.Vector);
        const next = toVector(keys[i + 1]?.Vector);
        let isExtrema = false;
        for (let d = 0; d < dims; d++) {
            const a = (curr[d] ?? 0) - (prev[d] ?? 0);
            const b = (next[d] ?? 0) - (curr[d] ?? 0);
            if (Math.abs(a) <= tolerance && Math.abs(b) <= tolerance) continue;
            if (a === 0 || b === 0 || a * b < 0) {
                isExtrema = true;
                break;
            }
        }
        if (isExtrema) protectedFrames.add(Number(keys[i].Frame));
    }
    return protectedFrames;
};

const collectRotationVelocityChangeFrames = (keys: any[], toleranceDeg: number): Set<number> => {
    const protectedFrames = new Set<number>();
    if (keys.length <= 2) return protectedFrames;
    for (let i = 1; i < keys.length - 1; i++) {
        const f0 = Number(keys[i - 1]?.Frame);
        const f1 = Number(keys[i]?.Frame);
        const f2 = Number(keys[i + 1]?.Frame);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2)) continue;
        const dt1 = Math.max(1, f1 - f0);
        const dt2 = Math.max(1, f2 - f1);
        const v0 = toVector(keys[i - 1]?.Vector);
        const v1 = toVector(keys[i]?.Vector);
        const v2 = toVector(keys[i + 1]?.Vector);
        if (v0.length < 4 || v1.length < 4 || v2.length < 4) continue;
        const velL = quaternionVelocityVector(v0, v1, dt1);
        const velR = quaternionVelocityVector(v1, v2, dt2);
        const velJump = vectorMaxAbsDiff(velL, velR);
        if (velJump > Math.max(toleranceDeg * 0.2, 0.0015)) {
            protectedFrames.add(Number(keys[i].Frame));
        }
    }
    return protectedFrames;
};

const computeRotationSafetyFactor = (keys: any[], toleranceDeg: number): number => {
    if (keys.length <= 2) return 1;
    let samples = 0;
    let spikeScore = 0;
    for (let i = 1; i < keys.length - 1; i++) {
        const f0 = Number(keys[i - 1]?.Frame);
        const f1 = Number(keys[i]?.Frame);
        const f2 = Number(keys[i + 1]?.Frame);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || !(f1 > f0) || !(f2 > f1)) continue;
        const dt1 = f1 - f0;
        const dt2 = f2 - f1;
        const v0 = toVector(keys[i - 1]?.Vector);
        const v1 = toVector(keys[i]?.Vector);
        const v2 = toVector(keys[i + 1]?.Vector);
        if (v0.length < 4 || v1.length < 4 || v2.length < 4) continue;
        const velL = quaternionVelocityVector(v0, v1, dt1);
        const velR = quaternionVelocityVector(v1, v2, dt2);
        const jump = vectorMaxAbsDiff(velL, velR);
        const normalized = jump / Math.max(toleranceDeg * 0.22, 0.0012);
        spikeScore += clamp(normalized - 1, 0, 4);
        samples++;
    }
    if (samples === 0) return 1;
    const avgSpike = spikeScore / samples;
    return clamp(1 - avgSpike * 0.12, 0.55, 1);
};

export const optimizeAnimVector = (
    anim: any,
    trackPath: string,
    preserveFrames: Set<number>,
    options: Required<KeyframeOptimizationOptions>
): { changed: boolean; before: number; after: number } => {
    const keys = normalizeAndSortKeys(Array.isArray(anim?.Keys) ? anim.Keys : []);
    if (keys.length <= 1) return { changed: false, before: keys.length, after: keys.length };

    const before = keys.length;
    const discrete = isDiscreteTrack(trackPath, keys);
    const rotationTrack = isRotationTrack(trackPath, toVector(keys[0]?.Vector));
    const translationTrack = isTranslationTrack(trackPath, toVector(keys[0]?.Vector));
    let stage = rotationTrack ? enforceQuaternionContinuity(keys) : keys;
    let adaptiveTol = computeAdaptiveTolerance(stage, trackPath, options);
    let adaptiveVelocityTol = computeVelocityTolerance(stage, trackPath, adaptiveTol, options);
    if (rotationTrack) {
        const safetyFactor = computeRotationSafetyFactor(stage, options.rotationToleranceDeg);
        adaptiveTol *= safetyFactor;
        adaptiveVelocityTol *= Math.max(0.62, safetyFactor * 0.9);
    }

    if (options.removeRedundantFrames) {
        const filtered: any[] = [stage[0]];
        for (let i = 1; i < stage.length; i++) {
            const curr = stage[i];
            const prev = filtered[filtered.length - 1];
            if (preserveFrames.has(curr.Frame)) {
                filtered.push(curr);
                continue;
            }
            const duplicateTolerance = translationTrack
                ? Math.max(options.scalarTolerance * 0.5, 1e-5)
                : Math.max(options.scalarTolerance, adaptiveTol * 0.15);
            const sameVector = vectorMaxAbsDiff(toVector(prev.Vector), toVector(curr.Vector)) <= duplicateTolerance;
            if (sameVector) continue;
            filtered.push(curr);
        }
        stage = filtered;
        if (rotationTrack) {
            stage = enforceQuaternionContinuity(stage);
        }
        adaptiveTol = computeAdaptiveTolerance(stage, trackPath, options);
        adaptiveVelocityTol = computeVelocityTolerance(stage, trackPath, adaptiveTol, options);
        if (rotationTrack) {
            const safetyFactor = computeRotationSafetyFactor(stage, options.rotationToleranceDeg);
            adaptiveTol *= safetyFactor;
            adaptiveVelocityTol *= Math.max(0.62, safetyFactor * 0.9);
        }
    }

    const allowLossyOptimization = !translationTrack;
    if (options.optimizeKeyframes && allowLossyOptimization && !discrete && stage.length > 2) {
        const lineType = getAnimLineType(anim);
        if (lineType !== 0) {
            const forceFrames = new Set<number>(preserveFrames);
            const lower = trackPath.toLowerCase();
            if (!lower.includes('rotation')) {
                const extremaFrames = collectExtremaFrames(stage, adaptiveTol * 0.45);
                extremaFrames.forEach((f) => forceFrames.add(f));
            } else {
                const rotationTurnFrames = collectRotationVelocityChangeFrames(stage, options.rotationToleranceDeg);
                rotationTurnFrames.forEach((f) => forceFrames.add(f));
            }

            const anchorIndices = new Set<number>([0, stage.length - 1]);
            for (let i = 1; i < stage.length - 1; i++) {
                if (forceFrames.has(Number(stage[i].Frame))) anchorIndices.add(i);
            }
            const anchors = Array.from(anchorIndices.values()).sort((a, b) => a - b);

            const curvatureScores = computeTrackCurvatureScores(stage, trackPath, adaptiveVelocityTol);
            const edgeCtx: SPOSEdgeContext = {
                keys: stage,
                trackPath,
                lineType,
                valueTolerance: adaptiveTol,
                velocityTolerance: adaptiveVelocityTol,
                curvatureScores,
                rotationTrack
            };

            const keepIndices = new Set<number>();
            for (let seg = 0; seg < anchors.length - 1; seg++) {
                const startIdx = anchors[seg];
                const endIdx = anchors[seg + 1];
                const segmentPath = solveSPOSSegment(stage, startIdx, endIdx, edgeCtx);
                for (const idx of segmentPath) keepIndices.add(idx);
            }
            anchors.forEach((idx) => keepIndices.add(idx));

            stage = stage.filter((_, idx) => keepIndices.has(idx));
            if (rotationTrack) {
                stage = enforceQuaternionContinuity(stage);
            }
        }
    }

    if (stage.length === before) return { changed: false, before, after: stage.length };
    anim.Keys = stage.map((k: any) => ({
        ...k,
        Vector: fromVector(k.Vector, toVector(k.Vector)),
        InTan: k.InTan !== undefined ? fromVector(k.InTan, toVector(k.InTan)) : k.InTan,
        OutTan: k.OutTan !== undefined ? fromVector(k.OutTan, toVector(k.OutTan)) : k.OutTan
    }));
    return { changed: true, before, after: anim.Keys.length };
};

export const collectSequenceBoundaryFrames = (modelData: any): Set<number> => {
    const frames = new Set<number>([0]);
    const seqs = Array.isArray(modelData?.Sequences) ? modelData.Sequences : [];
    for (const seq of seqs) {
        const interval = Array.isArray(seq?.Interval)
            ? seq.Interval
            : (seq?.Interval ? Array.from(seq.Interval as ArrayLike<number>) : null);
        if (!interval || interval.length < 2) continue;
        const start = Number(interval[0]);
        const end = Number(interval[1]);
        if (Number.isFinite(start)) frames.add(start);
        if (Number.isFinite(end)) frames.add(end);
    }
    return frames;
};
