//! App-level commands.
use crate::project::ProjectError;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

/// The license documents Help > Licenses can show, as (id, file in the bundled `licenses/` folder). The ids are the whole
/// allow list: the webview never passes a path.
const LICENSE_FILES: [(&str, &str); 6] = [
    ("license", "LICENSE.txt"),
    ("clarifications", "LICENSE-CLARIFICATIONS.md"),
    ("notice", "NOTICE.txt"),
    ("programs", "THIRD_PARTY_NOTICES.txt"),
    ("rust", "THIRD_PARTY_NOTICES-rust.txt"),
    ("npm", "THIRD_PARTY_NOTICES-npm.txt"),
];

/// Reads one license document from the bundled `licenses/` folder.
pub fn read_license_file(dir: &Path, id: &str) -> Result<String, ProjectError> {
    let (_, file) =
        LICENSE_FILES.iter().find(|(known, _)| *known == id).ok_or_else(|| ProjectError::Io { message: format!("unknown license document: {id}") })?;
    Ok(std::fs::read_to_string(dir.join(file))?)
}

/// The text of one license document (`license`, `clarifications`, `notice`, `programs`, `rust` or `npm`).
#[tauri::command]
pub fn read_license<R: Runtime>(app: AppHandle<R>, id: String) -> Result<String, ProjectError> {
    let dir = app.path().resource_dir().map_err(|e| ProjectError::Io { message: e.to_string() })?;
    read_license_file(&dir.join("licenses"), &id)
}

/// Whether this build can update itself. Linux packages other than an AppImage (a `.deb`) cannot be replaced by the
/// updater, so they are not offered an update.
pub fn self_update_supported(is_linux: bool, appimage: bool) -> bool {
    !is_linux || appimage
}

/// Asked once at startup and before a manual check, so the webview never offers an update it cannot install.
#[tauri::command]
pub fn updates_supported() -> bool {
    self_update_supported(cfg!(target_os = "linux"), std::env::var_os("APPIMAGE").is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_license_document_is_read_by_id_and_an_unknown_id_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("LICENSE.txt"), "the license").unwrap();
        assert_eq!(read_license_file(dir.path(), "license").unwrap(), "the license");
        assert!(read_license_file(dir.path(), "../secret").is_err());
        assert!(read_license_file(dir.path(), "notice").is_err(), "a listed document that is missing is an error");
    }

    #[test]
    fn self_update_is_offered_everywhere_but_a_linux_package_without_appimage() {
        assert!(self_update_supported(false, false));
        assert!(self_update_supported(true, true));
        assert!(!self_update_supported(true, false));
    }

    #[test]
    fn updates_supported_follows_the_platform_and_the_appimage_variable() {
        assert_eq!(updates_supported(), self_update_supported(cfg!(target_os = "linux"), std::env::var_os("APPIMAGE").is_some()));
    }
}
