use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxImportSettings {
    pub max_file_size_bytes: Option<u64>,
    #[allow(dead_code)]
    pub frames_per_second: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxProbeResult {
    pub ok: bool,
    pub path: String,
    pub file_size: u64,
    pub format: String,
    pub version: i32,
    pub head_size: u32,
    pub data_size: u32,
    pub head_compressed_size: u32,
    pub data_compressed_size: u32,
    pub texture_count: u32,
    pub material_count: u32,
    pub geometry_count: u32,
    pub bone_count: u32,
    pub bone_group_count: u32,
    pub attachment_count: u32,
    pub ribbon_count: u32,
    pub particle_count: u32,
    pub action_count: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxStaticSceneResult {
    pub probe: JumpxProbeResult,
    pub textures: Vec<JumpxTextureDto>,
    pub materials: Vec<JumpxMaterialDto>,
    pub geometries: Vec<JumpxGeometryDto>,
    pub bones: Vec<JumpxBoneDto>,
    pub bone_groups: Vec<JumpxBoneGroupDto>,
    pub attachments: Vec<JumpxAttachmentDto>,
    pub ribbons: Vec<JumpxRibbonDto>,
    pub particles: Vec<JumpxParticleDto>,
    pub actions: Vec<JumpxActionDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxTextureDto {
    pub texture_index: u32,
    pub name: String,
    pub path: String,
    pub raw_flags: u32,
    pub save_flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxMaterialDto {
    pub material_index: u32,
    pub name: String,
    pub texture_id: i32,
    pub raw_flags: u32,
    pub save_flags: u32,
    pub sample_count: u32,
    pub diffuse_color: Option<[f32; 4]>,
    pub emissive_color: Option<[f32; 3]>,
    pub alpha: Option<f32>,
    pub color_keys: Vec<JumpxVec3KeyDto>,
    pub alpha_keys: Vec<JumpxScalarKeyDto>,
    pub uv_offset_keys: Vec<JumpxVec3KeyDto>,
    pub blend_keys: Vec<JumpxScalarKeyDto>,
    pub uv_speed: Option<[f32; 2]>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxGeometryDto {
    pub geometry_index: u32,
    pub name: String,
    pub material_id: i32,
    pub geometry_type: u32,
    pub ancestor_bone_id: i32,
    pub vertex_count: u32,
    pub index_count: u32,
    pub vertices: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub uv2: Option<Vec<f32>>,
    pub vertex_colors: Option<Vec<u8>>,
    pub indices: Vec<u16>,
    pub skin_weight_stride: u32,
    pub skin_weight_counts: Vec<u8>,
    pub skin_bone_ids: Vec<u32>,
    pub skin_weights: Vec<f32>,
    pub minimum_extent: [f32; 3],
    pub maximum_extent: [f32; 3],
    pub bounds_radius: f32,
    pub object_pivot: [f32; 3],
    pub object_scale: [f32; 3],
    pub inverse_bind_matrix: Option<Vec<f32>>,
    pub raw_flags: u32,
    pub save_flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxBoneDto {
    pub bone_index: u32,
    pub name: String,
    pub parent_id: i32,
    pub world_translation: [f32; 3],
    pub local_translation: Option<[f32; 3]>,
    pub inverse_bind_matrix: Option<Vec<f32>>,
    pub bind_matrix: Option<Vec<f32>>,
    pub raw_flags: u32,
    pub save_flags: u32,
    pub position_keys: Vec<JumpxVec3KeyDto>,
    pub rotation_keys: Vec<JumpxQuatKeyDto>,
    pub scale_keys: Vec<JumpxVec3KeyDto>,
    pub visibility_keys: Vec<JumpxScalarKeyDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxBoneGroupDto {
    pub bone_group_index: u32,
    pub name: String,
    pub bone_ids: Vec<u32>,
    pub raw_flags: u32,
    pub save_flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxAttachmentDto {
    pub attachment_index: u32,
    pub name: String,
    pub parent_bone_id: i32,
    pub path: String,
    pub pivot: [f32; 3],
    pub raw_flags: u32,
    pub save_flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxRibbonDto {
    pub ribbon_index: u32,
    pub name: String,
    pub parent_bone_id: i32,
    pub material_id: i32,
    pub texture_slot: i32,
    pub pivot: [f32; 3],
    pub raw_flags: u32,
    pub save_flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxParticleDto {
    pub particle_index: u32,
    pub name: String,
    pub parent_bone_id: i32,
    pub pivot: [f32; 3],
    pub texture_id: i32,
    pub raw_flags: u32,
    pub save_flags: u32,
    pub raw_data_addr: u32,
    pub particle_flags: u32,
    pub blend_mode: u32,
    pub part_flags: u32,
    pub emission_rate: f32,
    pub speed: f32,
    pub speed_variation: f32,
    pub cone_angle: f32,
    pub gravity: f32,
    pub gravity_x: Option<f32>,
    pub gravity_y: Option<f32>,
    pub life_random: Option<[f32; 2]>,
    pub life_span: f32,
    pub width: f32,
    pub height: f32,
    pub rows: i32,
    pub columns: i32,
    pub priority_plane: i32,
    pub start_color: [i32; 3],
    pub mid_color: [i32; 3],
    pub end_color: [i32; 3],
    pub alpha: [i32; 3],
    pub particle_scaling: [f32; 3],
    pub middle_time: f32,
    pub tail_length: f32,
    pub normal: [f32; 3],
    pub x_axis: [f32; 3],
    pub y_axis: [f32; 3],
    pub rot_vec: [f32; 3],
    pub rot_vel: [f32; 3],
    pub life_span_head_uv_anim: [u32; 3],
    pub decay_head_uv_anim: [u32; 3],
    pub life_span_tail_uv_anim: [u32; 3],
    pub decay_tail_uv_anim: [u32; 3],
    pub emission_rate_keys: Vec<JumpxScalarKeyDto>,
    pub visibility_keys: Vec<JumpxScalarKeyDto>,
    pub unsupported_notes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxActionDto {
    pub action_index: u32,
    pub name: String,
    pub start_frame: i16,
    pub end_frame: i16,
    pub raw_flags: u32,
    pub save_flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxVec3KeyDto {
    pub frame: u32,
    pub time_ms: Option<f32>,
    pub value: [f32; 3],
    pub raw_flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxQuatKeyDto {
    pub frame: u32,
    pub time_ms: Option<f32>,
    pub value: [f32; 4],
    pub raw_flags: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpxScalarKeyDto {
    pub frame: u32,
    pub time_ms: Option<f32>,
    pub value: f32,
    pub raw_flags: u32,
}
