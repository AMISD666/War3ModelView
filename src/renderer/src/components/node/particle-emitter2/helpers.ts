import type { Color } from 'antd/es/color-picker';

export const isAnimVector = (val: any): boolean => {
    return val && typeof val === 'object' && Array.isArray(val.Keys);
};

export const getStaticValue = (val: any, defaultVal: number = 0): number => {
    if (isAnimVector(val)) {
        const keys = val.Keys;
        if (!Array.isArray(keys) || keys.length === 0) return defaultVal;
        const firstKey = keys[0];
        const vec = firstKey?.Vector ?? firstKey?.Value;
        if (Array.isArray(vec)) {
            const n = Number(vec[0]);
            return Number.isFinite(n) ? n : defaultVal;
        }
        if (vec !== undefined && vec !== null) {
            const n = Number(vec);
            return Number.isFinite(n) ? n : defaultVal;
        }
        return defaultVal;
    }
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    const n = Number(val);
    return Number.isFinite(n) ? n : defaultVal;
};

export const getFiniteNumber = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const normalizeHue = (value: number): number => {
    const wrapped = value % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
};

export const rgbToHsv = (r: number, g: number, b: number): [number, number, number] => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;

    if (delta > 1e-8) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
    }

    const s = max <= 1e-8 ? 0 : delta / max;
    const v = max;
    return [h, s, v];
};

export const hsvToRgb = (h: number, s: number, v: number): [number, number, number] => {
    const hh = normalizeHue(h);
    const c = v * s;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;

    if (hh < 60) [r, g, b] = [c, x, 0];
    else if (hh < 120) [r, g, b] = [x, c, 0];
    else if (hh < 180) [r, g, b] = [0, c, x];
    else if (hh < 240) [r, g, b] = [0, x, c];
    else if (hh < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return [r + m, g + m, b + m];
};

export const toAntdColor = (rgb?: [number, number, number]) => {
    if (!rgb) return 'rgb(255, 255, 255)';
    return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
};

export const fromAntdColor = (color: Color | string): [number, number, number] => {
    let r = 1, g = 1, b = 1;
    if (typeof color === 'string') {
        console.log('[ParticleDialog] Parsing color string:', color);
        const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
            r = parseInt(match[1]) / 255;
            g = parseInt(match[2]) / 255;
            b = parseInt(match[3]) / 255;
        } else {
            console.warn('[ParticleDialog] Could not parse color string, defaulting to white:', color);
        }
    } else if (color && typeof color === 'object') {
        const rgb = color.toRgb();
        r = rgb.r / 255;
        g = rgb.g / 255;
        b = rgb.b / 255;
    }
    return [r, g, b];
};

export const parseInterval = (value: any): [number, number, number] => {
    if (Array.isArray(value)) {
        return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 1];
    }
    if (value && typeof value === 'object' && '0' in value) {
        return [value['0'] ?? 0, value['1'] ?? 0, value['2'] ?? 1];
    }
    return [typeof value === 'number' ? value : 0, 0, 1];
};
