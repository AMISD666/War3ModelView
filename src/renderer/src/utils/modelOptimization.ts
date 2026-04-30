import { isAnimVector } from './modelUtils';
import { optimizeSingleGeoset } from './modelPolygonOptimization';
import {
    collectSequenceBoundaryFrames,
    GEOMETRY_SKIP_KEYS,
    optimizeAnimVector
} from './modelKeyframeOptimization';

export interface PolygonOptimizationOptions {
    removeRedundantVertices?: boolean;
    decimateModel?: boolean;
    decimateRatio?: number; // keep ratio in percentage, 0-100
    positionTolerance?: number;
    uvTolerance?: number;
    normalDotThreshold?: number;
    boundaryLock?: boolean;
    qemLambdaUv?: number;
    qemLambdaSkin?: number;
    qemFeaturePenalty?: number;
    qemBoundaryPenalty?: number;
    qemFlipDotThreshold?: number;
}

export interface PolygonOptimizationStats {
    geosetsProcessed: number;
    verticesBefore: number;
    verticesAfter: number;
    facesBefore: number;
    facesAfter: number;
    degenerateFacesRemoved: number;
    collapsedEdges: number;
}

export interface KeyframeOptimizationOptions {
    removeRedundantFrames?: boolean;
    optimizeKeyframes?: boolean;
    scalarTolerance?: number;
    vectorTolerance?: number;
    rotationToleranceDeg?: number;
}

export interface KeyframeOptimizationStats {
    tracksProcessed: number;
    keysBefore: number;
    keysAfter: number;
    keysRemoved: number;
}

const DEFAULT_POLYGON_OPTIONS: Required<PolygonOptimizationOptions> = {
    removeRedundantVertices: true,
    decimateModel: true,
    decimateRatio: 75,
    positionTolerance: 1e-4,
    uvTolerance: 1e-4,
    normalDotThreshold: 0.97,
    boundaryLock: false,
    qemLambdaUv: 2.4,
    qemLambdaSkin: 4.5,
    qemFeaturePenalty: 2.2,
    qemBoundaryPenalty: 6.0,
    qemFlipDotThreshold: 0.1
};

const DEFAULT_KEYFRAME_OPTIONS: Required<KeyframeOptimizationOptions> = {
    removeRedundantFrames: true,
    optimizeKeyframes: true,
    scalarTolerance: 3e-4,
    vectorTolerance: 1.2e-3,
    rotationToleranceDeg: 0.22
};

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function optimizeModelPolygons(
    sourceModel: any,
    options: PolygonOptimizationOptions = {},
    onProgress?: (ratio: number, message: string) => void
): Promise<{ model: any; stats: PolygonOptimizationStats; changed: boolean }> {
    const opts = { ...DEFAULT_POLYGON_OPTIONS, ...options };
    const model = sourceModel;
    const geosets = Array.isArray(model?.Geosets) ? model.Geosets : [];

    const stats: PolygonOptimizationStats = {
        geosetsProcessed: 0,
        verticesBefore: 0,
        verticesAfter: 0,
        facesBefore: 0,
        facesAfter: 0,
        degenerateFacesRemoved: 0,
        collapsedEdges: 0
    };

    if (geosets.length === 0) return { model, stats, changed: false };

    const nextGeosets: any[] = [];
    let changed = false;

    for (let i = 0; i < geosets.length; i++) {
        const result = optimizeSingleGeoset(geosets[i], opts);
        nextGeosets.push(result.geoset);
        stats.geosetsProcessed++;
        stats.verticesBefore += result.stats.verticesBefore;
        stats.verticesAfter += result.stats.verticesAfter;
        stats.facesBefore += result.stats.facesBefore;
        stats.facesAfter += result.stats.facesAfter;
        stats.degenerateFacesRemoved += result.stats.degenerateFacesRemoved;
        stats.collapsedEdges += result.stats.collapsedEdges;

        if (
            result.stats.verticesAfter !== result.stats.verticesBefore ||
            result.stats.facesAfter !== result.stats.facesBefore
        ) {
            changed = true;
        }

        onProgress?.((i + 1) / geosets.length, `优化多边形 ${i + 1}/${geosets.length}`);
        await nextTick();
    }

    model.Geosets = nextGeosets;
    return { model, stats, changed };
}

export async function optimizeModelKeyframes(
    sourceModel: any,
    options: KeyframeOptimizationOptions = {},
    onProgress?: (ratio: number, message: string) => void
): Promise<{ model: any; stats: KeyframeOptimizationStats; changed: boolean }> {
    const opts = { ...DEFAULT_KEYFRAME_OPTIONS, ...options };
    const model = sourceModel;
    const preserveFrames = collectSequenceBoundaryFrames(model);

    const stats: KeyframeOptimizationStats = {
        tracksProcessed: 0,
        keysBefore: 0,
        keysAfter: 0,
        keysRemoved: 0
    };

    let changed = false;
    let visited = 0;
    let totalEstimated = 1;

    const estimateTracks = (obj: any): number => {
        if (!obj || typeof obj !== 'object') return 0;
        if (Array.isArray(obj)) return obj.reduce((sum, item) => sum + estimateTracks(item), 0);
        if (isAnimVector(obj)) return 1;
        let count = 0;
        for (const key of Object.keys(obj)) {
            if (GEOMETRY_SKIP_KEYS.has(key)) continue;
            count += estimateTracks((obj as any)[key]);
        }
        return count;
    };

    totalEstimated = Math.max(estimateTracks(model), 1);

    const traverse = async (obj: any, path: string): Promise<void> => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                await traverse(obj[i], `${path}[${i}]`);
            }
            return;
        }

        if (isAnimVector(obj)) {
            const result = optimizeAnimVector(obj, path, preserveFrames, opts);
            stats.tracksProcessed++;
            stats.keysBefore += result.before;
            stats.keysAfter += result.after;
            if (result.changed) {
                changed = true;
                stats.keysRemoved += Math.max(0, result.before - result.after);
            }
            visited++;
            onProgress?.(visited / totalEstimated, `优化关键帧轨道 ${visited}/${totalEstimated}`);
            if (visited % 10 === 0) await nextTick();
            return;
        }

        for (const key of Object.keys(obj)) {
            if (GEOMETRY_SKIP_KEYS.has(key)) continue;
            await traverse(obj[key], path ? `${path}.${key}` : key);
        }
    };

    await traverse(model, 'model');
    return { model, stats, changed };
}
