import decodeJPEG from '../third_party/decoder';
import { BLPImage, BLPContent, BLPType } from './blpimage';

function keyword(view: DataView, offset: number): string {
    return String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
    );
}

function uint32(view: DataView, offset: number): number {
    return view.getUint32(offset * 4, true);
}

function bitVal(data: Uint8Array, bitCount: number, index: number): number {
    // only 1, 4 or 8 bits
    const byte = data[Math.floor(index * bitCount / 8)],
        valsPerByte = 8 / bitCount;

    return (byte >> (valsPerByte - index % valsPerByte - 1)) & ((1 << bitCount) - 1);
}

interface ImageDataLike {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    colorSpace: 'srgb' | 'display-p3' | undefined;
}

// node.js have no native ImageData
function createImageData(width: number, height: number): ImageDataLike {
    if (typeof ImageData !== 'undefined') {
        return new ImageData(width, height);
    } else {
        return {
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4),
            colorSpace: 'srgb'
        };
    }
}

export function decode(arrayBuffer: ArrayBuffer): BLPImage {
    const view = new DataView(arrayBuffer);

    const image: BLPImage = {
        type: BLPType.BLP1,
        width: 0,
        height: 0,
        content: BLPContent.JPEG,
        alphaBits: 0,
        mipmaps: [],
        data: arrayBuffer,
    };

    const type = keyword(view, 0);

    if (type === 'BLP0' || type === 'BLP2') {
        throw new Error('BLP0/BLP2 not supported');
    }
    if (type !== 'BLP1') {
        throw new Error('Not a blp image');
    }

    image.content = uint32(view, 1);

    if (image.content !== BLPContent.JPEG && image.content !== BLPContent.Direct) {
        throw new Error('Unknown BLP content');
    }

    image.alphaBits = uint32(view, 2);
    image.width = uint32(view, 3);
    image.height = uint32(view, 4);

    for (let i = 0; i < 16; ++i) {
        const mipmap = {
            offset: uint32(view, 7 + i),
            size: uint32(view, 7 + 16 + i)
        };

        if (mipmap.size > 0) {
            image.mipmaps.push(mipmap);
        } else {
            break;
        }
    }

    return image;
}

export function getImageData(blp: BLPImage, mipmapLevel: number): ImageDataLike {
    const view = new DataView(blp.data),
        uint8Data = new Uint8Array(blp.data),
        mipmap = blp.mipmaps[mipmapLevel];

    if (blp.content === BLPContent.JPEG) {
        const headerSize = uint32(view, 39),
            data = new Uint8Array(headerSize + mipmap.size);

        data.set(uint8Data.subarray(40 * 4, 40 * 4 + headerSize));
        data.set(uint8Data.subarray(mipmap.offset, mipmap.offset + mipmap.size), headerSize);

        return decodeJPEG(data);
    } else {
        const palette = new Uint8Array(blp.data, 39 * 4, 256 * 4),
            width = blp.width / (1 << mipmapLevel),
            height = blp.height / (1 << mipmapLevel),
            size = width * height,
            alphaData = new Uint8Array(blp.data, mipmap.offset + size, Math.ceil(size * blp.alphaBits / 8)),
            imageData = createImageData(width, height),
            valPerAlphaBit = 255 / ((1 << blp.alphaBits) - 1);

        // Optimization: Use Uint32Array view for 4x faster writes
        const data32 = new Uint32Array(imageData.data.buffer);
        const palette32 = new Uint32Array(256);

        // Pre-build 32-bit palette (Host order: ABGR for Little Endian)
        for (let i = 0; i < 256; i++) {
            const p = i * 4;
            // Native ImageData order is RGBA (bytes 0,1,2,3)
            // On Little Endian: 0xAA BB GG RR -> [RR, GG, BB, AA]
            palette32[i] = (255 << 24) | (palette[p] << 16) | (palette[p + 1] << 8) | palette[p + 2];
        }

        if (blp.alphaBits === 8) {
            // Fast path for 8-bit alpha
            for (let i = 0; i < size; i++) {
                const paletteIndex = uint8Data[mipmap.offset + i];
                const color = palette32[paletteIndex];
                const alpha = alphaData[i];
                // Overwrite alpha byte in the 32-bit word
                data32[i] = (color & 0x00FFFFFF) | (alpha << 24);
            }
        } else if (blp.alphaBits === 0) {
            // Fast path for no alpha
            for (let i = 0; i < size; i++) {
                data32[i] = palette32[uint8Data[mipmap.offset + i]];
            }
        } else {
            // Slower path for 1-bit or 4-bit alpha
            for (let i = 0; i < size; i++) {
                const paletteIndex = uint8Data[mipmap.offset + i];
                const color = palette32[paletteIndex];
                const alpha = bitVal(alphaData, blp.alphaBits, i) * valPerAlphaBit;
                data32[i] = (color & 0x00FFFFFF) | (alpha << 24);
            }
        }

        return imageData;
    }
}
