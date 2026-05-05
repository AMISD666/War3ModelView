#include "ufbx_skin_weights.h"

#include <math.h>
#include <stdlib.h>

#define WAR3_FBX_NO_INDEX UINT32_MAX

bool war3_fbx_allocate_skin_weight_buffers(war3_fbx_static_mesh *out_mesh, const ufbx_skin_deformer *skin)
{
    if (!skin || skin->vertices.count == 0 || out_mesh->vertex_count == 0) {
        return true;
    }

    size_t skin_value_count = (size_t)out_mesh->vertex_count * WAR3_FBX_MAX_VERTEX_WEIGHTS;
    out_mesh->skin_weight_stride = WAR3_FBX_MAX_VERTEX_WEIGHTS;
    out_mesh->skin_weight_counts = (uint8_t*)calloc(out_mesh->vertex_count, sizeof(uint8_t));
    out_mesh->skin_bone_node_typed_ids = (uint32_t*)calloc(skin_value_count, sizeof(uint32_t));
    out_mesh->skin_weights = (float*)calloc(skin_value_count, sizeof(float));
    if (!out_mesh->skin_weight_counts || !out_mesh->skin_bone_node_typed_ids || !out_mesh->skin_weights) {
        return false;
    }
    for (size_t i = 0; i < skin_value_count; i++) {
        out_mesh->skin_bone_node_typed_ids[i] = WAR3_FBX_NO_INDEX;
    }
    return true;
}

static uint32_t war3_mesh_index_to_vertex_index(const ufbx_mesh *mesh, uint32_t mesh_index)
{
    if (!mesh || mesh_index >= mesh->vertex_indices.count) {
        return WAR3_FBX_NO_INDEX;
    }
    return mesh->vertex_indices.data[mesh_index];
}

void war3_fbx_copy_skin_weights_for_vertex(
    const ufbx_mesh *mesh,
    const ufbx_skin_deformer *skin,
    uint32_t mesh_index,
    size_t write_vertex,
    war3_fbx_static_mesh *out_mesh)
{
    if (!skin || !out_mesh->skin_weight_counts || !out_mesh->skin_bone_node_typed_ids || !out_mesh->skin_weights) {
        return;
    }

    uint32_t vertex_index = war3_mesh_index_to_vertex_index(mesh, mesh_index);
    if (vertex_index == WAR3_FBX_NO_INDEX || vertex_index >= skin->vertices.count) {
        return;
    }

    ufbx_skin_vertex skin_vertex = skin->vertices.data[vertex_index];
    uint8_t written = 0;
    for (uint32_t i = 0; i < skin_vertex.num_weights && written < WAR3_FBX_MAX_VERTEX_WEIGHTS; i++) {
        uint32_t weight_index = skin_vertex.weight_begin + i;
        if (weight_index >= skin->weights.count) {
            continue;
        }
        ufbx_skin_weight weight = skin->weights.data[weight_index];
        if (weight.cluster_index >= skin->clusters.count || weight.weight <= 0.0 || !isfinite(weight.weight)) {
            continue;
        }
        const ufbx_skin_cluster *cluster = skin->clusters.data[weight.cluster_index];
        if (!cluster || !cluster->bone_node) {
            continue;
        }
        size_t base = write_vertex * WAR3_FBX_MAX_VERTEX_WEIGHTS + written;
        out_mesh->skin_bone_node_typed_ids[base] = cluster->bone_node->typed_id;
        out_mesh->skin_weights[base] = (float)weight.weight;
        written++;
    }
    out_mesh->skin_weight_counts[write_vertex] = written;
}
