export interface TextureAdjustments {
    hue: number; // -180..180
    brightness: number; // 0..200 (%)
    saturation: number; // 0..200 (%)
    opacity: number; // 0..200 (%)
}

export const TEXTURE_ADJUSTMENTS_KEY = '__wmvAdjustments';

export const DEFAULT_TEXTURE_ADJUSTMENTS: TextureAdjustments = {
    hue: 0,
    brightness: 100,
    saturation: 100,
    opacity: 100
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const normalizeTextureAdjustments = (value: any): TextureAdjustments => ({
    hue: clamp(Number(value?.hue ?? DEFAULT_TEXTURE_ADJUSTMENTS.hue), -180, 180),
    brightness: clamp(Number(value?.brightness ?? DEFAULT_TEXTURE_ADJUSTMENTS.brightness), 0, 200),
    saturation: clamp(Number(value?.saturation ?? DEFAULT_TEXTURE_ADJUSTMENTS.saturation), 0, 200),
    opacity: clamp(Number(value?.opacity ?? DEFAULT_TEXTURE_ADJUSTMENTS.opacity), 0, 200)
});

export const isDefaultTextureAdjustments = (value: TextureAdjustments): boolean =>
    Math.round(value.hue) === DEFAULT_TEXTURE_ADJUSTMENTS.hue &&
    Math.round(value.brightness) === DEFAULT_TEXTURE_ADJUSTMENTS.brightness &&
    Math.round(value.saturation) === DEFAULT_TEXTURE_ADJUSTMENTS.saturation &&
    Math.round(value.opacity) === DEFAULT_TEXTURE_ADJUSTMENTS.opacity;

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;

    if (d === 0) {
        return [0, 0, l];
    }

    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    switch (max) {
        case rn:
            h = (gn - bn) / d + (gn < bn ? 6 : 0);
            break;
        case gn:
            h = (bn - rn) / d + 2;
            break;
        default:
            h = (rn - gn) / d + 4;
            break;
    }
    h /= 6;

    return [h, s, l];
};

const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = hue2rgb(p, q, h + 1 / 3);
    const g = hue2rgb(p, q, h);
    const b = hue2rgb(p, q, h - 1 / 3);
    return [
        Math.round(clamp(r, 0, 1) * 255),
        Math.round(clamp(g, 0, 1) * 255),
        Math.round(clamp(b, 0, 1) * 255)
    ];
};

export const applyTextureAdjustments = (
    source: ImageData,
    adjustments: TextureAdjustments
): ImageData => {
    const output = new Uint8ClampedArray(source.data.length);
    const input = source.data;
    const hueShift = adjustments.hue / 360;
    const saturationScale = adjustments.saturation / 100;
    const brightnessScale = adjustments.brightness / 100;
    const opacityScale = adjustments.opacity / 100;

    for (let i = 0; i < input.length; i += 4) {
        const [h0, s0, l0] = rgbToHsl(input[i], input[i + 1], input[i + 2]);
        let h = h0 + hueShift;
        if (h < 0) h += 1;
        if (h > 1) h -= 1;
        const s = clamp(s0 * saturationScale, 0, 1);
        const l = clamp(l0 * brightnessScale, 0, 1);
        const [r, g, b] = hslToRgb(h, s, l);

        output[i] = r;
        output[i + 1] = g;
        output[i + 2] = b;
        output[i + 3] = clamp(Math.round(input[i + 3] * opacityScale), 0, 255);
    }

    return new ImageData(output, source.width, source.height);
};
