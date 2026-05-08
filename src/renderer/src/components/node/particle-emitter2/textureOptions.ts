import type { NodeEditorTextureDetail, NodeEditorTextureSummary } from '../../../types/nodeEditorRpc';

export interface ParticleEmitter2TextureOption {
    label: string;
    value: number;
}

interface LegacyTextureRecord {
    Image?: unknown;
    Path?: unknown;
    ReplaceableId?: unknown;
}

interface ParticleEmitter2TextureResources {
    textureSummaries?: NodeEditorTextureSummary[] | null;
    selectedTexture?: NodeEditorTextureDetail | null;
    legacyTextures?: LegacyTextureRecord[] | null;
}

const getTextureDisplayName = (image: unknown, replaceableId: unknown, fallback: string): string => {
    if (typeof image === 'string' && image.trim()) {
        return image.trim();
    }
    const numericReplaceableId = Number(replaceableId);
    if (Number.isFinite(numericReplaceableId) && numericReplaceableId > 0) {
        return `Replaceable ${numericReplaceableId}`;
    }
    return fallback;
};

const makeTextureOption = (index: number, image: unknown, replaceableId: unknown): ParticleEmitter2TextureOption => ({
    label: `[${index}] ${getTextureDisplayName(image, replaceableId, `Texture ${index}`)}`,
    value: index,
});

export const createParticleEmitter2TextureOptions = ({
    textureSummaries,
    selectedTexture,
    legacyTextures,
}: ParticleEmitter2TextureResources): ParticleEmitter2TextureOption[] => {
    const optionsByIndex = new Map<number, ParticleEmitter2TextureOption>();
    const summaries = Array.isArray(textureSummaries) ? textureSummaries : [];

    if (summaries.length > 0) {
        for (const summary of summaries) {
            if (!Number.isInteger(summary.index) || summary.index < 0) continue;
            const selectedImage = selectedTexture?.index === summary.index ? selectedTexture.Image : undefined;
            const selectedReplaceableId = selectedTexture?.index === summary.index ? selectedTexture.ReplaceableId : undefined;
            optionsByIndex.set(
                summary.index,
                makeTextureOption(
                    summary.index,
                    summary.image ?? selectedImage,
                    summary.replaceableId ?? selectedReplaceableId,
                ),
            );
        }
    } else if (Array.isArray(legacyTextures)) {
        legacyTextures.forEach((texture, index) => {
            optionsByIndex.set(index, makeTextureOption(index, texture?.Image ?? texture?.Path, texture?.ReplaceableId));
        });
    }

    if (selectedTexture && Number.isInteger(selectedTexture.index) && selectedTexture.index >= 0 && !optionsByIndex.has(selectedTexture.index)) {
        optionsByIndex.set(
            selectedTexture.index,
            makeTextureOption(selectedTexture.index, selectedTexture.Image ?? selectedTexture.Path, selectedTexture.ReplaceableId),
        );
    }

    return [
        { label: '(None)', value: -1 },
        ...Array.from(optionsByIndex.values()).sort((a, b) => a.value - b.value),
    ];
};

export const isParticleEmitter2TextureIdAvailable = (
    textureId: number,
    {
        textureSummaries,
        selectedTexture,
        legacyTextures,
    }: ParticleEmitter2TextureResources,
): boolean => {
    if (textureId === -1) {
        return true;
    }
    if (!Number.isInteger(textureId) || textureId < 0) {
        return false;
    }
    const summaries = Array.isArray(textureSummaries) ? textureSummaries : [];
    if (summaries.some((summary) => summary.index === textureId)) {
        return true;
    }
    if (selectedTexture?.index === textureId) {
        return true;
    }
    if (summaries.length > 0) {
        return false;
    }
    return Array.isArray(legacyTextures) && textureId < legacyTextures.length;
};
