export const TEXTURE_DRAG_MIME = 'application/x-war3-texture-index';

export function setDraggedTextureIndex(dataTransfer: DataTransfer, textureIndex: number): void {
    if (!Number.isInteger(textureIndex) || textureIndex < 0) {
        return;
    }

    const payload = String(textureIndex);
    dataTransfer.setData(TEXTURE_DRAG_MIME, payload);
    dataTransfer.setData('text/plain', payload);
}

export function getDraggedTextureIndex(dataTransfer: DataTransfer): number | null {
    const candidates = [
        dataTransfer.getData(TEXTURE_DRAG_MIME),
        dataTransfer.getData('text/plain'),
    ];

    for (const raw of candidates) {
        if (!raw) continue;

        const parsed = Number.parseInt(raw, 10);
        if (Number.isInteger(parsed) && parsed >= 0) {
            return parsed;
        }
    }

    return null;
}

