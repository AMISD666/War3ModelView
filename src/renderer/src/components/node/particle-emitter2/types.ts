import type { ParticleEmitter2Node } from '../../../types/node';
import type { NodeEditorCommandSender } from '../../../types/nodeEditorRpc';
import type { NodeEditorTextureDetail, NodeEditorTextureSummary } from '../../../types/nodeEditorRpc';

export type SegmentColorTuple = [[number, number, number], [number, number, number], [number, number, number]];

export interface ParticleEmitter2DialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
    /** 独立 WebView：无 Zustand，经 RPC 同步 */
    isStandalone?: boolean;
    standaloneNode?: ParticleEmitter2Node | null;
    standaloneEmit?: NodeEditorCommandSender;
    standaloneModelData?: {
        Textures?: any[];
        textureSummaries?: NodeEditorTextureSummary[];
        GlobalSequences?: any[];
        Sequences?: any[];
        selectedParticleEmitter2Texture?: NodeEditorTextureDetail | null;
    } | null;
    standaloneModelPath?: string;
    onStandaloneTextureDetailRefreshRequest?: (textureId: number) => void;
    resolveStandaloneTextureDetail?: (textureId: number) => Promise<NodeEditorTextureDetail | null>;
}
