# War3ModelView Project Status & Handoff

## Current Status (What works now)
1) Copy model with textures (clipboard CF_HDROP)
   - Backend command: `copy_model_with_textures` and CLI `--copy-model`
   - Texture paths resolved by model TEXS or MDL Image blocks
   - Supports local texture search by model dir + 3 parents, alt extensions
   - Temporary folder under `war3modelview_data/temp`
   - Clipboard uses CF_HDROP + Preferred DropEffect
2) Windows context menu
   - Open with GGWar3View: OK
   - Copy model (with textures): OK, supports multi-select
   - Delete model (with textures): OK, supports multi-select
3) Multi-select copy/delete CLI
   - Copy: `--copy-model "%1" %*` (registry)
   - Delete: `--delete-model "%1" %*` (registry)
   - MultiSelectModel=Player set for copy/delete keys
4) Delete logic improved
   - Batch delete uses texture usage counting to keep shared textures
5) MPQ copy toggle
   - Default OFF
   - If local texture missing and toggle ON, copy from MPQ
   - MPQ paths persisted to backend settings file
6) UI changes
   - File menu copy model + Shift+C
   - Per-mode vertex visibility (V key) in view/geometry/uv/animation/batch
   - Bone parameter panel: world/local translation toggle, default world

## Recent Changes (Key Files)
Backend (Rust):
- `src-tauri/src/main.rs`
  - Copy/delete CLI handling
  - Context menu register/unregister + MultiSelectModel
  - Settings commands: `set_mpq_paths`, `set_copy_mpq_textures`
- `src-tauri/src/copy_utils.rs`
  - Multi-model copy, texture search, cache
  - Optional MPQ fallback
  - Parallel model parsing and copy jobs
  - Hardlink attempt added (CreateHardLinkW), falls back to copy
- `src-tauri/src/delete_utils.rs`
  - Batch delete with shared texture counting
- `src-tauri/src/app_settings.rs`
  - Persist mpq paths + copy_mpq_textures toggle
- `src-tauri/Cargo.toml`
  - windows-sys feature Win32_Storage_FileSystem + Win32_Security

Frontend (React):
- `src/renderer/src/components/ViewSettingsWindow.tsx`
  - Toggles: copy/delete context menus, copy MPQ textures
- `src/renderer/src/components/MainLayout.tsx`
  - Sync mpq paths to backend
- `src/renderer/src/components/animation/BoneParameterPanel.tsx`
  - World/local translation toggle
- `src/renderer/src/components/MainLayout.tsx`
  - V key per-mode toggle
- `src/renderer/src/store/rendererStore.ts`
  - showVerticesByMode + per-mode setters
- `src/renderer/src/components/Viewer.tsx`
  - uses showVerticesByMode

## Known Issues
1) Copy performance still slow
   - Single model copy still ~2s; 80+ models ~8-9s
   - Hardlink should reduce cost but not confirmed in build/test yet
2) Copy multi-select reliability
   - Works, but relies on `%1 %*` registry and CLI parsing
3) Virtual clipboard (delayed data)
   - NOT implemented (user requested, then reverted)

## Performance Optimizations Done
- Parallel model parsing
- Parallel copy jobs
- Texture resolve cache
- Optional MPQ lazy-load
- For single model, skip expensive directory index scan

## Next Steps (Priority)
1) Verify hardlink path
   - Confirm CreateHardLinkW compiles after adding Win32_Security
   - If hardlink works, single model copy should be near-instant
2) Add directory index cache for multi-model
   - (Already added, but validate real-world impact)
3) Optional: Virtual clipboard (delayed file provider)
   - Requires process alive until paste
   - More complex (IDataObject/CFSTR_FILEDESCRIPTOR)

## Handoff Notes / Gotchas
1) Right-click copy command must be:
   - `"war3-model-editor.exe" --copy-model "%1" %*`
   - MultiSelectModel=Player under:
     - `HKCU\Software\Classes\SystemFileAssociations\.mdx\shell\GGWar3ViewCopy`
     - `HKCU\Software\Classes\SystemFileAssociations\.mdl\shell\GGWar3ViewCopy`
2) MPQ copy toggle lives in `app_settings.json` under app storage root
3) If copy_log shows `paths=[]`, registry command is wrong or args parsing failed
4) Copy temp root: `war3modelview_data/temp`

## Experience / Conclusions
- The biggest copy cost is file I/O, not model parsing
- Windows Explorer waits on context menu process unless separated; user rejected background start
- Hardlink is best fast path if same disk
- MPQ fallback should be optional, local files first

## Suggested Message for Next AI (Copy/Paste)
“Please continue from PROJECT_STATUS.md. Current blockers: copy performance is still slow (single model ~2s, multi-model ~8-9s). Hardlink path added via CreateHardLinkW but not verified. Context menu copy/delete uses MultiSelectModel=Player and command `--copy-model "%1" %*` / `--delete-model "%1" %*`. MPQ copy toggle exists in settings and backend app_settings.json. Focus on verifying hardlink effectiveness or implementing delayed clipboard if needed.”

*Last update: 2026-01-13*
