fn main() {
    // The Windows unit-test executable needs a Common Controls 6 manifest; it is embedded through RUSTFLAGS by
    // scripts/cargo-test.sh (a build script cannot target only the lib's test build).
    tauri_build::build();
}
