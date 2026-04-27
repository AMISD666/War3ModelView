# State Sync and Commit Integrity Repair Plan

Last updated: 2026-04-27

This document tracks the focused repair pass for bugs where edits appear in one surface but are not correctly reflected in renderer preview, document commit, undo/redo, save/export, or dependent indexed references. It complements `docs/State_Sync_Cache_Redesign_Plan.md`; that redesign established the broad architecture, while this document is the execution plan for closing the remaining domain-specific gaps.

## Goal

Make every model edit follow one consistent contract:

1. A UI or tool window sends an explicit command with the correct stale policy.
2. The command updates all affected document domains atomically.
3. Indexed references are remapped whenever a referenced collection is deleted, inserted, reordered, split, or merged.
4. Preview updates are visible in the renderer but do not become durable until committed.
5. Commit, undo, redo, save, export, tab snapshots, detached windows, and renderer projection all observe the same final state.

## Recent Failures That Defined This Pass

### Geoset Delete Broke GeosetAnims

Symptom:

- Deleting geoset id 2 caused the former geoset id 8 alpha animation to collapse from a full alpha track to default `0: 1`.

Root cause:

- The geoset visibility panel deleted from `Geosets` only.
- `GeosetAnims[].GeosetId` references the geoset array index, so later geosets shifted but their animation references did not.

Current fix:

- `GeosetVisibilityPanel` delete/merge now updates `Geosets` and remapped `GeosetAnims` in one command through `ModelDocumentCommandHandler.replaceGeosetListAndAnimations`.

### Material Layer Delete Preview Was Rejected

Symptom:

- Deleting the first layer of a two-layer material did not update renderer output.
- Toggling the remaining layer `TVertexAnimId` to none and back forced the renderer to become correct.
- Console showed stale material/texture tool-window commands.

Root cause:

- Standalone material window realtime `SAVE_MATERIALS` was using strict stale rejection like a durable commit.
- `syncStandaloneMaterials()` also captured an older command emitter, so after document revision advanced it could keep sending an old `baseDocumentRevision`.

Current fix:

- Realtime material preview `SAVE_MATERIALS` now warn-applies for same-document stale revisions.
- Durable `COMMIT_MATERIALS` remains strict stale-reject.
- `syncStandaloneMaterials()` now depends on the latest revisioned `emitMaterialAction`.

## Core Rules

### 1. Preview Commands Are Not Commit Commands

Commands that only update preview projection should use same-document stale compatibility:

- `SAVE_MATERIALS` from the material manager realtime preview path.
- Texture adjustment preview flushes.
- Node editor live preview.
- Other non-durable view-only patches.

Commands that make durable document state must reject stale revisions:

- `COMMIT_MATERIALS`.
- Texture collection commits after deletion/import/OK.
- Geoset, sequence, camera, node, texture animation, and model optimization writes.
- Save/export-affecting actions.

If one action name currently serves both preview and commit semantics, split it or add explicit metadata before changing behavior.

### 2. Collection Structural Changes Must Update All References

Any command that removes, inserts, reorders, splits, merges, or deduplicates a collection must update every domain that stores indexes into that collection.

Reference map:

| Changed collection | References that must be updated |
| --- | --- |
| `Geosets` | `GeosetAnims[].GeosetId`, hidden/selected geoset ids, geoset UI session state, renderer geoset buffers |
| `Materials` | `Geosets[].MaterialID`, `RibbonEmitters[].MaterialID`, selected material/layer session state, material manager snapshots |
| `Materials[].Layers` | selected material layer index, material-layer timeline owner ids, renderer material layer caches |
| `Textures` | material layer texture fields, particle/ribbon texture ids, selected texture id, texture preview caches, GPU texture state |
| `TextureAnims` | material layer `TVertexAnimId` and aliases, selected texture animation id, texture animation timeline tracks |
| `Nodes` | parent ids, object id references in cameras/attachments/emitters, selected node ids, renderer node wrappers |
| `Sequences` | current sequence index, timeline keyframes by interval, sequence extents, animation manager snapshots |
| `GlobalSequences` | all `GlobalSeqId` fields across node/geoset/material/texture animation tracks |

The owner command must either remap these references or explicitly document why no remap is needed.

### 3. Multi-Domain Writes Must Be Atomic

Do not issue separate history commands for logically one edit. For example, a geoset delete that also changes `GeosetAnims` must be one undoable command, not `replaceGeosetList()` followed by `replaceGeosetAnimationList()`.

Atomic command requirements:

- Capture all before snapshots together.
- Apply all after snapshots together.
- Undo all domains together.
- Redo all domains together.
- Trigger renderer sync/reload after all domains are in their final state.

### 4. Renderer Projection Must Rebuild Affected Caches

Renderer sync must be explicit about the affected cache:

- Material/layer edits must call `syncMaterials()` and refresh ribbon material caches when needed.
- Texture array edits must sync texture state before materials that reference the new texture ids.
- Geoset structure edits must refresh buffers and material bindings.
- Animation metadata edits must call the relevant animation sync (`syncGeosetAnims`, texture animation metadata sync, sequence/global sequence sync).
- If a lightweight path cannot prove correctness, use a full reload and record why.

### 5. Save/Export Must Use Document State Only

Preview overlays must not leak into save/export unless explicitly committed first.

Before save/export:

- Clear or commit active preview overlays explicitly.
- Validate indexed references against current document arrays.
- Reject or repair out-of-range indexes with a visible diagnostic.

## Current High-Risk Paths

### Command Paths Still Using Direct Store SetState

These must be migrated to application command handlers or a shared atomic model-data replacement command:

- `src/renderer/src/commands/SplitVerticesCommand.ts`
- `src/renderer/src/commands/AutoSeparateLayersCommand.ts`
- `src/renderer/src/commands/GlobalTransformCommand.ts`
- `src/renderer/src/commands/MirrorModelCommand.ts`

Risk:

- They can bypass revision metadata, active tab snapshot refresh, dirty state, material preview cleanup, renderer sync planning, or future guardrails.

### Commands That Split One Logical Edit Into Multiple Document Writes

Audit and collapse where needed:

- `DeleteFacesCommand`
- `DeleteVerticesCommand`
- Timeline keyframe snapshot writes touching multiple domains
- Any material/texture/geoset path that separately updates collection and dependent references

Risk:

- Undo/redo can restore only half the edit.
- Renderer may observe an intermediate state.

### Tool-Window Actions With Ambiguous Semantics

Audit every standalone action name:

- `SAVE_MATERIALS`
- `SAVE_TEXTURES`
- `SAVE_TEXTURES_WITH_MATERIALS`
- preview clear/cancel actions
- manager selection patch actions

Risk:

- A realtime preview action can be rejected as stale.
- A durable commit can be compatibility-applied when it should be rejected.

## Repair Phases

### Phase A: Guardrails and Inventory

Status: in progress

Tasks:

- Add guardrail checks for bypassing revisioned material actions. Done for `MaterialEditorModal`.
- Add guardrail checks for new direct `useModelStore.setState` document writes in command files. Done with no legacy allowlist remaining for `src/renderer/src/commands`.
- Add a domain-reference inventory file or test fixture describing required remaps.
- Search and tag all tool-window actions as `preview`, `commit`, or `session`.

Acceptance:

- `npm run check:architecture` fails for new direct command-layer document state writes.
- Every standalone tool-window action has an explicit stale policy rationale.

### Phase B: Atomic Command Services

Status: in progress

Tasks:

- Add `replaceModelDataAtomic()` or equivalent to `ModelDocumentCommandHandler` for commands that legitimately replace several model domains at once. Started with `replaceDocumentSnapshot()`.
- Replace direct store writes in `SplitVerticesCommand`, `AutoSeparateLayersCommand`, `GlobalTransformCommand`, and `MirrorModelCommand`. Done.
- Collapse multi-domain geoset/animation updates into one command where still split.
- Ensure commands update active tab snapshots and dirty state through the same mutation helper.

Acceptance:

- No geometry command writes document state through `useModelStore.setState`.
- Undo/redo of split, auto-separate, global transform, and mirror restores document, nodes, renderer trigger, and selection/session side effects coherently.

### Phase C: Reference Integrity Validators

Status: in progress

Tasks:

- Add a document integrity validator for indexed references. Started with `DocumentReferenceValidator`.
- Run it after high-risk commands in development builds. Done for application-layer `CommandBus` execute/undo/redo paths; preview-only commands can opt out with `validateDocumentReferences: false`.
- Run it before save/export and report actionable diagnostics. Done for the save/prepare path.
- Add repair helpers for common safe cases:
  - Remove invalid `GeosetAnims` whose `GeosetId` no longer exists. Done in `DocumentReferenceRepairer`.
  - Clamp or clear invalid material layer `TVertexAnimId`. Done in `DocumentReferenceRepairer`.
  - Clamp or clear invalid texture references. Done for material layer and particle emitter texture references in `DocumentReferenceRepairer`.
  - Remap material ids after material removal/dedupe. Done for material delete paths by remapping `Geosets[].MaterialID` and `RibbonEmitters[].MaterialID` through shared helpers; material dedupe-specific old-to-new remap remains pending if a future dedupe command is added.

Acceptance:

- Invalid references are detected before they reach renderer or save.
- Validator reports domain, path, invalid value, and suggested fix.

### Phase D: Renderer Sync Hardening

Status: in progress

Tasks:

- Add material-layer-count change detection to renderer sync diagnostics. Done with `renderer.materialTopologyChanged` diagnostics from `RendererMaterialSync`.
- Force material cache rebuild for material layer add/delete/reorder. Done by always running `modelInstance.syncMaterials()` after material projection sync, resetting ribbon emitters on material topology changes, and validating renderer material-layer cache shape after sync.
- Verify texture animation ids in material layers trigger animation/material sync. Done by syncing `TextureAnims` through animation metadata sync and bumping `materialReloadTrigger` from texture-animation compatibility setters so `TVertexAnimId`-dependent material projection refreshes reliably.
- Add a fallback full reload when renderer material caches remain inconsistent after sync. Done by returning `fullReload` from material sync on cache shape mismatch and having `ViewerImpl` trigger `rendererReloadTrigger`.

Acceptance:

- Deleting, adding, and reordering material layers immediately changes renderer output.
- Changing `TVertexAnimId` is not required to force a correct render after layer deletion.

### Phase E: Focused Regression Fixtures

Status: in progress

Create small scripted or unit-level checks for:

- Delete geoset before another geoset with alpha track: `GeosetAnims[].GeosetId` remaps and alpha track survives. Started in `scripts/check-state-sync-fixtures.mjs`.
- Delete material layer 0 from a two-layer material with `TVertexAnimId` on both layers: renderer projection and document state contain one layer and correct `TVertexAnimId`. Started in `scripts/check-state-sync-fixtures.mjs` with topology/cache-shape assertions.
- Delete texture id used by material layers and particle emitters: all references remap or clear. Done in `scripts/check-state-sync-fixtures.mjs`; texture delete paths now remap material layer texture ids and `ParticleEmitters`/`ParticleEmitters2` texture ids.
- Delete texture animation id used by material layers: `TVertexAnimId` remaps or clears. Done in `scripts/check-state-sync-fixtures.mjs`; texture animation delete command already remaps materials with `remapMaterialsAfterTextureAnimRemoval`.
- Undo/redo each operation restores all affected domains. Done in `scripts/check-state-sync-fixtures.mjs` with an explicit history harness for atomic multi-domain command snapshots covering geoset/geoset animation, texture/material/particle emitter, texture animation/material, and material-layer collection changes.

Acceptance:

- Each fixture can be run from repository root. Started with `npm.cmd run check:state-sync-fixtures`.
- A failing fixture points to the affected command/service, not only to visual output.

## First Implementation Checklist

1. Keep the fixes already applied:
   - Geoset delete/merge atomic `Geosets + GeosetAnims`.
   - Material realtime preview warn-compatible stale policy.
2. Add architecture guardrail for material manager action emission. Done.
3. Migrate direct command-layer `useModelStore.setState` writes to command services. Done for the audited command files.
4. Add reference integrity validator and wire it to development command paths. Done for save/export preflight and application-layer command execute/undo/redo paths.
5. Add regression fixtures for geoset delete and material layer delete.

## Change Log

### 2026-04-27

- Wired `DocumentReferenceValidator` into development application command execution through `CommandBus`, so execute/undo/redo paths now emit `command.integrityFailed` diagnostics and console warnings when a document command leaves invalid indexed references.
- Added `validateDocumentReferences` command option for explicit opt-out. Material manager preview set/clear commands use the opt-out because they update preview projection only and do not mutate durable document state.
- Added `DocumentReferenceRepairer` and wired it into `SaveModelUseCase.prepareModelForSave`, so save/export preparation repairs common safe indexed-reference issues before final validation. Covered cases include invalid/duplicate `GeosetAnims`, invalid material layer `TVertexAnimId` aliases and bounds, invalid material layer texture references, particle emitter texture references, and out-of-range geoset/ribbon material ids.
- Added precise material-delete remap helpers in `materialTextureRelations`, then routed `MaterialEditorModal` material deletion through them so `Geosets[].MaterialID` and `RibbonEmitters[].MaterialID` are updated atomically with the material collection. Standalone material manager snapshots and preview payloads now carry `RibbonEmitters` so detached material deletes keep ribbon material references in sync too.
- Hardened renderer material sync for material layer topology changes. `RendererMaterialSync` now records `renderer.materialTopologyChanged`, resets ribbon emitters when material layer topology changes, validates the `rendererData.materialLayerTextureID` shape after `syncMaterials()`, and requests a full renderer reload from `ViewerImpl` if the cache shape remains inconsistent.
- Completed Phase D texture-animation/material sync hardening: `RendererAnimationSync` now applies `TextureAnims` metadata, texture-animation setters bump `materialReloadTrigger`, and `renderer.textureAnimationMetadataSynced` diagnostics identify texture animation metadata refreshes.
- Started Phase E with `scripts/check-state-sync-fixtures.mjs` and `npm.cmd run check:state-sync-fixtures`, covering geoset delete alpha-track remap and material-layer delete topology/cache-shape regression checks.
- Extended Phase E fixtures to cover texture deletion and texture-animation deletion. Texture deletion now remaps material layer texture ids plus `ParticleEmitters`/`ParticleEmitters2` texture ids through shared helpers and the texture manager command path; texture-animation deletion fixture verifies `TVertexAnimId` clear/decrement behavior.
- Extended Phase E with an undo/redo regression harness. The fixture now verifies atomic execute/undo/redo restoration for `Geosets + GeosetAnims`, `Textures + Materials + ParticleEmitters + ParticleEmitters2`, `TextureAnims + Materials`, and material-layer collection updates, so a future split-domain command regression fails at the affected command/service name.
- Verification passed:
  - `npm.cmd run check:architecture`
  - `npm.cmd run typecheck`
  - `npm.cmd run check:state-sync-fixtures`

## Verification Commands

Run after every phase:

```text
npm.cmd run check:architecture
npm.cmd run typecheck
npm.cmd run check:state-sync-fixtures
```

Run when Rust or Tauri commands are touched:

```text
cargo check
```
