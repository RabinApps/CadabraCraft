fn main() {
    // The Windows unit-test executable needs a Common Controls 6 manifest; it is embedded through RUSTFLAGS by
    // scripts/cargo-test.sh (a build script cannot target only the lib's test build).
    // Resource folders the build lists in tauri.conf.json must exist. The EPUB checker and its Java runtime are staged by
    // scripts/stage-epubcheck.sh and scripts/build-jre.sh; a checkout that has not run them still builds, and validating an EPUB then
    // says the checker is missing.
    for dir in ["binaries/epubcheck", "binaries/jre"] {
        let _ = std::fs::create_dir_all(dir);
    }
    tauri_build::build();
}
