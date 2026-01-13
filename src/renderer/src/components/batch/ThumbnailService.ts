/**
 * ThumbnailService - Manages background thumbnail rendering via Web Workers
 * 
 * Provides absolute isolation from the main thread's WebGL state.
 */

// @ts-ignore
import { parseMDX, parseMDL, decodeBLP, getBLPImageData } from 'war3-model';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { decodeTexture, decodeTextureData } from '../viewer/textureLoader';
import { useRendererStore } from '../../store/rendererStore';

// We import the worker using Vite's ?worker suffix
// @ts-ignore
import ThumbnailWorker from './thumbnail.worker?worker';

export interface RenderResult {
    bitmap: ImageBitmap;
    animations?: string[];
    status?: 'success' | 'busy' | 'error';
}

class ThumbnailService {
    private workers: Worker[] = [];
    private workerBusy: boolean[] = [];
    private callbacks: Map<string, (res: RenderResult) => void> = new Map();
    private modelCache: Map<string, { buffer: ArrayBuffer, animations: string[] }> = new Map();
    private textureCache: Map<string, Record<string, ImageData>> = new Map();
    private workerModelCache: string[][] = []; // Per-worker LRU cache (array of paths)
    private workerCount = 12;
    private readonly MAIN_CACHE_LIMIT = 100; // Main thread cache limit
    private teamColorData: Record<number, ImageData> = {};
    private teamColorsLoaded = false;
    private teamColorsLoading: Promise<void> | null = null;
    private workerTimeouts: (ReturnType<typeof setTimeout> | null)[] = [];
    private readonly CACHE_LIMIT = 64; // Increased limit for robust paging

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
                    const { fullPath, bitmap, animations } = payload;
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

                        if (modelInfo && textureImages) {
                            worker.postMessage({
                                type: 'RENDER',
                                payload: {
                                    fullPath,
                                    modelBuffer: modelInfo.buffer,
                                    textureImages,
                                    teamColorData: this.teamColorData,
                                    frame: 0,
                                    sequenceIndex: 0
                                }
                            });
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
                }
            };
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

    /**
     * Renders a frame by delegating to the worker
     */
    public async renderFrame(
        fullPath: string,
        frame: number = 0,
        sequenceIndex: number = 0
    ): Promise<RenderResult> {
        await this.ensureTeamColorsLoaded();
        const workerIndex = this.getAvailableWorkerIndex();
        if (workerIndex === -1 || this.callbacks.has(fullPath)) return { bitmap: null as any, status: 'busy' };

        this.workerBusy[workerIndex] = true;

        // Safety Timeout (10 seconds)
        this.workerTimeouts[workerIndex] = setTimeout(() => {
            console.warn(`[ThumbnailService] Worker ${workerIndex} timed out on ${fullPath}. Resetting.`);
            this.workerBusy[workerIndex] = false;
            const cb = this.callbacks.get(fullPath);
            if (cb) {
                cb({ bitmap: null as any, status: 'error' });
                this.callbacks.delete(fullPath);
            }
        }, 10000);

        try {
            // 1. Get Model Buffer and Texture Data
            let modelInfo = this.modelCache.get(fullPath);
            if (!modelInfo) {
                const buffer = await readFile(fullPath);
                const arrayBuffer = buffer.buffer;

                // Quick parse to get texture paths
                let model: any;
                if (fullPath.toLowerCase().endsWith('.mdl')) {
                    model = parseMDL(new TextDecoder().decode(arrayBuffer));
                } else {
                    model = parseMDX(arrayBuffer);
                }

                if (!model) throw new Error('Failed to parse model for background render');

                // Pre-load textures for this model (Optimized Batch Loading)
                const textureImages: Record<string, ImageData> = {};
                if (model.Textures) {
                    const texturePaths = model.Textures
                        .filter((t: any) => t.Image)
                        .map((t: any) => t.Image as string);

                    if (texturePaths.length > 0) {
                        try {
                            // 1. Attempt batch MPQ read
                            const mpqResults = await invoke<(string | null)[]>('read_mpq_files_batch', { paths: texturePaths });

                            // 2. Decode MPQ results and identify missing ones for FS fallback
                            const missingPaths: string[] = [];
                            for (let i = 0; i < texturePaths.length; i++) {
                                const path = texturePaths[i];
                                const b64 = mpqResults[i];
                                if (b64) {
                                    try {
                                        const data = this.base64ToUint8Array(b64);
                                        const imageData = decodeTextureData(data.buffer as ArrayBuffer, path);
                                        if (imageData) {
                                            textureImages[path] = imageData;
                                        } else {
                                            missingPaths.push(path);
                                        }
                                    } catch (e) { missingPaths.push(path); }
                                } else {
                                    missingPaths.push(path);
                                }
                            }

                            // 3. Fallback to local File System for missing textures
                            for (const path of missingPaths) {
                                const result = await decodeTexture(path, fullPath);
                                if (result.imageData) {
                                    textureImages[path] = result.imageData;
                                }
                            }
                        } catch (err) {
                            // Global fallback if batch fails
                            for (const path of texturePaths) {
                                const result = await decodeTexture(path, fullPath);
                                if (result.imageData) {
                                    textureImages[path] = result.imageData;
                                }
                            }
                        }
                    }
                }

                // Extract animations for initial caching
                const animations = model.Sequences ? model.Sequences.map((s: any) => s.Name || 'Unnamed') : [];
                modelInfo = { buffer: arrayBuffer, animations };

                // LRU for main thread caches
                if (this.modelCache.size >= this.MAIN_CACHE_LIMIT) {
                    const oldestKey = this.modelCache.keys().next().value;
                    if (oldestKey) {
                        this.modelCache.delete(oldestKey);
                        this.textureCache.delete(oldestKey);
                    }
                }

                this.modelCache.set(fullPath, modelInfo);
                this.textureCache.set(fullPath, textureImages);
            } else {
                // Refresh LRU: move to end
                this.modelCache.delete(fullPath);
                this.modelCache.set(fullPath, modelInfo);

                const textures = this.textureCache.get(fullPath);
                if (textures) {
                    this.textureCache.delete(fullPath);
                    this.textureCache.set(fullPath, textures);
                }
            }

            const textureImages = this.textureCache.get(fullPath) || {};

            // 2. Send to Available Worker
            return new Promise((resolve) => {
                this.callbacks.set(fullPath, resolve);

                const worker = this.workers[workerIndex];
                const isLoaded = this.workerModelCache[workerIndex].includes(fullPath);

                if (isLoaded) {
                    // Send thin message for frame updates
                    worker.postMessage({
                        type: 'RENDER',
                        payload: {
                            fullPath,
                            frame,
                            sequenceIndex,
                            backgroundColor: useRendererStore.getState().backgroundColor
                        }
                    });
                } else {
                    // Initial full payload
                    const payload = {
                        fullPath,
                        modelBuffer: modelInfo!.buffer,
                        textureImages,
                        teamColorData: this.teamColorData, // Send pre-loaded team colors
                        frame,
                        sequenceIndex,
                        backgroundColor: useRendererStore.getState().backgroundColor
                    };

                    worker.postMessage({
                        type: 'RENDER',
                        payload
                    });
                }
            });

        } catch (err) {
            console.error('[ThumbnailService] Preparation failed:', err);
            this.workerBusy[workerIndex] = false;
            return { bitmap: null as any, status: 'error' };
        }
    }

    public getCachedAnimations(fullPath: string): string[] | null {
        return this.modelCache.get(fullPath)?.animations || null;
    }

    public clearAll() {
        this.modelCache.clear();
        this.textureCache.clear();
        this.workerModelCache.forEach((_, i) => this.workerModelCache[i] = []);
        this.workerBusy.fill(false);
        // Also clear workers' internal renderer cache
        this.workers.forEach(worker => worker.postMessage({ type: 'CLEAR' }));
    }
}

export const thumbnailService = new ThumbnailService();
