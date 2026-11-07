//! Image asset commands.
use super::wire::parse_asset_bytes;
use super::{PickKind, PickedPaths};
use crate::platform::blocking;
use crate::project::{self, ProjectError};
use std::path::PathBuf;
use tauri::http::HeaderMap;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

/// `import_asset`: the source must be an image the author picked with `pick_image`.
fn import_picked(picked: &PickedPaths, root: &str, source: &str) -> Result<String, ProjectError> {
    project::import_image(&project::require_project(&PathBuf::from(root))?, &picked.require(PickKind::Image, &PathBuf::from(source))?)
}

/// Copies an image the user picked (`pick_image`) into `assets/`; returns `assets/<name>`. Any other source is refused.
#[tauri::command]
pub async fn import_asset(picked: State<'_, PickedPaths>, root: String, source: String) -> Result<String, ProjectError> {
    blocking({
        let picked = picked.inner().clone();
        move || import_picked(&picked, &root, &source)
    })
    .await
}

/// The body of `import_asset_bytes`, taking the parts of the request so it can run without a webview.
async fn import_bytes_request(body: &InvokeBody, headers: &HeaderMap) -> Result<String, ProjectError> {
    let (root, name, bytes) = parse_asset_bytes(body, headers)?;
    blocking(move || project::store_image(&project::require_project(&PathBuf::from(root))?, &name, &bytes)).await
}

/// Stores image bytes (from an imported document) in `assets/`; returns the actual `assets/<name>` used. The image is
/// the raw request body and `root` / `name` travel as percent-encoded headers, so a large image is never expanded into a
/// JSON number array before the size check.
#[tauri::command]
pub async fn import_asset_bytes(request: Request<'_>) -> Result<String, ProjectError> {
    import_bytes_request(request.body(), request.headers()).await
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
    use tauri::http::HeaderValue;

    fn headers(root: &str, name: &str) -> HeaderMap {
        let enc = |s: &str| s.replace('/', "%2F");
        let mut h = HeaderMap::new();
        h.insert("root", HeaderValue::from_str(&enc(root)).unwrap());
        h.insert("name", HeaderValue::from_str(name).unwrap());
        h
    }

    fn import_bytes(root: &str, name: &str, bytes: &[u8]) -> Result<String, ProjectError> {
        run(import_bytes_request(&InvokeBody::Raw(bytes.to_vec()), &headers(root, name)))
    }

    const PNG: [u8; 12] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

    #[test]
    fn an_image_is_imported_from_a_picked_path_stored_from_bytes_and_read_back() {
        let (book, src) = (project(), tempfile::tempdir().unwrap());
        let cover = src.path().join("cover.png");
        std::fs::write(&cover, PNG).unwrap();
        let picked = PickedPaths::default();
        picked.record(PickKind::Image, &cover).unwrap();
        let rel = import_picked(&picked, &root(&book), &cover.to_string_lossy()).unwrap();
        assert!(rel.starts_with("assets/") && rel.ends_with(".png"), "{rel}");
        let again = import_bytes(&root(&book), "map.png", &PNG).unwrap();
        assert!(again.starts_with("assets/"), "{again}");
        assert_eq!(raw(run(read_asset(root(&book), rel)).unwrap()), PNG);
    }

    #[test]
    fn asset_commands_refuse_a_folder_that_is_not_a_project_and_bad_input() {
        let (plain, book) = (tempfile::tempdir().unwrap(), project());
        let plain = plain.path().to_string_lossy().into_owned();
        assert!(import_picked(&PickedPaths::default(), &plain, "/nope.png").is_err());
        assert!(import_bytes(&plain, "a.png", &PNG).is_err());
        assert!(run(read_asset(plain, "assets/a.png".into())).is_err());
        assert!(import_bytes(&root(&book), "a.png", b"not an image").is_err());
    }

    #[test]
    fn an_image_that_was_not_picked_is_refused_even_when_it_is_a_real_image() {
        let (book, src) = (project(), tempfile::tempdir().unwrap());
        let (cover, other) = (src.path().join("cover.png"), src.path().join("other.png"));
        std::fs::write(&cover, PNG).unwrap();
        std::fs::write(&other, PNG).unwrap();
        let picked = PickedPaths::default();
        picked.record(PickKind::Image, &cover).unwrap();
        picked.record(PickKind::ImportSource, &other).unwrap(); // picked, but for something else
        let err = import_picked(&picked, &root(&book), &other.to_string_lossy());
        assert_eq!(err, Err(ProjectError::NotPicked { name: "other.png".into() }));
        assert!(import_picked(&picked, &root(&book), &cover.to_string_lossy()).is_ok());
        assert!(import_picked(&picked, &root(&book), &cover.to_string_lossy()).is_ok(), "a pick stays valid for a retry");
        assert!(!book.path().join("assets/other.png").exists());
    }

    #[test]
    fn image_bytes_at_the_cap_are_stored_and_one_more_is_refused() {
        let book = project();
        let mut img = PNG.to_vec();
        img.resize(project::MAX_IMAGE_BYTES as usize, 0);
        assert_eq!(import_bytes(&root(&book), "cap.png", &img).unwrap(), "assets/cap.png");
        img.push(0);
        assert!(matches!(import_bytes(&root(&book), "over.png", &img), Err(ProjectError::TooLarge { max_mb: 25, .. })));
        assert!(matches!(import_bytes(&root(&book), "zero.png", &[]), Err(ProjectError::InvalidImage { .. })));
    }

    #[test]
    fn a_json_number_array_body_is_refused() {
        let book = project();
        let body = InvokeBody::Json(serde_json::json!({ "root": root(&book), "name": "a.png", "bytes": [1, 2] }));
        assert!(run(import_bytes_request(&body, &headers(&root(&book), "a.png"))).is_err());
    }
}
