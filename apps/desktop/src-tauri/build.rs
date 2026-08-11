use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=../resources/portable-git.exe");
    println!("cargo:rerun-if-changed=../resources/portable-git.sha256");
    let target = env::var("TARGET").unwrap_or_default();
    if target.contains("windows") {
        verify_windows_shell_resources();
    }
    tauri_build::build()
}

fn verify_windows_shell_resources() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR");
    let resources_dir = Path::new(&manifest_dir).join("../resources");
    let archive_path = resources_dir.join("portable-git.exe");
    let checksum_path = resources_dir.join("portable-git.sha256");

    let archive_size = fs::metadata(&archive_path)
        .unwrap_or_else(|error| {
            panic!(
                "missing PortableGit archive {}: {error}",
                archive_path.display()
            )
        })
        .len();
    assert!(
        archive_size > 0,
        "PortableGit archive is empty: {}",
        archive_path.display()
    );

    let checksum = fs::read_to_string(&checksum_path).unwrap_or_else(|error| {
        panic!(
            "missing PortableGit checksum {}: {error}",
            checksum_path.display()
        )
    });
    let checksum = checksum.trim();
    assert!(
        checksum.len() == 64
            && checksum
                .chars()
                .all(|character| character.is_ascii_hexdigit()),
        "invalid PortableGit checksum file: {}",
        checksum_path.display()
    );
}
