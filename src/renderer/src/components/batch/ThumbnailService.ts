/**
 * ThumbnailService - Manages background thumbnail rendering via Web Workers
 * 
 * Provides absolute isolation from the main thread's WebGL state.
 */

// @ts-ignore
import { parseMDX, parseMDL, decodeBLP, getBLPImageData } from 'war3-model';
import { invoke } from '@tauri-apps/api/core';
import { REPLACEABLE_TEXTURES, normalizePath } from '../viewer/textureLoader';
import { getEnvironmentManager } from '../viewer/EnvironmentManager';
import { useRendererStore } from '../../store/rendererStore';
import { invokeReadMpqFile } from '../../utils/mpqPerf';

// We import the worker using Vite's ?worker suffix
// @ts-ignore
import ThumbnailWorker from './thumbnail.worker?worker';

export interface RenderResult {
    bitmap: ImageBitmap;
    animations?: string[];
    status?: 'success' | 'busy' | 'error';
}

interface SharedRenderState {
    renderState: ReturnType<typeof useRendererStore.getState>;
    teamColorData: Record<number, ImageData>;
    envPayload: {
        envLightingEnabled: boolean;
        envLightDirection?: [number, number, number];
        envLightColor?: [number, number, number];
        envAmbientColor?: [number, number, number];
    };
}

interface CachedModelInfo {
    buffer: ArrayBuffer;
    animations: string[];
    texturePaths: string[];
}

interface CachedResources {
    modelInfo: CachedModelInfo;
    textureImages: Record<string, ArrayBuffer>;
}

interface TextureLoadMetrics {
    textureCount: number;
    resolvedCount: number;
    sharedHitCount: number;
    missCount: number;
    batchLoadMs: number;
    batchMpqLoadMs: number;
    batchFsLoadMs: number;
    queueWaitMs: number;
    decodeMs: number;
    fallbackLoadMs: number;
    totalMs: number;
}

interface ModelPerfRecord {
    fullPath: string;
    fileName: string;
    modelReadMs: number;
    modelParseMs: number;
    textureCount: number;
    textureResolvedCount: number;
    textureSharedHitCount: number;
    textureMissCount: number;
    textureBatchLoadMs: number;
    textureBatchMpqLoadMs: number;
    textureBatchFsLoadMs: number;
    textureQueueWaitMs: number;
    textureDecodeMs: number;
    textureFallbackLoadMs: number;
    textureTotalMs: number;
    prepareMs: number;
    workerRenderMs: number;
    workerColdStartMs: number;
    workerDrawMs: number;
    workerTransferMs: number;
    endToEndMs: number;
    lastUpdated: number;
}

interface RenderRequestMetric {
    requestStartMs: number;
    prepareMs: number;
}

interface WorkerDonePayload {
    fullPath: string;
    generation?: number;
    bitmap: ImageBitmap;
    animations?: string[];
    texturePaths?: string[];
    metrics?: {
        renderMs?: number;
        coldStartMs?: number;
        parseMs?: number;
        drawMs?: number;
        transferMs?: number;
    };
}

interface WorkerPreloadedPayload {
    fullPath: string;
    generation?: number;
    animations?: string[];
    texturePaths?: string[];
    metrics?: {
        coldStartMs?: number;
        parseMs?: number;
    };
}

interface WorkerMetadataPayload {
    fullPath: string;
    generation?: number;
    animations?: string[];
    texturePaths?: string[];
    metrics?: {
        parseMs?: number;
    };
}

interface LocalFileReadDetailed {
    path: string;
    found: boolean;
    byte_len: number;
    read_ms: number;
    data_b64?: string | null;
}

class ThumbnailService {
    private workers: Worker[] = [];
    private workerBusy: boolean[] = [];
    private callbacks: Map<string, (res: RenderResult) => void> = new Map();
    private modelCache: Map<string, CachedModelInfo> = new Map();
    private textureCache: Map<string, Record<string, ArrayBuffer>> = new Map();
    private resourceLoading: Map<string, Promise<CachedResources>> = new Map();
    private textureLoading: Map<string, Promise<Record<string, ArrayBuffer>>> = new Map();
    private sharedTextureCache: Map<string, ArrayBuffer> = new Map();
    private sharedTextureLoading: Map<string, Promise<ArrayBuffer | null>> = new Map();
    private textureTaskQueue: Array<() => void> = [];
    private textureTaskRunning = 0;
    private readonly MAX_TEXTURE_TASK_CONCURRENCY = Math.max(
        4,
        Math.min(8, Math.floor((typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 8) / 2))
    );
    private workerModelCache: string[][] = []; // Per-worker LRU cache (array of paths)
    private workerTextureSync: Set<string>[] = [];
    private workerSharedTextureSync: Set<string>[] = [];
    private workerTeamColorSync: Map<string, number>[] = [];
    private modelWorkerAffinity: Map<string, number> = new Map();
    private activeBatchPaths: Set<string> = new Set();
    private activeBatchGeneration = 0;
    private pageGenerationByPath: Map<string, number> = new Map();
    private workerCount = Math.max(
        4,
        Math.min(12, Math.max(4, (typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 8) : 8) - 2))
    );
    private readonly MAIN_CACHE_LIMIT = 128; // Main thread cache entry limit
    private readonly MAIN_MODEL_CACHE_MAX_BYTES = 192 * 1024 * 1024;
    private modelCacheBytes: Map<string, number> = new Map();
    private modelCacheTotalBytes = 0;
    private teamColorData: Record<number, ImageData> = {};
    private teamColorDataByIndex: Map<number, Record<number, ImageData>> = new Map();
    private teamColorsLoadingByIndex: Map<number, Promise<Record<number, ImageData>>> = new Map();
    private modelReadyStage: Map<string, 'manifest-ready' | 'textures-ready' | 'renderer-ready'> = new Map();
    private workerTimeouts: (ReturnType<typeof setTimeout> | null)[] = [];
    private readonly CACHE_LIMIT = 32; // Per-worker tracked cache limit
    private readonly SHARED_TEXTURE_CACHE_LIMIT = 1024;
    private readonly SHARED_TEXTURE_CACHE_MAX_BYTES = 256 * 1024 * 1024;
    private sharedTextureCacheBytes: Map<string, number> = new Map();
    private sharedTextureTotalBytes = 0;
    private modelPerf: Map<string, ModelPerfRecord> = new Map();
    private readonly MODEL_PERF_LIMIT = 800;
    private renderRequestMetrics: Map<string, RenderRequestMetric> = new Map();
    private firstTouchMetrics: Map<string, number> = new Map();
    private preloadCallbacks: Map<string, () => void> = new Map();
    private preloadRequestGeneration: Map<string, number> = new Map();
    private renderRequestGeneration: Map<string, number> = new Map();
    private metadataCallbacks: Map<string, () => void> = new Map();
    private metadataRequestGeneration: Map<string, number> = new Map();
    private metadataLoading: Map<string, Promise<void>> = new Map();
    private metadataWorkers: Worker[] = [];
    private metadataWorkerBusy: boolean[] = [];
    private metadataWorkerCount = 0;
    private preloadingPaths: Set<string> = new Set();
    private perfLoggedStages: Map<string, Set<string>> = new Map();

    constructor() {
        useRendererStore.subscribe((state) => {
            if (state.mpqLoaded) {
                void this.ensureTeamColorsLoaded(state.teamColor);
            }
        });
        this.metadataWorkerCount = Math.max(2, Math.min(4, Math.max(2, Math.floor(this.workerCount / 3))));
        for (let i = 0; i < this.workerCount; i++) {
            const worker = new ThumbnailWorker();
            this.workers.push(worker);
            this.workerBusy.push(false);
            this.workerModelCache.push([]);
            this.workerTextureSync.push(new Set());
            this.workerSharedTextureSync.push(new Set());
            this.workerTeamColorSync.push(new Map());
            this.workerTimeouts.push(null);

            worker.onmessage = (e: MessageEvent) => {
                const { type, payload } = e.data;

                // Safety: Clear timeout if exists for this worker
                if (type === 'DONE' || type === 'ERROR') {
                    if (this.workerTimeouts[i]) {
                        clearTimeout(this.workerTimeouts[i]!);
                        this.workerTimeouts[i] = null;
                    }
                }

                if (type === 'DONE') {
                    const { fullPath, generation, bitmap, animations, texturePaths, metrics } = payload as WorkerDonePayload;
                    const expectedGeneration = this.renderRequestGeneration.get(fullPath);
                    if (generation !== undefined && expectedGeneration !== undefined && generation !== expectedGeneration) {
                        this.workerBusy[i] = false;
                        return;
                    }
                    const stillActive = this.activeBatchPaths.has(fullPath) || this.callbacks.has(fullPath);
                    if (stillActive) {
                        this.modelWorkerAffinity.set(fullPath, i);
                    }
                    const existingModelInfo = this.modelCache.get(fullPath);
                    if (existingModelInfo) {
                        const nextAnimations = (animations && animations.length > 0) ? animations : existingModelInfo.animations;
                        const nextTexturePaths = (texturePaths && texturePaths.length > 0) ? texturePaths : existingModelInfo.texturePaths;
                        if (nextAnimations !== existingModelInfo.animations || nextTexturePaths !== existingModelInfo.texturePaths) {
                            this.touchMainCache(fullPath, {
                                ...existingModelInfo,
                                animations: nextAnimations,
                                texturePaths: nextTexturePaths
                            });
                        }

                        if (nextTexturePaths.length > 0) {
                            const cachedTextures = this.textureCache.get(fullPath) || {};
                            const hasMissingTextures = nextTexturePaths.some((path) => !cachedTextures[path]);
                            if (hasMissingTextures) {
                                void this.loadTextureImages(fullPath, nextTexturePaths);
                            }
                        }
                    }

                    const requestMetrics = this.renderRequestMetrics.get(fullPath);
                    if (requestMetrics) {
                        const firstTouchStartMs = this.firstTouchMetrics.get(fullPath);
                        const endToEndMs = Math.max(0, performance.now() - (firstTouchStartMs ?? requestMetrics.requestStartMs));
                        this.renderRequestMetrics.delete(fullPath);
                        this.renderRequestGeneration.delete(fullPath);
                        this.clearFirstTouch(fullPath);
                        this.recordModelPerf(fullPath, {
                            prepareMs: requestMetrics.prepareMs,
                            workerRenderMs: metrics?.renderMs ?? 0,
                            workerColdStartMs: metrics?.coldStartMs ?? 0,
                            modelParseMs: Math.max(metrics?.parseMs ?? 0, this.getOrCreateModelPerf(fullPath).modelParseMs),
                            workerDrawMs: metrics?.drawMs ?? 0,
                            workerTransferMs: metrics?.transferMs ?? 0,
                            endToEndMs
                        });
                        this.logPerfSummaryOnce(fullPath, 'first-frame');
                    }
                    const cb = this.callbacks.get(fullPath);
                    if (cb) {
                        cb({ bitmap, animations, status: 'success' });
                        this.callbacks.delete(fullPath);
                    }

                    // Update LRU: Move to end (most recent)
                    if (stillActive) {
                        const cache = this.workerModelCache[i];
                        const idx = cache.indexOf(fullPath);
                        if (idx > -1) cache.splice(idx, 1);
                        cache.push(fullPath);
                        if (cache.length > this.CACHE_LIMIT) {
                            cache.shift(); // Remove oldest
                        }
                    }

                    this.workerBusy[i] = false;
                }
                else if (type === 'ERROR') {
                    const { fullPath, generation, error } = payload;
                    const expectedRenderGeneration = fullPath ? this.renderRequestGeneration.get(fullPath) : undefined;
                    const expectedPreloadGeneration = fullPath ? this.preloadRequestGeneration.get(fullPath) : undefined;
                    const staleRenderError = generation !== undefined && expectedRenderGeneration !== undefined && generation !== expectedRenderGeneration;
                    const stalePreloadError = generation !== undefined && expectedPreloadGeneration !== undefined && generation !== expectedPreloadGeneration;
                    if (staleRenderError || stalePreloadError) {
                        this.workerBusy[i] = false;
                        return;
                    }
                    this.renderRequestMetrics.delete(fullPath);
                    this.renderRequestGeneration.delete(fullPath);
                    this.clearFirstTouch(fullPath);
                    if (fullPath && this.preloadingPaths.has(fullPath)) {
                        this.preloadCallbacks.get(fullPath)?.();
                        this.preloadCallbacks.delete(fullPath);
                        this.preloadRequestGeneration.delete(fullPath);
                        this.preloadingPaths.delete(fullPath);
                    }
                    if (fullPath && this.metadataCallbacks.has(fullPath)) {
                        this.metadataCallbacks.get(fullPath)?.();
                        this.metadataCallbacks.delete(fullPath);
                        this.metadataRequestGeneration.delete(fullPath);
                    }

                    // Check for "missing cache" error and retry
                    if (typeof error === 'string' && error.includes('Model data missing')) {
                        console.log(`[ThumbnailService] Cache miss for ${fullPath}, retrying with full payload...`);

                        // Clear from tracker as it's clearly missing
                        const cache = this.workerModelCache[i];
                        const idx = cache.indexOf(fullPath);
                        if (idx > -1) cache.splice(idx, 1);

                        // Retry immediately with full payload if we have data locally
                        const modelInfo = this.modelCache.get(fullPath);
                        const textureImages = this.textureCache.get(fullPath);

                        if (modelInfo) {
                            const renderState = useRendererStore.getState();
                            const envPayload = this.getEnvironmentLightPayload();
                            const includeTeamColorPayload = Object.keys(this.teamColorData).length > 0;
                            const retryGeneration = this.renderRequestGeneration.get(fullPath) ?? this.pageGenerationByPath.get(fullPath) ?? this.activeBatchGeneration;
                            // Clone textures for transfer (originals stay in cache)
                            const clonedTextures = textureImages && Object.keys(textureImages).length > 0
                                ? Object.fromEntries(Object.entries(textureImages).map(([k, v]) => [k, v.slice(0)]))
                                : undefined;
                            const msg = {
                                type: 'RENDER',
                                payload: {
                                    fullPath,
                                    modelBuffer: modelInfo.buffer,
                                    ...(clonedTextures ? { textureRawData: clonedTextures, textureMaxDimension: this.getDecodeMaxDimension() } : {}),
                                    ...(includeTeamColorPayload ? { teamColorData: this.teamColorData } : {}),
                                    generation: retryGeneration,
                                    frame: 0,
                                    sequenceIndex: 0,
                                    backgroundColor: renderState.backgroundColor,
                                    teamColor: renderState.teamColor,
                                    enableLighting: renderState.enableLighting,
                                    wireframe: renderState.renderMode === 'wireframe',
                                    showParticles: renderState.showParticles ?? true,
                                    showRibbons: renderState.showRibbons ?? true,
                                    ...envPayload
                                }
                            };
                            const xfer = this.collectTransferables(msg.payload);
                            worker.postMessage(msg, xfer);
                            if (textureImages && Object.keys(textureImages).length > 0) {
                                this.workerTextureSync[i].add(fullPath);
                                this.getTextureSyncKeys(fullPath, Object.keys(textureImages)).forEach((key) => this.workerSharedTextureSync[i].add(key));
                            } else {
                                this.workerTextureSync[i].delete(fullPath);
                            }
                            if (includeTeamColorPayload) {
                                this.workerTeamColorSync[i].set(fullPath, renderState.teamColor);
                            }
                            // Don't clear callback or reset busy yet, we are retrying
                            return;
                        }
                    }

                    console.warn(`[ThumbnailService] Worker ${i} reported error for ${fullPath}:`, error);
                    if (this.modelWorkerAffinity.get(fullPath) === i) {
                        this.modelWorkerAffinity.delete(fullPath);
                    }
                    this.workerTextureSync[i].clear();
                    this.workerSharedTextureSync[i].clear();
                    this.workerTeamColorSync[i].delete(fullPath);
                    const cb = this.callbacks.get(fullPath);
                    if (cb) {
                        cb({ bitmap: null as any, status: 'error' });
                        this.callbacks.delete(fullPath);
                    }
                    this.workerBusy[i] = false;
                }
                else if (type === 'CLEARED') {
                    this.workerBusy[i] = false;
                    this.workerModelCache[i] = [];
                    this.workerTextureSync[i].clear();
                    this.workerSharedTextureSync[i].clear();
                    this.workerTeamColorSync[i].clear();
                }
                else if (type === 'EVICTED') {
                    const evictedPath = payload?.fullPath as string | undefined;
                    if (!evictedPath) return;

                    const cache = this.workerModelCache[i];
                    const idx = cache.indexOf(evictedPath);
                    if (idx > -1) cache.splice(idx, 1);
                    this.rebuildWorkerTextureSyncState(i);
                    this.workerTeamColorSync[i].delete(evictedPath);
                    if (this.modelWorkerAffinity.get(evictedPath) === i) {
                        this.modelWorkerAffinity.delete(evictedPath);
                    }
                }
                else if (type === 'WARMED') {
                    this.workerBusy[i] = false;
                }
                else if (type === 'METADATA') {
                    const { fullPath, generation, animations, texturePaths, metrics } = payload as WorkerMetadataPayload;
                    const expectedGeneration = this.metadataRequestGeneration.get(fullPath);
                    if (generation !== undefined && expectedGeneration !== undefined && generation !== expectedGeneration) {
                        this.workerBusy[i] = false;
                        return;
                    }
                    const existingModelInfo = this.modelCache.get(fullPath);
                    if (existingModelInfo) {
                        const nextAnimations = (animations && animations.length > 0) ? animations : existingModelInfo.animations;
                        const nextTexturePaths = (texturePaths && texturePaths.length > 0) ? texturePaths : existingModelInfo.texturePaths;
                        if (nextAnimations !== existingModelInfo.animations || nextTexturePaths !== existingModelInfo.texturePaths) {
                            this.touchMainCache(fullPath, {
                                ...existingModelInfo,
                                animations: nextAnimations,
                                texturePaths: nextTexturePaths
                            });
                        }
                        this.modelReadyStage.set(fullPath, 'manifest-ready');
                    }
                    this.recordModelPerf(fullPath, {
                        modelParseMs: Math.max(metrics?.parseMs ?? 0, this.getOrCreateModelPerf(fullPath).modelParseMs)
                    });
                    this.metadataCallbacks.get(fullPath)?.();
                    this.metadataCallbacks.delete(fullPath);
                    this.metadataRequestGeneration.delete(fullPath);
                    this.workerBusy[i] = false;
                }
                else if (type === 'PRELOADED') {
                    const { fullPath, generation, animations, texturePaths, metrics } = payload as WorkerPreloadedPayload;
                    const expectedGeneration = this.preloadRequestGeneration.get(fullPath);
                    if (generation !== undefined && expectedGeneration !== undefined && generation !== expectedGeneration) {
                        this.workerBusy[i] = false;
                        return;
                    }
                    const stillActive = this.activeBatchPaths.has(fullPath) || this.preloadingPaths.has(fullPath);
                    if (stillActive) {
                        this.modelWorkerAffinity.set(fullPath, i);
                    }
                    const existingModelInfo = this.modelCache.get(fullPath);
                    if (existingModelInfo) {
                        const nextAnimations = (animations && animations.length > 0) ? animations : existingModelInfo.animations;
                        const nextTexturePaths = (texturePaths && texturePaths.length > 0) ? texturePaths : existingModelInfo.texturePaths;
                        if (nextAnimations !== existingModelInfo.animations || nextTexturePaths !== existingModelInfo.texturePaths) {
                            this.touchMainCache(fullPath, {
                                ...existingModelInfo,
                                animations: nextAnimations,
                                texturePaths: nextTexturePaths
                            });
                        }

                        if (nextTexturePaths.length > 0) {
                            const cachedTextures = this.textureCache.get(fullPath) || {};
                            const hasMissingTextures = nextTexturePaths.some((path) => !cachedTextures[path]);
                            if (hasMissingTextures) {
                                void this.loadTextureImages(fullPath, nextTexturePaths);
                            }
                        }
                    }

                    if (stillActive) {
                        const cache = this.workerModelCache[i];
                        const idx = cache.indexOf(fullPath);
                        if (idx > -1) cache.splice(idx, 1);
                        cache.push(fullPath);
                        if (cache.length > this.CACHE_LIMIT) {
                            cache.shift();
                        }
                    }

                    this.recordModelPerf(fullPath, {
                        workerColdStartMs: metrics?.coldStartMs ?? 0,
                        modelParseMs: Math.max(metrics?.parseMs ?? 0, this.getOrCreateModelPerf(fullPath).modelParseMs)
                    });
                    this.logPerfStageOnce(
                        fullPath,
                        'preload',
                        `preload parse=${(metrics?.parseMs ?? 0).toFixed(1)}ms cold=${(metrics?.coldStartMs ?? 0).toFixed(1)}ms`
                    );

                    this.preloadCallbacks.get(fullPath)?.();
                    this.preloadCallbacks.delete(fullPath);
                    this.preloadRequestGeneration.delete(fullPath);
                    this.preloadingPaths.delete(fullPath);
                    this.workerBusy[i] = false;
                }
                else if (type === 'PRUNED') {
                    const keepSet = this.activeBatchPaths;
                    this.workerModelCache[i] = this.workerModelCache[i].filter((path) => keepSet.has(path));
                    this.rebuildWorkerTextureSyncState(i);
                    for (const path of Array.from(this.workerTeamColorSync[i].keys())) {
                        if (!keepSet.has(path)) {
                            this.workerTeamColorSync[i].delete(path);
                        }
                    }
                    this.workerBusy[i] = false;
                }
            };
            worker.postMessage({ type: 'WARMUP' });
        }

        for (let i = 0; i < this.metadataWorkerCount; i++) {
            const worker = new ThumbnailWorker();
            this.metadataWorkers.push(worker);
            this.metadataWorkerBusy.push(false);
            worker.onmessage = (e: MessageEvent) => {
                const { type, payload } = e.data;

                if (type === 'METADATA') {
                    const { fullPath, generation, animations, texturePaths, metrics } = payload as WorkerMetadataPayload;
                    const expectedGeneration = this.metadataRequestGeneration.get(fullPath);
                    if (generation !== undefined && expectedGeneration !== undefined && generation !== expectedGeneration) {
                        this.metadataWorkerBusy[i] = false;
                        return;
                    }
                    const existingModelInfo = this.modelCache.get(fullPath);
                    if (existingModelInfo) {
                        const nextAnimations = (animations && animations.length > 0) ? animations : existingModelInfo.animations;
                        const nextTexturePaths = (texturePaths && texturePaths.length > 0) ? texturePaths : existingModelInfo.texturePaths;
                        if (nextAnimations !== existingModelInfo.animations || nextTexturePaths !== existingModelInfo.texturePaths) {
                            this.touchMainCache(fullPath, {
                                ...existingModelInfo,
                                animations: nextAnimations,
                                texturePaths: nextTexturePaths
                            });
                        }
                        this.modelReadyStage.set(fullPath, 'manifest-ready');
                    }
                    this.recordModelPerf(fullPath, {
                        modelParseMs: Math.max(metrics?.parseMs ?? 0, this.getOrCreateModelPerf(fullPath).modelParseMs)
                    });
                    this.metadataCallbacks.get(fullPath)?.();
                    this.metadataCallbacks.delete(fullPath);
                    this.metadataRequestGeneration.delete(fullPath);
                    this.metadataWorkerBusy[i] = false;
                }
                else if (type === 'ERROR') {
                    const { fullPath, generation } = payload || {};
                    const expectedGeneration = fullPath ? this.metadataRequestGeneration.get(fullPath) : undefined;
                    const staleError = generation !== undefined && expectedGeneration !== undefined && generation !== expectedGeneration;
                    if (staleError) {
                        this.metadataWorkerBusy[i] = false;
                        return;
                    }
                    if (fullPath && this.metadataCallbacks.has(fullPath)) {
                        this.metadataCallbacks.get(fullPath)?.();
                        this.metadataCallbacks.delete(fullPath);
                        this.metadataRequestGeneration.delete(fullPath);
                    }
                    this.metadataWorkerBusy[i] = false;
                }
            };
        }
    }

    private async preloadModelToWorker(fullPath: string, modelInfo?: CachedModelInfo): Promise<void> {
        if (!fullPath) return;
        if (this.preloadingPaths.has(fullPath)) return;
        if (this.workerModelCache.some((cache) => cache.includes(fullPath))) return;

        const info = modelInfo ?? await this.loadModelInfo(fullPath);
        const texturePaths = info.texturePaths || [];
        const generation = this.pageGenerationByPath.get(fullPath) ?? this.activeBatchGeneration;
        this.preloadingPaths.add(fullPath);
        this.preloadRequestGeneration.set(fullPath, generation);

        try {
            let workerIndex = this.getAvailableWorkerIndex(fullPath, { allowFallback: true });
            while (workerIndex === -1) {
                await new Promise((resolve) => setTimeout(resolve, 4));
                workerIndex = this.getAvailableWorkerIndex(fullPath, { allowFallback: true });
            }

            let strictTexturePayload: Record<string, ArrayBuffer> | undefined;
            let strictTeamColorData: Record<string, ArrayBuffer> | undefined;
            let strictTeamColor: number | undefined;
            if (texturePaths.length > 0 && this.requiresStrictTextureInit(texturePaths)) {
                const textureImages = this.textureCache.get(fullPath) || {};
                const hasAllTextures = texturePaths.every((path) => !!textureImages[path]);
                if (hasAllTextures) {
                    const renderState = useRendererStore.getState();
                    strictTeamColor = renderState.teamColor;
                    strictTeamColorData = await this.ensureTeamColorsLoaded(strictTeamColor);
                    strictTexturePayload = Object.fromEntries(
                        Object.entries(textureImages).map(([k, v]) => [k, v instanceof ArrayBuffer ? v.slice(0) : v])
                    );
                }
            }

            this.workerBusy[workerIndex] = true;
            const worker = this.workers[workerIndex];

            await new Promise<void>((resolve) => {
                this.preloadCallbacks.set(fullPath, resolve);
                const payload: Record<string, any> = {
                    fullPath,
                    modelBuffer: info.buffer,
                    generation,
                    renderSize: this.getBatchRenderSize()
                };

                if (strictTexturePayload && Object.keys(strictTexturePayload).length > 0) {
                    payload.textureRawData = strictTexturePayload;
                    payload.textureMaxDimension = this.getDecodeMaxDimension();
                }
                if (strictTeamColorData && Object.keys(strictTeamColorData).length > 0) {
                    payload.teamColorData = strictTeamColorData;
                    payload.teamColor = strictTeamColor ?? 0;
                }

                const message = {
                    type: 'PRELOAD',
                    payload
                };
                const transferables = this.collectTransferables(payload);
                worker.postMessage(message, transferables);
            });
        } finally {
            this.preloadingPaths.delete(fullPath);
        }
    }

    private createSolidImageData(r: number, g: number, b: number, a: number = 255, size: number = 64): ImageData {
        const data = new Uint8ClampedArray(size * size * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = a;
        }
        return new ImageData(data, size, size);
    }

    private normalizeTeamColorIndex(colorIndex: number): number {
        const n = Math.floor(Number(colorIndex));
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(11, n));
    }

    private getTeamColorFallbackRgb(colorIndex: number): [number, number, number] {
        const palette: Array<[number, number, number]> = [
            [220, 60, 60],   // red
            [60, 130, 255],  // blue
            [30, 200, 200],  // teal
            [150, 95, 240],  // purple
            [255, 220, 40],  // yellow
            [255, 150, 20],  // orange
            [40, 200, 40],   // green
            [255, 110, 175], // pink
            [170, 170, 170], // gray
            [120, 175, 255], // light blue
            [35, 140, 70],   // dark green
            [165, 110, 60]   // brown
        ];
        return palette[this.normalizeTeamColorIndex(colorIndex)];
    }

    private createTeamColorFallbackSet(colorIndex: number): Record<number, ImageData> {
        const [r, g, b] = this.getTeamColorFallbackRgb(colorIndex);
        return {
            1: this.createSolidImageData(r, g, b, 255),
            2: this.createSolidImageData(r, g, b, 190)
        };
    }

    private async ensureTeamColorsLoaded(colorIndex: number): Promise<Record<number, ImageData>> {
        const normalizedIndex = this.normalizeTeamColorIndex(colorIndex);
        const mpqLoaded = useRendererStore.getState().mpqLoaded;
        const cached = this.teamColorDataByIndex.get(normalizedIndex);
        if (cached && mpqLoaded) {
            this.teamColorData = cached;
            return cached;
        }

        if (!mpqLoaded) {
            const fallback = this.createTeamColorFallbackSet(normalizedIndex);
            this.teamColorData = fallback;
            return fallback;
        }

        const inflight = this.teamColorsLoadingByIndex.get(normalizedIndex);
        if (inflight) {
            const loaded = await inflight;
            this.teamColorData = loaded;
            return loaded;
        }

        const loadPromise = this.initTeamColors(normalizedIndex);
        this.teamColorsLoadingByIndex.set(normalizedIndex, loadPromise);
        try {
            const loaded = await loadPromise;
            this.teamColorDataByIndex.set(normalizedIndex, loaded);
            this.teamColorData = loaded;
            return loaded;
        } finally {
            this.teamColorsLoadingByIndex.delete(normalizedIndex);
        }
    }

    private async initTeamColors(colorIndex: number): Promise<Record<number, ImageData>> {
        const idStr = this.normalizeTeamColorIndex(colorIndex).toString().padStart(2, '0');
        const colors = [
            { id: 1, path: `ReplaceableTextures\\TeamColor\\TeamColor${idStr}.blp` },
            { id: 2, path: `ReplaceableTextures\\TeamGlow\\TeamGlow${idStr}.blp` }
        ];
        const loaded: Record<number, ImageData> = {};
        const fallback = this.createTeamColorFallbackSet(colorIndex);

        for (const col of colors) {
            try {
                const data = await invokeReadMpqFile<Uint8Array>(col.path, 'ThumbnailService.initTeamColors');
                if (data && data.length > 0) {
                    const blp = decodeBLP(data.buffer as ArrayBuffer);
                    const mip = getBLPImageData(blp, 0);
                    loaded[col.id] = new ImageData(
                        new Uint8ClampedArray(mip.data),
                        mip.width,
                        mip.height
                    );
                    continue;
                }
            } catch (e) {
                console.warn(`Failed to pre-load team color ${col.path}`, e);
            }
            loaded[col.id] = fallback[col.id];
        }

        return loaded;
    }

    private getFreeWorkerIndices(): number[] {
        const free: number[] = [];
        for (let i = 0; i < this.workerCount; i++) {
            if (!this.workerBusy[i]) free.push(i);
        }
        return free;
    }

    private chooseLeastLoadedWorker(indices: number[], fullPath?: string, preferredTexturePaths?: string[]): number {
        let best = indices[0];
        let bestScore = Number.POSITIVE_INFINITY;
        let bestOverlap = -1;
        const preferredSet = fullPath && preferredTexturePaths && preferredTexturePaths.length > 0
            ? new Set(preferredTexturePaths.map((path) => this.getTextureCacheKey(fullPath, path)))
            : null;

        for (const i of indices) {
            let overlap = 0;
            if (preferredSet && preferredSet.size > 0) {
                for (const path of preferredSet) {
                    if (this.workerSharedTextureSync[i].has(path)) {
                        overlap += 1;
                    }
                }
            }
            // Prefer workers with lighter hot cache to reduce memory churn.
            const score = this.workerModelCache[i].length * 2 + this.workerTextureSync[i].size + Math.floor(this.workerSharedTextureSync[i].size / 8);
            if (overlap > bestOverlap || (overlap === bestOverlap && score < bestScore)) {
                best = i;
                bestOverlap = overlap;
                bestScore = score;
            }
        }

        return best;
    }

    private getAvailableWorkerIndex(fullPath: string, options?: { allowFallback?: boolean }): number {
        const mapped = this.modelWorkerAffinity.get(fullPath);
        if (mapped !== undefined) {
            if (!this.workerBusy[mapped]) {
                return mapped;
            }
            if (!options?.allowFallback) {
                return -1;
            }
        }

        const freeWorkers = this.getFreeWorkerIndices();
        if (freeWorkers.length === 0) {
            return -1;
        }

        // Cache-locality first: if any free worker already has this model, reuse it.
        const cachedWorker = freeWorkers.find((idx) => this.workerModelCache[idx].includes(fullPath));
        if (cachedWorker !== undefined) {
            this.modelWorkerAffinity.set(fullPath, cachedWorker);
            return cachedWorker;
        }

        const preferredTexturePaths = this.modelCache.get(fullPath)?.texturePaths;
        const bestWorker = this.chooseLeastLoadedWorker(freeWorkers, fullPath, preferredTexturePaths);
        this.modelWorkerAffinity.set(fullPath, bestWorker);
        return bestWorker;
    }

    private base64ToUint8Array(base64: string): Uint8Array {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    private getFileName(fullPath: string): string {
        const parts = fullPath.split(/[/\\]/);
        return parts[parts.length - 1] || fullPath;
    }

    private markFirstTouch(fullPath: string) {
        if (!this.firstTouchMetrics.has(fullPath)) {
            this.firstTouchMetrics.set(fullPath, performance.now());
        }
    }

    private clearFirstTouch(fullPath: string) {
        this.firstTouchMetrics.delete(fullPath);
    }

    private decodeBase64ToArrayBuffer(base64: string): { buffer: ArrayBuffer; decodeMs: number } {
        const decodeStart = performance.now();
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return {
            buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            decodeMs: performance.now() - decodeStart
        };
    }

    private parseModelBatchBinaryPayload(payload: any, paths: string[]): Array<{ path: string; found: boolean; readMs: number; buffer?: ArrayBuffer }> {
        const bytes = this.toUint8Array(payload);
        if (!bytes || bytes.byteLength < 4) {
            return paths.map((path) => ({ path, found: false, readMs: 0 }));
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = 0;
        const count = view.getUint32(offset, true);
        offset += 4;
        const total = Math.min(count, paths.length);
        const results: Array<{ path: string; found: boolean; readMs: number; buffer?: ArrayBuffer }> = [];

        for (let i = 0; i < total; i++) {
            if (offset + 13 > bytes.byteLength) {
                break;
            }
            const found = view.getUint8(offset) === 1;
            offset += 1;
            const readMs = view.getFloat64(offset, true);
            offset += 8;
            const dataLen = view.getUint32(offset, true);
            offset += 4;

            let buffer: ArrayBuffer | undefined;
            if (dataLen > 0 && offset + dataLen <= bytes.byteLength) {
                const slice = bytes.subarray(offset, offset + dataLen);
                buffer = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
            }
            offset += dataLen;
            results.push({
                path: paths[i],
                found,
                readMs,
                buffer
            });
        }

        while (results.length < paths.length) {
            results.push({ path: paths[results.length], found: false, readMs: 0 });
        }

        return results;
    }

    private storeLoadedModelBuffer(fullPath: string, buffer: ArrayBuffer, modelReadMs: number, logMessage: string): CachedModelInfo {
        const modelInfo: CachedModelInfo = {
            buffer,
            animations: [],
            texturePaths: []
        };
        this.recordModelPerf(fullPath, {
            modelReadMs,
            textureCount: 0
        });
        this.logPerfStageOnce(fullPath, 'read', logMessage);
        this.touchMainCache(fullPath, modelInfo);
        return modelInfo;
    }

    public primeModelBuffers(entries: Array<{ fullPath: string; buffer: ArrayBuffer; readMs?: number }>) {
        for (const entry of entries) {
            if (!entry?.fullPath || !entry.buffer) continue;
            if (this.modelCache.has(entry.fullPath)) continue;
            this.markFirstTouch(entry.fullPath);
            const readMs = Number(entry.readMs ?? 0);
            this.storeLoadedModelBuffer(
                entry.fullPath,
                entry.buffer,
                readMs,
                `read=${readMs.toFixed(1)}ms backend=${readMs.toFixed(1)}ms invoke=0.0ms decode=0.0ms bytes=${entry.buffer.byteLength} mode=first-page-bin`
            );
        }
    }

    private async loadModelInfoBatch(fullPaths: string[]): Promise<void> {
        const targets = Array.from(new Set(fullPaths.filter((fullPath) => {
            if (!fullPath) return false;
            if (this.modelCache.has(fullPath)) return false;
            if (this.resourceLoading.has(fullPath)) return false;
            return true;
        })));
        if (targets.length === 0) return;

        targets.forEach((fullPath) => this.markFirstTouch(fullPath));

        const batchStart = performance.now();
        const payload = await invoke<Uint8Array>('read_local_files_batch_bin', { paths: targets });
        const batchWallMs = performance.now() - batchStart;
        const sharedInvokeMs = batchWallMs / Math.max(1, targets.length);
        const results = this.parseModelBatchBinaryPayload(payload, targets);

        for (const result of results) {
            if (!result?.found || !result.buffer) continue;
            const totalReadMs = result.readMs + sharedInvokeMs;
            this.storeLoadedModelBuffer(
                result.path,
                result.buffer,
                totalReadMs,
                `read=${totalReadMs.toFixed(1)}ms backend=${result.readMs.toFixed(1)}ms invoke=${sharedInvokeMs.toFixed(1)}ms decode=0.0ms bytes=${result.buffer.byteLength} mode=batch-bin`
            );
        }
    }

    private async loadModelMetadataBatch(fullPaths: string[]): Promise<void> {
        const targets = Array.from(new Set(fullPaths.filter((fullPath) => {
            const modelInfo = this.modelCache.get(fullPath);
            if (!modelInfo) return false;
            return modelInfo.animations.length === 0 || modelInfo.texturePaths.length === 0;
        })));
        if (targets.length === 0) return;

        let cursor = 0;
        const concurrency = Math.max(1, Math.min(this.workerCount, targets.length));
        const workerLoop = async () => {
            while (cursor < targets.length) {
                const fullPath = targets[cursor++];
                const modelInfo = this.modelCache.get(fullPath);
                if (!modelInfo) continue;
                await this.dispatchMetadataLoad(fullPath, modelInfo);
            }
        };

        await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
    }

    private getAvailableMetadataWorkerIndex(): number {
        for (let i = 0; i < this.metadataWorkerCount; i++) {
            if (!this.metadataWorkerBusy[i]) {
                return i;
            }
        }
        return -1;
    }

    private dispatchMetadataLoad(fullPath: string, modelInfo: CachedModelInfo): Promise<void> {
        if (modelInfo.texturePaths.length > 0 && modelInfo.animations.length > 0) {
            return Promise.resolve();
        }

        const existing = this.metadataLoading.get(fullPath);
        if (existing) {
            return existing;
        }

        let promise!: Promise<void>;
        promise = (async () => {
            let workerIndex = this.getAvailableMetadataWorkerIndex();
            while (workerIndex === -1) {
                await new Promise((resolve) => setTimeout(resolve, 2));
                workerIndex = this.getAvailableMetadataWorkerIndex();
            }

            const generation = this.pageGenerationByPath.get(fullPath) ?? this.activeBatchGeneration;
            this.metadataWorkerBusy[workerIndex] = true;
            this.metadataRequestGeneration.set(fullPath, generation);

            await new Promise<void>((resolve) => {
                this.metadataCallbacks.set(fullPath, resolve);
                this.metadataWorkers[workerIndex].postMessage({
                    type: 'METADATA',
                    payload: {
                        fullPath,
                        modelBuffer: modelInfo.buffer,
                        generation
                    }
                });
            });
        })().finally(() => {
            if (this.metadataLoading.get(fullPath) === promise) {
                this.metadataLoading.delete(fullPath);
            }
        });

        this.metadataLoading.set(fullPath, promise);
        return promise;
    }

    private async ensureModelMetadataReady(fullPath: string, modelInfo: CachedModelInfo): Promise<CachedModelInfo> {
        if (modelInfo.texturePaths.length > 0 && modelInfo.animations.length > 0) {
            return modelInfo;
        }

        await this.dispatchMetadataLoad(fullPath, modelInfo);
        const refreshed = this.modelCache.get(fullPath);
        if (refreshed && refreshed.texturePaths.length > 0 && refreshed.animations.length > 0) {
            return refreshed;
        }

        return this.ensureModelMetadata(fullPath, refreshed ?? modelInfo);
    }

    private ensureModelMetadata(fullPath: string, modelInfo: CachedModelInfo): CachedModelInfo {
        if (modelInfo.texturePaths.length > 0 && modelInfo.animations.length > 0) {
            return modelInfo;
        }

        const parseStart = performance.now();
        const parsed = this.parseModelMetadata(fullPath, modelInfo.buffer);
        const parseMs = performance.now() - parseStart;

        if (modelInfo.animations.length === 0) {
            modelInfo.animations = parsed.animations;
        }
        if (modelInfo.texturePaths.length === 0) {
            modelInfo.texturePaths = parsed.texturePaths;
        }

        this.recordModelPerf(fullPath, {
            modelParseMs: Math.max(parseMs, this.getOrCreateModelPerf(fullPath).modelParseMs)
        });
        this.modelReadyStage.set(fullPath, 'manifest-ready');
        return modelInfo;
    }

    private async warmPageTextures(fullPaths: string[]): Promise<void> {
        const uniqueModelPaths = Array.from(new Set(fullPaths.filter(Boolean)));
        if (uniqueModelPaths.length === 0) return;

        const resolverByKey = new Map<string, (value: ArrayBuffer | null) => void>();
        const groups = new Map<string, { ownerPath: string; texturePaths: string[] }>();

        for (const fullPath of uniqueModelPaths) {
            const modelInfo = this.modelCache.get(fullPath);
            if (!modelInfo) continue;

            const enriched = this.ensureModelMetadata(fullPath, modelInfo);
            const seenPaths = new Set<string>();
            for (const texturePath of enriched.texturePaths) {
                if (!texturePath || seenPaths.has(texturePath)) continue;
                seenPaths.add(texturePath);

                const key = this.getTextureCacheKey(fullPath, texturePath);
                if (this.sharedTextureCache.has(key)) {
                    continue;
                }

                const inflight = this.sharedTextureLoading.get(key);
                if (inflight) {
                    continue;
                }

                const ownerGroupKey = this.getTextureOwnerGroupKey(fullPath, texturePath);
                let ownerTargets = groups.get(ownerGroupKey);
                if (!ownerTargets) {
                    ownerTargets = { ownerPath: fullPath, texturePaths: [] };
                    groups.set(ownerGroupKey, ownerTargets);
                }
                ownerTargets.texturePaths.push(texturePath);

                const pending = new Promise<ArrayBuffer | null>((resolve) => {
                    resolverByKey.set(key, resolve);
                });
                this.sharedTextureLoading.set(key, pending);
            }
        }

        if (groups.size === 0) {
            return;
        }

        const groupTasks = Array.from(groups.values()).map(({ ownerPath, texturePaths }) =>
            this.withTextureTaskSlot(async () => {
                try {
                    const payload = await invoke<Uint8Array>('load_textures_batch_bin', {
                        modelPath: ownerPath,
                        texturePaths
                    });
                    const rawBinaryMap = this.parseTextureBytesPayload(payload, texturePaths);
                    const unresolvedPaths: string[] = [];
                    for (const texturePath of texturePaths) {
                        const key = this.getTextureCacheKey(ownerPath, texturePath);
                        const data = rawBinaryMap.get(texturePath);
                        if (!data || data.byteLength === 0) {
                            unresolvedPaths.push(texturePath);
                            continue;
                        }
                        const buffer = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
                            ? data.buffer
                            : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                        this.touchSharedTextureCache(key, buffer.slice(0));
                        resolverByKey.get(key)?.(buffer.slice(0));
                    }
                    if (unresolvedPaths.length > 0) {
                        const fallback = await this.loadMissingMpqTextures(unresolvedPaths);
                        for (const texturePath of unresolvedPaths) {
                            const key = this.getTextureCacheKey(ownerPath, texturePath);
                            const buffer = fallback.resolved.get(texturePath);
                            if (buffer && buffer.byteLength > 0) {
                                this.touchSharedTextureCache(key, buffer.slice(0));
                                resolverByKey.get(key)?.(buffer.slice(0));
                            } else {
                                resolverByKey.get(key)?.(null);
                            }
                        }
                    }
                } catch {
                    for (const texturePath of texturePaths) {
                        const key = this.getTextureCacheKey(ownerPath, texturePath);
                        resolverByKey.get(key)?.(null);
                    }
                } finally {
                    for (const texturePath of texturePaths) {
                        const key = this.getTextureCacheKey(ownerPath, texturePath);
                        this.sharedTextureLoading.delete(key);
                    }
                }
            })
        );

        await Promise.all(groupTasks);

        for (const fullPath of uniqueModelPaths) {
            const modelInfo = this.modelCache.get(fullPath);
            if (!modelInfo || modelInfo.texturePaths.length === 0) {
                continue;
            }

            const textureImages: Record<string, ArrayBuffer> = {};
            for (const texturePath of modelInfo.texturePaths) {
                const key = this.getTextureCacheKey(fullPath, texturePath);
                const shared = this.sharedTextureCache.get(key);
                if (shared) {
                    textureImages[texturePath] = shared;
                }
            }

            if (Object.keys(textureImages).length > 0) {
                this.textureCache.set(fullPath, textureImages);
            }
            if (modelInfo.texturePaths.length === 0 || modelInfo.texturePaths.every((path) => !!textureImages[path])) {
                this.modelReadyStage.set(fullPath, 'textures-ready');
            } else {
                this.modelReadyStage.set(fullPath, 'manifest-ready');
            }
        }
    }

    private getOrCreateModelPerf(fullPath: string): ModelPerfRecord {
        const existing = this.modelPerf.get(fullPath);
        if (existing) {
            return existing;
        }

        const record: ModelPerfRecord = {
            fullPath,
            fileName: this.getFileName(fullPath),
            modelReadMs: 0,
            modelParseMs: 0,
            textureCount: 0,
            textureResolvedCount: 0,
            textureSharedHitCount: 0,
            textureMissCount: 0,
            textureBatchLoadMs: 0,
            textureBatchMpqLoadMs: 0,
            textureBatchFsLoadMs: 0,
            textureQueueWaitMs: 0,
            textureDecodeMs: 0,
            textureFallbackLoadMs: 0,
            textureTotalMs: 0,
            prepareMs: 0,
            workerRenderMs: 0,
            workerColdStartMs: 0,
            workerDrawMs: 0,
            workerTransferMs: 0,
            endToEndMs: 0,
            lastUpdated: Date.now()
        };
        this.modelPerf.set(fullPath, record);

        if (this.modelPerf.size > this.MODEL_PERF_LIMIT) {
            const oldestKey = this.modelPerf.keys().next().value as string | undefined;
            if (oldestKey) this.modelPerf.delete(oldestKey);
        }

        return record;
    }

    private recordModelPerf(fullPath: string, patch: Partial<ModelPerfRecord>) {
        const record = this.getOrCreateModelPerf(fullPath);
        Object.assign(record, patch);
        record.lastUpdated = Date.now();
    }

    private logPerfStageOnce(fullPath: string, stage: string, message: string) {
        let stages = this.perfLoggedStages.get(fullPath);
        if (!stages) {
            stages = new Set<string>();
            this.perfLoggedStages.set(fullPath, stages);
        }
        if (stages.has(stage)) return;
        stages.add(stage);
        console.info(`[BatchPerf][${stage}] ${this.getFileName(fullPath)} ${message}`);
    }

    private logPerfSummaryOnce(fullPath: string, stage: string) {
        const record = this.getOrCreateModelPerf(fullPath);
        const totalLoadMs = this.getModelTotalLoadMs(record);
        this.logPerfStageOnce(
            fullPath,
            stage,
            `read=${record.modelReadMs.toFixed(1)}ms parse=${record.modelParseMs.toFixed(1)}ms ` +
            `textures=${record.textureTotalMs.toFixed(1)}ms(resolved=${record.textureResolvedCount}/${record.textureCount}, decode=${record.textureDecodeMs.toFixed(1)}ms, queue=${record.textureQueueWaitMs.toFixed(1)}ms) ` +
            `prepare=${record.prepareMs.toFixed(1)}ms draw=${record.workerDrawMs.toFixed(1)}ms transfer=${record.workerTransferMs.toFixed(1)}ms total=${record.endToEndMs.toFixed(1)}ms modelLoad=${totalLoadMs.toFixed(1)}ms`
        );
    }

    private getModelTotalLoadMs(record: ModelPerfRecord): number {
        return (
            record.modelReadMs +
            record.modelParseMs +
            record.textureTotalMs +
            record.prepareMs +
            record.workerDrawMs +
            record.workerTransferMs
        );
    }

    private getTextureCacheKey(modelPath: string, texturePath: string): string {
        const normalizedTexture = normalizePath(texturePath).toLowerCase();
        if (/^[a-z]:\\/.test(normalizedTexture) || normalizedTexture.startsWith('\\\\')) {
            return `abs:${normalizedTexture}`;
        }
        if (normalizedTexture.startsWith('replaceabletextures\\')) {
            return `replaceable:${normalizedTexture}`;
        }
        if (
            normalizedTexture.startsWith('textures\\') ||
            normalizedTexture.startsWith('units\\') ||
            normalizedTexture.startsWith('buildings\\') ||
            normalizedTexture.startsWith('doodads\\') ||
            normalizedTexture.startsWith('abilities\\') ||
            normalizedTexture.startsWith('environment\\') ||
            normalizedTexture.startsWith('objects\\') ||
            normalizedTexture.startsWith('sharedmodels\\') ||
            normalizedTexture.startsWith('ui\\') ||
            normalizedTexture.startsWith('splats\\')
        ) {
            return `mpq:${normalizedTexture}`;
        }

        const normalizedModel = normalizePath(modelPath).toLowerCase();
        const lastSlash = normalizedModel.lastIndexOf('\\');
        const modelDir = lastSlash >= 0 ? normalizedModel.substring(0, lastSlash) : normalizedModel;
        return `fs:${modelDir}|${normalizedTexture}`;
    }

    private getTextureSyncKeys(modelPath: string, texturePaths: string[]): string[] {
        return texturePaths.map((texturePath) => this.getTextureCacheKey(modelPath, texturePath));
    }

    private getModelDirectoryKey(modelPath: string): string {
        const normalizedModel = normalizePath(modelPath).toLowerCase();
        const lastSlash = normalizedModel.lastIndexOf('\\');
        return lastSlash >= 0 ? normalizedModel.substring(0, lastSlash) : normalizedModel;
    }

    private getTextureOwnerGroupKey(modelPath: string, texturePath: string): string {
        const normalizedTexture = normalizePath(texturePath).toLowerCase();
        if (
            /^[a-z]:\\/.test(normalizedTexture) ||
            normalizedTexture.startsWith('\\\\') ||
            normalizedTexture.startsWith('replaceabletextures\\') ||
            normalizedTexture.startsWith('textures\\') ||
            normalizedTexture.startsWith('units\\') ||
            normalizedTexture.startsWith('buildings\\') ||
            normalizedTexture.startsWith('doodads\\') ||
            normalizedTexture.startsWith('abilities\\') ||
            normalizedTexture.startsWith('environment\\') ||
            normalizedTexture.startsWith('objects\\') ||
            normalizedTexture.startsWith('sharedmodels\\') ||
            normalizedTexture.startsWith('ui\\') ||
            normalizedTexture.startsWith('splats\\')
        ) {
            return '__shared__';
        }
        return `dir:${this.getModelDirectoryKey(modelPath)}`;
    }

    private getBatchRenderSize(): number {
        const activeCount = this.activeBatchPaths.size;
        if (activeCount >= 50) return 112;
        if (activeCount >= 25) return 128;
        return 160;
    }

    private getBatchPreloadLimit(totalModels: number): number {
        const activeCount = this.activeBatchPaths.size || totalModels;
        if (activeCount >= 50) return 0;
        if (activeCount >= 25) return Math.max(0, Math.min(this.workerCount, totalModels));
        return totalModels;
    }

    private usesReplaceableTeamTextures(texturePaths: string[]): boolean {
        return texturePaths.some((path) => {
            const normalized = normalizePath(path).toLowerCase();
            return normalized.startsWith('replaceabletextures\\teamcolor\\') ||
                normalized.startsWith('replaceabletextures\\teamglow\\');
        });
    }

    private requiresStrictTextureInit(texturePaths: string[]): boolean {
        return this.usesReplaceableTeamTextures(texturePaths);
    }

    private rebuildWorkerTextureSyncState(workerIndex: number) {
        const shared = this.workerSharedTextureSync[workerIndex];
        const syncedModels = this.workerTextureSync[workerIndex];
        shared.clear();
        syncedModels.clear();

        for (const fullPath of this.workerModelCache[workerIndex]) {
            const modelInfo = this.modelCache.get(fullPath);
            const texturePaths = modelInfo?.texturePaths || [];
            if (texturePaths.length === 0) {
                syncedModels.add(fullPath);
            }
        }
    }

    private getImageDataBytes(image: ImageData | ArrayBuffer): number {
        if (image instanceof ArrayBuffer) return image.byteLength;
        return image.width * image.height * 4;
    }

    private getEnvironmentLightPayload(): {
        envLightingEnabled: boolean;
        envLightDirection?: [number, number, number];
        envLightColor?: [number, number, number];
        envAmbientColor?: [number, number, number];
    } {
        const envManager = getEnvironmentManager();
        if (!envManager.isEnabled()) {
            return { envLightingEnabled: false };
        }

        const params = envManager.getLightParams();
        const toVec3 = (v: any): [number, number, number] => ([
            Number(v?.[0] ?? 0),
            Number(v?.[1] ?? 0),
            Number(v?.[2] ?? 0)
        ]);

        return {
            envLightingEnabled: true,
            envLightDirection: toVec3(params.lightDirection),
            envLightColor: toVec3(params.lightColor),
            envAmbientColor: toVec3(params.ambientColor)
        };
    }

    private removeMainCacheEntry(fullPath: string) {
        this.modelCache.delete(fullPath);
        const modelBytes = this.modelCacheBytes.get(fullPath) || 0;
        this.modelCacheBytes.delete(fullPath);
        this.modelCacheTotalBytes = Math.max(0, this.modelCacheTotalBytes - modelBytes);
        this.modelReadyStage.delete(fullPath);
        this.textureCache.delete(fullPath);
        this.resourceLoading.delete(fullPath);
        this.textureLoading.delete(fullPath);
    }

    private getDecodeMaxDimension(): number {
        const sharedTextureMB = this.sharedTextureTotalBytes / (1024 * 1024);
        if (sharedTextureMB > 160 || this.textureTaskQueue.length > 10) {
            return 96;
        }
        if (
            sharedTextureMB > 112 ||
            this.textureTaskQueue.length > 4 ||
            this.textureTaskRunning >= this.MAX_TEXTURE_TASK_CONCURRENCY
        ) {
            return 128;
        }
        return 160;
    }

    /**
     * Collect all ArrayBuffer instances from a payload for Transferable postMessage.
     */
    private collectTransferables(payload: Record<string, any>): Transferable[] {
        const buffers: Transferable[] = [];
        // Only transfer textureRawData (cloned copies), never modelBuffer (shared via cache)
        if (payload.textureRawData) {
            for (const buf of Object.values(payload.textureRawData)) {
                if (buf instanceof ArrayBuffer) buffers.push(buf);
            }
        }
        return buffers;
    }

    private touchSharedTextureCache(key: string, image: ImageData | ArrayBuffer) {
        if (this.sharedTextureCache.has(key)) {
            this.sharedTextureCache.delete(key);
            const oldBytes = this.sharedTextureCacheBytes.get(key) || 0;
            this.sharedTextureCacheBytes.delete(key);
            this.sharedTextureTotalBytes = Math.max(0, this.sharedTextureTotalBytes - oldBytes);
        }
        this.sharedTextureCache.set(key, image);
        const newBytes = this.getImageDataBytes(image);
        this.sharedTextureCacheBytes.set(key, newBytes);
        this.sharedTextureTotalBytes += newBytes;

        while (
            this.sharedTextureCache.size > this.SHARED_TEXTURE_CACHE_LIMIT ||
            this.sharedTextureTotalBytes > this.SHARED_TEXTURE_CACHE_MAX_BYTES
        ) {
            const oldestKey = this.sharedTextureCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            this.sharedTextureCache.delete(oldestKey);
            this.sharedTextureLoading.delete(oldestKey);
            const oldestBytes = this.sharedTextureCacheBytes.get(oldestKey) || 0;
            this.sharedTextureCacheBytes.delete(oldestKey);
            this.sharedTextureTotalBytes = Math.max(0, this.sharedTextureTotalBytes - oldestBytes);
        }
    }

    private async withTextureTaskSlot<T>(task: () => Promise<T>, onQueueWait?: (waitMs: number) => void): Promise<T> {
        const waitStart = performance.now();
        if (this.textureTaskRunning >= this.MAX_TEXTURE_TASK_CONCURRENCY) {
            await new Promise<void>((resolve) => {
                this.textureTaskQueue.push(resolve);
            });
        }
        const queueWaitMs = Math.max(0, performance.now() - waitStart);
        if (onQueueWait && queueWaitMs > 0) {
            onQueueWait(queueWaitMs);
        }

        this.textureTaskRunning++;
        try {
            return await task();
        } finally {
            this.textureTaskRunning = Math.max(0, this.textureTaskRunning - 1);
            const next = this.textureTaskQueue.shift();
            if (next) next();
        }
    }

    private toUint8Array(payload: any): Uint8Array | null {
        if (!payload) return null;
        if (payload instanceof Uint8Array) return payload;
        if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
        if (ArrayBuffer.isView(payload)) {
            return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
        }
        if (Array.isArray(payload)) {
            return new Uint8Array(payload);
        }
        if (typeof payload === 'string') {
            try {
                return this.base64ToUint8Array(payload);
            } catch {
                return null;
            }
        }
        return null;
    }

    private parseTextureBytesPayload(payload: any, texturePaths: string[]): Map<string, Uint8Array> {
        const decoded = new Map<string, Uint8Array>();
        const bytes = this.toUint8Array(payload);
        if (!bytes || bytes.byteLength < 4) return decoded;

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = 0;
        const count = view.getUint32(offset, true);
        offset += 4;

        const total = Math.min(count, texturePaths.length);
        for (let i = 0; i < total; i++) {
            if (offset + 5 > bytes.byteLength) break;

            const status = view.getUint8(offset);
            offset += 1;
            const dataLen = view.getUint32(offset, true);
            offset += 4;

            if (dataLen > 0 && offset + dataLen <= bytes.byteLength && status === 1) {
                decoded.set(texturePaths[i], bytes.subarray(offset, offset + dataLen));
            }
            offset += dataLen;
        }

        return decoded;
    }

    private async loadMissingMpqTextures(texturePaths: string[]): Promise<{
        resolved: Map<string, ArrayBuffer>;
        elapsedMs: number;
        decodeMs: number;
    }> {
        const uniquePaths = Array.from(new Set(texturePaths.filter(Boolean)));
        if (uniquePaths.length === 0) {
            return { resolved: new Map(), elapsedMs: 0, decodeMs: 0 };
        }

        const start = performance.now();
        let decodeMs = 0;
        const resolved = new Map<string, ArrayBuffer>();

        try {
            const results = await invoke<Array<string | null>>('read_mpq_files_batch', { paths: uniquePaths });
            uniquePaths.forEach((path, index) => {
                const encoded = results?.[index];
                if (!encoded) return;
                const decoded = this.decodeBase64ToArrayBuffer(encoded);
                decodeMs += decoded.decodeMs;
                resolved.set(path, decoded.buffer);
            });
        } catch {
            // Ignore fallback failures; unresolved textures remain misses.
        }

        return {
            resolved,
            elapsedMs: performance.now() - start,
            decodeMs
        };
    }

    private touchMainCache(fullPath: string, modelInfo: CachedModelInfo, textures?: Record<string, ArrayBuffer>) {
        if (this.modelCache.has(fullPath)) {
            this.modelCache.delete(fullPath);
            const oldBytes = this.modelCacheBytes.get(fullPath) || 0;
            this.modelCacheBytes.delete(fullPath);
            this.modelCacheTotalBytes = Math.max(0, this.modelCacheTotalBytes - oldBytes);
        }
        this.modelCache.set(fullPath, modelInfo);
        const modelBytes = modelInfo.buffer?.byteLength || 0;
        this.modelCacheBytes.set(fullPath, modelBytes);
        this.modelCacheTotalBytes += modelBytes;

        if (textures) {
            if (this.textureCache.has(fullPath)) {
                this.textureCache.delete(fullPath);
            }
            this.textureCache.set(fullPath, textures);
        } else {
            const cachedTextures = this.textureCache.get(fullPath);
            if (cachedTextures) {
                this.textureCache.delete(fullPath);
                this.textureCache.set(fullPath, cachedTextures);
            }
        }

        while (this.modelCache.size > this.MAIN_CACHE_LIMIT) {
            const oldestKey = this.modelCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            this.removeMainCacheEntry(oldestKey);
        }

        while (this.modelCacheTotalBytes > this.MAIN_MODEL_CACHE_MAX_BYTES) {
            const oldestKey = this.modelCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            this.removeMainCacheEntry(oldestKey);
        }
    }

    private async loadModelInfo(fullPath: string): Promise<CachedModelInfo> {
        const cachedModel = this.modelCache.get(fullPath);
        if (cachedModel) {
            this.touchMainCache(fullPath, cachedModel);
            return cachedModel;
        }

        const inflight = this.resourceLoading.get(fullPath);
        if (inflight) {
            return (await inflight).modelInfo;
        }

        const loadPromise = (async (): Promise<CachedResources> => {
            this.markFirstTouch(fullPath);
            const payload = await invoke<Uint8Array>('read_local_files_batch_bin', { paths: [fullPath] });
            const results = this.parseModelBatchBinaryPayload(payload, [fullPath]);
            const result = results[0];
            if (!result?.found || !result.buffer) {
                throw new Error(`Failed to read model file: ${fullPath}`);
            }
            const modelReadMs = result.readMs;
            const modelInfo = this.storeLoadedModelBuffer(
                fullPath,
                result.buffer,
                modelReadMs,
                `read=${modelReadMs.toFixed(1)}ms backend=${result.readMs.toFixed(1)}ms decode=0.0ms bytes=${result.buffer.byteLength} mode=single-bin`
            );
            const textureImages = this.textureCache.get(fullPath) || {};
            return { modelInfo, textureImages };
        })();

        this.resourceLoading.set(fullPath, loadPromise);
        try {
            return (await loadPromise).modelInfo;
        } finally {
            this.resourceLoading.delete(fullPath);
        }
    }

    public async prepareBatchRenderState(): Promise<SharedRenderState> {
        const renderState = useRendererStore.getState();
        const teamColorData = await this.ensureTeamColorsLoaded(renderState.teamColor);
        const envPayload = this.getEnvironmentLightPayload();
        return {
            renderState,
            teamColorData,
            envPayload
        };
    }

    private parseModelMetadata(fullPath: string, buffer: ArrayBuffer): { animations: string[]; texturePaths: string[] } {
        let model: any;
        if (fullPath.toLowerCase().endsWith('.mdl')) {
            model = parseMDL(new TextDecoder().decode(buffer));
        } else {
            model = parseMDX(buffer);
        }

        if (!model) {
            return { animations: [], texturePaths: [] };
        }

        const texturePathSet = new Set<string>();
        if (model.Textures) {
            model.Textures.forEach((texture: any) => {
                if (!texture.Image && texture.Path) {
                    texture.Image = texture.Path;
                }
                if ((!texture.Image || texture.Image === '') && texture.ReplaceableId !== 0) {
                    const replaceablePath = REPLACEABLE_TEXTURES[texture.ReplaceableId];
                    if (replaceablePath !== undefined) {
                        texture.Image = `ReplaceableTextures\\${replaceablePath}.blp`;
                    }
                }
            });

            let textureEntries = model.Textures
                .map((t: any) => ({ path: (t.Image || t.Path) as string }))
                .filter((t: any) => !!t.path);

            textureEntries.forEach((t) => texturePathSet.add(t.path));
        }

        if (model.ParticleEmitters) {
            model.ParticleEmitters.forEach((emitter: any) => {
                if (emitter.FileName && typeof emitter.FileName === 'string') {
                    texturePathSet.add(emitter.FileName);
                }
            });
        }

        if (model.ParticleEmitters2) {
            model.ParticleEmitters2.forEach((emitter: any) => {
                if (emitter.ReplaceableId > 0 && (emitter.TextureID === -1 || emitter.TextureID === undefined)) {
                    const replaceablePath = REPLACEABLE_TEXTURES[emitter.ReplaceableId];
                    if (replaceablePath !== undefined) {
                        texturePathSet.add(`ReplaceableTextures\\${replaceablePath}.blp`);
                    }
                }
            });
        }

        return {
            animations: model.Sequences ? model.Sequences.map((s: any) => s.Name || 'Unnamed') : [],
            texturePaths: Array.from(texturePathSet)
        };
    }

    private async loadTextureImages(fullPath: string, texturePaths: string[]): Promise<Record<string, ArrayBuffer>> {
        const uniqueTexturePaths = Array.from(new Set(texturePaths.filter(Boolean)));
        const cached = this.textureCache.get(fullPath);
        if (uniqueTexturePaths.length === 0) {
            if (cached) {
                return cached;
            }
            this.recordModelPerf(fullPath, {
                textureCount: 0,
                textureResolvedCount: 0,
                textureSharedHitCount: 0,
                textureMissCount: 0,
                textureBatchLoadMs: 0,
                textureBatchMpqLoadMs: 0,
                textureBatchFsLoadMs: 0,
                textureQueueWaitMs: 0,
                textureDecodeMs: 0,
                textureFallbackLoadMs: 0,
                textureTotalMs: 0
            });
            return {};
        }

        if (cached && uniqueTexturePaths.every((path) => !!cached[path])) {
            return cached;
        }
        if (cached && Object.keys(cached).length === 0) {
            this.textureCache.delete(fullPath);
        }

        const inflight = this.textureLoading.get(fullPath);
        if (inflight) {
            return inflight;
        }

        const loadPromise = (async () => {
            const metrics: TextureLoadMetrics = {
                textureCount: uniqueTexturePaths.length,
                resolvedCount: 0,
                sharedHitCount: 0,
                missCount: 0,
                batchLoadMs: 0,
                batchMpqLoadMs: 0,
                batchFsLoadMs: 0,
                queueWaitMs: 0,
                decodeMs: 0,
                fallbackLoadMs: 0,
                totalMs: 0
            };
            const totalStart = performance.now();
            const textureImages: Record<string, ArrayBuffer> = cached ? { ...cached } : {};
            metrics.resolvedCount = Object.keys(textureImages).length;
            const pendingSharedPromises: Promise<void>[] = [];
            const loadTargets: string[] = [];
            const keyByPath = new Map<string, string>();
            const resolverByKey = new Map<string, (value: ArrayBuffer | null) => void>();

            uniqueTexturePaths.forEach((path) => {
                const key = this.getTextureCacheKey(fullPath, path);
                keyByPath.set(path, key);

                if (textureImages[path]) {
                    return;
                }

                const sharedCached = this.sharedTextureCache.get(key);
                if (sharedCached) {
                    this.touchSharedTextureCache(key, sharedCached);
                    textureImages[path] = sharedCached;
                    metrics.sharedHitCount += 1;
                    metrics.resolvedCount += 1;
                    return;
                }

                const loadingPromise = this.sharedTextureLoading.get(key);
                if (loadingPromise) {
                    pendingSharedPromises.push(
                        loadingPromise.then((image) => {
                            if (image) {
                                textureImages[path] = image;
                                metrics.resolvedCount += 1;
                            }
                        })
                    );
                    return;
                }

                loadTargets.push(path);
                const pending = new Promise<ArrayBuffer | null>((resolve) => {
                    resolverByKey.set(key, resolve);
                });
                this.sharedTextureLoading.set(key, pending);
            });

            try {
                if (loadTargets.length > 0) {
                    await this.withTextureTaskSlot(async () => {
                        const processRawBinaryMap = (targets: string[], rawBinaryMap: Map<string, Uint8Array>) => {
                            const unresolvedPaths: string[] = [];
                            for (const path of targets) {
                                const data = rawBinaryMap.get(path);
                                if (!data || data.byteLength === 0) {
                                    unresolvedPaths.push(path);
                                    continue;
                                }
                                // Store raw bytes — worker will decode
                                const buffer = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
                                    ? data.buffer
                                    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                                textureImages[path] = buffer;
                                metrics.resolvedCount += 1;
                                const key = keyByPath.get(path)!;
                                // Clone for shared cache (originals will be transferred to worker)
                                this.touchSharedTextureCache(key, buffer.slice(0));
                                resolverByKey.get(key)?.(buffer.slice(0));
                            }
                            return unresolvedPaths;
                        };

                        const fsBatchStart = performance.now();
                        try {
                            const payload = await invoke<Uint8Array>('load_textures_batch_bin', {
                                modelPath: fullPath,
                                texturePaths: loadTargets
                            });
                            const rawBinaryMap = this.parseTextureBytesPayload(payload, loadTargets);
                            const unresolvedPaths = processRawBinaryMap(loadTargets, rawBinaryMap);
                            if (unresolvedPaths.length > 0) {
                                const fallback = await this.loadMissingMpqTextures(unresolvedPaths);
                                metrics.batchMpqLoadMs += fallback.elapsedMs;
                                metrics.batchLoadMs += fallback.elapsedMs;
                                metrics.decodeMs += fallback.decodeMs;
                                for (const path of unresolvedPaths) {
                                    const key = keyByPath.get(path)!;
                                    const buffer = fallback.resolved.get(path);
                                    if (buffer && buffer.byteLength > 0) {
                                        textureImages[path] = buffer;
                                        metrics.resolvedCount += 1;
                                        this.touchSharedTextureCache(key, buffer.slice(0));
                                        resolverByKey.get(key)?.(buffer.slice(0));
                                    } else {
                                        metrics.missCount += 1;
                                        resolverByKey.get(key)?.(null);
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('[ThumbnailService] Binary batch texture load failed:', err);
                            for (const path of loadTargets) {
                                const key = keyByPath.get(path)!;
                                metrics.missCount += 1;
                                resolverByKey.get(key)?.(null);
                            }
                        } finally {
                            const elapsed = performance.now() - fsBatchStart;
                            metrics.batchFsLoadMs += elapsed;
                            metrics.batchLoadMs += elapsed;
                        }
                    }, (waitMs) => {
                        metrics.queueWaitMs += waitMs;
                    });
                }

                if (pendingSharedPromises.length > 0) {
                    await Promise.all(pendingSharedPromises);
                }
            } finally {
                for (const [key, resolve] of resolverByKey) {
                    if (!this.sharedTextureCache.has(key)) {
                        resolve(null);
                    }
                    this.sharedTextureLoading.delete(key);
                }
            }

            metrics.totalMs = performance.now() - totalStart;

            this.textureCache.set(fullPath, textureImages);
            this.recordModelPerf(fullPath, {
                textureCount: metrics.textureCount,
                textureResolvedCount: metrics.resolvedCount,
                textureSharedHitCount: metrics.sharedHitCount,
                textureMissCount: metrics.missCount,
                textureBatchLoadMs: metrics.batchLoadMs,
                textureBatchMpqLoadMs: metrics.batchMpqLoadMs,
                textureBatchFsLoadMs: metrics.batchFsLoadMs,
                textureQueueWaitMs: metrics.queueWaitMs,
                textureDecodeMs: metrics.decodeMs,
                textureFallbackLoadMs: metrics.fallbackLoadMs,
                textureTotalMs: metrics.totalMs
            });
            this.logPerfStageOnce(
                fullPath,
                'textures',
                `textures=${metrics.totalMs.toFixed(1)}ms resolved=${metrics.resolvedCount}/${metrics.textureCount} shared=${metrics.sharedHitCount} miss=${metrics.missCount} batch=${metrics.batchLoadMs.toFixed(1)}ms decode=${metrics.decodeMs.toFixed(1)}ms queue=${metrics.queueWaitMs.toFixed(1)}ms`
            );

            if (uniqueTexturePaths.every((path) => !!textureImages[path])) {
                this.modelReadyStage.set(fullPath, 'textures-ready');
            } else {
                this.modelReadyStage.set(fullPath, 'manifest-ready');
            }

            return textureImages;
        })();

        this.textureLoading.set(fullPath, loadPromise);
        try {
            return await loadPromise;
        } finally {
            this.textureLoading.delete(fullPath);
        }
    }

    public async prefetch(
        fullPaths: string[],
        maxConcurrent: number = 4,
        options?: { withTextures?: boolean }
    ): Promise<void> {
        const unique = Array.from(new Set(fullPaths.filter(Boolean)));
        if (unique.length === 0) return;
        await this.loadModelInfoBatch(unique);
        await this.loadModelMetadataBatch(unique);
        for (const fullPath of unique) {
            const modelInfo = this.modelCache.get(fullPath);
            if (modelInfo && (modelInfo.animations.length === 0 || modelInfo.texturePaths.length === 0)) {
                this.ensureModelMetadata(fullPath, modelInfo);
            }
        }
        const warmTexturesPromise = options?.withTextures
            ? this.warmPageTextures(unique)
            : Promise.resolve();

        const preloadBudget = this.getBatchPreloadLimit(unique.length);
        if (preloadBudget <= 0) {
            await warmTexturesPromise;
            return;
        }

        const strictPaths: string[] = [];
        const nonStrictPaths: string[] = [];
        for (const fullPath of unique) {
            const texturePaths = this.modelCache.get(fullPath)?.texturePaths || [];
            if (options?.withTextures && this.requiresStrictTextureInit(texturePaths)) {
                strictPaths.push(fullPath);
            } else {
                nonStrictPaths.push(fullPath);
            }
        }

        const preloadTargets = strictPaths.concat(
            nonStrictPaths.slice(0, Math.max(0, preloadBudget - strictPaths.length))
        );
        if (preloadTargets.length === 0) {
            await warmTexturesPromise;
            return;
        }

        const concurrency = Math.max(1, Math.min(Math.max(maxConcurrent, this.workerCount), preloadTargets.length));
        let cursor = 0;
        const preloadTasks: Promise<void>[] = [];

        const worker = async () => {
            while (cursor < preloadTargets.length) {
                const index = cursor++;
                const fullPath = preloadTargets[index];
                try {
                    const modelInfo = await this.loadModelInfo(fullPath);
                    const requiresStrictWarmup = !!options?.withTextures && this.requiresStrictTextureInit(modelInfo.texturePaths || []);
                    const preloadTask = (async () => {
                        if (requiresStrictWarmup) {
                            await warmTexturesPromise;
                        }
                        await this.preloadModelToWorker(fullPath, modelInfo);
                    })();
                    preloadTasks.push(preloadTask);
                } catch {
                    // Ignore prefetch failures; render path has its own error handling.
                }
            }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        await warmTexturesPromise;
        if (preloadTasks.length > 0) {
            await Promise.all(preloadTasks);
        }
    }

    /**
     * Renders a frame by delegating to the worker
     */
    public async renderFrame(
        fullPath: string,
        frame: number = 0,
        sequenceIndex: number = 0,
        freeze: boolean = false,
        options?: {
            preferFastFirstFrame?: boolean;
            prioritize?: boolean;
            spinEnabled?: boolean;
            spinSpeed?: number;
        }
    ): Promise<RenderResult> {
        if (this.callbacks.has(fullPath)) return { bitmap: null as any, status: 'busy' };
        const workerIndex = this.getAvailableWorkerIndex(fullPath, {
            allowFallback: !!options?.prioritize
        });
        if (workerIndex === -1) return { bitmap: null as any, status: 'busy' };
        const sharedState = await this.prepareBatchRenderState();
        return this.renderFrameWithSharedState(fullPath, frame, sequenceIndex, freeze, options, sharedState, workerIndex);
    }

    public async renderFrameWithSharedState(
        fullPath: string,
        frame: number = 0,
        sequenceIndex: number = 0,
        freeze: boolean = false,
        options?: {
            preferFastFirstFrame?: boolean;
            prioritize?: boolean;
            spinEnabled?: boolean;
            spinSpeed?: number;
        },
        sharedState?: SharedRenderState,
        preselectedWorkerIndex?: number
    ): Promise<RenderResult> {
        if (this.callbacks.has(fullPath)) return { bitmap: null as any, status: 'busy' };
        const workerIndex = preselectedWorkerIndex ?? this.getAvailableWorkerIndex(fullPath, {
            allowFallback: !!options?.prioritize
        });
        if (workerIndex === -1) return { bitmap: null as any, status: 'busy' };
        const preparedState = sharedState ?? await this.prepareBatchRenderState();
        const { renderState, teamColorData, envPayload } = preparedState;

        this.workerBusy[workerIndex] = true;

        // Safety Timeout (10 seconds)
        this.workerTimeouts[workerIndex] = setTimeout(() => {
            console.warn(`[ThumbnailService] Worker ${workerIndex} timed out on ${fullPath}. Resetting.`);
            this.workerBusy[workerIndex] = false;
            this.renderRequestMetrics.delete(fullPath);
            this.clearFirstTouch(fullPath);
            const cb = this.callbacks.get(fullPath);
            if (cb) {
                cb({ bitmap: null as any, status: 'error' });
                this.callbacks.delete(fullPath);
            }
        }, 10000);

        try {
            const requestStartMs = performance.now();
            const worker = this.workers[workerIndex];
            const generation = this.pageGenerationByPath.get(fullPath) ?? this.activeBatchGeneration;
            const isLoaded = this.workerModelCache[workerIndex].includes(fullPath);
            let modelInfo = this.modelCache.get(fullPath);
            const texturesCached = this.textureCache.get(fullPath);
            let textureImages = texturesCached || {};
            const alreadyTextureSynced = this.workerTextureSync[workerIndex].has(fullPath);
            const sharedTextureSync = this.workerSharedTextureSync[workerIndex];
            const syncedTeamColor = this.workerTeamColorSync[workerIndex].get(fullPath);
            const teamColorChangedForWorker = syncedTeamColor !== renderState.teamColor;
            const renderPayload = {
                backgroundColor: renderState.backgroundColor,
                teamColor: renderState.teamColor,
                enableLighting: renderState.enableLighting,
                wireframe: renderState.renderMode === 'wireframe',
                showParticles: renderState.showParticles ?? true,
                showRibbons: renderState.showRibbons ?? true,
                spinEnabled: options?.spinEnabled ?? false,
                spinSpeed: options?.spinSpeed ?? 30,
                renderSize: this.getBatchRenderSize(),
                ...envPayload
            };

            const needsTexturePreparation = !texturesCached && !alreadyTextureSynced;
            if (!isLoaded || !modelInfo || needsTexturePreparation) {
                modelInfo = await this.loadModelInfo(fullPath);
            }
            if (modelInfo && (modelInfo.texturePaths.length === 0 || modelInfo.animations.length === 0)) {
                modelInfo = await this.ensureModelMetadataReady(fullPath, modelInfo);
            }
            const texturePaths = modelInfo?.texturePaths || [];
            const hasAllCachedTextures = texturePaths.length === 0 || texturePaths.every((path) => !!textureImages[path]);
            const textureSyncKeys = this.getTextureSyncKeys(fullPath, texturePaths);
            const allTexturesAlreadyShared = textureSyncKeys.length > 0 && textureSyncKeys.every((key) => sharedTextureSync.has(key));
            const requiresTeamColorRefresh = this.usesReplaceableTeamTextures(texturePaths);
            const readyStage = this.modelReadyStage.get(fullPath);
            if (allTexturesAlreadyShared && hasAllCachedTextures) {
                this.workerTextureSync[workerIndex].add(fullPath);
            }

            if ((!hasAllCachedTextures) && !alreadyTextureSynced) {
                if (texturePaths.length > 0) {
                    textureImages = await this.loadTextureImages(fullPath, texturePaths);
                }
            } else if (texturePaths.length > 0 && readyStage !== 'textures-ready') {
                textureImages = await this.loadTextureImages(fullPath, texturePaths);
            }

            const unsyncedTextureImages = Object.keys(textureImages).length > 0
                ? Object.fromEntries(Object.entries(textureImages).filter(([path]) => !sharedTextureSync.has(this.getTextureCacheKey(fullPath, path))))
                : {};
            const includeTexturePayload = Object.keys(unsyncedTextureImages).length > 0 && (!this.workerTextureSync[workerIndex].has(fullPath) || !allTexturesAlreadyShared);
            const includeTeamColorPayload = Object.keys(teamColorData).length > 0 && (teamColorChangedForWorker || !isLoaded || requiresTeamColorRefresh);
            const prepareMs = Math.max(0, performance.now() - requestStartMs);

            // 2. Send to Available Worker
            return new Promise((resolve) => {
                this.callbacks.set(fullPath, resolve);
                this.renderRequestGeneration.set(fullPath, generation);
                this.renderRequestMetrics.set(fullPath, {
                    requestStartMs,
                    prepareMs
                });

                if (isLoaded) {
                    if (includeTexturePayload) {
                        this.workerTextureSync[workerIndex].add(fullPath);
                    } else if (allTexturesAlreadyShared) {
                        this.workerTextureSync[workerIndex].add(fullPath);
                    }
                    // Clone textureRawData for Transferable (originals stay in textureCache)
                    const clonedTexPayload = includeTexturePayload
                        ? Object.fromEntries(Object.entries(unsyncedTextureImages).map(([k, v]) => [k, v instanceof ArrayBuffer ? v.slice(0) : v]))
                        : undefined;
                    const msg1 = {
                        type: 'RENDER',
                        payload: {
                            fullPath,
                            ...(clonedTexPayload ? { textureRawData: clonedTexPayload, textureMaxDimension: this.getDecodeMaxDimension() } : {}),
                            ...(includeTeamColorPayload ? { teamColorData } : {}),
                            generation,
                            frame,
                            sequenceIndex,
                            freeze,
                            ...renderPayload
                        }
                    };
                    const xfer1 = this.collectTransferables(msg1.payload);
                    worker.postMessage(msg1, xfer1);
                    if (includeTexturePayload) {
                        this.getTextureSyncKeys(fullPath, Object.keys(unsyncedTextureImages)).forEach((key) => sharedTextureSync.add(key));
                    }
                    if (includeTeamColorPayload) {
                        this.workerTeamColorSync[workerIndex].set(fullPath, renderState.teamColor);
                    }
                } else {
                    // Initial full payload — clone textureRawData for Transferable
                    const clonedTexPayload2 = includeTexturePayload
                        ? Object.fromEntries(Object.entries(unsyncedTextureImages).map(([k, v]) => [k, v instanceof ArrayBuffer ? v.slice(0) : v]))
                        : undefined;
                    const payloadData = {
                        fullPath,
                        modelBuffer: modelInfo!.buffer,
                        ...(clonedTexPayload2 ? { textureRawData: clonedTexPayload2, textureMaxDimension: this.getDecodeMaxDimension() } : {}),
                        ...(includeTeamColorPayload ? { teamColorData } : {}),
                        generation,
                        frame,
                        sequenceIndex,
                        freeze,
                        ...renderPayload
                    };

                    const msg2 = { type: 'RENDER', payload: payloadData };
                    const xfer2 = this.collectTransferables(payloadData);
                    worker.postMessage(msg2, xfer2);

                    if (includeTexturePayload) {
                        this.workerTextureSync[workerIndex].add(fullPath);
                        this.getTextureSyncKeys(fullPath, Object.keys(unsyncedTextureImages)).forEach((key) => sharedTextureSync.add(key));
                    } else if (allTexturesAlreadyShared) {
                        this.workerTextureSync[workerIndex].add(fullPath);
                    } else {
                        this.workerTextureSync[workerIndex].delete(fullPath);
                    }
                    if (includeTeamColorPayload) {
                        this.workerTeamColorSync[workerIndex].set(fullPath, renderState.teamColor);
                    }
                }
            });

        } catch (err) {
            console.error('[ThumbnailService] Preparation failed:', err);
            this.renderRequestMetrics.delete(fullPath);
            this.clearFirstTouch(fullPath);
            this.workerBusy[workerIndex] = false;
            return { bitmap: null as any, status: 'error' };
        }
    }

    public getCachedAnimations(fullPath: string): string[] | null {
        return this.modelCache.get(fullPath)?.animations || null;
    }

    public getMissingTextureCount(fullPath: string): number {
        return this.modelPerf.get(fullPath)?.textureMissCount || 0;
    }

    public getWorkerStats(): { busy: number; total: number } {
        const busy = this.workerBusy.reduce((sum, cur) => sum + (cur ? 1 : 0), 0);
        return { busy, total: this.workerCount };
    }

    public pruneToActiveSet(activePaths: string[]) {
        const keepSet = new Set(activePaths.filter(Boolean));
        if (keepSet.size === 0) return;
        this.activeBatchGeneration += 1;
        this.activeBatchPaths = keepSet;
        this.pageGenerationByPath.clear();
        keepSet.forEach((path) => this.pageGenerationByPath.set(path, this.activeBatchGeneration));

        const reserveCount = Math.max(24, keepSet.size * 2);
        const keys = Array.from(this.modelCache.keys());
        for (const key of keys) {
            if (this.modelCache.size <= reserveCount && this.modelCacheTotalBytes <= this.MAIN_MODEL_CACHE_MAX_BYTES) {
                break;
            }
            if (!keepSet.has(key)) {
                this.removeMainCacheEntry(key);
            }
        }

        const keepPaths = Array.from(keepSet);
        for (const path of Array.from(this.modelWorkerAffinity.keys())) {
            if (!keepSet.has(path)) {
                this.modelWorkerAffinity.delete(path);
            }
        }
        for (let i = 0; i < this.workerCount; i++) {
            this.workerModelCache[i] = this.workerModelCache[i].filter((path) => keepSet.has(path));
            this.rebuildWorkerTextureSyncState(i);
            for (const path of Array.from(this.workerTeamColorSync[i].keys())) {
                if (!keepSet.has(path)) {
                    this.workerTeamColorSync[i].delete(path);
                }
            }
            this.workers[i].postMessage({
                type: 'PRUNE',
                payload: { keepPaths }
            });
        }
    }

    public getPerfSnapshot() {
        const worker = this.getWorkerStats();
        const records = Array.from(this.modelPerf.values());

        const sum = records.reduce((acc, rec) => {
            acc.modelReadMs += rec.modelReadMs;
            acc.modelParseMs += rec.modelParseMs;
            acc.textureTotalMs += rec.textureTotalMs;
            acc.textureBatchLoadMs += rec.textureBatchLoadMs;
            acc.textureBatchMpqLoadMs += rec.textureBatchMpqLoadMs;
            acc.textureBatchFsLoadMs += rec.textureBatchFsLoadMs;
            acc.textureQueueWaitMs += rec.textureQueueWaitMs;
            acc.textureDecodeMs += rec.textureDecodeMs;
            acc.textureFallbackLoadMs += rec.textureFallbackLoadMs;
            acc.prepareMs += rec.prepareMs;
            acc.workerRenderMs += rec.workerRenderMs;
            acc.endToEndMs += rec.endToEndMs;
            acc.modelTotalLoadMs += this.getModelTotalLoadMs(rec);
            acc.textureCount += rec.textureCount;
            acc.textureResolvedCount += rec.textureResolvedCount;
            acc.textureSharedHitCount += rec.textureSharedHitCount;
            acc.textureMissCount += rec.textureMissCount;
            return acc;
        }, {
            modelReadMs: 0,
            modelParseMs: 0,
            textureTotalMs: 0,
            textureBatchLoadMs: 0,
            textureBatchMpqLoadMs: 0,
            textureBatchFsLoadMs: 0,
            textureQueueWaitMs: 0,
            textureDecodeMs: 0,
            textureFallbackLoadMs: 0,
            prepareMs: 0,
            workerRenderMs: 0,
            endToEndMs: 0,
            modelTotalLoadMs: 0,
            textureCount: 0,
            textureResolvedCount: 0,
            textureSharedHitCount: 0,
            textureMissCount: 0
        });

        const recordCount = Math.max(1, records.length);
        const avgModelReadMs = sum.modelReadMs / recordCount;
        const avgModelParseMs = sum.modelParseMs / recordCount;
        const avgTextureMs = sum.textureTotalMs / recordCount;
        const avgTextureBatchMs = sum.textureBatchLoadMs / recordCount;
        const avgTextureBatchMpqMs = sum.textureBatchMpqLoadMs / recordCount;
        const avgTextureBatchFsMs = sum.textureBatchFsLoadMs / recordCount;
        const avgTextureQueueMs = sum.textureQueueWaitMs / recordCount;
        const avgTextureDecodeMs = sum.textureDecodeMs / recordCount;
        const avgTextureFallbackMs = sum.textureFallbackLoadMs / recordCount;
        const avgPrepareMs = sum.prepareMs / recordCount;
        const avgWorkerRenderMs = sum.workerRenderMs / recordCount;
        const avgEndToEndMs = sum.endToEndMs / recordCount;
        const avgModelTotalLoadMs = sum.modelTotalLoadMs / recordCount;

        const textureLoadBase = Math.max(1e-6, avgModelReadMs + avgModelParseMs + avgTextureMs);
        const textureLoadRatioPct = (avgTextureMs / textureLoadBase) * 100;
        const textureCoveragePct = sum.textureCount > 0 ? (sum.textureResolvedCount / Math.max(1, sum.textureCount)) * 100 : 100;
        const sharedTextureHitRatePct = sum.textureCount > 0 ? (sum.textureSharedHitCount / Math.max(1, sum.textureCount)) * 100 : 0;

        let hotspotModelName = '';
        let hotspotStage: 'texture' | 'parse' | 'read' | 'worker' | 'none' = 'none';
        let hotspotMs = 0;
        if (records.length > 0) {
            const hotspot = [...records].sort((a, b) => b.endToEndMs - a.endToEndMs)[0];
            hotspotModelName = hotspot.fileName;
            const candidates: Array<{ stage: 'texture' | 'parse' | 'read' | 'worker'; value: number }> = [
                { stage: 'texture', value: hotspot.textureTotalMs },
                { stage: 'parse', value: hotspot.modelParseMs },
                { stage: 'read', value: hotspot.modelReadMs },
                { stage: 'worker', value: hotspot.workerRenderMs }
            ];
            const top = candidates.sort((a, b) => b.value - a.value)[0];
            hotspotStage = top?.stage ?? 'none';
            hotspotMs = top?.value ?? 0;
        }

        return {
            workersBusy: worker.busy,
            workersTotal: worker.total,
            modelCache: this.modelCache.size,
            modelCacheBytesMB: this.modelCacheTotalBytes / (1024 * 1024),
            textureCache: this.textureCache.size,
            sharedTextureCache: this.sharedTextureCache.size,
            sharedTextureCacheBytesMB: this.sharedTextureTotalBytes / (1024 * 1024),
            modelLoading: this.resourceLoading.size,
            textureLoading: this.textureLoading.size,
            textureTaskRunning: this.textureTaskRunning,
            textureTaskPending: this.textureTaskQueue.length,
            decodeDimension: this.getDecodeMaxDimension(),
            avgModelReadMs,
            avgModelParseMs,
            avgTextureMs,
            avgTextureBatchMs,
            avgTextureBatchMpqMs,
            avgTextureBatchFsMs,
            avgTextureQueueMs,
            avgTextureDecodeMs,
            avgTextureFallbackMs,
            avgPrepareMs,
            avgWorkerRenderMs,
            avgEndToEndMs,
            avgModelTotalLoadMs,
            textureLoadRatioPct,
            textureCoveragePct,
            sharedTextureHitRatePct,
            hotspotModelName,
            hotspotStage,
            hotspotMs
        };
    }

    public exportPerfLog(activePaths?: string[]) {
        const activeSet = activePaths && activePaths.length > 0 ? new Set(activePaths) : null;
        const records = Array.from(this.modelPerf.values())
            .filter((record) => !activeSet || activeSet.has(record.fullPath))
            .map((record) => {
                const modelTotalLoadMs = this.getModelTotalLoadMs(record);
                const stages: Array<{ stage: string; value: number }> = [
                    { stage: 'read', value: record.modelReadMs },
                    { stage: 'parse', value: record.modelParseMs },
                    { stage: 'texture', value: record.textureTotalMs },
                    { stage: 'prepare', value: record.prepareMs },
                    { stage: 'draw', value: record.workerDrawMs },
                    { stage: 'transfer', value: record.workerTransferMs }
                ];
                const topStage = stages.sort((a, b) => b.value - a.value)[0] || { stage: 'unknown', value: 0 };
                return {
                    ...record,
                    modelTotalLoadMs,
                    suspectedBottleneckStage: topStage.stage,
                    suspectedBottleneckMs: topStage.value
                };
            })
            .sort((a, b) => b.endToEndMs - a.endToEndMs);

        const count = Math.max(1, records.length);
        const summary = records.reduce((acc, record) => {
            acc.modelReadMs += record.modelReadMs;
            acc.modelParseMs += record.modelParseMs;
            acc.textureTotalMs += record.textureTotalMs;
            acc.prepareMs += record.prepareMs;
            acc.workerDrawMs += record.workerDrawMs;
            acc.workerTransferMs += record.workerTransferMs;
            acc.endToEndMs += record.endToEndMs;
            acc.modelTotalLoadMs += record.modelTotalLoadMs;
            return acc;
        }, {
            modelReadMs: 0,
            modelParseMs: 0,
            textureTotalMs: 0,
            prepareMs: 0,
            workerDrawMs: 0,
            workerTransferMs: 0,
            endToEndMs: 0,
            modelTotalLoadMs: 0
        });

        return {
            generatedAt: new Date().toISOString(),
            activePathsCount: activeSet?.size ?? records.length,
            summary: {
                count: records.length,
                avgModelReadMs: summary.modelReadMs / count,
                avgModelParseMs: summary.modelParseMs / count,
                avgTextureMs: summary.textureTotalMs / count,
                avgPrepareMs: summary.prepareMs / count,
                avgWorkerDrawMs: summary.workerDrawMs / count,
                avgWorkerTransferMs: summary.workerTransferMs / count,
                avgEndToEndMs: summary.endToEndMs / count,
                avgModelTotalLoadMs: summary.modelTotalLoadMs / count
            },
            snapshot: this.getPerfSnapshot(),
            records
        };
    }

    public clearAll() {
        this.activeBatchPaths.clear();
        this.activeBatchGeneration = 0;
        this.pageGenerationByPath.clear();
        this.modelCache.clear();
        this.modelCacheBytes.clear();
        this.modelCacheTotalBytes = 0;
        this.textureCache.clear();
        this.resourceLoading.clear();
        this.textureLoading.clear();
        this.sharedTextureCache.clear();
        this.sharedTextureCacheBytes.clear();
        this.sharedTextureTotalBytes = 0;
        this.sharedTextureLoading.clear();
        this.textureTaskQueue = [];
        this.textureTaskRunning = 0;
        this.teamColorData = {};
        this.teamColorDataByIndex.clear();
        this.teamColorsLoadingByIndex.clear();
        this.modelReadyStage.clear();
        this.modelPerf.clear();
        this.renderRequestMetrics.clear();
        this.firstTouchMetrics.clear();
        this.renderRequestGeneration.clear();
        this.preloadRequestGeneration.clear();
        this.metadataRequestGeneration.clear();
        this.metadataCallbacks.clear();
        this.metadataLoading.clear();
        this.modelWorkerAffinity.clear();
        this.perfLoggedStages.clear();
        this.workerModelCache.forEach((_, i) => this.workerModelCache[i] = []);
        this.workerTextureSync.forEach(set => set.clear());
        this.workerSharedTextureSync.forEach(set => set.clear());
        this.workerTeamColorSync.forEach(map => map.clear());
        this.workerBusy.fill(false);
        // Also clear workers' internal renderer cache
        this.workers.forEach(worker => worker.postMessage({ type: 'CLEAR' }));
    }
}

export const thumbnailService = new ThumbnailService();


