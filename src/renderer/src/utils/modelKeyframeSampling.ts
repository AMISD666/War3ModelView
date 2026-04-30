import {
    clamp,
    lerpVector,
    quaternionAngleDeg,
    quaternionVelocityVector,
    slerpQuaternion,
    toVector,
    vectorMaxAbsDiff
} from './modelOptimizationShared';

const DISCRETE_TRACK_TOKENS = [
    'visibility',
    'textureid',
    'replaceableid',
    'geosetid',
    'eventtrack'
];

export const isDiscreteTrack = (trackPath: string, keys: any[]): boolean => {
    const lower = trackPath.toLowerCase();
    if (DISCRETE_TRACK_TOKENS.some((token) => lower.includes(token))) return true;
    if (keys.length === 0) return false;
    const sample = toVector(keys[0]?.Vector);
    if (sample.length !== 1) return false;
    let intLikeCount = 0;
    for (const key of keys) {
        const v = toVector(key?.Vector)[0] ?? 0;
        if (Math.abs(v - Math.round(v)) < 1e-6) intLikeCount++;
    }
    return intLikeCount === keys.length;
};

export const isRotationTrack = (trackPath: string, sampleVec: number[]) => {
    return trackPath.toLowerCase().includes('rotation') && sampleVec.length >= 4;
};

export const isTranslationTrack = (trackPath: string, sampleVec: number[]) => {
    return trackPath.toLowerCase().includes('translation') && sampleVec.length >= 2;
};

export const interpolateVectors = (a: number[], b: number[], t: number, rotationTrack: boolean): number[] => {
    if (rotationTrack && a.length >= 4 && b.length >= 4) {
        return slerpQuaternion(a, b, t);
    }
    return lerpVector(a, b, t);
};

export const valueErrorBetween = (a: number[], b: number[], rotationTrack: boolean): number => {
    if (rotationTrack && a.length >= 4 && b.length >= 4) {
        return quaternionAngleDeg(a, b);
    }
    return vectorMaxAbsDiff(a, b);
};

export const velocityErrorBetween = (
    a0: number[],
    a1: number[],
    b0: number[],
    b1: number[],
    rotationTrack: boolean,
    dt: number
): number => {
    const safeDt = Math.max(dt, 1);
    if (rotationTrack && a0.length >= 4 && a1.length >= 4 && b0.length >= 4 && b1.length >= 4) {
        const va = quaternionVelocityVector(a0, a1, safeDt);
        const vb = quaternionVelocityVector(b0, b1, safeDt);
        return vectorMaxAbsDiff(va, vb);
    }

    const dims = Math.max(a0.length, a1.length, b0.length, b1.length);
    let maxDiff = 0;
    for (let i = 0; i < dims; i++) {
        const da = ((a1[i] ?? 0) - (a0[i] ?? 0)) / safeDt;
        const db = ((b1[i] ?? 0) - (b0[i] ?? 0)) / safeDt;
        const diff = Math.abs(da - db);
        if (diff > maxDiff) maxDiff = diff;
    }
    return maxDiff;
};

const sampleLinearTrackValueAtFrame = (
    left: any,
    right: any,
    frame: number,
    trackPath: string
): number[] => {
    const f0 = Number(left?.Frame);
    const f1 = Number(right?.Frame);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 <= f0) {
        return toVector(left?.Vector);
    }
    const t = clamp((frame - f0) / (f1 - f0), 0, 1);
    const v0 = toVector(left?.Vector);
    const v1 = toVector(right?.Vector);
    const rotationTrack = isRotationTrack(trackPath, v0);
    return interpolateVectors(v0, v1, t, rotationTrack);
};

export const sampleCollapsedIntervalErrors = (
    prev: any,
    current: any,
    next: any,
    trackPath: string
): { valueError: number; velocityError: number } => {
    const f0 = Number(prev?.Frame);
    const f1 = Number(current?.Frame);
    const f2 = Number(next?.Frame);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || f2 <= f0 || f1 <= f0 || f1 >= f2) {
        return { valueError: Number.POSITIVE_INFINITY, velocityError: Number.POSITIVE_INFINITY };
    }

    const v1 = toVector(current?.Vector);
    const rotationTrack = isRotationTrack(trackPath, v1);
    const sampleFractions = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    let maxValueError = 0;
    const totalSpan = f2 - f0;
    for (const frac of sampleFractions) {
        const frame = f0 + totalSpan * frac;
        const original = frame <= f1
            ? sampleLinearTrackValueAtFrame(prev, current, frame, trackPath)
            : sampleLinearTrackValueAtFrame(current, next, frame, trackPath);
        const simplified = sampleLinearTrackValueAtFrame(prev, next, frame, trackPath);
        const err = valueErrorBetween(original, simplified, rotationTrack);
        if (err > maxValueError) maxValueError = err;
    }

    let maxVelocityError = 0;
    const velocityFractions = [0.2, 0.4, 0.6, 0.8];
    const h = Math.max(1, totalSpan / 40);
    for (const frac of velocityFractions) {
        const center = f0 + totalSpan * frac;
        const left = Math.max(f0, center - h);
        const right = Math.min(f2, center + h);
        if (!(right > left)) continue;

        const originalLeft = left <= f1
            ? sampleLinearTrackValueAtFrame(prev, current, left, trackPath)
            : sampleLinearTrackValueAtFrame(current, next, left, trackPath);
        const originalRight = right <= f1
            ? sampleLinearTrackValueAtFrame(prev, current, right, trackPath)
            : sampleLinearTrackValueAtFrame(current, next, right, trackPath);

        const simplifiedLeft = sampleLinearTrackValueAtFrame(prev, next, left, trackPath);
        const simplifiedRight = sampleLinearTrackValueAtFrame(prev, next, right, trackPath);

        const velErr = velocityErrorBetween(
            originalLeft,
            originalRight,
            simplifiedLeft,
            simplifiedRight,
            rotationTrack,
            right - left
        );
        if (velErr > maxVelocityError) maxVelocityError = velErr;
    }

    return { valueError: maxValueError, velocityError: maxVelocityError };
};

export const interpolationError = (
    prev: any,
    current: any,
    next: any,
    trackPath: string
) => {
    const f0 = Number(prev?.Frame);
    const f1 = Number(current?.Frame);
    const f2 = Number(next?.Frame);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || f2 <= f0 || f1 <= f0 || f1 >= f2) {
        return Number.POSITIVE_INFINITY;
    }

    const t = (f1 - f0) / (f2 - f0);
    const v0 = toVector(prev?.Vector);
    const v1 = toVector(current?.Vector);
    const v2 = toVector(next?.Vector);
    const rotationTrack = isRotationTrack(trackPath, v1);
    const interp = interpolateVectors(v0, v2, t, rotationTrack);
    return valueErrorBetween(interp, v1, rotationTrack);
};

export const localCollapseVelocityError = (
    prev: any,
    current: any,
    next: any,
    trackPath: string
) => {
    const f0 = Number(prev?.Frame);
    const f1 = Number(current?.Frame);
    const f2 = Number(next?.Frame);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || f2 <= f0 || f1 <= f0 || f1 >= f2) {
        return Number.POSITIVE_INFINITY;
    }

    const v0 = toVector(prev?.Vector);
    const v1 = toVector(current?.Vector);
    const v2 = toVector(next?.Vector);
    const rotationTrack = isRotationTrack(trackPath, v1);
    const midT = (f1 - f0) / (f2 - f0);
    const simplifiedMid = interpolateVectors(v0, v2, midT, rotationTrack);

    const leftErr = velocityErrorBetween(v0, v1, v0, simplifiedMid, rotationTrack, f1 - f0);
    const rightErr = velocityErrorBetween(v1, v2, simplifiedMid, v2, rotationTrack, f2 - f1);
    return Math.max(leftErr, rightErr);
};

export const canRemoveMiddleKey = (
    prev: any,
    current: any,
    next: any,
    trackPath: string,
    valueTolerance: number,
    velocityTolerance: number
): boolean => {
    const valueErr = interpolationError(prev, current, next, trackPath);
    if (!Number.isFinite(valueErr) || valueErr > valueTolerance) return false;
    const velocityErr = localCollapseVelocityError(prev, current, next, trackPath);
    if (!Number.isFinite(velocityErr) || velocityErr > velocityTolerance) return false;

    const sampled = sampleCollapsedIntervalErrors(prev, current, next, trackPath);
    if (!Number.isFinite(sampled.valueError) || !Number.isFinite(sampled.velocityError)) return false;

    const rotationTrack = isRotationTrack(trackPath, toVector(current?.Vector));
    const safeValueTol = rotationTrack ? valueTolerance * 0.82 : valueTolerance;
    const safeVelocityTol = rotationTrack ? velocityTolerance * 0.75 : velocityTolerance;

    return sampled.valueError <= safeValueTol && sampled.velocityError <= safeVelocityTol;
};

export const getAnimLineType = (anim: any): number => {
    const raw = Number(anim?.LineType ?? anim?.InterpolationType ?? 1);
    if (!Number.isFinite(raw)) return 1;
    return clamp(Math.round(raw), 0, 3);
};
const interpolateBezier = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

const interpolateHermite = (p0: number, p1: number, m0: number, m1: number, t: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
};

export const interpolateKeyPairAtFrame = (
    left: any,
    right: any,
    frame: number,
    trackPath: string,
    lineType: number
): number[] => {
    const f0 = Number(left?.Frame);
    const f1 = Number(right?.Frame);
    const v0 = toVector(left?.Vector);
    const v1 = toVector(right?.Vector);
    if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 <= f0) return v0;
    if (lineType === 0) return v0;
    const t = clamp((frame - f0) / (f1 - f0), 0, 1);
    const rotationTrack = isRotationTrack(trackPath, v0);
    if (rotationTrack) {
        return slerpQuaternion(v0, v1, t);
    }
    if (lineType === 1) {
        return lerpVector(v0, v1, t);
    }

    const outTan = toVector(left?.OutTan ?? left?.Vector);
    const inTan = toVector(right?.InTan ?? right?.Vector);
    const dims = Math.max(v0.length, v1.length, outTan.length, inTan.length, 1);
    const out = new Array<number>(dims);
    for (let i = 0; i < dims; i++) {
        const p0 = v0[i] ?? 0;
        const p1 = v1[i] ?? 0;
        if (lineType === 3) {
            const c0 = outTan[i] ?? p0;
            const c1 = inTan[i] ?? p1;
            out[i] = interpolateBezier(p0, c0, c1, p1, t);
        } else {
            const m0 = (outTan[i] ?? p0) - p0;
            const m1 = p1 - (inTan[i] ?? p1);
            out[i] = interpolateHermite(p0, p1, m0, m1, t);
        }
    }
    return out;
};

const findSegmentIndexForFrame = (keys: any[], startIdx: number, endIdx: number, frame: number): number => {
    if (endIdx - startIdx <= 1) return startIdx;
    let lo = startIdx;
    let hi = endIdx - 1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const fMid = Number(keys[mid]?.Frame);
        const fNext = Number(keys[mid + 1]?.Frame);
        if (frame < fMid) {
            hi = mid - 1;
            continue;
        }
        if (frame > fNext) {
            lo = mid + 1;
            continue;
        }
        return mid;
    }
    return clamp(lo, startIdx, endIdx - 1);
};

export const sampleTrackValueAtFrame = (
    keys: any[],
    startIdx: number,
    endIdx: number,
    frame: number,
    trackPath: string,
    lineType: number
): number[] => {
    if (startIdx >= endIdx) return toVector(keys[startIdx]?.Vector);
    const startFrame = Number(keys[startIdx]?.Frame);
    const endFrame = Number(keys[endIdx]?.Frame);
    if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) {
        return toVector(keys[startIdx]?.Vector);
    }
    if (frame <= startFrame) return toVector(keys[startIdx]?.Vector);
    if (frame >= endFrame) return toVector(keys[endIdx]?.Vector);
    const segIdx = findSegmentIndexForFrame(keys, startIdx, endIdx, frame);
    return interpolateKeyPairAtFrame(keys[segIdx], keys[segIdx + 1], frame, trackPath, lineType);
};

export const computeTrackCurvatureScores = (
    keys: any[],
    trackPath: string,
    velocityTolerance: number
): number[] => {
    const n = keys.length;
    const scores = new Array<number>(n).fill(0);
    if (n <= 2) return scores;
    const rotationTrack = isRotationTrack(trackPath, toVector(keys[0]?.Vector));
    const safeVelTol = Math.max(velocityTolerance, 1e-6);
    for (let i = 1; i < n - 1; i++) {
        const f0 = Number(keys[i - 1]?.Frame);
        const f1 = Number(keys[i]?.Frame);
        const f2 = Number(keys[i + 1]?.Frame);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || !Number.isFinite(f2) || !(f1 > f0) || !(f2 > f1)) {
            continue;
        }
        const dt1 = f1 - f0;
        const dt2 = f2 - f1;
        const v0 = toVector(keys[i - 1]?.Vector);
        const v1 = toVector(keys[i]?.Vector);
        const v2 = toVector(keys[i + 1]?.Vector);
        let curvature = 0;
        if (rotationTrack && v0.length >= 4 && v1.length >= 4 && v2.length >= 4) {
            const velL = quaternionVelocityVector(v0, v1, dt1);
            const velR = quaternionVelocityVector(v1, v2, dt2);
            curvature = vectorMaxAbsDiff(velL, velR);
        } else {
            const dims = Math.max(v0.length, v1.length, v2.length);
            for (let d = 0; d < dims; d++) {
                const vl = ((v1[d] ?? 0) - (v0[d] ?? 0)) / Math.max(dt1, 1);
                const vr = ((v2[d] ?? 0) - (v1[d] ?? 0)) / Math.max(dt2, 1);
                curvature = Math.max(curvature, Math.abs(vr - vl));
            }
        }
        scores[i] = clamp(curvature / safeVelTol, 0, 8);
    }

    const smoothed = [...scores];
    for (let i = 1; i < n - 1; i++) {
        smoothed[i] = (scores[i - 1] + scores[i] * 2 + scores[i + 1]) * 0.25;
    }
    return smoothed;
};

