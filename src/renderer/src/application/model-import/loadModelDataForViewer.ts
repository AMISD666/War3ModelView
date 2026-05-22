import { fbxImportUseCase } from './FbxImportUseCase'
import { jumpxImportUseCase } from './JumpxImportUseCase'
import { normalizeParticleEmitter2HeadFlags } from '../model-normalization/ParticleEmitter2HeadNormalization'

const JUMPX_FILE_HEAD = new Uint8Array([
    ...new TextEncoder().encode('JUMPX V5.01     WWW.JUMPW.COM   '),
    0xb4, 0xac, 0xb3, 0xa4, 0x20, 0x20, 0xb0, 0xd1, 0xba, 0xda, 0xb6, 0xb4,
    0xd7, 0xb0, 0xd4, 0xda, 0xc6, 0xbf, 0xd7, 0xd3, 0xc0, 0xef, 0xb5, 0xc4,
    0xc8, 0xcb,
    ...new TextEncoder().encode('!WEIBO.COM/WUYAXIT'),
    0, 0, 0, 0,
])

export interface LoadModelDataForViewerInput {
    path: string
    readTimeMs: number
    parseWithWorker: (bytes: Uint8Array) => Promise<{ model: unknown; parseMs?: number }>
    markLoadStage: (stage: string, detail?: Record<string, unknown>) => void
    roundPerfValue: (value: number) => number
}

export const loadModelDataForViewer = async (
    bytes: Uint8Array,
    input: LoadModelDataForViewerInput,
): Promise<unknown> => {
    const parseWithWorker = async (stage: string) => {
        const parseResult = await input.parseWithWorker(bytes)
        normalizeParticleEmitter2HeadFlags(parseResult.model)
        input.markLoadStage(stage, {
            workerParseMs: typeof parseResult.parseMs === 'number' ? input.roundPerfValue(parseResult.parseMs) : undefined,
            stageMs: input.roundPerfValue(performance.now() - input.readTimeMs),
        })
        return parseResult.model
    }

    if (input.path.toLowerCase().endsWith('.fbx')) {
        const result = await fbxImportUseCase.importFromPath(input.path)
        normalizeParticleEmitter2HeadFlags(result.modelData)
        input.markLoadStage('fbx_static_import_returned', {
            geosets: result.modelData.Geosets?.length ?? 0,
            stageMs: input.roundPerfValue(performance.now() - input.readTimeMs),
        })
        return result.modelData
    }

    if (input.path.toLowerCase().endsWith('.x')) {
        if (!isJumpxFile(bytes)) {
            return parseWithWorker('worker_parse_returned_x_non_jumpx')
        }
        const result = await jumpxImportUseCase.importFromPath(input.path)
        normalizeParticleEmitter2HeadFlags(result.modelData)
        input.markLoadStage('jumpx_static_import_returned', {
            geosets: result.modelData.Geosets?.length ?? 0,
            particles: result.modelData.ParticleEmitters2?.length ?? 0,
            sequences: result.modelData.Sequences?.length ?? 0,
            stageMs: input.roundPerfValue(performance.now() - input.readTimeMs),
        })
        return result.modelData
    }

    return parseWithWorker('worker_parse_returned')
}

const isJumpxFile = (bytes: Uint8Array): boolean => {
    if (bytes.length < JUMPX_FILE_HEAD.length) {
        return false
    }
    for (let index = 0; index < JUMPX_FILE_HEAD.length; index += 1) {
        if (bytes[index] !== JUMPX_FILE_HEAD[index]) {
            return false
        }
    }
    return true
}
