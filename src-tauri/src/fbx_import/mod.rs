mod convert;
mod native;
mod types;

#[cfg(test)]
mod tests;

pub use types::*;

use convert::{
    animation_stack_from_native, bone_from_native, material_from_native, native_error_message,
    native_f32_vec, native_optional_index, native_string, native_u32_vec, native_u8_vec,
    node_from_native, probe_result_from_native, probe_warnings_from_native, texture_from_native,
};
use native::{
    empty_native_probe, empty_native_static_scene, war3_fbx_free_static_scene,
    war3_fbx_load_static_scene, war3_fbx_probe_file, NativeFbxProbeResult, NativeFbxStaticScene,
};
use std::ffi::CString;
use std::fs;
use std::path::Path;
use std::slice;

#[tauri::command]
pub fn probe_fbx_native_import(
    path: String,
    options: Option<FbxProbeOptions>,
) -> Result<FbxProbeResult, String> {
    let (c_path, file_size) = validate_fbx_path(&path, options)?;
    let mut native = empty_native_probe();

    let ok =
        unsafe { war3_fbx_probe_file(c_path.as_ptr(), &mut native as *mut NativeFbxProbeResult) };
    if ok == 0 {
        let message = native_error_message(&native);
        return Err(if message.is_empty() {
            "ufbx failed to parse FBX file".to_string()
        } else {
            message
        });
    }

    Ok(probe_result_from_native(
        path,
        file_size,
        native,
        probe_warnings_from_native(&native),
    ))
}

#[tauri::command]
pub fn import_fbx_static_scene(
    path: String,
    options: Option<FbxProbeOptions>,
) -> Result<FbxStaticSceneResult, String> {
    let (c_path, file_size) = validate_fbx_path(&path, options)?;
    let mut native = empty_native_static_scene();

    let ok = unsafe {
        war3_fbx_load_static_scene(c_path.as_ptr(), &mut native as *mut NativeFbxStaticScene)
    };
    if ok == 0 {
        let message = native_error_message(&native.probe);
        return Err(if message.is_empty() {
            "ufbx failed to import static FBX scene".to_string()
        } else {
            message
        });
    }

    let native_meshes = if native.meshes.is_null() || native.mesh_count == 0 {
        &[][..]
    } else {
        unsafe { slice::from_raw_parts(native.meshes, native.mesh_count as usize) }
    };
    let native_nodes = if native.nodes.is_null() || native.node_count == 0 {
        &[][..]
    } else {
        unsafe { slice::from_raw_parts(native.nodes, native.node_count as usize) }
    };
    let native_bones = if native.bones.is_null() || native.bone_count == 0 {
        &[][..]
    } else {
        unsafe { slice::from_raw_parts(native.bones, native.bone_count as usize) }
    };
    let native_textures = if native.textures.is_null() || native.texture_count == 0 {
        &[][..]
    } else {
        unsafe { slice::from_raw_parts(native.textures, native.texture_count as usize) }
    };
    let native_materials = if native.materials.is_null() || native.material_count == 0 {
        &[][..]
    } else {
        unsafe { slice::from_raw_parts(native.materials, native.material_count as usize) }
    };
    let native_animation_stacks =
        if native.animation_stacks.is_null() || native.animation_stack_count == 0 {
            &[][..]
        } else {
            unsafe {
                slice::from_raw_parts(
                    native.animation_stacks,
                    native.animation_stack_count as usize,
                )
            }
        };

    let meshes = native_meshes
        .iter()
        .map(|mesh| {
            let vertex_count = mesh.vertex_count as usize;
            let index_count = mesh.index_count as usize;
            FbxStaticMeshDto {
                name: native_string(mesh.name),
                node_typed_id: native_optional_index(mesh.node_typed_id),
                mesh_material_slot: mesh.mesh_material_slot,
                material_index: mesh.material_index,
                skin_weight_stride: mesh.skin_weight_stride,
                vertex_count: mesh.vertex_count,
                index_count: mesh.index_count,
                vertices: native_f32_vec(mesh.vertices, vertex_count * 3),
                normals: native_f32_vec(mesh.normals, vertex_count * 3),
                uvs: native_f32_vec(mesh.uvs, vertex_count * 2),
                indices: native_u32_vec(mesh.indices, index_count),
                skin_weight_counts: native_u8_vec(mesh.skin_weight_counts, vertex_count),
                skin_bone_node_typed_ids: native_u32_vec(
                    mesh.skin_bone_node_typed_ids,
                    vertex_count * mesh.skin_weight_stride as usize,
                ),
                skin_weights: native_f32_vec(
                    mesh.skin_weights,
                    vertex_count * mesh.skin_weight_stride as usize,
                ),
                minimum_extent: mesh.minimum_extent,
                maximum_extent: mesh.maximum_extent,
                bounds_radius: mesh.bounds_radius,
            }
        })
        .collect();
    let nodes = native_nodes.iter().map(node_from_native).collect();
    let bones = native_bones.iter().map(bone_from_native).collect();
    let textures = native_textures.iter().map(texture_from_native).collect();
    let materials = native_materials.iter().map(material_from_native).collect();
    let animation_stacks = native_animation_stacks
        .iter()
        .map(animation_stack_from_native)
        .collect();

    let probe = probe_result_from_native(
        path,
        file_size,
        native.probe,
        probe_warnings_from_native(&native.probe),
    );
    unsafe { war3_fbx_free_static_scene(&mut native as *mut NativeFbxStaticScene) };

    Ok(FbxStaticSceneResult {
        probe,
        nodes,
        bones,
        textures,
        materials,
        meshes,
        animation_stacks,
    })
}

fn validate_fbx_path(
    path: &str,
    options: Option<FbxProbeOptions>,
) -> Result<(CString, u64), String> {
    let normalized_ext = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if normalized_ext != "fbx" {
        return Err("Only .fbx files can be imported by the FBX native probe".to_string());
    }

    let metadata =
        fs::metadata(path).map_err(|error| format!("Failed to read FBX file metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("FBX import path is not a file".to_string());
    }

    let file_size = metadata.len();
    let max_file_size_bytes = options
        .and_then(|value| value.max_file_size_bytes)
        .unwrap_or(512 * 1024 * 1024);
    if file_size > max_file_size_bytes {
        return Err(format!(
            "FBX file is too large for the current import probe: {} bytes > {} bytes",
            file_size, max_file_size_bytes
        ));
    }

    let c_path =
        CString::new(path).map_err(|_| "FBX path contains an interior NUL byte".to_string())?;
    Ok((c_path, file_size))
}
