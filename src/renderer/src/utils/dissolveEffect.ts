/**
 * Dissolve Effect - Core execution logic
 * Composites a dissolve texture into the alpha channel of affected model textures,
 * then sets up material layer Alpha keyframes and FilterMode.
 */

export interface DissolveEffectParams {
    selectedGeosets: number[];
    dissolveTexturePath: string;
    dissolveStartFrame: number;
    dissolveEndFrame: number;
    seqStart: number;
    seqEnd: number;
    saveMode: 'overwrite' | 'saveAs';
}

export interface DissolveEffectResult {
    materials: any[];
    textures: any[];
    textureModifiedCount: number;
    materialModifiedCount: number;
}

function resizeImageData(source: ImageData, tw: number, th: number): ImageData {
    if (source.width === tw && source.height === th) return source;
    const sc = document.createElement('canvas');
    sc.width = source.width; sc.height = source.height;
    const sctx = sc.getContext('2d', { alpha: true, willReadFrequently: true })!;
    sctx.putImageData(source, 0, 0);
    const dc = document.createElement('canvas');
    dc.width = tw; dc.height = th;
    const dctx = dc.getContext('2d', { alpha: true, willReadFrequently: true })!;
    dctx.drawImage(sc, 0, 0, tw, th);
    return dctx.getImageData(0, 0, tw, th);
}

function addPathSuffix(path: string, suffix: string): string {
    const lastDot = path.lastIndexOf('.');
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    if (lastDot < 0 || lastDot < lastSlash) return path + suffix;
    return path.substring(0, lastDot) + suffix + path.substring(lastDot);
}

export async function executeDissolveEffect(
    modelData: any,
    modelPath: string,
    params: DissolveEffectParams
): Promise<DissolveEffectResult> {
    const { readFile, writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
    const { invoke } = await import('@tauri-apps/api/core');
    const { decodeTexture, decodeTextureData, getTextureCandidatePaths } = await import('../components/viewer/textureLoader');

    const geosets = modelData.Geosets || [];
    const materials = (modelData.Materials || []).map((m: any) => ({ ...m, Layers: m.Layers ? m.Layers.map((l: any) => ({ ...l })) : [] }));
    const textures = (modelData.Textures || []).map((t: any) => ({ ...t }));

    // 1. Find affected MaterialIDs
    const affectedMatIds = new Set<number>();
    params.selectedGeosets.forEach(idx => {
        const g = geosets[idx];
        if (g && typeof g.MaterialID === 'number') affectedMatIds.add(g.MaterialID);
    });
    if (affectedMatIds.size === 0) throw new Error('选中的多边形组没有关联的材质');

    // 2. Find affected TextureIDs
    const affectedTexIds = new Set<number>();
    affectedMatIds.forEach(matIdx => {
        if (matIdx < 0 || matIdx >= materials.length) return;
        const mat = materials[matIdx];
        if (!mat?.Layers) return;
        mat.Layers.forEach((layer: any) => {
            const texId = typeof layer.TextureID === 'number' ? layer.TextureID : -1;
            if (texId >= 0 && texId < textures.length) {
                const tex = textures[texId];
                if (tex?.ReplaceableId && tex.ReplaceableId > 0) return;
                if (!tex?.Image) return;
                affectedTexIds.add(texId);
            }
        });
    });

    // 3. Decode dissolve texture
    const dissolveBuffer = await readFile(params.dissolveTexturePath);
    let dissolveImageData: ImageData | null = null;
    if (params.dissolveTexturePath.toLowerCase().endsWith('.png')) {
        const blob = new Blob([dissolveBuffer], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bitmap.width; c.height = bitmap.height;
        const ctx = c.getContext('2d', { alpha: true, willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0);
        dissolveImageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    } else {
        dissolveImageData = decodeTextureData(dissolveBuffer.buffer as ArrayBuffer, params.dissolveTexturePath);
    }
    if (!dissolveImageData) throw new Error('消散贴图解码失败');

    // 4. Process each affected texture: composite dissolve luminance → alpha channel
    let textureModifiedCount = 0;
    const modelDir = modelPath.substring(0, Math.max(modelPath.lastIndexOf('\\'), modelPath.lastIndexOf('/')));

    for (const texId of affectedTexIds) {
        const tex = textures[texId];
        const imagePath = tex?.Image;
        if (!imagePath) continue;

        try {
            const origResult = await decodeTexture(imagePath, modelPath);
            if (!origResult.imageData) continue;

            const origData = origResult.imageData;
            const dResized = resizeImageData(dissolveImageData, origData.width, origData.height);

            // Composite: dissolve luminance → inverted alpha, then overlay 75% white
            const oD = origData.data, dD = dResized.data;
            for (let i = 0; i < oD.length; i += 4) {
                const luma = 0.299 * dD[i] + 0.587 * dD[i + 1] + 0.114 * dD[i + 2];
                const baseAlpha = 255 - luma;
                // Overlay 75% opacity white: result = base * 0.25 + 255 * 0.75
                oD[i + 3] = Math.round(baseAlpha * 0.25 + 191.25);
            }

            // Save modified texture based on mode
            const newImagePath = params.saveMode === 'overwrite' ? imagePath : addPathSuffix(imagePath, '_dissolve');
            const outputPath = `${modelDir}\\${newImagePath.replace(/\//g, '\\\\')}`;
            const outputDir = outputPath.substring(0, Math.max(outputPath.lastIndexOf('\\'), outputPath.lastIndexOf('/')));
            if (outputDir) await mkdir(outputDir, { recursive: true }).catch(() => { });

            const ext = imagePath.toLowerCase().split('.').pop() || 'blp';
            const payload = await invoke<any>('encode_texture_image', {
                rgba: Array.from(origData.data), width: origData.width, height: origData.height, format: ext, blpQuality: 90,
            });

            let bytes: Uint8Array | null = null;
            if (payload instanceof Uint8Array) bytes = payload;
            else if (payload instanceof ArrayBuffer) bytes = new Uint8Array(payload);
            else if (ArrayBuffer.isView(payload)) bytes = new Uint8Array((payload as any).buffer, (payload as any).byteOffset, (payload as any).byteLength);
            else if (Array.isArray(payload)) bytes = new Uint8Array(payload);

            if (!bytes || bytes.byteLength === 0) continue;

            await writeFile(outputPath, bytes);
            tex.Image = newImagePath;
            if (tex.Path !== undefined) tex.Path = newImagePath;
            textureModifiedCount++;
        } catch (e: any) {
            console.warn(`[Dissolve] Failed to process texture ${imagePath}:`, e);
        }
    }

    // 6. Update material layers: Merge Alpha keyframes + FilterMode fix
    let materialModifiedCount = 0;
    affectedMatIds.forEach(matIdx => {
        if (matIdx < 0 || matIdx >= materials.length) return;
        const mat = materials[matIdx];
        if (!mat?.Layers) return;
        mat.Layers.forEach((layer: any) => {
            let existingKeys: any[] = [];
            let lineType = 1;
            let globalSeqId = null;
            let baseAlpha = 1;

            if (typeof layer.Alpha === 'number') {
                baseAlpha = layer.Alpha;
            } else if (layer.Alpha && typeof layer.Alpha === 'object' && Array.isArray(layer.Alpha.Keys)) {
                existingKeys = layer.Alpha.Keys;
                lineType = layer.Alpha.LineType !== undefined ? layer.Alpha.LineType : 1;
                globalSeqId = layer.Alpha.GlobalSeqId !== undefined ? layer.Alpha.GlobalSeqId : null;
            }

            // Simple sample function to isolate keyframes
            const sampleAlpha = (frame: number) => {
                if (existingKeys.length === 0) return baseAlpha;
                let val = existingKeys[0].Vector[0];
                for (const k of existingKeys) {
                    if (k.Frame <= frame) val = k.Vector[0];
                    else break;
                }
                return val;
            };

            // Build sequence-specific keys adapted to this layer's base Alpha
            const layerStartVal = sampleAlpha(params.seqStart);
            const frameSet = new Map<number, number>();
            frameSet.set(params.seqStart, layerStartVal);
            frameSet.set(params.dissolveStartFrame, layerStartVal * 0.75);
            frameSet.set(params.dissolveEndFrame, 0);
            if (params.seqEnd > params.dissolveEndFrame) frameSet.set(params.seqEnd, 0);

            // Left and Right Boundary isolation to prevent bleeding into other sequences
            const leftBoundary = Math.max(0, params.seqStart - 1);
            const rightBoundary = params.seqEnd + 1;
            
            // Keep keyframes completely OUTSIDE the interval
            const preservedKeys = existingKeys.filter(k => k.Frame < params.seqStart || k.Frame > params.seqEnd);

            if (!preservedKeys.some(k => k.Frame === leftBoundary) && params.seqStart > 0) {
                frameSet.set(leftBoundary, sampleAlpha(leftBoundary));
            }
            if (!preservedKeys.some(k => k.Frame === rightBoundary)) {
                frameSet.set(rightBoundary, sampleAlpha(rightBoundary));
            }

            const newKeys = Array.from(frameSet.entries()).map(([f, v]) => ({ Frame: f, Vector: [v] }));

            // Merge and sort
            const mergedKeys = [...preservedKeys, ...newKeys]
                .map(k => ({ Frame: k.Frame, Vector: new Float32Array([...k.Vector]) }))
                .sort((a, b) => a.Frame - b.Frame);

            layer.Alpha = {
                LineType: lineType,
                GlobalSeqId: globalSeqId,
                Keys: mergedKeys,
            };

            if ((typeof layer.FilterMode === 'number' ? layer.FilterMode : 0) === 0) layer.FilterMode = 1;
        });
        materialModifiedCount++;
    });

    return { materials, textures, textureModifiedCount, materialModifiedCount };
}
