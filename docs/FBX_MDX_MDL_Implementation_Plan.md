# FBX to MDX/MDL Implementation Plan

Last updated: 2026-05-05

## Current Implementation Snapshot

The first implementation slice is now in place:

- `ufbx` is vendored under `vendor/ufbx` and compiled by the Tauri build.
- Native commands expose FBX probing and static scene import.
- The renderer can route `.fbx` paths through `FbxImportUseCase` instead of the MDX/MDL worker parser.
- Static meshes are triangulated into renderable geosets.
- Native DTOs now include FBX textures, materials, material slots, mesh-local material slots, and global material indices.
- The TypeScript mapper builds War3 `Textures`, `Materials`, and `Geosets` in that order so multi-mesh slot `0` materials do not collapse into one material.
- Static FBX geosets now bind to a real synthetic `Imported_Root` helper with `ObjectId = 0`, `PivotPoints[0]`, `Groups: [[0]]`, and `TotalGroupsCount: 1`, so save validation and reopen do not rely on a missing matrix node.
- Native static import now traverses mesh node instances rather than only `scene->meshes`, applying per-node `geometry_to_world` transforms and per-instance material overrides before writing the static DTO.
- Native/Rust static scene DTOs now include FBX `nodes` and `bones`.
- The TypeScript import mapper now builds War3 `Bones`, `Helpers`, `Nodes`, and `PivotPoints` from FBX nodes, so Node Manager can display the imported FBX hierarchy instead of only `Imported_Root`.
- Static geosets bind to the imported helper/bone object id chosen by the node mapper, not a hard-coded missing matrix id.
- Native DTOs now include per-expanded-vertex FBX source weights for skinned meshes, capped at four influences per vertex.
- Skinned mesh vertices are emitted in bind-pose model space using the mesh node `geometry_to_world`, matching the classic renderer's expectation that node matrices are bind-pose deltas applied directly to geoset vertices. Non-skinned static/instanced meshes use the same world-space bake.
- The TypeScript geoset mapper now converts FBX source weights into classic War3 `Groups` and `VertexGroup` data. Imported FBX output stays `FormatVersion: 800`; the converter does not emit version 900/1000 `SkinWeights`. Since classic matrix groups have no numeric weights, highly dominant FBX weights are collapsed to one bone and multi-bone groups are pruned toward roughly equal influences.
- FBX animation stack bake now appends each stack's node TRS keys into shared War3 node tracks instead of overwriting the previous stack. Native DTOs carry each node's full rest/bind world matrix, and baked FBX local transforms are converted through matrix bind-pose deltas (`animatedWorld * inverse(bindWorld)`) before being decomposed back to War3 pivot-local TRS. Sequence intervals remain non-overlapping, and default playback starts at the chosen sequence's `Interval[0]`.
- Imported FBX `ModelData` is finally baked through a 90 degree rotation around the Warcraft III Z axis. This final orientation step transforms geoset vertices/normals, node pivot points, node translation/rotation tracks, model/geoset/sequence extents, and then saves in the normal classic 800 document path.
- Realtime preview still has a defensive projection that strips `Geoset.SkinWeights` if an externally opened model contains them, but FBX import no longer creates that field.
- `src-tauri/src/fbx_import.rs` was split into `src-tauri/src/fbx_import/mod.rs`, `types.rs`, `native.rs`, `convert.rs`, and `tests.rs`; skin-weight C helpers live in `ufbx_skin_weights.c/.h`.
- Regular Save is blocked for `.fbx` source paths; users should Save As/Export to `.mdx` or `.mdl`.
- A Rust smoke test entry exists behind `FBX_STATIC_FIXTURE`, and the repo now includes small ufbx official fixtures under `testmodel/fbx`.

Still pending:

- App-level open/render/export/reopen visual validation for the checked-in fixtures.
- Save/reopen/reference-viewer validation for skinned and animated FBX output.
- Classic matrix-group deformation validation against Warcraft III or a trusted reference viewer.
- Mesh locality and bind-pose validation after save/reopen to confirm imported skinning groups animate in classic format.
- Embedded texture extraction and image format conversion.

## Goal

Add FBX import support to War3ModelView and allow imported FBX models, including skeletal animation, to be saved as Warcraft III `mdx` or `mdl` through the existing save/export pipeline.

The product goal is "as perfect as the Warcraft III format allows". FBX is a general DCC interchange format, while MDX/MDL is a Warcraft III runtime format with stricter limits and different material/animation semantics. Therefore this plan defines perfection as:

1. Static mesh geometry, UVs, normals, materials, texture references, skeleton hierarchy, skinning groups, and animation clips are preserved when they have a valid Warcraft III representation.
2. Unsupported FBX features are baked, simplified, or reported before save instead of silently producing broken MDX/MDL.
3. The generated MDX/MDL reopens in War3ModelView, survives save/reopen, and renders in Warcraft III or a trusted reference viewer as closely as possible.

## Current Project Constraints

Follow `AGENTS.md` for all code changes.

- New platform/file/native work must stay in Tauri/Rust or infrastructure gateways.
- UI components must not directly call `@tauri-apps/*`, raw platform APIs, or `war3-model`.
- UI components must not directly mutate Document State.
- Imported FBX data must enter the app as durable Document State through an application use case or command path, not as a preview overlay.
- MDX/MDL output must reuse `SaveModelUseCase`, `prepareModelDataForSave`, `DocumentReferenceRepairer`, `DocumentReferenceValidator`, and `modelSerializationGateway.serialize()`.
- Run `npm run typecheck` when touching shared state, save/export, window communication, or build config.
- Keep new source files within the repo file-size limits and extend `npm run check:architecture` if new boundaries need guardrails.

Relevant existing files:

- `src/renderer/src/application/model-open/OpenModelWorkflow.ts`
- `src/renderer/src/application/model-save/SaveModelUseCase.ts`
- `src/renderer/src/infrastructure/serialization/ModelSerializationGateway.ts`
- `src/renderer/src/infrastructure/serialization/war3ModelSerializationGateway.ts`
- `src/renderer/src/application/model-save/prepareModelDataForSave.ts`
- `src/renderer/src/application/model-validation/DocumentReferenceValidator.ts`
- `src/renderer/src/application/model-validation/DocumentReferenceRepairer.ts`
- `src-tauri/src/main.rs`
- `scripts/check-architecture-guardrails.mjs`

## Library Decision

Use `ufbx` as the primary FBX reader/conversion core.

Why:

- `ufbx` is a single-source C FBX loader, so it can be vendored under `vendor/ufbx` and compiled into the existing Tauri Rust binary with a small `cc` build step.
- It supports binary and ASCII FBX files, mesh skinning, blend shapes, cameras/lights, embedded textures, triangulation, animation curve evaluation/layer blending, CPU skinning evaluation, and progress/cancellation helpers.
- Its repository documents fuzzing, large public/private datasets, and CI coverage across Windows, macOS, Linux, and WASI.
- Its license choice is MIT or public domain, which is simple for desktop distribution.

Reference: https://github.com/ufbx/ufbx

Use `assimp` only as an optional external validation oracle or emergency fallback prototype.

Why not as the primary runtime dependency:

- Assimp is powerful and imports many 3D formats, but it is a large C++ dependency with a heavier build/distribution footprint than the current app needs.
- It can be useful for comparing parsed scene counts, animation ranges, or triangulated geometry during test fixture development.

Reference: https://github.com/assimp/assimp

Do not build the primary path on `FBX2glTF`.

Why:

- It converts FBX to glTF and demonstrates practical animation baking, but it depends on Autodesk FBX SDK 2019.2 and is designed as a CLI tool, not a lightweight in-app parser.
- It is useful as a conceptual reference for animation baking trade-offs.

Reference: https://github.com/facebookincubator/FBX2glTF

Do not use `fbxcel` for the first implementation.

Why:

- It is Rust-native, but it is intentionally low-level, supports only binary FBX, and does not interpret complete renderable/animatable scenes by itself.
- Choosing it would shift too much FBX semantic interpretation work into this project.

Reference: https://github.com/lo48576/fbxcel

## Target Architecture

Add FBX support as an import/translation pipeline:

```text
FBX file
  -> native FBX parser/converter in Tauri/Rust using ufbx
  -> typed FBX intermediate DTO
  -> TypeScript application import use case
  -> War3 ModelData document
  -> existing viewer/document state
  -> existing SaveModelUseCase
  -> existing MDX/MDL serialization
```

Do not teach the existing `war3-model` serialization gateway to parse FBX directly. Its responsibility remains MDX/MDL parse and MDX/MDL serialization.

### Proposed New Native Files

- `vendor/ufbx/ufbx.c`
- `vendor/ufbx/ufbx.h`
- `src-tauri/src/fbx_import/mod.rs`
- `src-tauri/src/fbx_import/types.rs`
- `src-tauri/src/fbx_import/load.rs`
- `src-tauri/src/fbx_import/convert.rs`
- `src-tauri/src/fbx_import/diagnostics.rs`

### Proposed New Renderer/Application Files

- `src/renderer/src/types/fbxImport.ts`
- `src/renderer/src/infrastructure/fbx/FbxImportGateway.ts`
- `src/renderer/src/infrastructure/fbx/tauriFbxImportGateway.ts`
- `src/renderer/src/infrastructure/fbx/index.ts`
- `src/renderer/src/application/model-import/FbxImportUseCase.ts`
- `src/renderer/src/application/model-import/FbxToWar3ModelMapper.ts`
- `src/renderer/src/application/model-import/FbxImportDiagnostics.ts`
- `src/renderer/src/application/model-import/index.ts`

### Proposed Scripts and Fixtures

- `scripts/check-fbx-import-fixtures.mjs`
- `testmodel/fbx/README.md`
- `testmodel/fbx/static_mesh/`
- `testmodel/fbx/skinned_idle_walk/`
- `testmodel/fbx/multi_material/`
- `testmodel/fbx/axis_unit_scale/`

If real FBX fixtures are too large for Git, keep a small documented fixture set outside Git and make the script accept `FBX_FIXTURE_DIR`.

Current checked-in fixture set:

| Path | Purpose |
| --- | --- |
| `testmodel/fbx/static_mesh/blender_272_cube_7400_binary.fbx` | Minimal static geometry smoke fixture |
| `testmodel/fbx/static_mesh/max2009_cube_texture_5800_binary.fbx` | Static mesh with texture/material metadata |
| `testmodel/fbx/static_multimaterial/blender_suzanne_multimaterial_7400_binary.fbx` | Material-part splitting baseline: one FBX mesh should produce seven material geoset DTOs |
| `testmodel/fbx/instancing/blender_293_instancing_7400_binary.fbx` | Node instance traversal baseline: one FBX mesh should produce eight transformed mesh DTOs |
| `testmodel/fbx/skinning/blender_293_half_skinned_7400_binary.fbx` | Skeleton/skinning DTO target fixture |
| `testmodel/fbx/animation/maya_anim_linear_7700_ascii.fbx` | Near-one-second transform animation baking target fixture |

## Data Flow Details

### Opening FBX

1. Extend open dialog filters in `OpenModelWorkflow.ts` from `mdx/mdl/blp/tga` to include `fbx`.
2. Extend the model-file extension set to include `fbx`.
3. Keep the actual file read and native import behind `FbxImportGateway`.
4. For `.fbx`, route `openModelAsTab()` through `FbxImportUseCase.importFromPath()`.
5. `FbxImportUseCase` returns `ModelData` plus diagnostics.
6. Commit imported `ModelData` using the same loaded-model path as MDX/MDL, with a clear original source path and dirty state behavior.

Recommended path behavior:

- The active document path may remain the original `.fbx` for recent-file/open-history display.
- Save should prompt for `.mdx` or `.mdl` because FBX writeback is not supported.
- A converted document should be marked dirty immediately because its durable save target is not the FBX source.

### Saving Imported FBX as MDX/MDL

No separate FBX save path is needed.

1. Once imported, the app owns a normal `ModelData` document.
2. Save/export calls `SaveModelUseCase.prepareModelForSave()`.
3. Validation and repair run through existing save preparation.
4. `modelSerializationGateway.serialize(preparedData, 'mdx' | 'mdl')` writes the output.

Do not add a shortcut that serializes the FBX intermediate DTO directly to MDX/MDL; that would bypass existing repair, validation, texture handling, global color adjustments, strict MDX rules, and future save guardrails.

## Feature Scope

### Phase 1: Static FBX Import

Goal:

- Open FBX files with static meshes and save them as valid MDX/MDL.

Required support:

- Binary and ASCII FBX loading through `ufbx`.
- Scene axis/unit normalization into Warcraft III coordinate conventions.
- Mesh triangulation.
- Vertex positions.
- Normals, generated when missing.
- UV set 0.
- Basic material slots.
- External texture path extraction.
- One geoset per material partition or per source mesh/material pair.
- Default material/texture fallback when material data is incomplete.
- Model extents, sequence-less document state, pivot points.

Acceptance:

- Static FBX fixture opens in War3ModelView.
- Geometry appears with correct orientation and scale.
- MDX save reopens without parse errors.
- MDL save reopens without parse errors.
- `npm run typecheck`
- `npm run check:architecture`
- `set FBX_FIXTURE_DIR=D:\path\to\fbx-fixtures && node scripts/check-fbx-import-fixtures.mjs`

### Phase 2: Skeleton and Skinning

Goal:

- Convert skinned FBX meshes into Warcraft III bones, pivots, geoset groups, and matrix groups.

Required support:

- FBX node hierarchy to Warcraft III `Helpers` and `Bones`.
- Stable `ObjectId` assignment.
- Parent relationship preservation.
- Bind pose/inverse bind matrix handling.
- Up to Warcraft III compatible bone influences per vertex, with deterministic pruning and diagnostics when source influence count exceeds target support.
- Geoset vertex groups and matrix group generation.
- Bone pivots and default transforms.
- Extents computed per geoset and model.

Acceptance:

- Skinned FBX fixture opens in bind pose.
- Bone hierarchy appears in Node Manager.
- MDX/MDL round-trip preserves bones and geoset matrix groups.
- Reference animation still deforms correctly after save/reopen.

### Phase 3: Animation Import

Goal:

- Convert FBX animation stacks/layers into Warcraft III sequences and node tracks.

Required support:

- FBX animation stacks to `Sequences`.
- Animation time conversion to milliseconds.
- Per-node local translation, rotation, and scaling tracks.
- Quaternion rotation track generation.
- Frame-rate controlled baking mode for constraints/layers and unsupported curve semantics.
- Optional curve-preserving mode only where it is proven compatible.
- Sequence intervals with non-overlapping global timeline layout.
- Default sequence selection after import.
- Animation extents recomputation.

Recommended first implementation:

- Bake each FBX animation stack at a configurable sample rate, default `30 fps`.
- Use `Linear` interpolation for baked tracks.
- Drop redundant keys with an epsilon-based simplifier.
- Keep a diagnostics entry for every compressed track and every track that was forced to bake.

Why bake first:

- FBX animation can combine layers, pivots, pre/post rotations, constraints, and curve tangents that do not map directly to MDX/MDL.
- Baked local transforms are larger but much more predictable.
- FBX2glTF uses a similar bake-first strategy for animation reliability, while noting that it can increase file size.

Acceptance:

- At least one FBX fixture with `Stand` and `Walk` or equivalent clips imports as separate Warcraft III sequences.
- Playback starts on a valid sequence.
- MDX/MDL save/reopen keeps the sequences and keyframes.
- A trusted reference viewer or Warcraft III test confirms the exported model animates.

### Phase 4: Materials, Textures, and Asset Handling

Goal:

- Preserve common FBX material/texture information in Warcraft III-compatible form.

Required support:

- Diffuse/base-color texture path extraction.
- Basic color and alpha mapping.
- Material slots to Warcraft III `Materials`.
- Texture path normalization to Warcraft III relative path strings where possible.
- Embedded texture extraction to sibling files only through an explicit import option.
- Missing texture diagnostics.

Out of initial scope:

- Full PBR conversion.
- Procedural textures.
- Multi-UV material networks.
- Shader graphs.

Fallback:

- Generate a visible default material instead of invisible geometry.
- Add diagnostics explaining what was simplified.

### Phase 5: UI and Workflow Polish

Goal:

- Make FBX import usable without adding a large new panel.

Recommended UI:

- Existing open/import entry points accept `.fbx`.
- On import with diagnostics, show a compact result dialog listing warnings and the chosen conversion settings.
- Add import settings only when needed:
  - scale factor
  - axis preset
  - animation sample rate
  - texture path mode
  - maximum bone influences
  - extract embedded textures

Do not add a separate FBX editor. Once converted, the model should use existing editor surfaces.

### Phase 6: Batch/CLI and Regression Safety

Goal:

- Make future changes testable and repeatable.

Add:

- `scripts/check-fbx-import-fixtures.mjs`
- A fixture manifest with expected counts:
  - geosets
  - materials
  - textures
  - bones/helpers
  - sequences
  - keyframe count ranges
  - warning count
- Optional CLI-only Tauri command or Node harness for import smoke tests.
- Golden MDL text snippets for stable small fixtures where appropriate.

## Diagnostics Contract

Every FBX import returns:

```ts
export interface FbxImportResult {
    modelData: ModelData
    diagnostics: FbxImportDiagnostic[]
    source: {
        path: string
        formatVersion?: string
        unitScale?: number
        axisSystem?: string
    }
    conversion: {
        sampleRate: number
        scaleFactor: number
        maxInfluencesPerVertex: number
        bakedAnimations: boolean
    }
}
```

Diagnostic severity:

- `info`: expected simplification, such as generated normals.
- `warning`: visible or data-affecting simplification, such as pruned bone weights.
- `error`: import cannot produce a valid document.

Required diagnostic categories:

- `unsupported-feature`
- `geometry`
- `material`
- `texture`
- `skeleton`
- `animation`
- `war3-limit`
- `save-readiness`

No silent loss:

- If a source FBX feature is ignored, baked, simplified, truncated, or replaced, it must produce a diagnostic.

## Warcraft III Compatibility Rules

The converter must prefer Warcraft III runtime compatibility over generic editor compatibility.

Rules:

- FBX import targets classic Warcraft III `FormatVersion: 800` output only. Do not promote imported FBX documents to version 900/1000 or emit `Geoset.SkinWeights`.
- Generate MDX/MDL through existing `war3-model` serialization only after `ModelData` has passed save preparation and reference validation.
- Preserve real `none` semantics for missing texture references instead of remapping them to `0`.
- Recompute model/geoset extents from converted geometry and animation where possible.
- Keep object ids stable and unique.
- Use Warcraft III material filter modes only.
- Split geometry when a source mesh/material/bone influence combination cannot be represented in one geoset safely.
- Report features that have no MDX/MDL equivalent, such as PBR shader graphs or blend shapes if not baked.

## Task Breakdown

### Task A: Dependency Spike

Files:

- `vendor/ufbx/`
- `src-tauri/build.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/src/fbx_import/`

Work:

- Vendor `ufbx.c` and `ufbx.h`.
- Add a minimal Rust FFI wrapper.
- Load a fixture FBX and return scene counts.
- Add a native command only for development diagnostics if needed.

Verification:

- `cargo check` in `src-tauri`
- Optional native smoke: set `FBX_STATIC_FIXTURE=D:\path\to\small.fbx`, then run `cargo test --manifest-path src-tauri/Cargo.toml fbx_static_fixture_import_smoke -- --nocapture`.

### Task B: Intermediate DTO

Files:

- `src-tauri/src/fbx_import/types.rs`
- `src/renderer/src/types/fbxImport.ts`

Work:

- Define a serializable DTO independent of `ModelData`.
- Include geometry, materials, skeleton, clips, and diagnostics.
- Keep DTO stable enough for fixture snapshots.

Verification:

- Rust serialization test.
- TypeScript typecheck after gateway types are added.

### Task C: Static Mesh Mapping

Files:

- `src/renderer/src/application/model-import/FbxToWar3ModelMapper.ts`
- `src/renderer/src/application/model-import/FbxImportUseCase.ts`

Work:

- Map DTO meshes to `ModelData.Geosets`.
- Create textures/materials.
- Compute extents and default model metadata.
- Commit the loaded document through the existing model-open flow.

Verification:

- Static FBX fixture opens.
- Saved MDX/MDL reopens.
- Static imported geosets reference a real helper object id through `Groups: [[0]]`.
- `npm.cmd run check:fbx-fixtures`
- `cargo test --manifest-path src-tauri/Cargo.toml fbx_static_fixture_import_smoke -- --nocapture`

### Task D: Skinning Mapping

Work:

- Map skeleton nodes to Warcraft III node arrays. **Implemented.**
- Create geoset matrix groups. **Implemented from imported FBX source weights.**
- Use FBX source weights to choose deterministic classic matrix groups and `VertexGroup` indices. **Implemented.**
- Do not write version 900/1000 `SkinWeights`; imported FBX remains `FormatVersion: 800`. **Implemented.**
- Preserve pivots and parent ids. **Implemented through the node mapper.**
- Validate exported MDX/MDL in app reopen and a trusted reference viewer. **Pending.**
- Validate bind-pose local mesh output and classic matrix-group animation behavior after save/reopen. **Pending.**

Verification:

- `FBX_SKIN_FIXTURE=...\testmodel\fbx\skinning\blender_293_half_skinned_7400_binary.fbx cargo test --manifest-path src-tauri/Cargo.toml fbx_skin_fixture_node_bone_smoke -- --nocapture` passes and asserts per-vertex FBX source weight DTOs exist.
- Skinned fixture opens and deforms. **Pending app/reference validation.**
- Save/reopen keeps `FormatVersion: 800`, hierarchy, `Groups`, and `VertexGroup`, with no emitted `SkinWeights`. **Pending.**

### Task E: Animation Mapping

Work:

- Convert animation stacks to sequences.
- Bake local transforms at sample rate.
- Simplify redundant keys.
- Generate translation/rotation/scaling tracks.

Verification:

- Animated fixture plays.
- Save/reopen keeps tracks.
- Reference viewer comparison.

### Task F: Texture Extraction and Path Policy

Work:

- Resolve external texture paths.
- Optional embedded texture extraction.
- Normalize texture paths for Warcraft III.
- Integrate with existing texture preview/save asset services without bypassing them.

Verification:

- Multi-material fixture opens with expected textures.
- Missing textures produce warnings, not invisible geometry.

### Task G: Guardrails and Docs Sync

Work:

- Add `scripts/check-fbx-import-fixtures.mjs`.
- Extend `check:architecture` if new layers need direct-import protections.
- Keep this implementation plan and the technical details doc updated after each phase.

Verification:

- `npm run typecheck`
- `npm run check:architecture`
- `set FBX_FIXTURE_DIR=D:\path\to\fbx-fixtures && node scripts/check-fbx-import-fixtures.mjs`

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| FBX files use unsupported material graphs | Convert basic diffuse/base color, warn for ignored networks |
| Animation files become huge after baking | Add key simplification, expose sample rate, warn on large key counts |
| Bone influences exceed Warcraft III-friendly limits | Prune deterministically, renormalize, and warn |
| Coordinate systems differ by DCC tool | Store source axis/unit metadata, provide preset/override, include axis fixture |
| Embedded textures are unclear | Default to no extraction, offer explicit extraction mode |
| Generated MDX parses but fails in-game | Keep reference-backed fixtures and run strict export checks |
| Native dependency complicates build | Vendor single-source `ufbx`, keep wrapper small, verify Windows build first |

## Definition of Done

FBX support is complete when:

- `.fbx` appears in open/import workflows.
- Static, skinned, and animated FBX fixtures import into normal `ModelData`.
- Imported FBX can be saved as `.mdx` and `.mdl`.
- Saved files reopen in War3ModelView.
- At least one exported animated fixture is validated in Warcraft III or a trusted reference viewer.
- Conversion warnings are visible and actionable.
- Existing MDX/MDL behavior is unchanged.
- `npm run typecheck`, `npm run check:architecture`, existing MDX strict export check, and FBX fixture check pass.
