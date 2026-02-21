/**
 * ThumbnailService - Manages background thumbnail rendering via Web Workers
 * 
 * Provides absolute isolation from the main thread's WebGL state.
 */

// @ts-ignore
import { parseMDX, parseMDL, decodeBLP, getBLPImageData } from 'war3-model';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { decodeTexture, decodeTextureData, REPLACEABLE_TEXTURES, isMPQPath, normalizePath } from '../viewer/textureLoader';
import { useRendererStore } from '../../store/rendererStore';

// We import the worker using Vite's ?worker suffix
// @ts-ignore
import ThumbnailWorker from './thumbnail.worker?worker';

export interface RenderResult {
    bitmap: ImageBitmap;
    animations?: string[];
    status?: 'success' | 'busy' | 'error';
}

interface CachedModelInfo {
    buffer: ArrayBuffer;
    animations: string[];
    texturePaths: string[];
}

interface CachedResources {
    modelInfo: CachedModelInfo;
    textureImages: Record<string, ImageData>;
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
    endToEndMs: number;
    lastUpdated: number;
}

interface RenderRequestMetric {
    requestStartMs: number;
    prepareMs: number;
}

interface WorkerDonePayload {
    fullPath: string;
    bitmap: ImageBitmap;
    animations?: string[];
    texturePaths?: string[];
    metrics?: {
        renderMs?: number;
        coldStartMs?: number;
        parseMs?: number;
        drawMs?: number;
    };
}

const MAX_BATCH_TEXTURES = 16;

class ThumbnailService {
    private workers: Worker[] = [];
    private workerBusy: boolean[] = [];
    private callbacks: Map<string, (res: RenderResult) => void> = new Map();
    private modelCache: Map<string, CachedModelInfo> = new Map();
    private textureCache: Map<string, Record<string, ImageData>> = new Map();
    private resourceLoading: Map<string, Promise<CachedResources>> = new Map();
    private textureLoading: Map<string, Promise<Record<string, ImageData>>> = new Map();
    private sharedTextureCache: Map<string, ImageData> = new Map();
    private sharedTextureLoading: Map<string, Promise<ImageData | null>> = new Map();
    private textureTaskQueue: Array<() => void> = [];
    private textureTaskRunning = 0;
    private readonly MAX_TEXTURE_TASK_CONCURRENCY = Math.max(3, Math.min(4, Math.floor((typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 8) / 3)));
    private workerModelCache: string[][] = []; // Per-worker LRU cache (array of paths)
    private workerTextureSync: Set<string>[] = [];
    private workerCount = 12;
    private readonly MAIN_CACHE_LIMIT = 100; // Main thread cache limit
    private teamColorData: Record<number, ImageData> = {};
    private teamColorsLoaded = false;
    private teamColorsLoading: Promise<void> | null = null;
    private workerTimeouts: (ReturnType<typeof setTimeout> | null)[] = [];
    private readonly CACHE_LIMIT = 64; // Increased limit for robust paging
    private readonly SHARED_TEXTURE_CACHE_LIMIT = 512;
    private modelPerf: Map<string, ModelPerfRecord> = new Map();
    private readonly MODEL_PERF_LIMIT = 800;
    private renderRequestMetrics: Map<string, RenderRequestMetric> = new Map();

    constructor() {
        useRendererStore.subscribe((state) => {
            if (state.mpqLoaded) {
                void this.ensureTeamColorsLoaded();
            }
        });
        for (let i = 0; i < this.workerCount; i++) {
            const worker = new ThumbnailWorker();
            this.workers.push(worker);
            this.workerBusy.push(false);
            this.workerModelCache.push([]);
            this.workerTextureSync.push(new Set());
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
                    const { fullPath, bitmap, animations, texturePaths, metrics } = payload as WorkerDonePayload;
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

                        if ((!this.textureCache.has(fullPath) || Object.keys(this.textureCache.get(fullPath) || {}).length === 0) && nextTexturePaths.length > 0) {
                            void this.loadTextureImages(fullPath, nextTexturePaths);
                        }
                    }

                    const requestMetrics = this.renderRequestMetrics.get(fullPath);
                    if (requestMetrics) {
                        const endToEndMs = Math.max(0, performance.now() - requestMetrics.requestStartMs);
                        this.renderRequestMetrics.delete(fullPath);
                        this.recordModelPerf(fullPath, {
                            prepareMs: requestMetrics.prepareMs,
                            workerRenderMs: metrics?.renderMs ?? 0,
                            workerColdStartMs: metrics?.coldStartMs ?? 0,
                            modelParseMs: Math.max(metrics?.parseMs ?? 0, this.getOrCreateModelPerf(fullPath).modelParseMs),
                            workerDrawMs: metrics?.drawMs ?? 0,
                            endToEndMs
                        });
                    }
                    const cb = this.callbacks.get(fullPath);
                    if (cb) {
                        cb({ bitmap, animations, status: 'success' });
                        this.callbacks.delete(fullPath);
                    }

                    // Update LRU: Move to end (most recent)
                    const cache = this.workerModelCache[i];
                    const idx = cache.indexOf(fullPath);
                    if (idx > -1) cache.splice(idx, 1);
                    cache.push(fullPath);
                    if (cache.length > this.CACHE_LIMIT) {
                        cache.shift(); // Remove oldest
                    }

                    this.workerBusy[i] = false;
                }
                else if (type === 'ERROR') {
                    const { fullPath, error } = payload;
                    this.renderRequestMetrics.delete(fullPath);

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
                            worker.postMessage({
                                type: 'RENDER',
                                payload: {
                                    fullPath,
                                    modelBuffer: modelInfo.buffer,
                                    ...(textureImages ? { textureImages } : {}),
                                    teamColorData: this.teamColorData,
                                    frame: 0,
                                    sequenceIndex: 0
                                }
                            });
                            if (textureImages && Object.keys(textureImages).length > 0) {
                                this.workerTextureSync[i].add(fullPath);
                            } else {
                                this.workerTextureSync[i].delete(fullPath);
                            }
                            // Don't clear callback or reset busy yet, we are retrying
                            return;
                        }
                    }

                    console.warn(`[ThumbnailService] Worker ${i} reported error for ${fullPath}:`, error);
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
                }
            };
        }
    }

    private collectTextureIdsFromAnimVector(value: any, ids: Set<number>) {
        if (value === undefined || value === null) return;
        if (typeof value === 'number') {
            if (value >= 0) ids.add(value);
            return;
        }
        if (value.Keys) {
            // Thumbnail mode only needs the primary animated texture id.
            const v0 = value.Keys?.[0]?.Vector?.[0];
            if (typeof v0 === 'number' && v0 >= 0) {
                ids.add(v0);
            }
        }
    }

    private getUsedTextureIds(model: any): Set<number> {
        const usedIds = new Set<number>();

        if (model.Materials) {
            for (const material of model.Materials) {
                if (material.Layers) {
                    for (const layer of material.Layers) {
                        this.collectTextureIdsFromAnimVector(layer.TextureID, usedIds);
                        this.collectTextureIdsFromAnimVector(layer.NormalTextureID, usedIds);
                        this.collectTextureIdsFromAnimVector(layer.ORMTextureID, usedIds);
                        this.collectTextureIdsFromAnimVector(layer.EmissiveTextureID, usedIds);
                        this.collectTextureIdsFromAnimVector(layer.TeamColorTextureID, usedIds);
                        this.collectTextureIdsFromAnimVector(layer.ReflectionsTextureID, usedIds);
                    }
                }
            }
        }

        if (model.ParticleEmitters2) {
            for (const emitter of model.ParticleEmitters2) {
                if (typeof emitter.TextureID === 'number' && emitter.TextureID >= 0) {
                    usedIds.add(emitter.TextureID);
                }
            }
        }

        if (model.Textures) {
            for (let i = 0; i < model.Textures.length; i++) {
                const tex = model.Textures[i];
                if (tex?.ReplaceableId && tex.ReplaceableId > 0) {
                    usedIds.add(i);
                }
            }
        }

        return usedIds;
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

    private async ensureTeamColorsLoaded() {
        if (this.teamColorsLoaded) return; // Sync check optimization
        if (!useRendererStore.getState().mpqLoaded) return;

        if (this.teamColorsLoading) {
            await this.teamColorsLoading;
            return;
        }

        this.teamColorsLoading = this.initTeamColors();
        try {
            await this.teamColorsLoading;
            this.teamColorsLoaded = true;
        } finally {
            this.teamColorsLoading = null;
        }
    }

    private async initTeamColors() {
        const colors = [
            { id: 1, path: 'ReplaceableTextures\\TeamColor\\TeamColor00.blp' },
            { id: 2, path: 'ReplaceableTextures\\TeamGlow\\TeamGlow00.blp' }
        ];
        for (const col of colors) {
            try {
                const data = await invoke<Uint8Array>('read_mpq_file', { path: col.path });
                if (data && data.length > 0) {
                    const blp = decodeBLP(data.buffer as ArrayBuffer);
                    const mip = getBLPImageData(blp, 0);
                    this.teamColorData[col.id] = new ImageData(
                        new Uint8ClampedArray(mip.data),
                        mip.width,
                        mip.height
                    );
                }
            } catch (e) {
                console.warn(`Failed to pre-load team color ${col.path}`, e);
                if (!this.teamColorData[col.id]) {
                    if (col.id === 1) this.teamColorData[col.id] = this.createSolidImageData(220, 60, 60);
                    else this.teamColorData[col.id] = this.createSolidImageData(255, 210, 0);
                }
            }
        }
    }

    private getAvailableWorkerIndex(): number {
        return this.workerBusy.findIndex(busy => !busy);
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

    private getTextureCacheKey(modelPath: string, texturePath: string): string {
        const normalizedTexture = normalizePath(texturePath).toLowerCase();
        if (isMPQPath(normalizedTexture)) {
            return `mpq:${normalizedTexture}`;
        }

        const normalizedModel = normalizePath(modelPath).toLowerCase();
        const lastSlash = normalizedModel.lastIndexOf('\\');
        const modelDir = lastSlash >= 0 ? normalizedModel.substring(0, lastSlash) : normalizedModel;
        return `fs:${modelDir}|${normalizedTexture}`;
    }

    private touchSharedTextureCache(key: string, image: ImageData) {
        if (this.sharedTextureCache.has(key)) {
            this.sharedTextureCache.delete(key);
        }
        this.sharedTextureCache.set(key, image);

        while (this.sharedTextureCache.size > this.SHARED_TEXTURE_CACHE_LIMIT) {
            const oldestKey = this.sharedTextureCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            this.sharedTextureCache.delete(oldestKey);
            this.sharedTextureLoading.delete(oldestKey);
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

    private touchMainCache(fullPath: string, modelInfo: CachedModelInfo, textures?: Record<string, ImageData>) {
        if (this.modelCache.has(fullPath)) {
            this.modelCache.delete(fullPath);
        }
        this.modelCache.set(fullPath, modelInfo);

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
            this.modelCache.delete(oldestKey);
            this.textureCache.delete(oldestKey);
            this.resourceLoading.delete(oldestKey);
            this.textureLoading.delete(oldestKey);
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
            const readStart = performance.now();
            const buffer = await readFile(fullPath);
            const modelReadMs = performance.now() - readStart;
            const arrayBuffer = buffer.buffer;

            const modelInfo: CachedModelInfo = {
                buffer: arrayBuffer,
                animations: [],
                texturePaths: []
            };
            this.recordModelPerf(fullPath, {
                modelReadMs,
                textureCount: 0
            });
            this.touchMainCache(fullPath, modelInfo);
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

            const usedIds = this.getUsedTextureIds(model);
            let textureEntries = model.Textures
                .map((t: any, idx: number) => ({ idx, path: (t.Image || t.Path) as string }))
                .filter((t: any) => !!t.path);

            if (usedIds.size > 0) {
                const filtered = textureEntries.filter(t => usedIds.has(t.idx));
                if (filtered.length > 0) {
                    textureEntries = filtered;
                }
            }

            if (textureEntries.length > MAX_BATCH_TEXTURES) {
                textureEntries = textureEntries.slice(0, MAX_BATCH_TEXTURES);
            }

            textureEntries.forEach((t) => texturePathSet.add(t.path));
        }

        if (model.ParticleEmitters) {
            model.ParticleEmitters.forEach((emitter: any) => {
                if (emitter.FileName && typeof emitter.FileName === 'string') {
                    texturePathSet.add(emitter.FileName);
                }
            });
        }

        return {
            animations: model.Sequences ? model.Sequences.map((s: any) => s.Name || 'Unnamed') : [],
            texturePaths: Array.from(texturePathSet)
        };
    }

    private async loadTextureImages(fullPath: string, texturePaths: string[]): Promise<Record<string, ImageData>> {
        const cached = this.textureCache.get(fullPath);
        if (texturePaths.length === 0) {
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

        if (cached && Object.keys(cached).length > 0) {
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
                textureCount: texturePaths.length,
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
            const textureImages: Record<string, ImageData> = {};

            let uniqueTexturePaths = Array.from(new Set(texturePaths.filter(Boolean)));
            if (uniqueTexturePaths.length > MAX_BATCH_TEXTURES) {
                uniqueTexturePaths = uniqueTexturePaths.slice(0, MAX_BATCH_TEXTURES);
            }
            metrics.textureCount = uniqueTexturePaths.length;
            const pendingSharedPromises: Promise<void>[] = [];
            const loadTargets: string[] = [];
            const keyByPath = new Map<string, string>();
            const resolverByKey = new Map<string, (value: ImageData | null) => void>();

            uniqueTexturePaths.forEach((path) => {
                const key = this.getTextureCacheKey(fullPath, path);
                keyByPath.set(path, key);

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
                const pending = new Promise<ImageData | null>((resolve) => {
                    resolverByKey.set(key, resolve);
                });
                this.sharedTextureLoading.set(key, pending);
            });

            try {
                if (loadTargets.length > 0) {
                    await this.withTextureTaskSlot(async () => {
                        const mpqTargets: string[] = [];
                        const fsTargets: string[] = [];
                        loadTargets.forEach((path) => {
                            const normalized = normalizePath(path);
                            if (isMPQPath(normalized)) {
                                mpqTargets.push(path);
                            } else {
                                fsTargets.push(path);
                            }
                        });

                        const fallbackPaths: string[] = [];

                        const processDecodedBinaryMap = (targets: string[], decodedBinaryMap: Map<string, Uint8Array>) => {
                            for (const path of targets) {
                                const data = decodedBinaryMap.get(path);
                                if (!data) {
                                    fallbackPaths.push(path);
                                    continue;
                                }

                                try {
                                    const decodeStart = performance.now();
                                    const buffer = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
                                        ? data.buffer
                                        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                                    const imageData = decodeTextureData(buffer, path, { maxDimension: 256 });
                                    metrics.decodeMs += performance.now() - decodeStart;

                                    if (imageData) {
                                        textureImages[path] = imageData;
                                        metrics.resolvedCount += 1;
                                        const key = keyByPath.get(path)!;
                                        this.touchSharedTextureCache(key, imageData);
                                        resolverByKey.get(key)?.(imageData);
                                    } else {
                                        fallbackPaths.push(path);
                                    }
                                } catch {
                                    fallbackPaths.push(path);
                                }
                            }
                        };

                        if (mpqTargets.length > 0) {
                            const mpqBatchStart = performance.now();
                            try {
                                const payload = await invoke<Uint8Array>('load_textures_batch_bin', {
                                    // Empty modelPath forces MPQ-only resolution in Rust command.
                                    modelPath: '',
                                    texturePaths: mpqTargets
                                });
                                const decodedBinaryMap = this.parseTextureBytesPayload(payload, mpqTargets);
                                processDecodedBinaryMap(mpqTargets, decodedBinaryMap);
                            } catch (err) {
                                console.warn('[ThumbnailService] Binary MPQ batch texture load failed:', err);
                                fallbackPaths.push(...mpqTargets);
                            } finally {
                                const elapsed = performance.now() - mpqBatchStart;
                                metrics.batchMpqLoadMs += elapsed;
                                metrics.batchLoadMs += elapsed;
                            }
                        }

                        if (fsTargets.length > 0) {
                            const fsBatchStart = performance.now();
                            try {
                                const payload = await invoke<Uint8Array>('load_textures_batch_bin', {
                                    modelPath: fullPath,
                                    texturePaths: fsTargets
                                });
                                const decodedBinaryMap = this.parseTextureBytesPayload(payload, fsTargets);
                                processDecodedBinaryMap(fsTargets, decodedBinaryMap);
                            } catch (err) {
                                console.warn('[ThumbnailService] Binary batch texture load failed, fallback to direct loader:', err);
                                fallbackPaths.push(...fsTargets);
                            } finally {
                                const elapsed = performance.now() - fsBatchStart;
                                metrics.batchFsLoadMs += elapsed;
                                metrics.batchLoadMs += elapsed;
                            }
                        }

                        if (fallbackPaths.length > 0) {
                            const fallbackStart = performance.now();
                            const fallbackResults = await Promise.all(
                                fallbackPaths.map(async (path) => {
                                    try {
                                        return await decodeTexture(path, fullPath);
                                    } catch {
                                        return { path, imageData: null as ImageData | null };
                                    }
                                })
                            );
                            metrics.fallbackLoadMs += performance.now() - fallbackStart;

                            fallbackResults.forEach((res) => {
                                const key = keyByPath.get(res.path)!;
                                if (res.imageData) {
                                    textureImages[res.path] = res.imageData;
                                    metrics.resolvedCount += 1;
                                    this.touchSharedTextureCache(key, res.imageData);
                                    resolverByKey.get(key)?.(res.imageData);
                                } else {
                                    metrics.missCount += 1;
                                    resolverByKey.get(key)?.(null);
                                }
                            });
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

        const concurrency = Math.max(1, Math.min(maxConcurrent, unique.length));
        let cursor = 0;

        const worker = async () => {
            while (cursor < unique.length) {
                const index = cursor++;
                const fullPath = unique[index];
                try {
                    if (options?.withTextures) {
                        const modelInfo = await this.loadModelInfo(fullPath);
                        let texturePaths = modelInfo.texturePaths;
                        if (texturePaths.length === 0) {
                            const parseStart = performance.now();
                            const metadata = this.parseModelMetadata(fullPath, modelInfo.buffer);
                            this.recordModelPerf(fullPath, {
                                modelParseMs: Math.max(this.getOrCreateModelPerf(fullPath).modelParseMs, performance.now() - parseStart)
                            });
                            texturePaths = metadata.texturePaths;
                            this.touchMainCache(fullPath, {
                                ...modelInfo,
                                animations: metadata.animations.length > 0 ? metadata.animations : modelInfo.animations,
                                texturePaths
                            });
                        }
                        await this.loadTextureImages(fullPath, texturePaths);
                    } else {
                        await this.loadModelInfo(fullPath);
                    }
                } catch {
                    // Ignore prefetch failures; render path has its own error handling.
                }
            }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
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
        }
    ): Promise<RenderResult> {
        await this.ensureTeamColorsLoaded();
        const workerIndex = this.getAvailableWorkerIndex();
        if (workerIndex === -1 || this.callbacks.has(fullPath)) return { bitmap: null as any, status: 'busy' };

        this.workerBusy[workerIndex] = true;

        // Safety Timeout (10 seconds)
        this.workerTimeouts[workerIndex] = setTimeout(() => {
            console.warn(`[ThumbnailService] Worker ${workerIndex} timed out on ${fullPath}. Resetting.`);
            this.workerBusy[workerIndex] = false;
            this.renderRequestMetrics.delete(fullPath);
            const cb = this.callbacks.get(fullPath);
            if (cb) {
                cb({ bitmap: null as any, status: 'error' });
                this.callbacks.delete(fullPath);
            }
        }, 10000);

        try {
            const requestStartMs = performance.now();
            const modelInfo = await this.loadModelInfo(fullPath);
            const texturesCached = this.textureCache.get(fullPath);
            let textureImages = texturesCached || {};
            const worker = this.workers[workerIndex];
            const isLoaded = this.workerModelCache[workerIndex].includes(fullPath);

            if (!texturesCached) {
                if (!isLoaded && !options?.preferFastFirstFrame) {
                    textureImages = await this.loadTextureImages(fullPath, modelInfo.texturePaths);
                } else {
                    void this.loadTextureImages(fullPath, modelInfo.texturePaths);
                }
            }

            const shouldSyncTextures = Object.keys(textureImages).length > 0 && !this.workerTextureSync[workerIndex].has(fullPath);
            const includeTexturePayload = shouldSyncTextures;
            const prepareMs = Math.max(0, performance.now() - requestStartMs);

            // 2. Send to Available Worker
            return new Promise((resolve) => {
                this.callbacks.set(fullPath, resolve);
                this.renderRequestMetrics.set(fullPath, {
                    requestStartMs,
                    prepareMs
                });

                if (isLoaded) {
                    if (includeTexturePayload) {
                        this.workerTextureSync[workerIndex].add(fullPath);
                    }
                    worker.postMessage({
                        type: 'RENDER',
                        payload: {
                            fullPath,
                            ...(includeTexturePayload ? { textureImages } : {}),
                            frame,
                            sequenceIndex,
                            freeze,
                            backgroundColor: useRendererStore.getState().backgroundColor
                        }
                    });
                } else {
                    // Initial full payload
                    const payload = {
                        fullPath,
                        modelBuffer: modelInfo.buffer,
                        ...(Object.keys(textureImages).length > 0 ? { textureImages } : {}),
                        teamColorData: this.teamColorData, // Send pre-loaded team colors
                        frame,
                        sequenceIndex,
                        freeze,
                        backgroundColor: useRendererStore.getState().backgroundColor
                    };

                    worker.postMessage({
                        type: 'RENDER',
                        payload
                    });

                    if (Object.keys(textureImages).length > 0) {
                        this.workerTextureSync[workerIndex].add(fullPath);
                    } else {
                        this.workerTextureSync[workerIndex].delete(fullPath);
                    }
                }
            });

        } catch (err) {
            console.error('[ThumbnailService] Preparation failed:', err);
            this.renderRequestMetrics.delete(fullPath);
            this.workerBusy[workerIndex] = false;
            return { bitmap: null as any, status: 'error' };
        }
    }

    public getCachedAnimations(fullPath: string): string[] | null {
        return this.modelCache.get(fullPath)?.animations || null;
    }

    public getWorkerStats(): { busy: number; total: number } {
        const busy = this.workerBusy.reduce((sum, cur) => sum + (cur ? 1 : 0), 0);
        return { busy, total: this.workerCount };
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
            textureCache: this.textureCache.size,
            sharedTextureCache: this.sharedTextureCache.size,
            modelLoading: this.resourceLoading.size,
            textureLoading: this.textureLoading.size,
            textureTaskRunning: this.textureTaskRunning,
            textureTaskPending: this.textureTaskQueue.length,
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
            textureLoadRatioPct,
            textureCoveragePct,
            sharedTextureHitRatePct,
            hotspotModelName,
            hotspotStage,
            hotspotMs
        };
    }

    public clearAll() {
        this.modelCache.clear();
        this.textureCache.clear();
        this.resourceLoading.clear();
        this.textureLoading.clear();
        this.sharedTextureCache.clear();
        this.sharedTextureLoading.clear();
        this.textureTaskQueue = [];
        this.textureTaskRunning = 0;
        this.modelPerf.clear();
        this.renderRequestMetrics.clear();
        this.workerModelCache.forEach((_, i) => this.workerModelCache[i] = []);
        this.workerTextureSync.forEach(set => set.clear());
        this.workerBusy.fill(false);
        // Also clear workers' internal renderer cache
        this.workers.forEach(worker => worker.postMessage({ type: 'CLEAR' }));
    }
}

export const thumbnailService = new ThumbnailService();
