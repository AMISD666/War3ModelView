# Standalone Tool Window Light Client Plan

Last updated: 2026-05-07

## Background

Standalone tool windows currently run in separate Tauri webviews and synchronize with the main window through the shared `application/window-bridge` infrastructure. That infrastructure is useful and should stay, but several windows still behave as editable snapshot owners: the main window sends a large business snapshot, the standalone window edits a local copy, then sends a broad result back to the main window.

That pattern causes the failure class seen in repeated standalone-window bugs:

- Large payloads must be built, encoded, transported, decoded, and reconciled in React state.
- Local copies can drift from the authoritative `DocumentState` while the main window revision advances.
- Same-document stale commands can be compatibility-applied and overwrite newer data.
- Snapshot broadcasts can interrupt local draft UI state after a selection or sequence switch.
- Fixes that only tune `stalePolicy` or snapshot timing address symptoms, not ownership.

The medium-term target is to keep standalone windows as detachable UI shells while moving document writes and authoritative reads back to the main window/application layer.

## Goals

- Make standalone tool windows light clients.
- Keep the main window/application command layer authoritative for `DocumentState`.
- Keep local standalone state limited to UI draft, interaction/session state, and pending command status.
- Replace broad editable snapshots with small view models, invalidation signals, and on-demand queries where practical.
- Make document-write commands explicit, typed, revision-aware, and acknowledged by the main window.
- Preserve the existing Tauri window stack and shared bridge services.
- Start migration with the Dissolve Effect tool because it is already close to main-window execution and is the active bug source.

## Non-Goals

- Do not replace Tauri webview windows with Electron, browser popouts, or a new window framework.
- Do not rewrite all standalone tools in one pass.
- Do not remove `WindowRpcTransport` or large-payload support immediately; it remains a compatibility path during migration.
- Do not make preview state part of save/export unless an explicit commit command writes it into document state.
- Do not add component-level ad-hoc RPC or direct platform API access.

## Current Risks

- `materialManager`, `textureManager`, and `nodeEditor` still carry the largest snapshot and local-copy risks.
- Some older payloads still send full arrays such as `Materials`, `Textures`, `Sequences`, or full document subtrees.
- `snapshotRevision`, `documentRevision`, and preview revisions are not yet a complete semantic protocol for all windows.
- Same-document stale writes using `stalePolicy: 'warn'` are still risky for durable commits.
- JSON/string deep comparison in UI components is a sign that the window is protecting itself from whole-snapshot echo rather than receiving precise state.
- The documented `check:architecture` guard may be missing in some checkouts; this plan adds a focused guard for standalone light-client migration.

## Target Architecture

The target shape is:

1. Main window builds a small view model for the standalone tool's visible UI.
2. Standalone window owns only draft/session state needed for current controls.
3. Standalone window sends a small command intent with `requestId`, `documentId`, `baseDocumentRevision`, `stalePolicy`, and a typed payload.
4. Main window validates the envelope against current document identity and revision.
5. Main window derives authoritative data from current `useModelStore.getState()`, not from the standalone payload.
6. Main window executes through application command handlers or command services.
7. Main window emits a command result event with success/failure and the next revision.
8. Broadcasts after commit should be invalidation or a small refreshed view model, not a full editable snapshot unless that window is not migrated yet.

Recommended write command envelope:

```ts
type ToolWindowWriteCommand<TPayload> = {
    requestId: string
    windowId: string
    documentId: string | null
    baseDocumentRevision: number
    stalePolicy: 'reject' | 'warn'
    command: string
    payload: TPayload
}
```

Durable document commits should default to `stalePolicy: 'reject'`. Preview or selection updates may use warn-compatible behavior if they do not persist document state.

## Ownership Boundaries

Main window/application layer owns:

- `DocumentState`, model data, model path, dirty state, active tab state, save/export snapshots.
- Renderer refresh and texture byte reload after document or asset changes.
- Mutation logic through `CommandBus`, `ModelDocumentCommandHandler`, `TextureMaterialCommandHandler`, or equivalent application command services.
- Authoritative validation and normalization of command payloads.
- Stale-command acceptance/rejection and command result reporting.

Standalone tool windows own:

- Local UI draft state, current selection in the tool, drag position, form focus, and pending command state.
- Minimal view-model consumption such as geoset summaries or sequence names.
- UI-level validation for immediate feedback.
- Command intent emission through the shared RPC client.

Standalone tool windows must not own:

- Editable full `ModelData`.
- Full authoritative `Materials`, `Textures`, `Sequences`, `Geosets`, node arrays, or particle collections.
- Save/export projection decisions.
- Renderer instances or renderer model objects.
- Direct document-root writes through store setters.
- Raw Tauri/window/plugin access outside infrastructure gateways.

## Migration Plan

### Phase 1: Dissolve Effect as the First Migration

- Keep the current stripped dissolve view model: document revisions, geoset summaries, and sequence summaries.
- Change execute payload to send only selected geosets, dissolve texture path, typed points, save mode, and command envelope fields.
- Main window maps point types to alpha values:
  - `visible` => `1`
  - `start` => `0.75`
  - `end` => `0`
- Main window derives start/end frames from typed points and revalidates the request.
- Main window reads current `modelData` and `modelPath` immediately before execution.
- Main window commits returned material/texture collections through `TextureMaterialCommandHandler`.
- Main window refreshes renderer textures and emits a result event.
- Embedded and standalone dissolve execution should converge on the same main-window command handler.

### Phase 2: Small Tool Windows

Migrate windows with small state first:

- Global color adjust
- Camera manager
- Global sequence manager
- Model optimize

These should use small settings or item-level command payloads and strict result acknowledgements.

### Phase 3: Medium Collection Editors

Migrate collection editors from full-array replacement toward item-level or operation-level commands:

- Sequence editor
- Geoset editor
- Geoset visibility
- Geoset animation
- Texture animation

Each command should derive against latest main-window state. Full collection replacement should be retained only as a compatibility adapter or explicit snapshot-replace command.

### Phase 4: Heavy Editors

Migrate the highest-risk windows last and in smaller slices:

- Material manager
- Texture manager
- Node editor

Targets:

- List view models use summaries only.
- Detail panes query one selected item.
- Preview commands update preview services, not document state.
- Commit commands derive and write through application command handlers.
- Large snapshots become bootstrap-only compatibility payloads, then are removed.

## Per-Window Migration Matrix

| Window | Current entry | Writes document? | Target light-client state | Main authority | Snapshot target | Regression check |
| --- | --- | --- | --- | --- | --- | --- |
| Dissolve effect | `DissolveEffectModal` | Yes | selected geosets, texture path, typed points, save mode, pending request | `MainLayout` dissolve handler, then command service | geoset/sequence summaries only | alpha key guard, light-client guard, typecheck |
| Global color adjust | `GlobalColorAdjustModal` | Preview and optional texture/material writes | settings, save mode, suffix | global color command path | settings view model | no full model snapshot during setting changes |
| Camera manager | `CameraManagerModal` | Yes | selected camera draft | `CameraManagerCommandHandler` | camera summaries/detail | stale writes reject |
| Global sequence manager | `GlobalSequenceModal` | Yes | sequence duration/name draft | timeline command handlers | sequence summaries | strict save command envelope |
| Sequence editor | `SequenceEditorModal` | Yes | selected sequence draft and delete interval | timeline command handlers | sequence summaries/detail | no full stale sequence overwrite |
| Geoset editor | `GeosetEditorModal` | Yes | selected geoset operation draft | `ToolWindowCommandHandlers` / model document commands | geoset summaries/detail | geoset count and references stay synchronized |
| Geoset visibility | `GeosetVisibilityToolModal` | Yes | visibility operation draft | model document commands | geoset visibility summaries | delete/merge remap survives reopen |
| Geoset animation | `GeosetAnimationModal` | Yes | selected geoset anim draft | model document commands | geoset anim summaries/detail | stale writes reject |
| Texture animation | `TextureAnimationManagerModal` | Yes | selected texture anim draft | model document commands | texture anim summaries/detail | material `TVertexAnimId` remap checks |
| Texture manager | `TextureEditorModal` | Yes | selected texture draft and import state | `TextureMaterialCommandHandler` | texture summaries, selected detail | no full texture/material stale overwrite |
| Material manager | `MaterialEditorModal` | Preview and commit | selected material/layer draft | preview service plus `TextureMaterialCommandHandler` | material summaries, selected detail | preview excluded from save until commit |
| Node editor | `NodeEditorStandalone` | Preview and commit | selected node draft | `NodeEditorCommandHandler` | node summary/detail | apply/rename strict stale checks |
| Model optimize | `ModelOptimizeModal` | Yes | options and pending request | main tool command handler | options/status only | result ack and strict stale check |
| Model merge | `ModelMergeModal` | Yes | merge options and file selections | import/merge application use case | status/options only | no direct document root write |
| FBX batch merge | `FbxBatchMergeModal` | Yes | selected files/options/pending request | FBX merge use case | status/options only | result ack |

## Regression Guards

Focused guard command:

```powershell
npm.cmd run check:standalone-light-client
```

Tracking requirement:

- The package script must reference a tracked guard script. `scripts/check-standalone-light-client.mjs` is explicitly unignored in `.gitignore` so the guard cannot exist only as a local ignored helper while `package.json` points at it.

The guard should protect these invariants:

- `standalone.html` loads `standalone-main.tsx`, not the main app entry.
- `ToolWindowSnapshotEnvelope` keeps revision and payload fields.
- Standalone detached components do not import raw Tauri APIs or plugins.
- `StandaloneToolWindowRouter` remains a router/shell and does not import document stores or renderer/model libraries directly.
- Dissolve command payloads include `documentId`, `baseDocumentRevision`, and `stalePolicy`.
- Main dissolve execution remains behind `useRpcServer('dissolveEffect', ...)` and stale revision checks.
- `.gitignore` keeps the standalone light-client guard and this plan document trackable even though broad `scripts/*` and `docs/*` local-ignore rules remain in place.

Verification for window communication or shared state changes:

```powershell
npm.cmd run typecheck
npm.cmd run check:dissolve-effect-alpha
npm.cmd run check:standalone-light-client
git check-ignore -v scripts/check-standalone-light-client.mjs
git check-ignore -v docs/Standalone_Tool_Window_Light_Client_Plan.md
```

The two `git check-ignore` commands should report no ignored-path match.

## Acceptance Checklist

- Open a model and open the Dissolve Effect tool as a standalone window.
- Switch action sequences multiple times.
- Select geosets and a dissolve texture.
- Execute without closing the standalone window.
- Execute again after sequence changes without stale-command rejection caused by the previous execute.
- Confirm the main viewer refreshes modified textures immediately.
- Confirm generated alpha keys include frame `0 => 1`, dissolve start `0.75`, and dissolve end `0`.
- Confirm result feedback returns to the standalone window.
- Save/reopen and verify material/texture changes persist.
- Confirm no new raw Tauri imports or document-root store writes were added to standalone UI components.

## Rollback Strategy

- Keep existing `WindowManager`, `ToolWindowLifecycleService`, `WindowRpcTransport`, and `useRpcServer/useRpcClient` infrastructure during migration.
- For each window, keep compatibility snapshot builders until the replacement view model and command path are verified.
- Roll back by restoring the previous window command adapter for the affected tool only; do not roll back shared bridge infrastructure.
- If a strict stale rejection blocks a legitimate workflow, add a main-window query or fresh lightweight sync instead of returning to broad warn-compatible overwrites.

## Change Log

### 2026-05-07

Current end-of-pass state:

- Node Editor standalone snapshots now keep legacy full `textures`, `materials`, `globalSequences`, `sequences`, `allNodes`, and `pivotPoints` empty. The selected node payload remains the intentional selected-detail bootstrap, and Particle Emitter 2 texture data is resolved through summaries plus selected texture detail over the shared `rpc-req-nodeEditor` bridge.
- Texture Manager standalone snapshots now keep legacy full `textures` and `materials` empty. Path/replaceable/flag edits, deletion, and add/import are operation-level commands; full `SAVE_TEXTURES` remains only as the explicit texture pixel adjustment / final save compatibility boundary.
- Material Manager standalone preview for selected material fields, selected layer fields, layer add/delete/move, and material add/delete is operation-level. Durable `COMMIT_MATERIALS` rejects stale writes; full material/texture collection payloads remain as the conservative editing draft and commit compatibility boundary.

- Created this plan as the standalone tool-window light-client execution plan.
- Selected Dissolve Effect as the first migration target because it already uses stripped geoset/sequence snapshots and main-window execution, but still sent derived execution data and kept a separate embedded direct-execution path.
- Added a focused guardrail target: `check:standalone-light-client`.
- Continued the next light-client wave with Global Color Adjust, Global Sequence Manager, and Camera Manager:
  - Global Color Adjust standalone commands now always carry `documentId`, `baseDocumentRevision`, and `stalePolicy`, and send explicit small payloads for settings, save mode, and save suffix.
  - Global Sequence Manager standalone saves now use a shared payload helper with normalized `durations` and durable-write `stalePolicy: 'reject'`.
  - Camera Manager standalone writes now use typed minimal action payloads, and document-write actions default to strict stale rejection while `VIEW_CAMERA` remains warn-compatible.
- Continued the medium-complexity wave with Sequence Editor, Geoset Editor, and Geoset Visibility:
  - Sequence Editor standalone apply now uses a shared payload helper for `sequences`, `deletedIntervals`, and `pruneKeyframes`, and handler-side parsing now owns normalization.
  - Geoset Editor standalone saves now use a typed `SAVE_ALL` payload helper with a dedicated parser in the tool-window command handler.
  - Geoset Visibility standalone commands now distinguish durable `SAVE_ANIMS` from warn-compatible `SET_SEQUENCE` and `SET_FRAME`, with handler-side payload normalization.
- Continued the third light-client wave with Geoset Animation, Texture Animation, and Model Optimize:
  - Geoset Animation standalone writes now use a shared `UPDATE_GEOSET_ANIMS` payload helper instead of sending raw arrays.
  - Texture Animation standalone writes now use a typed command payload; delete operations keep `deleteIndex` so material `TVertexAnimId` remapping remains authoritative in the handler.
  - Model Optimize standalone commands now use a typed payload with `polygon` and `keyframe` option normalization before `MainLayout` executes optimization.
- Continued the heavy-editor payload-hardening wave with Texture Manager, Material Manager, and Node Editor:
  - Texture Manager standalone sends typed actions for texture save, save-with-materials, save-mode, save-suffix, and renderer reload; the main handler now parses and rejects invalid payloads explicitly instead of unpacking loose objects.
  - Material Manager standalone now builds typed preview, commit, selection, and utility commands; the main handler parses the command union before touching preview or commit paths.
  - Node Editor standalone now builds revisioned command payloads through a shared helper, and the main command handler validates preview/apply/rename payload shape before mutating preview or document state.
- Started the first heavy-editor snapshot-reduction slice in Texture Manager:
  - Texture deletion no longer asks the standalone window to derive material and particle remaps; it now sends only the updated texture collection, and the main window derives the authoritative remap through `TextureMaterialCommandHandler`.
  - Texture Manager standalone snapshots no longer carry `particleEmitters`, `particleEmitters2`, or `globalSequences`, shrinking the detached-window payload to textures, materials, geoset summaries, and model path.
- Continued Texture Manager snapshot reduction:
  - Texture Manager snapshots now include material texture summaries for picked-geoset-to-texture selection and leave the legacy full `materials` field empty.
  - `TextureEditorModal` resolves picked-geoset texture selection through the shared summary lookup helper, keeping full material arrays out of the standalone texture-manager data path while preserving legacy fallback compatibility.
- Started the Node Editor summary-bridge slice:
  - Node Editor snapshot construction now has a dedicated bridge helper instead of leaving all shaping logic embedded in `MainLayout`.
  - The bridge adds additive lightweight resource summaries such as node summaries, sequence summaries, texture summaries, material summaries, and normalized global-sequence durations while keeping legacy full fields for compatibility.
  - `NodeEditorStandalone` now prefers the summary bridge fields where safe and falls back to legacy arrays, preparing later per-dialog payload slimming without changing current editor behavior.
- Continued Node Editor snapshot reduction:
  - Node Editor snapshots now leave the legacy full `globalSequences`, `sequences`, and `allNodes` fields empty.
  - `NodeEditorStandalone` reconstructs the keyframe and parent-selection view models from summary/resource fields first, keeping the current selected node bootstrap intact while reducing repeated resource broadcasts.
  - The standalone light-client guard now pins this summary-first Node Editor path so later changes do not quietly reintroduce those full snapshot arrays.
- Continued the second Node Editor snapshot-reduction slice:
  - Node Editor snapshots now also leave the legacy full `materials` field empty.
  - Ribbon material selection remains available from material summaries because the node dialog only needs material indexes for that control.
  - Full texture snapshots remain in place for now because Particle Emitter 2 preset saving still reads the selected full texture object by `TextureID`.
- Continued the selected-detail Node Editor slice:
  - Node Editor snapshots now leave the legacy full `pivotPoints` table empty.
  - The bridge sends only `selectedPivotPoint` for the currently edited node, sourced from authoritative `modelData.PivotPoints[objectId]` with a node-local fallback.
  - `NodeEditorStandalone` hydrates the frozen selected node from `selectedPivotPoint`, preserving Generic Node pivot editing without broadcasting the full PIVT table.
  - Full `textures` and the selected full `node` bootstrap remain in place: PE2 preset saving still reads the selected full texture object, and each node dialog still initializes its draft from the selected node payload.
- Continued the PE2 texture-dependency Node Editor slice:
  - Node Editor snapshots now include `selectedParticleEmitter2Texture` when the active standalone editor is Particle Emitter 2 and the selected node has a valid `TextureID`.
  - `ParticleEmitter2Dialog` preset saving now prefers this selected texture detail before falling back to `modelData.Textures[TextureID]`, preparing preset export for a future removal of the full texture snapshot.
  - The full `textures` field remains in place for now because PE2 texture options/realtime validation and sibling node dialogs still consume the compatibility `standaloneModelData.Textures` shape.
- Continued the PE2 summary-driven texture UI slice:
  - `NodeEditorStandalone` now passes `textureSummaries` through the standalone PE2 model-data compatibility object.
  - PE2 texture dropdown options are built from `textureSummaries` first, with the selected texture detail and legacy full `Textures` array only used as fallback.
  - PE2 `TextureID` validation now accepts IDs present in texture summaries or selected detail before consulting the legacy full texture array, removing the direct dependency on `modelData.Textures.length`.
  - The full `textures` field is still retained for now because sibling node dialogs still share the compatibility model-data shape, and PE2 preset save still keeps a legacy fallback while selected-detail refresh after changing TextureID is not yet an authoritative query path.
- Continued the PE2 selected texture detail refresh slice:
  - Standalone PE2 now requests a shared `rpc-req-nodeEditor` snapshot refresh shortly after `applyRealtimeTexture()` changes `TextureID`, instead of waiting only for unrelated broadcast timing before `selectedParticleEmitter2Texture` can catch up.
  - The Node Editor snapshot bridge now receives the current `nodeEditorPreview` overlay and derives `selectedParticleEmitter2Texture` from the preview node when it targets the active PE2 node. This keeps selected texture detail aligned with in-flight preview/draft TextureID changes without adding a new ad-hoc RPC path.
  - Full `textures` still remain in the legacy snapshot for now because sibling node dialogs share the compatibility `standaloneModelData.Textures` shape, and PE2 preset save still needs a fallback while refresh responses can race with fast user changes or hidden-window delivery.
- Continued the PE2 preset-save fallback reduction slice:
  - `ParticleEmitter2Dialog` now resolves preset texture data through a central `resolvePresetTexture()` helper: use the matching `selectedParticleEmitter2Texture` first, then request a shared `rpc-req-nodeEditor` refresh and briefly wait for the authoritative snapshot detail, and only then fall back to legacy `modelData.Textures[TextureID]`.
  - `NodeEditorStandalone` now wires `resolveStandaloneTextureDetail` through the existing shared bridge instead of adding a component-local RPC path. The resolver polls the latest Node Editor snapshot state for a short bounded window after requesting refresh.
  - Full `textures` still remain in the legacy snapshot because the bounded wait can still time out under hidden-window or rapid-change races, and sibling node dialogs still share the compatibility `standaloneModelData.Textures` shape.
- Started Material Manager snapshot reduction:
  - Material Manager snapshots now include lightweight `materialSummaries`, `textureSummaries`, `sequenceSummaries`, and `textureAnimSummaries`.
  - The standalone Material Manager no longer receives full legacy `sequences` or `textureAnims` arrays in its bootstrap snapshot.
  - `MaterialEditorModal` converts sequence summaries into the small keyframe-editor sequence view model, builds material-list / texture / texture-animation options from summaries first, and keeps legacy fallback retained for compatibility.
  - The standalone light-client guard now pins the Material Manager summary helper and summary-first modal consumption path.
- Continued Material Manager selected-detail preparation:
  - The standalone material list now uses `materialSummaries` first even while full `materials` remain available for the selected/editing draft.
  - Newly added unsynced draft materials still fall back to local material shape, but existing list rows no longer require full material array parity before summaries are used.
  - Full `materials` and `textures` remain in the snapshot for now because layer editing, import/drop, preview, undo/redo, and commit still operate on the current collection draft.
- Continued the next Material Manager selected-detail slice:
  - Added a shared selected material detail view model that derives the selected material's layer list, layer labels, texture id, texture-animation id, filter mode, and animated-field flags from summary/detail inputs.
  - `MaterialEditorModal` now renders the layer list from this selected-detail helper instead of binding that read-only list directly to `selectedMaterial.Layers`.
  - Full `materials` remain in the snapshot for the editing draft and existing `SAVE_MATERIALS` / `COMMIT_MATERIALS` command path; this slice only moves read/list state toward selected detail so removal of full material snapshots can happen later without breaking edits.
- Started Material Manager operation-level preview migration:
  - Added a typed `PATCH_SELECTED_LAYER_PREVIEW` command for standalone selected-layer realtime preview.
  - `MaterialEditorModal` keeps its local material draft, but standalone `updateLocalLayer(..., applyRealtime=true)` now emits the selected material index, layer index, and the denormalized layer patch instead of sending a full `SAVE_MATERIALS` collection payload.
  - `MaterialManagerCommandHandler` applies that patch against the current main-window preview materials, or authoritative `modelData.Materials` when no preview is active, then updates the preview overlay through `TextureMaterialCommandHandler`.
  - Full `materials` and `textures` remain in place for commit, import/drop, add/delete/reorder, undo/redo, and broad compatibility paths; this only removes the high-frequency layer-field preview path from broad collection replacement.
- Continued Material Manager operation-level preview migration:
  - Added a typed `PATCH_SELECTED_MATERIAL_PREVIEW` command for standalone selected-material realtime preview.
  - `MaterialEditorModal` now routes `updateLocalMaterial(..., applyRealtime=true)` through the operation-level material patch path, sending the material index and denormalized material patch instead of a full `SAVE_MATERIALS` collection payload.
  - `MaterialManagerCommandHandler` applies the material patch against the current main-window preview materials, or authoritative `modelData.Materials` when no preview is active, then updates the preview overlay through `TextureMaterialCommandHandler`.
  - This covers material-level fields such as `ConstantColor`, `SortPrimsFarZ`, `FullResolution`, and `PriorityPlane`; commit/cancel/undo, import/drop, and structural add/delete/reorder paths intentionally remain on their existing broader flows.
- Continued Material Manager structural preview migration:
  - Added a typed `ADD_LAYER_PREVIEW` command for the lowest-risk structural layer operation.
  - Standalone `handleAddLayer()` now keeps its local edit draft and selected-layer behavior, but the live preview sends only the target material index and the denormalized new layer instead of a broad `SAVE_MATERIALS` collection payload.
  - `MaterialManagerCommandHandler` appends that layer against the current main-window preview materials, or authoritative `modelData.Materials` when no preview is active, then updates the preview overlay through `TextureMaterialCommandHandler`.
  - Commit/cancel/undo, delete/reorder layer, material add/delete, texture import/drop/apply, and full `materials` / `textures` draft state intentionally remain unchanged. `DELETE_LAYER_PREVIEW` and reorder previews are left for later because their selected-index and empty-layer edge cases are riskier.
- Closed the guard tracking gap:
  - `package.json` already points `check:standalone-light-client` at `scripts/check-standalone-light-client.mjs`, but broad `scripts/*` ignore rules made that guard local-only.
  - `.gitignore` now explicitly unignores `scripts/check-standalone-light-client.mjs` and this plan document, keeping the package script, guard, and verification plan trackable together.
- Continued Material Manager operation-level preview migration:
  - Added typed `DELETE_LAYER_PREVIEW` and `MOVE_LAYER_PREVIEW` commands for standalone selected-layer structural preview.
  - `MaterialEditorModal` now keeps its local draft and selected-layer behavior, but standalone delete/move layer preview sends only material/layer indexes instead of a broad `SAVE_MATERIALS` collection payload.
  - `MaterialManagerCommandHandler` derives delete/move preview results from the current main-window material preview or authoritative `modelData.Materials`, then updates the preview overlay through `TextureMaterialCommandHandler`.
  - Full material commit/import, material add/delete, texture import/drop/apply, and undo/redo remain on broader compatibility paths until selected-detail and operation-level commit boundaries are split further.
- Isolated the Texture Manager full-subset writeback compatibility path:
  - Removed the unused `SAVE_TEXTURES_WITH_MATERIALS` command payload/export and handler branch.
  - Standalone Texture Manager commands can no longer send child-derived full `materials`, `geosets`, `particleEmitters`, or `particleEmitters2` arrays back to the main window through that legacy action.
  - `SAVE_TEXTURES` remains as the current conservative full texture collection boundary because texture count changes, deletion remaps, and `none` / `-1` semantics still need a dedicated operation-level design.
- Removed the last full-resource Node Editor snapshot array:
  - Node Editor snapshots now leave legacy full `textures` empty, matching the already-empty `materials`, `globalSequences`, `sequences`, `allNodes`, and `pivotPoints` fields.
  - Standalone PE2 texture UI now uses `textureSummaries` plus `selectedParticleEmitter2Texture`; it no longer falls back to full `modelData.Textures` in standalone mode.
  - PE2 preset save still requests selected texture detail through the shared `rpc-req-nodeEditor` bridge, but if the bounded standalone resolver cannot provide that selected detail it now saves without a texture payload instead of reading a full texture snapshot.
  - The guard now pins the empty legacy texture snapshot and forbids reintroducing the standalone PE2 full-texture fallback.
- Continued Texture Manager operation-level migration:
  - Added typed `PATCH_TEXTURE` and `DELETE_TEXTURE` standalone commands.
  - `TextureEditorModal` now sends single-texture patch intents for standalone path / replaceable / flag edits instead of immediately sending a full texture collection.
  - Standalone texture deletion now sends only the deleted texture index; the main-window handler derives the next texture collection from current authoritative `modelData.Textures`.
  - The main handler still applies both operations through `TextureMaterialCommandHandler.setTextureCollection`, preserving existing material and particle texture-reference normalization/remapping.
  - Full texture collection saves remain for texture import/add, texture pixel adjustment persistence, and final save boundaries until selected texture detail and explicit add/import commands are split out.
- Continued Texture Manager add/import migration:
  - Added typed `ADD_TEXTURES` standalone command.
  - Standalone file import and blank-texture creation now send only the new texture records; the main-window handler appends them to current authoritative `modelData.Textures`.
  - Drag/drop replacement of the selected texture now uses the existing `PATCH_TEXTURE` path instead of a full texture collection save.
  - Full texture collection saves remain for texture pixel adjustment persistence and final save boundaries, and the standalone snapshot still carries full textures until a selected-texture detail query path replaces the current local collection draft.
- Completed the current Texture Manager summary-snapshot slice:
  - Texture Manager snapshots now include `textureSummaries` and leave the legacy full `textures` payload empty.
  - `TextureEditorModal` hydrates its compatibility draft from `textureSummaries` through the shared bridge helper, keeping the standalone UI working while avoiding repeated full texture broadcasts.
  - The main-window snapshot cache still tracks authoritative `modelData.Textures` internally for invalidation, but that source is no longer broadcast as the standalone payload.
- Continued Material Manager structural preview migration:
  - Added typed `ADD_MATERIAL_PREVIEW` and `DELETE_MATERIAL_PREVIEW` commands so standalone add/delete material live preview sends only the target operation rather than a broad `SAVE_MATERIALS` collection.
  - `MaterialManagerCommandHandler` now derives add/delete material preview from the current main-window preview or authoritative material collection, including material-index remap handling on deletion.
  - Durable `COMMIT_MATERIALS` now defaults to `stalePolicy: 'reject'`; preview-only material actions remain warn-compatible because they update preview state rather than persisted document state.
- Tightened Node Editor durable-write stale handling:
  - `APPLY_NODE_UPDATE` commands that carry `history` now default to `stalePolicy: 'reject'`, matching rename behavior because those applies write undoable document history.
  - Preview updates and preview clears remain warn-compatible so realtime detached editing can continue to flow without treating non-durable draft updates as stale document commits.
  - The standalone light-client guard now pins this distinction so a later broad stale-policy fallback cannot reintroduce the same stale command bug class.
- Split oversized tool-window command handlers:
  - `ToolWindowCommandHandlers.ts` is now a small compatibility re-export surface, with Texture Manager, Material Manager, preview operations, collection-editor handlers, and shared revision diagnostics moved into focused bridge modules.
  - Material Manager command construction and parsing are also split into focused creator/parser modules, leaving the payload file as the compact type surface.
  - This keeps the public bridge imports stable while bringing the new command/service logic back under the repo's `AGENTS.md` file-size guardrails.
  - The standalone light-client guard now checks the split implementation files directly so the architecture invariant remains protected after the refactor. A few pre-existing bridge infrastructure files remain above the soft size target and should be handled as separate follow-up cleanup, but this pass does not add new heavy logic to them.
