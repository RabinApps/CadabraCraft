//! Image asset commands.
use crate::platform::blocking;
use crate::project::{self, ProjectError};
use std::path::PathBuf;
use tauri::ipc::Response;

/// Copies an image the user picked into `assets/`; returns `assets/<name>`.
#[tauri::command]
pub async fn import_asset(root: String, source: String) -> Result<String, ProjectError> {
    blocking(move || project::import_image(&project::require_project(&PathBuf::from(root))?, &PathBuf::from(source))).await
}

/// Stores image bytes (from an imported document) in `assets/`; returns the actual `assets/<name>` used.
#[tauri::command]
pub async fn import_asset_bytes(root: String, name: String, bytes: Vec<u8>) -> Result<String, ProjectError> {
    blocking(move || project::store_image(&project::require_project(&PathBuf::from(root))?, &name, &bytes)).await
}

/// Raw bytes of `assets/<image>` for display (sent as binary, not a JSON array).
#[tauri::command]
pub async fn read_asset(root: String, path: String) -> Result<Response, ProjectError> {
    blocking(move || project::read_asset(&project::require_project(&PathBuf::from(root))?, &path)).await.map(Response::new)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::{project, raw, root, run};
    use super::*;

    const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

    #[test]
    fn an_image_is_imported_from_a_path_stored_from_bytes_and_read_back() {
        let (book, src) = (project(), tempfile::tempdir().unwrap());
        std::fs::write(src.path().join("cover.png"), PNG).unwrap();
        let rel = run(import_asset(root(&book), src.path().join("cover.png").to_string_lossy().into_owned())).unwrap();
        assert!(rel.starts_with("assets/") && rel.ends_with(".png"), "{rel}");
        let again = run(import_asset_bytes(root(&book), "map.png".into(), PNG.to_vec())).unwrap();
        assert!(again.starts_with("assets/"), "{again}");
        assert_eq!(raw(run(read_asset(root(&book), rel)).unwrap()), PNG);
    }

    #[test]
    fn asset_commands_refuse_a_folder_that_is_not_a_project_and_bad_input() {
        let (plain, book) = (tempfile::tempdir().unwrap(), project());
        let plain = plain.path().to_string_lossy().into_owned();
        assert!(run(import_asset(plain.clone(), "/nope.png".into())).is_err());
        assert!(run(import_asset_bytes(plain.clone(), "a.png".into(), PNG.to_vec())).is_err());
        assert!(run(read_asset(plain, "assets/a.png".into())).is_err());
        assert!(run(import_asset_bytes(root(&book), "a.png".into(), b"not an image".to_vec())).is_err());
    }
}
