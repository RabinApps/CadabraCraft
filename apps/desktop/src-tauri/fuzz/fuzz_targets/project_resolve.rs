#![no_main]
//! `project::resolve`: whatever path the webview sends, an `Ok` result stays inside the project root and has no `..`.
use cadabracraft_fuzz::project::resolve;
use libfuzzer_sys::fuzz_target;
use std::path::{Component, Path};
use std::sync::OnceLock;

fn root() -> &'static Path {
    static ROOT: OnceLock<tempfile::TempDir> = OnceLock::new();
    ROOT.get_or_init(|| {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("manuscript")).unwrap();
        std::fs::write(d.path().join("cadabra.json"), "{}").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/", d.path().join("manuscript/escape")).unwrap();
        d
    })
    .path()
}

fuzz_target!(|data: &[u8]| {
    let Ok(rel) = std::str::from_utf8(data) else { return };
    if let Ok(p) = resolve(root(), rel) {
        assert!(p.starts_with(root()), "{rel:?} resolved outside the root: {p:?}");
        assert!(!p.components().any(|c| matches!(c, Component::ParentDir)), "{rel:?}");
    }
});
