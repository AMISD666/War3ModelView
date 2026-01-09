# Project Status Report & Handoff Guide

Date: 2026-01-09
Current Version: unknown (dev)

## 1) Project Overview
War3ModelView is a Warcraft 3 model viewer/editor built with Tauri v2 (Rust) + React/TypeScript. It parses MDX/MDL, loads MPQ textures, previews models, and edits model data (sequences, particles, materials, etc.).

## 2) Current Progress (Latest Work)
- MPQ texture loading fixes: normalized model path, correct MPQ vs local texture resolution, fixed toast name mismatch, and TeamColor preload timing with delayed MPQ initialization.
- Rendering fixes: adjusted layer sorting and blend order to match WC3 (Blend vs Additive/AddAlpha), fixed additive blend state, and corrected unshaded handling. Note: changes were made under node_modules/war3-model.
- Viewer robustness: models without sequences/nodes can render, fallback sequences added, sequence index guard, and buffer init guarded for zero-node models.
- Batch preview camera adjustments and rotation tweaks in thumbnail worker.
- Particle editor improvements: color picker + RGB input with copy/paste, initial color binding, and dynamic parameter save fixes.
- Sequence manager: new sequence default frames use lastEnd + offsets (1000/2333), and sequence rename/new does not hard reload (light reload behavior).
- Death animation tool (Batch mode):
  - Adds or updates a Death sequence.
  - Adds visibility + emission rate keys at deathStart/deathEnd, and keeps base animation frames when no dynamic data existed.
  - Removes GlobalSequence/LineType influence (forces GlobalSeqId = null, LineType = 0) in new anim vectors.
  - New toolbar row in batch mode with two buttons: current model vs all models.

## 3) Current Issues / Checks
- Verify GlobalSequence dropdown shows (None) after running the new death animation tool (especially for emission rate/visibility). The tool now writes GlobalSeqId = null and LineType = 0, but check UI behavior in KeyframeEditor.
- BatchManager still had some text encoding issues earlier; now fixed for new strings, but watch for mojibake in other files.
- node_modules/war3-model was patched directly; this is fragile and may be overwritten by npm install.

## 4) Next Steps / Plan
1) Confirm batch-mode toolbar layout and spacing: preview grid should be pushed down with a reserved tools row.
2) Validate death animation keys in these scenarios:
   - No prior dynamic data (expect base frames + deathStart/deathEnd = 0, GlobalSeqId = null).
   - Existing dynamic data (trim keys after deathStart; add deathStart/deathEnd = 0).
3) Move node_modules rendering fixes into a proper patch strategy (fork or patch-package).
4) Audit remaining UI strings for encoding issues; fix if any garbled text remains.

## 5) Files Touched / Hotspots
- Batch death animation + toolbar: src/renderer/src/components/batch/BatchManager.tsx
- MPQ / texture load: src/renderer/src/components/viewer/textureLoader.ts
- TeamColor preload vs delayed MPQ load: src/renderer/src/components/batch/ThumbnailService.ts, src/renderer/src/components/MainLayout.tsx
- Rendering order/blend: node_modules/war3-model/modelRenderer.ts (and related renderer files)
- Keyframe editor global sequence default: src/renderer/src/components/editors/KeyframeEditor.tsx
- Global sequence duration mapping: src/renderer/src/components/node/ParticleEmitter2Dialog.tsx, src/renderer/src/components/node/LightDialog.tsx
- Batch camera changes: src/renderer/src/components/batch/thumbnail.worker.ts

## 6) Experience / Conclusions
- MPQ priority resolution: always attempt MPQ first for standard Warcraft prefixes, then fallback to local path.
- Death animation edits must preserve base frames if animation data did not exist, and must not attach GlobalSeqId or LineType unless explicitly set.
- Renderer behavior differs subtly across blend modes; sorting order matters more than state changes.
- Direct edits in node_modules are risky; prefer a maintained fork or patch-package.

## 7) Optimization Ideas
- Add a batch operation queue UI with progress and per-file error details.
- Cache MPQ texture reads across viewer + batch thumbnails to avoid duplicate decode/upload.
- Consolidate anim-vector utilities (build/update/strip global seq) into a shared helper to avoid divergence.
- Add a small ¡°batch tools¡± row component for future actions (rename, re-sequence, texture relink, etc.).

## 8) Handoff Notes (for next AI)
- The batch death animation tool is the most recent and sensitive area. The logic lives in BatchManager.tsx and now supports both single-file and all-files operations.
- If GlobalSequence is still appearing, inspect KeyframeEditor initialData handling and the anim-vector GlobalSeqId values written into MDX/MDL.
- There are prior rendering changes in node_modules/war3-model; these must be preserved or migrated.

## 9) Suggested Handoff Message (copy/paste)
Use this to brief the next AI:

"Read PROJECT_STATUS.md first. Current focus is batch-mode death animation tool in src/renderer/src/components/batch/BatchManager.tsx. Verify GlobalSequence is None after running the tool and that keys include base animation frames + deathStart/deathEnd = 0. There are renderer blend-order fixes in node_modules/war3-model that should be ported to a patch strategy. Also confirm batch toolbar layout and check for any remaining mojibake in UI strings."
