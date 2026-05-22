use std::path::PathBuf;

use crate::activation::FbxCapability;
use crate::action_name_mapping::ActionNameMapping;

use super::{
    apply_action_name_mapping, import_jumpx_static_scene_with_capability,
    probe_jumpx_import_with_capability, JumpxActionDto,
};

const FIXTURE: &str = "testmodel/tx_268_s06_2_01_skin1.x";

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
    let capability = FbxCapability::test_only();
    let result = probe_jumpx_import_with_capability(
        "not-a-model.mdl".to_string(),
        None,
        &capability,
    );
    assert!(result.is_err());
}

#[test]
fn jumpx_probe_fixture_counts() {
    let capability = FbxCapability::test_only();
    let result = probe_jumpx_import_with_capability(fixture_path(), None, &capability)
        .expect("fixture should probe");
    assert_eq!(result.version, 8);
    assert!(result.texture_count > 0);
    assert!(result.material_count > 0);
    assert!(result.geometry_count > 0);
    assert!(result.bone_count > 0);
    assert!(result.particle_count > 0);
    assert_eq!(result.action_count, 2);
}

#[test]
fn jumpx_import_fixture_core_sections() {
    let capability = FbxCapability::test_only();
    let result = import_jumpx_static_scene_with_capability(fixture_path(), None, &capability)
        .expect("fixture should import");
    assert!(!result.textures.is_empty());
    assert!(!result.geometries.is_empty());
    assert!(!result.materials.is_empty());
    assert!(result.materials[0].alpha_keys.len() >= 1);
    assert_eq!(result.materials[0].alpha_keys[0].time_ms, Some(10666.667));
    assert_eq!(result.materials[0].color_keys.len(), result.materials[0].alpha_keys.len());
    assert_eq!(result.materials[0].uv_offset_keys.len(), result.materials[0].alpha_keys.len());
    assert_eq!(result.materials[0].blend_keys.len(), result.materials[0].alpha_keys.len());
    assert!(result
        .materials
        .iter()
        .flat_map(|material| material.blend_keys.iter())
        .any(|key| (key.value as u32 & 0x40000) != 0));
    assert!(!result.bones.is_empty());
    assert!(!result.bones[0].position_keys.is_empty());
    assert_eq!(result.bones[0].rotation_keys.len(), result.bones[0].position_keys.len());
    assert_eq!(result.bones[0].scale_keys.len(), result.bones[0].position_keys.len());
    assert!(!result.particles.is_empty());
    assert!(result
        .particles
        .iter()
        .all(|particle| particle.priority_plane == 0));
    assert_eq!(result.particles[0].visibility_keys.len(), result.particles[0].emission_rate_keys.len());
    assert_eq!(result.particles[0].visibility_keys[0].frame, 320);
    assert_eq!(result.particles[0].visibility_keys[0].time_ms, Some(10666.667));
    assert_eq!(result.actions.len(), 2);
    assert!(result
        .actions
        .iter()
        .all(|action| action.end_frame >= action.start_frame));
}

#[test]
fn jumpx_actions_use_shared_action_name_mapping_rules() {
    let mapping = ActionNameMapping::from_text(
        ".*idle.* -> stand\n\
         .*stand.* -> stand\n\
         .*dead.* -> death\n\
         .*death.* -> death\n",
    )
    .expect("test mapping should parse");
    let mut actions = vec![
        jumpx_action(0, "idle_loop"),
        jumpx_action(1, "stand_ready"),
        jumpx_action(2, "death"),
    ];

    apply_action_name_mapping(&mut actions, &mapping);

    let names: Vec<&str> = actions.iter().map(|action| action.name.as_str()).collect();
    assert_eq!(names, vec!["stand1", "stand2", "death"]);
}

fn jumpx_action(action_index: u32, name: &str) -> JumpxActionDto {
    JumpxActionDto {
        action_index,
        name: name.to_string(),
        start_frame: 0,
        end_frame: 1,
        raw_flags: 0,
        save_flags: 0,
    }
}
