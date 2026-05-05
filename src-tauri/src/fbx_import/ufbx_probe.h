#pragma once

#include <stddef.h>
#include <stdint.h>

typedef struct war3_fbx_probe_result {
    uint32_t node_count;
    uint32_t mesh_count;
    uint32_t material_count;
    uint32_t texture_count;
    uint32_t skin_deformer_count;
    uint32_t bone_count;
    uint32_t animation_stack_count;
    uint32_t camera_count;
    uint32_t light_count;
    double unit_meters;
    double frames_per_second;
    char error[1024];
} war3_fbx_probe_result;

typedef struct war3_fbx_texture_dto {
    uint32_t texture_index;
    uint32_t file_index;
    uint32_t kind;
    uint8_t has_file;
    uint8_t has_embedded_content;
    uint64_t embedded_content_size;
    char *name;
    char *filename;
    char *relative_filename;
    char *absolute_filename;
    char *uv_set;
    uint8_t wrap_u_repeat;
    uint8_t wrap_v_repeat;
    uint8_t has_uv_transform;
    float uv_translation[2];
    float uv_rotation;
    float uv_scale[2];
} war3_fbx_texture_dto;

typedef struct war3_fbx_material_slot_dto {
    uint32_t slot_kind;
    uint32_t texture_index;
    uint32_t file_index;
    uint8_t texture_enabled;
    uint8_t has_value;
    uint8_t value_components;
    float value[4];
    char *source;
    char *material_prop;
    char *shader_prop;
    char *uv_set;
    uint8_t wrap_u_repeat;
    uint8_t wrap_v_repeat;
} war3_fbx_material_slot_dto;

typedef struct war3_fbx_material_dto {
    uint32_t material_index;
    char *name;
    uint32_t shader_type;
    char *shading_model_name;
    uint8_t double_sided;
    uint8_t unlit;
    float base_color[4];
    uint8_t has_base_color;
    float diffuse_color[4];
    uint8_t has_diffuse_color;
    float opacity;
    uint8_t has_opacity;
    float emissive_color[3];
    uint8_t has_emissive_color;
    uint32_t slot_count;
    war3_fbx_material_slot_dto *slots;
} war3_fbx_material_dto;

typedef struct war3_fbx_node_dto {
    uint32_t typed_id;
    uint32_t parent_typed_id;
    char *name;
    uint8_t is_bone;
    float local_translation[3];
    float local_rotation[4];
    float local_scale[3];
    float world_translation[3];
    float rest_translation[3];
    float rest_world_matrix[16];
} war3_fbx_node_dto;

typedef struct war3_fbx_bone_dto {
    uint32_t bone_typed_id;
    uint32_t node_typed_id;
} war3_fbx_bone_dto;

typedef struct war3_fbx_baked_vec3_key {
    double time_seconds;
    float value[3];
    uint32_t flags;
} war3_fbx_baked_vec3_key;

typedef struct war3_fbx_baked_quat_key {
    double time_seconds;
    float value[4];
    uint32_t flags;
} war3_fbx_baked_quat_key;

typedef struct war3_fbx_baked_node_dto {
    uint32_t node_typed_id;
    uint8_t constant_translation;
    uint8_t constant_rotation;
    uint8_t constant_scale;
    uint32_t translation_key_count;
    war3_fbx_baked_vec3_key *translation_keys;
    uint32_t rotation_key_count;
    war3_fbx_baked_quat_key *rotation_keys;
    uint32_t scale_key_count;
    war3_fbx_baked_vec3_key *scale_keys;
} war3_fbx_baked_node_dto;

typedef struct war3_fbx_animation_stack_dto {
    uint32_t stack_typed_id;
    char *name;
    double time_begin;
    double time_end;
    double playback_time_begin;
    double playback_time_end;
    double playback_duration;
    uint32_t baked_node_count;
    war3_fbx_baked_node_dto *baked_nodes;
} war3_fbx_animation_stack_dto;

typedef struct war3_fbx_static_mesh {
    const char *name;
    uint32_t node_typed_id;
    uint32_t mesh_material_slot;
    uint32_t material_index;
    uint32_t skin_weight_stride;
    uint32_t vertex_count;
    uint32_t index_count;
    float *vertices;
    float *normals;
    float *uvs;
    uint32_t *indices;
    uint8_t *skin_weight_counts;
    uint32_t *skin_bone_node_typed_ids;
    float *skin_weights;
    float minimum_extent[3];
    float maximum_extent[3];
    float bounds_radius;
} war3_fbx_static_mesh;

typedef struct war3_fbx_static_scene {
    war3_fbx_probe_result probe;
    uint32_t node_count;
    war3_fbx_node_dto *nodes;
    uint32_t bone_count;
    war3_fbx_bone_dto *bones;
    uint32_t texture_count;
    war3_fbx_texture_dto *textures;
    uint32_t material_count;
    war3_fbx_material_dto *materials;
    uint32_t mesh_count;
    war3_fbx_static_mesh *meshes;
    uint32_t animation_stack_count;
    war3_fbx_animation_stack_dto *animation_stacks;
} war3_fbx_static_scene;

int war3_fbx_probe_file(const char *path, war3_fbx_probe_result *out_result);
int war3_fbx_load_static_scene(const char *path, war3_fbx_static_scene *out_scene);
void war3_fbx_free_static_scene(war3_fbx_static_scene *scene);
