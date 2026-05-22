use std::path::PathBuf;

use super::{import_jumpx_static_scene, probe_jumpx_import};

const FIXTURE: &str = "testmodel/tx_268_s04_2_01_skin2.x";

fn fixture_path() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri should have a repository parent")
        .join(FIXTURE)
        .to_string_lossy()
        .into_owned()
}

#[test]
fn jumpx_rejects_non_x_extension() {
    let result = probe_jumpx_import("not-a-model.mdl".to_string(), None);
    assert!(result.is_err());
}

#[test]
fn jumpx_probe_fixture_counts() {
    let result = probe_jumpx_import(fixture_path(), None).expect("fixture should probe");
    assert_eq!(result.version, 8);
    assert_eq!(result.texture_count, 15);
    assert_eq!(result.material_count, 16);
    assert_eq!(result.geometry_count, 26);
    assert_eq!(result.bone_count, 12);
    assert_eq!(result.bone_group_count, 8);
    assert_eq!(result.particle_count, 11);
    assert_eq!(result.action_count, 0);
}

#[test]
fn jumpx_import_fixture_core_sections() {
    let result =
        import_jumpx_static_scene(fixture_path(), None).expect("fixture should import");
    assert_eq!(result.textures.len(), 15);
    assert_eq!(result.textures[0].name, "tx_tuxing_1016.dds");
    assert_eq!(result.geometries.len(), 26);
    assert_eq!(result.geometries[0].name, "avmesh.andi#003");
    assert_eq!(result.geometries[0].geometry_type, 6);
    assert_eq!(result.geometries[0].ancestor_bone_id, 4);
    assert_eq!(result.geometries[24].name, "avmesh.tiaodai#8");
    assert_eq!(result.geometries[24].vertex_count, 623);
    assert_eq!(result.geometries[24].index_count, 2406);
    assert_eq!(result.materials[0].alpha_keys.len(), 31);
    assert_eq!(result.materials[0].alpha_keys[0].time_ms, Some(10666.667));
    assert_eq!(result.materials[0].color_keys.len(), 31);
    assert_eq!(result.materials[0].uv_offset_keys.len(), 31);
    assert_eq!(result.materials[0].blend_keys.len(), 31);
    assert!(result
        .materials
        .iter()
        .flat_map(|material| material.blend_keys.iter())
        .any(|key| (key.value as u32 & 0x40000) != 0));
    assert_eq!(result.bones.len(), 12);
    assert_eq!(result.bones[0].name, "Bone002");
    assert_eq!(result.bones[0].position_keys.len(), 31);
    assert_eq!(result.bones[0].rotation_keys.len(), 31);
    assert_eq!(result.bones[0].scale_keys.len(), 31);
    assert_eq!(result.particles.len(), 11);
    assert_eq!(result.particles[0].name, "part.9lizi009");
    assert_eq!(result.particles[0].texture_id, 6);
    assert_eq!(result.particles[0].visibility_keys.len(), 31);
    assert_eq!(result.particles[0].emission_rate_keys.len(), 31);
    assert_eq!(result.particles[0].visibility_keys[0].frame, 320);
    assert_eq!(result.particles[0].visibility_keys[0].time_ms, Some(10666.667));
    assert_eq!(result.particles[0].visibility_keys[0].value, 0.0);
    assert_eq!(result.particles[0].visibility_keys[2].value, 1.0);
    assert_eq!(result.particles[0].emission_rate_keys[2].value, 40.0);
    assert_eq!(result.particles[8].name, "part.lizi001");
    assert_eq!(result.particles[8].visibility_keys.len(), 0);
    assert!(result.actions.is_empty());
}
