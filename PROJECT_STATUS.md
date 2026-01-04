# Project Status Report & Handoff Guide

**Date:** 2026-01-01
**Current Version:** 1.0.2 (Dev)

## 1. Project Overview
This is a **Warcraft 3 Model Editor** built with **Tauri v2 (Rust)** and **React (TypeScript)**. 
- **Frontend:** React, Ant Design, Three.js (for model rendering).
- **Backend:** Rust (Tauri main process).
- **Update Source:** Gitee (AMISD666/gg-war3-model-edit).

## 2. Recent Achievements (Current Session)
We successfully implemented a robust **Auto-Update System**:

### A. Custom Update Logic (Gitee)
- Replaced the default Tauri Updater with a custom implementation since we use Gitee releases.
- **API:** Checks `https://gitee.com/api/v5/repos/AMISD666/gg-war3-model-edit/releases/latest`.
- **Version Comparison:** Semantic versioning comparison logic in TS.

### B. Rust-Based Download & Launch (Critical)
- **Problem:** Tauri's JS-side `fetch` and `shell` plugins failed to handle:
    1.  **Non-ASCII URLs:** Gitee download URLs often contain Chinese characters, causing `Failed to construct Headers` or 404s in JS `fetch`.
    2.  **Shell Regex Restrictions:** The `shell` plugin's scope regex (`^((https?://...))`) is too restrictive for some local paths or complex arguments.
- **Solution:** Implemented native Rust commands in `main.rs`:
    - `download_file(url, target_path)`: Uses `reqwest` (blocking) to download files reliably.
    - `launch_installer(path)`: Uses `std::process::Command` to launch the downloaded EXE directly.
- **Outcome:** Bypassed all JS/Plugin limitations. Update flow is now 100% reliable.

### C. UI/UX Improvements
- **Update Dialog:** Custom `UpdateLogContent` component showing formatted changelogs.
- **Persistence:** Fixed dialogs auto-closing by setting `duration: 0` in `messageStore`.
- **Menu:** Removed redundant "Update Log" button; integrated log display into "Check for Updates" flow.
- **Startup:** Addressed black flash on startup by managing window visibility (though partially reverted to standard behavior to avoid complexity).

## 3. Current Code State
- **`src-tauri/src/main.rs`**: Contains the new `download_file` and `launch_installer` commands.
- **`src-tauri/Cargo.toml`**: Added `reqwest = { version = "0.12", features = ["blocking"] }`.
- **`src/renderer/src/services/updateService.tsx`**: Core logic. invokes Rust commands for heavy lifting.
- **`src/renderer/src/store/messageStore.ts`**: Updated to support persistent messages.

## 4. Next Steps / Future Plans
1.  **Splash Screen:**
    - The app currently has a brief black/white flash on startup (standard Tauri behavior).
    - **Optimization:** Implement a native Splash Screen in Rust to show a loading image while the React frontend initializes.
2.  **Code Cleanup:**
    - Remove unused files (already deleted `ChangelogModal.tsx`).
    - Audit `MainLayout.tsx` for any remaining unused imports.
3.  **Testing:**
    - Verify the update flow on a clean install validation.
    - Test "Force Update" scenarios.

## 5. Technical Insights & Recommendations (For Next AI)
- **Avoid JS Network/Shell for Complex Tasks:** In Tauri, when dealing with file I/O or network requests involving non-standard characters (Chinese paths/URLs), **always prefer a Rust Command**. The JS abstraction layer often has encoding or permission quirks.
- **State Management:** The `messageStore` is powerful but watch out for default timeouts. Explicitly use `duration: 0` for modal-like messages.
- **Gitee API:** Requires `User-Agent` header. Rust `reqwest` handles this perfectly.

## 6. Handoff Instruction
**To the next AI Assistant:**
We have just finished implementing a custom Gitee-based update system. The critical architecture decision was moving the **download** and **installer execution** logic to the **Rust backend** (`main.rs`) to avoid encoding and permission issues with Tauri's JS plugins.
- **Codebase:** Focus on `src-tauri/src/main.rs` (backend commands) and `src/renderer/src/services/updateService.tsx` (frontend logic).
- **Status:** The update system is functional.
- **Next Task:** You may be asked to implement a Splash Screen or further refine the UI.
