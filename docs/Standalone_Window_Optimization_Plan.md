# Standalone Window Optimization Plan

## Document Purpose

This document is the source of truth for standalone tool window performance work.
All follow-up changes should be tracked against this file and keep its status up to date.

## Scope

Current problem area:

- Standalone windows are slower than the old in-process simulated windows.
- After a model finishes loading, standalone windows can stall before content appears.
- The first drag of a standalone window can stutter.
- Tool window content is not available immediately after opening.
- Data handoff currently depends on async cross-window synchronization after the window is shown.

Primary target:

- Make standalone tool windows feel close to instant-open.
- Make content visible by the time the window is shown.
- Remove the first-drag stutter as much as the webview model allows.
- Replace full-state broadcast behavior with a more intentional snapshot and patch model.

Non-goals for the first pass:

- Replacing standalone windows with simulated windows.
- Rewriting every tool window at once.
- Changing tool behavior unrelated to load, sync, or rendering responsiveness.

## Simulated Window vs Standalone Window

### Simulated Window Advantages

- Shares the same React tree, JS runtime, Zustand stores, and caches with the main UI.
- No cross-window serialization or IPC.
- No second webview startup cost.
- Dragging is only DOM position updates inside the same page.

### Simulated Window Disadvantages

- Weaker process and focus isolation.
- Less native window behavior.
- Layout and z-ordering are constrained by the main window.
- Harder to separate workloads cleanly over time.

### Standalone Window Advantages

- Native window behavior and focus separation.
- Better spatial workflow for multi-window editing.
- Can evolve into clearer tool boundaries.
- Can eventually support more isolated heavy workflows.

### Standalone Window Disadvantages in Current Architecture

- Requires a second frontend runtime and webview startup.
- Current data flow waits too late to hydrate the child window.
- Current sync model sends coarse-grained state too often.
- Preload exists, but "preloaded" does not yet mean "ready to interact".

## First-Principles Diagnosis

Standalone window open time is the sum of four costs:

1. Runtime startup cost
2. Data availability cost
3. First render cost
4. First interaction cost

Current root causes:

1. The standalone entry path loads too much code up front.
2. The child window requests data only after visibility gating.
3. The parent broadcasts coarse snapshots instead of versioned small updates.
4. Hidden-window warmup does not complete full hydration before first show.
5. "Open" and "initialize" are still coupled in the current design.

## Root-Cause Strategy

We will solve the problem at the architecture level, not by adding more delays or retries.

Design principles:

- Show only windows that are already hydrated.
- Treat the main window as the single source of truth.
- Treat standalone windows as mirrors plus command senders.
- Split snapshot data from interaction patches.
- Prefer directed window delivery over global event fan-out.
- Reduce startup bundle size before optimizing micro-behavior.

## Target Architecture

### Phase Target

For a high-frequency window like `textureManager`:

- The webview is created in advance.
- The child runtime mounts while hidden.
- The main window pushes a cached snapshot before first show.
- The child acknowledges snapshot applied.
- The window is shown only after reaching ready state.
- Subsequent selection changes use lightweight patch messages.

### Data Model Target

For each standalone tool window:

- `snapshot`
  - stable content required for initial render
- `snapshotVersion`
  - monotonically increasing version number
- `patch`
  - lightweight event for selection or focused state changes
- `readyState`
  - `created -> mounted -> hydrated -> rendered -> visible`

## Implementation Phases

## Phase 0: Baseline and Instrumentation

Goal:

- Measure where time is going before larger refactors.

Tasks:

- [x] Add timing marks for `open_requested`
- [x] Add timing marks for `window_created`
- [x] Add timing marks for `child_runtime_mounted`
- [x] Add timing marks for `snapshot_sent`
- [x] Add timing marks for `snapshot_received`
- [x] Add timing marks for `snapshot_applied`
- [x] Add timing marks for `first_content_rendered`
- [x] Add timing marks for `window_shown`
- [x] Add timing marks for first drag latency
- [x] Surface timing marks in a main-window performance viewer with a direct entry button

Acceptance:

- We can compare first-open and second-open latency with numbers, not impressions.

## Phase 1: Reduce Standalone Startup Cost

Goal:

- Stop paying initialization cost for unrelated tool windows.

Tasks:

- [x] Replace broad top-level standalone imports with per-window lazy loading
- [x] Ensure the standalone entry only loads the active tool window component
- [ ] Review shared imports that are accidentally pulled into every standalone window
- [x] Verify `textureManager` startup bundle shrinks materially

Acceptance:

- Opening `textureManager` no longer parses unrelated standalone tool code on first use.

## Phase 2: Replace Visible-Gated Bootstrap

Goal:

- Child windows should hydrate while hidden.

Tasks:

- [x] Remove "wait until visible, then request sync" behavior from the standalone client handshake
- [x] Introduce explicit child `READY` signal after runtime mount
- [x] Push the latest cached snapshot from the main window immediately on `READY`
- [x] Add child acknowledgment when snapshot application is complete
- [x] Change open flow so `show()` happens after hydration readiness

Acceptance:

- A standalone window should not appear empty and then populate later.

## Phase 3: Introduce Snapshot Cache and Versioning

Goal:

- Stop recomputing and resending large state unnecessarily.

Tasks:

- [x] Add parent-side per-window snapshot cache (textureManager pilot)
- [x] Add `snapshotVersion` tracking (textureManager pilot)
- [x] Recompute snapshots only when relevant source data changes (textureManager pilot)
- [x] Avoid full snapshot rebuild on pure selection updates (textureManager pilot)
- [x] Store the latest ready-to-send snapshot for immediate child hydration (textureManager pilot)
- [x] Extend cached snapshot + versioning flow to `materialManager`

Acceptance:

- Opening an already warmed tool window should mostly use cached prepared state.

## Phase 4: Split Snapshot from Patch Traffic

Goal:

- Selection and focus changes should not trigger full content transfer.

Tasks:

- [x] Define a lightweight patch channel for picked geoset changes
- [ ] Define a lightweight patch channel for selected indices if needed
- [x] Keep texture/material/geoset metadata in snapshot, not in every patch (textureManager pilot)
- [x] Update `textureManager` first as the pilot window
- [x] Extend `pickedGeosetIndex` patch flow to `materialManager`
- [ ] Verify Ctrl-pick only sends tiny state deltas

Acceptance:

- Picking a polygon should not resend full texture/material payloads.

## Phase 5: Prefer Directed Delivery over Global Fan-Out

Goal:

- Reduce event bus overhead and improve determinism.

Tasks:

- [x] Audit all standalone sync traffic that still uses broad global emit
- [x] Switch sync delivery to directed per-window emit where possible
- [x] Keep a fallback path only for failure handling
- [ ] Verify no duplicate sync paths remain active for the same payload

Acceptance:

- Each standalone sync update should have one clear delivery path.

## Phase 6: First Paint Optimization inside the Tool Window

Goal:

- Make the window usable before heavy preview work completes.

Tasks:

- [ ] Render metadata first, heavy preview second
- [ ] Keep preview loading fully decoupled from first list render
- [ ] Avoid clearing already-valid preview content on irrelevant state changes
- [ ] Cache decoded preview inputs where practical
- [ ] Avoid mount-time work that is not needed for first interaction

Acceptance:

- Users can interact with the tool immediately even if preview work continues.

## Phase 7: Warmup Means Ready, Not Just Created

Goal:

- Upgrade warmup from hidden creation to hidden readiness.

Tasks:

- [ ] Change warmup definition to include mount and hydration
- [ ] Warm high-frequency windows first
- [ ] Re-evaluate warmup order and delay strategy
- [ ] Add readiness state logging for each warmed window
- [ ] Avoid showing a window that is still in pre-hydration state

Acceptance:

- A warmed window should open with content already present.

## Phase 8: Command-Oriented Editing Path

Goal:

- Keep the child window lightweight and stop sending oversized save payloads where avoidable.

Tasks:

- [ ] Review save flows for full-array payloads
- [ ] Introduce command or patch-based mutations where it is safe
- [ ] Keep the main window as the authoritative model owner
- [ ] Limit child-side data copies to what the editor truly needs

Acceptance:

- Editing traffic is more intentional and does not force full-state churn.

## Priority Order

Execution priority:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 6
7. Phase 5
8. Phase 7
9. Phase 8

Rationale:

- Startup and hydration order dominate the current user-visible latency.
- Patch-vs-snapshot separation matters more than micro-optimizing rendering details.
- Warmup is only valuable after startup and hydration semantics are corrected.

## Initial File Targets

Likely primary files to modify:

- `src/renderer/src/main.tsx`
- `src/renderer/src/App.tsx`
- `src/renderer/src/hooks/useRpc.ts`
- `src/renderer/src/utils/WindowManager.ts`
- `src/renderer/src/utils/standaloneWarmup.ts`
- `src/renderer/src/components/MainLayout.tsx`
- `src/renderer/src/components/detached/StandaloneToolWindowRouter.tsx`
- `src/renderer/src/components/modals/TextureEditorModal.tsx`

Likely secondary files after the pilot:

- `src/renderer/src/components/modals/MaterialEditorModal.tsx`
- `src/renderer/src/components/modals/TextureAnimationManagerModal.tsx`
- other standalone tool window components that currently consume full snapshots

## Validation Metrics

Track these before and after:

- First open time for `textureManager`
- Second open time for `textureManager`
- Time from `open_requested` to first visible content
- Time from `open_requested` to full hydration
- Time from Ctrl-pick to selection reflected in `textureManager`
- First drag smoothness and any visible hitch duration

Target direction:

- First open: materially reduced
- Second open: near-instant
- Content visibility: available at show-time, not after show-time
- Selection sync: visibly immediate

## Progress Log

### 2026-03-08

Status:

- Created the initial optimization tracking document.
- Confirmed current architecture issues:
  - standalone windows use separate webviews
  - standalone bootstrap currently depends on delayed sync request behavior
  - standalone warmup does not guarantee hydrated readiness
  - data synchronization is still too coarse for high-frequency interactions
- Confirmed `textureManager` should be used as the pilot window.
- Completed Phase 0 baseline instrumentation for the current standalone pipeline.
- Completed the first Phase 1 standalone entry split:
  - `main.tsx` now lazy-loads the selected standalone tool window instead of eagerly importing all tool windows.
  - the old `war3-model` startup-only debug import was removed from the entry path.
  - build output now shows `TextureEditorModal` and other standalone tools emitted as separate chunks instead of riding inside the main app startup path.
- Completed the first Phase 2 handshake pass for hidden hydration:
  - child windows now emit READY immediately after the RPC client is mounted
  - the main window answers READY with an immediate snapshot push
  - child windows emit APPLIED after state commit
  - WindowManager.openToolWindow() now waits briefly for hydration before showing the window
- Added a main-window standalone performance viewer reachable from the Help menu and a direct `性能监控` top-bar button, so cross-window timing data is inspectable without opening the native console.
- Completed the first Phase 3 cache/versioning pass for `textureManager`:
  - parent-side snapshot cache now reuses prepared snapshot payloads until texture/material/geoset/global-sequence/model-path sources actually change
  - snapshot payloads now carry `snapshotVersion`
  - child-side local texture reinitialization now keys off `snapshotVersion` instead of array identity churn
- Completed the first Phase 4 patch split for `textureManager`:
  - `pickedGeosetIndex` now travels over a dedicated lightweight patch channel
  - Ctrl-pick no longer resends the full texture/material/geoset payload to the standalone texture manager
- Completed the first Phase 5 directed-delivery pass:
  - standalone snapshot and patch sends now go through `WindowManager.emitToolWindowEvent()` first
  - direct per-window emit is attempted before any global event fallback
  - fallback remains in place only when the target window cannot be resolved or direct emit fails
- Extended the snapshot/patch architecture to `materialManager`:
  - parent-side `materialManager` sync now uses cached snapshots with `snapshotVersion`
  - standalone material selection updates now use the lightweight `pickedGeosetIndex` patch path instead of full resyncs
  - `MaterialEditorModal` now reports `child_runtime_mounted` and `first_content_rendered` into the main performance viewer
- Tightened standalone snapshot delivery for `textureManager` and `materialManager`:
  - the main-window broadcast loop now skips redundant snapshot sends when `snapshotVersion` is unchanged
  - skipped duplicate sends are marked as `snapshot_broadcast_skipped` in the performance timeline
  - the performance viewer now summarizes `snapshot`, `patch`, `direct emit`, `fallback`, and `skip` counts per window cycle
- Simplified first-open RPC hydration to reduce duplicate snapshots:
  - removed the preload-time batched `rpc-req-*` sync loop from `WindowManager`
  - first-open now relies on child `READY` plus delayed bootstrap fallback instead of stacking immediate and batched sync requests
  - client bootstrap retries now start later, so `READY` has time to deliver the first snapshot before fallback requests begin
- Reworked standalone open-time blocking policy:
  - `WindowManager` now uses per-window open options instead of hard-coded 700ms hydration blocking for every detached window
  - keyframe editor windows now skip hydration wait entirely, so dynamic text/keyframe editors do not stall on a timeout they can never satisfy
  - RPC-backed tool windows still support pre-show hydration, but the blocking timeout is reduced to a short best-effort window instead of nearly one second
  - the performance viewer now groups by `detail.windowId` first, so main-window relay events are attributed to the actual target window
- Next focus stays on Phase 4 verification and remaining Phase 5 cleanup: prove Ctrl-pick traffic is tiny in practice and remove any duplicate sync paths that still exist outside the current RPC route.
- Reduced texture-adjustment slider hot-path cost in `TextureEditorModal`:
  - preview recomputation is now collapsed into `requestAnimationFrame`, so rapid slider drags no longer run full image adjustment work for every intermediate event
  - renderer texture sync is now debounced during drag and flushed on `onChangeComplete`, instead of pushing a full adjusted texture IPC payload on every slider tick
  - reset buttons now force an immediate renderer sync so returning a channel to default does not wait for debounce
- Fixed the `AutoSeparateLayersCommand` commit path for real structural geometry changes:
  - the command now commits `Geosets` and remapped `GeosetAnims` in one atomic store update instead of two separate `setGeosets` / `setGeosetAnims` passes
  - split results now mark `modelData.__forceFullReload = true`, forcing `Viewer` to rebuild GPU buffers and animation state instead of running the lightweight `bufferSubData` UV sync path against stale buffers
  - model header counts for `NumGeosets` and `NumGeosetAnims` are refreshed at commit time, and hidden/selected geoset state is clamped to the new geoset count
- Tightened `AutoSeparateLayersCommand` skinning preservation after split:
  - split geosets now keep the source `Groups`, `VertexGroup`, and `TotalGroupsCount` layout instead of compacting group indices during rebuild
  - this avoids changing the original bone-binding semantics during face-order splitting, which could leave the separated mesh static even though sequences still existed

## Working Rules

- Update this document when a phase starts.
- Update checklist items when a task is completed.
- Record major architecture decisions here before broad rollout.
- Use `textureManager` as the proving ground before applying the same pattern to other standalone windows.









