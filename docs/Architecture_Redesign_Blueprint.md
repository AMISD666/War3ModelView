# War3ModelView Architecture Redesign Blueprint

## Goal

Rebuild project boundaries so new features can be added without increasing coupling between UI, document mutation, preview logic, multi-window sync, and platform APIs.

## Current Root Problems

1. Desktop shell residue: Electron and Tauri coexist, which leaves duplicate runtime and build paths.
2. Boundary collapse: UI components directly call Tauri APIs, manipulate document state, and coordinate detached windows.
3. Store overload: `modelStore` currently holds document state, tab state, preview state, animation state, and renderer cache.
4. Multi-window overdesign: detached tools use several overlapping sync mechanisms instead of one bridge.
5. History inconsistency: some edits use commands, some push history directly, some mutate state first and patch history later.
6. Type erosion: `any`, shims, and bypasses make the domain model unstable.

## Target Architecture

Use four explicit layers in the frontend:

1. `presentation`
   - React components and view-only hooks.
   - No platform APIs.
   - No direct document mutation.

2. `application`
   - Use cases, command bus, editor session coordinators, window bridge orchestrators.
   - Converts UI intent into domain-safe operations.

3. `domain`
   - Stable model types, document mutation rules, history semantics, preview contracts.
   - No React and no Tauri imports.

4. `infrastructure`
   - Tauri gateways, renderer adapters, MPQ/texture/file gateways, persistence adapters.
   - Sole owner of platform and third-party runtime integration details.

## Target Frontend Structure

```text
src/renderer/src/
  app/
    bootstrap/
    providers/
    routes/
  presentation/
    components/
    screens/
    hooks/
  application/
    commands/
    services/
    sessions/
    window-bridge/
  domain/
    model-document/
    editor-session/
    preview/
    history/
    types/
  infrastructure/
    tauri/
    renderer/
    mpq/
    persistence/
    war3-model/
```

## State Model

### 1. Document State

The canonical editable model.

- Current model document
- Dirty flag
- Saved path
- Revision/version
- Undo/redo history anchor

Owner:
- `documentStore` or equivalent domain store

Rules:
- Mutated only by commands
- No temporary slider or dialog state
- No detached window transport state

### 2. Session State

Per-editor local state.

- Form state
- Selection inside an editor
- Active tab inside one tool
- Unsaved staged values

Owner:
- individual session stores or local reducers

Rules:
- Can diverge from document temporarily
- Safe to discard on close

### 3. Preview State

Transient render-only data.

- Live texture adjustments
- Dragging gizmo intermediate transform
- Temporary node/material preview

Owner:
- preview bridge or preview store

Rules:
- Never written directly into history
- Must be discardable
- Must be replayable from session state

## Command System

All document mutations must pass through one command pipeline.

```text
UI Intent
  -> Application Use Case
  -> CommandBus.execute(command)
  -> Domain mutation
  -> HistoryService records command
  -> Preview reset/refresh if needed
```

Rules:

- No component may call `useHistoryStore.getState().push()` directly.
- No component may mutate document state and then "patch in" history separately.
- Commands must be serializable enough to debug and test.

Suggested command classes:

- `UpdateNodeCommand`
- `UpdateMaterialCommand`
- `UpdateTextureAnimCommand`
- `ApplyGlobalTransformCommand`
- `ImportTextureCommand`
- `SetGeosetVisibilityCommand`

## Multi-Window Model

Replace ad-hoc window sync with one shared bridge.

### Window Roles

- `main` owns the canonical document.
- tool windows own only local session state.

### Shared Protocol

- `snapshot`: full initial hydration from document/session sources
- `patch`: lightweight non-canonical preview/session updates
- `command`: request for canonical document mutation
- `ack`: optional sync completion signal

Rules:

- Tool windows do not own canonical document state.
- Tool windows do not write directly into history.
- Tool windows submit commands to main.
- Main decides whether a change is preview-only or document-changing.

## Viewer Split

`Viewer.tsx` should be decomposed into a runtime shell plus focused modules.

Target slices:

- `viewer-runtime`
- `camera-controller`
- `selection-engine`
- `gizmo-engine`
- `overlay-renderer`
- `texture-runtime`
- `model-runtime-adapter`

Rules:

- Viewer shell composes modules and owns lifecycle only.
- Geometry picking and gizmo math must live outside React components.
- `war3-model` interaction should sit behind a renderer adapter.

## Backend Boundary

`src-tauri/src/main.rs` should stop being a monolith command registry plus business module.

Target split:

```text
src-tauri/src/
  main.rs
  app/
    bootstrap.rs
    windowing.rs
    commands.rs
  services/
    mpq_service.rs
    texture_service.rs
    update_service.rs
    context_menu_service.rs
    copy_service.rs
  support/
    paths.rs
    settings.rs
```

Rules:

- `main.rs` should mostly wire services and register commands.
- Command handlers should delegate to services, not contain full workflows inline.

## Execution Order

### Phase 0: Baseline Stabilization

- Keep Tauri as the active shell
- Fix typecheck entry
- Freeze new direct platform calls in components
- Add architecture guardrails docs

Implemented baseline:

- `src/renderer/src/infrastructure/desktop/DesktopGateway.ts` defines the frontend platform boundary.
- `src/renderer/src/infrastructure/desktop/tauriDesktopGateway.ts` is the only implementation for current desktop runtime.
- Low-risk utility modules should depend on `desktopGateway` instead of importing `@tauri-apps/*` directly.
- `src/renderer/src/utils/mpqPerf.ts` and `src/renderer/src/utils/persistStorage.ts` are the first migrated examples.
- `src/renderer/src/utils/standalonePerf.ts`, `src/renderer/src/utils/featureGate.ts`, `src/renderer/src/utils/dissolveEffect.ts`, and `src/renderer/src/services/particleEmitter2PresetService.ts` now use the same gateway boundary for event emit, invoke, file IO, directory listing, and existence checks.
- `src/renderer/src/infrastructure/update/UpdateGateway.ts` defines a separate update boundary for version lookup, release HTTP requests, temp path lookup, installer download, installer launch, opening release pages, and process exit.
- `src/renderer/src/services/updateService.tsx` now depends on `updateGateway` instead of direct Tauri app/http/path/shell/process/core APIs.
- `src/renderer/src/infrastructure/window/WindowGateway.ts` defines the window platform adapter boundary for event listen/emit, managed webview lifecycle, direct window emit, and large payload delivery.
- `src/renderer/src/utils/WindowManager.ts` now depends on `windowGateway` instead of direct Tauri event/core/webview/dpi APIs.
- `src/renderer/src/application/window-bridge/WindowRpcTransport.ts` owns tool-window RPC transport decisions: sync/patch event naming, large payload JSON/MessagePack routing, direct window emit fallback, and keyframe init payload serialization.
- `WindowManager` now delegates RPC and keyframe init delivery to `WindowRpcTransport`; it should continue shrinking toward lifecycle/session registry responsibilities only.
- `src/renderer/src/application/window-bridge/ToolWindowHydrationTracker.ts` owns child-window hydration listeners, waiters, timeouts, and cleanup for `rpc-applied-*` events.
- `WindowManager` now delegates hydration state to `ToolWindowHydrationTracker`, leaving fewer window-sync maps inside the facade.
- `src/renderer/src/application/window-bridge/ToolWindowSessionRegistry.ts` owns node-editor pending session nonces and keyframe window id pooling.
- `WindowManager` now delegates tool-window session/id allocation to `ToolWindowSessionRegistry`, keeping legacy method names only as a compatibility facade.
- `src/renderer/src/application/window-bridge/ToolWindowLifecycleService.ts` owns managed window recovery, creation, bounds, close-hide handling, show/focus, visibility cache, and shutdown destruction.
- `src/renderer/src/utils/WindowManager.ts` is now a thin compatibility facade over lifecycle, RPC transport, hydration tracking, and session registry services.
- `src/renderer/src/application/commands/CommandBus.ts` defines the first application-layer command bus for document mutations that should optionally enter history.
- `src/renderer/src/application/commands/NodeEditorCommandHandler.ts` owns node-editor preview/apply/rename command handling; preview remains transient and apply runs through `CommandBus`.
- `src/renderer/src/components/MainLayout.tsx` now delegates node-editor RPC commands to `nodeEditorCommandHandler` instead of directly mutating model/history state in that component.
- `src/renderer/src/hooks/useNodeEditorPreview.ts` now sends local preview changes through `nodeEditorCommandHandler`; node editor UI no longer receives store mutation callbacks for preview state.
- Node editor dialogs now delegate committed node edits to `nodeEditorCommandHandler` instead of directly calling `modelStore.updateNode`; dialogs with undoable edits pass history metadata into the command pipeline.
- `src/renderer/src/hooks/useWindowEvent.ts` wraps `WindowGateway.listen` for React components; node editor keyframe save listeners no longer import Tauri event APIs directly.
- `src/renderer/src/application/window-bridge/KeyframeEvents.ts` defines the shared keyframe event name and payload contract for detached keyframe editor replies.
- `src/renderer/src/hooks/useRpc.ts` now uses `WindowGateway` for RPC listen/emit and current-window identity instead of direct Tauri event/window imports.
- `src/renderer/src/application/commands/ModelDocumentCommandHandler.ts` centralizes whole-document replacement and camera-list replacement commands for workflows such as model optimize, model merge, and camera manager edits.
- `src/renderer/src/application/commands/HistoryCommandService.ts` centralizes non-mutating history controls (`clear`, `markSaved`, `undo`, `redo`) so `MainLayout` no longer imports `historyStore` directly.
- `src/renderer/src/components/MainLayout.tsx` no longer pushes history entries directly for model optimize, model merge, or camera manager actions; those paths now execute through application command services.
- `DesktopGateway` now owns file open/save dialogs in addition to invoke, event, and filesystem calls.
- `WindowGateway` now owns current-window close and close-request handling.
- `src/renderer/src/components/MainLayout.tsx` no longer imports `@tauri-apps/*` directly; remaining platform operations in that component route through `DesktopGateway` and `WindowGateway`.
- `src/renderer/src/infrastructure/serialization/ModelSerializationGateway.ts` defines the model parse/serialize boundary.
- `src/renderer/src/infrastructure/serialization/war3ModelSerializationGateway.ts` is the only current save/merge path that imports `war3-model` parse/generate APIs.
- `src/renderer/src/components/MainLayout.tsx`, `src/renderer/src/components/modals/ModelMergeModal.tsx`, `src/renderer/src/utils/modelMerge.ts`, and `src/renderer/src/utils/modelUtils.ts` no longer import `war3-model` directly for save/merge workflows.
- `src/renderer/src/application/model-save/ModelSavePreparationService.ts` now owns save/export preparation helpers for geoset cleanup, model validation, typed-array normalization, and classic model repair preparation.
- `src/renderer/src/components/MainLayout.tsx` no longer defines `cleanupInvalidGeosets`, `validateModelData`, `prepareModelDataForSave`, or save-preparation fallback-normal generation; save/export handlers call the application-layer preparation service.
- Save preparation is split by responsibility: `ModelSavePreparationService.ts` keeps validation and geoset cleanup under the service size limit, while `prepareModelDataForSave.ts` isolates the large legacy compatibility normalizer for later domain-by-domain decomposition.
- `src/renderer/src/application/model-save/SaveModelUseCase.ts` centralizes model save/export preparation and model file writing. `MainLayout` still owns UI confirmation, texture copy/encode side effects, and store commit, but no longer serializes model bytes or calls save-preparation helpers directly.
- `src/renderer/src/application/model-save/TextureSaveAssetService.ts` now owns save/export texture side effects: copying referenced relative textures, applying pending texture adjustments, invoking backend texture encoding, and writing adjusted texture files.
- `src/renderer/src/infrastructure/texture/TextureDecodeGateway.ts` defines the texture decode boundary. The current implementation adapts the existing viewer texture loader as a transitional bridge; future work should move decoding out of `components/viewer`.
- `src/renderer/src/utils/windowsPath.ts` centralizes the Windows path helpers previously embedded in `MainLayout`.
- `src/renderer/src/application/model-save/SaveCurrentModelWorkflow.ts` centralizes save/save-as/export/convert workflow sequencing: prepare model data, confirm validation through an injected UI callback, write adjusted/copied texture assets, write the model file, and clear the backend texture cache. `MainLayout` now keeps only file dialog selection, message rendering, and store commit side effects.
- `src/renderer/src/application/window-bridge/ToolWindowSnapshots.ts` now owns tool-window snapshot data contracts for Texture Manager and Material Manager, geoset metadata stripping, global-sequence duration mapping, geoset metadata patch merging, and snapshot-version caching. `MainLayout` no longer defines these RPC payload types or cache refs directly.
- `src/renderer/src/application/window-bridge/ToolWindowCommandHandlers.ts` now owns mutation commands from Geoset Editor, Geoset Visibility, Geoset Animation, Texture Animation, Texture Manager, and Material Manager tool windows. `MainLayout` now forwards these RPC commands instead of directly mutating stores in each handler.
- `src/renderer/src/application/window-bridge/CameraViewportBridge.ts` and `CameraManagerCommandHandler.ts` now isolate Camera Manager RPC mutations from viewer camera control. Camera creation from the current orbit view and camera focusing both cross the `CameraViewportBridge` boundary instead of reaching `Viewer` APIs directly from detached-window command handling.
- `src/renderer/src/application/window-bridge/TimelineToolWindowHandlers.ts` now owns detached-window handlers for Sequence Manager, Global Sequence Manager, and Global Color Adjust. Sequence and global-sequence edits now pass through command-bus-backed document mutations instead of `MainLayout` directly mutating Zustand stores, while global color adjust remains a session/preview-state handler.
- `src/renderer/src/application/window-bridge/ToolWindowBroadcastCoordinator.ts` now owns standalone tool-window visibility checks, model/selection subscriptions, snapshot-version skip logic, and broadcast fan-out. `MainLayout` no longer carries `rpcRefs`, standalone snapshot dispatch refs, or the long-lived cross-window synchronization loop directly.
- `src/renderer/src/application/window-bridge/ToolWindowOrchestrator.ts` now owns standalone warmup scheduling, editor/tool-window opening rules, and editor shortcut registration. `MainLayout` now injects UI callbacks and window-manager capabilities instead of duplicating `openToolWindow(...)` branches for menu actions and shortcuts.
- `src/renderer/src/application/shell/useAppShellController.ts` now owns shell-level state and side effects for debug console toggling, update checks, changelog display, About dialog activation status refresh, and activation submission. `src/renderer/src/components/shell/AboutDialog.tsx` now renders the About/activation UI, removing another large non-editor block from `MainLayout`.
- `src/renderer/src/application/model-tools/useModelToolsController.ts` now owns menu-triggered model maintenance workflows: recalculate normals/extents, repair model, add death animation, remove lights, merge same materials, clean unused materials, and clean unused textures. `MainLayout` no longer embeds these store mutations and cleanup service calls inline, and unused-texture cleanup now commits an explicit full model patch instead of relying on in-place mutation side effects.

Migration rule:

- New code may import `desktopGateway` from infrastructure services.
- React components should not import `desktopGateway` directly unless they are transitional containers being actively extracted.
- Application use cases should receive gateway interfaces through construction or narrow service modules when the workflow becomes testable.
- `WindowGateway` is only the platform adapter. `WindowManager` still needs to be split into the planned window bridge because it owns lifecycle, hydration, RPC, payload routing, and recovery behavior.
- `updateService` needs a separate update/platform gateway because it depends on app version, HTTP, temp paths, shell open, process exit, and download commands.

### Phase 1: Boundary Extraction

- Introduce platform gateways
- Introduce command bus
- Stop direct history pushes in new code
- Add editor bridge abstraction

### Phase 2: Store Split

- Split `modelStore` into document/workspace/view/session responsibilities
- Move preview state out of canonical store

### Phase 3: Viewer Decomposition

- Extract non-React math/runtime modules from `Viewer.tsx`
- Move `war3-model` usage into infrastructure adapter layer

### Phase 4: Backend Decomposition

- Break `main.rs` into command registration + services

### Phase 5: Typed Domain Hardening

- Replace `any` hotspots with stable domain types
- Remove compatibility shims and hard references

## Definition of Done for Each Slice

- No new direct platform access from UI
- No new direct history writes from components
- Typecheck still runs
- Minimal verification included
- File size limits respected
