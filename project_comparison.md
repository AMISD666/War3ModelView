# War3ModelView - Project Status & Handover

## 1. Project Overview
**War3ModelView** is a Warcraft 3 model viewer and editor built with Tauri, React, and a custom `war3-model` rendering engine. It aims to replicate and enhance the functionality of the classic *War3ModelEditor*.

**Current Architecture:**
- **Frontend**: React + TypeScript.
- **Renderer**: Custom WebGL renderer (`war3-model` local package) integrated into `Viewer.tsx`.
- **State Management**: Zustand (`modelStore`, `selectionStore`).
- **File System**: Tauri APIs for file access and parsing.

## 2. Recent Progress
- **Native Renderer Integration**: Successfully integrated `war3-model`'s `ModelRenderer` for native rendering of MDX/MDL models.
- **Animation System**: Fixed animation playback, sequence handling, and global sequences.
- **Editor Features**:
  - **Gizmos**: Implemented Move/Rotate/Scale gizmos with coordinate space fixes.
  - **Node Hierarchy**: Initialized Node Tree with drag-and-drop (limited).
  - **Material/Geoset Editors**: Implemented modals for editing model data.
- **Optimization**: Implemented "Lightweight Sync" (`syncMaterials`) to update materials/textures without full renderer re-initialization (which causes stutter).

## 3. Current Critical Bug: "Material Disappearing"
**Symptom:**
When a user adds a new material and assigns it to a geoset, the entire model (or the specific geoset) disappears/becomes invisible.

**Diagnosis Steps Taken:**
1. **Initial Crash**: Originally caused by `TypeError` accessing `materialLayerTextureID` out of bounds.
   - **Fix**: Added `syncMaterials()` to rebuild internal caches.
2. **Invisible Model**: New material had default `TextureID: -1` or empty layers.
   - **Fix**: Updated `MaterialEditorModal` to default to `TextureID: 0` and add a default Layer.
3. **Persistent Disappearance**: Even with valid data, model disappears.
   - **Investigation**: 
     - Logs show new material uses defaults: `Unshaded: true`, `TwoSided: true`, `Alpha: 1`, `FilterMode: 0`.
     - **CRITICALLY**: The new material is assigned `TextureID: 1`. 
     - The model initially logs `Materials count: 1` (Index 0).
     - User adds one -> Index 1. 
     - `TextureID: 1` might be invalid if the model only has 1 texture (Index 0).
     - **Contradiction**: Added specific safety check `if (!this.model.Textures[textureID]) console.error(...)` in `modelRenderer.ts`, BUT user logs DO NOT show this error!
     - This implies `TextureID: 1` is technically "valid" (array index exists), yet rendering fails or produces invisible result.

**Hypothesis:**
- `TextureID: 1` exists but refers to an empty/unloaded texture?
- Or there is a race condition in `Viewer.tsx` where `renderer.model` is updated but `gl` context state (textures) is not fully ready?

## 4. Next Steps for Next AI
1. **Debug Texture Validity**: Verify EXACTLY what `renderer.model.Textures[1]` contains. Add deep logging in `modelRenderer.ts` to print `texture.Image`, `texture.Width`, `texture.Height` etc.
2. **Fix Default TextureID**: `MaterialEditorModal` seems to default to `TextureID: 1` (or user selected it). It should default to `0` (usually the main texture).
3. **Texture Manager**: Implement proper texture loading for *new* texture paths. Currently `Viewer.tsx` only syncs the array, it relies on `war3-model` to load them? (Check `loadTexture` logic).

## 5. Optimization & Future Plans
- **Texture Management**: The current "Lightweight Sync" handles arrays but lacks robust texture resource management (loading/unloading GPU textures on demand).
- **Undo/Redo System**: Essential for an editor. Needs to be implemented (likely with Zustand middleware).
- **Grid/Camera Fixes**: Revisit "Pivot Point" editing to ensuring visual edits match internal data exactly (Coordinate system nuances).

## 6. Handover Prompt
 Copy the following prompt to continue the session seamlessly:

> **Context**: You are continuing the debugging of the "Material Disappearing" bug in `War3ModelView`.
> **State**: 
> - `Viewer.tsx` uses "Lightweight Sync" for materials.
> - `modelRenderer.ts` has safety checks for `setLayerProps`.
> - **The Issue**: Adding a material (which gets `TextureID: 1`) causes the model to vanish. Logs show no explicit crash in `setLayerProps`.
> **Immediate Task**: 
> 1. Investigate why `TextureID: 1` is being used and if it points to a valid GPU texture.
> 2. Fix `MaterialEditorModal` to ensure safe default `TextureID` (0).
> 3. Verify `modelData.Textures` vs `rendererData.textures` synchronization.
> **Files to Focus**: `Viewer.tsx`, `modelRenderer.ts`, `MaterialEditorModal.tsx`.
