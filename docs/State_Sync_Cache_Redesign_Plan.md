# State, Sync, Preview, and Cache Redesign Plan

Last updated: 2026-04-27

This document is the handoff source of truth for the planned cleanup of War3ModelView's state, preview, snapshot, renderer sync, and cache architecture. Every future change that affects these areas must update this document in the "Change Log" section and, when relevant, the affected design section.

## Problem Statement

The current application has several places that can each behave like a source of truth:

- `modelStore.modelData`
- `modelStore.materialManagerPreview`
- tool-window RPC snapshots
- modal-local draft state
- `ViewerImpl` and `renderer.model`
- frontend texture decode caches
- Rust texture path/bytes/RGBA caches
- active tab snapshots

This causes common failures:

- A UI change is accepted locally but overwritten by a stale snapshot.
- A preview changes but the saved model does not.
- The saved model changes but the renderer keeps old GPU state.
- A cache returns stale texture bytes after a same-path file changes.
- A tool window sends a full copy of old data and accidentally overwrites newer document state.
- Failures are hard to diagnose because there is no shared revision, command result, or sync trace.

The fix is to make the data flow single-directional, versioned, and observable.

## Target Principles

1. `DocumentState` is the only durable model truth.
2. UI components do not mutate model data directly.
3. Tool windows do not send full snapshots back as writes.
4. Preview state is temporary and separate from document state.
5. Renderer state is a projection and can always be rebuilt.
6. Cache entries must declare what revision or file fingerprint they depend on.
7. Every document mutation has a command result and a revision.
8. Stale writes are rejected or explicitly rebased; they are never silently applied.
9. Each sync failure should be attributable to one layer: command, snapshot/RPC, renderer projection, or cache.

## State Taxonomy

### Document State

Durable model data used for save, export, undo, redo, and tab persistence.

Examples:

- Textures
- Materials
- Geosets
- Nodes
- Sequences
- TextureAnims
- GeosetAnims
- Cameras

Rules:

- Only application-layer commands may mutate it.
- It carries `documentId` and `documentRevision`.
- It must not contain preview-only markers such as `_isPreviewKey`.
- It must not contain tool-window local draft state.

### Preview State

Temporary visual overlays that should not affect save or undo until committed.

Examples:

- Material manager live preview
- Texture adjustment preview
- Node editor live preview
- Dragging transform preview
- Temporary keyframe preview

Rules:

- Stored separately from `DocumentState`.
- Has `previewScope`, `previewRevision`, and `baseDocumentRevision`.
- Can be committed into a document command or cancelled.
- Is cleared on active model change, tab close, tool window close, and failed base revision checks.

### Session State

Per-user interaction state.

Examples:

- Active tab
- Selected texture index
- Selected material/layer
- Picked geoset
- Window visibility and layout
- Scroll positions
- Current animation frame

Rules:

- May be synced to tool windows as patches.
- Must not be treated as document content.
- Should not force renderer reload unless it changes visual projection.

### Projection State

Derived state for consumers.

Examples:

- Renderer model instance
- GPU textures and samplers
- Tool-window snapshots
- Texture thumbnails
- Active tab snapshot copies

Rules:

- Can be discarded and rebuilt.
- Must carry the revision it was derived from.
- Must not be used as a write source for `DocumentState`.

## Required Architecture

### Command Bus as the Only Write Entry

All model mutations should go through `CommandBus` or an equivalent application-layer command service.

Target command envelope:

```ts
export interface DocumentCommand<TPayload> {
  type: string
  documentId: string
  baseDocumentRevision: number
  payload: TPayload
  source: {
    windowId: string
    tool?: string
  }
}
```

Target command result:

```ts
export interface DocumentCommandResult {
  accepted: boolean
  documentId: string
  previousDocumentRevision: number
  nextDocumentRevision: number
  affectedDomains: DocumentDomain[]
  rendererPlan: RendererSyncPlan
  error?: {
    code: string
    message: string
    staleRevision?: {
      expected: number
      actual: number
    }
  }
}
```

Initial high-risk commands to migrate first:

- `texture.setCollection`
- `texture.updateDefinition`
- `texture.updateFlags`
- `texture.remove`
- `material.setCollection`
- `material.updateLayer`
- `geoset.updateMetadata`
- `node.update`
- `textureAnim.update`

Current APIs such as `setTextures`, `setMaterials`, `setVisualDataPatch`, and preview setters should become private implementation details or compatibility shims that call commands.

### Revisions

Every model document must expose:

```ts
export interface DocumentRevisionState {
  documentId: string
  documentRevision: number
  assetRevision: number
  previewRevision: number
}
```

Revision meanings:

- `documentRevision`: increments for accepted document mutations.
- `assetRevision`: increments when texture file sources, MPQ archive list/priority, or imported assets change.
- `previewRevision`: increments for temporary overlay changes.
- `rendererRevision`: stored by renderer sync to indicate the last successfully applied document/preview revision.
- `snapshotRevision`: increments for each generated tool-window snapshot.

Rules:

- Tool-window commands must include `baseDocumentRevision`.
- A stale command must be rejected or explicitly rebased.
- Snapshots must include `documentRevision`; clients must ignore older snapshots.
- Renderer sync must report the revision it applied.

### Tool-Window RPC and Snapshots

Snapshots are read-only DTOs. A tool window may receive snapshots, keep local draft state, and send commands. It must not send a mutated snapshot as an authoritative replacement.

Target snapshot envelope:

```ts
export interface ToolWindowSnapshotEnvelope<TPayload> {
  documentId: string
  documentRevision: number
  snapshotRevision: number
  windowId: string
  payload: TPayload
}
```

Rules:

- Snapshot builders read from `DocumentState` and `SessionState`, not `PreviewState`, unless the snapshot explicitly declares a preview projection.
- Snapshot payloads should be structured cloned or treated as readonly.
- `materialManagerPreview` must not be mixed into document snapshots.
- Selection changes should use lightweight patches.
- Full snapshots should be used for bootstrap and model changes only.

Migration target:

- Keep `useRpc` transport, but wrap every sync in `ToolWindowSnapshotEnvelope`.
- Replace full-data write commands from tool windows with domain commands.
- Add stale snapshot rejection on the client side.

### Draft and Preview Flow

Tool windows should use this lifecycle:

1. `openDraft(baseDocumentRevision)`
2. `updateDraft(local fields)`
3. Optional `beginPreview(previewScope)`
4. `updatePreview(previewScope, patch)`
5. `commitDraft()` sends document commands
6. `cancelDraft()` clears preview and local state

Preview target API:

```ts
export interface PreviewOverlay {
  scope: string
  documentId: string
  baseDocumentRevision: number
  previewRevision: number
  domains: DocumentDomain[]
  patch: unknown
}
```

Rules:

- Preview overlays are applied only when computing effective renderer input.
- Preview overlays never update active tab document snapshots.
- Preview overlays never enter save/export.
- Failed command commit clears or rebases the preview.

### Renderer Sync Service

The renderer must be treated as a projection target.

Create a `RendererSyncService` with this shape:

```ts
export interface RendererSyncInput {
  document: ModelData
  previousDocument: ModelData | null
  previewOverlay?: PreviewOverlay | null
  documentRevision: number
  previewRevision: number
}

export interface RendererSyncResult {
  applied: boolean
  documentRevision: number
  previewRevision: number
  plan: RendererSyncPlan
  errors: RendererSyncError[]
}
```

Renderer plan examples:

- `none`
- `textureSamplerOnly`
- `texturePixels`
- `materialsOnly`
- `geosetBuffers`
- `nodeTransforms`
- `animationTracks`
- `fullReload`

Rules:

- `ViewerImpl` should not contain domain-specific diff logic long term.
- Renderer sync receives typed diffs and decides the cheapest safe operation.
- If a patch path is uncertain, choose `fullReload` and record why.
- Renderer never writes back into `DocumentState`.
- Renderer reports failed plan application with revision and domain.

Initial extraction targets from `ViewerImpl`:

- texture path/adjustment/flags sync
- material sync
- geoset buffer sync
- node sync
- particle/ribbon sync

## Cache Design

### Cache Registry

All caches need a namespace, key, dependency token, and invalidation path.
Started in `src/renderer/src/application/cache/CacheRegistry.ts` with
`RevisionedMemoryCache<T>`, which tracks namespace, key, dependency tokens,
created/access timestamps, estimated bytes, and LRU bounds. The shared texture
preview cache and frontend texture decode cache now store entries through this
registry helper. Rust-side bytes/RGBA cache stats are exposed through
`get_texture_batch_cache_stats` and are queryable from the view settings debug
controls.

```ts
export interface CacheDependencyToken {
  kind: 'documentRevision' | 'assetRevision' | 'fileFingerprint' | 'mpqRevision' | 'decoderVersion' | 'textureSignature' | 'previewOptions'
  value: string | number | boolean | null
  label?: string
}

export interface CacheEntryMeta {
  namespace: string
  key: string
  dependsOn: CacheDependencyToken[]
  createdAt: number
  lastAccessedAt: number
  estimatedBytes?: number
}
```

### Required Cache Keys

Local file bytes:

```text
fs:{normalizedPathLower}:{mtimeNs}:{size}
```

MPQ bytes:

```text
mpq:{archiveListRevision}:{archivePriorityRevision}:{normalizedPathLower}
```

Decoded texture:

```text
decode:{sourceKey}:{decoderVersion}:{maxDimension}:{alphaMode}:{adjustmentSignature}
```

Texture preview:

```text
preview:{documentId}:{textureIdentity}:{assetRevision}:{previewOptionsSignature}
```

Renderer GPU texture:

```text
gpuTexture:{documentId}:{texturePath}:{assetRevision}:{adjustmentSignature}
```

Tool snapshot:

```text
snapshot:{documentId}:{documentRevision}:{selectionRevision}:{windowId}
```

### Rust Texture Cache

Current Rust cache is in `src-tauri/src/main.rs` and stores:

- path hits
- source bytes
- decoded RGBA thumbnails

Required changes:

- Include local file `mtime` and `size` in bytes keys.
- Store path-hit entries with the resolved file fingerprint.
- Invalidate a path hit if fingerprint changed.
- Add MPQ archive revision and priority revision to MPQ keys.
- Expose debug stats for cache hits, misses, evictions, and stale invalidations.
- Keep `clear_texture_batch_cache`, but use it as an escape hatch, not the normal invalidation strategy.

### Frontend Texture Decode Cache

Rules:

- Decode cache keys must include decoder version and decode options.
- Color-adjusted and unadjusted images must never share keys.
- Alpha-sensitive decode mode must be part of the key.
- Preview cache must not include temporary editor IDs unless the editor ID represents stable document identity.

## Observability

Add a small diagnostics layer that can be shown in development builds.

Required events:

- `command.received`
- `command.accepted`
- `command.rejected`
- `document.revisionChanged`
- `snapshot.sent`
- `snapshot.received`
- `snapshot.ignoredStale`
- `renderer.syncStarted`
- `renderer.syncApplied`
- `renderer.syncFailed`
- `cache.hit`
- `cache.miss`
- `cache.staleInvalidated`

Each event should include:

- `documentId`
- `documentRevision`
- `windowId` when available
- domain names
- elapsed time
- error code if failed

This makes "the change did not take effect" actionable: the log should show whether the command was rejected, snapshot was stale, renderer plan failed, or cache returned stale data.

## Verification Requirements

Every migration step must include at least one focused verification path.

Minimum tests/checks:

- A stale tool-window command does not overwrite newer document state.
- Texture `Flags` changes update sampler without clearing preview pixels.
- Same-path texture file replacement invalidates bytes/decode/preview caches.
- Preview adjustment is visible in renderer but not saved until committed.
- Closing a tool window clears its preview overlay.
- Switching active model rejects old snapshots.
- Renderer sync result reports the exact applied revision.

For build-affecting or shared-state changes, run:

```text
npm run typecheck
```

## Migration Plan

### Phase 1: Revision Foundation

Status: completed for current redesign scope

Tasks:

- Add `documentId` and `documentRevision` to active model state. Done for the active model store and tab snapshots.
- Add `assetRevision` for MPQ/archive/file source changes. Done for active model disk path replacement, frontend MPQ load/priority changes, and Rust MPQ cache keys.
- Add `previewRevision`. Done for material manager preview, node editor preview, global color preview, and save-commit preview cleanup.
- Wrap tool-window snapshots in revision envelopes. Done for texture/material manager RPC states with `ToolWindowSnapshotEnvelope`, `windowId`, `snapshotRevision`, and `payload`; node editor, timeline, geoset, camera, model optimize, and dissolve-effect snapshots now carry revision metadata. Legacy `snapshotVersion`/`snapshot` fields remain only as compatibility read fields where already present.
- Log stale snapshot detection. Done in `useRpcClient` for revisioned snapshots.

Acceptance:

- Existing UI behavior remains unchanged.
- MPQ load and priority changes bump `assetRevision` and invalidate active renderer projections without dirtying the document.
- Texture/material tool-window snapshots carry document and preview revision metadata.
- Texture/material, node editor, sequence, global sequence, geoset, texture animation, camera, model optimize, and dissolve-effect standalone commands plus revisioned RPC snapshot logs include document revision where they can mutate document state.

### Phase 2: Command Write Path

Status: completed for current redesign scope

Tasks:

- Add typed document commands for textures and materials. Done with `TextureMaterialCommandHandler` and command result metadata.
- Route texture manager writes through CommandBus. Done for current frontend component writes; store setters remain as compatibility implementations.
- Route material manager writes through CommandBus. Done for current frontend component writes; preview clear/commit now route through application command/preview services.
- Keep old store setters as temporary compatibility shims. Done for texture/material setters with `@deprecated` annotations.
- Reject stale tool-window writes. Done for texture/material, node editor mutating actions, sequence/global sequence saves, geoset editor/visibility/animation writes, texture animation writes, camera manager writes, model optimize, and dissolve-effect commands.

Acceptance:

- Texture/material edits cannot be applied from stale snapshots.
- Direct `setTextures`/`setMaterials`/`setVisualDataPatch`/`setGeosets`/`setGeosetAnims`/`setTextureAnims`/`setCameras` document writes are reduced to application command handlers or store compatibility implementations for current frontend component/application/command code. Remaining `setGeosets` search hits in `GeosetAnimationModal` are local React state setters.

### Phase 3: Preview Overlay Separation

Status: completed for current redesign scope

Tasks:

- Replace `materialManagerPreview` document-like behavior with preview overlays. Done for current material manager paths through `PreviewOverlayService`; live updates no longer dirty the active document, and obsolete store-level preview merge/commit compatibility exports were removed.
- Move node live preview into shared preview service. Done for node editor preview/clear command paths.
- Ensure preview overlays are excluded from save/export. Done by removing material/node preview merging from `getModelDataForSave`; standalone material manager now uses explicit `COMMIT_MATERIALS` to write document state.
- Add preview cleanup on close, cancel, active model switch, save commit, and failed commit. Started for standalone material cancel/close via `CLEAR_MATERIAL_PREVIEW`; active model switch already clears store preview state. Continued by adding tool-window lifecycle cleanup for material-manager and node-editor preview overlays on native close, hide, and window destruction, clearing material/node preview overlays when stale revision checks reject their tool-window commands, and advancing `previewRevision` when save commit cleanup clears active preview overlays.
- Centralize preview projection reads. Started with `PreviewProjectionService`; MainLayout, Viewer material reload, UV mode, material animation panel, and timeline now read effective preview-projected model data through that service. Continued with projection hooks so UI components do not directly coordinate material preview state. Texture/material tool-window snapshot bootstrap now also consumes explicitly projected `modelData`, and snapshot envelopes declare whether they contain `document` or `materialPreview` projection data.

Acceptance:

- Live preview is visible but does not dirty/save until committed, unless explicitly intended.
- Cancelling preview restores renderer to document projection.

### Phase 4: Renderer Sync Extraction

Status: completed for current redesign scope

Tasks:

- Create `RendererSyncService`. Started with material/texture fast-reload projection sync extracted from `ViewerImpl`.
- Create `RendererSyncService`. Started with material/texture fast-reload projection sync extracted from `ViewerImpl`, then expanded to cover the main document material sync path and geoset-to-material binding refresh.
- Create `RendererSyncService`. Started with material/texture fast-reload projection sync extracted from `ViewerImpl`, then expanded to cover the main document material sync path, geoset-to-material binding refresh, and animation metadata projection sync (`GeosetAnims`, `Sequences`, `GlobalSequences`, pivot/extents).
- Create `RendererSyncService`. Started with material/texture fast-reload projection sync extracted from `ViewerImpl`, then expanded to cover the main document material sync path, geoset-to-material binding refresh, animation metadata projection sync (`GeosetAnims`, `Sequences`, `GlobalSequences`, pivot/extents), and geoset buffer/meta patch sync.
- Create `RendererSyncService`. Started with material/texture fast-reload projection sync extracted from `ViewerImpl`, then expanded to cover the main document material sync path, geoset-to-material binding refresh, animation metadata projection sync (`GeosetAnims`, `Sequences`, `GlobalSequences`, pivot/extents), geoset buffer/meta patch sync, and node projection/structure sync.
- Create `RendererSyncService`. Started with material/texture fast-reload projection sync extracted from `ViewerImpl`, then expanded to cover the main document material sync path, geoset-to-material binding refresh, animation metadata projection sync (`GeosetAnims`, `Sequences`, `GlobalSequences`, pivot/extents), geoset buffer/meta patch sync, node projection/structure sync, texture state projection (`Textures`, samplers, wrap sync, `TextureAnims`), and scene metadata sync for particle/ribbon/camera/helper-style renderer domains.
- Move texture/material/geoset/node sync logic out of `ViewerImpl`. Continued by splitting renderer sync types, diagnostics, material sync, animation sync, scene sync, geoset sync, node sync, and texture sync into dedicated `application/render` modules while keeping `RendererSyncService` as the stable facade.
- Add typed renderer plans and result reporting.
- Keep full reload fallback.

Acceptance:

- Renderer applies known domain patches without broad reload.
- Failed patch paths report a clear fallback reason.

### Phase 5: Cache Rework

Status: completed for current redesign scope

Tasks:

- Add file fingerprint keys to Rust bytes cache. Done with local file `mtime/size` fingerprinted fs cache keys and path-hit fingerprint validation in `src-tauri/src/main.rs`.
- Add MPQ archive revision keys. Done with `archive_list_revision` and `archive_priority_revision` tracking in `src-tauri/src/mpq_manager.rs`, wired into Rust MPQ texture bytes cache keys.
- Add cache diagnostics. Started with aggregate `cache.hit` / `cache.miss` events for frontend texture decode cache reads in `src/renderer/src/components/viewer/textureLoader.ts`, plus backend `cache.hit` / `cache.miss` / `cache.staleInvalidated` events around Rust texture bytes and RGBA thumbnail cache resolution in `src-tauri/src/main.rs`. Continued by adding `src/renderer/src/application/cache/CacheDiagnostics.ts` as the frontend cache diagnostic entry point for hit/miss/stale-invalidation events, then added cumulative Rust texture cache stats via `get_texture_batch_cache_stats` and a view-settings debug query path.
- Audit frontend decode and preview cache keys. Started with decoder-version and alpha-mode aware frontend decode cache keys in `src/renderer/src/components/viewer/textureDecodeCache.ts`, then tightened `src/renderer/src/components/modals/TextureEditorModal.tsx` preview cache identity to include `documentId`, `assetRevision`, and texture-definition signature instead of a path-only key. Continued by adding a shared preview loader/cache in `src/renderer/src/application/preview/TexturePreviewLoader.ts` so geoset preview dialogs reuse revision-scoped preview URLs instead of directly decoding textures or using loose `file://` paths, by revision-scoping `ViewerImpl` live texture source caching with `assetRevision`, by centralizing texture preview cache-key construction in `src/renderer/src/application/cache/RevisionedCacheKeys.ts`, and by routing shared preview/decode cache entries through `RevisionedMemoryCache` metadata with dependency tokens.
- Remove path-only cache keys for mutable local files. Done for frontend preview/decode caches and Rust texture bytes/RGBA caches; remaining direct local image preview fallbacks now read bytes and create data URLs instead of using `file://` image sources.

Acceptance:

- Replacing a texture file at the same path changes preview and renderer output without manual cache clear.
- Cache hit/miss logs identify stale invalidations.

### Phase 6: Cleanup and Guardrails

Status: completed for current redesign scope

Tasks:

- Remove obsolete preview-as-document code. Continued by removing `commitMaterialManagerPreviewToModel`, `mergeMaterialManagerPreview`, and `mergeNodeEditorPreview` from `modelStore`; material preview commits now route through `TextureMaterialCommandHandler.commitMaterialManagerPreview`, and preview projection reads route through `PreviewProjectionService`.
- Make direct document setters private or clearly marked deprecated. Continued by marking the remaining store compatibility setters for cameras, geosets, texture animations, and geoset animations as deprecated command-handler implementation details.
- Add lint/search checklist for forbidden patterns. Started with manual guardrail searches for UI-level `@tauri-apps/*`, direct `war3-model`, direct document setter, and stale snapshot/write patterns; continued with `npm run check:architecture` as a repeatable guardrail check that now also covers migrated command files, direct frontend cache diagnostic event strings, direct command diagnostic event strings, direct snapshot diagnostic event strings, direct renderer-sync diagnostic event strings, application-layer `standalonePerf` imports from `utils`, removed `constants/windowLayouts` imports across renderer source, node-editor RPC type ownership of window layout metadata, direct preview field writes outside the compatibility store/save-cleanup paths, and component-level direct preview projection service calls.
- Remove direct platform/model-library imports from UI components. Continued by moving animation/editor keyframe event listeners, texture preview file reads, texture-manager Tauri calls, viewer Tauri calls, BLP decode helpers, `ModelRenderer` creation, and command-layer geoset buffer refreshes behind infrastructure gateways/adapters.
- Document command and preview patterns for future features. Started with the "Current Implementation Patterns" section below.

Acceptance:

- New feature work has one obvious mutation path.
- State ownership can be understood from this document and code structure.

## Current High-Risk Files

These files remain historically large or high-risk, but the state/sync/cache ownership rules above are now guarded by `npm run check:architecture`:

- `src/renderer/src/store/modelStore.ts`
- `src/renderer/src/hooks/useRpc.ts`
- `src/renderer/src/application/window-bridge/ToolWindowSnapshots.ts`
- `src/renderer/src/application/window-bridge/ToolWindowCommandHandlers.ts`
- `src/renderer/src/components/viewer/ViewerImpl.tsx`
- `src/renderer/src/components/viewer/textureLoader.ts`
- `src/renderer/src/components/modals/TextureEditorModal.tsx`
- `src/renderer/src/components/modals/MaterialEditorModal.tsx`
- `src-tauri/src/main.rs`

## Current Implementation Patterns

These are the patterns new work should follow after this migration.

### Document Commands

- UI components and standalone tool windows should call application command handlers instead of store document setters.
- Use `TextureMaterialCommandHandler` for texture/material collection writes, material preview commit/clear, and texture/material/geoset combined writes.
- Use `ModelDocumentCommandHandler` for camera, geoset, geoset animation, texture animation, and full model-data replacements.
- Store setters such as `setTextures`, `setMaterials`, `setVisualDataPatch`, `setGeosets`, `setGeosetAnims`, `setTextureAnims`, and `setCameras` are compatibility implementations for command handlers only.
- Tool-window document writes must include `documentId`, `baseDocumentRevision`, and an explicit stale policy where the caller can reject stale writes.
- Command diagnostics must go through `application/diagnostics/CommandDiagnostics.ts`.

### Preview Projection

- Preview writes should enter through `PreviewOverlayService`; callers should not write preview state directly unless they are inside the compatibility store implementation.
- `npm run check:architecture` now rejects direct frontend calls to preview overlay store setters outside `modelStore` and `PreviewOverlayService`.
- Read-side preview projection should use `PreviewProjectionService`, including renderer input and tool-window bootstrap snapshots that intentionally show material preview state.
- UI components should consume preview-projected model data through `application/preview` hooks; direct calls to `previewProjectionService` belong in application-layer projection/snapshot/render services.
- Preview projection must not be merged into save/export paths or active tab document snapshots.
- Preview cancellation, tool-window close, active model switch, and failed commit paths should clear preview state through the application command or preview service.
- Save-commit cleanup may clear active preview overlays, but must advance `previewRevision` and update active tab snapshot revision metadata when it does.

### Snapshot and Renderer Observability

- RPC snapshots should remain read-only DTOs with revision metadata and use `ToolWindowSnapshotEnvelope` where applicable.
- Snapshot diagnostics must go through `application/diagnostics/SnapshotDiagnostics.ts`.
- Shared standalone perf event emission now lives in `application/diagnostics/StandalonePerf.ts`; application-layer code should import it from there instead of `utils/standalonePerf`.
- Tool-window and node-editor size/title layout metadata now lives in `application/window-bridge/ToolWindowLayouts.ts`; the old `constants/windowLayouts.ts` compatibility re-export has been removed.
- Renderer mutation should go through `RendererSyncService` domain methods or an explicitly documented fallback reload path.
- Renderer sync diagnostics must stay inside `application/render/RendererSyncDiagnostics.ts`.

### Cache and Local Preview

- Texture preview cache keys must be created through `application/cache/RevisionedCacheKeys.ts`.
- Frontend cache entries that can outlive a render pass should use `RevisionedMemoryCache` metadata when practical.
- Local image previews should read bytes through `desktopGateway` or texture infrastructure helpers and then create decoded data/object URLs; components must not assign local `file://` URLs as preview image sources.

## Immediate Guardrails

Until the migration is complete:

- Do not add new direct calls from UI components to `setTextures`, `setMaterials`, or `setVisualDataPatch`.
- Do not add new snapshot payloads that can be written back wholesale.
- Do not add preview data to active tab snapshots.
- Do not use path-only cache keys for mutable local resources.
- Do not add renderer mutations that lack a documented invalidation or sync plan.
- Do not add direct `@tauri-apps/*` or `war3-model` imports to UI components; use infrastructure gateways or adapter modules instead.
- Treat realtime preview commands differently from durable commits: preview updates such as material-manager `SAVE_MATERIALS` may warn-apply on same-document stale revisions, while commit/save actions must reject stale revisions.
- Track remaining save/commit/reference-integrity repairs in `docs/State_Sync_Commit_Integrity_Repair_Plan.md`; this document remains the architecture baseline, and the focused repair plan is the execution checklist.
- When fixing a bug in these areas, update this document's change log.

## Change Log

### 2026-04-27

- Started Phase 6 cleanup and guardrails:
  - Fixed two missed domain-sync cases found after the redesign pass:
    - `GeosetVisibilityPanel` delete/merge now updates `Geosets` and remapped `GeosetAnims` in one document command, preserving geoset-animation references when geoset indices shift.
    - `MaterialEditorModal` standalone realtime `SAVE_MATERIALS` preview commands now use warn-compatible same-document stale handling and keep `syncStandaloneMaterials()` bound to the latest revisioned command emitter, so deleting a material layer is not rejected while waiting for the next RPC snapshot. Durable `COMMIT_MATERIALS` remains strict stale-reject.
  - Added `docs/State_Sync_Commit_Integrity_Repair_Plan.md` as the focused execution plan for remaining save/commit/preview/index-reference integrity bugs.
  - Extended `npm run check:architecture` to guard the material-manager action policy: material actions must route through `emitMaterialAction`, realtime `SAVE_MATERIALS` stays warn-compatible, and commits remain strict stale-reject.
  - Added `replaceDocumentSnapshot()` behind `ModelDocumentCommandHandler.replaceDocumentSnapshot()` for atomic full-document snapshot replacements that still preserve document revision, active tab snapshot, dirty state, preview cleanup, and renderer reload semantics.
  - Routed `SplitVerticesCommand`, `AutoSeparateLayersCommand`, `GlobalTransformCommand`, and `MirrorModelCommand` through the application command handler instead of direct `useModelStore.setState` patches.
  - Extended `npm run check:architecture` to reject new direct `useModelStore.setState` document writes in `src/renderer/src/commands`.
  - Added `src/renderer/src/application/model-validation/DocumentReferenceValidator.ts` and wired it into `SaveModelUseCase.prepareModelForSave()` so save/export preflight reports invalid indexed references before `prepareModelDataForSave()` can silently clamp them.
  - Fixed texture-animation deletion paths so deleting `TextureAnims[n]` also clears material-layer `TVertexAnimId === n` and decrements later `TVertexAnimId` references through one `TextureAnims + Materials` document command.
  - Replaced direct `@tauri-apps/api/event` keyframe-save listeners in `src/renderer/src/components/animation/MaterialAnimPanel.tsx`, `src/renderer/src/components/animation/GeosetAnimPanel.tsx`, `src/renderer/src/components/animation/TextureAnimGizmoPanel.tsx`, and `src/renderer/src/components/editors/material/LayerDetail.tsx` with the existing `useWindowEvent` hook so event transport stays behind `infrastructure/window`.
  - Replaced direct Tauri file reads in `src/renderer/src/components/animation/TextureAnimGizmoPanel.tsx`, `src/renderer/src/components/editors/UVEditor.tsx`, and `src/renderer/src/components/editors/texture/TextureDetail.tsx` with `desktopGateway.readFile`.
  - Removed direct `war3-model` BLP decode usage from `src/renderer/src/components/editors/UVEditor.tsx` by routing UV texture preview decoding through `decodeTextureData`.
  - Verified `src/renderer/src/components/animation` and `src/renderer/src/components/editors` no longer contain direct `@tauri-apps/*` or `war3-model` imports.
  - Replaced direct Tauri command/dialog/window/event access in `src/renderer/src/components/modals/ActivationModal.tsx`, `DissolveEffectModal.tsx`, `GlobalSequenceDurationEditor.tsx`, `GlobalSequenceModal.tsx`, `GeosetEditorModal.tsx`, `src/renderer/src/components/MainLayoutNew.tsx`, and `src/renderer/src/components/detached/TextureEditorDetachedWindow.tsx` with `desktopGateway`, `windowGateway`, or `useWindowEvent`.
  - Replaced direct Tauri file/dialog/command access in `src/renderer/src/components/mpq/MpqBrowserPanel.tsx` with `desktopGateway`, and moved MPQ model dependency parsing from direct `war3-model` imports to `modelSerializationGateway`.
  - Added `directory` and `getFileSize()` support to `src/renderer/src/infrastructure/desktop/DesktopGateway.ts` / `tauriDesktopGateway.ts`, then routed `src/renderer/src/components/modals/MaterialEditorModal.tsx` external texture import file reads/writes/existence/size checks through that gateway.
  - Remaining direct UI-level platform imports were reduced further: `src/renderer/src/components/modals/TextureEditorModal.tsx`, `src/renderer/src/components/viewer/textureLoader.ts`, and `src/renderer/src/components/viewer/ViewerImpl.tsx` now use `desktopGateway` / `windowGateway` for Tauri filesystem, dialog, command, window, and event access.
  - Added `src/renderer/src/infrastructure/texture/war3TextureDecoder.ts` so BLP decode helpers from `war3-model` are isolated behind an infrastructure texture adapter; `textureLoader.ts` and Viewer live texture preview now consume that adapter instead of importing BLP helpers directly.
  - Current guardrail search shows no direct `@tauri-apps/*` imports under `src/renderer/src/components`, `src/renderer/src/application`, `src/renderer/src/hooks`, or `src/renderer/src/store`.
  - Added `scripts/check-architecture-guardrails.mjs` and `npm run check:architecture` to make the guardrail search repeatable. The check blocks direct `@tauri-apps/*` imports in renderer UI/application/store/hook layers, blocks direct `war3-model` imports in those layers, and blocks direct document setter usage outside the store compatibility layer and application command handlers.
  - Extended `npm run check:architecture` to enforce the 300-line module limit for the migrated `src/renderer/src/application/render` layer now that renderer sync has been split by domain.
  - Extended `npm run check:architecture` to keep texture preview cache-key versioning centralized in `src/renderer/src/application/cache/RevisionedCacheKeys.ts`.
  - Added `src/renderer/src/application/cache/CacheDiagnostics.ts` and routed frontend texture decode and shared texture-preview cache hit/miss logging through it, keeping cache observability behind one application-layer entry point.
  - Extended `npm run check:architecture` to reject direct frontend `cache.hit`, `cache.miss`, and `cache.staleInvalidated` event strings outside `CacheDiagnostics.ts`.
  - Added `src/renderer/src/application/diagnostics/CommandDiagnostics.ts` and routed command received/accepted/rejected, stale-command, and document-revision diagnostics from texture/material, node editor, timeline, camera, main tool, and generic tool-window command handlers through it.
  - Extended `npm run check:architecture` to reject direct command diagnostic event strings outside `CommandDiagnostics.ts`.
  - Added `src/renderer/src/application/diagnostics/SnapshotDiagnostics.ts` and routed RPC snapshot sent/received/ignored-stale diagnostics from `src/renderer/src/hooks/useRpc.ts` through it while preserving legacy underscore event names.
  - Extended `npm run check:architecture` to reject direct snapshot diagnostic event strings outside `SnapshotDiagnostics.ts`.
  - Extended `npm run check:architecture` to reject direct renderer sync diagnostic event strings outside `src/renderer/src/application/render/RendererSyncDiagnostics.ts`.
  - Marked remaining direct document store setters for cameras, geosets, texture animations, and geoset animations as deprecated compatibility implementations that should only be called by application command handlers.
  - Added the "Current Implementation Patterns" section to document the expected command, preview projection, snapshot, and renderer observability paths for new work.
  - Added preview cleanup hooks in `src/renderer/src/application/window-bridge/ToolWindowLifecycleService.ts` so material-manager and node-editor preview overlays are cleared when their tool windows are closed, hidden, or destroyed outside the normal in-window cancel command.
  - Extended `npm run check:architecture` to reject obsolete preview-as-document helper names (`commitMaterialManagerPreviewToModel`, `mergeMaterialManagerPreview`, and `mergeNodeEditorPreview`) so preview commit/projection paths stay in application services.
  - Added `src/renderer/src/infrastructure/render/War3ModelRendererGateway.ts` and routed `src/renderer/src/components/viewer/ViewerImpl.tsx` through `createWar3ModelRenderer()` / `War3ModelRenderer`, removing the last direct `war3-model` import from renderer UI components and dropping the guardrail exception.
  - Added `addWar3GeosetBuffers()` to the render infrastructure gateway and routed geometry commands through it, so `DeleteFacesCommand`, `DeleteVerticesCommand`, `PasteVerticesCommand`, and `SplitVerticesCommand` no longer import `ModelResourceManager` directly.
  - Extended `npm run check:architecture` to include `src/renderer/src/commands` in direct `war3-model` and direct document-setter guardrails.
  - Routed remaining command-layer geoset document writes in `BindVerticesCommand`, `DeleteFacesCommand`, and `DeleteVerticesCommand` through `ModelDocumentCommandHandler.replaceGeosetList(..., { recordHistory: false })`, keeping command implementations on the application mutation path without creating nested history records.
  - Verified with `npm.cmd run check:architecture`.
  - Verified with `npm.cmd run typecheck`.
  - Added `src/renderer/src/infrastructure/texture/TexturePreviewSource.ts` as an infrastructure texture-preview source adapter for revision-aware preview loading, including MPQ/local path probing and BLP/PNG/TGA preview decode.
  - Routed `src/renderer/src/application/preview/TexturePreviewLoader.ts` through the new infrastructure adapter so the application preview layer no longer imports `components/viewer/textureLoader`.
  - Routed `src/renderer/src/infrastructure/texture/viewerTextureDecodeGateway.ts` through the same infrastructure texture-preview source adapter so model-save texture decoding no longer dynamically imports viewer component utilities.
  - Routed `src/renderer/src/services/particleEmitter2PresetService.ts` and `src/renderer/src/utils/dissolveEffect.ts` through `infrastructure/texture` helpers for texture path normalization, replaceable texture lookup, decode, and renderer refresh, removing the remaining shared-layer imports from `components/viewer/textureLoader`.
  - Routed particle-emitter preset texture collection writes through `TextureMaterialCommandHandler.setTextureCollection()` instead of hand-mutating `modelData.Textures` and tab snapshots.
  - Updated the `modelStore.addNode` compatibility implementation so node creation now advances `documentRevision`, updates the active tab snapshot with revision metadata, marks the tab dirty, and triggers renderer reload consistently.
  - Updated the `modelStore.updateNode` compatibility implementation so applied node edits now advance `documentRevision` and update the active tab snapshot with corrected node data and revision metadata.
  - Updated texture animation compatibility writes (`setTextureAnims`, `addTextureAnim`, `removeTextureAnim`, `updateTextureAnim`) so they advance `documentRevision` and refresh active tab snapshots with revision metadata.
  - Updated `updateGeoset` and geoset-animation compatibility writes (`updateGeosetAnim`, `setGeosetAnims`) so geoset/geoset-animation edits refresh active tab snapshots alongside document revision changes.
  - Added a shared `modelStore` node document mutation helper and routed node paste, move, move-with-children, rename, reparent, batch update, and replace-node compatibility paths through it so these node writes now share document revision, active-tab snapshot, dirty-tab, and renderer-reload behavior.
  - Updated `updateSequence` so sequence metadata edits now advance `documentRevision`, refresh active tab snapshots, mark the tab dirty, and trigger renderer reload like `setSequences`.
  - Routed node deletion plus model-wide edit tools (`transformModel`, `recalculateExtents`, `recalculateNormals`, `addDeathAnimation`, `removeLights`, and `repairModel`) through the same document mutation helper so these user-triggered edits also carry document revision and active-tab snapshot updates.
  - Generalized the node document mutation helper into a broader `createDocumentMutationPatch()` helper for store compatibility writes.
  - Routed sequence/global-sequence, camera, node, texture/material/geoset, texture animation, geoset animation, and visual-data compatibility setters through `createDocumentMutationPatch()` where practical, reducing duplicated revision/snapshot/dirty-tab update code in `modelStore`.
  - Updated `shiftSequenceDuration` to use the same document mutation helper so time-shifted sequence/keyframe edits carry document revision and active-tab snapshot metadata.
  - Removed the particle-emitter preset service's manual active-tab snapshot rewrite after node creation because `addNode` now owns that compatibility update.
  - Extended `npm run check:architecture` to reject `application` layer imports from renderer `components`, preventing the same layer inversion from returning.
  - Extended `npm run check:architecture` to reject shared-layer imports from `components/viewer/textureLoader`; shared texture logic now belongs in `infrastructure/texture`.
  - Moved the `standalonePerf` implementation into `src/renderer/src/application/diagnostics/StandalonePerf.ts` and changed application diagnostics, cache, preview, render, and window-bridge modules to import that application-layer entry directly.
  - Kept `src/renderer/src/utils/standalonePerf.ts` as a compatibility re-export for existing UI/store callers while avoiding application-to-utils diagnostic coupling.
  - Extended `npm run check:architecture` to reject future `application` layer imports from `utils/standalonePerf`.
  - Added `src/renderer/src/application/window-bridge/ToolWindowLayouts.ts` as the application-layer owner for tool-window and node-editor window sizes.
  - Changed `ToolWindowLifecycleService`, `ToolWindowOrchestrator`, `WindowManager`, standalone warmup, and node-editor open helpers to read window sizing from `ToolWindowLayouts`; `src/renderer/src/constants/windowLayouts.ts` now only re-exports the new owner for compatibility.
  - Extended `npm run check:architecture` to reject future `application` layer imports from `constants/windowLayouts`.
  - Moved node-editor window titles and combined title/size lookup from `src/renderer/src/types/nodeEditorRpc.ts` into `ToolWindowLayouts`, keeping RPC types focused on transport contracts instead of runtime window layout.
  - Updated `NodeEditorStandalone` and `nodeEditorOpen` to read node-editor titles and size from `ToolWindowLayouts`.
  - Extended `npm run check:architecture` to include `src/renderer/src/types` and reject node-editor window layout helpers in `nodeEditorRpc.ts`.
  - Removed the obsolete `src/renderer/src/constants/windowLayouts.ts` compatibility re-export after all callers had moved to `application/window-bridge/ToolWindowLayouts.ts`.
  - Extended `npm run check:architecture` to scan renderer source for any future imports of the removed `constants/windowLayouts` path.
  - Verified with `npm.cmd run check:architecture`.
  - Verified with `npm.cmd run typecheck`.

- Continued Phase 3 preview overlay separation:
  - Added `PreviewProjectionMode` and `getMaterialPreviewProjection` to `src/renderer/src/application/preview/PreviewProjectionService.ts` so material-preview projection kind is explicit instead of implied by callers.
  - Changed `src/renderer/src/application/window-bridge/ToolWindowSnapshots.ts` so texture/material tool-window snapshot builders consume already projected `modelData` and no longer merge `materialManagerPreview` internally.
  - Added `snapshotProjection` to `ToolWindowSnapshotEnvelope<TPayload>` and included it in texture/material snapshot cache diagnostics and broadcast dedupe.
  - Updated `src/renderer/src/components/MainLayout.tsx` to compute texture/material tool-window snapshot input through `PreviewProjectionService`, keeping preview projection selection in one application-layer read path.
  - Added `clearMaterialManagerPreview()` and `commitMaterialManagerPreview()` to `src/renderer/src/application/commands/TextureMaterialCommandHandler.ts` so preview clear/commit behavior is routed through the same application command entry as other texture/material writes.
  - Updated `src/renderer/src/application/window-bridge/ToolWindowCommandHandlers.ts` so standalone material-manager commit/cancel actions use the texture/material command handler instead of directly coordinating preview clears.
  - Replaced duplicated local texture/material manager RPC state definitions in `src/renderer/src/components/modals/TextureEditorModal.tsx` and `src/renderer/src/components/modals/MaterialEditorModal.tsx` with shared `application/window-bridge` types, and added explicit numeric guards for tool-window geoset `MaterialID` lookup paths.
  - Changed the deprecated compatibility setters in `src/renderer/src/store/modelStore.ts` so document writes clear `materialManagerPreview` instead of mutating preview state to mirror document changes; `setTextures`, `setMaterials`, `setGeosets`, and material/texture/geoset `setVisualDataPatch` writes now treat preview as invalidated state.
  - Updated the deprecated `commitMaterialManagerPreviewToModel` compatibility path so clearing preview also advances `previewRevision`.
  - Removed the obsolete `commitMaterialManagerPreviewToModel`, `mergeMaterialManagerPreview`, and `mergeNodeEditorPreview` compatibility exports from `src/renderer/src/store/modelStore.ts`; material preview commits now use `TextureMaterialCommandHandler`, and material/node preview projection uses `PreviewProjectionService`.
  - Started Phase 4 renderer sync extraction:
    - Added `src/renderer/src/application/render/RendererSyncService.ts` with typed sync plan/result/error reporting for the current material projection path.
    - Added `renderer.syncStarted`, `renderer.syncApplied`, and `renderer.syncFailed` diagnostics around renderer material projection sync attempts.
    - Routed the material/texture fast-reload effect in `src/renderer/src/components/viewer/ViewerImpl.tsx` through `RendererSyncService` instead of keeping the full projection/update logic inline.
    - Expanded `RendererSyncService` with `syncDocumentMaterials()` for the main document material/texture sync path and `syncGeosetMaterialBindings()` for geoset `MaterialID` cache refresh.
    - Replaced additional inline `ViewerImpl` material sync and geoset material-binding `syncMaterials()` logic with `RendererSyncService` calls, reducing duplicated renderer patch code in the large reload path.
    - Expanded `RendererSyncService` with `syncAnimationMetadata()` for `GeosetAnims`, `Sequences`, `GlobalSequences`, `PivotPoints`, and model extents metadata.
    - Routed both the large renderer reload path and the focused `GeosetAnims` watcher in `src/renderer/src/components/viewer/ViewerImpl.tsx` through `RendererSyncService` for animation metadata sync instead of keeping separate inline assignments and sync calls.
    - Expanded `RendererSyncService` with `syncGeosetBuffers()` for geoset vertex/group/skinning/normal/UV buffer sync plus related renderer geoset metadata such as `SelectionGroup` and extents.
    - Replaced the large inline geoset patch loop in `src/renderer/src/components/viewer/ViewerImpl.tsx` with `RendererSyncService.syncGeosetBuffers()`, reducing renderer-side geoset patch duplication in the main reload path.
    - Expanded `RendererSyncService` with `syncNodeProjection()` for lightweight node wrapper refresh and `syncNodeStructure()` for node-structure rebuilds that also refresh dependent renderer caches.
    - Routed the standalone node hot-patch effect, the structure-trigger effect, and the reload-path node sync branches in `src/renderer/src/components/viewer/ViewerImpl.tsx` through `RendererSyncService` instead of keeping separate inline `syncNodes()` paths.
    - Expanded `RendererSyncService` with `syncTextureState()` for texture array projection, WebGPU sampler alignment, wrap-parameter refresh, and `TextureAnims` projection.
    - Replaced the main reload-path inline texture state assignment in `src/renderer/src/components/viewer/ViewerImpl.tsx` with `RendererSyncService.syncTextureState()`, reducing direct renderer texture/sampler mutation in the viewer component.
    - Expanded `RendererSyncService` with `syncSceneMetadata()` for `ParticleEmitters2`, `RibbonEmitters`, `Lights`, `Bones`, `Helpers`, `Attachments`, `EventObjects`, `CollisionShapes`, and `Cameras`.
    - Replaced the inline scene-domain renderer assignments in `src/renderer/src/components/viewer/ViewerImpl.tsx` with `RendererSyncService.syncSceneMetadata()`, further shrinking the remaining direct renderer mutation block in the viewer reload path.
    - Split `RendererSyncService.ts` into `RendererSyncTypes.ts`, `RendererSyncDiagnostics.ts`, `RendererMaterialSync.ts`, `RendererAnimationSync.ts`, `RendererSceneSync.ts`, `RendererGeosetSync.ts`, `RendererNodeSync.ts`, and `RendererTextureSync.ts`, keeping the existing service methods as facade delegates and reducing `RendererSyncService.ts` from 705 lines to 67 lines.
    - Verified with `npm.cmd run check:architecture`.
    - Verified with `npm.cmd run typecheck`.
  - Started Phase 5 cache rework:
    - Added MPQ cache revision tracking in `src-tauri/src/mpq_manager.rs` so archive load order changes can participate in cache keys.
    - Changed Rust texture bytes/path-hit cache behavior in `src-tauri/src/main.rs` to fingerprint local file cache hits with `mtime`/`size`, invalidate stale path hits when the fingerprint changes, and include MPQ revisions in MPQ source keys.
    - Updated frontend decode cache keys in `src/renderer/src/components/viewer/textureDecodeCache.ts` to include a decoder-version token and alpha-mode token, and wired the call site in `textureLoader.ts`.
    - Tightened `src/renderer/src/components/modals/TextureEditorModal.tsx` preview cache keys so cached base previews are scoped by cache-key version, `documentId`, `assetRevision`, normalized image path, and texture-definition signature instead of a looser path-based identity.
    - Added aggregate cache diagnostics in `src/renderer/src/components/viewer/textureLoader.ts` and `src-tauri/src/main.rs` so texture batch reads now emit `cache.hit` / `cache.miss`, and backend stale fs-path invalidations emit `cache.staleInvalidated`.
    - Added `src/renderer/src/application/preview/TexturePreviewLoader.ts` as a shared revision-aware preview loader/cache for geoset dialogs, then routed `GeosetMergeDialog.tsx` and `GeosetSeparateDialog.tsx` through it to remove direct `war3-model` / Tauri file-loading preview logic from those UI components.
    - Updated `src/renderer/src/components/viewer/ViewerTextureUtils.ts`, `ViewerImpl.tsx`, and `TextureEditorModal.tsx` so standalone live texture preview source caching and `IPC_LIVE_TEXTURE_PREPARE` / `IPC_LIVE_TEXTURE_ADJUST` payloads now carry `assetRevision`, preventing same-path source replacements from reusing stale live-preview source image data.
    - Added `src/renderer/src/application/cache/RevisionedCacheKeys.ts` and routed both `TexturePreviewLoader.ts` and `TextureEditorModal.tsx` preview caches through `createTexturePreviewCacheKey()`, so preview cache identity is consistently scoped by cache-key version, document id, asset revision, normalized model path, normalized texture path, and optional texture-definition signature.
    - Added `src/renderer/src/application/cache/CacheRegistry.ts` with `RevisionedMemoryCache<T>` so frontend caches can keep namespace/key metadata, dependency tokens, timestamps, estimated bytes, and LRU bounds in one application-layer implementation.
    - Routed `src/renderer/src/application/preview/TexturePreviewLoader.ts` and `src/renderer/src/components/viewer/textureDecodeCache.ts` through `RevisionedMemoryCache`; texture preview entries now declare `assetRevision`/MPQ dependency tokens and decode entries declare decoder-version, source fingerprint, and decode-option dependency tokens.
    - Verified with `npm.cmd run check:architecture`.
    - Verified with `npm.cmd run typecheck`.
    - Added cumulative Rust texture cache counters in `src-tauri/src/main.rs` for bytes/path/RGBA cache hits and misses, stale fs-path invalidations, fs/MPQ resolves, not-found results, evictions, and manual clears.
    - Added the `get_texture_batch_cache_stats` Tauri command so developer tooling can query backend texture cache entry counts, byte totals, limits, and cumulative counters instead of relying only on per-request perf events.
    - Verified with `cargo fmt`.
    - Verified with `cargo check`.
    - Verified with `npm.cmd run check:architecture`.
    - Verified with `npm.cmd run typecheck`.
    - Added `src/renderer/src/application/cache/TextureBatchCacheStats.ts` as the frontend application-layer query wrapper for `get_texture_batch_cache_stats`, keeping the command string out of UI components.
    - Added a lightweight texture cache stats button and summary to `src/renderer/src/components/ViewSettingsWindow.tsx` so development builds can inspect backend texture cache counts, byte totals, hit/miss totals, stale invalidations, and evictions from the existing view settings debug area.
    - Verified with `npm.cmd run check:architecture`.
    - Verified with `npm.cmd run typecheck`.
    - Added `clearTextureBatchCache()` to `src/renderer/src/application/cache/TextureBatchCacheStats.ts` and routed `SaveCurrentModelWorkflow` cache clearing through it, centralizing backend texture cache command strings in the application cache layer.
    - Extended `npm run check:architecture` to reject direct frontend usage of `clear_texture_batch_cache` and `get_texture_batch_cache_stats` outside the application cache wrapper.
    - Verified with `npm.cmd run check:architecture`.
    - Verified with `npm.cmd run typecheck`.
  - Continued Phase 3 preview overlay separation:
    - Updated `src/renderer/src/application/window-bridge/ToolWindowCommandHandlers.ts` so rejected stale material-manager commands clear the material preview overlay through `PreviewOverlayService`, restoring document projection after failed base-revision checks.
    - Updated `src/renderer/src/application/commands/NodeEditorCommandHandler.ts` so rejected stale node-editor commands clear node preview overlays through `PreviewOverlayService`.
    - Verified with `npm.cmd run check:architecture`.
    - Verified with `npm.cmd run typecheck`.
    - Extended `npm run check:architecture` to reject direct frontend calls to `setMaterialManagerPreview`, `clearMaterialManagerPreview`, `setNodeEditorPreview`, `clearNodeEditorPreview`, and `bumpPreviewRevision` outside `modelStore` and `PreviewOverlayService`, keeping preview writes on the application preview path.
    - Updated `src/renderer/src/services/commitSavedModelService.ts` so save-commit cleanup increments `previewRevision` when it clears material or node preview overlays, and writes current `documentId`, `documentRevision`, `assetRevision`, and `previewRevision` into the active tab snapshot.
    - Extended `npm run check:architecture` to reject direct preview field writes outside `modelStore` compatibility code and the explicit save-commit cleanup path.
    - Added `src/renderer/src/application/preview/PreviewProjectionHooks.ts` with `useMaterialPreviewProjectedModelData`, `useEffectivePreviewProjectedModelData`, `getCurrentMaterialPreviewProjection`, and `getCurrentMaterialPreviewProjectedModelData`.
    - Updated `MainLayout`, `UVModeLayout`, `MaterialAnimPanel`, and `TimelinePanel` to consume preview-projected data through the new hooks/helpers instead of directly reading `materialManagerPreview` for component-level projection.
    - Extended `npm run check:architecture` to reject direct `previewProjectionService` / `getMaterialProjectedModelData` usage in `src/renderer/src/components`; renderer sync remains routed through the application render service.
    - Verified with `npm.cmd run check:architecture`.
    - Verified with `npm.cmd run typecheck`.
  - Completed Phase 5/6 final hardening:
    - Added `src/renderer/src/infrastructure/texture/TexturePreviewUrl.ts` with `createImageDataUrlFromBytes()` so fallback local image previews can be created from gateway-read bytes instead of direct `file://` image URLs.
    - Updated `UVEditor`, `TextureDetail`, and `TextureEditorModal` fallback preview loading to use byte-backed data URLs for standard local images.
    - Extended `npm run check:architecture` to reject new component preview image sources that assign local `file://` URLs.
    - Marked Phases 1-6 as completed for the current state/sync/cache redesign scope; remaining large-file decomposition is tracked as residual architectural debt rather than a blocker for this migration.
    - Verified with `npm.cmd run check:architecture`.
    - Verified with `npm.cmd run typecheck`.
    - Verified with `cargo check`.
    - Verified production frontend build with `npm.cmd run build`.
  - Verified with `npm.cmd run typecheck`.
  - Verified Rust changes with `cargo check`.

### 2026-04-26

- Created this redesign plan to define ownership and migration rules for document state, preview state, session state, projection state, RPC snapshots, renderer sync, and texture caches.
- Recorded that future state/sync/cache/preview-related changes must update this document.
- Added a `.gitignore` exception so this handoff document can be version controlled even though the repository ignores `*.md` by default.
- Started Phase 1 revision foundation:
  - Added active model `documentId`, `documentRevision`, `assetRevision`, and `previewRevision` fields in `src/renderer/src/store/modelStore.ts`.
  - Added optional revision fields to `TabSnapshot` in `src/renderer/src/types/store.ts`.
  - Bumped `documentRevision` for high-risk document writes such as textures, materials, visual data patches, texture animations, geoset updates, and geoset animation collection replacement.
  - Bumped `previewRevision` for material-manager and node-editor preview lifecycle updates.
  - Added revision metadata to texture/material manager RPC snapshot state in `src/renderer/src/application/window-bridge/ToolWindowSnapshots.ts`.
  - Updated texture/material manager snapshot broadcast dedupe to consider `snapshotVersion`, `documentRevision`, `assetRevision`, and `previewRevision`.
  - Verified with `npm run typecheck`.
- Continued Phase 2 command write path:
  - Added revision-aware texture/material tool-window command envelopes from `src/renderer/src/components/modals/TextureEditorModal.tsx` and `src/renderer/src/components/modals/MaterialEditorModal.tsx`.
  - Added stale command detection and rejection in `src/renderer/src/application/window-bridge/ToolWindowCommandHandlers.ts` for texture/material standalone window actions.
  - Repaired the texture/material modal files from a broken text-encoding state while preserving the revision command migration.
  - Verified with `npm.cmd run typecheck`.
- Added `src/renderer/src/application/commands/TextureMaterialCommandHandler.ts` as the first texture/material application-layer command service:
  - Routed texture standalone window collection writes through `CommandBus` with `recordHistory: false` to preserve existing live-sync behavior.
  - Routed texture/material combined collection writes and material-manager preview writes through the same service.
  - Split stale command handling so mismatched `documentId` is always rejected, while same-document revision mismatches can still be compatibility-applied for session-only commands.
  - Kept store setters as compatibility implementation details for now.
  - Verified with `npm.cmd run typecheck`.
- Added generic stale snapshot rejection in `src/renderer/src/hooks/useRpc.ts` for revisioned RPC states:
  - Ignores snapshots with an older `documentRevision` for the same `documentId`.
  - Ignores same-revision snapshots with older `snapshotRevision`/`snapshotVersion`.
  - Adds `documentId`, `documentRevision`, `snapshotRevision`, and `snapshotVersion` to revisioned snapshot sent/received/applied diagnostics.
  - Logs `snapshot.ignoredStale` diagnostics while preserving the older `snapshot_ignored_stale` event name.
  - Verified with `npm.cmd run typecheck`.
- Reduced direct document setter usage in texture/material modals:
  - Routed embedded `TextureEditorModal` texture and texture/material writes through `TextureMaterialCommandHandler`.
  - Routed embedded `MaterialEditorModal` texture/material/visual patch writes through `TextureMaterialCommandHandler`.
  - Confirmed those two modal files no longer directly call `setTextures`, `setMaterials`, or `setVisualDataPatch`.
  - Verified with `npm.cmd run typecheck`.
- Continued reducing direct texture/material setters:
  - Routed dissolve effect material/texture writes from `src/renderer/src/components/MainLayout.tsx` and `src/renderer/src/components/modals/DissolveEffectModal.tsx` through `TextureMaterialCommandHandler`.
  - Routed legacy `TextureEditor` and `MaterialEditor` apply paths through `TextureMaterialCommandHandler`.
  - Routed MPQ texture imports and material animation/timeline material restores through `TextureMaterialCommandHandler`.
  - Routed geoset merge material/texture creation through `TextureMaterialCommandHandler`; geoset collection writes remain in the geoset migration scope.
  - Routed viewer geometry separation material creation through `TextureMaterialCommandHandler`.
  - Confirmed frontend component/application search for direct `setTextures`, `setMaterials`, and `setVisualDataPatch` now only finds the command-service compatibility implementation.
  - Verified with `npm.cmd run typecheck`.
- Added initial command result reporting for texture/material command service:
  - `TextureMaterialCommandHandler` methods now return `TextureMaterialCommandResult` with accepted state, document id, previous/next document revision, previous/next preview revision, affected domains, and renderer plan.
  - Emits `command.accepted` and `document.revisionChanged` diagnostics from the application-layer command entry.
  - Emits `command.received` and `command.rejected` diagnostics for texture/material tool-window commands.
  - Emits dot-named `snapshot.sent`, `snapshot.received`, and `snapshot.ignoredStale` RPC diagnostics in addition to legacy underscore event names.
  - Marked `modelStore.setTextures`, `setMaterials`, and `setVisualDataPatch` as deprecated compatibility implementations.
  - Verified with `npm.cmd run typecheck`.
- Added formal texture/material snapshot envelope compatibility fields:
  - Added `ToolWindowSnapshotEnvelope<TPayload>` in `src/renderer/src/application/window-bridge/ToolWindowSnapshots.ts`.
  - Texture/material manager RPC states now carry `windowId`, `snapshotRevision`, and `payload` alongside legacy `snapshotVersion` and `snapshot`.
  - Texture/material snapshot broadcast dedupe now keys on `snapshotRevision`.
  - Verified with `npm.cmd run typecheck`.
- Continued Phase 1 asset revision coverage:
  - Added `modelStore.bumpAssetRevision(reason)` for external asset-source changes without marking the model dirty.
  - Bumped `assetRevision` after frontend MPQ load/preload/autoload success and after MPQ priority changes.
  - Invalidated active renderer projection when external asset sources change.
  - Included `assetRevision` in texture manager preview cache keys so same-path MPQ/source changes do not reuse stale previews.
  - Updated RPC large-payload detection and standalone texture/material managers to prefer `snapshotRevision`/`payload` while retaining `snapshotVersion`/`snapshot` compatibility.
  - Verified with `npm.cmd run typecheck`.
- Extended revisioned snapshot metadata to the node editor standalone window:
  - Added `documentId`, `documentRevision`, `assetRevision`, `previewRevision`, `snapshotRevision`, and `windowId` to `NodeEditorRpcState`.
  - Updated node editor broadcast dedupe to consider document/asset/preview revisions.
  - Standalone node editor now keys local memoization from `snapshotRevision` with `snapshotVersion` fallback.
  - Verified with `npm.cmd run typecheck`.
- Added revision-aware node editor standalone commands:
  - Standalone node editor now attaches `documentId`, `baseDocumentRevision`, and `stalePolicy` to node edit commands.
  - `NodeEditorCommandHandler` logs `command.received`, rejects stale apply/rename commands, and keeps preview/clear commands in warn-compatible mode for same-document stale revisions.
  - Verified with `npm.cmd run typecheck`.
- Extended revision metadata and stale command checks beyond texture/material/node:
  - Added revision metadata to sequence manager, global sequence manager, and global color adjust RPC states.
  - Added revision metadata to geoset editor, geoset visibility, geoset animation, texture animation, camera manager, model optimize, and dissolve-effect snapshots from `src/renderer/src/components/MainLayout.tsx`.
  - Standalone sequence and global-sequence save commands now include `documentId`, `baseDocumentRevision`, and reject stale document writes in `TimelineToolWindowHandlers`.
  - Standalone geoset editor, geoset visibility, geoset animation, and texture animation commands now include revision metadata and reject stale document writes in `ToolWindowCommandHandlers`.
  - Standalone camera manager commands now include revision metadata and reject stale camera add/update/delete writes in `CameraManagerCommandHandler`; embedded camera edits now route through `ModelDocumentCommandHandler.replaceCameraList`.
  - Standalone model optimize and dissolve-effect commands now include revision metadata and are checked before mutating model data in `MainLayout`.
  - Embedded global-sequence picker actions now send `documentId`, `baseDocumentRevision`, and `stalePolicy` when routed through the timeline tool command bridge.
  - Sequence and global-sequence model writes now increment `documentRevision` for both standalone command paths and embedded store actions.
  - Camera collection writes now increment `documentRevision` through the store compatibility setter and command handler path.
  - Added geoset, geoset-animation, and texture-animation collection replacement methods to `ModelDocumentCommandHandler`, with optional `recordHistory` control for snapshot replay paths.
  - Routed embedded camera, geoset editor, geoset visibility, geoset animation, texture animation manager, texture animation gizmo, and timeline keyframe snapshot writes through application command handlers.
  - Routed standalone geoset/visibility/texture-animation command handlers through `ModelDocumentCommandHandler` instead of calling store setters directly.
  - Confirmed direct document setter search now only finds application command services plus local React state setter false positives.
  - Added `modelStore.bumpPreviewRevision(reason)` and wired global color adjust setting changes to `previewRevision` so preview-only changes are observable without dirtying document state.
  - Verified with `npm.cmd run typecheck`.
- Started Phase 3 preview overlay separation:
  - Added `src/renderer/src/application/preview/PreviewOverlayService.ts` as a shared compatibility entry for material manager, node editor, and global color preview revision changes.
  - Routed material manager preview writes, node editor preview/clear writes, and global color preview revision bumps through the preview service.
  - Removed dirty marking from `modelStore.setMaterialManagerPreview` so live material preview changes no longer mark the active tab dirty.
  - Removed material manager and node editor preview merging from `getModelDataForSave`; previews are now excluded from save/export unless committed first.
  - Added explicit standalone material manager `COMMIT_MATERIALS` and `CLEAR_MATERIAL_PREVIEW` actions so save/cancel no longer rely on implicit save-time preview merging.
  - Added `PreviewProjectionService` for read-side preview projection and routed MainLayout, Viewer material reload, UV mode, material animation panel, and timeline effective-model reads through it.
  - Marked old `modelStore` preview merge helpers as deprecated compatibility exports.
  - Verified with `npm.cmd run typecheck`.
