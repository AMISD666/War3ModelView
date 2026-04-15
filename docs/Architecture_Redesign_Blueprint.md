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
