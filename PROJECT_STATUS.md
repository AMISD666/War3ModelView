# War3ModelView Project Status & Handoff

## Current Status (What works now)
1) **Multi-Tab Model Viewer (New)**
   - Single-instance enforcement: subsequent launches focus the main window and open files as new tabs.
   - Tabs handle their own state via snapshotting (`modelData`, `cameraState`, `sequences`, `nodes`, etc.).
   - UI: A clean tab bar at the top for switching items.
   - Shortcut: `Ctrl+W` to close the currently active tab.
2) Copy model with textures (clipboard CF_HDROP)
   - `copy_model_with_textures` command and CLI `--copy-model` support single/multi invocation
   - Texture paths resolved from MDX TEXS or MDL Image blocks, scanning local folders with alt extensions
   - Cache lives under `%LOCALAPPDATA%\War3ModelView\war3modelview_data\temp` and auto-cleanup runs at startup/exit
3) Windows context menu
   - GGWar3View/War3ModelView shows under `.mdx`/`.mdl`
   - Opening multiple files (select 3, right-click, open) works in both cold-start and hot-start scenarios.
4) Storage migration
   - All settings saved under `%LOCALAPPDATA%\War3ModelView\war3modelview_data`
5) MPQ copy toggle
   - Pulls missing textures from MPQs when enabled.
6) UI and keyboard shortcuts
   - `Shift+C` copies model; `V` toggles vertex/node visibility; `Ctrl+W` closes tab.
   - Viewer camera dropdown has a Copy button for `X,Y,Z` coordinates.

## Recent Changes (Key Files)
Backend (Rust):
- `src-tauri/src/main.rs`
  - Added `tauri-plugin-single-instance` with window restore logic (`unminimize`, `show`, `set_focus`).
  - Added `PENDING_FILES` static buffer and `get_pending_open_files` to prevent event loss during startup.
  - Added `get_cli_file_paths` (plural) to return all model files from CLI args.
- `src-tauri/Cargo.toml`: Added `tauri-plugin-single-instance` and `once_cell`.

Frontend (React):
- `src/renderer/src/store/modelStore.ts`
  - Refactored to support `tabs: Tab[]` and snapshot swapping logic.
  - Added duplicate detection: switching to existing tab instead of re-opening.
- `src/renderer/src/components/TabBar.tsx`: New component for tab management.
- `src/renderer/src/components/MainLayoutNew.tsx`: Integrated `TabBar` and `open-files` event listener.
- `src/renderer/src/components/MainLayout.tsx`
  - Removed legacy `window.location.reload()` hacks.
  - Updated CLI handler to combine command-line args and the Rust pending buffer.
  - Fixed React Hook violation (moved `useRef` out of `useEffect`).

## Known Issues
1) Copy performance still slow
   - Single-model copies ~2s; 80+ models still ~8-9s.
   - Hardlink path is added but needs real-world verification.
2) Polygon animation colors
   - Parser no longer swaps RGB, but needs validation against reference models.

## Performance Optimizations Done
- Multi-file processed sequentially with 100ms delay to prevent state race conditions.
- Rust-side event buffering to ensure multi-file opens are not lost if the app is still loading.
- Debug logging gated by console visibility to avoid IPC overhead.

## Next Steps (Priority)
1) **Verify Multi-Tab Stability**: Test edge cases like closing the last tab or opening models with very long paths/names.
2) **Verify Hardlink Path**: Test `CreateHardLinkW` on typical volumes.
3) **Validate Geoset Animation Colors**: Compare static/dynamic color keys with other tools.
4) **Monitor Copy Performance**: Ensure `debug_log` gating actually improves paste speed in production.

## Handoff Notes / Gotchas
1) **Single-Instance**: The Rust plugin handles the focus, but the frontend must call `get_pending_open_files` on mount to catch files that arrive while React is initializing.
2) **Tab Snapshotting**: When adding features that have global state (e.g., new visibility toggles), ensure they are included in `TabSnapshot` so they persist during tab switches.
3) **Ctrl+W**: Wired in `MainLayout.tsx`, uses `e.ctrlKey` to avoid conflict with the single `W` key.

## Experience / Conclusions
- The "Snapshot Swapping" approach allowed us to implement multi-tabs with minimal changes to the complex `Viewer` component.
- Sequential tab loading (with `setTimeout`) is crucial for stable state updates in Zustand when multiple files arrive simultaneously.
- Rust buffering is the only reliable way to handle multi-file context menu opens on a "cold start".

## Suggested Message for Next AI
"I have implemented the multi-tab model viewing feature and enforced a single-instance application behavior. The app now handles multi-file opens from Windows Explorer (cold and hot start) correctly using a Rust-side buffer and tab snapshotting. Please review `PROJECT_STATUS.md` for the technical details. Your primary tasks are to verify the stability of the new tab system, then move back to the priorities noted: verifying the hardlink copy path and validating geoset animation colors."
*Last update: 2026-01-14*
