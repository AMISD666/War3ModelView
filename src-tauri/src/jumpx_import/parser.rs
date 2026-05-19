use super::container::{parse_container, ParsedContainer};
use super::sections::{
    parse_actions, parse_attachments, parse_bone_groups, parse_bones, parse_geometries,
    parse_materials, parse_particles, parse_ribbons, parse_textures,
};
use super::types::*;

pub fn parse_jumpx_scene(
    path: String,
    file_size: u64,
    bytes: &[u8],
) -> Result<JumpxStaticSceneResult, String> {
    let parsed = parse_container(bytes)?;
    let mut warnings = Vec::new();
    if !(5..=8).contains(&parsed.version) {
        warnings.push(format!(
            "Unsupported JumpX version {}; parser will attempt best-effort import.",
            parsed.version
        ));
    }

    let textures = parse_textures(&parsed.head, &parsed.dir)?;
    let materials = parse_materials(&parsed.data, &parsed.head, &parsed.dir)?;
    let geometries = parse_geometries(&parsed.head, &parsed.data, &parsed.dir)?;
    let bones = parse_bones(&parsed.head, &parsed.data, &parsed.dir)?;
    let bone_groups = parse_bone_groups(&parsed.head, &parsed.dir)?;
    let attachments = parse_attachments(&parsed.head, &parsed.dir)?;
    let ribbons = parse_ribbons(&parsed.head, &parsed.dir)?;
    let particles = parse_particles(&parsed.head, &parsed.data, &parsed.dir, parsed.version)?;
    let actions = parse_actions(&parsed.head, &parsed.dir)?;

    if parsed.dir.get("desc") != 0 {
        warnings.push(
            "JumpX description text is present but not exposed in the first import DTO."
                .to_string(),
        );
    }

    let probe = build_probe(path, file_size, &parsed, warnings.clone());
    Ok(JumpxStaticSceneResult {
        probe,
        textures,
        materials,
        geometries,
        bones,
        bone_groups,
        attachments,
        ribbons,
        particles,
        actions,
    })
}

pub fn probe_jumpx(path: String, file_size: u64, bytes: &[u8]) -> Result<JumpxProbeResult, String> {
    let parsed = parse_container(bytes)?;
    Ok(build_probe(path, file_size, &parsed, Vec::new()))
}

fn build_probe(
    path: String,
    file_size: u64,
    parsed: &ParsedContainer,
    warnings: Vec<String>,
) -> JumpxProbeResult {
    JumpxProbeResult {
        ok: true,
        path,
        file_size,
        format: "JumpX".to_string(),
        version: parsed.version,
        head_size: parsed.head_size,
        data_size: parsed.data_size,
        head_compressed_size: parsed.head_compressed_size,
        data_compressed_size: parsed.data_compressed_size,
        texture_count: parsed.dir.get("ntex"),
        material_count: parsed.dir.get("nmtl"),
        geometry_count: parsed.dir.get("ngeo"),
        bone_count: parsed.dir.get("nbon"),
        bone_group_count: parsed.dir.get("nbgp"),
        attachment_count: parsed.dir.get("natt"),
        ribbon_count: parsed.dir.get("nrib"),
        particle_count: parsed.dir.get("nprt"),
        action_count: parsed.dir.get("nact"),
        warnings,
    }
}
