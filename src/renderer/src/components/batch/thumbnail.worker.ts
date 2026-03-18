/**
 * thumbnail.worker.ts
 * 
 * This worker runs in a separate thread to provide TOTAL ISOLATION
 * for the war3-model library's rendering state.
 */

// @ts-ignore
import { parseMDX, parseMDL, ModelRenderer, ModelResourceManager, decodeBLP, getBLPImageData } from 'war3-model';
import { mat4, vec3, quat } from 'gl-matrix';

const REPLACEABLE_TEXTURES: Record<number, string> = {
    1: 'TeamColor\\TeamColor00',
    2: 'TeamGlow\\TeamGlow00',
    11: 'Cliff\\Cliff0',
    21: '', // Used by cursors
    31: 'LordaeronTree\\LordaeronSummerTree',
    32: 'AshenvaleTree\\AshenTree',
    33: 'BarrensTree\\BarrensTree',
    34: 'NorthrendTree\\NorthTree',
    35: 'Mushroom\\MushroomTree',
    36: 'RuinsTree\\RuinsTree',
    37: 'OutlandMushroomTree\\MushroomTree',
}

const THUMBNAIL_SIZE = 160;

// --- TGA Constants ---
const TGA_TYPE_RGB = 2;
const TGA_TYPE_GREY = 3;
const TGA_TYPE_RLE_RGB = 10;
const TGA_TYPE_RLE_GREY = 11;
const TGA_TYPE_RLE_INDEXED = 9;

/**
 * Decode raw BLP/TGA bytes into ImageData entirely within the worker thread.
 * This eliminates main-thread decode blocking.
 */
function decodeRawTextureInWorker(buffer: ArrayBuffer, path: string, maxDimension?: number, preferBlpBaseMip?: boolean): ImageData | null {
    try {
        const lower = path.toLowerCase();
        if (lower.endsWith('.tga')) {
            return decodeTGAInWorker(buffer, maxDimension);
        }
        // Default: BLP
        const blp = decodeBLP(buffer);
        const width = Number(blp?.width ?? blp?.Width ?? 0);
        const height = Number(blp?.height ?? blp?.Height ?? 0);
        let mipLevel = 0;
        if (!preferBlpBaseMip && maxDimension && maxDimension > 0 && width > 0 && height > 0) {
            const maxSide = Math.max(width, height);
            if (maxSide > maxDimension) {
                mipLevel = Math.max(0, Math.floor(Math.log2(maxSide / maxDimension)));
            }
        }
        let mip: any;
        try {
            mip = getBLPImageData(blp, mipLevel);
        } catch {
            mip = getBLPImageData(blp, 0);
        }
        const data = mip.data instanceof Uint8ClampedArray ? mip.data : new Uint8ClampedArray(mip.data);
        let decoded = new ImageData(data as any, mip.width, mip.height);

        // BYPASS Canvas downscaling completely for alpha-dependent textures because Canvas 2D always premultiplies alpha, destroying RGB data.
        return preferBlpBaseMip ? decoded : downscaleInWorker(decoded, maxDimension);
    } catch (e) {
        console.warn(`[Worker] Failed to decode texture ${path}:`, e);
        return null;
    }
}

function decodeTGAInWorker(buffer: ArrayBuffer, maxDimension?: number): ImageData | null {
    const view = new DataView(buffer);
    const header = {
        idLength: view.getUint8(0),
        colorMapType: view.getUint8(1),
        imageType: view.getUint8(2),
        colorMapIndex: view.getUint16(3, true),
        colorMapLength: view.getUint16(5, true),
        colorMapDepth: view.getUint8(7),
        xOrigin: view.getUint16(8, true),
        yOrigin: view.getUint16(10, true),
        width: view.getUint16(12, true),
        height: view.getUint16(14, true),
        pixelDepth: view.getUint8(16),
        imageDesc: view.getUint8(17)
    };

    if ((header.width <= 0 || header.height <= 0) ||
        (header.pixelDepth !== 8 && header.pixelDepth !== 16 && header.pixelDepth !== 24 && header.pixelDepth !== 32)) {
        return null;
    }

    const tgaData = new Uint8Array(buffer, 18 + header.idLength + (header.colorMapType === 1 ? header.colorMapLength * (header.colorMapDepth >> 3) : 0));
    const pixelCount = header.width * header.height;
    const bytesPerPixel = header.pixelDepth >> 3;
    const outputData = new Uint8ClampedArray(pixelCount * 4);

    let offset = 0;
    let pixelIndex = 0;


    const data32 = new Uint32Array(outputData.buffer);
    const isRLE = header.imageType === TGA_TYPE_RLE_RGB || header.imageType === TGA_TYPE_RLE_GREY || header.imageType === TGA_TYPE_RLE_INDEXED;

    const getPixel32 = (data: Uint8Array, idx: number, depth: number): number => {
        if (depth === 24) return (255 << 24) | (data[idx + 2] << 16) | (data[idx + 1] << 8) | data[idx];
        if (depth === 32) return (data[idx + 3] << 24) | (data[idx + 2] << 16) | (data[idx + 1] << 8) | data[idx];
        if (depth === 8) { const v = data[idx]; return (255 << 24) | (v << 16) | (v << 8) | v; }
        if (depth === 16) {
            const val = data[idx] | (data[idx + 1] << 8);
            const r = ((val & 0x7C00) >> 10) * 255 / 31;
            const g = ((val & 0x03E0) >> 5) * 255 / 31;
            const b = (val & 0x001F) * 255 / 31;
            const a = (val & 0x8000) ? 255 : 0;
            return (a << 24) | (b << 16) | (g << 8) | r;
        }
        return 0;
    };

    if (isRLE) {
        let pixelsProcessed = 0;
        while (pixelsProcessed < pixelCount) {
            const chunkHeader = tgaData[offset++];
            const chunkPixelCount = (chunkHeader & 0x7F) + 1;
            if ((chunkHeader & 0x80) !== 0) {
                const pv32 = getPixel32(tgaData, offset, header.pixelDepth);
                offset += bytesPerPixel;
                for (let i = 0; i < chunkPixelCount; i++) {
                    data32[pixelIndex++] = pv32;
                }
            } else {
                for (let i = 0; i < chunkPixelCount; i++) {
                    data32[pixelIndex++] = getPixel32(tgaData, offset, header.pixelDepth);
                    offset += bytesPerPixel;
                }
            }
            pixelsProcessed += chunkPixelCount;
        }
    } else {
        for (let i = 0; i < pixelCount; i++) {
            data32[i] = getPixel32(tgaData, offset, header.pixelDepth);
            offset += bytesPerPixel;
        }
    }

    // Flip vertically if origin is bottom-left (default TGA)
    const isTopLeft = (header.imageDesc & 0x20) !== 0;
    if (!isTopLeft) {
        const rowPixels = header.width;
        const tmp = new Uint32Array(rowPixels);
        for (let y = 0; y < Math.floor(header.height / 2); y++) {
            const topOff = y * rowPixels;
            const botOff = (header.height - 1 - y) * rowPixels;
            tmp.set(data32.subarray(topOff, topOff + rowPixels));
            data32.copyWithin(topOff, botOff, botOff + rowPixels);
            data32.set(tmp, botOff);
        }
    }

    const decoded = new ImageData(outputData, header.width, header.height);
    return downscaleInWorker(decoded, maxDimension);
}

function downscaleInWorker(imageData: ImageData, maxDimension?: number): ImageData {
    if (!maxDimension || maxDimension <= 0) return imageData;
    if (imageData.width <= maxDimension && imageData.height <= maxDimension) return imageData;
    const scale = maxDimension / Math.max(imageData.width, imageData.height);
    const tw = Math.max(1, Math.round(imageData.width * scale));
    const th = Math.max(1, Math.round(imageData.height * scale));
    try {
        const src = new OffscreenCanvas(imageData.width, imageData.height);
        const sCtx = src.getContext('2d', { alpha: true, willReadFrequently: true });
        if (sCtx) {
            sCtx.putImageData(imageData, 0, 0);
            const dst = new OffscreenCanvas(tw, th);
            const dCtx = dst.getContext('2d', { alpha: true, willReadFrequently: true });
            if (dCtx) {
                dCtx.clearRect(0, 0, tw, th);
                dCtx.drawImage(src, 0, 0, tw, th);
                return dCtx.getImageData(0, 0, tw, th);
            }
        }
    } catch { /* fallthrough */ }
    return imageData;
}

let canvas: OffscreenCanvas | null = null;
let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

interface ThumbnailCameraFit {
    target: [number, number, number];
    distance: number;
    fov: number;
    baseTheta: number;
    phi: number;
}

interface RendererCacheItem {
    renderer: any;
    model: any;
    lastSequence: number;
    lastTime: number;
    staticFrameTime?: number;
    aabb?: { min: any, max: any };
    cameraFit?: ThumbnailCameraFit;
    textureImages?: Record<string, ImageData>;
    teamColorData?: Record<number, any>;
    appliedTeamColor?: number;
    appliedTexturePaths: Set<string>;
    texturePaths: string[];
}

let renderers: Map<string, RendererCacheItem> = new Map();

/**
 * Reference count map: texture path → number of cached models using it.
 * When a model is evicted (PRUNE/CLEAR), decrement counts.
 * When count hits 0, delete the texture from WebGL to free GPU VRAM.
 */
const textureRefCount: Map<string, number> = new Map();

function retainTexturePaths(paths: string[]): void {
    for (const p of paths) {
        textureRefCount.set(p, (textureRefCount.get(p) ?? 0) + 1);
    }
}

function releaseTexturePaths(paths: string[]): void {
    for (const p of paths) {
        const count = (textureRefCount.get(p) ?? 1) - 1;
        if (count <= 0) {
            textureRefCount.delete(p);
            // Free the GPU texture from VRAM
            try {
                ModelResourceManager.getInstance().removeTexture(p);
            } catch (_) { }
        } else {
            textureRefCount.set(p, count);
        }
    }
}

const CACHE_LIMIT = 24;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'WARMUP') {
        try {
            await initGL();
            self.postMessage({ type: 'WARMED' });
        } catch (err: any) {
            self.postMessage({
                type: 'ERROR',
                payload: {
                    fullPath: '',
                    error: String(err),
                    stack: err?.stack
                }
            });
        }
    } else if (type === 'PRELOAD') {
        try {
            const result = await render({ ...payload, preloadOnly: true });
            self.postMessage({
                type: 'PRELOADED',
                payload: {
                    fullPath: payload.fullPath,
                    animations: result?.animations,
                    texturePaths: result?.texturePaths,
                    metrics: result?.metrics
                }
            });
        } catch (err: any) {
            console.error('[Worker] Preload failed:', err);
            self.postMessage({
                type: 'ERROR',
                payload: {
                    fullPath: payload.fullPath,
                    error: String(err),
                    stack: err.stack
                }
            });
        }
    } else if (type === 'RENDER') {
        try {
            const result = await render(payload);
            if (result) {
                // @ts-ignore - Use DedicatedWorkerGlobalScope.postMessage
                self.postMessage({ type: 'DONE', payload: { ...result, fullPath: payload.fullPath } }, [result.bitmap]);
            } else {
                self.postMessage({ type: 'ERROR', payload: { fullPath: payload.fullPath, error: 'Render returned null' } });
            }
        } catch (err: any) {
            console.error('[Worker] Render failed:', err);
            self.postMessage({
                type: 'ERROR',
                payload: {
                    fullPath: payload.fullPath,
                    error: String(err),
                    stack: err.stack
                }
            });
        }
    } else if (type === 'CLEAR') {
        renderers.forEach(item => {
            if (item.renderer && typeof item.renderer.destroy === 'function') {
                try { item.renderer.destroy(); } catch (e) { }
            }
            // Release all textures held by this model
            releaseTexturePaths(item.texturePaths || []);
        });
        renderers.clear();
        textureRefCount.clear();

        self.postMessage({ type: 'CLEARED' });
    } else if (type === 'PRUNE') {
        const keepPaths = new Set<string>((payload?.keepPaths || []) as string[]);
        for (const [path, item] of renderers.entries()) {
            if (!keepPaths.has(path)) {
                if (item.renderer && typeof item.renderer.destroy === 'function') {
                    try { item.renderer.destroy(); } catch (e) { }
                }
                // Decrement ref-counts; textures reaching 0 are freed from GPU VRAM
                releaseTexturePaths(item.texturePaths || []);
                renderers.delete(path);
            }
        }
        self.postMessage({ type: 'PRUNED' });
    }
};

async function initGL() {
    if (gl) return;

    canvas = new OffscreenCanvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const attrs = {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        antialias: true
    };
    // @ts-ignore
    gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);

    if (!gl) throw new Error('Worker WebGL init failed');
    gl.clearColor(0.12, 0.12, 0.12, 1.0);
    gl.enable(gl.DEPTH_TEST);
}

// Assuming ModelRenderer is a class defined elsewhere, this is how its method would look.
// This function is a helper that calls the renderer's method.
async function applyTextureImagesToRenderer(
    renderer: any,
    textureImages: Record<string, ImageData> | undefined,
    appliedTexturePaths: Set<string>
) {
    if (!textureImages || !renderer?.setTextureImageData) return;

    for (const [path, img] of Object.entries(textureImages)) {
        if (appliedTexturePaths.has(path)) continue;
        try {
            // CRITICAL: MUST set premultiplyAlpha to 'none' otherwise WebGL loses RGB data on transparent pixels!
            const bitmap = await createImageBitmap(img, { premultiplyAlpha: 'none' });
            renderer.setTextureImageData(path, [bitmap]);
            appliedTexturePaths.add(path);
        } catch (e) {
            console.warn(`[Worker] Failed to apply texture ${path}:`, e);
        }
    }
}

async function applyReplaceableTexturesToRenderer(
    renderer: any,
    teamColorData: Record<number, any> | undefined
) {
    if (!teamColorData || !renderer?.setReplaceableTexture) return;
    for (const [id, img] of Object.entries(teamColorData)) {
        try {
            let source: any = img;
            if (!(img instanceof ImageData) && (img as any)?.data) {
                source = new ImageData(new Uint8ClampedArray((img as any).data), (img as any).width, (img as any).height);
            }
            // CRITICAL: MUST set premultiplyAlpha to 'none' otherwise WebGL loses RGB data on transparent pixels, rendering them black!
            const bitmap = await createImageBitmap(source, { premultiplyAlpha: 'none' });
            renderer.setReplaceableTexture(parseInt(id, 10), bitmap);
        } catch (e) {
            console.warn(`[Worker] Replaceable texture error ${id}:`, e);
        }
    }
}

function collectTexturePaths(model: any): string[] {
    const texturePaths = new Set<string>();

    if (model.Textures) {
        let entries = model.Textures
            .map((texture: any) => ({ path: texture.Image || texture.Path }))
            .filter((entry: any) => !!entry.path);

        entries.forEach((entry: any) => texturePaths.add(entry.path as string));
    }

    if (model.ParticleEmitters) {
        model.ParticleEmitters.forEach((emitter: any) => {
            if (emitter.FileName && typeof emitter.FileName === 'string') {
                texturePaths.add(emitter.FileName);
            }
        });
    }

    return Array.from(texturePaths);
}

async function render(
    payload: {
        fullPath: string,
        modelBuffer?: ArrayBuffer,
        textureImages?: Record<string, ImageData>,
        textureRawData?: Record<string, ArrayBuffer>,
        textureMaxDimension?: number,
        teamColorData?: Record<number, any>,
        frame?: number,
        sequenceIndex?: number,
        freeze?: boolean,
        backgroundColor?: string,
        teamColor?: number,
        enableLighting?: boolean,
        wireframe?: boolean,
        showParticles?: boolean,
        showRibbons?: boolean,
        spinEnabled?: boolean,
        spinSpeed?: number,
        envLightingEnabled?: boolean,
        envLightDirection?: [number, number, number],
        envLightColor?: [number, number, number],
        envAmbientColor?: [number, number, number],
        preloadOnly?: boolean
    }
) {
    const {
        fullPath,
        modelBuffer,
        textureImages,
        textureRawData,
        textureMaxDimension,
        teamColorData,
        frame = 0,
        sequenceIndex = 0,
        freeze = false,
        backgroundColor = '#333333',
        teamColor = 0,
        enableLighting = true,
        wireframe = false,
        showParticles = true,
        showRibbons = true,
        spinEnabled = false,
        spinSpeed = 70,
        envLightingEnabled = false,
        envLightDirection,
        envLightColor,
        envAmbientColor,
        preloadOnly = false
    } = payload;

    await initGL();
    if (!gl || !canvas) return null;
    const renderStartMs = performance.now();
    let coldStartMs = 0;
    let parseMs = 0;
    let drawMs = 0;

    let item = renderers.get(fullPath);
    if (item) {
        // Refresh insertion order so Map behaves like LRU for eviction.
        renderers.delete(fullPath);
        renderers.set(fullPath, item);
    }

    if (!item) {
        const coldStartBegin = performance.now();
        if (!modelBuffer) {
            throw new Error(`Model data missing and not in cache: ${fullPath}`);
        }

        const parseStart = performance.now();
        let model: any;
        if (fullPath.toLowerCase().endsWith('.mdl')) {
            const text = new TextDecoder().decode(modelBuffer);
            model = parseMDL(text);
        } else {
            model = parseMDX(modelBuffer);
        }
        parseMs = performance.now() - parseStart;

        if (!model) throw new Error('Failed to parse model');

        // Resolve Replaceable IDs in worker model representation
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
        }

        if (!model.Sequences || model.Sequences.length === 0) {
            model.Sequences = [{
                Name: 'Stand',
                Interval: new Uint32Array([0, 1000]),
                NonLooping: 1,
                Rarity: 0,
                MoveSpeed: 0,
                BoundsRadius: 0
            }];
        }

        const defaultNodeId = ensureRenderNodes(model);
        ensureGeosetGroups(model, defaultNodeId);
        // Robust Validator
        validateAllParticleEmitters(model);

        // LRU Cache Cleanup
        if (renderers.size >= CACHE_LIMIT) {
            const oldestKey = renderers.keys().next().value;
            if (oldestKey !== undefined) {
                const oldestItem = renderers.get(oldestKey);
                if (oldestItem?.renderer?.destroy) {
                    try { oldestItem.renderer.destroy(); } catch (e) { }
                }
                // Release GPU textures for the evicted model
                releaseTexturePaths(oldestItem?.texturePaths || []);
                renderers.delete(oldestKey);
                self.postMessage({ type: 'EVICTED', payload: { fullPath: oldestKey } });
            }
        }

        const renderer = new ModelRenderer(model);
        renderer.initGL(gl);

        const appliedTexturePaths = new Set<string>();
        await applyTextureImagesToRenderer(renderer, textureImages, appliedTexturePaths);

        // --- PRE-CALCULATE AABB ONCE ---
        const min = vec3.fromValues(Infinity, Infinity, Infinity);
        const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
        let hasValidBounds = false;

        const infoBounds = getModelMinMax(model?.Info);
        const geosetBounds = getGeosetMinMax(model?.Geosets);

        let chosenBounds = geosetBounds || infoBounds;
        if (infoBounds && geosetBounds) {
            // ALWAYS prefer geoset vertex bounds — model header extents often
            // include particle emission radii or bone-reach that inflate the
            // AABB far beyond the actual visible mesh.
            chosenBounds = geosetBounds;
        }

        if (chosenBounds) {
            vec3.set(min, chosenBounds.min[0], chosenBounds.min[1], chosenBounds.min[2]);
            vec3.set(max, chosenBounds.max[0], chosenBounds.max[1], chosenBounds.max[2]);
            hasValidBounds = true;
        }

        if (!hasValidBounds || vec3.distance(min, max) < 2.0) {
            if (model.PivotPoints) {
                for (const pt of model.PivotPoints) {
                    if (pt[0] < min[0]) min[0] = pt[0]; if (pt[0] > max[0]) max[0] = pt[0];
                    if (pt[1] < min[1]) min[1] = pt[1]; if (pt[1] > max[1]) max[1] = pt[1];
                    if (pt[2] < min[2]) min[2] = pt[2]; if (pt[2] > max[2]) max[2] = pt[2];
                    hasValidBounds = true;
                }
            }
        }

        if (!hasValidBounds || min[0] === Infinity) {
            vec3.set(min, -50, -50, -50); vec3.set(max, 50, 50, 50);
        }

        item = {
            renderer,
            model,
            lastSequence: -1,
            lastTime: (frame !== undefined ? frame : performance.now()),
            aabb: { min, max },
            cameraFit: computeThumbnailCameraFit(min, max),
            textureImages,
            teamColorData,
            appliedTexturePaths,
            texturePaths: collectTexturePaths(model)
        };
        renderers.set(fullPath, item);
        // Retain a GPU reference for each texture path this model uses
        retainTexturePaths(item.texturePaths);
        coldStartMs = performance.now() - coldStartBegin;
    }

    // At this point item is guaranteed to exist
    const cacheItem = item!;
    const { renderer, model } = cacheItem;

    if (preloadOnly) {
        const renderMs = performance.now() - renderStartMs;
        return {
            animations: (model.Sequences || []).map((s: any) => s.Name || 'Unknown'),
            texturePaths: cacheItem.texturePaths || [],
            metrics: {
                renderMs,
                coldStartMs,
                parseMs,
                drawMs: 0
            }
        };
    }

    // Decode raw texture bytes in the worker if provided (main thread sends compressed bytes)
    let effectiveTextureImages = textureImages;
    if (textureRawData && Object.keys(textureRawData).length > 0) {
        const alphaRequiredTexturePaths = new Set<string>();
        if (model.Materials) {
            model.Materials.forEach((material: any) => {
                if (material.Layers) {
                    material.Layers.forEach((layer: any) => {
                        if (layer.FilterMode > 0 && layer.TextureID !== undefined && model.Textures[layer.TextureID]) {
                            const img = model.Textures[layer.TextureID].Image;
                            if (img) alphaRequiredTexturePaths.add(img);
                        }
                    });
                }
            });
        }
        if (model.ParticleEmitters2) {
            model.ParticleEmitters2.forEach((emitter: any) => {
                if (emitter.TextureID !== undefined && model.Textures[emitter.TextureID]) {
                    const img = model.Textures[emitter.TextureID].Image;
                    if (img) alphaRequiredTexturePaths.add(img);
                }
            });
        }
        if (model.ParticleEmitters) {
            model.ParticleEmitters.forEach((emitter: any) => {
                if (emitter.FileName && typeof emitter.FileName === 'string') {
                    alphaRequiredTexturePaths.add(emitter.FileName);
                }
            });
        }

        const decoded: Record<string, ImageData> = { ...(textureImages || {}) };
        for (const [path, buffer] of Object.entries(textureRawData)) {
            if (decoded[path]) continue; // Already have decoded version
            const preferBlpBaseMip = alphaRequiredTexturePaths.has(path);
            const img = decodeRawTextureInWorker(buffer, path, textureMaxDimension, preferBlpBaseMip);
            if (img) decoded[path] = img;
        }
        effectiveTextureImages = decoded;
    }

    // Progressive texture streaming: allow texture sync after the model is already cached.
    if (effectiveTextureImages && Object.keys(effectiveTextureImages).length > 0) {
        const prevApplied = new Set(cacheItem.appliedTexturePaths);
        await applyTextureImagesToRenderer(renderer, effectiveTextureImages, cacheItem.appliedTexturePaths);
        // Retain newly applied texture paths that weren't in the cache yet
        const newPaths: string[] = [];
        for (const p of cacheItem.appliedTexturePaths) {
            if (!prevApplied.has(p)) newPaths.push(p);
        }
        if (newPaths.length > 0) {
            retainTexturePaths(newPaths);
            // Add them to the model's tracked texturePaths for PRUNE cleanup
            cacheItem.texturePaths = [...new Set([...cacheItem.texturePaths, ...newPaths])];
        }
    }
    if (
        teamColorData &&
        Object.keys(teamColorData).length > 0 &&
        cacheItem.appliedTeamColor !== teamColor
    ) {
        await applyReplaceableTexturesToRenderer(renderer, teamColorData);
        cacheItem.teamColorData = teamColorData;
        cacheItem.appliedTeamColor = teamColor;
    }

    const bgRgb = hexToRgb(backgroundColor);
    // Reset key write masks before clear.
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);

    gl.clearColor(bgRgb[0], bgRgb[1], bgRgb[2], 1.0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Set viewport
    gl.viewport(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);

    // Standard render state
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Animation Update - only change sequence when needed
    if (model.Sequences && model.Sequences.length > 0) {
        const seqIdx = Math.max(0, Math.min(sequenceIndex, model.Sequences.length - 1));
        if (cacheItem.lastSequence !== seqIdx) {
            try {
                if (renderer.setSequence) renderer.setSequence(seqIdx);
                // CRITICAL: Update with 0 delta to refresh visibility and buffers for the new sequence
                if (renderer.update) renderer.update(0);
                cacheItem.lastSequence = seqIdx;
                cacheItem.staticFrameTime = undefined;
            } catch (e) {
                console.warn(`[Worker] Failed to set sequence ${seqIdx}:`, e);
            }
        }
    }

    // Calculate proper delta time for smooth animation
    let delta = 0;
    if (!freeze) {
        const now = (frame !== undefined ? frame : performance.now());
        // Delta stabilization: If lastTime is too far back or 0, reset to 16ms
        const rawDelta = now - cacheItem.lastTime;
        delta = (cacheItem.lastTime > 0 && rawDelta > 0) ? Math.min(rawDelta, 100) : 16;
        cacheItem.lastTime = now;
    } else if (model.Sequences && model.Sequences.length > 0) {
        const seqIdx = Math.max(0, Math.min(sequenceIndex, model.Sequences.length - 1));
        const seq = model.Sequences[seqIdx];
        const interval = seq?.Interval;
        const start = interval && interval.length >= 2 ? interval[0] : 0;
        const end = interval && interval.length >= 2 ? interval[1] : (start + 1000);
        const target = start + Math.max(0, Math.floor((end - start) * 0.5));

        if (cacheItem.staticFrameTime !== target) {
            delta = Math.max(0, target - start);
            cacheItem.staticFrameTime = target;
            cacheItem.lastTime = target;
        }
    }

    // --- USE CACHED AABB ---
    const rawAabb = cacheItem.aabb || { min: vec3.fromValues(-50, -50, -50), max: vec3.fromValues(50, 50, 50) };
    const min = vec3.clone(rawAabb.min);
    const max = vec3.clone(rawAabb.max);

    // --- ANIMATED SCALING COMPENSATION ---
    // If the root node(s) are scaled (e.g. 0.5), we must adjust the AABB so the camera frames correctly.
    if (model.Nodes && model.Nodes.length > 0) {
        // We use the time we're about to render (cacheItem.lastTime or static target)
        const activeTime = (freeze ? cacheItem.staticFrameTime : cacheItem.lastTime) || 0;
        const rootScale = getRootScale(model.Nodes, activeTime);
        if (Math.abs(rootScale - 1.0) > 0.001) {
            vec3.scale(min, min, rootScale);
            vec3.scale(max, max, rootScale);
        }
    }

    // --- CAMERA SETUP ---
    // Recalculate camera fit if scaling changed or not yet cached
    const cameraFit = computeThumbnailCameraFit(min, max);
    const target = vec3.fromValues(cameraFit.target[0], cameraFit.target[1], cameraFit.target[2]);
    const distance = cameraFit.distance;
    const phi = cameraFit.phi;
    const nowForSpin = Number.isFinite(frame) && frame > 0 ? frame : performance.now();
    const spinRadiansPerMs = (Math.max(0, Number(spinSpeed) || 0) * Math.PI) / 180 / 1000;
    const spinOffset = spinEnabled ? ((nowForSpin * spinRadiansPerMs) % (Math.PI * 2)) : 0;
    const theta = cameraFit.baseTheta + spinOffset;

    const cameraPos = vec3.fromValues(
        target[0] + distance * Math.sin(phi) * Math.cos(theta),
        target[1] + distance * Math.sin(phi) * Math.sin(theta),
        target[2] + distance * Math.cos(phi)
    );

    const pMatrix = mat4.create();
    const mvMatrix = mat4.create();
    mat4.perspective(pMatrix, cameraFit.fov, 1, 1, 100000);
    mat4.lookAt(mvMatrix, cameraPos, target, [0, 0, 1]);

    const cameraQuat = quat.create();
    const invMv = mat4.create();
    mat4.invert(invMv, mvMatrix);
    mat4.getRotation(cameraQuat, invMv);

    if (renderer.setCamera) renderer.setCamera(cameraPos, cameraQuat);
    if (renderer.update) renderer.update(delta);
    if (renderer.setCamera) renderer.setCamera(cameraPos, cameraQuat);
    if (renderer.setTeamColor) renderer.setTeamColor(resolveTeamColorVec(teamColor));
    if (renderer.setEnvironmentLight) {
        const lightDirection = normalizeVec3(envLightDirection, [0.577, -0.577, 0.577]);
        const lightColor = normalizeVec3(envLightColor, [1, 1, 1]);
        const ambientColor = normalizeVec3(envAmbientColor, [0.3, 0.3, 0.3]);

        if (envLightingEnabled) {
            renderer.setEnvironmentLight(lightDirection, lightColor, ambientColor);
        } else {
            renderer.setEnvironmentLight([0.577, -0.577, 0.577], [1, 1, 1], [0.3, 0.3, 0.3]);
        }
    }

    try {
        const modelInstance = (renderer as any)?.modelInstance;
        const particlesController = modelInstance?.particlesController;
        const ribbonsController = modelInstance?.ribbonsController;
        const noopRender = () => { };

        const originalParticleRender = particlesController?.render;
        const originalParticleRenderGPU = particlesController?.renderGPU;
        const originalRibbonRender = ribbonsController?.render;
        const originalRibbonRenderGPU = ribbonsController?.renderGPU;

        if (particlesController && !showParticles) {
            particlesController.render = noopRender;
            particlesController.renderGPU = noopRender;
        }
        if (ribbonsController && !showRibbons) {
            ribbonsController.render = noopRender;
            ribbonsController.renderGPU = noopRender;
        }

        try {
            const drawStart = performance.now();
            renderer.render(mvMatrix, pMatrix, { wireframe, enableLighting });
            drawMs = performance.now() - drawStart;
        } finally {
            if (particlesController) {
                particlesController.render = originalParticleRender;
                particlesController.renderGPU = originalParticleRenderGPU;
            }
            if (ribbonsController) {
                ribbonsController.render = originalRibbonRender;
                ribbonsController.renderGPU = originalRibbonRenderGPU;
            }
        }
    } catch (e) {
        console.error(`[Worker] WebGL render failed for ${fullPath}:`, e);
        // FORCE RELOAD on next try to recover from poisoned State/Buffers
        renderers.delete(fullPath);
    }

    const transferStart = performance.now();
    const bitmap = canvas!.transferToImageBitmap();
    const transferMs = performance.now() - transferStart;

    const renderMs = performance.now() - renderStartMs;
    return {
        bitmap,
        ...(coldStartMs > 0 ? { animations: (model.Sequences || []).map((s: any) => s.Name || 'Unknown') } : {}),
        ...(coldStartMs > 0 ? { texturePaths: cacheItem.texturePaths || [] } : {}),
        metrics: {
            renderMs,
            coldStartMs,
            parseMs,
            drawMs,
            transferMs
        }
    };
}

function readVec3(v: any): [number, number, number] | null {
    if (!v) return null;
    const a0 = Number(v[0]);
    const a1 = Number(v[1]);
    const a2 = Number(v[2]);
    if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(a2)) return null;
    return [a0, a1, a2];
}

function getModelMinMax(info: any): { min: [number, number, number], max: [number, number, number] } | null {
    const extentMin = readVec3(info?.Extent?.Min);
    const extentMax = readVec3(info?.Extent?.Max);
    if (extentMin && extentMax) return { min: extentMin, max: extentMax };

    const min = readVec3(info?.MinimumExtent);
    const max = readVec3(info?.MaximumExtent);
    if (min && max) return { min, max };

    const r = Number(info?.BoundsRadius);
    if (Number.isFinite(r) && r > 0) {
        return { min: [-r, -r, -r], max: [r, r, r] };
    }
    return null;
}

function getGeosetMinMax(geosets: any[] | undefined): { min: [number, number, number], max: [number, number, number] } | null {
    if (!Array.isArray(geosets) || geosets.length === 0) return null;

    // --- Per-geoset AABB analysis ---
    interface GeosetBounds {
        vertexCount: number;
        min: [number, number, number];
        max: [number, number, number];
        center: [number, number, number];
        diag: number;
    }
    const perGeoset: GeosetBounds[] = [];

    for (const geoset of geosets) {
        const vertices = geoset?.Vertices;
        if (!vertices || vertices.length < 3) continue;
        let gMinX = Infinity, gMinY = Infinity, gMinZ = Infinity;
        let gMaxX = -Infinity, gMaxY = -Infinity, gMaxZ = -Infinity;
        let count = 0;
        for (let i = 0; i + 2 < vertices.length; i += 3) {
            const x = Number(vertices[i]);
            const y = Number(vertices[i + 1]);
            const z = Number(vertices[i + 2]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
            if (x < gMinX) gMinX = x; if (x > gMaxX) gMaxX = x;
            if (y < gMinY) gMinY = y; if (y > gMaxY) gMaxY = y;
            if (z < gMinZ) gMinZ = z; if (z > gMaxZ) gMaxZ = z;
            count++;
        }
        if (count < 1) continue;
        const cx = (gMinX + gMaxX) * 0.5;
        const cy = (gMinY + gMaxY) * 0.5;
        const cz = (gMinZ + gMaxZ) * 0.5;
        const dx = gMaxX - gMinX, dy = gMaxY - gMinY, dz = gMaxZ - gMinZ;
        const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
        perGeoset.push({
            vertexCount: count,
            min: [gMinX, gMinY, gMinZ],
            max: [gMaxX, gMaxY, gMaxZ],
            center: [cx, cy, cz],
            diag
        });
    }

    if (perGeoset.length === 0) return null;
    if (perGeoset.length === 1) {
        return { min: perGeoset[0].min, max: perGeoset[0].max };
    }

    // Sort by vertex count descending — primary body has the most vertices
    const sorted = [...perGeoset].sort((a, b) => b.vertexCount - a.vertexCount);
    const primary = sorted[0];

    // Start with the primary geoset's bounds
    let mergedMin: [number, number, number] = [...primary.min];
    let mergedMax: [number, number, number] = [...primary.max];

    // Merge secondary geosets only if they don't inflate the bounds excessively.
    // Effect geosets (few vertices, large extent) are excluded.
    const primaryDiag = primary.diag;

    for (let i = 1; i < sorted.length; i++) {
        const sec = sorted[i];

        // Always include geosets with substantial vertex count (>25% of primary)
        // — these are real geometry, not effects
        const isSubstantial = sec.vertexCount > primary.vertexCount * 0.25;

        if (!isSubstantial) {
            // Check how much this geoset would inflate the current merged bounds
            const testMin: [number, number, number] = [...mergedMin];
            const testMax: [number, number, number] = [...mergedMax];
            for (let a = 0; a < 3; a++) {
                if (sec.min[a] < testMin[a]) testMin[a] = sec.min[a];
                if (sec.max[a] > testMax[a]) testMax[a] = sec.max[a];
            }
            const testDx = testMax[0] - testMin[0];
            const testDy = testMax[1] - testMin[1];
            const testDz = testMax[2] - testMin[2];
            const testDiag = Math.sqrt(testDx * testDx + testDy * testDy + testDz * testDz);
            const currentDx = mergedMax[0] - mergedMin[0];
            const currentDy = mergedMax[1] - mergedMin[1];
            const currentDz = mergedMax[2] - mergedMin[2];
            const currentDiag = Math.sqrt(currentDx * currentDx + currentDy * currentDy + currentDz * currentDz);

            // If adding this geoset inflates the diagonal by >20%, skip it
            if (currentDiag > 0 && testDiag / currentDiag > 1.2) {
                continue;
            }
        }

        for (let a = 0; a < 3; a++) {
            if (sec.min[a] < mergedMin[a]) mergedMin[a] = sec.min[a];
            if (sec.max[a] > mergedMax[a]) mergedMax[a] = sec.max[a];
        }
    }

    return { min: mergedMin, max: mergedMax };
}


function getTrimmedBounds(
    xs: number[],
    ys: number[],
    zs: number[],
    lowQ: number,
    highQ: number
): { min: [number, number, number], max: [number, number, number] } | null {
    if (xs.length === 0 || ys.length === 0 || zs.length === 0) return null;

    const sx = [...xs].sort((a, b) => a - b);
    const sy = [...ys].sort((a, b) => a - b);
    const sz = [...zs].sort((a, b) => a - b);

    const minX = quantileSorted(sx, lowQ);
    const maxX = quantileSorted(sx, highQ);
    const minY = quantileSorted(sy, lowQ);
    const maxY = quantileSorted(sy, highQ);
    const minZ = quantileSorted(sz, lowQ);
    const maxZ = quantileSorted(sz, highQ);

    if (
        !Number.isFinite(minX) || !Number.isFinite(maxX) ||
        !Number.isFinite(minY) || !Number.isFinite(maxY) ||
        !Number.isFinite(minZ) || !Number.isFinite(maxZ)
    ) {
        return null;
    }

    if (maxX <= minX || maxY <= minY || maxZ <= minZ) {
        return null;
    }

    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ]
    };
}

function quantileSorted(sorted: number[], q: number): number {
    if (sorted.length === 0) return NaN;
    const qq = Math.max(0, Math.min(1, q));
    const pos = (sorted.length - 1) * qq;
    const lo = Math.floor(pos);
    const hi = Math.min(sorted.length - 1, lo + 1);
    const t = pos - lo;
    return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function padBounds(
    min: [number, number, number],
    max: [number, number, number],
    factor: number
): { min: [number, number, number], max: [number, number, number] } {
    const cx = (min[0] + max[0]) * 0.5;
    const cy = (min[1] + max[1]) * 0.5;
    const cz = (min[2] + max[2]) * 0.5;

    const hx = Math.max((max[0] - min[0]) * 0.5 * (1 + factor), 0.5);
    const hy = Math.max((max[1] - min[1]) * 0.5 * (1 + factor), 0.5);
    const hz = Math.max((max[2] - min[2]) * 0.5 * (1 + factor), 0.5);

    return {
        min: [cx - hx, cy - hy, cz - hz],
        max: [cx + hx, cy + hy, cz + hz]
    };
}

function computeThumbnailCameraFit(min: any, max: any): ThumbnailCameraFit {
    const target = vec3.create();
    vec3.add(target, min, max);
    vec3.scale(target, target, 0.5);

    const extents = vec3.create();
    vec3.sub(extents, max, min);

    // For ground-standing models (minZ near 0), bias target upward
    // so the model doesn't appear to sink below center.
    // For floating/underground models, keep geometric center.
    if (Number.isFinite(extents[2]) && extents[2] > 0) {
        const minZ = Number(min[2]);
        const maxZ = Number(max[2]);
        if (Number.isFinite(minZ) && Number.isFinite(maxZ)) {
            // If the bottom is near ground (within 15% of height), use
            // a weighted center biased 40% from the bottom.
            if (Math.abs(minZ) < extents[2] * 0.15) {
                target[2] = minZ + extents[2] * 0.40;
            }
            // Otherwise keep geometric center (already set)
        }
    }

    const fov = Math.PI / 4;
    const baseTheta = Math.PI / 4;
    const phi = Math.PI / 3;
    const desiredFill = 0.92;

    const diagonal = Math.max(vec3.length(extents), 1);
    const radius = Math.max(1, diagonal * 0.5);
    let distance = radius / (Math.tan(fov * 0.5) * desiredFill);
    if (!Number.isFinite(distance)) distance = 300;
    distance = Math.max(30, Math.min(5000, distance));

    // Iterative refinement: project AABB corners and adjust distance
    const corners = getBoundsCorners(min, max);
    for (let i = 0; i < 5; i++) {
        const trialPos = vec3.fromValues(
            target[0] + distance * Math.sin(phi) * Math.cos(baseTheta),
            target[1] + distance * Math.sin(phi) * Math.sin(baseTheta),
            target[2] + distance * Math.cos(phi)
        );
        const trialP = mat4.create();
        const trialMv = mat4.create();
        const trialMvp = mat4.create();
        mat4.perspective(trialP, fov, 1, 1, 100000);
        mat4.lookAt(trialMv, trialPos, target, [0, 0, 1]);
        mat4.multiply(trialMvp, trialP, trialMv);
        const extent = computeMaxNdcExtent(corners, trialMvp);
        if (!Number.isFinite(extent) || extent <= 0.001) break;
        const scale = extent / desiredFill;
        const clampedScale = Math.max(0.5, Math.min(2.0, scale));
        const nextDistance = Math.max(30, Math.min(5000, distance * clampedScale));
        if (Math.abs(nextDistance - distance) < 0.5) break;
        distance = nextDistance;
    }

    distance = Math.max(30, Math.min(5000, distance));

    return {
        target: [target[0], target[1], target[2]],
        distance,
        fov,
        baseTheta,
        phi
    };
}

function getBoundsCorners(min: any, max: any): Array<[number, number, number]> {
    return [
        [min[0], min[1], min[2]],
        [min[0], min[1], max[2]],
        [min[0], max[1], min[2]],
        [min[0], max[1], max[2]],
        [max[0], min[1], min[2]],
        [max[0], min[1], max[2]],
        [max[0], max[1], min[2]],
        [max[0], max[1], max[2]]
    ];
}

/**
 * Compute the actual projected bounding box half-size in NDC space.
 * Returns max(half_width, half_height) of the projected AABB, which correctly
 * measures how much screen space the model occupies regardless of where its
 * center projects to.
 */
function computeMaxNdcExtent(corners: Array<[number, number, number]>, mvp: any): number {
    let ndcMinX = Infinity, ndcMaxX = -Infinity;
    let ndcMinY = Infinity, ndcMaxY = -Infinity;
    let validCount = 0;
    for (const [x, y, z] of corners) {
        const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
        const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
        const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
        if (!Number.isFinite(cw) || Math.abs(cw) < 1e-5) continue;
        const nx = cx / cw;
        const ny = cy / cw;
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
        if (nx < ndcMinX) ndcMinX = nx;
        if (nx > ndcMaxX) ndcMaxX = nx;
        if (ny < ndcMinY) ndcMinY = ny;
        if (ny > ndcMaxY) ndcMaxY = ny;
        validCount++;
    }
    if (validCount < 2) return 0;
    const halfWidth = (ndcMaxX - ndcMinX) * 0.5;
    const halfHeight = (ndcMaxY - ndcMinY) * 0.5;
    return Math.max(halfWidth, halfHeight);
}

/**
 * Detect the scaling of root nodes (Parent: -1) at a given time.
 * Returns the maximum component of the scaling vector if strictly uniform-ish, 
 * or just a heuristic average.
 */
function getRootScale(nodes: any[], time: number): number {
    let maxScale = 1.0;
    let found = false;

    for (const node of nodes) {
        if (node.Parent === -1) {
            const scaling = node.Scaling;
            if (scaling && scaling.Keys && scaling.Keys.length > 0) {
                const s = interpolateScaling(scaling.Keys, time, [1, 1, 1]);
                const nodeMax = Math.max(s[0], s[1], s[2]);
                if (!found || nodeMax > maxScale) {
                    maxScale = nodeMax;
                }
                found = true;
            }
        }
    }
    return maxScale;
}

function interpolateScaling(keys: any[], frame: number, defaultVal: number[]): number[] {
    if (!keys || keys.length === 0) return defaultVal;
    const sortedKeys = keys; // Usually sorted in MDX

    if (frame <= sortedKeys[0].Frame) return toArray(sortedKeys[0].Vector);
    if (frame >= sortedKeys[sortedKeys.length - 1].Frame) return toArray(sortedKeys[sortedKeys.length - 1].Vector);

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        if (frame >= sortedKeys[i].Frame && frame <= sortedKeys[i + 1].Frame) {
            const t = (frame - sortedKeys[i].Frame) / (sortedKeys[i + 1].Frame - sortedKeys[i].Frame);
            const from = toArray(sortedKeys[i].Vector);
            const to = toArray(sortedKeys[i + 1].Vector);
            return from.map((v, idx) => v + (to[idx] - v) * t);
        }
    }
    return defaultVal;
}


function validateAllParticleEmitters(model: any): void {
    if (!model.ParticleEmitters2) return;
    const textureCount = model.Textures?.length || 0;
    model.ParticleEmitters2.forEach((emitter: any) => {
        if (emitter.TextureID === undefined || emitter.TextureID < 0 || emitter.TextureID >= textureCount) emitter.TextureID = 0;

        // RibbonEmitter often missing some fields in war3-model
        let flags = typeof emitter.Flags === 'number' ? emitter.Flags : 0;
        if (emitter.Unshaded) flags |= 32768;
        if (emitter.ModelSpace) flags |= 524288;
        if ((flags & 3) === 0) flags |= 1;
        emitter.Flags = flags;

        const typedFields = { ParticleScaling: Float32Array, Alpha: Uint8Array };
        for (const [key, Type] of Object.entries(typedFields)) {
            if (emitter[key] && !(emitter[key] instanceof Type)) {
                emitter[key] = new Type(toArray(emitter[key]));
            }
        }
        if (emitter.SegmentColor && Array.isArray(emitter.SegmentColor)) {
            emitter.SegmentColor = emitter.SegmentColor.map((c: any) => new Float32Array(toArray(c)));
        }

        ['LifeSpanUVAnim', 'DecayUVAnim', 'TailUVAnim', 'TailDecayUVAnim'].forEach(prop => {
            let val = emitter[prop];
            if (val && !Array.isArray(val) && typeof val === 'object' && '0' in val) {
                val = [val['0'] ?? 0, val['1'] ?? 0, val['2'] ?? 1];
            }
            if (Array.isArray(val)) emitter[prop] = new Uint32Array(val);
        });
    });
}

function ensureRenderNodes(model: any): number {
    if (model?.Nodes && Array.isArray(model.Nodes)) {
        // Safety filter: remove any undefined or null entries that might have leaked in
        model.Nodes = model.Nodes.filter((n: any) => !!n);
    }

    if (model?.Nodes && model.Nodes.length > 0) {
        return model.Nodes[0].ObjectId ?? 0;
    }
    model.Nodes = [{
        Name: 'Root',
        ObjectId: 0,
        Parent: -1,
        PivotPoint: new Float32Array([0, 0, 0]),
        Flags: 0
    }];
    return 0;
}

function ensureGeosetGroups(model: any, defaultNodeId: number): void {
    if (!model?.Geosets) return;
    for (const geoset of model.Geosets) {
        const vertexCount = Math.floor(((geoset?.Vertices?.length || 0) as number) / 3);
        if (!geoset.Groups || geoset.Groups.length === 0) {
            geoset.Groups = [[defaultNodeId]];
        }
        if (!geoset.VertexGroup || geoset.VertexGroup.length !== vertexCount) {
            geoset.VertexGroup = new Uint16Array(vertexCount);
        }
        if (geoset.TotalGroupsCount === undefined || geoset.TotalGroupsCount === null) {
            geoset.TotalGroupsCount = geoset.Groups.length;
        }

        // Validate all VertexGroup indices point to valid Groups entries
        const maxGroupIndex = geoset.Groups.length - 1;
        for (let i = 0; i < geoset.VertexGroup.length; i++) {
            if (geoset.VertexGroup[i] > maxGroupIndex) {
                geoset.VertexGroup[i] = 0; // Reset to first group
            }
        }

        // Ensure all Groups have at least one valid entry
        for (let i = 0; i < geoset.Groups.length; i++) {
            if (!geoset.Groups[i] || !Array.isArray(geoset.Groups[i]) || geoset.Groups[i].length === 0) {
                geoset.Groups[i] = [defaultNodeId];
            }
        }
    }
}

function toArray(v: any): number[] {
    if (Array.isArray(v)) return v;
    if (typeof v === 'object' && v !== null && '0' in v) {
        const arr: number[] = [];
        for (let i = 0; v.hasOwnProperty(i); i++) arr.push(v[i]);
        return arr;
    }
    return [];
}

function hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
        return [
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255
        ];
    }
    return [0.2, 0.2, 0.2]; // Default gray
}

function normalizeVec3(value: any, fallback: [number, number, number]): [number, number, number] {
    if (!value || !Array.isArray(value) || value.length < 3) {
        return fallback;
    }

    const x = Number(value[0]);
    const y = Number(value[1]);
    const z = Number(value[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return fallback;
    }
    return [x, y, z];
}

function resolveTeamColorVec(teamColor: number): [number, number, number] {
    const palette: Array<[number, number, number]> = [
        [1.0, 0.0, 0.0], // red
        [0.0, 0.45, 1.0], // blue
        [0.0, 0.95, 0.95], // teal
        [0.65, 0.35, 1.0], // purple
        [1.0, 0.88, 0.0], // yellow
        [1.0, 0.55, 0.0], // orange
        [0.0, 0.85, 0.0], // green
        [1.0, 0.45, 0.7], // pink
        [0.7, 0.7, 0.7], // gray
        [0.55, 0.75, 1.0], // light blue
        [0.0, 0.6, 0.2], // dark green
        [0.65, 0.42, 0.22] // brown
    ];

    const idx = Math.max(0, Math.min(palette.length - 1, Math.floor(Number(teamColor) || 0)));
    return palette[idx];
}
