# FBX to MDX/MDL Technical Details

Last updated: 2026-05-05

## Implemented Static Import Slice

The current codebase has a working first slice for direct FBX loading and rendering:

```text
.fbx path
  -> FbxImportGateway
  -> Tauri command import_fbx_static_scene
  -> ufbx static scene DTO
  -> FbxImportUseCase
  -> ModelData.Textures / Materials / Geosets
  -> existing viewer
```

Current supported data:

- Scene counts and import warnings.
- Static mesh triangulation.
- Positions, normals, first UV set, indices, geoset extents.
- Global FBX material indices separate from mesh-local material slots.
- File texture path DTOs, wrapping flags, embedded-content presence diagnostics.
- Conservative material mapping for base/diffuse, opacity, double-sided, unlit, normal texture, and emissive texture.

Current limitations:

- PBR roughness/metalness/AO are diagnosed, not packed into War3 ORM textures.
- Embedded textures are not extracted to disk.
- Texture image format conversion to BLP is not implemented.

Recent implementation notes:

- Static mesh extraction now walks FBX mesh node instances, not only mesh definitions. This preserves duplicate instances, per-node transforms, geometry transform helpers, and per-instance material overrides in the flattened static DTO.
- Static FBX conversion creates a synthetic root helper named `Imported_Root` with `ObjectId = 0`, `Parent = -1`, `PivotPoints[0] = [0, 0, 0]`, and `Geoset.Groups = [[0]]`. This is required because the renderer and save validation treat matrix groups as node object ids, not arbitrary matrix indices.
- Native/Rust static scene DTOs include `nodes` and `bones`. Each node carries typed id, parent typed id, name, bone flag, local TRS, world translation, rest translation, and a full 4x4 rest/bind world matrix; each bone resolves back to a node typed id.
- The TypeScript mapper converts FBX bones to War3 `Bones` and non-root transform/mesh nodes to `Helpers`, then fills `Nodes`, `PivotPoints`, `Model.NumBones`, and `Model.NumHelpers` together. Parent references climb through skipped FBX ancestors until they find an imported War3 object id.
- Static geosets now receive their default matrix group object id from the node mapper. When an FBX file has real nodes, `Groups = [[defaultObjectId]]`; only node-less imports fall back to synthetic `Imported_Root`.
- For skinned meshes, native import emits bind-pose model-space vertex positions/normals via the mesh node `geometry_to_world`, plus per-expanded-vertex FBX source weights. This matches classic Warcraft III matrix groups, where the renderer multiplies geoset vertices directly by node delta matrices without a separate inverse bind buffer.
- `FbxGeosetMapper` converts each vertex's FBX bone typed ids to War3 object ids, creates stable classic matrix groups, and writes `VertexGroup`. Imported FBX output stays `FormatVersion: 800`; it does not emit version 900/1000 `SkinWeights`. Since classic groups average matrices equally, dominant FBX weights are collapsed to one bone and multi-bone groups are chosen only when the retained influences are close enough to equal weighting.
- `FbxAnimationMapper` places each baked FBX stack into a non-overlapping War3 sequence interval and appends that stack's keyed TRS data to the mapped War3 node tracks. Multiple FBX stacks must merge into the same `Translation` / `Rotation` / `Scaling` tracks rather than replacing earlier stack keys. The mapper converts baked FBX local TRS through matrix bind-pose deltas (`animatedWorld * inverse(bindWorld)`) using the native rest/bind world matrix before decomposing back to War3 pivot-local keys, because the classic renderer applies `Groups` by multiplying vertices with the node matrices directly.
- `FbxFinalModelTransform` applies a final 90 degree Warcraft III Z-axis rotation to imported FBX `ModelData`. This is a document-space bake, not a camera/viewer trick: vertices, normals, pivot points, node translation/rotation tracks, and extents are all rotated before the model enters the normal save/reopen path.
- Realtime preview uses `projectModelForRealtimeRenderer()` as a defensive guard for externally opened models that already contain `Geoset.SkinWeights`. FBX import itself should not create that field.
- The Rust FBX import wrapper is split into small modules under `src-tauri/src/fbx_import/`; the C skin-weight extraction helper is isolated in `ufbx_skin_weights.c/.h`.
- The repo includes small ufbx official fixtures under `testmodel/fbx`; `scripts/check-fbx-import-fixtures.mjs` uses that folder by default and still accepts `FBX_FIXTURE_DIR` / `FBX_STATIC_FIXTURE` overrides.

This document describes the concrete conversion design behind `docs/FBX_MDX_MDL_Implementation_Plan.md`. Use it when implementing FBX import, debugging converted animation, or extending fixture checks.

## Non-Negotiable Design

FBX is an input format only.

War3ModelView should not become an FBX editor and should not write FBX. The intended workflow is:

```text
open .fbx
  -> convert to War3 ModelData
  -> edit with existing tools
  -> save as .mdx or .mdl
```

`ModelData` is the boundary between import and the rest of the application. Once a conversion succeeds, every downstream save/export step must behave exactly like an MDX/MDL document.

FBX conversion targets classic Warcraft III `FormatVersion: 800` output. FBX source weights may be read as intermediate data, but the generated War3 geosets must use classic `Groups` and `VertexGroup` data rather than version 900/1000 `SkinWeights`.

## Native Parser Boundary

Use `ufbx` in the Tauri layer.

Native responsibilities:

- Read and parse FBX bytes.
- Apply `ufbx` scene evaluation helpers where needed.
- Triangulate polygons.
- Resolve evaluated mesh/material/skeleton/animation data.
- Produce a compact, JSON-serializable DTO.
- Produce diagnostics for unsupported or simplified FBX data.

Renderer/application responsibilities:

- Map DTO to `ModelData`.
- Commit the document through the existing open workflow.
- Save through the existing save workflow.
- Present diagnostics.

Reason:

- The renderer already has strong guardrails against direct platform and model-library access.
- Native parsing avoids shipping a large JavaScript FBX parser or running heavy conversion work on the UI thread.
- The DTO keeps `ufbx` implementation details out of React/Zustand/application code.

## DTO Schema

The DTO should be explicit and boring. Avoid passing raw FBX concepts such as property trees into TypeScript.

```ts
export interface FbxSceneDto {
    source: FbxSourceDto
    settings: FbxConversionSettingsDto
    nodes: FbxNodeDto[]
    meshes: FbxMeshDto[]
    materials: FbxMaterialDto[]
    textures: FbxTextureDto[]
    skins: FbxSkinDto[]
    animations: FbxAnimationDto[]
    diagnostics: FbxImportDiagnosticDto[]
}
```

### Source

```ts
export interface FbxSourceDto {
    path: string
    name: string
    fbxVersion?: string
    axisSystem?: string
    unitScale?: number
}
```

### Nodes

```ts
export interface FbxNodeDto {
    id: number
    name: string
    parentId: number | null
    kind: 'root' | 'mesh' | 'bone' | 'helper' | 'camera' | 'light'
    localTranslation: Vec3
    localRotation: Quat
    localScaling: Vec3
    worldMatrix: Mat4
    geometricTransform?: Mat4
}
```

### Meshes

Meshes should already be triangulated before crossing the native boundary.

```ts
export interface FbxMeshDto {
    id: number
    name: string
    nodeId: number
    vertices: FbxVertexDto[]
    triangles: FbxTriangleDto[]
    materialSlots: FbxMeshMaterialSlotDto[]
    skinId?: number
    bounds: FbxBoundsDto
}

export interface FbxVertexDto {
    position: Vec3
    normal?: Vec3
    uv0?: Vec2
    color?: Vec4
    weights?: FbxVertexWeightDto[]
}

export interface FbxTriangleDto {
    indices: [number, number, number]
    materialIndex: number
}
```

Important:

- Duplicate FBX control points into distinct vertices when normals, UVs, material slots, colors, or skin weights differ.
- The DTO should represent the final vertex stream that can be written into Warcraft III geosets without needing FBX polygon-vertex indirection later.

### Materials and Textures

```ts
export interface FbxMaterialDto {
    id: number
    name: string
    diffuseColor: Vec4
    opacity: number
    diffuseTextureId?: number
    doubleSided?: boolean
    unlit?: boolean
}

export interface FbxTextureDto {
    id: number
    name: string
    filePath?: string
    relativePath?: string
    embeddedBytes?: number[]
    mimeType?: string
}
```

Initial mapping should use only common material properties. PBR graphs, layered materials, procedural nodes, and shader-specific properties should generate diagnostics.

### Skin

```ts
export interface FbxSkinDto {
    id: number
    meshId: number
    clusters: FbxSkinClusterDto[]
}

export interface FbxSkinClusterDto {
    boneNodeId: number
    inverseBindMatrix: Mat4
}

export interface FbxVertexWeightDto {
    boneNodeId: number
    weight: number
}
```

### Animations

```ts
export interface FbxAnimationDto {
    id: number
    name: string
    startMs: number
    endMs: number
    sampleRate: number
    nodeTracks: FbxNodeTrackDto[]
}

export interface FbxNodeTrackDto {
    nodeId: number
    translation?: FbxVec3Key[]
    rotation?: FbxQuatKey[]
    scaling?: FbxVec3Key[]
}
```

Each key time is relative to the start of the FBX animation clip in milliseconds. The TypeScript mapper is responsible for placing clips into non-overlapping Warcraft III sequence intervals.

## Coordinate and Unit Mapping

Warcraft III model data is effectively Z-up in its common editor/runtime representation. FBX files may be Y-up, Z-up, left-handed, right-handed, centimeters, meters, or authored with tool-specific pre-rotations.

The converter must treat axis/unit normalization as a first-class step, not as a later visual fix.

Recommended approach:

1. Read source axis and unit metadata from `ufbx`.
2. Build one source-to-war3 basis transform.
3. Apply it consistently to positions, normals, pivots, bind poses, cameras, lights, and animation samples.
4. Store conversion settings in diagnostics so a bad import can be reproduced.

Default settings:

```ts
export interface FbxConversionSettingsDto {
    axisPreset: 'auto'
    scaleFactor: number
    sampleRate: 30
    maxInfluencesPerVertex: 4
    extractEmbeddedTextures: false
    texturePathMode: 'relative-to-model'
}
```

Implementation notes:

- Native `ufbx` loading uses `UFBX_SPACE_CONVERSION_ADJUST_TRANSFORMS` with the right-handed Z-up target so geometry, node local transforms, bind matrices, and baked animation samples stay in the same converted basis. Avoid `MODIFY_GEOMETRY` for skinned animation paths because it can make static geometry appear correct while leaving bind-pose deltas in a different effective space.
- Normals use inverse-transpose of the position transform, then normalize.
- Quaternion rotations must be converted through matrices or a proven basis-change formula. Do not swap quaternion components by hand without tests.
- Negative determinant basis transforms may flip triangle winding; detect this and reverse triangle order if needed.
- Unit scale must affect translations, positions, pivots, extents, cameras, and collision shapes if added later.

## Geometry Mapping

FBX mesh to Warcraft III geosets:

1. Triangulate all polygons.
2. Split by material slot.
3. Split again when required by skin matrix-group limits or other Warcraft III constraints.
4. Build `Geosets[]`.
5. Build `Materials[]` and assign `Geosets[].MaterialID`.
6. Compute extents.

Recommended geoset fields:

- `Vertices`: transformed positions.
- `Normals`: transformed/generated normals.
- `TVertices`: UV set 0.
- `Faces`: triangles.
- `Groups`: matrix group references for skinning.
- `MaterialID`: generated material index.

Validation:

- No NaN or Infinity.
- No degenerate triangles unless intentionally kept with a diagnostic.
- Every material index resolves.
- Every skin group resolves to an existing bone.
- Extents contain all vertices.

## Material Mapping

FBX material to Warcraft III material:

| FBX concept | Warcraft III mapping |
| --- | --- |
| diffuse/base color texture | `Textures[]` entry and material layer `TextureID` |
| diffuse color | material/layer static color only if supported by current model data path, otherwise diagnostic |
| opacity < 1 | `Blend` or `Transparent` filter mode plus alpha where supported |
| double-sided | layer `TwoSided` |
| unlit | layer `Unshaded` |
| PBR metal/roughness | ignored with warning |
| normal map | ignored with warning |
| emissive texture | initial warning; later optional additive layer |

Fallback material:

```ts
{
    Layers: [{
        FilterMode: 'None',
        TextureID: -1
    }]
}
```

Keep missing texture as a real missing/none state. Do not remap missing texture references to texture `0`.

## Texture Path Policy

Default:

- Preserve external texture paths as relative paths where possible.
- If a texture is outside the model directory, use the file name and warn that the user may need to copy the texture.
- Do not automatically extract embedded textures unless the import option is enabled.

Embedded extraction mode:

- Write embedded texture bytes through `desktopGateway`/Tauri infrastructure only.
- Prefer a sibling folder named after the FBX base name, for example `ModelName_textures`.
- Store the relative path string in `Textures[].Image`.
- Increment asset revision after extraction/import.

Warcraft III texture conversion:

- Initial implementation may keep common image paths as source references if existing preview/save paths can read them.
- Later work can add optional conversion to BLP through existing or new texture encoding infrastructure.

## Skeleton Mapping

FBX nodes become Warcraft III nodes using a deterministic id map.

Recommended object id allocation:

1. Reserve root/helper ids.
2. Allocate bone ids in source hierarchy order.
3. Allocate mesh helper ids if needed.
4. Allocate attachments/cameras/lights only when explicitly supported.

Mapping:

| FBX node | Warcraft III node |
| --- | --- |
| skeleton limb/deformer cluster node | `Bones[]` |
| transform-only parent needed for hierarchy | `Helpers[]` |
| mesh node with no skin | optional helper or no node, depending on transform bake |
| mesh node with skin | helper plus bone hierarchy if needed |

Pivots:

- Use source node world/local pivot after axis/unit normalization.
- If unavailable, derive from node transform translation.
- Keep `PivotPoints[]` aligned with node object ids as expected by current app/runtime.

Default transforms:

- Store local transform tracks only when they differ from identity/default or are needed for animation.
- Preserve hierarchy by parent object id.

## Skinning Mapping

Classic Warcraft III geosets use matrix groups rather than arbitrary modern GPU skin buffers. The mapper must convert FBX vertex weights into the classic structure expected by the current app and `war3-model`.

Algorithm:

1. Collect weights per final vertex.
2. Remove zero/near-zero weights.
3. Sort by descending absolute weight, then by stable bone id.
4. Keep at most `maxInfluencesPerVertex`, default `4`.
5. Build a stable matrix group key from the kept bone object ids.
6. Assign the vertex to the matching `VertexGroup` index.
7. Split geosets if group count or renderer/export constraints require it.

Important:

- The FBX numeric weights are input data only. They influence deterministic pruning and group ordering, but no per-vertex weight buffer is written to the War3 model.
- Do not emit `Geoset.SkinWeights`, bind-pose chunks, or version 900/1000 output for imported FBX.
- Classic matrix groups approximate multi-influence skinning through the Warcraft III 800 format; reference-viewer comparison decides whether additional geoset splitting is needed.

Diagnostics:

- Warn when influences are pruned.
- Warn when total weight is zero and the vertex is bound to a fallback bone.
- Warn when a mesh references a missing bone cluster.

Fallback bone:

- Prefer the nearest parent bone in the source hierarchy.
- If none exists, create one root bone/helper with identity transform and warn.

## Animation Mapping

### Sequence Layout

FBX animation stacks become Warcraft III sequences.

Recommended timeline placement:

```text
clip 0: 0..duration0
gap: 100 ms
clip 1: previousEnd + gap .. previousEnd + gap + duration1
```

Why include a gap:

- It avoids accidental key overlap at sequence boundaries.
- It makes generated MDL easier to inspect.

Sequence names:

- Use FBX stack name when available.
- Normalize common names:
  - `idle`, `stand` -> `Stand`
  - `walk` -> `Walk`
  - `attack` -> `Attack`
  - `death` -> `Death`
- Keep original name in diagnostics if normalized.

### Baking

First implementation should bake animations.

For each clip:

1. Determine start/end time.
2. Sample at `sampleRate`.
3. Evaluate each animated node's local transform at each sample using `ufbx`.
4. Convert to Warcraft III coordinate basis.
5. Decompose local matrix into translation, quaternion rotation, and scale.
6. Write keys at sequence-local time plus sequence start.
7. Simplify redundant keys.

Current implementation note:

- `ufbx_bake_anim()` produces values comparable to `ufbx_node.local_transform`. For skinned classic output, the useful matrix is the skinning delta from bind pose, not the raw FBX local transform. Import evaluates animated world matrices for the baked time, multiplies by inverse native rest/bind world matrices, removes the parent delta for War3 hierarchy, and decomposes the result around `PivotPoint`.

Default sample rates:

- `30 fps`: default, good balance for Warcraft III assets.
- `60 fps`: high fidelity for fast motions.
- `15 fps`: compact fallback for huge files, with visible warning.

Simplification:

- Translation epsilon: start with `0.001` model units.
- Rotation epsilon: start with `0.05` degrees.
- Scale epsilon: start with `0.0005`.
- Never remove first or last key in a sequence.
- Never simplify across sequence boundaries.

Interpolation:

- Use `Linear` for baked tracks.
- Consider `DontInterp` only for constant stepped properties.
- Do not emit Hermite/Bezier until there are tests proving tangent correctness.

### Rotation

Use quaternions for Warcraft III rotation tracks.

Rules:

- Normalize every quaternion.
- Enforce shortest-path continuity by flipping sign when dot(previous, current) < 0.
- Avoid Euler-angle intermediate representation except for diagnostics.
- Test with a 90-degree axis fixture and a 360-degree spin fixture.

### Static Node Optimization

If a node is constant for a full clip:

- If it matches the default bind/local transform, omit the track.
- If it differs, emit a two-key constant track at sequence start and end or a single key only if the serializer/runtime path is proven safe.

## Extents

Extents must be recomputed after conversion.

Minimum:

- Static extents from converted vertices.
- Model extents from all geosets.
- Sequence extents copied from static extents if no better animated bounds are available.

Better:

- For skinned/animated models, sample each sequence at the same animation sample rate and compute deformed vertex bounds.
- Use cached CPU skinning results to avoid excessive import time.

Diagnostics:

- Warn if animated extents are approximated from static bind pose.

## Unsupported Features

Initial unsupported features must not be silent.

| FBX feature | Initial behavior |
| --- | --- |
| Blend shapes | Warn and ignore, or later bake to geoset animation only if a design is approved |
| Constraints | Bake through evaluated transforms, warn |
| IK solvers | Bake through evaluated transforms, warn |
| Cameras/lights | Optional later support; warn if ignored |
| NURBS/curves | Tessellate only if `ufbx` path is implemented; otherwise warn |
| Multiple UV sets | Use UV0, warn for extra sets |
| Vertex colors | Optional later support; warn if ignored |
| PBR shader graphs | Use diffuse fallback, warn |
| Embedded media | Warn unless extraction enabled |
| Multiple takes/layers | Bake final evaluated stack, warn if layer semantics are collapsed |

## Validation Before Commit

Before `FbxImportUseCase` commits `ModelData`, run an import-specific validator:

- `Version.FormatVersion` is set.
- `Model.Name` is non-empty.
- Every geoset has vertices and faces.
- No face index is out of range.
- Every `MaterialID` resolves.
- Every material layer texture id is `-1`, `null`, or in range.
- Every node object id is unique.
- Every parent id resolves or is `-1`/none.
- Every sequence interval is valid and non-overlapping.
- Every animation key time is within a sequence interval or intentionally global.
- No NaN/Infinity in geometry, transforms, weights, extents, or animation tracks.

Then rely on existing save-time repair/validation again during MDX/MDL export. Import validation catches conversion bugs early; save validation catches final document integrity problems.

## Implementation Pseudocode

### Native Import Command

```rust
#[tauri::command]
pub fn import_fbx(path: String, settings: FbxImportSettings) -> Result<FbxSceneDto, String> {
    activation::require_basic_activation("Importing FBX models")?;
    let scene = fbx_import::load_scene(&path, &settings)?;
    let dto = fbx_import::convert_scene(scene, &settings)?;
    Ok(dto)
}
```

Keep the command small. Real work belongs in `src-tauri/src/fbx_import`.

### Renderer Gateway

```ts
export interface FbxImportGateway {
    importFile(path: string, settings: FbxImportSettings): Promise<FbxSceneDto>
}
```

The gateway is the only renderer-side place that invokes the Tauri command.

### Application Use Case

```ts
export class FbxImportUseCase {
    constructor(private readonly gateway: FbxImportGateway) {}

    async importFromPath(path: string, settings: FbxImportSettings): Promise<FbxImportResult> {
        const dto = await this.gateway.importFile(path, settings)
        const modelData = mapFbxSceneToWar3ModelData(dto)
        const diagnostics = [
            ...dto.diagnostics,
            ...validateImportedWar3Model(modelData),
        ]

        const blocking = diagnostics.filter((item) => item.severity === 'error')
        if (blocking.length > 0) {
            throw new FbxImportError(blocking)
        }

        return { modelData, diagnostics, source: dto.source, conversion: dto.settings }
    }
}
```

### Open Flow Routing

```ts
if (extension === 'fbx') {
    const result = await fbxImportUseCase.importFromPath(filePath, defaultFbxSettings)
    openModelWorkflow.handleLoadedModel({
        ...result.modelData,
        path: filePath,
    }, context)
    showImportDiagnostics(result.diagnostics)
    markDocumentDirtyForConvertedSource()
    return
}
```

The exact implementation should match the current `MainLayout`/open-tab ownership at the time of coding.

## Fixture Strategy

Use small, named fixtures that each prove one conversion promise.

Recommended fixture matrix:

| Fixture | Purpose | Expected checks |
| --- | --- | --- |
| `static_cube_textured.fbx` | static geometry and texture | 1 geoset, 1 material, UVs, extents |
| `multi_material_plane.fbx` | material splitting | multiple geosets/materials |
| `y_up_scale_100.fbx` | axis and unit conversion | correct orientation/scale |
| `skinned_two_bones.fbx` | skin matrix groups | bones, weights, deformation |
| `idle_walk_two_takes.fbx` | sequences | 2 sequences, key ranges |
| `constraint_baked.fbx` | evaluated animation baking | warning plus baked local tracks |
| `missing_texture.fbx` | diagnostics | visible material fallback and warning |

Current small fixture set checked into this repo:

| Fixture path | Current role | Notes |
| --- | --- | --- |
| `testmodel/fbx/static_mesh/blender_272_cube_7400_binary.fbx` | Native static smoke | Default `FBX_STATIC_FIXTURE` when no env override is set |
| `testmodel/fbx/static_mesh/max2009_cube_texture_5800_binary.fbx` | Texture/material metadata | May require companion texture checks later; current smoke only validates DTO readability |
| `testmodel/fbx/static_multimaterial/blender_suzanne_multimaterial_7400_binary.fbx` | Multi-material partitioning | Current expected static import: seven mesh DTOs, seven materials, 2904 total indices |
| `testmodel/fbx/instancing/blender_293_instancing_7400_binary.fbx` | Node instance traversal | Current expected static import: eight mesh DTOs from one source mesh; extent centers should be distinct |
| `testmodel/fbx/skinning/blender_293_half_skinned_7400_binary.fbx` | Skeleton/skinning DTO | Used after node/bone/skin DTOs land |
| `testmodel/fbx/animation/maya_anim_linear_7700_ascii.fbx` | Animation baking | Near-one-second animation stack used after `ufbx_bake_anim()` DTOs land |

`scripts/check-fbx-import-fixtures.mjs` should:

Current behavior:

1. Discover `.fbx` files under `FBX_FIXTURE_DIR`, or under checked-in `testmodel/fbx` by default.
2. Fail if the directory is missing, empty, or contains empty fixtures.
3. Validate `FBX_STATIC_FIXTURE`, or the default static cube fixture, and print the Rust smoke-test command.

Next target behavior:

1. Import each fixture.
2. Assert expected counts.
3. Serialize to MDX and MDL through existing gateway/use case where possible.
4. Parse the serialized output again.
5. Fail with concise diagnostics.

Native smoke test:

```powershell
npm.cmd run check:fbx-fixtures
$env:FBX_STATIC_FIXTURE = 'D:\Desktop\war3modelview\War3ModelView\testmodel\fbx\static_mesh\blender_272_cube_7400_binary.fbx'
cargo test --manifest-path src-tauri/Cargo.toml fbx_static_fixture_import_smoke -- --nocapture
$env:FBX_SKIN_FIXTURE = 'D:\Desktop\war3modelview\War3ModelView\testmodel\fbx\skinning\blender_293_half_skinned_7400_binary.fbx'
cargo test --manifest-path src-tauri/Cargo.toml fbx_skin_fixture_node_bone_smoke -- --nocapture
```

The skin smoke now verifies that imported skinned fixtures include node DTOs, bone DTOs, resolved bone-node references, and non-empty per-vertex FBX source weight DTOs. The next validation step is a save/reopen/reference-viewer comparison that confirms the generated classic War3 `Groups` and `VertexGroup` data deform acceptably after serialization while the output remains `FormatVersion: 800`.

Next animation DTO target:

1. Add native `war3_fbx_anim_stack_dto`, `war3_fbx_baked_node_dto`, `war3_fbx_baked_vec3_key`, and `war3_fbx_baked_quat_key` arrays beside the existing static scene DTO.
2. Use `ufbx_bake_anim(scene, stack->anim, &opts, &error)` with `trim_start_time = true`, `resample_rate = scene->settings.frames_per_second > 0 ? scene->settings.frames_per_second : 30`, `maximum_sample_rate = 60`, `step_handling = UFBX_BAKE_STEP_HANDLING_DEFAULT`, and key reduction enabled.
3. Rust should copy baked arrays into serde DTOs and free all native allocations after copy.
4. TypeScript should create one War3 `Sequence` per stack, convert seconds to milliseconds, and attach `Translation`, `Rotation`, and `Scaling` anim vectors to mapped War3 nodes only.
5. Track vectors should use `LineType: 1`, `GlobalSeqId: null`, `Float32Array(3)` for translation/scaling, and `Float32Array(4)` quaternion `[x, y, z, w]` for rotation.

Round-trip automation target:

- Keep the first round-trip script outside UI/React and operate on plain `ModelData`.
- Reuse `FbxImportUseCase` only after the pure static-scene DTO to War3 `ModelData` mapper is extracted away from the Tauri singleton import.
- Reuse `SaveModelUseCase.prepareModelForSave()` and `War3ModelSerializationGateway.serialize()/parse()` for MDX/MDL save and reopen checks.
- Report distinct failures for native import, model mapping, save validation, serialization, parse reopen, and invariant mismatch.

## Performance Targets

Initial targets on a normal desktop:

- Static small fixture: under 1 second.
- 10k to 50k vertices static fixture: under 5 seconds.
- 30 fps animation bake with a modest skeleton: under 10 seconds.

Implementation notes:

- Do heavy native parsing/conversion off the UI thread where possible.
- Return progress events only after the base import path works.
- Add cancellation later using `ufbx` progress/cancel support if large files are common.

## Security and Robustness

FBX files are untrusted inputs.

Requirements:

- Parse in native code with safe error handling.
- Bound allocation sizes before serializing DTOs back to JS.
- Reject extremely large scenes with a clear error unless the user explicitly allows them later.
- Never trust embedded texture names as safe filesystem paths.
- Sanitize output texture filenames.
- Avoid writing embedded textures unless the user selected extraction.
- Keep activation checks away from high-frequency read/parse inner loops; gate the import command entry point instead.

## Known Open Questions

These should be answered during implementation with fixtures, not by guessing:

- What exact coordinate basis does the current viewer/editor path expect for imported non-Warcraft assets?
- What is the practical maximum bone influence count that current `war3-model` generation and Warcraft III runtime tolerate for these assets?
- Does the existing renderer consume geoset groups/matrices exactly as generated by `war3-model`, or does it need a refresh hook after FBX import?
- Should imported FBX default to `BlendTime: 150` or `0`?
- Should embedded textures be written beside the target save path or beside the source FBX path?
- Which Warcraft III version target should be the strict compatibility baseline for larger bone counts and material flags?

## Completion Checklist

- `ufbx` vendored and compiled in Windows Tauri build.
- Native import returns typed DTO and diagnostics.
- `.fbx` open path routes through `FbxImportUseCase`.
- Static mesh conversion passes fixtures.
- Skeleton/skinning DTO conversion passes fixtures.
- War3 `Groups` / `VertexGroup` mapping exists for skinned imports, with no emitted `SkinWeights`.
- Animation baking passes fixtures.
- Imported document saves as MDX and MDL through existing save path.
- Saved MDX/MDL reopens.
- At least one animated export is verified in a trusted runtime/reference viewer.
- `npm run typecheck` passes.
- `npm run check:architecture` passes.
- `set FBX_FIXTURE_DIR=D:\path\to\fbx-fixtures && node scripts/check-fbx-import-fixtures.mjs` passes.
