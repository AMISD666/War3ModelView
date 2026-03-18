/**
 * model-worker.worker.ts
 * 
 * General purpose worker for heavy model operations:
 * 1. Model Parsing (MDX/MDL)
 * 2. Texture Decoding (BLP/TGA)
 */

// @ts-ignore
import { parseMDX, parseMDL, decodeBLP, getBLPImageData } from 'war3-model';

interface DecodeTextureTaskPayload {
    id: string;
    path: string;
    buffer: ArrayBuffer;
    maxDimension?: number;
    preferBlpBaseMip?: boolean;
}

/**
 * TGA Decoding logic (similar to thumbnail.worker.ts)
 */
function decodeTGA(buffer: ArrayBuffer): ImageData {
    const view = new DataView(buffer);
    const header = {
        idLength: view.getUint8(0),
        colorMapType: view.getUint8(1),
        imageType: view.getUint8(2),
        width: view.getUint16(12, true),
        height: view.getUint16(14, true),
        pixelDepth: view.getUint8(16),
        imageDesc: view.getUint8(17)
    };

    const tgaData = new Uint8Array(buffer, 18 + header.idLength);
    const pixelCount = header.width * header.height;
    const bytesPerPixel = header.pixelDepth >> 3;
    const outputData = new Uint8ClampedArray(pixelCount * 4);

    const data32 = new Uint32Array(outputData.buffer);

    let offset = 0;
    if (header.pixelDepth === 24) {
        for (let i = 0; i < pixelCount; i++) {
            data32[i] = (255 << 24) | (tgaData[offset + 2] << 16) | (tgaData[offset + 1] << 8) | tgaData[offset];
            offset += bytesPerPixel;
        }
    } else if (header.pixelDepth === 32) {
        for (let i = 0; i < pixelCount; i++) {
            data32[i] = (tgaData[offset + 3] << 24) | (tgaData[offset + 2] << 16) | (tgaData[offset + 1] << 8) | tgaData[offset];
            offset += bytesPerPixel;
        }
    } else if (header.pixelDepth === 8) {
        for (let i = 0; i < pixelCount; i++) {
            const v = tgaData[offset];
            data32[i] = (255 << 24) | (v << 16) | (v << 8) | v;
            offset += bytesPerPixel;
        }
    } else {
        // Unsupported pixel depth, fill with black or throw error
        for (let i = 0; i < pixelCount; i++) {
            data32[i] = 0xFF000000; // Opaque black
        }
    }

    // Flip vertically if origin is bottom-left
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

    return new ImageData(outputData, header.width, header.height);
}

function chooseBlpMipLevel(blp: any, maxDimension?: number, preferBlpBaseMip?: boolean): number {
    if (preferBlpBaseMip) return 0;
    if (!maxDimension || maxDimension <= 0) return 0;

    const width = Number(blp?.width ?? blp?.Width ?? 0);
    const height = Number(blp?.height ?? blp?.Height ?? 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return 0;
    }

    const maxSide = Math.max(width, height);
    if (maxSide <= maxDimension) return 0;
    return Math.max(0, Math.floor(Math.log2(maxSide / maxDimension)));
}

async function decodeTextureToBitmap(task: DecodeTextureTaskPayload): Promise<ImageBitmap> {
    const { buffer, path, maxDimension, preferBlpBaseMip } = task;
    let imageData: ImageData | null = null;

    if (path.toLowerCase().endsWith('.tga')) {
        imageData = decodeTGA(buffer);
    } else {
        const blp = decodeBLP(buffer);
        const mipLevel = chooseBlpMipLevel(blp, maxDimension, preferBlpBaseMip);

        let mip;
        try {
            mip = getBLPImageData(blp, mipLevel);
        } catch (e) {
            mip = getBLPImageData(blp, 0);
        }

        const data = mip.data instanceof Uint8ClampedArray ? mip.data : new Uint8ClampedArray(mip.data);
        imageData = new ImageData(data, mip.width, mip.height);
    }

    if (!imageData) {
        throw new Error('Failed to decode texture');
    }

    // CRITICAL: MUST set premultiplyAlpha to 'none' otherwise WebGL loses RGB data on transparent pixels.
    return await createImageBitmap(imageData, { premultiplyAlpha: 'none' });
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    try {
        if (type === 'PARSE_MODEL') {
            const { buffer, path } = payload;
            const parseStart = performance.now();
            let model: any;
            if (path.toLowerCase().endsWith('.mdl')) {
                const text = new TextDecoder().decode(buffer);
                model = parseMDL(text);
            } else {
                model = parseMDX(buffer);
            }

            if (!model) throw new Error('Failed to parse model');

            (self as any).postMessage({
                type: 'PARSE_SUCCESS',
                payload: {
                    model,
                    parseMs: performance.now() - parseStart
                }
            });
        }
        else if (type === 'DECODE_TEXTURE') {
            const { id, path } = payload as DecodeTextureTaskPayload;
            const bitmap = await decodeTextureToBitmap(payload as DecodeTextureTaskPayload);
            (self as any).postMessage({
                type: 'DECODE_SUCCESS',
                payload: { bitmap, id, path }
            }, [bitmap]);
        }
        else if (type === 'DECODE_TEXTURE_BATCH') {
            const { id, tasks } = payload as { id: string; tasks: DecodeTextureTaskPayload[] };
            if (!id || !Array.isArray(tasks)) {
                throw new Error('Invalid texture batch payload');
            }

            const results: Array<{ id: string; path: string; bitmap: ImageBitmap }> = [];
            const errors: Array<{ id: string; path: string; error: string }> = [];
            const transfer: Transferable[] = [];

            for (const task of tasks) {
                try {
                    const bitmap = await decodeTextureToBitmap(task);
                    results.push({ id: task.id, path: task.path, bitmap });
                    transfer.push(bitmap);
                } catch (taskErr: any) {
                    errors.push({
                        id: task.id,
                        path: task.path,
                        error: taskErr?.message ? String(taskErr.message) : 'Texture decode failed'
                    });
                }
            }

            (self as any).postMessage({
                type: 'DECODE_BATCH_SUCCESS',
                payload: { id, results, errors }
            }, transfer);
        }
    } catch (err: any) {
        (self as any).postMessage({
            type: 'ERROR',
            payload: { error: err.message, stack: err.stack, id: payload?.id }
        });
    }
};
