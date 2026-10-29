fn main() {
    tauri_build::build();
    // The app's own executable gets a Common Controls 6 manifest from tauri-build. The unit-test executable does not, and
    // without it Windows fails to start it (STATUS_ENTRYPOINT_NOT_FOUND: the dialog plugin imports TaskDialogIndirect,
    // which only exists in comctl32 v6). `-tests` applies to test builds only, so the app is not given a second manifest.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR")).join("windows-test.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
    }
}
