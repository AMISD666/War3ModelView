# Startup Optimization Plan

## Purpose

This document tracks startup-speed work for the main application window.
The rule for this track is: improve startup responsiveness without removing or changing any existing features.

## First-Principles Model

Startup latency is the sum of:

1. Window and webview creation cost
2. JS/CSS download, parse, and execute cost
3. Synchronous work before first visible frame
4. Heavy modules initialized even though the user cannot use them yet
5. Duplicate initialization work on the critical path

## Current Strategy

We optimize startup by changing load order, not by cutting functionality.

Design rules:

- Show a lightweight shell first.
- Mount the heavy workspace after the first frame.
- Keep hidden panels truly lazy.
- Move non-critical async work out of the first-paint path.
- Convert large static imports into on-demand imports where practical.
- Measure bundle boundaries after each phase.

## Phase 1: Main Window Critical Path Reduction

Goal:

- Make the main window visible faster and reduce the amount of code required before the first usable frame.

Tasks:

- [x] Lazy-load `MainLayoutNew` from `App.tsx`
- [x] Lazy-load `ActivationModal` from `App.tsx`
- [x] Render a lightweight shell before mounting the heavy workspace
- [x] Delay activation-status checking until after first paint
- [x] Lazy-load `MainLayout` from `MainLayoutNew.tsx`
- [x] Lazy-load `BatchManager` from `MainLayoutNew.tsx`
- [x] Lazy-load `NodeManagerWindow` from `MainLayoutNew.tsx`
- [x] Lazy-load `MpqBrowserPanel` from `MainLayoutNew.tsx`
- [x] Lazy-load `NodeDialog`, `CreateNodeDialog`, and `ViewSettingsWindow`
- [x] Move update-service loading out of the main startup chunk
- [x] Move model-optimization loading out of the main startup chunk
- [x] Move texture-decoder loading out of the main startup chunk
- [x] Move standalone warmup loading out of the main startup chunk

Acceptance:

- The main window shell appears before the full workspace finishes mounting.
- Hidden panels no longer load on initial startup.
- Non-critical background work no longer blocks the first visible frame.

## Phase 2: Viewer and Editor Deferral

Goal:

- Reduce work done before a model is actually needed.

Tasks:

- [x] Split `Viewer` out of `MainLayout` into a separate lazy chunk
- [x] Split `AnimationPanel` and `EditorPanel` out of `MainLayout` into separate lazy chunks
- [x] Lazy-load individual editors inside `EditorPanel`
- [x] Stop mounting hidden inline modals like `TextureAnimationManagerModal`, `SequenceEditorModal`, and `TransformModelDialog` until they are actually opened
- [ ] Audit whether `Viewer` can stay unmounted until a model/tab is active without harming open flow
- [ ] Confirm drag-and-drop open still feels immediate

## Phase 3: Startup Instrumentation

Goal:

- Replace subjective startup impressions with timing data.

Tasks:

- [ ] Add marks for app-entry, app-shell-visible, main-layout-mounted, viewer-mounted
- [ ] Add marks for first-model-opened and first-model-interactive
- [ ] Record first-start vs warm-start timings
- [ ] Add a temporary developer-facing viewer if needed

## Notes

Phase 1 implementation landed on 2026-03-08.
Observed build output after this phase:

- `App` is now split into its own small chunk.
- `MainLayoutNew` is split into its own chunk.
- `BatchManager`, `NodeManagerWindow`, `MpqBrowserPanel`, `ActivationModal`, `updateService`, `modelOptimization`, and `standaloneWarmup` all emit separate chunks.
- `MainLayout` was reduced from about 395 KB to about 134 KB after splitting `Viewer`, `AnimationPanel`, and `EditorPanel`.
- `Viewer` is now its own chunk at about 225 KB and no longer sits on the main startup path.
- The next candidate is runtime gating: deciding whether the viewer can stay unmounted until the first model/tab is active.
