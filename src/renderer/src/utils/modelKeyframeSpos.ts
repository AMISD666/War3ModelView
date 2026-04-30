import { clamp, toVector } from './modelOptimizationShared';
import {
    interpolateKeyPairAtFrame,
    isRotationTrack,
    sampleTrackValueAtFrame,
    valueErrorBetween,
    velocityErrorBetween
} from './modelKeyframeSampling';

export type SPOSEdgeContext = {
    keys: any[];
    trackPath: string;
    lineType: number;
    valueTolerance: number;
    velocityTolerance: number;
    curvatureScores: number[];
    rotationTrack: boolean;
};

export const validateSPOSEdge = (
    i: number,
    j: number,
    ctx: SPOSEdgeContext
): boolean => {
    if (j <= i) return false;
    if (j - i <= 1) return true;

    const { keys, trackPath, lineType, valueTolerance, velocityTolerance, curvatureScores, rotationTrack } = ctx;
    const fStart = Number(keys[i]?.Frame);
    const fEnd = Number(keys[j]?.Frame);
    if (!Number.isFinite(fStart) || !Number.isFinite(fEnd) || fEnd <= fStart) return false;

    const samples: Array<{ frame: number; curvature: number }> = [];
    for (let k = i + 1; k < j; k++) {
        samples.push({ frame: Number(keys[k]?.Frame), curvature: curvatureScores[k] || 0 });
    }
    for (let k = i; k < j; k++) {
        const f0 = Number(keys[k]?.Frame);
        const f1 = Number(keys[k + 1]?.Frame);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 <= f0) continue;
        samples.push({
            frame: (f0 + f1) * 0.5,
            curvature: ((curvatureScores[k] || 0) + (curvatureScores[k + 1] || 0)) * 0.5
        });
    }

    const maxSamples = rotationTrack ? 96 : 64;
    if (samples.length > maxSamples) {
        const reduced: Array<{ frame: number; curvature: number }> = [];
        for (let s = 0; s < maxSamples; s++) {
            const idx = Math.floor((s * (samples.length - 1)) / (maxSamples - 1));
            reduced.push(samples[idx]);
        }
        samples.splice(0, samples.length, ...reduced);
    }

    const span = fEnd - fStart;
    const derivativeWindowBase = Math.max(1, span / Math.max(20, (j - i) * 3));
    for (const sample of samples) {
        if (!Number.isFinite(sample.frame) || sample.frame <= fStart || sample.frame >= fEnd) continue;
        const curvature = clamp(sample.curvature, 0, 8);
        const valuePenalty = 1 + curvature * (rotationTrack ? 0.5 : 0.35);
        const velocityPenalty = 1 + curvature * (rotationTrack ? 0.32 : 0.22);
        const effectiveValueTol = valueTolerance / valuePenalty;
        const effectiveVelocityTol = velocityTolerance / velocityPenalty;

        const original = sampleTrackValueAtFrame(keys, i, j, sample.frame, trackPath, lineType);
        const simplified = interpolateKeyPairAtFrame(keys[i], keys[j], sample.frame, trackPath, lineType);
        const valueErr = valueErrorBetween(original, simplified, rotationTrack);
        if (!Number.isFinite(valueErr) || valueErr > effectiveValueTol) return false;

        const h = Math.max(1, Math.min(derivativeWindowBase, sample.frame - fStart, fEnd - sample.frame));
        const left = sample.frame - h;
        const right = sample.frame + h;
        if (!(right > left)) continue;

        const originalLeft = sampleTrackValueAtFrame(keys, i, j, left, trackPath, lineType);
        const originalRight = sampleTrackValueAtFrame(keys, i, j, right, trackPath, lineType);
        const simplifiedLeft = interpolateKeyPairAtFrame(keys[i], keys[j], left, trackPath, lineType);
        const simplifiedRight = interpolateKeyPairAtFrame(keys[i], keys[j], right, trackPath, lineType);
        const velocityErr = velocityErrorBetween(
            originalLeft,
            originalRight,
            simplifiedLeft,
            simplifiedRight,
            rotationTrack,
            right - left
        );
        if (!Number.isFinite(velocityErr) || velocityErr > effectiveVelocityTol) return false;

        if (!rotationTrack && lineType > 1) {
            const tangentTol = velocityTolerance * (lineType === 3 ? 0.9 : 1);
            const effectiveTangentTol = tangentTol / (1 + curvature * 0.2);
            if (velocityErr > effectiveTangentTol) return false;
        }
    }

    // Momentum safety: preserve start/end kinematic behavior.
    const dtStart = Math.max(1, Math.min((Number(keys[Math.min(i + 1, j)]?.Frame) - fStart) * 0.5, span * 0.15));
    const dtEnd = Math.max(1, Math.min((fEnd - Number(keys[Math.max(i, j - 1)]?.Frame)) * 0.5, span * 0.15));

    const startLeft = fStart;
    const startRight = Math.min(fEnd, fStart + dtStart);
    if (startRight > startLeft) {
        const originalStartL = sampleTrackValueAtFrame(keys, i, j, startLeft, trackPath, lineType);
        const originalStartR = sampleTrackValueAtFrame(keys, i, j, startRight, trackPath, lineType);
        const simplifiedStartL = interpolateKeyPairAtFrame(keys[i], keys[j], startLeft, trackPath, lineType);
        const simplifiedStartR = interpolateKeyPairAtFrame(keys[i], keys[j], startRight, trackPath, lineType);
        const startMomentumErr = velocityErrorBetween(
            originalStartL,
            originalStartR,
            simplifiedStartL,
            simplifiedStartR,
            rotationTrack,
            startRight - startLeft
        );
        if (startMomentumErr > velocityTolerance * (rotationTrack ? 0.9 : 1.1)) return false;
    }

    const endRight = fEnd;
    const endLeft = Math.max(fStart, fEnd - dtEnd);
    if (endRight > endLeft) {
        const originalEndL = sampleTrackValueAtFrame(keys, i, j, endLeft, trackPath, lineType);
        const originalEndR = sampleTrackValueAtFrame(keys, i, j, endRight, trackPath, lineType);
        const simplifiedEndL = interpolateKeyPairAtFrame(keys[i], keys[j], endLeft, trackPath, lineType);
        const simplifiedEndR = interpolateKeyPairAtFrame(keys[i], keys[j], endRight, trackPath, lineType);
        const endMomentumErr = velocityErrorBetween(
            originalEndL,
            originalEndR,
            simplifiedEndL,
            simplifiedEndR,
            rotationTrack,
            endRight - endLeft
        );
        if (endMomentumErr > velocityTolerance * (rotationTrack ? 0.9 : 1.1)) return false;
    }

    return true;
};

export const solveSPOSSegment = (
    keys: any[],
    startIdx: number,
    endIdx: number,
    ctx: SPOSEdgeContext
): number[] => {
    if (endIdx <= startIdx) return [startIdx];
    if (endIdx - startIdx <= 1) return [startIdx, endIdx];

    const count = endIdx - startIdx + 1;
    const dist = new Array<number>(count).fill(Number.POSITIVE_INFINITY);
    const prev = new Array<number>(count).fill(-1);
    dist[0] = 1;
    const maxBackward = Math.min(count - 1, 220);

    for (let localJ = 1; localJ < count; localJ++) {
        const from = Math.max(0, localJ - maxBackward);
        for (let localI = localJ - 1; localI >= from; localI--) {
            if (!Number.isFinite(dist[localI])) continue;
            const globalI = startIdx + localI;
            const globalJ = startIdx + localJ;
            if (!validateSPOSEdge(globalI, globalJ, ctx)) continue;
            const candidate = dist[localI] + 1;
            if (candidate < dist[localJ]) {
                dist[localJ] = candidate;
                prev[localJ] = localI;
            }
        }

        // Always keep graph connected as a safe fallback.
        if (prev[localJ] === -1 && Number.isFinite(dist[localJ - 1])) {
            dist[localJ] = dist[localJ - 1] + 1;
            prev[localJ] = localJ - 1;
        }
    }

    const out: number[] = [];
    let cursor = count - 1;
    while (cursor >= 0) {
        out.push(startIdx + cursor);
        if (cursor === 0) break;
        const p = prev[cursor];
        if (p < 0) {
            out.push(startIdx);
            break;
        }
        cursor = p;
    }
    out.reverse();
    return out;
};
