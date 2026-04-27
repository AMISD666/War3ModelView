import { markStandalonePerf } from '../diagnostics/StandalonePerf'
import type { PreviewProjectionMode } from '../preview'
import type {
    RendererSyncError,
    RendererSyncPlan,
    RendererSyncResult,
    RendererSyncRevisionInput,
} from './RendererSyncTypes'

export const createSyncResult = (
    input: RendererSyncRevisionInput,
    projection: PreviewProjectionMode,
    plan: RendererSyncPlan,
    applied: boolean,
    errors: RendererSyncError[] = [],
): RendererSyncResult => ({
    applied,
    documentRevision: input.documentRevision,
    previewRevision: input.previewRevision,
    plan,
    projection,
    errors,
})

export const markRendererSyncStarted = (
    plan: RendererSyncPlan,
    projection: PreviewProjectionMode,
    input: RendererSyncRevisionInput,
): void => {
    markStandalonePerf('renderer.syncStarted', {
        plan,
        projection,
        documentRevision: input.documentRevision,
        previewRevision: input.previewRevision,
    })
}

export const markRendererSyncApplied = (result: RendererSyncResult): void => {
    markStandalonePerf('renderer.syncApplied', {
        plan: result.plan,
        projection: result.projection,
        documentRevision: result.documentRevision,
        previewRevision: result.previewRevision,
        applied: result.applied,
    })
}

export const markRendererSyncFailed = (result: RendererSyncResult, errorCode: string): void => {
    markStandalonePerf('renderer.syncFailed', {
        plan: result.plan,
        projection: result.projection,
        documentRevision: result.documentRevision,
        previewRevision: result.previewRevision,
        errorCode,
    })
}

export const markRendererMaterialTopologyChanged = (
    input: RendererSyncRevisionInput,
    detail: Record<string, unknown>,
): void => {
    markStandalonePerf('renderer.materialTopologyChanged', {
        documentRevision: input.documentRevision,
        previewRevision: input.previewRevision,
        ...detail,
    })
}

export const markRendererTextureAnimationMetadataSynced = (
    input: RendererSyncRevisionInput,
    detail: Record<string, unknown>,
): void => {
    markStandalonePerf('renderer.textureAnimationMetadataSynced', {
        documentRevision: input.documentRevision,
        previewRevision: input.previewRevision,
        ...detail,
    })
}
