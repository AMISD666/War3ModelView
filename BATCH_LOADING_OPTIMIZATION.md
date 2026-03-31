# Batch Loading Optimization

## Goal
Build a root-cause batch-loading architecture that minimizes repeated disk I/O, repeated model parsing, repeated texture transport, and repeated worker initialization so batch mode stays extremely fast with large model sets.

## Principles
- No UI-only "feels faster" shortcuts.
- No cache-dependent correctness.
- No parameter guessing as the primary solution.
- Prefer one-time manifest generation and resource registration over repeated per-model work.
- Every optimization step must reduce actual work, not just defer it.

## Target Architecture
1. Rust scan phase returns a manifest, not just file paths.
2. Manifest includes per-model animation names and texture dependencies.
3. Frontend batch mode stops running metadata parsing workers for discovered models.
4. Texture loading is deduplicated by unique resource, not repeated by model.
5. Worker rendering uses registered resources/ids instead of repeatedly transferring large binary blobs.
6. Batch renderer follows a thumbnail-only fast path instead of reusing full viewer semantics where unnecessary.

## Work Plan

### Phase 1: Manifest Pipeline
- Status: `in-progress`
- Extract Rust-side shared model metadata parsing into one module.
- Expand scan payloads to include manifest rows.
- Replace frontend metadata worker dependency with manifest consumption.

### Phase 2: Resource Deduplication
- Status: `pending`
- Build Rust-side unique texture dependency groups.
- Load and decode each unique texture once.
- Replace per-model texture warm-up with manifest-driven shared resource registration.

### Phase 3: Worker Registration Model
- Status: `pending`
- Register model/texture resources once per worker pool lifecycle.
- Render requests send ids + frame/sequence only.
- Remove repeated large payload transfer during steady-state animation.

### Phase 4: Dedicated Batch Renderer
- Status: `pending`
- Separate thumbnail renderer assumptions from full editor/viewer renderer.
- Minimize state, shader branches, and setup cost for batch thumbnails.

## Progress Log

### 2026-03-30
- Created this tracking document in repo root.
- Confirmed current root bottlenecks:
  - Frontend still performs metadata extraction after model reads.
  - Texture warming is partially deduplicated but still model-driven.
  - Worker render path still transfers texture payloads repeatedly.
  - Rust model metadata parsing is duplicated across multiple files instead of centralized.
- Started Phase 1 by extracting Rust model metadata parsing into a shared module.
- Added `src-tauri/src/model_manifest.rs` with shared texture-path extraction and initial animation-name extraction support.
- Removed duplicate Rust texture-path parsing implementations from `copy_utils.rs` and `delete_utils.rs`.
- Registered the new shared module in `src-tauri/src/main.rs`.
- Verified the Rust slice with `cargo check`.
- Extended `scan_model_files_streamed` so the first-page binary payload now includes Rust-generated animation names and texture dependency lists per model.
- Extended the `batch-scan-complete` event payload to include full manifest rows for all discovered models.
- Updated `BatchManager.tsx` to ingest manifest rows immediately instead of waiting for worker-side metadata extraction.
- Updated `ThumbnailService.ts` with a manifest cache so model buffers loaded later can be hydrated with Rust manifest metadata before any JS/worker parse fallback runs.
- Added explicit manifest readiness tracking in `ThumbnailService.ts` so models with legitimately empty animation/texture lists are not misclassified as "metadata missing" and reparsed.
- Removed metadata-worker waiting from steady-state `prefetch()` and `renderFrameWithSharedState()` paths; missing manifest data now falls back directly to one local parse instead of async worker scheduling.
- Deleted the obsolete metadata-worker infrastructure from `ThumbnailService.ts` and removed the dead `METADATA` message branch from `thumbnail.worker.ts`.
- Switched batch texture warmup/loading to the Rust-side RGBA thumbnail decode path (`load_textures_batch_thumb_rgba`) so the worker can receive predecoded `ImageData` instead of always decoding raw texture bytes itself.
- Fixed the Rust RGBA BLP JPEG decode path to use the repo's Warcraft-aware `blp-rs` decoder instead of generic JPEG decoding, resolving the red/yellow-to-blue color shift bug introduced by the new RGBA route.
- Reverted the current steady-state batch texture loading path back to raw texture bytes for normal textures and explicitly excluded `ReplaceableTextures\\TeamColor` / `TeamGlow` from generic loading so team-color textures continue to use the dedicated replaceable-texture channel and bulk texture IPC size drops back down.
- Fixed a Rust manifest correctness gap where `ReplaceableId` textures were not being emitted as `ReplaceableTextures\\...` dependencies, which caused batch mode to miss team-color/team-glow injection for many models after the frontend switched to manifest-first metadata.
- Added a new Rust page-level IPC command, `load_batch_page_bundle`, that returns current-page model bytes, manifest metadata, and ordinary texture bytes in one binary response instead of separate model-read and texture-read IPC chains.
- Wired `BatchManager.tsx` current-page scheduling to call the new page bundle path first, then run worker preloading without repeating page texture warmup.
- Added `ThumbnailService.loadBatchPageBundle()` to ingest one page bundle directly into the model cache, manifest cache, texture cache, and shared texture cache.
- Fixed the half-reverted raw-texture path in `ThumbnailService.loadTextureImages()` so the ordinary texture loader again consistently stores binary texture bytes instead of trying to route them through the abandoned RGBA helper.
- Fixed a batch-side readiness bug where `ReplaceableTextures\\TeamColor` / `TeamGlow` were still being counted as ordinary texture-cache requirements; that bug forced repeated `loadTextureImages()` calls for team-color models and made both render latency and replaceable-texture stability worse.
- Removed the active shared-texture execution path from batch mode render preparation; the current pipeline no longer relies on shared texture cache hits or worker-to-worker shared texture sync to decide whether a model should resend textures.

## Current Status
- Batch thumbnail cache has already been removed.
- Every folder open now forces a full reload.
- Shared Rust metadata extraction module is now in place.
- Rust scan results now carry manifest data into the frontend.
- First-page and full-scan manifest metadata are injected into batch state and thumbnail service caches.
- `ThumbnailService` now distinguishes "manifest is complete but empty" from "manifest not ready", reducing unnecessary metadata fallback work.
- Steady-state batch prefetch/render no longer blocks on metadata-worker scheduling.
- The old metadata-worker path has now been removed from the batch thumbnail pipeline.
- Batch texture loading now prefers Rust-decoded RGBA payloads for worker upload.
- Rust-side RGBA decoding now preserves Warcraft BLP JPEG colors correctly.
- The active steady-state batch path now avoids IPC-heavy RGBA texture transfers and no longer treats team-color textures as ordinary texture assets.
- Rust manifest extraction now includes replaceable/team-color texture dependencies, which restores manifest-driven team-color injection for those models.
- BatchManager current-page loading now seeds caches through a single page-level bundle IPC before worker preload.
- The active page bundle path currently returns ordinary texture bytes, not RGBA, because the raw-byte route has lower IPC volume and better steady-state throughput in the current architecture.
- Team-color models now use ordinary-texture readiness checks that explicitly exclude replaceable team textures, so they no longer stay stuck in a perpetual "textures not ready" state.
- Batch mode is now constrained to per-model texture ownership in the active path, not shared texture registration.
- Next code step is to reduce page-bundle and per-model resend cost without introducing shared-texture registration or shared-texture cache semantics.

## Next Immediate Steps
1. Deduplicate page-bundle texture payloads by resolved source/resource instead of attaching per-model copies to the same IPC response.
2. Move current-page scheduling fully off `prefetch(..., withTextures)` and onto bundle-seeded preload/render preparation.
3. Remove remaining model-by-model texture warmup fallback once bundle coverage is stable for folder-open and page-switch flows.
4. Verify the new team-color manifest fix and single-page bundle path against real folders with large custom model sets.
