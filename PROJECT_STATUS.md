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
   - Animation panel shows sequence indices; panel width reduced.
5) **Shortcut System**
   - Centralized shortcut registry + manager + persistent store.
   - Settings tab: “快捷键” with conflict handling.
6) **Particle Emitter 2 Support (Partial)**
   - Fixed "Head" flag persistence (written as `-1` in MDX to represent unchecked).
   - Fixed MDL generator syntax for unchecked flags.
   - Fixed missing texture reporting for emitters.

## Recent Changes (Key Files)
- `src/renderer/src/store/modelStore.ts`
  - **Exhaustive Node Synchronization**: `updateModelDataWithNodes` now handles ALL MDX node types (including Reforged Popcorn emitters) to prevent index shifts.
  - Fixed logic for clearing/reassigning ObjectIds to maintain hierarchy integrity.
- `src/renderer/src/types/node.ts` & `model.ts`
  - Added `PARTICLE_EMITTER_POPCORN` support across all interfaces.
- `src/renderer/src/components/MainLayout.tsx`
  - Removed redundant/conflicting flag overrides in save functions.
  - Centralized all data preparation in `prepareModelDataForSave`.
- `war3-model-4.0.0/mdx/generate.ts` & `mdl/generate.ts`
  - Optimizations for "Neither" (Head & Tail unchecked) flag state.

## Known Issues / Blockers (CRITICAL)
1) **Particle Coordinate Misalignment (Bug 13)**
   - **Symptom**: Modified particle emitters appear correctly only at [0,0,0]. If the model moves, particles move in the OPPOSITE direction.
   - **Status**: Node index synchronization is fixed (no more lossy reordering), but the coordinate inheritance is likely broken.
   - **Suspicion**: When saving, some transformation data or "DontInherit" flags might be corrupted, or the `ModelSpace` flag is interacting poorly with the reordered hierarchy.
2) **Multi-model hot-start / multi-open loop**
   - Hot-start multi-open can black-screen or loop reload.
3) **Texture load failures on tab switch**
   - Local textures with MPQ-like prefixes failing after switching tabs.

## Next Steps (Priority)
1) **Deep Debug Particle Coordinates**
   - Compare `SX-yumo2.mdx` (Original) vs `033.mdx` (Corrupted) binary `PRE2` chunks.
   - Check if `PivotPoints` or `Translation` 애니메이션 keys were shifted or wiped during reordering.
   - Investigate why translation seems "inverted" relative to model root.
2) **Stabilize multi-tab hot-start**
   - Fix infinite reload loop.

## Handoff Notes / Gotchas
- **Node Reordering**: The application forces a specific node type order (Bones -> Lights -> ...) to satisfy some engines. This reordering MUST update all parent references and Geoset skinning indices.
- **Popcorn Particles**: These Reforged nodes are now supported in the reordering logic but have no UI editor yet.

## Suggested Message for Next AI
"我已更新 `PROJECT_STATUS.md`（2026-01-27）。当前最紧急的 Bug 是：模型修改粒子保存后，粒子在游戏中位移异常（仅在 0,0,0 点正常，模型移动时粒子反向移动）。我已修复了节点重新排序（Node Reordering）的同步问题（不再丢失爆米花粒子等节点），但坐标系似乎仍有问题。请先阅读 `PROJECT_STATUS.md` 中的 **Bug 13** 详情，重点排查保存过程中的 `PivotPoints`、`Translation` 动画数据以及 `ModelSpace` 标志位的处理逻辑。"

