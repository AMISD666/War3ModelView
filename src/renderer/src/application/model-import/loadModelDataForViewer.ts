import { fbxImportUseCase } from './FbxImportUseCase'
import { jumpxImportUseCase } from './JumpxImportUseCase'

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
    if (input.path.toLowerCase().endsWith('.fbx')) {
        const result = await fbxImportUseCase.importFromPath(input.path)
        input.markLoadStage('fbx_static_import_returned', {
            geosets: result.modelData.Geosets?.length ?? 0,
            stageMs: input.roundPerfValue(performance.now() - input.readTimeMs),
        })
        return result.modelData
    }

    if (input.path.toLowerCase().endsWith('.x')) {
        const result = await jumpxImportUseCase.importFromPath(input.path)
        input.markLoadStage('jumpx_static_import_returned', {
            geosets: result.modelData.Geosets?.length ?? 0,
            particles: result.modelData.ParticleEmitters2?.length ?? 0,
            sequences: result.modelData.Sequences?.length ?? 0,
            stageMs: input.roundPerfValue(performance.now() - input.readTimeMs),
        })
        return result.modelData
    }

    const parseResult = await input.parseWithWorker(bytes)
    input.markLoadStage('worker_parse_returned', {
        workerParseMs: typeof parseResult.parseMs === 'number' ? input.roundPerfValue(parseResult.parseMs) : undefined,
        stageMs: input.roundPerfValue(performance.now() - input.readTimeMs),
    })
    return parseResult.model
}
