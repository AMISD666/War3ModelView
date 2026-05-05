import { ModelNode, NodeType } from '../types/node';

export const replaceNodesByObjectId = (nodes: ModelNode[], replacements: unknown, type: NodeType): ModelNode[] => {
    if (!Array.isArray(replacements) || replacements.length === 0) return nodes;
    const replacementByObjectId = new Map<number, object>();
    replacements.forEach((item) => {
        const objectId = (item as { ObjectId?: unknown } | null)?.ObjectId;
        if (typeof objectId === 'number' && item && typeof item === 'object') {
            replacementByObjectId.set(objectId, item);
        }
    });
    if (replacementByObjectId.size === 0) return nodes;

    return nodes.map((node) => {
        const replacement = replacementByObjectId.get(node.ObjectId);
        return replacement ? ({ ...replacement, type } as ModelNode) : node;
    });
};

export const patchNodesForEmitterVisualData = (nodes: ModelNode[], patch: Record<string, unknown>): ModelNode[] => {
    let nextNodes = nodes;
    if (Object.prototype.hasOwnProperty.call(patch, 'ParticleEmitters')) {
        nextNodes = replaceNodesByObjectId(nextNodes, patch.ParticleEmitters, NodeType.PARTICLE_EMITTER);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'ParticleEmitters2')) {
        nextNodes = replaceNodesByObjectId(nextNodes, patch.ParticleEmitters2, NodeType.PARTICLE_EMITTER_2);
    }
    return nextNodes;
};
