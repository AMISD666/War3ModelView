#pragma once

#include "ufbx.h"
#include "ufbx_probe.h"

#include <stdbool.h>

#define WAR3_FBX_MAX_VERTEX_WEIGHTS 4

bool war3_fbx_allocate_skin_weight_buffers(war3_fbx_static_mesh *out_mesh, const ufbx_skin_deformer *skin);
void war3_fbx_copy_skin_weights_for_vertex(
    const ufbx_mesh *mesh,
    const ufbx_skin_deformer *skin,
    uint32_t mesh_index,
    size_t write_vertex,
    war3_fbx_static_mesh *out_mesh);
