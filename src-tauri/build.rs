fn main() {
    println!("cargo:rerun-if-changed=../vendor/ufbx/ufbx.c");
    println!("cargo:rerun-if-changed=../vendor/ufbx/ufbx.h");
    println!("cargo:rerun-if-changed=src/fbx_import/ufbx_probe.c");
    println!("cargo:rerun-if-changed=src/fbx_import/ufbx_probe.h");
    println!("cargo:rerun-if-changed=src/fbx_import/ufbx_skin_weights.c");
    println!("cargo:rerun-if-changed=src/fbx_import/ufbx_skin_weights.h");

    cc::Build::new()
        .file("../vendor/ufbx/ufbx.c")
        .file("src/fbx_import/ufbx_probe.c")
        .file("src/fbx_import/ufbx_skin_weights.c")
        .include("../vendor/ufbx")
        .include("src/fbx_import")
        .compile("ufbx_probe");

    tauri_build::build()
}
