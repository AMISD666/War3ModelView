pub(super) fn axis_angle_to_quat(x: f32, y: f32, z: f32, angle: f32) -> [f32; 4] {
    let len = (x * x + y * y + z * z).sqrt();
    if len <= 0.0 {
        return [0.0, 0.0, 0.0, 1.0];
    }
    let half = angle * 0.5;
    let scale = half.sin() / len;
    [x * scale, y * scale, z * scale, half.cos()]
}

pub(super) fn uncompress_bbox(packed: u32, min: [f32; 3], max: [f32; 3]) -> [f32; 3] {
    let mut value = packed;
    let mut out = [0.0; 3];
    for axis in 0..3 {
        let component = (value & 0x3ff) as f32;
        value >>= 10;
        out[axis] = (max[axis] - min[axis]) * component / 1023.0 + min[axis];
    }
    out
}

pub(super) fn compute_radius(min: [f32; 3], max: [f32; 3]) -> f32 {
    if min
        .iter()
        .chain(max.iter())
        .any(|value| !value.is_finite() || value.abs() > 1_000_000.0)
    {
        return 0.0;
    }
    let dx = max[0] - min[0];
    let dy = max[1] - min[1];
    let dz = max[2] - min[2];
    ((dx * dx + dy * dy + dz * dz).sqrt()) * 0.5
}

pub(super) fn is_plausible_extent(min: [f32; 3], max: [f32; 3]) -> bool {
    min.iter()
        .chain(max.iter())
        .all(|value| value.is_finite() && value.abs() < 1_000_000.0)
        && min[0] <= max[0]
        && min[1] <= max[1]
        && min[2] <= max[2]
}

pub(super) fn compute_extents_from_vertices(vertices: &[f32]) -> ([f32; 3], [f32; 3]) {
    if vertices.len() < 3 {
        return ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0]);
    }
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for chunk in vertices.chunks_exact(3) {
        for axis in 0..3 {
            min[axis] = min[axis].min(chunk[axis]);
            max[axis] = max[axis].max(chunk[axis]);
        }
    }
    if min.iter().chain(max.iter()).all(|value| value.is_finite()) {
        (min, max)
    } else {
        ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0])
    }
}

pub(super) fn identity_matrix() -> [f32; 16] {
    [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]
}

pub(super) fn invert_affine_matrix(m: [f32; 16]) -> Option<[f32; 16]> {
    let a00 = m[0];
    let a01 = m[1];
    let a02 = m[2];
    let a10 = m[4];
    let a11 = m[5];
    let a12 = m[6];
    let a20 = m[8];
    let a21 = m[9];
    let a22 = m[10];
    let det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20)
        + a02 * (a10 * a21 - a11 * a20);
    if det.abs() <= 1e-8 {
        return None;
    }
    let inv_det = 1.0 / det;
    let r00 = (a11 * a22 - a12 * a21) * inv_det;
    let r01 = (a02 * a21 - a01 * a22) * inv_det;
    let r02 = (a01 * a12 - a02 * a11) * inv_det;
    let r10 = (a12 * a20 - a10 * a22) * inv_det;
    let r11 = (a00 * a22 - a02 * a20) * inv_det;
    let r12 = (a02 * a10 - a00 * a12) * inv_det;
    let r20 = (a10 * a21 - a11 * a20) * inv_det;
    let r21 = (a01 * a20 - a00 * a21) * inv_det;
    let r22 = (a00 * a11 - a01 * a10) * inv_det;
    let tx = m[12];
    let ty = m[13];
    let tz = m[14];
    Some([
        r00,
        r01,
        r02,
        0.0,
        r10,
        r11,
        r12,
        0.0,
        r20,
        r21,
        r22,
        0.0,
        -(tx * r00 + ty * r10 + tz * r20),
        -(tx * r01 + ty * r11 + tz * r21),
        -(tx * r02 + ty * r12 + tz * r22),
        1.0,
    ])
}
