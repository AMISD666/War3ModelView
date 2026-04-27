import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const repoRoot = process.cwd()
const rendererSrc = join(repoRoot, 'src', 'renderer', 'src')
const migratedRenderRoot = join(rendererSrc, 'application', 'render')

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const checkedSourceRoots = [
  join(rendererSrc, 'components'),
  join(rendererSrc, 'application'),
  join(rendererSrc, 'commands'),
  join(rendererSrc, 'hooks'),
  join(rendererSrc, 'store'),
  join(rendererSrc, 'types'),
]

const sharedLayerRoots = [
  join(rendererSrc, 'application'),
  join(rendererSrc, 'infrastructure'),
  join(rendererSrc, 'services'),
  join(rendererSrc, 'utils'),
]

const allowedWar3ModelImports = new Set()

const allowedDocumentSetterFiles = new Set([
  normalizePath(join(rendererSrc, 'store', 'modelStore.ts')),
  normalizePath(join(rendererSrc, 'application', 'commands', 'ModelDocumentCommandHandler.ts')),
  normalizePath(join(rendererSrc, 'application', 'commands', 'TextureMaterialCommandHandler.ts')),
])

const allowedTexturePreviewCacheKeyFiles = new Set([
  normalizePath(join(rendererSrc, 'application', 'cache', 'RevisionedCacheKeys.ts')),
])

const allowedCacheDiagnosticFiles = new Set([
  normalizePath(join(rendererSrc, 'application', 'cache', 'CacheDiagnostics.ts')),
])

const allowedBackendTextureCacheCommandFiles = new Set([
  normalizePath(join(rendererSrc, 'application', 'cache', 'TextureBatchCacheStats.ts')),
])

const allowedPreviewOverlaySetterFiles = new Set([
  normalizePath(join(rendererSrc, 'store', 'modelStore.ts')),
  normalizePath(join(rendererSrc, 'application', 'preview', 'PreviewOverlayService.ts')),
])

const allowedCommandDiagnosticFiles = new Set([
  normalizePath(join(rendererSrc, 'application', 'diagnostics', 'CommandDiagnostics.ts')),
])

const allowedSnapshotDiagnosticFiles = new Set([
  normalizePath(join(rendererSrc, 'application', 'diagnostics', 'SnapshotDiagnostics.ts')),
])

const allowedRendererDiagnosticFiles = new Set([
  normalizePath(join(rendererSrc, 'application', 'render', 'RendererSyncDiagnostics.ts')),
])

const documentSetterNames = [
  'setTextures',
  'setMaterials',
  'setVisualDataPatch',
  'setGeosets',
  'setGeosetAnims',
  'setTextureAnims',
  'setCameras',
  'replaceDocumentSnapshot',
]

const failures = []

for (const filePath of walkSourceFiles(checkedSourceRoots)) {
  const normalizedFile = normalizePath(filePath)
  const source = readFileSync(filePath, 'utf8')
  const lines = source.split(/\r?\n/)

  checkForbiddenImports(normalizedFile, lines)
  checkDocumentSetterUsage(normalizedFile, lines)
  checkTexturePreviewCacheKeyUsage(normalizedFile, lines)
  checkCacheDiagnosticUsage(normalizedFile, lines)
  checkBackendTextureCacheCommandUsage(normalizedFile, lines)
  checkPreviewOverlaySetterUsage(normalizedFile, lines)
  checkCommandDiagnosticUsage(normalizedFile, lines)
  checkSnapshotDiagnosticUsage(normalizedFile, lines)
  checkRendererDiagnosticUsage(normalizedFile, lines)
  checkApplicationStandalonePerfImports(normalizedFile, lines)
  checkApplicationWindowLayoutImports(normalizedFile, lines)
  checkNodeEditorRpcLayoutMetadata(normalizedFile, lines)
  checkPreviewFieldWrites(normalizedFile, lines)
  checkComponentPreviewProjectionUsage(normalizedFile, lines)
  checkComponentFileProtocolPreviewUsage(normalizedFile, lines)
  checkObsoletePreviewDocumentApiUsage(normalizedFile, lines)
  checkMaterialManagerActionPolicy(normalizedFile, lines)
  checkCommandLayerDirectModelStoreWrites(normalizedFile, lines)
  checkSaveReferenceValidatorUsage(normalizedFile, lines)
  checkApplicationLayerImports(normalizedFile, lines)
}

for (const filePath of walkSourceFiles([rendererSrc])) {
  const normalizedFile = normalizePath(filePath)
  const source = readFileSync(filePath, 'utf8')
  checkDeprecatedWindowLayoutImports(normalizedFile, source.split(/\r?\n/))
}

for (const filePath of walkSourceFiles(sharedLayerRoots)) {
  const normalizedFile = normalizePath(filePath)
  const source = readFileSync(filePath, 'utf8')
  checkSharedLayerTextureLoaderImports(normalizedFile, source.split(/\r?\n/))
  checkPreviewFieldWrites(normalizedFile, source.split(/\r?\n/))
}

checkMigratedRenderFileSizes()

if (failures.length > 0) {
  console.error('Architecture guardrail check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Architecture guardrail check passed.')

function checkMigratedRenderFileSizes() {
  for (const filePath of walk(migratedRenderRoot)) {
    const source = readFileSync(filePath, 'utf8')
    const lineCount = source.split(/\r?\n/).length
    if (lineCount > 300) {
      failures.push(`${relative(repoRoot, filePath)} migrated render module has ${lineCount} lines; keep service/gateway modules at or below 300 lines`)
    }
  }
}

function checkForbiddenImports(filePath, lines) {
  for (const [index, line] of lines.entries()) {
    if (importsSpecifier(line, '@tauri-apps')) {
      addFailure(filePath, index, 'direct @tauri-apps import is forbidden outside infrastructure gateways')
    }

    if (importsSpecifier(line, 'war3-model') && !allowedWar3ModelImports.has(filePath)) {
      addFailure(filePath, index, 'direct war3-model import is forbidden outside infrastructure/model adapters')
    }
  }
}

function checkDocumentSetterUsage(filePath, lines) {
  if (allowedDocumentSetterFiles.has(filePath)) return

  const setterAlternation = documentSetterNames.join('|')
  const directStoreSetter = new RegExp(`\\buseModelStore\\.getState\\(\\)\\.(${setterAlternation})\\b`)
  const selectedStoreSetter = new RegExp(`\\bstate\\s*=>\\s*state\\.(${setterAlternation})\\b`)
  const objectStoreSetter = new RegExp(`\\b(?:modelState|storeState|modelStore|state)\\.(${setterAlternation})\\b`)

  for (const [index, line] of lines.entries()) {
    if (directStoreSetter.test(line) || selectedStoreSetter.test(line) || objectStoreSetter.test(line)) {
      addFailure(filePath, index, 'direct document setter usage must route through an application command handler')
    }
  }
}

function checkTexturePreviewCacheKeyUsage(filePath, lines) {
  if (allowedTexturePreviewCacheKeyFiles.has(filePath)) return

  for (const [index, line] of lines.entries()) {
    if (line.includes('TEXTURE_PREVIEW_CACHE_KEY_VERSION')) {
      addFailure(filePath, index, 'texture preview cache key versioning must use application/cache createTexturePreviewCacheKey')
    }
  }
}

function checkCacheDiagnosticUsage(filePath, lines) {
  if (allowedCacheDiagnosticFiles.has(filePath)) return

  for (const [index, line] of lines.entries()) {
    if (/(?:['"])cache\.(?:hit|miss|staleInvalidated)(?:['"])/.test(line)) {
      addFailure(filePath, index, 'cache diagnostics must route through application/cache CacheDiagnostics')
    }
  }
}

function checkBackendTextureCacheCommandUsage(filePath, lines) {
  if (allowedBackendTextureCacheCommandFiles.has(filePath)) return

  for (const [index, line] of lines.entries()) {
    if (/(?:['"])(?:clear_texture_batch_cache|get_texture_batch_cache_stats)(?:['"])/.test(line)) {
      addFailure(filePath, index, 'backend texture cache commands must route through application/cache TextureBatchCacheStats')
    }
  }
}

function checkPreviewOverlaySetterUsage(filePath, lines) {
  if (allowedPreviewOverlaySetterFiles.has(filePath)) return

  const previewSetterAlternation = [
    'setMaterialManagerPreview',
    'clearMaterialManagerPreview',
    'setNodeEditorPreview',
    'clearNodeEditorPreview',
    'bumpPreviewRevision',
  ].join('|')
  const directStoreSetter = new RegExp(`\\buseModelStore\\.getState\\(\\)\\.(${previewSetterAlternation})\\b`)
  const selectedStoreSetter = new RegExp(`\\bstate\\s*=>\\s*state\\.(${previewSetterAlternation})\\b`)

  for (const [index, line] of lines.entries()) {
    if (directStoreSetter.test(line) || selectedStoreSetter.test(line)) {
      addFailure(filePath, index, 'preview overlay store setters must route through application/preview PreviewOverlayService')
    }
  }
}

function checkCommandDiagnosticUsage(filePath, lines) {
  if (allowedCommandDiagnosticFiles.has(filePath)) return

  for (const [index, line] of lines.entries()) {
    if (/(?:['"])(?:command\.(?:received|accepted|rejected)|document\.revisionChanged|tool_command_stale_revision)(?:['"])/.test(line)) {
      addFailure(filePath, index, 'command diagnostics must route through application/diagnostics CommandDiagnostics')
    }
  }
}

function checkSnapshotDiagnosticUsage(filePath, lines) {
  if (allowedSnapshotDiagnosticFiles.has(filePath)) return

  for (const [index, line] of lines.entries()) {
    if (/(?:['"])(?:snapshot\.(?:sent|received|ignoredStale)|snapshot_(?:sent|received|ignored_stale))(?:['"])/.test(line)) {
      addFailure(filePath, index, 'snapshot diagnostics must route through application/diagnostics SnapshotDiagnostics')
    }
  }
}

function checkRendererDiagnosticUsage(filePath, lines) {
  if (allowedRendererDiagnosticFiles.has(filePath)) return

  for (const [index, line] of lines.entries()) {
    if (/(?:['"])renderer\.sync(?:Started|Applied|Failed)(?:['"])/.test(line)) {
      addFailure(filePath, index, 'renderer sync diagnostics must route through application/render RendererSyncDiagnostics')
    }
  }
}

function checkApplicationStandalonePerfImports(filePath, lines) {
  const applicationRoot = normalizePath(join(rendererSrc, 'application'))
  const standalonePerfFile = normalizePath(join(rendererSrc, 'application', 'diagnostics', 'StandalonePerf.ts'))
  if (!filePath.startsWith(`${applicationRoot}/`) || filePath === standalonePerfFile) return

  for (const [index, line] of lines.entries()) {
    if (importsSpecifier(line, '../../utils/standalonePerf') || importsSpecifier(line, '../utils/standalonePerf')) {
      addFailure(filePath, index, 'application diagnostics must import StandalonePerf from application/diagnostics, not utils')
    }
  }
}

function checkApplicationWindowLayoutImports(filePath, lines) {
  const applicationRoot = normalizePath(join(rendererSrc, 'application'))
  const toolWindowLayoutsFile = normalizePath(join(rendererSrc, 'application', 'window-bridge', 'ToolWindowLayouts.ts'))
  if (!filePath.startsWith(`${applicationRoot}/`) || filePath === toolWindowLayoutsFile) return

  for (const [index, line] of lines.entries()) {
    if (importsSpecifier(line, '../../constants/windowLayouts') || importsSpecifier(line, '../constants/windowLayouts')) {
      addFailure(filePath, index, 'application window layout metadata must come from application/window-bridge/ToolWindowLayouts')
    }
  }
}

function checkDeprecatedWindowLayoutImports(filePath, lines) {
  for (const [index, line] of lines.entries()) {
    if (importsPathContaining(line, 'constants/windowLayouts')) {
      addFailure(filePath, index, 'constants/windowLayouts was removed; use application/window-bridge/ToolWindowLayouts')
    }
  }
}

function checkNodeEditorRpcLayoutMetadata(filePath, lines) {
  const nodeEditorRpcFile = normalizePath(join(rendererSrc, 'types', 'nodeEditorRpc.ts'))
  if (filePath !== nodeEditorRpcFile) return

  for (const [index, line] of lines.entries()) {
    if (line.includes('getNodeEditorWindowLayout') || line.includes('getNodeEditorWindowSize') || line.includes('getNodeEditorWindowTitle')) {
      addFailure(filePath, index, 'node editor RPC types must not own window layout metadata; use application/window-bridge/ToolWindowLayouts')
    }
  }
}

function checkPreviewFieldWrites(filePath, lines) {
  const allowedPreviewStateFiles = new Set([
    normalizePath(join(rendererSrc, 'store', 'modelStore.ts')),
    normalizePath(join(rendererSrc, 'services', 'commitSavedModelService.ts')),
  ])
  if (allowedPreviewStateFiles.has(filePath)) return
  if (filePath.startsWith(`${normalizePath(join(rendererSrc, 'application', 'preview'))}/`)) return
  if (filePath.startsWith(`${normalizePath(join(rendererSrc, 'application', 'render'))}/`)) return

  for (const [index, line] of lines.entries()) {
    if (/\b(?:materialManagerPreview|nodeEditorPreview)\s*:\s*(?:null|payload|\{)/.test(line)) {
      addFailure(filePath, index, 'preview state fields must be written only by modelStore compatibility code or the save-commit cleanup path')
    }
  }
}

function checkComponentPreviewProjectionUsage(filePath, lines) {
  const componentsRoot = normalizePath(join(rendererSrc, 'components'))
  if (!filePath.startsWith(`${componentsRoot}/`)) return

  for (const [index, line] of lines.entries()) {
    if (line.includes('previewProjectionService') || line.includes('getMaterialProjectedModelData')) {
      addFailure(filePath, index, 'component preview projection reads must use application/preview projection hooks')
    }
  }
}

function checkComponentFileProtocolPreviewUsage(filePath, lines) {
  const componentsRoot = normalizePath(join(rendererSrc, 'components'))
  if (!filePath.startsWith(`${componentsRoot}/`)) return

  for (const [index, line] of lines.entries()) {
    if (line.includes('file://') && /(setPreviewUrl|img\.src|filePreviewUrl)/.test(line)) {
      addFailure(filePath, index, 'component image previews must load bytes through a gateway/cache path, not file:// URLs')
    }
  }
}

function importsPathContaining(line, pathFragment) {
  if (/^\s*\/\//.test(line)) return false

  const escaped = escapeRegExp(pathFragment).replaceAll('/', String.raw`[/\\]`)
  const importFrom = new RegExp(`\\bfrom\\s*['"][^'"]*${escaped}['"]`)
  const sideEffectImport = new RegExp(`^\\s*import\\s*['"][^'"]*${escaped}['"]`)
  const requireCall = new RegExp(`\\brequire\\(\\s*['"][^'"]*${escaped}['"]\\s*\\)`)

  return importFrom.test(line) || sideEffectImport.test(line) || requireCall.test(line)
}

function checkObsoletePreviewDocumentApiUsage(filePath, lines) {
  for (const [index, line] of lines.entries()) {
    if (line.includes('commitMaterialManagerPreviewToModel')) {
      addFailure(filePath, index, 'material preview commits must route through TextureMaterialCommandHandler.commitMaterialManagerPreview')
    }
    if (line.includes('mergeMaterialManagerPreview')) {
      addFailure(filePath, index, 'material preview projection must route through PreviewProjectionService')
    }
    if (line.includes('mergeNodeEditorPreview')) {
      addFailure(filePath, index, 'node preview projection must route through PreviewProjectionService')
    }
  }
}

function checkMaterialManagerActionPolicy(filePath, lines) {
  const materialEditorFile = normalizePath(join(rendererSrc, 'components', 'modals', 'MaterialEditorModal.tsx'))
  if (filePath !== materialEditorFile) return

  const source = lines.join('\n')
  if (!source.includes("message.action === 'SAVE_MATERIALS' ? 'warn' : 'reject'")) {
    addFailure(filePath, 0, 'material realtime SAVE_MATERIALS must warn-apply same-document stale revisions while commits reject stale revisions')
  }

  for (const [index, line] of lines.entries()) {
    if (!/emitCommand\(\s*['"]EXECUTE_MATERIAL_ACTION['"]/.test(line)) continue

    const helperWindow = lines.slice(Math.max(0, index - 3), index + 1).join('\n')
    if (!helperWindow.includes('const emitMaterialAction')) {
      addFailure(filePath, index, 'material manager actions must route through the emitMaterialAction helper')
    }
  }
}

function checkCommandLayerDirectModelStoreWrites(filePath, lines) {
  const commandsRoot = normalizePath(join(rendererSrc, 'commands'))
  if (!filePath.startsWith(`${commandsRoot}/`)) return

  for (const [index, line] of lines.entries()) {
    if (/\buseModelStore\.setState\b/.test(line)) {
      addFailure(filePath, index, 'command-layer document writes must route through application command handlers')
    }
  }
}

function checkSaveReferenceValidatorUsage(filePath, lines) {
  const saveUseCaseFile = normalizePath(join(rendererSrc, 'application', 'model-save', 'SaveModelUseCase.ts'))
  if (filePath !== saveUseCaseFile) return

  const source = lines.join('\n')
  if (!source.includes('validateDocumentReferences')) {
    addFailure(filePath, 0, 'save preparation must run document reference integrity validation')
  }
}

function checkApplicationLayerImports(filePath, lines) {
  const applicationRoot = normalizePath(join(rendererSrc, 'application'))
  if (!filePath.startsWith(`${applicationRoot}/`)) return

  for (const [index, line] of lines.entries()) {
    if (importsSpecifier(line, '../components') || importsSpecifier(line, '../../components')) {
      addFailure(filePath, index, 'application layer must not import renderer components; move shared logic to application or infrastructure')
    }
  }
}

function checkSharedLayerTextureLoaderImports(filePath, lines) {
  for (const [index, line] of lines.entries()) {
    if (line.includes('components/viewer/textureLoader') || line.includes('components\\viewer\\textureLoader')) {
      addFailure(filePath, index, 'shared layers must use infrastructure/texture adapters instead of viewer textureLoader')
    }
  }
}

function importsSpecifier(line, specifierPrefix) {
  if (/^\s*\/\//.test(line)) return false

  const escaped = escapeRegExp(specifierPrefix)
  const importFrom = new RegExp(`\\bfrom\\s*['"]${escaped}(?:[/][^'"]*)?['"]`)
  const sideEffectImport = new RegExp(`^\\s*import\\s*['"]${escaped}(?:[/][^'"]*)?['"]`)
  const requireCall = new RegExp(`\\brequire\\(\\s*['"]${escaped}(?:[/][^'"]*)?['"]\\s*\\)`)

  return importFrom.test(line) || sideEffectImport.test(line) || requireCall.test(line)
}

function addFailure(filePath, zeroBasedLine, message) {
  failures.push(`${relative(repoRoot, filePath)}:${zeroBasedLine + 1} ${message}`)
}

function* walkSourceFiles(roots) {
  for (const root of roots) {
    yield* walk(root)
  }
}

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue
      yield* walk(path)
      continue
    }

    if (!entry.isFile()) continue
    if (sourceExtensions.has(getExtension(entry.name))) {
      yield path
    }
  }
}

function getExtension(fileName) {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot)
}

function normalizePath(path) {
  return path.split(sep).join('/')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
