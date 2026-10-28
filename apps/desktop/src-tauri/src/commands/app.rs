//! App-level commands.

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
