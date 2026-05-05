use super::*;

#[test]
fn fbx_static_fixture_import_smoke() {
    let Ok(path) = std::env::var("FBX_STATIC_FIXTURE") else {
        eprintln!("FBX static import smoke skipped: set FBX_STATIC_FIXTURE to a small .fbx file.");
        return;
    };

    let max_file_size_bytes = std::env::var("FBX_STATIC_FIXTURE_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1024 * 1024);

    let result = import_fbx_static_scene(
        path,
        Some(FbxProbeOptions {
            max_file_size_bytes: Some(max_file_size_bytes),
        }),
    )
    .expect("static FBX import should succeed");

    assert!(result.probe.ok);
    assert!(
        result.probe.mesh_count >= 1,
        "probe should report at least one FBX mesh"
    );
    assert!(
        !result.meshes.is_empty(),
        "static import should return renderable mesh DTOs"
    );

    let mesh = &result.meshes[0];
    assert!(mesh.vertex_count >= 3);
    assert!(mesh.index_count >= 3);
    assert_eq!(mesh.vertices.len(), mesh.vertex_count as usize * 3);
    assert_eq!(mesh.normals.len(), mesh.vertex_count as usize * 3);
    assert_eq!(mesh.uvs.len(), mesh.vertex_count as usize * 2);
    assert_eq!(mesh.indices.len(), mesh.index_count as usize);
    if mesh.skin_weight_stride > 0 {
        assert_eq!(mesh.skin_weight_counts.len(), mesh.vertex_count as usize);
        assert_eq!(
            mesh.skin_bone_node_typed_ids.len(),
            mesh.vertex_count as usize * mesh.skin_weight_stride as usize
        );
        assert_eq!(
            mesh.skin_weights.len(),
            mesh.vertex_count as usize * mesh.skin_weight_stride as usize
        );
    }
    assert_eq!(mesh.index_count % 3, 0);
    assert!(mesh.bounds_radius > 0.0);
    assert!(mesh.maximum_extent[0] >= mesh.minimum_extent[0]);
    assert!(mesh.maximum_extent[1] >= mesh.minimum_extent[1]);
    assert!(mesh.maximum_extent[2] >= mesh.minimum_extent[2]);
}

#[test]
fn fbx_skin_fixture_node_bone_smoke() {
    let Ok(path) = std::env::var("FBX_SKIN_FIXTURE") else {
            eprintln!(
                "FBX skin node/bone smoke skipped: set FBX_SKIN_FIXTURE to a small skinned .fbx file."
            );
            return;
        };

        let max_file_size_bytes = std::env::var("FBX_SKIN_FIXTURE_MAX_BYTES")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(16 * 1024 * 1024);
        let result = import_fbx_static_scene(
            path,
            Some(FbxProbeOptions {
                max_file_size_bytes: Some(max_file_size_bytes),
            }),
        )
    .expect("skinned FBX static import should succeed");

    assert!(result.probe.ok);
    assert!(
        result.probe.bone_count >= 1,
        "probe should report at least one FBX bone"
    );
    assert!(
        !result.nodes.is_empty(),
        "static import should include FBX node DTOs"
    );
    assert!(
        result.nodes.iter().all(|node| node.rest_world_matrix[15] == 1.0
            && node.rest_world_matrix.iter().all(|value| value.is_finite())),
        "each imported FBX node should include a finite 4x4 rest/bind world matrix"
    );
    assert!(
        !result.bones.is_empty(),
        "static import should include FBX bone DTOs"
    );
        let resolved_bone_count = result
            .bones
            .iter()
            .filter(|bone| {
                bone.node_typed_id.is_some()
                    && result
                        .nodes
                        .iter()
                        .any(|node| Some(node.typed_id) == bone.node_typed_id)
            })
            .count();
        assert!(
            resolved_bone_count > 0,
            "at least one imported FBX bone should resolve to a node DTO"
        );
        assert!(
            result.meshes.iter().any(|mesh| mesh.skin_weight_stride > 0
                && mesh.skin_weight_counts.iter().any(|count| *count > 0)),
            "skinned fixture should include per-vertex FBX source weight DTOs"
        );
        assert!(
            result.meshes.iter().all(|mesh| {
                if mesh.skin_weight_stride == 0 {
                    return true;
                }
                let stride = mesh.skin_weight_stride as usize;
                mesh.skin_weight_counts
                    .iter()
                    .enumerate()
                    .all(|(vertex_index, count)| {
                        let count = usize::from(*count).min(stride);
                        (0..count).all(|weight_index| {
                            let source_index = vertex_index * stride + weight_index;
                            let typed_id = mesh.skin_bone_node_typed_ids[source_index];
                            result.nodes.iter().any(|node| node.typed_id == typed_id)
                        })
                    })
            }),
            "each FBX source weight bone node reference should resolve to a node DTO"
        );
    }

#[test]
fn fbx_animation_fixture_bake_smoke() {
    let Ok(path) = std::env::var("FBX_ANIM_FIXTURE") else {
        eprintln!(
            "FBX animation bake smoke skipped: set FBX_ANIM_FIXTURE to a small animated .fbx file."
        );
        return;
    };

    let max_file_size_bytes = std::env::var("FBX_ANIM_FIXTURE_MAX_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(16 * 1024 * 1024);

    let result = import_fbx_static_scene(
        path,
        Some(FbxProbeOptions {
            max_file_size_bytes: Some(max_file_size_bytes),
        }),
    )
    .expect("animated FBX static import should succeed");

    assert!(result.probe.ok);
    assert!(
        result.probe.animation_stack_count >= 1,
        "probe should report at least one FBX animation stack"
    );
    assert!(
        !result.animation_stacks.is_empty(),
        "static import should include baked FBX animation stack DTOs"
    );
    let baked_node_count: usize = result
        .animation_stacks
        .iter()
        .map(|stack| stack.baked_nodes.len())
        .sum();
    let trs_key_count: usize = result
        .animation_stacks
        .iter()
        .flat_map(|stack| stack.baked_nodes.iter())
        .map(|node| {
            node.translation_keys.len() + node.rotation_keys.len() + node.scale_keys.len()
        })
        .sum();
    let mapped_baked_node_count: usize = result
        .animation_stacks
        .iter()
        .flat_map(|stack| stack.baked_nodes.iter())
        .filter(|baked_node| {
            result
                .nodes
                .iter()
                .any(|node| node.typed_id == baked_node.node_typed_id)
        })
        .count();
    eprintln!(
        "FBX animation bake smoke: stacks={}, baked_nodes={}, mapped_baked_nodes={}, trs_keys={}",
        result.animation_stacks.len(),
        baked_node_count,
        mapped_baked_node_count,
        trs_key_count
    );
    for (stack_index, stack) in result.animation_stacks.iter().enumerate() {
        let mut min_time = f64::INFINITY;
        let mut max_time = f64::NEG_INFINITY;
        let mut stack_key_count = 0usize;
        for node in &stack.baked_nodes {
            for key in &node.translation_keys {
                min_time = min_time.min(key.time_seconds);
                max_time = max_time.max(key.time_seconds);
                stack_key_count += 1;
            }
            for key in &node.rotation_keys {
                min_time = min_time.min(key.time_seconds);
                max_time = max_time.max(key.time_seconds);
                stack_key_count += 1;
            }
            for key in &node.scale_keys {
                min_time = min_time.min(key.time_seconds);
                max_time = max_time.max(key.time_seconds);
                stack_key_count += 1;
            }
        }
        eprintln!(
            "  stack[{stack_index}] name='{}' playback_duration={:.3}s key_time=[{:.3},{:.3}] keys={}",
            stack.name,
            stack.playback_duration,
            min_time,
            max_time,
            stack_key_count
        );
    }
    assert!(
        result
            .animation_stacks
            .iter()
            .any(|stack| stack
                .baked_nodes
                .iter()
                .any(|node| !node.translation_keys.is_empty()
                    || !node.rotation_keys.is_empty()
                    || !node.scale_keys.is_empty())),
        "at least one baked node should contain TRS keys"
    );
    assert!(
        mapped_baked_node_count > 0,
        "at least one baked node should resolve to an imported FBX node DTO"
    );
}
