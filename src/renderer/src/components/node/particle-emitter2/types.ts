import type { ParticleEmitter2Node } from '../../../types/node';
import type { NodeEditorCommandSender } from '../../../types/nodeEditorRpc';

export type SegmentColorTuple = [[number, number, number], [number, number, number], [number, number, number]];

export interface ParticleEmitter2DialogProps {
    visible: boolean;
    nodeId: number | null;
    onClose: () => void;
    /** 独立 WebView：无 Zustand，经 RPC 同步 */
    isStandalone?: boolean;
    standaloneNode?: ParticleEmitter2Node | null;
    standaloneEmit?: NodeEditorCommandSender;
    standaloneModelData?: { Textures?: any[]; GlobalSequences?: any[]; Sequences?: any[] } | null;
    standaloneModelPath?: string;
}
