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
    const parseTextureIndex = (raw: string): number | null => {
        const trimmed = raw.trim();
        if (!/^\d+$/.test(trimmed)) {
            return null;
        }

        const parsed = Number(trimmed);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    };

    const explicitPayload = dataTransfer.getData(TEXTURE_DRAG_MIME);
    if (explicitPayload) {
        return parseTextureIndex(explicitPayload);
    }

    const types = Array.from(dataTransfer.types || []).map((type) => type.toLowerCase());
    if (types.includes('files')) {
        return null;
    }

    const plainPayload = dataTransfer.getData('text/plain');
    if (!plainPayload) return null;

    return parseTextureIndex(plainPayload);
}
