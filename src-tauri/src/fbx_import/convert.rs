use super::native::{
    NativeFbxAnimationStackDto, NativeFbxBakedNodeDto, NativeFbxBakedQuatKey,
    NativeFbxBakedVec3Key, NativeFbxBoneDto, NativeFbxMaterialDto, NativeFbxMaterialSlotDto,
    NativeFbxNodeDto, NativeFbxProbeResult, NativeFbxTextureDto,
};
use super::types::{
    FbxAnimationStackDto, FbxBakedNodeDto, FbxBakedQuatKeyDto, FbxBakedVec3KeyDto, FbxBoneDto,
    FbxMaterialDto, FbxMaterialSlotDto, FbxNodeDto, FbxProbeResult, FbxTextureDto,
};
use std::ffi::CStr;
use std::os::raw::c_char;
use std::slice;

pub(super) fn probe_result_from_native(
    path: String,
    file_size: u64,
    native: NativeFbxProbeResult,
    warnings: Vec<String>,
) -> FbxProbeResult {
    FbxProbeResult {
        ok: true,
        path,
        file_size,
        node_count: native.node_count,
        mesh_count: native.mesh_count,
        material_count: native.material_count,
        texture_count: native.texture_count,
        skin_deformer_count: native.skin_deformer_count,
        bone_count: native.bone_count,
        animation_stack_count: native.animation_stack_count,
        camera_count: native.camera_count,
        light_count: native.light_count,
        unit_meters: native.unit_meters,
        frames_per_second: native.frames_per_second,
        warnings,
    }
}

pub(super) fn probe_warnings_from_native(native: &NativeFbxProbeResult) -> Vec<String> {
    let mut warnings = Vec::new();
    if native.mesh_count == 0 {
        warnings.push("FBX scene contains no meshes; nothing can be rendered yet".to_string());
    }
    if native.animation_stack_count > 0 {
        warnings.push(
            "Animation stacks were detected; import bakes War3 node TRS tracks and still needs save/reopen reference-viewer validation"
                .to_string(),
        );
    }
    if native.skin_deformer_count > 0 {
        warnings.push(
            "Skin deformers were detected; import maps FBX source weights to classic War3 matrix groups and VertexGroup data"
                .to_string(),
        );
    }
    warnings
}

pub(super) fn native_error_message(native: &NativeFbxProbeResult) -> String {
    unsafe { CStr::from_ptr(native.error.as_ptr()) }
        .to_string_lossy()
        .trim()
        .to_string()
}

pub(super) fn native_string(value: *const c_char) -> String {
    if value.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(value) }
        .to_string_lossy()
        .to_string()
}

pub(super) fn native_f32_vec(ptr: *const f32, len: usize) -> Vec<f32> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    unsafe { slice::from_raw_parts(ptr, len) }.to_vec()
}

pub(super) fn native_u32_vec(ptr: *const u32, len: usize) -> Vec<u32> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    unsafe { slice::from_raw_parts(ptr, len) }.to_vec()
}

pub(super) fn native_u8_vec(ptr: *const u8, len: usize) -> Vec<u8> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    unsafe { slice::from_raw_parts(ptr, len) }.to_vec()
}

pub(super) fn native_optional_index(value: u32) -> Option<u32> {
    if value == u32::MAX {
        None
    } else {
        Some(value)
    }
}

pub(super) fn native_bool(value: u8) -> bool {
    value != 0
}

fn texture_kind_from_native(kind: u32) -> String {
    match kind {
        0 => "file",
        1 => "layered",
        2 => "procedural",
        3 => "shader",
        _ => "unknown",
    }
    .to_string()
}

fn material_slot_from_native(slot: u32) -> String {
    match slot {
        0 => "baseColor",
        1 => "diffuse",
        2 => "opacity",
        3 => "normal",
        4 => "emission",
        5 => "roughness",
        6 => "metalness",
        7 => "ambientOcclusion",
        8 => "reflection",
        9 => "specular",
        _ => "unknown",
    }
    .to_string()
}

pub(super) fn texture_from_native(texture: &NativeFbxTextureDto) -> FbxTextureDto {
    FbxTextureDto {
        texture_index: texture.texture_index,
        file_index: native_optional_index(texture.file_index),
        kind: texture_kind_from_native(texture.kind),
        name: native_string(texture.name),
        filename: native_string(texture.filename),
        relative_filename: native_string(texture.relative_filename),
        absolute_filename: native_string(texture.absolute_filename),
        has_embedded_content: native_bool(texture.has_embedded_content),
        embedded_content_size: texture.embedded_content_size,
        uv_set: native_string(texture.uv_set),
        wrap_u_repeat: native_bool(texture.wrap_u_repeat),
        wrap_v_repeat: native_bool(texture.wrap_v_repeat),
        has_uv_transform: native_bool(texture.has_uv_transform),
        uv_translation: texture.uv_translation,
        uv_rotation: texture.uv_rotation,
        uv_scale: texture.uv_scale,
    }
}

fn material_slot_from_native_dto(slot: &NativeFbxMaterialSlotDto) -> FbxMaterialSlotDto {
    FbxMaterialSlotDto {
        slot: material_slot_from_native(slot.slot_kind),
        source: native_string(slot.source),
        texture_index: native_optional_index(slot.texture_index),
        file_index: native_optional_index(slot.file_index),
        texture_enabled: native_bool(slot.texture_enabled),
        has_value: native_bool(slot.has_value),
        value_components: slot.value_components,
        value: slot.value,
        material_prop: native_string(slot.material_prop),
        shader_prop: native_string(slot.shader_prop),
        uv_set: native_string(slot.uv_set),
        wrap_u_repeat: native_bool(slot.wrap_u_repeat),
        wrap_v_repeat: native_bool(slot.wrap_v_repeat),
    }
}

pub(super) fn node_from_native(node: &NativeFbxNodeDto) -> FbxNodeDto {
    FbxNodeDto {
        typed_id: node.typed_id,
        parent_typed_id: native_optional_index(node.parent_typed_id),
        name: native_string(node.name),
        is_bone: native_bool(node.is_bone),
        local_translation: node.local_translation,
        local_rotation: node.local_rotation,
        local_scale: node.local_scale,
        world_translation: node.world_translation,
        rest_translation: node.rest_translation,
        rest_world_matrix: node.rest_world_matrix,
    }
}

pub(super) fn bone_from_native(bone: &NativeFbxBoneDto) -> FbxBoneDto {
    FbxBoneDto {
        bone_typed_id: bone.bone_typed_id,
        node_typed_id: native_optional_index(bone.node_typed_id),
    }
}

fn native_baked_vec3_keys(
    ptr: *const NativeFbxBakedVec3Key,
    len: usize,
) -> Vec<FbxBakedVec3KeyDto> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    unsafe { slice::from_raw_parts(ptr, len) }
        .iter()
        .map(|key| FbxBakedVec3KeyDto {
            time_seconds: key.time_seconds,
            value: key.value,
            flags: key.flags,
        })
        .collect()
}

fn native_baked_quat_keys(
    ptr: *const NativeFbxBakedQuatKey,
    len: usize,
) -> Vec<FbxBakedQuatKeyDto> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    unsafe { slice::from_raw_parts(ptr, len) }
        .iter()
        .map(|key| FbxBakedQuatKeyDto {
            time_seconds: key.time_seconds,
            value: key.value,
            flags: key.flags,
        })
        .collect()
}

fn baked_node_from_native(node: &NativeFbxBakedNodeDto) -> FbxBakedNodeDto {
    FbxBakedNodeDto {
        node_typed_id: node.node_typed_id,
        constant_translation: native_bool(node.constant_translation),
        constant_rotation: native_bool(node.constant_rotation),
        constant_scale: native_bool(node.constant_scale),
        translation_keys: native_baked_vec3_keys(
            node.translation_keys,
            node.translation_key_count as usize,
        ),
        rotation_keys: native_baked_quat_keys(node.rotation_keys, node.rotation_key_count as usize),
        scale_keys: native_baked_vec3_keys(node.scale_keys, node.scale_key_count as usize),
    }
}

pub(super) fn animation_stack_from_native(
    stack: &NativeFbxAnimationStackDto,
) -> FbxAnimationStackDto {
    let baked_nodes = if stack.baked_nodes.is_null() || stack.baked_node_count == 0 {
        Vec::new()
    } else {
        unsafe { slice::from_raw_parts(stack.baked_nodes, stack.baked_node_count as usize) }
            .iter()
            .map(baked_node_from_native)
            .collect()
    };

    FbxAnimationStackDto {
        stack_typed_id: stack.stack_typed_id,
        name: native_string(stack.name),
        time_begin: stack.time_begin,
        time_end: stack.time_end,
        playback_time_begin: stack.playback_time_begin,
        playback_time_end: stack.playback_time_end,
        playback_duration: stack.playback_duration,
        baked_nodes,
    }
}

pub(super) fn material_from_native(material: &NativeFbxMaterialDto) -> FbxMaterialDto {
    let slots = if material.slots.is_null() || material.slot_count == 0 {
        Vec::new()
    } else {
        unsafe { slice::from_raw_parts(material.slots, material.slot_count as usize) }
            .iter()
            .map(material_slot_from_native_dto)
            .collect()
    };

    FbxMaterialDto {
        material_index: material.material_index,
        name: native_string(material.name),
        shader_type: material.shader_type,
        shading_model_name: native_string(material.shading_model_name),
        double_sided: native_bool(material.double_sided),
        unlit: native_bool(material.unlit),
        base_color: native_bool(material.has_base_color).then_some(material.base_color),
        diffuse_color: native_bool(material.has_diffuse_color).then_some(material.diffuse_color),
        opacity: native_bool(material.has_opacity).then_some(material.opacity),
        emissive_color: native_bool(material.has_emissive_color).then_some(material.emissive_color),
        slots,
    }
}
