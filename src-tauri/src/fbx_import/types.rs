use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxProbeOptions {
    pub max_file_size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxProbeResult {
    pub ok: bool,
    pub path: String,
    pub file_size: u64,
    pub node_count: u32,
    pub mesh_count: u32,
    pub material_count: u32,
    pub texture_count: u32,
    pub skin_deformer_count: u32,
    pub bone_count: u32,
    pub animation_stack_count: u32,
    pub camera_count: u32,
    pub light_count: u32,
    pub unit_meters: f64,
    pub frames_per_second: f64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxStaticSceneResult {
    pub probe: FbxProbeResult,
    pub nodes: Vec<FbxNodeDto>,
    pub bones: Vec<FbxBoneDto>,
    pub textures: Vec<FbxTextureDto>,
    pub materials: Vec<FbxMaterialDto>,
    pub meshes: Vec<FbxStaticMeshDto>,
    pub animation_stacks: Vec<FbxAnimationStackDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxTextureDto {
    pub texture_index: u32,
    pub file_index: Option<u32>,
    pub kind: String,
    pub name: String,
    pub filename: String,
    pub relative_filename: String,
    pub absolute_filename: String,
    pub has_embedded_content: bool,
    pub embedded_content_size: u64,
    pub uv_set: String,
    pub wrap_u_repeat: bool,
    pub wrap_v_repeat: bool,
    pub has_uv_transform: bool,
    pub uv_translation: [f32; 2],
    pub uv_rotation: f32,
    pub uv_scale: [f32; 2],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxMaterialSlotDto {
    pub slot: String,
    pub source: String,
    pub texture_index: Option<u32>,
    pub file_index: Option<u32>,
    pub texture_enabled: bool,
    pub has_value: bool,
    pub value_components: u8,
    pub value: [f32; 4],
    pub material_prop: String,
    pub shader_prop: String,
    pub uv_set: String,
    pub wrap_u_repeat: bool,
    pub wrap_v_repeat: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxMaterialDto {
    pub material_index: u32,
    pub name: String,
    pub shader_type: u32,
    pub shading_model_name: String,
    pub double_sided: bool,
    pub unlit: bool,
    pub base_color: Option<[f32; 4]>,
    pub diffuse_color: Option<[f32; 4]>,
    pub opacity: Option<f32>,
    pub emissive_color: Option<[f32; 3]>,
    pub slots: Vec<FbxMaterialSlotDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxNodeDto {
    pub typed_id: u32,
    pub parent_typed_id: Option<u32>,
    pub name: String,
    pub is_bone: bool,
    pub local_translation: [f32; 3],
    pub local_rotation: [f32; 4],
    pub local_scale: [f32; 3],
    pub world_translation: [f32; 3],
    pub rest_translation: [f32; 3],
    pub rest_world_matrix: [f32; 16],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxBoneDto {
    pub bone_typed_id: u32,
    pub node_typed_id: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxStaticMeshDto {
    pub name: String,
    pub node_typed_id: Option<u32>,
    pub mesh_material_slot: u32,
    pub material_index: u32,
    pub skin_weight_stride: u32,
    pub vertex_count: u32,
    pub index_count: u32,
    pub vertices: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
    pub skin_weight_counts: Vec<u8>,
    pub skin_bone_node_typed_ids: Vec<u32>,
    pub skin_weights: Vec<f32>,
    pub minimum_extent: [f32; 3],
    pub maximum_extent: [f32; 3],
    pub bounds_radius: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxBakedVec3KeyDto {
    pub time_seconds: f64,
    pub value: [f32; 3],
    pub flags: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxBakedQuatKeyDto {
    pub time_seconds: f64,
    pub value: [f32; 4],
    pub flags: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxBakedNodeDto {
    pub node_typed_id: u32,
    pub constant_translation: bool,
    pub constant_rotation: bool,
    pub constant_scale: bool,
    pub translation_keys: Vec<FbxBakedVec3KeyDto>,
    pub rotation_keys: Vec<FbxBakedQuatKeyDto>,
    pub scale_keys: Vec<FbxBakedVec3KeyDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbxAnimationStackDto {
    pub stack_typed_id: u32,
    pub name: String,
    pub time_begin: f64,
    pub time_end: f64,
    pub playback_time_begin: f64,
    pub playback_time_end: f64,
    pub playback_duration: f64,
    pub baked_nodes: Vec<FbxBakedNodeDto>,
}
