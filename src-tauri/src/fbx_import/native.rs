use std::os::raw::{c_char, c_double, c_int};

#[repr(C)]
#[derive(Clone, Copy)]
pub(super) struct NativeFbxProbeResult {
    pub node_count: u32,
    pub mesh_count: u32,
    pub material_count: u32,
    pub texture_count: u32,
    pub skin_deformer_count: u32,
    pub bone_count: u32,
    pub animation_stack_count: u32,
    pub camera_count: u32,
    pub light_count: u32,
    pub unit_meters: c_double,
    pub frames_per_second: c_double,
    pub error: [c_char; 1024],
}

#[repr(C)]
pub(super) struct NativeFbxTextureDto {
    pub texture_index: u32,
    pub file_index: u32,
    pub kind: u32,
    pub has_file: u8,
    pub has_embedded_content: u8,
    pub embedded_content_size: u64,
    pub name: *const c_char,
    pub filename: *const c_char,
    pub relative_filename: *const c_char,
    pub absolute_filename: *const c_char,
    pub uv_set: *const c_char,
    pub wrap_u_repeat: u8,
    pub wrap_v_repeat: u8,
    pub has_uv_transform: u8,
    pub uv_translation: [f32; 2],
    pub uv_rotation: f32,
    pub uv_scale: [f32; 2],
}

#[repr(C)]
pub(super) struct NativeFbxMaterialSlotDto {
    pub slot_kind: u32,
    pub texture_index: u32,
    pub file_index: u32,
    pub texture_enabled: u8,
    pub has_value: u8,
    pub value_components: u8,
    pub value: [f32; 4],
    pub source: *const c_char,
    pub material_prop: *const c_char,
    pub shader_prop: *const c_char,
    pub uv_set: *const c_char,
    pub wrap_u_repeat: u8,
    pub wrap_v_repeat: u8,
}

#[repr(C)]
pub(super) struct NativeFbxMaterialDto {
    pub material_index: u32,
    pub name: *const c_char,
    pub shader_type: u32,
    pub shading_model_name: *const c_char,
    pub double_sided: u8,
    pub unlit: u8,
    pub base_color: [f32; 4],
    pub has_base_color: u8,
    pub diffuse_color: [f32; 4],
    pub has_diffuse_color: u8,
    pub opacity: f32,
    pub has_opacity: u8,
    pub emissive_color: [f32; 3],
    pub has_emissive_color: u8,
    pub slot_count: u32,
    pub slots: *mut NativeFbxMaterialSlotDto,
}

#[repr(C)]
pub(super) struct NativeFbxNodeDto {
    pub typed_id: u32,
    pub parent_typed_id: u32,
    pub name: *const c_char,
    pub is_bone: u8,
    pub local_translation: [f32; 3],
    pub local_rotation: [f32; 4],
    pub local_scale: [f32; 3],
    pub world_translation: [f32; 3],
    pub rest_translation: [f32; 3],
    pub rest_world_matrix: [f32; 16],
}

#[repr(C)]
pub(super) struct NativeFbxBoneDto {
    pub bone_typed_id: u32,
    pub node_typed_id: u32,
}

#[repr(C)]
pub(super) struct NativeFbxStaticMesh {
    pub name: *const c_char,
    pub node_typed_id: u32,
    pub mesh_material_slot: u32,
    pub material_index: u32,
    pub skin_weight_stride: u32,
    pub vertex_count: u32,
    pub index_count: u32,
    pub vertices: *const f32,
    pub normals: *const f32,
    pub uvs: *const f32,
    pub indices: *const u32,
    pub skin_weight_counts: *const u8,
    pub skin_bone_node_typed_ids: *const u32,
    pub skin_weights: *const f32,
    pub minimum_extent: [f32; 3],
    pub maximum_extent: [f32; 3],
    pub bounds_radius: f32,
}

#[repr(C)]
pub(super) struct NativeFbxBakedVec3Key {
    pub time_seconds: c_double,
    pub value: [f32; 3],
    pub flags: u32,
}

#[repr(C)]
pub(super) struct NativeFbxBakedQuatKey {
    pub time_seconds: c_double,
    pub value: [f32; 4],
    pub flags: u32,
}

#[repr(C)]
pub(super) struct NativeFbxBakedNodeDto {
    pub node_typed_id: u32,
    pub constant_translation: u8,
    pub constant_rotation: u8,
    pub constant_scale: u8,
    pub translation_key_count: u32,
    pub translation_keys: *mut NativeFbxBakedVec3Key,
    pub rotation_key_count: u32,
    pub rotation_keys: *mut NativeFbxBakedQuatKey,
    pub scale_key_count: u32,
    pub scale_keys: *mut NativeFbxBakedVec3Key,
}

#[repr(C)]
pub(super) struct NativeFbxAnimationStackDto {
    pub stack_typed_id: u32,
    pub name: *const c_char,
    pub time_begin: c_double,
    pub time_end: c_double,
    pub playback_time_begin: c_double,
    pub playback_time_end: c_double,
    pub playback_duration: c_double,
    pub baked_node_count: u32,
    pub baked_nodes: *mut NativeFbxBakedNodeDto,
}

#[repr(C)]
pub(super) struct NativeFbxStaticScene {
    pub probe: NativeFbxProbeResult,
    pub node_count: u32,
    pub nodes: *mut NativeFbxNodeDto,
    pub bone_count: u32,
    pub bones: *mut NativeFbxBoneDto,
    pub texture_count: u32,
    pub textures: *mut NativeFbxTextureDto,
    pub material_count: u32,
    pub materials: *mut NativeFbxMaterialDto,
    pub mesh_count: u32,
    pub meshes: *mut NativeFbxStaticMesh,
    pub animation_stack_count: u32,
    pub animation_stacks: *mut NativeFbxAnimationStackDto,
}

extern "C" {
    pub(super) fn war3_fbx_probe_file(
        path: *const c_char,
        out_result: *mut NativeFbxProbeResult,
    ) -> c_int;
    pub(super) fn war3_fbx_load_static_scene(
        path: *const c_char,
        out_scene: *mut NativeFbxStaticScene,
    ) -> c_int;
    pub(super) fn war3_fbx_free_static_scene(scene: *mut NativeFbxStaticScene);
}

pub(super) fn empty_native_probe() -> NativeFbxProbeResult {
    NativeFbxProbeResult {
        node_count: 0,
        mesh_count: 0,
        material_count: 0,
        texture_count: 0,
        skin_deformer_count: 0,
        bone_count: 0,
        animation_stack_count: 0,
        camera_count: 0,
        light_count: 0,
        unit_meters: 0.0,
        frames_per_second: 0.0,
        error: [0; 1024],
    }
}

pub(super) fn empty_native_static_scene() -> NativeFbxStaticScene {
    NativeFbxStaticScene {
        probe: empty_native_probe(),
        node_count: 0,
        nodes: std::ptr::null_mut(),
        bone_count: 0,
        bones: std::ptr::null_mut(),
        texture_count: 0,
        textures: std::ptr::null_mut(),
        material_count: 0,
        materials: std::ptr::null_mut(),
        mesh_count: 0,
        meshes: std::ptr::null_mut(),
        animation_stack_count: 0,
        animation_stacks: std::ptr::null_mut(),
    }
}
