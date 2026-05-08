import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const files = {
    standaloneHtml: 'src/renderer/standalone.html',
    snapshots: 'src/renderer/src/application/window-bridge/ToolWindowSnapshots.ts',
    standaloneRouter: 'src/renderer/src/components/detached/StandaloneToolWindowRouter.tsx',
    detachedDir: 'src/renderer/src/components/detached',
    dissolveModal: 'src/renderer/src/components/modals/DissolveEffectModal.tsx',
    globalColorAdjustModal: 'src/renderer/src/components/modals/GlobalColorAdjustModal.tsx',
    globalSequenceModal: 'src/renderer/src/components/modals/GlobalSequenceModal.tsx',
    cameraManagerModal: 'src/renderer/src/components/modals/CameraManagerModal.tsx',
    sequenceEditorModal: 'src/renderer/src/components/modals/SequenceEditorModal.tsx',
    geosetEditorModal: 'src/renderer/src/components/modals/GeosetEditorModal.tsx',
    geosetVisibilityModal: 'src/renderer/src/components/modals/GeosetVisibilityToolModal.tsx',
    geosetAnimationModal: 'src/renderer/src/components/modals/GeosetAnimationModal.tsx',
    textureAnimationModal: 'src/renderer/src/components/modals/TextureAnimationManagerModal.tsx',
    textureManagerModal: 'src/renderer/src/components/modals/TextureEditorModal.tsx',
    materialManagerModal: 'src/renderer/src/components/modals/MaterialEditorModal.tsx',
    nodeEditorStandalone: 'src/renderer/src/components/detached/NodeEditorStandalone.tsx',
    particleEmitter2Dialog: 'src/renderer/src/components/node/ParticleEmitter2Dialog.tsx',
    particleEmitter2TextureOptions: 'src/renderer/src/components/node/particle-emitter2/textureOptions.ts',
    modelOptimizeModal: 'src/renderer/src/components/modals/ModelOptimizeModal.tsx',
    materialManagerPayload: 'src/renderer/src/application/window-bridge/MaterialManagerCommandPayload.ts',
    materialManagerCommandCreator: 'src/renderer/src/application/window-bridge/MaterialManagerCommandCreator.ts',
    materialManagerCommandParser: 'src/renderer/src/application/window-bridge/MaterialManagerCommandParser.ts',
    materialManagerSnapshotPayload: 'src/renderer/src/application/window-bridge/MaterialManagerSnapshotPayload.ts',
    textureManagerPayload: 'src/renderer/src/application/window-bridge/TextureManagerCommandPayload.ts',
    textureManagerSnapshotPayload: 'src/renderer/src/application/window-bridge/TextureManagerSnapshotPayload.ts',
    nodeEditorPayload: 'src/renderer/src/application/commands/NodeEditorCommandPayload.ts',
    nodeEditorSnapshotPayload: 'src/renderer/src/application/window-bridge/NodeEditorSnapshotPayload.ts',
    globalSequencePayload: 'src/renderer/src/application/window-bridge/GlobalSequenceCommandPayload.ts',
    sequencePayload: 'src/renderer/src/application/window-bridge/SequenceCommandPayload.ts',
    geosetEditorPayload: 'src/renderer/src/application/window-bridge/GeosetEditorCommandPayload.ts',
    geosetAnimationPayload: 'src/renderer/src/application/window-bridge/GeosetAnimationCommandPayload.ts',
    textureAnimationPayload: 'src/renderer/src/application/window-bridge/TextureAnimationCommandPayload.ts',
    modelOptimizePayload: 'src/renderer/src/application/window-bridge/ModelOptimizeCommandPayload.ts',
    cameraManagerHandler: 'src/renderer/src/application/window-bridge/CameraManagerCommandHandler.ts',
    timelineHandlers: 'src/renderer/src/application/window-bridge/TimelineToolWindowHandlers.ts',
    toolWindowHandlers: 'src/renderer/src/application/window-bridge/ToolWindowCommandHandlers.ts',
    textureManagerHandler: 'src/renderer/src/application/window-bridge/TextureManagerCommandHandler.ts',
    materialManagerHandler: 'src/renderer/src/application/window-bridge/MaterialManagerCommandHandler.ts',
    materialManagerPreviewCommands: 'src/renderer/src/application/window-bridge/MaterialManagerPreviewCommands.ts',
    collectionToolWindowHandlers: 'src/renderer/src/application/window-bridge/CollectionToolWindowCommandHandlers.ts',
    mainLayout: 'src/renderer/src/components/MainLayout.tsx',
}

const readText = (relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath)
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Missing required file: ${relativePath}`)
    }
    return fs.readFileSync(absolutePath, 'utf8')
}

const assertIncludes = (text, needle, message) => {
    if (!text.includes(needle)) {
        throw new Error(message)
    }
}

const assertNotIncludes = (text, needle, message) => {
    if (text.includes(needle)) {
        throw new Error(message)
    }
}

const assertMatches = (text, pattern, message) => {
    if (!pattern.test(text)) {
        throw new Error(message)
    }
}

const extractBalanced = (text, startNeedle, openChar, closeChar) => {
    const startNeedleIndex = text.indexOf(startNeedle)
    if (startNeedleIndex < 0) {
        throw new Error(`Missing marker: ${startNeedle}`)
    }

    const openIndex = text.indexOf(openChar, startNeedleIndex + startNeedle.length)
    if (openIndex < 0) {
        throw new Error(`Missing ${openChar} after marker: ${startNeedle}`)
    }

    let depth = 0
    for (let index = openIndex; index < text.length; index += 1) {
        const char = text[index]
        if (char === openChar) {
            depth += 1
        } else if (char === closeChar) {
            depth -= 1
            if (depth === 0) {
                return text.slice(openIndex, index + 1)
            }
        }
    }

    throw new Error(`Unbalanced ${openChar}${closeChar} block after marker: ${startNeedle}`)
}

const extractBetween = (text, startNeedle, endNeedle) => {
    const startIndex = text.indexOf(startNeedle)
    if (startIndex < 0) {
        throw new Error(`Missing marker: ${startNeedle}`)
    }
    const endIndex = text.indexOf(endNeedle, startIndex + startNeedle.length)
    if (endIndex < 0) {
        throw new Error(`Missing marker after ${startNeedle}: ${endNeedle}`)
    }
    return text.slice(startIndex, endIndex)
}

const listSourceFiles = (relativeDir) => {
    const absoluteDir = path.join(repoRoot, relativeDir)
    if (!fs.existsSync(absoluteDir)) {
        throw new Error(`Missing required directory: ${relativeDir}`)
    }

    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
    return entries.flatMap((entry) => {
        const childRelativePath = path.join(relativeDir, entry.name).replaceAll(path.sep, '/')
        if (entry.isDirectory()) {
            return listSourceFiles(childRelativePath)
        }
        return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [childRelativePath] : []
    })
}

const importPatternFor = (packageName) => new RegExp(
    `(?:^|\\n)\\s*import(?:\\s+type)?[\\s\\S]*?from\\s+['"]${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['"]/|['"])`,
)

const assertNoDirectImports = (relativePath, packageNames) => {
    const text = readText(relativePath)
    const offenders = packageNames.filter((packageName) => importPatternFor(packageName).test(text))
    if (offenders.length > 0) {
        throw new Error(`${relativePath} must not directly import ${offenders.join(', ')}`)
    }
}

const checkStandaloneEntrypoint = () => {
    const html = readText(files.standaloneHtml)
    assertIncludes(
        html,
        '<script type="module" src="/src/standalone-main.tsx"></script>',
        `${files.standaloneHtml} must load /src/standalone-main.tsx`,
    )
}

const checkSnapshotEnvelope = () => {
    const snapshots = readText(files.snapshots)
    const envelope = extractBalanced(snapshots, 'export type ToolWindowSnapshotEnvelope', '{', '}')
    const requiredFields = [
        'documentId',
        'documentRevision',
        'assetRevision',
        'previewRevision',
        'snapshotRevision',
        'windowId',
        'payload',
    ]
    const missing = requiredFields.filter((field) => !new RegExp(`\\b${field}\\b`).test(envelope))
    if (missing.length > 0) {
        throw new Error(`ToolWindowSnapshotEnvelope is missing required field(s): ${missing.join(', ')}`)
    }
}

const checkStandaloneRouterImports = () => {
    assertNoDirectImports(files.standaloneRouter, [
        '@tauri-apps/api',
        '@tauri-apps/plugin',
        'war3-model',
        '../../stores/modelStore',
        '../stores/modelStore',
    ])

    const router = readText(files.standaloneRouter)
    if (/\buseModelStore\b/.test(router)) {
        throw new Error(`${files.standaloneRouter} must not use useModelStore directly`)
    }
}

const checkDetachedImports = () => {
    for (const sourceFile of listSourceFiles(files.detachedDir)) {
        assertNoDirectImports(sourceFile, ['@tauri-apps/api', '@tauri-apps/plugin'])
    }
}

const checkDissolveCommandPayload = () => {
    const dissolveModal = readText(files.dissolveModal)
    const commandIndex = dissolveModal.indexOf("emitCommand('EXECUTE_DISSOLVE'")
    if (commandIndex < 0) {
        throw new Error(`${files.dissolveModal} must emit EXECUTE_DISSOLVE from standalone mode`)
    }

    const payload = extractBalanced(dissolveModal.slice(commandIndex), "emitCommand('EXECUTE_DISSOLVE'", '{', '}')
    const requiredFields = ['documentId', 'baseDocumentRevision', 'stalePolicy']
    const missing = requiredFields.filter((field) => !new RegExp(`\\b${field}\\b`).test(payload))
    if (missing.length > 0) {
        throw new Error(`EXECUTE_DISSOLVE payload is missing required field(s): ${missing.join(', ')}`)
    }
}

const checkDissolveServerGuard = () => {
    const mainLayout = readText(files.mainLayout)
    assertMatches(
        mainLayout,
        /useRpcServer\(\s*['"]dissolveEffect['"]\s*,\s*getDissolveEffectState\s*,\s*handleDissolveCommand\s*\)/,
        `${files.mainLayout} must register the dissolveEffect RPC server`,
    )

    const dissolveCommandBlock = extractBalanced(mainLayout, "if (command === 'EXECUTE_DISSOLVE')", '{', '}')
    assertIncludes(
        dissolveCommandBlock,
        'checkMainToolCommandRevision',
        `${files.mainLayout} EXECUTE_DISSOLVE handler must call checkMainToolCommandRevision`,
    )
}

const checkGlobalColorAdjustCommandEnvelope = () => {
    const modal = readText(files.globalColorAdjustModal)
    assertIncludes(
        modal,
        'const emitStandaloneCommand = (',
        `${files.globalColorAdjustModal} must centralize standalone command emission`,
    )
    assertIncludes(
        modal,
        'documentId: rpcState.documentId ?? null',
        `${files.globalColorAdjustModal} standalone commands must include documentId`,
    )
    assertIncludes(
        modal,
        'baseDocumentRevision: rpcState.documentRevision ?? 0',
        `${files.globalColorAdjustModal} standalone commands must include baseDocumentRevision`,
    )
    assertIncludes(
        modal,
        'stalePolicy',
        `${files.globalColorAdjustModal} standalone commands must include stalePolicy`,
    )
}

const checkGlobalSequenceStrictSavePayload = () => {
    const helper = readText(files.globalSequencePayload)
    assertIncludes(
        helper,
        "stalePolicy: 'reject'",
        `${files.globalSequencePayload} save payloads must default durable writes to reject`,
    )

    const modal = readText(files.globalSequenceModal)
    assertIncludes(
        modal,
        'createGlobalSequenceSavePayload',
        `${files.globalSequenceModal} must use the shared global-sequence save payload helper`,
    )
}

const checkCameraManagerStrictWrites = () => {
    const modal = readText(files.cameraManagerModal)
    assertIncludes(
        modal,
        'documentId: rpcState.documentId',
        `${files.cameraManagerModal} standalone commands must include documentId`,
    )
    assertIncludes(
        modal,
        'baseDocumentRevision: rpcState.documentRevision',
        `${files.cameraManagerModal} standalone commands must include baseDocumentRevision`,
    )

    const handler = readText(files.cameraManagerHandler)
    assertIncludes(
        handler,
        'const DOCUMENT_WRITE_ACTIONS = new Set<CameraManagerAction>',
        `${files.cameraManagerHandler} must distinguish document-write camera actions`,
    )
    assertIncludes(
        handler,
        "payload?.action && DOCUMENT_WRITE_ACTIONS.has(payload.action) ? 'reject' : 'warn'",
        `${files.cameraManagerHandler} must default durable camera writes to reject`,
    )
}

const checkSequenceEditorStrictSavePayload = () => {
    const helper = readText(files.sequencePayload)
    assertIncludes(
        helper,
        "stalePolicy: 'reject'",
        `${files.sequencePayload} apply-sequence payloads must default durable writes to reject`,
    )

    const modal = readText(files.sequenceEditorModal)
    assertIncludes(
        modal,
        'createApplySequenceChangesPayload',
        `${files.sequenceEditorModal} must use the shared sequence payload helper`,
    )

    const handler = readText(files.timelineHandlers)
    assertIncludes(
        handler,
        'parseApplySequenceChangesPayload',
        `${files.timelineHandlers} must parse sequence apply payloads through the shared helper`,
    )
}

const checkTextureManagerPayloadHelper = () => {
    const helper = readText(files.textureManagerPayload)
    assertIncludes(
        helper,
        'export const parseTextureManagerCommandPayload',
        `${files.textureManagerPayload} must export a texture-manager payload parser`,
    )
    assertNotIncludes(
        helper,
        'SAVE_TEXTURES_WITH_MATERIALS',
        `${files.textureManagerPayload} must not accept child-provided full materials/geosets/particle texture saves`,
    )
    assertNotIncludes(
        helper,
        'SaveTexturesWithMaterialsCommandPayload',
        `${files.textureManagerPayload} must not expose the old full texture/material save payload`,
    )
    assertNotIncludes(
        helper,
        'particleEmitters',
        `${files.textureManagerPayload} texture-manager commands must not carry particle emitter arrays`,
    )
    assertIncludes(
        helper,
        "'PATCH_TEXTURE'",
        `${files.textureManagerPayload} must define an operation-level texture patch action`,
    )
    assertIncludes(
        helper,
        "'DELETE_TEXTURE'",
        `${files.textureManagerPayload} must define an operation-level texture delete action`,
    )
    assertIncludes(
        helper,
        "'ADD_TEXTURES'",
        `${files.textureManagerPayload} must define an operation-level texture add action`,
    )

    const snapshotHelper = readText(files.textureManagerSnapshotPayload)
    assertIncludes(
        snapshotHelper,
        'export const createTextureManagerTextureSummaries',
        `${files.textureManagerSnapshotPayload} must export texture-manager texture summaries`,
    )
    assertIncludes(
        snapshotHelper,
        'export const textureManagerTextureSummariesToTextures',
        `${files.textureManagerSnapshotPayload} must centralize summary-to-texture compatibility conversion`,
    )
    assertIncludes(
        snapshotHelper,
        'export const createTextureManagerMaterialSummaries',
        `${files.textureManagerSnapshotPayload} must export texture-manager material summaries`,
    )
    assertIncludes(
        snapshotHelper,
        'export const getTextureIdForMaterial',
        `${files.textureManagerSnapshotPayload} must centralize material-summary texture lookup`,
    )

    const snapshots = readText(files.snapshots)
    assertIncludes(
        snapshots,
        'textureSummaries: createTextureManagerTextureSummaries',
        `${files.snapshots} must build texture summaries for the texture manager snapshot`,
    )
    const textureSnapshotBlock = extractBalanced(snapshots, 'this.textureCache.snapshot =', '{', '}')
    assertIncludes(
        textureSnapshotBlock,
        'textures: []',
        `${files.snapshots} must not send full texture arrays to standalone texture manager snapshots`,
    )
    assertNotIncludes(
        textureSnapshotBlock,
        'textures: modelData?.Textures',
        `${files.snapshots} texture manager snapshot must not broadcast full Textures arrays`,
    )
    assertIncludes(
        snapshots,
        'materialSummaries: createTextureManagerMaterialSummaries',
        `${files.snapshots} must build material summaries for the texture manager snapshot`,
    )
    assertIncludes(
        snapshots,
        'materials: []',
        `${files.snapshots} must not send full material arrays to standalone texture manager snapshots`,
    )

    const modal = readText(files.textureManagerModal)
    assertIncludes(
        modal,
        'withTextureManagerRevision',
        `${files.textureManagerModal} must build standalone commands through the shared revision helper`,
    )
    assertIncludes(
        modal,
        'createPatchTextureCommandPayload',
        `${files.textureManagerModal} must use operation-level texture patch commands for standalone single-texture edits`,
    )
    assertIncludes(
        modal,
        'createDeleteTextureCommandPayload',
        `${files.textureManagerModal} must use operation-level texture delete commands for standalone deletion`,
    )
    assertIncludes(
        modal,
        'createAddTexturesCommandPayload',
        `${files.textureManagerModal} must use operation-level texture add commands for standalone additions`,
    )
    assertIncludes(
        modal,
        'patchStandaloneTexture(index, updates)',
        `${files.textureManagerModal} standalone updateLocalTexture must send a texture patch intent instead of a broad collection save`,
    )
    assertIncludes(
        modal,
        'deleteStandaloneTexture(index)',
        `${files.textureManagerModal} standalone delete must send a texture delete intent instead of a broad collection save`,
    )
    assertIncludes(
        modal,
        'addStandaloneTextures(newTextures)',
        `${files.textureManagerModal} standalone import must send texture add intents instead of a broad collection save`,
    )
    assertIncludes(
        modal,
        'addStandaloneTextures([newTexture])',
        `${files.textureManagerModal} standalone blank texture creation must send a texture add intent instead of a broad collection save`,
    )
    assertIncludes(
        modal,
        "patchStandaloneTexture(currentSelectedIndex, { Image: imported.relativePath, ReplaceableId: 0 })",
        `${files.textureManagerModal} standalone texture replacement must send a texture patch intent instead of a broad collection save`,
    )
    assertIncludes(
        modal,
        'getTextureIdForMaterial',
        `${files.textureManagerModal} must use material summary lookup instead of reading full material snapshots directly`,
    )
    assertIncludes(
        modal,
        'textureManagerTextureSummariesToTextures',
        `${files.textureManagerModal} must hydrate its compatibility draft from texture summaries first`,
    )
    if (/rpcSnapshot\.particleEmitters|rpcSnapshot\.particleEmitters2|rpcSnapshot\.globalSequences/.test(modal)) {
        throw new Error(`${files.textureManagerModal} must not depend on heavy standalone particle/global-sequence snapshot fields`)
    }
    if (/rpcSnapshot\.materials/.test(modal)) {
        throw new Error(`${files.textureManagerModal} must not depend on full standalone material snapshots`)
    }

    const handler = readText(files.textureManagerHandler)
    assertNotIncludes(
        handler,
        "if (action === 'SAVE_TEXTURES_WITH_MATERIALS')",
        `${files.textureManagerHandler} must not accept the old texture-manager full material/geoset/particle save action`,
    )
    assertNotIncludes(
        handler,
        'particleEmitters2',
        `${files.textureManagerHandler} texture-manager handler must not accept child-provided particle emitter arrays`,
    )
    assertIncludes(
        handler,
        'patchTextureCollectionItem',
        `${files.textureManagerHandler} must derive texture patch commands in the main-window handler`,
    )
    assertIncludes(
        handler,
        'deleteTextureCollectionItem',
        `${files.textureManagerHandler} must derive texture delete commands in the main-window handler`,
    )
    assertIncludes(
        handler,
        'appendTextureCollectionItems',
        `${files.textureManagerHandler} must derive texture add commands in the main-window handler`,
    )
    assertIncludes(
        handler,
        "if (action === 'PATCH_TEXTURE')",
        `${files.textureManagerHandler} must handle operation-level texture patch commands`,
    )
    assertIncludes(
        handler,
        "if (action === 'DELETE_TEXTURE')",
        `${files.textureManagerHandler} must handle operation-level texture delete commands`,
    )
    assertIncludes(
        handler,
        "if (action === 'ADD_TEXTURES')",
        `${files.textureManagerHandler} must handle operation-level texture add commands`,
    )
}

const checkMaterialManagerPayloadHelper = () => {
    const helper = readText(files.materialManagerPayload)
    const commandCreator = readText(files.materialManagerCommandCreator)
    const commandParser = readText(files.materialManagerCommandParser)
    assertIncludes(
        commandParser,
        'export const parseMaterialManagerCommandPayload',
        `${files.materialManagerCommandParser} must export a material-manager payload parser`,
    )
    assertIncludes(
        helper,
        "'PATCH_SELECTED_LAYER_PREVIEW'",
        `${files.materialManagerPayload} must define an operation-level selected-layer preview action`,
    )
    assertIncludes(
        helper,
        "'PATCH_SELECTED_MATERIAL_PREVIEW'",
        `${files.materialManagerPayload} must define an operation-level selected-material preview action`,
    )
    assertIncludes(
        helper,
        "'ADD_LAYER_PREVIEW'",
        `${files.materialManagerPayload} must define an operation-level add-layer preview action`,
    )
    assertIncludes(
        helper,
        "'DELETE_LAYER_PREVIEW'",
        `${files.materialManagerPayload} must define an operation-level delete-layer preview action`,
    )
    assertIncludes(
        helper,
        "'MOVE_LAYER_PREVIEW'",
        `${files.materialManagerPayload} must define an operation-level move-layer preview action`,
    )
    assertIncludes(
        helper,
        "'ADD_MATERIAL_PREVIEW'",
        `${files.materialManagerPayload} must define an operation-level add-material preview action`,
    )
    assertIncludes(
        helper,
        "'DELETE_MATERIAL_PREVIEW'",
        `${files.materialManagerPayload} must define an operation-level delete-material preview action`,
    )
    assertIncludes(
        commandCreator,
        "action === 'COMMIT_MATERIALS'",
        `${files.materialManagerCommandCreator} must distinguish durable material commits from preview writes`,
    )
    assertIncludes(
        commandCreator,
        "? 'reject'",
        `${files.materialManagerCommandCreator} material commit payloads must default durable commits to reject`,
    )
    const materialStalePolicyBlock = extractBetween(
        commandCreator,
        'const getDefaultStalePolicy',
        'export const createMaterialManagerCommandPayload',
    )
    assertIncludes(
        materialStalePolicyBlock,
        "action === 'COMMIT_MATERIALS'",
        `${files.materialManagerCommandCreator} durable material commit stale policy must be decided in getDefaultStalePolicy`,
    )
    assertIncludes(
        materialStalePolicyBlock,
        "? 'reject'",
        `${files.materialManagerCommandCreator} durable material commits must reject stale commands`,
    )
    assertIncludes(
        helper,
        'MaterialManagerLayerPatchPayload',
        `${files.materialManagerPayload} must type the material-manager selected-layer patch payload`,
    )
    assertIncludes(
        helper,
        'MaterialManagerMaterialPatchPayload',
        `${files.materialManagerPayload} must type the material-manager selected-material patch payload`,
    )
    assertIncludes(
        helper,
        'MaterialManagerAddLayerPayload',
        `${files.materialManagerPayload} must type the material-manager add-layer preview payload`,
    )
    assertIncludes(
        helper,
        'MaterialManagerDeleteLayerPayload',
        `${files.materialManagerPayload} must type the material-manager delete-layer preview payload`,
    )
    assertIncludes(
        helper,
        'MaterialManagerMoveLayerPayload',
        `${files.materialManagerPayload} must type the material-manager move-layer preview payload`,
    )

    const snapshotHelper = readText(files.materialManagerSnapshotPayload)
    assertIncludes(
        snapshotHelper,
        'export const createMaterialManagerMaterialSummaries',
        `${files.materialManagerSnapshotPayload} must export material-manager material summaries`,
    )
    assertIncludes(
        snapshotHelper,
        'export const createMaterialManagerSequenceSummaries',
        `${files.materialManagerSnapshotPayload} must export material-manager sequence summaries`,
    )
    assertIncludes(
        snapshotHelper,
        'export const createMaterialManagerTextureAnimSummaries',
        `${files.materialManagerSnapshotPayload} must export material-manager texture-animation summaries`,
    )
    assertIncludes(
        snapshotHelper,
        'export const createMaterialManagerTextureSummaries',
        `${files.materialManagerSnapshotPayload} must export material-manager texture summaries`,
    )
    assertIncludes(
        snapshotHelper,
        'export const materialManagerSequenceSummariesToKeyframeSequences',
        `${files.materialManagerSnapshotPayload} must centralize keyframe sequence view-model conversion`,
    )
    assertIncludes(
        snapshotHelper,
        'export const getMaterialManagerMaterialListItems',
        `${files.materialManagerSnapshotPayload} must centralize material-manager list item creation`,
    )
    assertIncludes(
        snapshotHelper,
        'export const getMaterialManagerSelectedMaterialDetail',
        `${files.materialManagerSnapshotPayload} must centralize selected material detail creation`,
    )
    assertIncludes(
        snapshotHelper,
        'type MaterialManagerSelectedMaterialDetail',
        `${files.materialManagerSnapshotPayload} must define a selected material detail view model`,
    )
    assertIncludes(
        snapshotHelper,
        'const summaryByIndex = new Map',
        `${files.materialManagerSnapshotPayload} must make the material list summary-first instead of requiring full material parity`,
    )
    assertNotIncludes(
        snapshotHelper,
        'summaries.length === legacyCount',
        `${files.materialManagerSnapshotPayload} must not require full material arrays before using material summaries`,
    )
    assertIncludes(
        snapshotHelper,
        'export const getMaterialManagerTextureOptions',
        `${files.materialManagerSnapshotPayload} must centralize material-manager texture option creation`,
    )

    const snapshots = readText(files.snapshots)
    const materialSnapshotBlock = extractBalanced(snapshots, 'this.materialCache.snapshot =', '{', '}')
    assertIncludes(
        snapshots,
        'materialSummaries: createMaterialManagerMaterialSummaries',
        `${files.snapshots} must build material summaries for the material manager snapshot`,
    )
    assertIncludes(
        snapshots,
        'textureSummaries: createMaterialManagerTextureSummaries',
        `${files.snapshots} must build texture summaries for the material manager snapshot`,
    )
    assertIncludes(
        snapshots,
        'sequenceSummaries: createMaterialManagerSequenceSummaries',
        `${files.snapshots} must build sequence summaries for the material manager snapshot`,
    )
    assertIncludes(
        snapshots,
        'textureAnimSummaries: createMaterialManagerTextureAnimSummaries',
        `${files.snapshots} must build texture animation summaries for the material manager snapshot`,
    )
    assertIncludes(
        materialSnapshotBlock,
        'sequences: []',
        `${files.snapshots} must not send full sequence arrays to standalone material manager snapshots`,
    )
    assertIncludes(
        materialSnapshotBlock,
        'textureAnims: []',
        `${files.snapshots} must not send full texture animation arrays to standalone material manager snapshots`,
    )

    const modal = readText(files.materialManagerModal)
    assertIncludes(
        modal,
        'createMaterialManagerCommandPayload',
        `${files.materialManagerModal} must build standalone commands through the shared payload helper`,
    )
    assertIncludes(
        modal,
        'getMaterialManagerMaterialListItems',
        `${files.materialManagerModal} must prefer material summaries for the standalone material list`,
    )
    assertIncludes(
        modal,
        'getMaterialManagerSelectedMaterialDetail',
        `${files.materialManagerModal} must derive selected material/layer read models through the shared helper`,
    )
    assertIncludes(
        modal,
        'selectedMaterialDetail?.layers ?? []',
        `${files.materialManagerModal} must render layer list rows from selected material detail`,
    )
    assertIncludes(
        modal,
        'previewStandaloneLayerPatch',
        `${files.materialManagerModal} must route standalone layer realtime preview through an operation-level helper`,
    )
    assertIncludes(
        modal,
        'previewStandaloneMaterialPatch',
        `${files.materialManagerModal} must route standalone material realtime preview through an operation-level helper`,
    )
    assertIncludes(
        modal,
        'previewStandaloneAddLayer',
        `${files.materialManagerModal} must route standalone add-layer preview through an operation-level helper`,
    )
    assertIncludes(
        modal,
        'previewStandaloneDeleteLayer',
        `${files.materialManagerModal} must route standalone delete-layer preview through an operation-level helper`,
    )
    assertIncludes(
        modal,
        'previewStandaloneMoveLayer',
        `${files.materialManagerModal} must route standalone move-layer preview through an operation-level helper`,
    )
    assertIncludes(
        modal,
        'previewStandaloneAddMaterial',
        `${files.materialManagerModal} must route standalone add-material preview through an operation-level helper`,
    )
    assertIncludes(
        modal,
        'previewStandaloneDeleteMaterial',
        `${files.materialManagerModal} must route standalone delete-material preview through an operation-level helper`,
    )
    assertIncludes(
        modal,
        "action: 'PATCH_SELECTED_LAYER_PREVIEW'",
        `${files.materialManagerModal} must emit operation-level selected-layer preview patches`,
    )
    assertIncludes(
        modal,
        "action: 'PATCH_SELECTED_MATERIAL_PREVIEW'",
        `${files.materialManagerModal} must emit operation-level selected-material preview patches`,
    )
    assertIncludes(
        modal,
        "action: 'ADD_LAYER_PREVIEW'",
        `${files.materialManagerModal} must emit operation-level add-layer preview commands`,
    )
    assertIncludes(
        modal,
        "action: 'DELETE_LAYER_PREVIEW'",
        `${files.materialManagerModal} must emit operation-level delete-layer preview commands`,
    )
    assertIncludes(
        modal,
        "action: 'MOVE_LAYER_PREVIEW'",
        `${files.materialManagerModal} must emit operation-level move-layer preview commands`,
    )
    assertIncludes(
        modal,
        "action: 'ADD_MATERIAL_PREVIEW'",
        `${files.materialManagerModal} must emit operation-level add-material preview commands`,
    )
    assertIncludes(
        modal,
        "action: 'DELETE_MATERIAL_PREVIEW'",
        `${files.materialManagerModal} must emit operation-level delete-material preview commands`,
    )
    const updateLocalMaterialBlock = extractBalanced(modal, 'const updateLocalMaterial =', '{', '}')
    assertNotIncludes(
        updateLocalMaterialBlock,
        "action: 'SAVE_MATERIALS'",
        `${files.materialManagerModal} updateLocalMaterial must not use broad SAVE_MATERIALS for the standalone material realtime preview path`,
    )
    const updateLocalLayerBlock = extractBalanced(modal, 'const updateLocalLayer =', '{', '}')
    assertNotIncludes(
        updateLocalLayerBlock,
        "action: 'SAVE_MATERIALS',\n                        payload: {\n                            materials: materialsForSave,\n                            textures: modelTexturesRef.current\n                        }",
        `${files.materialManagerModal} updateLocalLayer must not use broad SAVE_MATERIALS for the standalone layer realtime preview path`,
    )
    const addLayerBlock = extractBetween(modal, 'const handleAddLayer =', 'const handleDeleteLayer =')
    assertIncludes(
        addLayerBlock,
        'previewStandaloneAddLayer',
        `${files.materialManagerModal} handleAddLayer must use the operation-level standalone add-layer preview path`,
    )
    assertNotIncludes(
        addLayerBlock,
        'syncStandaloneMaterials(newMaterials)',
        `${files.materialManagerModal} handleAddLayer must not use broad SAVE_MATERIALS for standalone add-layer preview`,
    )
    const moveLayerBlock = extractBalanced(modal, 'const moveLayer =', '{', '}')
    assertIncludes(
        moveLayerBlock,
        'previewStandaloneMoveLayer',
        `${files.materialManagerModal} moveLayer must use the operation-level standalone move-layer preview path`,
    )
    assertNotIncludes(
        moveLayerBlock,
        'syncStandaloneMaterials(newMaterials)',
        `${files.materialManagerModal} moveLayer must not use broad SAVE_MATERIALS for standalone move-layer preview`,
    )
    const deleteLayerBlock = extractBetween(modal, 'const handleDeleteLayer =', 'const openKeyframeEditor =')
    assertIncludes(
        deleteLayerBlock,
        'previewStandaloneDeleteLayer',
        `${files.materialManagerModal} handleDeleteLayer must use the operation-level standalone delete-layer preview path`,
    )
    assertNotIncludes(
        deleteLayerBlock,
        'syncStandaloneMaterials(newMaterials)',
        `${files.materialManagerModal} handleDeleteLayer must not use broad SAVE_MATERIALS for standalone delete-layer preview`,
    )
    const addMaterialBlock = extractBetween(modal, 'const handleAddMaterial =', 'const handleDeleteMaterial =')
    assertIncludes(
        addMaterialBlock,
        'previewStandaloneAddMaterial',
        `${files.materialManagerModal} handleAddMaterial must use the operation-level standalone add-material preview path`,
    )
    assertNotIncludes(
        addMaterialBlock,
        'syncStandaloneMaterials(nextMaterials)',
        `${files.materialManagerModal} handleAddMaterial must not use broad SAVE_MATERIALS for standalone add-material preview`,
    )
    const deleteMaterialBlock = extractBetween(modal, 'const handleDeleteMaterial =', '// Layer Actions')
    assertIncludes(
        deleteMaterialBlock,
        'previewStandaloneDeleteMaterial',
        `${files.materialManagerModal} handleDeleteMaterial must use the operation-level standalone delete-material preview path`,
    )
    assertIncludes(
        modal,
        'getMaterialManagerTextureOptions',
        `${files.materialManagerModal} must prefer texture summaries for standalone texture options`,
    )
    assertIncludes(
        modal,
        'materialManagerSequenceSummariesToKeyframeSequences',
        `${files.materialManagerModal} must prefer sequence summaries before legacy full sequences`,
    )
    assertIncludes(
        modal,
        'getMaterialManagerTextureAnimOptionIndexes',
        `${files.materialManagerModal} must prefer texture-animation summaries for standalone options`,
    )

    const handler = readText(files.materialManagerHandler)
    const previewCommands = readText(files.materialManagerPreviewCommands)
    assertIncludes(
        previewCommands,
        'patchMaterialPreview',
        `${files.materialManagerPreviewCommands} must derive selected-material preview patches in the main-window handler`,
    )
    assertIncludes(
        handler,
        "if (action === 'PATCH_SELECTED_MATERIAL_PREVIEW')",
        `${files.materialManagerHandler} must handle material-manager selected-material preview patches`,
    )
    assertIncludes(
        previewCommands,
        'patchMaterialLayerPreview',
        `${files.materialManagerPreviewCommands} must derive selected-layer preview patches in the main-window handler`,
    )
    assertIncludes(
        handler,
        "if (action === 'PATCH_SELECTED_LAYER_PREVIEW')",
        `${files.materialManagerHandler} must handle material-manager selected-layer preview patches`,
    )
    assertIncludes(
        previewCommands,
        'addMaterialLayerPreview',
        `${files.materialManagerPreviewCommands} must derive add-layer preview commands in the main-window handler`,
    )
    assertIncludes(
        handler,
        "if (action === 'ADD_LAYER_PREVIEW')",
        `${files.materialManagerHandler} must handle material-manager add-layer preview commands`,
    )
    assertIncludes(
        previewCommands,
        'deleteMaterialLayerPreview',
        `${files.materialManagerPreviewCommands} must derive delete-layer preview commands in the main-window handler`,
    )
    assertIncludes(
        handler,
        "if (action === 'DELETE_LAYER_PREVIEW')",
        `${files.materialManagerHandler} must handle material-manager delete-layer preview commands`,
    )
    assertIncludes(
        previewCommands,
        'moveMaterialLayerPreview',
        `${files.materialManagerPreviewCommands} must derive move-layer preview commands in the main-window handler`,
    )
    assertIncludes(
        handler,
        "if (action === 'MOVE_LAYER_PREVIEW')",
        `${files.materialManagerHandler} must handle material-manager move-layer preview commands`,
    )
    assertIncludes(
        previewCommands,
        'addMaterialPreview',
        `${files.materialManagerPreviewCommands} must derive add-material preview commands in the main-window handler`,
    )
    assertIncludes(
        previewCommands,
        'deleteMaterialPreview',
        `${files.materialManagerPreviewCommands} must derive delete-material preview commands in the main-window handler`,
    )
    assertIncludes(
        handler,
        "if (action === 'ADD_MATERIAL_PREVIEW')",
        `${files.materialManagerHandler} must handle material-manager add-material preview commands`,
    )
    assertIncludes(
        handler,
        "if (action === 'DELETE_MATERIAL_PREVIEW')",
        `${files.materialManagerHandler} must handle material-manager delete-material preview commands`,
    )
    assertIncludes(
        handler,
        "if (action === 'COMMIT_MATERIALS')",
        `${files.materialManagerHandler} must handle durable material commit commands separately from preview writes`,
    )
    assertIncludes(
        handler,
        'commitMaterialManagerPreview',
        `${files.materialManagerHandler} durable material commits must go through the main-window commit handler`,
    )
    const commitCallIndex = modal.indexOf("action: 'COMMIT_MATERIALS'")
    if (commitCallIndex < 0) {
        throw new Error(`${files.materialManagerModal} must emit COMMIT_MATERIALS for standalone durable material saves`)
    }
    const commitWindow = modal.slice(commitCallIndex, commitCallIndex + 240)
    assertIncludes(
        commitWindow,
        "stalePolicy: 'reject'",
        `${files.materialManagerModal} standalone COMMIT_MATERIALS calls must reject stale durable writes`,
    )
}

const checkNodeEditorPayloadHelper = () => {
    const commandHelper = readText(files.nodeEditorPayload)
    assertIncludes(
        commandHelper,
        'stalePolicyForNodeEditorCommand(command, payload)',
        `${files.nodeEditorPayload} must derive stale policy from the node-editor command payload`,
    )
    assertIncludes(
        commandHelper,
        'command === NODE_EDITOR_COMMANDS.applyNodeUpdate && isRecord((payload as ApplyNodeUpdatePayload).history)',
        `${files.nodeEditorPayload} must treat history-backed node applies as durable document writes`,
    )
    assertIncludes(
        commandHelper,
        "return 'reject'",
        `${files.nodeEditorPayload} must reject stale durable node-editor writes`,
    )
    const stalePolicyBlock = extractBalanced(commandHelper, 'const stalePolicyForNodeEditorCommand', '{', '}')
    assertIncludes(
        stalePolicyBlock,
        'command === NODE_EDITOR_COMMANDS.renameNode',
        `${files.nodeEditorPayload} rename node writes must be treated as durable writes`,
    )
    assertIncludes(
        stalePolicyBlock,
        'command === NODE_EDITOR_COMMANDS.applyNodeUpdate && isRecord((payload as ApplyNodeUpdatePayload).history)',
        `${files.nodeEditorPayload} history-backed node applies must be treated as durable writes`,
    )
    assertIncludes(
        stalePolicyBlock,
        "return 'warn'",
        `${files.nodeEditorPayload} preview node-editor commands must remain warn-compatible`,
    )

    const standalone = readText(files.nodeEditorStandalone)
    assertIncludes(
        standalone,
        'createRevisionedNodeEditorCommandPayload',
        `${files.nodeEditorStandalone} must build node-editor standalone commands through the shared helper`,
    )
    assertIncludes(
        standalone,
        'state.nodeSummaries ?? state.resources?.nodes ?? []',
        `${files.nodeEditorStandalone} must prefer node summary bridge fields before falling back`,
    )
    assertIncludes(
        standalone,
        'state.globalSequenceDurations ?? state.resources?.globalSequenceDurations ?? state.globalSequences ?? []',
        `${files.nodeEditorStandalone} must prefer summary bridge global sequence durations`,
    )
    assertIncludes(
        standalone,
        'state.sequenceSummaries ?? state.resources?.sequences ?? []',
        `${files.nodeEditorStandalone} must prefer sequence summary bridge fields before falling back`,
    )
    assertIncludes(
        standalone,
        'hydrateSelectedPivotPoint',
        `${files.nodeEditorStandalone} must hydrate the selected node from selected pivot detail`,
    )
    assertNotIncludes(
        standalone,
        'PivotPoints: state.pivotPoints',
        `${files.nodeEditorStandalone} must not rebuild standalone model data from the full PivotPoints table`,
    )
    assertIncludes(
        standalone,
        'selectedParticleEmitter2Texture: state.selectedParticleEmitter2Texture ?? null',
        `${files.nodeEditorStandalone} must pass selected PE2 texture detail through standalone model data`,
    )
    assertIncludes(
        standalone,
        'textureSummaries: state.textureSummaries ?? state.resources?.textures ?? []',
        `${files.nodeEditorStandalone} must pass PE2 texture summaries through standalone model data`,
    )
    assertIncludes(
        standalone,
        'requestSelectedTextureDetailRefresh',
        `${files.nodeEditorStandalone} must request a snapshot refresh after standalone PE2 TextureID changes`,
    )
    assertIncludes(
        standalone,
        "window.setTimeout(requestNodeEditorSnapshot, 40)",
        `${files.nodeEditorStandalone} must request a near-term selected PE2 texture detail refresh`,
    )
    assertIncludes(
        standalone,
        'onStandaloneTextureDetailRefreshRequest={requestSelectedTextureDetailRefresh}',
        `${files.nodeEditorStandalone} must wire the PE2 texture-detail refresh callback through the standalone shell`,
    )
    assertIncludes(
        standalone,
        'resolveSelectedTextureDetail',
        `${files.nodeEditorStandalone} must expose an async selected PE2 texture detail resolver`,
    )
    assertIncludes(
        standalone,
        'stateRef.current.selectedParticleEmitter2Texture',
        `${files.nodeEditorStandalone} PE2 resolver must wait for the authoritative snapshot detail before fallback`,
    )
    assertIncludes(
        standalone,
        'resolveStandaloneTextureDetail={resolveSelectedTextureDetail}',
        `${files.nodeEditorStandalone} must wire selected PE2 texture detail resolution through the standalone shell`,
    )

    const pe2Dialog = readText(files.particleEmitter2Dialog)
    assertIncludes(
        pe2Dialog,
        'selectedParticleEmitter2Texture?.index === textureId',
        `${files.particleEmitter2Dialog} preset save must prefer selected PE2 texture detail before full Textures fallback`,
    )
    assertIncludes(
        pe2Dialog,
        'await resolveStandaloneTextureDetail?.(textureId)',
        `${files.particleEmitter2Dialog} preset save must wait briefly for selected PE2 texture detail before full Textures fallback`,
    )
    assertIncludes(
        pe2Dialog,
        'const resolvePresetTexture = async',
        `${files.particleEmitter2Dialog} must centralize PE2 preset texture resolution`,
    )
    assertIncludes(
        pe2Dialog,
        'createParticleEmitter2TextureOptions',
        `${files.particleEmitter2Dialog} texture dropdown options must be built through the summary/detail helper`,
    )
    assertIncludes(
        pe2Dialog,
        'legacyTextures: isStandalone ? null : modelData?.Textures',
        `${files.particleEmitter2Dialog} standalone PE2 texture UI must not use the full legacy Textures fallback`,
    )
    assertIncludes(
        pe2Dialog,
        'return isStandalone ? null : modelData?.Textures?.[textureId] ?? null',
        `${files.particleEmitter2Dialog} standalone PE2 preset save must not fall back to the full Textures snapshot`,
    )
    assertIncludes(
        pe2Dialog,
        'isParticleEmitter2TextureIdAvailable',
        `${files.particleEmitter2Dialog} TextureID validation must use the summary/detail helper`,
    )
    assertIncludes(
        pe2Dialog,
        'onStandaloneTextureDetailRefreshRequest?.(safeTextureId)',
        `${files.particleEmitter2Dialog} must ask the shared standalone bridge to refresh selected texture detail after TextureID changes`,
    )
    assertNotIncludes(
        pe2Dialog,
        'textureCount = modelData?.Textures?.length',
        `${files.particleEmitter2Dialog} must not validate PE2 TextureID only by full Textures length`,
    )
    const pe2TextureOptions = readText(files.particleEmitter2TextureOptions)
    assertIncludes(
        pe2TextureOptions,
        'textureSummaries?: NodeEditorTextureSummary[]',
        `${files.particleEmitter2TextureOptions} must accept node-editor texture summaries`,
    )
    assertIncludes(
        pe2TextureOptions,
        'selectedTexture?: NodeEditorTextureDetail | null',
        `${files.particleEmitter2TextureOptions} must accept selected PE2 texture detail`,
    )
    assertIncludes(
        pe2TextureOptions,
        'summaries.length > 0',
        `${files.particleEmitter2TextureOptions} must prefer summaries before legacy full textures`,
    )

    const helper = readText(files.nodeEditorSnapshotPayload)
    assertIncludes(
        helper,
        'export const createNodeEditorRpcState',
        `${files.nodeEditorSnapshotPayload} must export the node-editor summary bridge state builder`,
    )
    assertIncludes(
        helper,
        'export const createEmptyNodeEditorRpcState',
        `${files.nodeEditorSnapshotPayload} must export the empty node-editor bridge state builder`,
    )
    assertIncludes(
        helper,
        'globalSequences: []',
        `${files.nodeEditorSnapshotPayload} must keep legacy full globalSequences empty in node-editor snapshots`,
    )
    assertIncludes(
        helper,
        'sequences: []',
        `${files.nodeEditorSnapshotPayload} must keep legacy full sequences empty in node-editor snapshots`,
    )
    assertIncludes(
        helper,
        'allNodes: []',
        `${files.nodeEditorSnapshotPayload} must keep legacy full allNodes empty in node-editor snapshots`,
    )
    assertIncludes(
        helper,
        'materials: []',
        `${files.nodeEditorSnapshotPayload} must keep legacy full materials empty in node-editor snapshots`,
    )
    assertIncludes(
        helper,
        'textures: []',
        `${files.nodeEditorSnapshotPayload} must keep legacy full textures empty in node-editor snapshots`,
    )
    assertNotIncludes(
        helper,
        'textures: modelData?.Textures',
        `${files.nodeEditorSnapshotPayload} must not broadcast the full Textures array`,
    )
    assertIncludes(
        helper,
        'export const createSelectedNodePivotPoint',
        `${files.nodeEditorSnapshotPayload} must export selected-node pivot detail creation`,
    )
    assertIncludes(
        helper,
        'export const createSelectedParticleEmitter2Texture',
        `${files.nodeEditorSnapshotPayload} must export selected PE2 texture detail creation`,
    )
    assertIncludes(
        helper,
        'selectedPivotPoint',
        `${files.nodeEditorSnapshotPayload} must carry the selected pivot detail in node-editor snapshots`,
    )
    assertIncludes(
        helper,
        'selectedParticleEmitter2Texture',
        `${files.nodeEditorSnapshotPayload} must carry selected PE2 texture detail in node-editor snapshots`,
    )
    assertIncludes(
        helper,
        'resolveNodeEditorSelectedDetailNode',
        `${files.nodeEditorSnapshotPayload} must resolve selected PE2 texture detail from the active preview node when available`,
    )
    assertIncludes(
        helper,
        'nodeEditorPreview?.objectId === session.objectId',
        `${files.nodeEditorSnapshotPayload} must only use node-editor preview detail for the active selected node`,
    )
    const mainLayout = readText(files.mainLayout)
    assertIncludes(
        mainLayout,
        'nodeEditorPreview: live.nodeEditorPreview',
        `${files.mainLayout} must pass node-editor preview overlay state into the snapshot bridge`,
    )
    assertIncludes(
        helper,
        'pivotPoints: []',
        `${files.nodeEditorSnapshotPayload} must keep legacy full PivotPoints empty in node-editor snapshots`,
    )
    assertNotIncludes(
        helper,
        'pivotPoints: modelData?.PivotPoints',
        `${files.nodeEditorSnapshotPayload} must not broadcast the full PivotPoints table`,
    )
}

const checkGeosetEditorStrictSavePayload = () => {
    const helper = readText(files.geosetEditorPayload)
    assertIncludes(
        helper,
        "stalePolicy = 'reject'",
        `${files.geosetEditorPayload} geoset editor saves must default to reject`,
    )

    const modal = readText(files.geosetEditorModal)
    assertIncludes(
        modal,
        'createSaveAllGeosetsCommandPayload',
        `${files.geosetEditorModal} must use the shared geoset-editor payload helper`,
    )

    const handler = readText(files.collectionToolWindowHandlers)
    assertIncludes(
        handler,
        'parseSaveAllGeosetsCommandPayload',
        `${files.collectionToolWindowHandlers} must parse geoset-editor payloads through the shared helper`,
    )
}

const checkGeosetVisibilityActionShapes = () => {
    const modal = readText(files.geosetVisibilityModal)
    assertIncludes(
        modal,
        "action: 'SAVE_ANIMS'",
        `${files.geosetVisibilityModal} must emit typed SAVE_ANIMS actions`,
    )
    assertIncludes(
        modal,
        "stalePolicy: 'reject'",
        `${files.geosetVisibilityModal} SAVE_ANIMS must be treated as a durable write`,
    )
    assertIncludes(
        modal,
        "action: 'SET_SEQUENCE'",
        `${files.geosetVisibilityModal} must emit typed SET_SEQUENCE actions`,
    )
    assertIncludes(
        modal,
        "action: 'SET_FRAME'",
        `${files.geosetVisibilityModal} must emit typed SET_FRAME actions`,
    )

    const handler = readText(files.collectionToolWindowHandlers)
    assertIncludes(
        handler,
        'normalizeGeosetVisibilityPayload',
        `${files.collectionToolWindowHandlers} must normalize geoset-visibility payloads`,
    )
}

const checkGeosetAnimationStrictPayload = () => {
    const helper = readText(files.geosetAnimationPayload)
    assertIncludes(
        helper,
        "stalePolicy: 'reject'",
        `${files.geosetAnimationPayload} geoset animation writes must default to reject`,
    )

    const modal = readText(files.geosetAnimationModal)
    assertIncludes(
        modal,
        'createUpdateGeosetAnimsPayload',
        `${files.geosetAnimationModal} must use the shared geoset-animation payload helper`,
    )

    const handler = readText(files.collectionToolWindowHandlers)
    assertIncludes(
        handler,
        'parseUpdateGeosetAnimsPayload',
        `${files.collectionToolWindowHandlers} must parse geoset-animation payloads through the shared helper`,
    )
}

const checkTextureAnimationStrictPayload = () => {
    const helper = readText(files.textureAnimationPayload)
    assertIncludes(
        helper,
        "stalePolicy = 'reject'",
        `${files.textureAnimationPayload} texture animation writes must default to reject`,
    )
    assertIncludes(
        helper,
        'DELETE requires deleteIndex',
        `${files.textureAnimationPayload} must keep deleteIndex for material remap`,
    )

    const modal = readText(files.textureAnimationModal)
    assertIncludes(
        modal,
        'createTextureAnimationCommandPayload',
        `${files.textureAnimationModal} must use the shared texture-animation payload helper`,
    )

    const handler = readText(files.collectionToolWindowHandlers)
    assertIncludes(
        handler,
        'parseTextureAnimationCommandPayload',
        `${files.collectionToolWindowHandlers} must parse texture-animation payloads through the shared helper`,
    )
}

const checkModelOptimizeStrictPayload = () => {
    const helper = readText(files.modelOptimizePayload)
    assertIncludes(
        helper,
        "type: 'model-optimize-command'",
        `${files.modelOptimizePayload} must use a typed model optimize command envelope`,
    )
    assertIncludes(
        helper,
        "input.stalePolicy ?? 'reject'",
        `${files.modelOptimizePayload} model optimize commands must default to reject`,
    )

    const modal = readText(files.modelOptimizeModal)
    assertIncludes(
        modal,
        'createModelOptimizeCommandPayload',
        `${files.modelOptimizeModal} must use the shared model optimize payload helper`,
    )

    const mainLayout = readText(files.mainLayout)
    assertIncludes(
        mainLayout,
        'parseModelOptimizeCommandPayload',
        `${files.mainLayout} must parse model optimize payloads through the shared helper`,
    )
}

checkStandaloneEntrypoint()
checkSnapshotEnvelope()
checkStandaloneRouterImports()
checkDetachedImports()
checkDissolveCommandPayload()
checkDissolveServerGuard()
checkGlobalColorAdjustCommandEnvelope()
checkGlobalSequenceStrictSavePayload()
checkCameraManagerStrictWrites()
checkSequenceEditorStrictSavePayload()
checkTextureManagerPayloadHelper()
checkMaterialManagerPayloadHelper()
checkNodeEditorPayloadHelper()
checkGeosetEditorStrictSavePayload()
checkGeosetVisibilityActionShapes()
checkGeosetAnimationStrictPayload()
checkTextureAnimationStrictPayload()
checkModelOptimizeStrictPayload()

console.log('Standalone light-client guard passed')
