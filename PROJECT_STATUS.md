# War3ModelView Project Status & Handoff

*Last update: 2026-01-27*

## Current Status (What works now)
1) **Multi-Tab Model Viewer**
   - Single-instance enforcement with Rust-side pending buffer for cold-start multi-open.
   - Tabs snapshot most model state and swap on tab switch.
   - `Ctrl+W` closes current tab.
2) **Copy model with textures (clipboard CF_HDROP)**
   - `copy_model_with_textures` + CLI `--copy-model` support multi-invoke.
   - Texture resolution scans MDX TEXS / MDL Image with alt extensions.
   - Cache under `%LOCALAPPDATA%\War3ModelView\war3modelview_data\temp`; cleanup on start/exit.
3) **Storage path**
   - Settings/data now under `%LOCALAPPDATA%\War3ModelView\war3modelview_data`.
4) **UI/UX fixes**
   - Save-on-close confirmation for dirty models.
   - "No animation" mode fully pauses animation (bind pose).
   - Polygon/face selection highlight uses pure-color overlay and is double-sided.
   - Animation panel shows sequence indices; panel width reduced; index-name gap tightened.

## Recent Changes (Key Files)
Backend (Rust):
- `src-tauri/src/main.rs`
  - Single-instance handling + pending file buffer.
  - Multi-file CLI parsing.
- `src-tauri/Cargo.toml`: `tauri-plugin-single-instance`, `once_cell`.

Frontend (React/TS):
- `src/renderer/src/store/historyStore.ts`
  - Dirty tracking (`isDirty`, `markSaved`).
- `src/renderer/src/components/MainLayout.tsx`
  - Save-on-close confirm modal.
  - CLI + pending buffer ingestion for multi-open.
- `src/renderer/src/store/modelStore.ts`
  - Tab snapshot logic.
  - PivotPoint fill on new nodes to avoid render crash.
- `src/renderer/src/components/Viewer.tsx`
  - Bind-pose mode when no animation selected.
  - Selection highlight uses DebugRenderer overlay (pure color).
- `src/renderer/src/components/DebugRenderer.ts`
  - Force blend state + disable cull face for selection overlay.
- `src/renderer/src/components/AnimationPanel.tsx`
  - Sequence index display; reduced spacing.
- `src/renderer/src/components/GeosetVisibilityPanel.tsx`
  - Default position moved down to avoid FPS overlap.
- `src/renderer/src/components/GeosetAnimationModal.tsx`
  - Safer vector cloning (avoid JSON stringify for typed arrays).

## Known Issues / Blockers (High Priority)
1) **Multi-model hot-start / multi-open loop**
   - Hot-start multi-open can black-screen or loop reload; errors like `Render Loop Crash: Cannot read properties of undefined (reading 'matrix')`.
   - Drag-and-drop open should create new tab (currently still reloads/loops).
2) **Texture load failures on tab switch**
   - Switching tabs can cause missing local textures with MPQ-like prefixes (e.g. `Textures\\grad3.blp`), only after multi-tab usage.
3) **Copy performance**
   - Single model ~2s; multi-model ~8-9s.
   - Hardlink path added via `CreateHardLinkW`, not yet verified.
4) **Geoset animation color validation**
   - RGB order now unchanged, but needs validation against reference tools.
5) **Animation panel layout**
   - Request to move duration under name is not done yet (only spacing + index added).
6) **Node manager**
   - Double-click slider jump + missing `useRef` error reported previously; verify current status.

## Performance Optimizations Done
- Sequential multi-file processing with small delay to avoid Zustand race conditions.
- Rust-side pending buffer for cold-start multi-open.
- Debug logging gated by console visibility to reduce IPC overhead.

## Next Steps (Priority)
1) **Stabilize multi-tab hot-start**
   - Fix infinite reload loop and black screen on hot-start multi-open.
   - Ensure drag-and-drop opens new tab, not reload.
2) **Fix texture loading on tab switch**
   - Audit texture cache keyed by renderer/model; MPQ-prefix local textures are failing after tab swap.
3) **Verify hardlink path effectiveness**
   - Confirm `CreateHardLinkW` usage actually speeds up copy and handles cross-volume fallback.
4) **Finalize animation panel layout**
   - Duration display below name; reduce index gap further if needed.
5) **Re-validate geoset anim colors**
   - Compare with mdx-m3-viewer reference to confirm save/parse correctness.

## Handoff Notes / Gotchas
1) **Single-instance + pending buffer**
   - Frontend must call `get_pending_open_files` early on mount; otherwise multi-open events are lost.
2) **Tab snapshot coverage**
   - Any new viewer state must be included in `TabSnapshot` to persist across tab switches.
3) **Selection highlight**
   - Uses DebugRenderer overlay with forced blend state; ensure it stays independent of material modes.

## Experience / Conclusions
- Snapshot swapping made multi-tabs possible without refactoring the full viewer pipeline.
- Sequential open is required; parallel file ingestion causes state races.
- Texture cache likely needs per-tab/renderer isolation to avoid cross-tab contamination.

## Optimization Ideas
- Introduce a dedicated renderer reset path for tab switches that currently cause texture ID mismatches.
- Consider staged texture prefetch per tab to reduce on-switch stalls.
- Hardlink-based copy should be the default when same volume; fallback to normal copy with progress.

## Suggested Message for Next AI
"I updated `PROJECT_STATUS.md` (2026-01-27). Current blockers: hot-start multi-open loops/black screens, tab switching causes missing local textures with MPQ-like prefixes, and hardlink copy path is unverified. Recent fixes include save-on-close prompt, bind-pose when no animation, and selection highlight as a pure-color overlay. Please read `PROJECT_STATUS.md`, then focus on stabilizing multi-tab hot-start + tab switch texture loading, and verify hardlink copy effectiveness."
