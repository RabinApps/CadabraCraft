//! Runs blocking work on Tauri's blocking pool.

/// Runs blocking work on Tauri's blocking thread pool so it never stalls the UI thread or async runtime. A failed join
/// (panic in `f`) becomes the error type via `From<tauri::Error>`. Shared by every file/process command.
pub async fn blocking<T: Send + 'static, E: From<tauri::Error> + Send + 'static>(f: impl FnOnce() -> Result<T, E> + Send + 'static) -> Result<T, E> {
    tauri::async_runtime::spawn_blocking(f).await?
}
