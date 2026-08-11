use std::{env, fs};

fn main() {
    // `cargo test` invokes Tauri's build script without the desktop pnpm
    // packaging command. Keep ignored placeholders available for that path;
    // `prepare-shell-runtime.mjs` always replaces them with the verified
    // PortableGit archive before a distributable Windows build is created.
    let resources_dir = env::var("CARGO_MANIFEST_DIR")
        .expect("missing CARGO_MANIFEST_DIR")
        + "/../resources";
    fs::create_dir_all(&resources_dir).expect("failed to create desktop resources directory");
    for name in ["portable-git.exe", "portable-git.sha256"] {
        let path = format!("{resources_dir}/{name}");
        if !std::path::Path::new(&path).exists() {
            fs::File::create(path).expect("failed to create shell runtime placeholder");
        }
    }
    tauri_build::build()
}
