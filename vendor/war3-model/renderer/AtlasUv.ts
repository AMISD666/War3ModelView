export interface AtlasCellUv {
    u0: number;
    v0: number;
    u1: number;
    v1: number;
}

const normalizeAtlasAxis = (value: number | undefined): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 1;
    }

    return Math.max(1, Math.floor(value));
};

const positiveModulo = (value: number, divisor: number): number => {
    const result = value % divisor;
    return result < 0 ? result + divisor : result;
};

const clampInset = (cellSize: number, textureSize?: number): number => {
    if (typeof textureSize === 'number' && Number.isFinite(textureSize) && textureSize > 0) {
        return Math.min(cellSize * 0.25, 0.5 / textureSize);
    }

    return cellSize * 0.02;
};

export const getAtlasCellUvInset = (
    rowsInput: number | undefined,
    columnsInput: number | undefined,
    frameInput: number,
    textureWidth?: number,
    textureHeight?: number
): AtlasCellUv => {
    const rows = normalizeAtlasAxis(rowsInput);
    const columns = normalizeAtlasAxis(columnsInput);
    const frameCount = rows * columns;
    const frame = positiveModulo(Math.trunc(Number.isFinite(frameInput) ? frameInput : 0), frameCount);
    const column = frame % columns;
    const row = Math.floor(frame / columns);
    const cellWidth = 1 / columns;
    const cellHeight = 1 / rows;
    const insetU = clampInset(cellWidth, textureWidth);
    const insetV = clampInset(cellHeight, textureHeight);
    const rawU0 = column * cellWidth;
    const rawV0 = row * cellHeight;
    const rawU1 = rawU0 + cellWidth;
    const rawV1 = rawV0 + cellHeight;

    return {
        u0: Math.min(rawU1, rawU0 + insetU),
        v0: Math.min(rawV1, rawV0 + insetV),
        u1: Math.max(rawU0, rawU1 - insetU),
        v1: Math.max(rawV0, rawV1 - insetV)
    };
};
