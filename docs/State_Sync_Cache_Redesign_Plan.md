# State, Sync, Preview, and Cache Redesign Plan

Last updated: 2026-04-26

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

```ts
export interface CacheDependencyToken {
  kind: 'documentRevision' | 'assetRevision' | 'fileFingerprint' | 'mpqRevision' | 'decoderVersion'
  value: string | number
}

export interface CacheEntryMeta {
  namespace: string
  key: string
  dependsOn: CacheDependencyToken[]
  createdAt: number
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

Status: in progress

Tasks:

- Add `documentId` and `documentRevision` to active model state. Done for the active model store and tab snapshots.
- Add `assetRevision` for MPQ/archive/file source changes. Started for active model disk path replacement; MPQ/archive revision is still pending.
- Add `previewRevision`. Started for material manager preview and node editor preview.
- Wrap tool-window snapshots in revision envelopes. Partially done by adding revision fields to texture/material manager RPC states; a formal envelope type is still pending.
- Log stale snapshot detection.

Acceptance:

- Existing UI behavior remains unchanged.
- Texture/material tool-window snapshots carry document and preview revision metadata.
- Every command/snapshot log includes document revision. Pending.

### Phase 2: Command Write Path

Status: pending

Tasks:

- Add typed document commands for textures and materials.
- Route texture manager writes through CommandBus.
- Route material manager writes through CommandBus.
- Keep old store setters as temporary compatibility shims.
- Reject stale tool-window writes.

Acceptance:

- Texture/material edits cannot be applied from stale snapshots.
- Direct `setTextures` usage is reduced to command handlers or compatibility code.

### Phase 3: Preview Overlay Separation

Status: pending

Tasks:

- Replace `materialManagerPreview` document-like behavior with preview overlays.
- Move node live preview into shared preview service.
- Ensure preview overlays are excluded from save/export.
- Add preview cleanup on close, cancel, active model switch, and failed commit.

Acceptance:

- Live preview is visible but does not dirty/save until committed, unless explicitly intended.
- Cancelling preview restores renderer to document projection.

### Phase 4: Renderer Sync Extraction

Status: pending

Tasks:

- Create `RendererSyncService`.
- Move texture/material/geoset/node sync logic out of `ViewerImpl`.
- Add typed renderer plans and result reporting.
- Keep full reload fallback.

Acceptance:

- Renderer applies known domain patches without broad reload.
- Failed patch paths report a clear fallback reason.

### Phase 5: Cache Rework

Status: pending

Tasks:

- Add file fingerprint keys to Rust bytes cache.
- Add MPQ archive revision keys.
- Add cache diagnostics.
- Audit frontend decode and preview cache keys.
- Remove path-only cache keys for mutable local files.

Acceptance:

- Replacing a texture file at the same path changes preview and renderer output without manual cache clear.
- Cache hit/miss logs identify stale invalidations.

### Phase 6: Cleanup and Guardrails

Status: pending

Tasks:

- Remove obsolete preview-as-document code.
- Make direct document setters private or clearly marked deprecated.
- Add lint/search checklist for forbidden patterns.
- Document command and preview patterns for future features.

Acceptance:

- New feature work has one obvious mutation path.
- State ownership can be understood from this document and code structure.

## Current High-Risk Files

These files currently contain overlapping state, sync, or cache responsibilities:

- `src/renderer/src/store/modelStore.ts`
- `src/renderer/src/hooks/useRpc.ts`
- `src/renderer/src/application/window-bridge/ToolWindowSnapshots.ts`
- `src/renderer/src/application/window-bridge/ToolWindowCommandHandlers.ts`
- `src/renderer/src/components/viewer/ViewerImpl.tsx`
- `src/renderer/src/components/viewer/textureLoader.ts`
- `src/renderer/src/components/modals/TextureEditorModal.tsx`
- `src/renderer/src/components/modals/MaterialEditorModal.tsx`
- `src-tauri/src/main.rs`

## Immediate Guardrails

Until the migration is complete:

- Do not add new direct calls from UI components to `setTextures`, `setMaterials`, or `setVisualDataPatch`.
- Do not add new snapshot payloads that can be written back wholesale.
- Do not add preview data to active tab snapshots.
- Do not use path-only cache keys for mutable local resources.
- Do not add renderer mutations that lack a documented invalidation or sync plan.
- When fixing a bug in these areas, update this document's change log.

## Change Log

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
