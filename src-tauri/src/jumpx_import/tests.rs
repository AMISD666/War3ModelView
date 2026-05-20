use super::{import_jumpx_static_scene, probe_jumpx_import};

const FIXTURE: &str = "../testmodel/tx_207_s04_2_02_skin5.x";

#[test]
fn jumpx_rejects_non_x_extension() {
    let result = probe_jumpx_import("not-a-model.mdl".to_string(), None);
    assert!(result.is_err());
}

#[test]
fn jumpx_probe_fixture_counts() {
    let result = probe_jumpx_import(FIXTURE.to_string(), None).expect("fixture should probe");
    assert_eq!(result.version, 8);
    assert_eq!(result.texture_count, 12);
    assert_eq!(result.material_count, 5);
    assert_eq!(result.geometry_count, 5);
    assert_eq!(result.bone_count, 11);
    assert_eq!(result.bone_group_count, 2);
    assert_eq!(result.particle_count, 10);
    assert_eq!(result.action_count, 0);
}

#[test]
fn jumpx_import_fixture_core_sections() {
    let result =
        import_jumpx_static_scene(FIXTURE.to_string(), None).expect("fixture should import");
    assert_eq!(result.textures.len(), 12);
    assert_eq!(result.textures[0].name, "tx_kuosan_0059.dds");
    assert_eq!(result.geometries.len(), 5);
    assert_eq!(result.geometries[4].name, "avmesh.tiaodai#9");
    assert_eq!(result.geometries[0].geometry_type, 6);
    assert_eq!(result.geometries[0].ancestor_bone_id, 7);
    assert_eq!(result.geometries[4].vertex_count, 250);
    assert_eq!(result.geometries[4].index_count, 744);
    assert_eq!(result.materials[0].alpha_keys.len(), 101);
    assert_eq!(result.materials[0].alpha_keys[0].time_ms, Some(10666.667));
    assert_eq!(result.materials[0].alpha_keys[0].value, 0.0);
    assert_eq!(result.materials[0].color_keys.len(), 101);
    assert_eq!(result.materials[0].uv_offset_keys.len(), 101);
    assert_eq!(result.materials[0].blend_keys.len(), 101);
    assert_eq!(result.materials[0].blend_keys[0].value as u32, 0x100000);
    assert!(result
        .materials
        .iter()
        .flat_map(|material| material.blend_keys.iter())
        .any(|key| (key.value as u32 & 0x40000) != 0));
    assert!((result.materials[0].color_keys[0].value[0] - (99.0 / 255.0)).abs() < 0.0001);
    assert!((result.materials[0].color_keys[0].value[1] - 0.0).abs() < 0.0001);
    assert!((result.materials[0].color_keys[0].value[2] - 0.0).abs() < 0.0001);
    assert_eq!(result.materials[0].uv_offset_keys[0].value, [0.0, 0.0, 0.0]);
    assert!((result.materials[0].alpha_keys[2].value - (127.0 / 255.0)).abs() < 0.0001);
    assert!((result.materials[1].alpha_keys[2].value - 1.0).abs() < 0.0001);
    assert_eq!(result.bones.len(), 11);
    assert_eq!(result.bones[0].name, "Bone001");
    assert_eq!(result.bones[0].position_keys.len(), 101);
    assert_eq!(result.bones[0].rotation_keys.len(), 101);
    assert_eq!(result.bones[0].scale_keys.len(), 101);
    assert_eq!(result.particles.len(), 10);
    assert_eq!(result.particles[0].name, "part.1yun");
    assert_eq!(result.particles[0].visibility_keys.len(), 101);
    assert_eq!(result.particles[0].emission_rate_keys.len(), 101);
    assert_eq!(result.particles[0].visibility_keys[0].frame, 320);
    assert_eq!(result.particles[0].visibility_keys[0].time_ms, Some(10666.667));
    assert_eq!(result.particles[0].visibility_keys[0].value, 0.0);
    assert_eq!(result.particles[0].visibility_keys[3].value, 1.0);
    assert_eq!(result.particles[0].emission_rate_keys[3].value, 6.0);
    assert!(result.actions.is_empty());
}
