/**
 * thumbnail.worker.ts
 * 
 * This worker runs in a separate thread to provide TOTAL ISOLATION
 * for the war3-model library's rendering state.
 */

// @ts-ignore
import { parseMDX, parseMDL, ModelRenderer } from 'war3-model';
import { mat4, vec3, quat } from 'gl-matrix';

let canvas: OffscreenCanvas | null = null;
let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

interface RendererCacheItem {
    renderer: any;
    model: any;
    lastSequence: number;
    lastTime: number;
    aabb?: { min: any, max: any };
    textureImages?: Record<string, ImageData>;
    teamColorData?: Record<number, any>;
}

let renderers: Map<string, RendererCacheItem> = new Map();

const CACHE_LIMIT = 64;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'RENDER') {
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
        });
        renderers.clear();

        self.postMessage({ type: 'CLEARED' });
    }
};

async function initGL() {
    if (gl) return;

    canvas = new OffscreenCanvas(256, 256);
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

async function render(
    payload: {
        fullPath: string,
        modelBuffer?: ArrayBuffer,
        textureImages?: Record<string, ImageData>,
        teamColorData?: Record<number, any>,
        frame?: number,
        sequenceIndex?: number,
        backgroundColor?: string
    }
) {
    const { fullPath, modelBuffer, textureImages, teamColorData, frame = 0, sequenceIndex = 0, backgroundColor = '#333333' } = payload;

    await initGL();
    if (!gl) return null;

    let item = renderers.get(fullPath);

    if (!item) {
        if (!modelBuffer) {
            throw new Error(`Model data missing and not in cache: ${fullPath}`);
        }

        let model: any;
        if (fullPath.toLowerCase().endsWith('.mdl')) {
            const text = new TextDecoder().decode(modelBuffer);
            model = parseMDL(text);
        } else {
            model = parseMDX(modelBuffer);
        }

        if (!model) throw new Error('Failed to parse model');

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
                // The provided code snippet for `scanDirV2` seems to be out of context for this worker file.
                // It references `modelFiles` and `@tauri-apps/plugin-fs`, which are not part of this worker's scope.
                // Assuming the intent was to add recovery logic to the worker, and the `scanDirV2`
                // was a misplaced instruction or example from another file, I will proceed with the
                // original cache cleanup logic, as inserting `scanDirV2` here would cause syntax errors
                // and undefined references.
                // If the intention was to replace `renderers.delete(oldestKey);` with `scanDirV2`,
                // that would break the cache cleanup logic.
                // Therefore, I'm keeping the original `renderers.delete(oldestKey);` line.
                renderers.delete(oldestKey);
            }
        }

        const renderer = new ModelRenderer(model);
        renderer.initGL(gl);

        if (textureImages) {
            for (const [path, img] of Object.entries(textureImages)) {
                if (renderer.setTextureImageData) {
                    renderer.setTextureImageData(path, [img]);
                }
            }
        }

        if (teamColorData && renderer.setReplaceableTexture) {
            for (const [id, img] of Object.entries(teamColorData)) {
                try {
                    let source: any = img;
                    if (!(img instanceof ImageData) && (img as any).data) {
                        source = new ImageData(new Uint8ClampedArray((img as any).data), (img as any).width, (img as any).height);
                    }
                    const bitmap = await createImageBitmap(source);
                    renderer.setReplaceableTexture(parseInt(id), bitmap);
                } catch (e) {
                    console.warn(`[Worker] Replaceable texture error ${id}:`, e);
                }
            }
        }

        // --- PRE-CALCULATE AABB ONCE ---
        const min = vec3.fromValues(Infinity, Infinity, Infinity);
        const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
        let hasValidBounds = false;

        if (model.Geosets) {
            for (const g of model.Geosets) {
                if (g.Vertices) {
                    for (let i = 0; i < g.Vertices.length; i += 3) {
                        const x = g.Vertices[i], y = g.Vertices[i + 1], z = g.Vertices[i + 2];
                        if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
                        if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
                        if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
                        hasValidBounds = true;
                    }
                }
            }
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
            lastTime: frame || performance.now(), // Use the passed frame timestamp to synchronize with generator
            aabb: { min, max },
            textureImages,
            teamColorData
        };
        renderers.set(fullPath, item);
    }

    // At this point item is guaranteed to exist
    const cacheItem = item!;
    const { renderer, model } = cacheItem;

    // === CRITICAL: Complete WebGL state reset for proper clearing ===
    // When preserveDrawingBuffer=false (or even true), we must ensure all masks are enabled
    // before gl.clear() or the clear won't affect masked channels, leading to residuals.
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);  // Enable all color channels
    gl.depthMask(true);                     // Enable depth writes
    gl.stencilMask(0xFFFFFFFF);            // Enable all stencil bits

    // Clear with user-specified background color
    const bgRgb = hexToRgb(backgroundColor);
    gl.clearColor(bgRgb[0], bgRgb[1], bgRgb[2], 1.0);
    gl.clearDepth(1.0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // Set viewport
    gl.viewport(0, 0, 256, 256);

    // Standard render state
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);

    // Animation Update - only change sequence when needed
    if (model.Sequences && model.Sequences.length > 0) {
        const seqIdx = Math.max(0, Math.min(sequenceIndex, model.Sequences.length - 1));
        if (cacheItem.lastSequence !== seqIdx) {
            try {
                if (renderer.setSequence) renderer.setSequence(seqIdx);
                // CRITICAL: Update with 0 delta to refresh visibility and buffers for the new sequence
                if (renderer.update) renderer.update(0);
                cacheItem.lastSequence = seqIdx;
            } catch (e) {
                console.warn(`[Worker] Failed to set sequence ${seqIdx}:`, e);
            }
        }
    }

    // Calculate proper delta time for smooth animation
    const now = frame || performance.now();
    // Delta stabilization: If lastTime is too far back or 0, reset to 16ms
    const rawDelta = now - cacheItem.lastTime;
    const delta = (cacheItem.lastTime > 0 && rawDelta > 0) ? Math.min(rawDelta, 100) : 16;
    cacheItem.lastTime = now;

    // --- USE CACHED AABB ---
    const { min, max } = cacheItem.aabb || { min: vec3.fromValues(-50, -50, -50), max: vec3.fromValues(50, 50, 50) };


    // --- CAMERA SETUP (Front Portrait View) ---
    const target = vec3.create();
    vec3.add(target, min, max); vec3.scale(target, target, 0.5);
    const size = vec3.distance(min, max);
    const modelSize = Math.max(size, 80);
    const fov = Math.PI / 4;
    const finalDistance = Math.max((modelSize / 2) / Math.tan(fov / 2) / 0.95, 50);

    // Elevated 45-degree-ish view with slightly closer framing
    const baseOffsetX = finalDistance * 0.2;
    const baseOffsetY = -finalDistance * 0.8;
    const zRotate = 55 * Math.PI / 180;
    const rotOffsetX = baseOffsetX * Math.cos(zRotate) - baseOffsetY * Math.sin(zRotate);
    const rotOffsetY = baseOffsetX * Math.sin(zRotate) + baseOffsetY * Math.cos(zRotate);
    const cameraPos = vec3.fromValues(
        target[0] + rotOffsetX,
        target[1] + rotOffsetY,
        target[2] + finalDistance * 0.8
    );

    const pMatrix = mat4.create();
    const mvMatrix = mat4.create();
    mat4.perspective(pMatrix, fov, 1, 1, 100000);
    mat4.lookAt(mvMatrix, cameraPos, target, [0, 0, 1]);

    const cameraQuat = quat.create();
    const invMv = mat4.create();
    mat4.invert(invMv, mvMatrix);
    mat4.getRotation(cameraQuat, invMv);

    if (renderer.setCamera) renderer.setCamera(cameraPos, cameraQuat);
    if (renderer.update) renderer.update(delta);
    if (renderer.setTeamColor) renderer.setTeamColor(0);
    if (renderer.setEnvironmentLight) {
        renderer.setEnvironmentLight([0.577, -0.577, 0.577], [1, 1, 1], [0.3, 0.3, 0.3]);
    }

    try {
        renderer.render(mvMatrix, pMatrix, { wireframe: false, enableLighting: true });
        gl!.flush(); // Ensure GPU is done before transfer
    } catch (e) {
        console.error(`[Worker] WebGL Render failed for ${fullPath}:`, e);
        // FORCE RELOAD on next try to recover from poisoned State/Buffers
        renderers.delete(fullPath);
    }

    const bitmap = canvas!.transferToImageBitmap();
    return { bitmap, animations: (model.Sequences || []).map((s: any) => s.Name || 'Unknown') };
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
