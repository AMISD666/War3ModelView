#include "ufbx_probe.h"
#include "ufbx_skin_weights.h"

#include "ufbx.h"

#include <math.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#define WAR3_FBX_NO_INDEX UINT32_MAX

enum {
    WAR3_FBX_SLOT_BASE_COLOR = 0,
    WAR3_FBX_SLOT_DIFFUSE_COLOR = 1,
    WAR3_FBX_SLOT_OPACITY = 2,
    WAR3_FBX_SLOT_NORMAL = 3,
    WAR3_FBX_SLOT_EMISSION = 4,
    WAR3_FBX_SLOT_ROUGHNESS = 5,
    WAR3_FBX_SLOT_METALNESS = 6,
    WAR3_FBX_SLOT_AMBIENT_OCCLUSION = 7,
    WAR3_FBX_SLOT_REFLECTION = 8,
    WAR3_FBX_SLOT_SPECULAR = 9,
};

static uint32_t war3_count_to_u32(size_t value)
{
    return value > UINT32_MAX ? UINT32_MAX : (uint32_t)value;
}

static void war3_fill_probe_from_scene(war3_fbx_probe_result *out_result, const ufbx_scene *scene)
{
    out_result->node_count = war3_count_to_u32(scene->nodes.count);
    out_result->mesh_count = war3_count_to_u32(scene->meshes.count);
    out_result->material_count = war3_count_to_u32(scene->materials.count);
    out_result->texture_count = war3_count_to_u32(scene->textures.count);
    out_result->skin_deformer_count = war3_count_to_u32(scene->skin_deformers.count);
    out_result->bone_count = war3_count_to_u32(scene->bones.count);
    out_result->animation_stack_count = war3_count_to_u32(scene->anim_stacks.count);
    out_result->camera_count = war3_count_to_u32(scene->cameras.count);
    out_result->light_count = war3_count_to_u32(scene->lights.count);
    out_result->unit_meters = scene->settings.unit_meters;
    out_result->frames_per_second = scene->settings.frames_per_second;
}

static ufbx_scene *war3_load_scene(const char *path, war3_fbx_probe_result *out_result)
{
    if (!out_result) {
        return NULL;
    }

    memset(out_result, 0, sizeof(*out_result));

    if (!path || path[0] == '\0') {
        strncpy(out_result->error, "FBX path is empty", sizeof(out_result->error) - 1);
        return NULL;
    }

    ufbx_load_opts opts;
    memset(&opts, 0, sizeof(opts));
    opts.load_external_files = false;
    opts.evaluate_skinning = true;
    opts.generate_missing_normals = true;
    opts.target_axes = ufbx_axes_right_handed_z_up;
    opts.target_unit_meters = 0.01;
    opts.space_conversion = UFBX_SPACE_CONVERSION_ADJUST_TRANSFORMS;
    opts.geometry_transform_handling = UFBX_GEOMETRY_TRANSFORM_HANDLING_MODIFY_GEOMETRY;

    ufbx_error error;
    memset(&error, 0, sizeof(error));

    ufbx_scene *scene = ufbx_load_file(path, &opts, &error);
    if (!scene) {
        ufbx_format_error(out_result->error, sizeof(out_result->error), &error);
        return NULL;
    }

    war3_fill_probe_from_scene(out_result, scene);
    return scene;
}

int war3_fbx_probe_file(const char *path, war3_fbx_probe_result *out_result)
{
    ufbx_scene *scene = war3_load_scene(path, out_result);
    if (!scene) {
        return 0;
    }
    ufbx_free_scene(scene);
    return 1;
}

static char *war3_copy_string(ufbx_string value)
{
    size_t length = value.length;
    char *copy = (char*)malloc(length + 1);
    if (!copy) {
        return NULL;
    }
    if (length > 0 && value.data) {
        memcpy(copy, value.data, length);
    }
    copy[length] = '\0';
    return copy;
}

static char *war3_copy_literal(const char *value)
{
    size_t length = value ? strlen(value) : 0;
    char *copy = (char*)malloc(length + 1);
    if (!copy) {
        return NULL;
    }
    if (length > 0) {
        memcpy(copy, value, length);
    }
    copy[length] = '\0';
    return copy;
}

static uint32_t war3_index_or_no_index(uint32_t value)
{
    return value == UFBX_NO_INDEX ? WAR3_FBX_NO_INDEX : value;
}

static void war3_map_value_to_float4(const ufbx_material_map *map, float *out_value)
{
    out_value[0] = (float)map->value_vec4.x;
    out_value[1] = (float)map->value_vec4.y;
    out_value[2] = (float)map->value_vec4.z;
    out_value[3] = map->value_components >= 4 ? (float)map->value_vec4.w : 1.0f;
}

static uint32_t war3_texture_index(const ufbx_texture *texture)
{
    return texture ? texture->typed_id : WAR3_FBX_NO_INDEX;
}

static uint32_t war3_texture_file_index(const ufbx_texture *texture)
{
    return texture && texture->has_file ? war3_index_or_no_index(texture->file_index) : WAR3_FBX_NO_INDEX;
}

static void war3_fill_slot_value(const ufbx_material_map *map, war3_fbx_material_slot_dto *slot)
{
    slot->texture_index = war3_texture_index(map->texture);
    slot->file_index = war3_texture_file_index(map->texture);
    slot->texture_enabled = map->texture_enabled ? 1 : 0;
    slot->has_value = map->has_value ? 1 : 0;
    slot->value_components = map->value_components;
    war3_map_value_to_float4(map, slot->value);
    if (map->texture) {
        slot->uv_set = war3_copy_string(map->texture->uv_set);
        slot->wrap_u_repeat = map->texture->wrap_u == UFBX_WRAP_REPEAT ? 1 : 0;
        slot->wrap_v_repeat = map->texture->wrap_v == UFBX_WRAP_REPEAT ? 1 : 0;
    }
}

static void war3_add_material_slot(
    war3_fbx_material_slot_dto *slots,
    uint32_t *slot_count,
    uint32_t slot_kind,
    const char *source,
    const ufbx_material_map *map)
{
    if (!map || (!map->texture && !map->has_value)) {
        return;
    }

    war3_fbx_material_slot_dto *slot = &slots[*slot_count];
    memset(slot, 0, sizeof(*slot));
    slot->slot_kind = slot_kind;
    slot->source = war3_copy_literal(source);
    slot->material_prop = war3_copy_literal(source);
    slot->shader_prop = war3_copy_literal("");
    war3_fill_slot_value(map, slot);
    (*slot_count)++;
}

static void war3_free_material_slot(war3_fbx_material_slot_dto *slot)
{
    free(slot->source);
    free(slot->material_prop);
    free(slot->shader_prop);
    free(slot->uv_set);
}

static bool war3_fill_texture(const ufbx_texture *texture, war3_fbx_texture_dto *out_texture)
{
    memset(out_texture, 0, sizeof(*out_texture));
    out_texture->texture_index = texture->typed_id;
    out_texture->file_index = war3_texture_file_index(texture);
    out_texture->kind = (uint32_t)texture->type;
    out_texture->has_file = texture->has_file ? 1 : 0;
    out_texture->has_embedded_content = texture->content.size > 0 ? 1 : 0;
    out_texture->embedded_content_size = (uint64_t)texture->content.size;
    out_texture->name = war3_copy_string(texture->name);
    out_texture->filename = war3_copy_string(texture->filename);
    out_texture->relative_filename = war3_copy_string(texture->relative_filename);
    out_texture->absolute_filename = war3_copy_string(texture->absolute_filename);
    out_texture->uv_set = war3_copy_string(texture->uv_set);
    out_texture->wrap_u_repeat = texture->wrap_u == UFBX_WRAP_REPEAT ? 1 : 0;
    out_texture->wrap_v_repeat = texture->wrap_v == UFBX_WRAP_REPEAT ? 1 : 0;
    out_texture->has_uv_transform = texture->has_uv_transform ? 1 : 0;
    out_texture->uv_translation[0] = (float)texture->uv_transform.translation.x;
    out_texture->uv_translation[1] = (float)texture->uv_transform.translation.y;
    out_texture->uv_rotation = (float)texture->uv_transform.rotation.w;
    out_texture->uv_scale[0] = (float)texture->uv_transform.scale.x;
    out_texture->uv_scale[1] = (float)texture->uv_transform.scale.y;
    return true;
}

static void war3_free_texture(war3_fbx_texture_dto *texture)
{
    free(texture->name);
    free(texture->filename);
    free(texture->relative_filename);
    free(texture->absolute_filename);
    free(texture->uv_set);
}

static bool war3_fill_material(const ufbx_material *material, war3_fbx_material_dto *out_material)
{
    memset(out_material, 0, sizeof(*out_material));
    out_material->material_index = material->typed_id;
    out_material->name = war3_copy_string(material->name);
    out_material->shader_type = (uint32_t)material->shader_type;
    out_material->shading_model_name = war3_copy_string(material->shading_model_name);
    out_material->double_sided = material->features.double_sided.enabled ? 1 : 0;
    out_material->unlit = material->features.unlit.enabled ? 1 : 0;

    if (material->pbr.base_color.has_value) {
        out_material->has_base_color = 1;
        war3_map_value_to_float4(&material->pbr.base_color, out_material->base_color);
    } else if (material->fbx.diffuse_color.has_value) {
        out_material->has_base_color = 1;
        war3_map_value_to_float4(&material->fbx.diffuse_color, out_material->base_color);
    }

    if (material->fbx.diffuse_color.has_value) {
        out_material->has_diffuse_color = 1;
        war3_map_value_to_float4(&material->fbx.diffuse_color, out_material->diffuse_color);
    }

    if (material->pbr.opacity.has_value) {
        out_material->has_opacity = 1;
        out_material->opacity = (float)material->pbr.opacity.value_real;
    } else if (material->fbx.transparency_factor.has_value) {
        out_material->has_opacity = 1;
        out_material->opacity = 1.0f - (float)material->fbx.transparency_factor.value_real;
    }

    if (material->pbr.emission_color.has_value) {
        out_material->has_emissive_color = 1;
        out_material->emissive_color[0] = (float)material->pbr.emission_color.value_vec3.x;
        out_material->emissive_color[1] = (float)material->pbr.emission_color.value_vec3.y;
        out_material->emissive_color[2] = (float)material->pbr.emission_color.value_vec3.z;
    } else if (material->fbx.emission_color.has_value) {
        out_material->has_emissive_color = 1;
        out_material->emissive_color[0] = (float)material->fbx.emission_color.value_vec3.x;
        out_material->emissive_color[1] = (float)material->fbx.emission_color.value_vec3.y;
        out_material->emissive_color[2] = (float)material->fbx.emission_color.value_vec3.z;
    }

    const uint32_t max_slots = 10;
    out_material->slots = (war3_fbx_material_slot_dto*)calloc(max_slots, sizeof(war3_fbx_material_slot_dto));
    if (!out_material->slots) {
        return false;
    }

    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_BASE_COLOR, "pbr.base_color", &material->pbr.base_color);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_DIFFUSE_COLOR, "fbx.diffuse_color", &material->fbx.diffuse_color);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_OPACITY, "pbr.opacity", &material->pbr.opacity);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_OPACITY, "fbx.transparency_factor", &material->fbx.transparency_factor);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_NORMAL, "pbr.normal_map", &material->pbr.normal_map);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_NORMAL, "fbx.normal_map", &material->fbx.normal_map);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_EMISSION, "pbr.emission_color", &material->pbr.emission_color);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_EMISSION, "fbx.emission_color", &material->fbx.emission_color);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_ROUGHNESS, "pbr.roughness", &material->pbr.roughness);
    war3_add_material_slot(out_material->slots, &out_material->slot_count, WAR3_FBX_SLOT_METALNESS, "pbr.metalness", &material->pbr.metalness);
    return true;
}

static void war3_free_material(war3_fbx_material_dto *material)
{
    free(material->name);
    free(material->shading_model_name);
    for (uint32_t i = 0; i < material->slot_count; i++) {
        war3_free_material_slot(&material->slots[i]);
    }
    free(material->slots);
}

static void war3_vec3_to_float3(ufbx_vec3 value, float *out_value)
{
    out_value[0] = (float)value.x;
    out_value[1] = (float)value.y;
    out_value[2] = (float)value.z;
}

static void war3_quat_to_float4(ufbx_quat value, float *out_value)
{
    double length_sq =
        value.x * value.x +
        value.y * value.y +
        value.z * value.z +
        value.w * value.w;
    if (!isfinite(value.x) || !isfinite(value.y) || !isfinite(value.z) || !isfinite(value.w) || length_sq <= 0.0) {
        out_value[0] = 0.0f;
        out_value[1] = 0.0f;
        out_value[2] = 0.0f;
        out_value[3] = 1.0f;
        return;
    }
    out_value[0] = (float)value.x;
    out_value[1] = (float)value.y;
    out_value[2] = (float)value.z;
    out_value[3] = (float)value.w;
}

static ufbx_vec3 war3_matrix_translation(const ufbx_matrix *matrix)
{
    return (ufbx_vec3){{matrix->m03, matrix->m13, matrix->m23}};
}

static void war3_matrix_to_float4x4(const ufbx_matrix *matrix, float out_matrix[16])
{
    const ufbx_matrix *source = matrix ? matrix : &ufbx_identity_matrix;
    out_matrix[0] = (float)source->m00;
    out_matrix[1] = (float)source->m10;
    out_matrix[2] = (float)source->m20;
    out_matrix[3] = 0.0f;
    out_matrix[4] = (float)source->m01;
    out_matrix[5] = (float)source->m11;
    out_matrix[6] = (float)source->m21;
    out_matrix[7] = 0.0f;
    out_matrix[8] = (float)source->m02;
    out_matrix[9] = (float)source->m12;
    out_matrix[10] = (float)source->m22;
    out_matrix[11] = 0.0f;
    out_matrix[12] = (float)source->m03;
    out_matrix[13] = (float)source->m13;
    out_matrix[14] = (float)source->m23;
    out_matrix[15] = 1.0f;
}

static const ufbx_bone_pose *war3_node_bind_pose(const ufbx_node *node)
{
    if (!node || !node->bind_pose) {
        return NULL;
    }
    return ufbx_get_bone_pose(node->bind_pose, node);
}

static bool war3_fill_node(const ufbx_node *node, war3_fbx_node_dto *out_node)
{
    memset(out_node, 0, sizeof(*out_node));
    out_node->typed_id = node->typed_id;
    out_node->parent_typed_id = node->parent ? node->parent->typed_id : WAR3_FBX_NO_INDEX;
    out_node->name = war3_copy_string(node->name);
    if (!out_node->name) {
        return false;
    }
    out_node->is_bone = node->bone ? 1 : 0;
    war3_vec3_to_float3(node->local_transform.translation, out_node->local_translation);
    war3_quat_to_float4(node->local_transform.rotation, out_node->local_rotation);
    war3_vec3_to_float3(node->local_transform.scale, out_node->local_scale);
    war3_vec3_to_float3(war3_matrix_translation(&node->node_to_world), out_node->world_translation);

    const ufbx_bone_pose *bind_pose = war3_node_bind_pose(node);
    if (bind_pose) {
        war3_vec3_to_float3(war3_matrix_translation(&bind_pose->bone_to_world), out_node->rest_translation);
        war3_matrix_to_float4x4(&bind_pose->bone_to_world, out_node->rest_world_matrix);
    } else {
        war3_vec3_to_float3(war3_matrix_translation(&node->node_to_world), out_node->rest_translation);
        war3_matrix_to_float4x4(&node->node_to_world, out_node->rest_world_matrix);
    }
    return true;
}

static void war3_free_node(war3_fbx_node_dto *node)
{
    free(node->name);
}

static uint32_t war3_bone_node_typed_id(const ufbx_bone *bone)
{
    if (!bone || bone->instances.count == 0 || !bone->instances.data[0]) {
        return WAR3_FBX_NO_INDEX;
    }
    return bone->instances.data[0]->typed_id;
}

static void war3_fill_bone(const ufbx_bone *bone, war3_fbx_bone_dto *out_bone)
{
    memset(out_bone, 0, sizeof(*out_bone));
    out_bone->bone_typed_id = bone->typed_id;
    out_bone->node_typed_id = war3_bone_node_typed_id(bone);
}

static void war3_free_static_mesh(war3_fbx_static_mesh *mesh)
{
    free((void*)mesh->name);
    free(mesh->vertices);
    free(mesh->normals);
    free(mesh->uvs);
    free(mesh->indices);
    free(mesh->skin_weight_counts);
    free(mesh->skin_bone_node_typed_ids);
    free(mesh->skin_weights);
    memset(mesh, 0, sizeof(*mesh));
}

static void war3_fill_baked_vec3_key(const ufbx_baked_vec3 *key, war3_fbx_baked_vec3_key *out_key)
{
    out_key->time_seconds = key->time;
    out_key->value[0] = (float)key->value.x;
    out_key->value[1] = (float)key->value.y;
    out_key->value[2] = (float)key->value.z;
    out_key->flags = (uint32_t)key->flags;
}

static void war3_fill_baked_quat_key(const ufbx_baked_quat *key, war3_fbx_baked_quat_key *out_key)
{
    out_key->time_seconds = key->time;
    out_key->value[0] = (float)key->value.x;
    out_key->value[1] = (float)key->value.y;
    out_key->value[2] = (float)key->value.z;
    out_key->value[3] = (float)key->value.w;
    out_key->flags = (uint32_t)key->flags;
}

static bool war3_copy_baked_vec3_keys(ufbx_baked_vec3_list keys, uint32_t *out_count, war3_fbx_baked_vec3_key **out_keys)
{
    *out_count = war3_count_to_u32(keys.count);
    *out_keys = NULL;
    if (*out_count == 0) {
        return true;
    }
    *out_keys = (war3_fbx_baked_vec3_key*)calloc(*out_count, sizeof(war3_fbx_baked_vec3_key));
    if (!*out_keys) {
        return false;
    }
    for (uint32_t i = 0; i < *out_count; i++) {
        war3_fill_baked_vec3_key(&keys.data[i], &(*out_keys)[i]);
    }
    return true;
}

static bool war3_copy_baked_quat_keys(ufbx_baked_quat_list keys, uint32_t *out_count, war3_fbx_baked_quat_key **out_keys)
{
    *out_count = war3_count_to_u32(keys.count);
    *out_keys = NULL;
    if (*out_count == 0) {
        return true;
    }
    *out_keys = (war3_fbx_baked_quat_key*)calloc(*out_count, sizeof(war3_fbx_baked_quat_key));
    if (!*out_keys) {
        return false;
    }
    for (uint32_t i = 0; i < *out_count; i++) {
        war3_fill_baked_quat_key(&keys.data[i], &(*out_keys)[i]);
    }
    return true;
}

static bool war3_fill_baked_node(const ufbx_baked_node *node, war3_fbx_baked_node_dto *out_node)
{
    memset(out_node, 0, sizeof(*out_node));
    out_node->node_typed_id = node->typed_id;
    out_node->constant_translation = node->constant_translation ? 1 : 0;
    out_node->constant_rotation = node->constant_rotation ? 1 : 0;
    out_node->constant_scale = node->constant_scale ? 1 : 0;
    if (!war3_copy_baked_vec3_keys(node->translation_keys, &out_node->translation_key_count, &out_node->translation_keys)) {
        return false;
    }
    if (!war3_copy_baked_quat_keys(node->rotation_keys, &out_node->rotation_key_count, &out_node->rotation_keys)) {
        return false;
    }
    if (!war3_copy_baked_vec3_keys(node->scale_keys, &out_node->scale_key_count, &out_node->scale_keys)) {
        return false;
    }
    return true;
}

static void war3_free_baked_node(war3_fbx_baked_node_dto *node)
{
    free(node->translation_keys);
    free(node->rotation_keys);
    free(node->scale_keys);
    memset(node, 0, sizeof(*node));
}

static bool war3_fill_animation_stack(const ufbx_scene *scene, const ufbx_anim_stack *stack, war3_fbx_animation_stack_dto *out_stack)
{
    memset(out_stack, 0, sizeof(*out_stack));
    out_stack->stack_typed_id = stack->typed_id;
    out_stack->name = war3_copy_string(stack->name);
    out_stack->time_begin = stack->time_begin;
    out_stack->time_end = stack->time_end;

    ufbx_bake_opts opts;
    memset(&opts, 0, sizeof(opts));
    opts.trim_start_time = true;
    opts.resample_rate = scene->settings.frames_per_second > 0.0 ? scene->settings.frames_per_second : 30.0;
    opts.maximum_sample_rate = 60.0;
    opts.step_handling = UFBX_BAKE_STEP_HANDLING_DEFAULT;
    opts.key_reduction_enabled = true;
    opts.key_reduction_rotation = true;

    ufbx_error error;
    memset(&error, 0, sizeof(error));
    ufbx_baked_anim *bake = ufbx_bake_anim(scene, stack->anim, &opts, &error);
    if (!bake) {
        return false;
    }

    out_stack->playback_time_begin = bake->playback_time_begin;
    out_stack->playback_time_end = bake->playback_time_end;
    out_stack->playback_duration = bake->playback_duration;
    out_stack->baked_node_count = war3_count_to_u32(bake->nodes.count);
    if (out_stack->baked_node_count > 0) {
        out_stack->baked_nodes = (war3_fbx_baked_node_dto*)calloc(out_stack->baked_node_count, sizeof(war3_fbx_baked_node_dto));
        if (!out_stack->baked_nodes) {
            ufbx_free_baked_anim(bake);
            return false;
        }
        for (uint32_t i = 0; i < out_stack->baked_node_count; i++) {
            if (!war3_fill_baked_node(&bake->nodes.data[i], &out_stack->baked_nodes[i])) {
                ufbx_free_baked_anim(bake);
                return false;
            }
        }
    }
    ufbx_free_baked_anim(bake);
    return true;
}

static void war3_free_animation_stack(war3_fbx_animation_stack_dto *stack)
{
    free(stack->name);
    for (uint32_t i = 0; i < stack->baked_node_count; i++) {
        war3_free_baked_node(&stack->baked_nodes[i]);
    }
    free(stack->baked_nodes);
    memset(stack, 0, sizeof(*stack));
}

static void war3_init_bounds(float *min_extent, float *max_extent)
{
    min_extent[0] = min_extent[1] = min_extent[2] = INFINITY;
    max_extent[0] = max_extent[1] = max_extent[2] = -INFINITY;
}

static void war3_add_bounds(float *min_extent, float *max_extent, float x, float y, float z)
{
    if (x < min_extent[0]) min_extent[0] = x;
    if (y < min_extent[1]) min_extent[1] = y;
    if (z < min_extent[2]) min_extent[2] = z;
    if (x > max_extent[0]) max_extent[0] = x;
    if (y > max_extent[1]) max_extent[1] = y;
    if (z > max_extent[2]) max_extent[2] = z;
}

static float war3_compute_radius(const float *min_extent, const float *max_extent)
{
    float max_abs_sq = 0.0f;
    for (int i = 0; i < 8; i++) {
        float x = (i & 1) ? max_extent[0] : min_extent[0];
        float y = (i & 2) ? max_extent[1] : min_extent[1];
        float z = (i & 4) ? max_extent[2] : min_extent[2];
        float sq = x * x + y * y + z * z;
        if (sq > max_abs_sq) {
            max_abs_sq = sq;
        }
    }
    return sqrtf(max_abs_sq);
}

static bool war3_face_matches_material(const ufbx_mesh *mesh, size_t face_index, uint32_t material_index)
{
    if (mesh->material_parts.count <= 1) {
        return material_index == 0;
    }
    if (face_index >= mesh->face_material.count) {
        return material_index == 0;
    }
    return mesh->face_material.data[face_index] == material_index;
}

static uint32_t war3_count_mesh_parts(const ufbx_mesh *mesh)
{
    return mesh->material_parts.count > 0 ? war3_count_to_u32(mesh->material_parts.count) : 1;
}

static size_t war3_count_part_triangles(const ufbx_mesh *mesh, uint32_t material_index)
{
    if (mesh->material_parts.count > 0 && material_index < mesh->material_parts.count) {
        return mesh->material_parts.data[material_index].num_triangles;
    }
    return mesh->num_triangles;
}

static const ufbx_node *war3_material_owner_node(const ufbx_node *node)
{
    if (node && node->is_geometry_transform_helper && node->parent) {
        return node->parent;
    }
    return node;
}

static uint32_t war3_global_material_index_for_slot(const ufbx_node *node, const ufbx_mesh *mesh, uint32_t mesh_material_slot)
{
    const ufbx_node *material_node = war3_material_owner_node(node);
    if (material_node && mesh_material_slot < material_node->materials.count && material_node->materials.data[mesh_material_slot]) {
        return material_node->materials.data[mesh_material_slot]->typed_id;
    }
    if (node && node != material_node && mesh_material_slot < node->materials.count && node->materials.data[mesh_material_slot]) {
        return node->materials.data[mesh_material_slot]->typed_id;
    }
    if (mesh_material_slot < mesh->materials.count && mesh->materials.data[mesh_material_slot]) {
        return mesh->materials.data[mesh_material_slot]->typed_id;
    }
    return 0;
}

static bool war3_node_has_mesh(const ufbx_node *node)
{
    return node && !node->is_root && node->mesh;
}

static char *war3_mesh_instance_name(const ufbx_node *node, const ufbx_mesh *mesh)
{
    if (node && node->is_geometry_transform_helper && node->parent && node->parent->name.length > 0) {
        return war3_copy_string(node->parent->name);
    }
    if (node && node->name.length > 0) {
        return war3_copy_string(node->name);
    }
    return war3_copy_string(mesh->name);
}

static ufbx_vec3 war3_transform_normal(const ufbx_matrix *normal_matrix, ufbx_vec3 normal)
{
    return ufbx_vec3_normalize(ufbx_transform_direction(normal_matrix, normal));
}

static const ufbx_skin_deformer *war3_primary_skin_deformer(const ufbx_mesh *mesh)
{
    if (!mesh || mesh->skin_deformers.count == 0) {
        return NULL;
    }
    return mesh->skin_deformers.data[0];
}

static bool war3_fill_static_mesh_part(const ufbx_node *node, uint32_t material_index, war3_fbx_static_mesh *out_mesh)
{
    const ufbx_mesh *mesh = node->mesh;
    const ufbx_skin_deformer *skin = war3_primary_skin_deformer(mesh);
    const size_t triangle_count = war3_count_part_triangles(mesh, material_index);
    const size_t vertex_count = triangle_count * 3;
    const size_t index_count = vertex_count;
    if (vertex_count == 0 || vertex_count > UINT32_MAX || index_count > UINT32_MAX) {
        return false;
    }

    out_mesh->name = war3_mesh_instance_name(node, mesh);
    out_mesh->node_typed_id = node->typed_id;
    out_mesh->mesh_material_slot = material_index;
    out_mesh->material_index = war3_global_material_index_for_slot(node, mesh, material_index);
    out_mesh->skin_weight_stride = skin ? WAR3_FBX_MAX_VERTEX_WEIGHTS : 0;
    out_mesh->vertex_count = (uint32_t)vertex_count;
    out_mesh->index_count = (uint32_t)index_count;
    out_mesh->vertices = (float*)calloc(vertex_count * 3, sizeof(float));
    out_mesh->normals = (float*)calloc(vertex_count * 3, sizeof(float));
    out_mesh->uvs = (float*)calloc(vertex_count * 2, sizeof(float));
    out_mesh->indices = (uint32_t*)calloc(index_count, sizeof(uint32_t));
    war3_init_bounds(out_mesh->minimum_extent, out_mesh->maximum_extent);

    if (!out_mesh->vertices || !out_mesh->normals || !out_mesh->uvs || !out_mesh->indices) {
        return false;
    }
    if (!war3_fbx_allocate_skin_weight_buffers(out_mesh, skin)) {
        return false;
    }

    const size_t tri_index_capacity = mesh->max_face_triangles > 0 ? mesh->max_face_triangles * 3 : 3;
    uint32_t *tri_indices = (uint32_t*)malloc(tri_index_capacity * sizeof(uint32_t));
    if (!tri_indices) {
        return false;
    }

    const ufbx_matrix *position_matrix = &node->geometry_to_world;
    ufbx_matrix normal_matrix = position_matrix ? ufbx_matrix_for_normals(position_matrix) : ufbx_identity_matrix;
    size_t write_vertex = 0;
    for (size_t face_index = 0; face_index < mesh->faces.count; face_index++) {
        if (!war3_face_matches_material(mesh, face_index, material_index)) {
            continue;
        }

        ufbx_face face = mesh->faces.data[face_index];
        uint32_t num_triangles = ufbx_triangulate_face(tri_indices, tri_index_capacity, mesh, face);
        uint32_t num_indices = num_triangles * 3;
        for (uint32_t index_offset = 0; index_offset < num_indices; index_offset++) {
            if (write_vertex >= vertex_count) {
                break;
            }

            uint32_t mesh_index = tri_indices[index_offset];
            ufbx_vec3 position = ufbx_get_vertex_vec3(&mesh->vertex_position, mesh_index);
            ufbx_vec3 normal = mesh->vertex_normal.exists
                ? ufbx_get_vertex_vec3(&mesh->vertex_normal, mesh_index)
                : (ufbx_vec3){{0.0, 0.0, 1.0}};
            if (position_matrix) {
                position = ufbx_transform_position(position_matrix, position);
            }
            normal = war3_transform_normal(&normal_matrix, normal);
            ufbx_vec2 uv = mesh->vertex_uv.exists
                ? ufbx_get_vertex_vec2(&mesh->vertex_uv, mesh_index)
                : (ufbx_vec2){{0.0, 0.0}};

            size_t vertex_base = write_vertex * 3;
            out_mesh->vertices[vertex_base + 0] = (float)position.x;
            out_mesh->vertices[vertex_base + 1] = (float)position.y;
            out_mesh->vertices[vertex_base + 2] = (float)position.z;
            out_mesh->normals[vertex_base + 0] = (float)normal.x;
            out_mesh->normals[vertex_base + 1] = (float)normal.y;
            out_mesh->normals[vertex_base + 2] = (float)normal.z;

            size_t uv_base = write_vertex * 2;
            out_mesh->uvs[uv_base + 0] = (float)uv.x;
            out_mesh->uvs[uv_base + 1] = 1.0f - (float)uv.y;
            out_mesh->indices[write_vertex] = (uint32_t)write_vertex;
            war3_fbx_copy_skin_weights_for_vertex(mesh, skin, mesh_index, write_vertex, out_mesh);
            war3_add_bounds(out_mesh->minimum_extent, out_mesh->maximum_extent, (float)position.x, (float)position.y, (float)position.z);
            write_vertex++;
        }
    }
    free(tri_indices);

    if (write_vertex == 0) {
        return false;
    }

    out_mesh->vertex_count = (uint32_t)write_vertex;
    out_mesh->index_count = (uint32_t)write_vertex;
    out_mesh->bounds_radius = war3_compute_radius(out_mesh->minimum_extent, out_mesh->maximum_extent);
    return true;
}

static void war3_fbx_release_static_scene_allocations(war3_fbx_static_scene *scene);

int war3_fbx_load_static_scene(const char *path, war3_fbx_static_scene *out_scene)
{
    if (!out_scene) {
        return 0;
    }

    memset(out_scene, 0, sizeof(*out_scene));
    ufbx_scene *scene = war3_load_scene(path, &out_scene->probe);
    if (!scene) {
        return 0;
    }

    out_scene->node_count = war3_count_to_u32(scene->nodes.count);
    if (out_scene->node_count > 0) {
        out_scene->nodes = (war3_fbx_node_dto*)calloc(out_scene->node_count, sizeof(war3_fbx_node_dto));
        if (!out_scene->nodes) {
            strncpy(out_scene->probe.error, "Failed to allocate static FBX node DTO", sizeof(out_scene->probe.error) - 1);
            ufbx_free_scene(scene);
            war3_fbx_release_static_scene_allocations(out_scene);
            return 0;
        }
        for (uint32_t i = 0; i < out_scene->node_count; i++) {
            if (!war3_fill_node(scene->nodes.data[i], &out_scene->nodes[i])) {
                strncpy(out_scene->probe.error, "Failed to allocate static FBX node name DTO", sizeof(out_scene->probe.error) - 1);
                ufbx_free_scene(scene);
                war3_fbx_release_static_scene_allocations(out_scene);
                return 0;
            }
        }
    }

    out_scene->bone_count = war3_count_to_u32(scene->bones.count);
    if (out_scene->bone_count > 0) {
        out_scene->bones = (war3_fbx_bone_dto*)calloc(out_scene->bone_count, sizeof(war3_fbx_bone_dto));
        if (!out_scene->bones) {
            strncpy(out_scene->probe.error, "Failed to allocate static FBX bone DTO", sizeof(out_scene->probe.error) - 1);
            ufbx_free_scene(scene);
            war3_fbx_release_static_scene_allocations(out_scene);
            return 0;
        }
        for (uint32_t i = 0; i < out_scene->bone_count; i++) {
            war3_fill_bone(scene->bones.data[i], &out_scene->bones[i]);
        }
    }

    uint32_t total_parts = 0;
    for (size_t node_index = 0; node_index < scene->nodes.count; node_index++) {
        const ufbx_node *node = scene->nodes.data[node_index];
        if (!war3_node_has_mesh(node)) {
            continue;
        }
        total_parts += war3_count_mesh_parts(node->mesh);
    }

    out_scene->texture_count = war3_count_to_u32(scene->textures.count);
    if (out_scene->texture_count > 0) {
        out_scene->textures = (war3_fbx_texture_dto*)calloc(out_scene->texture_count, sizeof(war3_fbx_texture_dto));
        if (!out_scene->textures) {
            strncpy(out_scene->probe.error, "Failed to allocate static FBX texture DTO", sizeof(out_scene->probe.error) - 1);
            ufbx_free_scene(scene);
            war3_fbx_release_static_scene_allocations(out_scene);
            return 0;
        }
        for (uint32_t i = 0; i < out_scene->texture_count; i++) {
            war3_fill_texture(scene->textures.data[i], &out_scene->textures[i]);
        }
    }

    out_scene->material_count = war3_count_to_u32(scene->materials.count);
    if (out_scene->material_count > 0) {
        out_scene->materials = (war3_fbx_material_dto*)calloc(out_scene->material_count, sizeof(war3_fbx_material_dto));
        if (!out_scene->materials) {
            strncpy(out_scene->probe.error, "Failed to allocate static FBX material DTO", sizeof(out_scene->probe.error) - 1);
            ufbx_free_scene(scene);
            war3_fbx_release_static_scene_allocations(out_scene);
            return 0;
        }
        for (uint32_t i = 0; i < out_scene->material_count; i++) {
            if (!war3_fill_material(scene->materials.data[i], &out_scene->materials[i])) {
                strncpy(out_scene->probe.error, "Failed to allocate static FBX material slot DTO", sizeof(out_scene->probe.error) - 1);
                ufbx_free_scene(scene);
                war3_fbx_release_static_scene_allocations(out_scene);
                return 0;
            }
        }
    }

    if (total_parts > 0) {
        out_scene->meshes = (war3_fbx_static_mesh*)calloc(total_parts, sizeof(war3_fbx_static_mesh));
        if (!out_scene->meshes) {
            strncpy(out_scene->probe.error, "Failed to allocate static FBX mesh DTO", sizeof(out_scene->probe.error) - 1);
            ufbx_free_scene(scene);
            war3_fbx_release_static_scene_allocations(out_scene);
            return 0;
        }

        for (size_t node_index = 0; node_index < scene->nodes.count; node_index++) {
            const ufbx_node *node = scene->nodes.data[node_index];
            if (!war3_node_has_mesh(node)) {
                continue;
            }
            const ufbx_mesh *mesh = node->mesh;
            uint32_t part_count = war3_count_mesh_parts(mesh);
            for (uint32_t part_index = 0; part_index < part_count; part_index++) {
                war3_fbx_static_mesh *target = &out_scene->meshes[out_scene->mesh_count];
                if (war3_fill_static_mesh_part(node, part_index, target)) {
                    out_scene->mesh_count++;
                } else {
                    war3_free_static_mesh(target);
                }
            }
        }
    }

    out_scene->animation_stack_count = war3_count_to_u32(scene->anim_stacks.count);
    if (out_scene->animation_stack_count > 0) {
        out_scene->animation_stacks = (war3_fbx_animation_stack_dto*)calloc(out_scene->animation_stack_count, sizeof(war3_fbx_animation_stack_dto));
        if (!out_scene->animation_stacks) {
            strncpy(out_scene->probe.error, "Failed to allocate FBX animation stack DTO", sizeof(out_scene->probe.error) - 1);
            ufbx_free_scene(scene);
            war3_fbx_release_static_scene_allocations(out_scene);
            return 0;
        }
        for (uint32_t i = 0; i < out_scene->animation_stack_count; i++) {
            if (!war3_fill_animation_stack(scene, scene->anim_stacks.data[i], &out_scene->animation_stacks[i])) {
                strncpy(out_scene->probe.error, "Failed to bake FBX animation stack", sizeof(out_scene->probe.error) - 1);
                ufbx_free_scene(scene);
                war3_fbx_release_static_scene_allocations(out_scene);
                return 0;
            }
        }
    }

    ufbx_free_scene(scene);
    return 1;
}

static void war3_fbx_release_static_scene_allocations(war3_fbx_static_scene *scene)
{
    if (!scene) {
        return;
    }
    for (uint32_t i = 0; i < scene->mesh_count; i++) {
        war3_free_static_mesh(&scene->meshes[i]);
    }
    for (uint32_t i = 0; i < scene->animation_stack_count; i++) {
        war3_free_animation_stack(&scene->animation_stacks[i]);
    }
    free(scene->animation_stacks);
    for (uint32_t i = 0; i < scene->node_count; i++) {
        war3_free_node(&scene->nodes[i]);
    }
    free(scene->nodes);
    free(scene->bones);
    for (uint32_t i = 0; i < scene->texture_count; i++) {
        war3_free_texture(&scene->textures[i]);
    }
    free(scene->textures);
    for (uint32_t i = 0; i < scene->material_count; i++) {
        war3_free_material(&scene->materials[i]);
    }
    free(scene->materials);
    free(scene->meshes);
}

void war3_fbx_free_static_scene(war3_fbx_static_scene *scene)
{
    if (!scene) {
        return;
    }
    war3_fbx_release_static_scene_allocations(scene);
    memset(scene, 0, sizeof(*scene));
}
