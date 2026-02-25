/**
 * model-worker.worker.ts
 * 
 * General purpose worker for heavy model operations:
 * 1. Model Parsing (MDX/MDL)
 * 2. Texture Decoding (BLP/TGA)
 */

// @ts-ignore
import { parseMDX, parseMDL, decodeBLP, getBLPImageData } from 'war3-model';

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

    let offset = 0;
    let pixelIndex = 0;

    const getPixel = (data: Uint8Array, idx: number, depth: number): number[] => {
        if (depth === 24) return [data[idx + 2], data[idx + 1], data[idx], 255];
        if (depth === 32) return [data[idx + 2], data[idx + 1], data[idx], data[idx + 3]];
        if (depth === 8) { const v = data[idx]; return [v, v, v, 255]; }
        return [0, 0, 0, 0];
    };

    // simplified uncompressed reader for now
    for (let i = 0; i < pixelCount; i++) {
        const pv = getPixel(tgaData, offset, header.pixelDepth);
        outputData[i * 4] = pv[0];
        outputData[i * 4 + 1] = pv[1];
        outputData[i * 4 + 2] = pv[2];
        outputData[i * 4 + 3] = pv[3];
        offset += bytesPerPixel;
    }

    // Flip vertically if origin is bottom-left
    const isTopLeft = (header.imageDesc & 0x20) !== 0;
    if (!isTopLeft) {
        const rowBytes = header.width * 4;
        const tmp = new Uint8ClampedArray(rowBytes);
        for (let y = 0; y < Math.floor(header.height / 2); y++) {
            const topOff = y * rowBytes;
            const botOff = (header.height - 1 - y) * rowBytes;
            tmp.set(outputData.subarray(topOff, topOff + rowBytes));
            outputData.copyWithin(topOff, botOff, botOff + rowBytes);
            outputData.set(tmp, botOff);
        }
    }

    return new ImageData(outputData, header.width, header.height);
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    try {
        if (type === 'PARSE_MODEL') {
            const { buffer, path } = payload;
            let model: any;
            if (path.toLowerCase().endsWith('.mdl')) {
                const text = new TextDecoder().decode(buffer);
                model = parseMDL(text);
            } else {
                model = parseMDX(buffer);
            }

            if (!model) throw new Error('Failed to parse model');

            // @ts-ignore
            self.postMessage({ type: 'PARSE_SUCCESS', payload: { model } });
        }
        else if (type === 'DECODE_TEXTURE') {
            const { buffer, path, id, maxDimension, preferBlpBaseMip } = payload;
            let imageData: ImageData | null = null;

            if (path.toLowerCase().endsWith('.tga')) {
                imageData = decodeTGA(buffer);
                // TGA doesn't have mips, but we could downscale here if needed.
                // However, for speed, BLP mips are the priority.
            } else {
                const blp = decodeBLP(buffer);

                // Choose optimal mip level based on maxDimension
                let mipLevel = 0;
                if (!preferBlpBaseMip && maxDimension > 0) {
                    const width = blp.width || 0;
                    const height = blp.height || 0;
                    const maxSide = Math.max(width, height);
                    if (maxSide > maxDimension) {
                        mipLevel = Math.max(0, Math.floor(Math.log2(maxSide / maxDimension)));
                    }
                }

                // Get selected mip
                let mip;
                try {
                    mip = getBLPImageData(blp, mipLevel);
                } catch (e) {
                    mip = getBLPImageData(blp, 0); // Fallback to base mip
                }

                const data = mip.data instanceof Uint8ClampedArray ? mip.data : new Uint8ClampedArray(mip.data);
                imageData = new ImageData(data, mip.width, mip.height);
            }

            if (!imageData) throw new Error('Failed to decode texture');

            // Convert to ImageBitmap for faster transfer.
            // CRITICAL: MUST set premultiplyAlpha to 'none' otherwise WebGL loses RGB data on transparent pixels, rendering them black!
            const bitmap = await createImageBitmap(imageData, { premultiplyAlpha: 'none' });

            // @ts-ignore
            self.postMessage({
                type: 'DECODE_SUCCESS',
                payload: { bitmap, id, path }
            }, [bitmap]);
        }
    } catch (err: any) {
        // @ts-ignore
        self.postMessage({
            type: 'ERROR',
            payload: { error: err.message, stack: err.stack, id: payload?.id }
        });
    }
};
