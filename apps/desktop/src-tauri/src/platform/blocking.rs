//! Runs blocking work on Tauri's blocking pool.

/// Runs blocking work on Tauri's blocking thread pool so it never stalls the UI thread or async runtime. A failed join
/// (panic in `f`) becomes the error type via `From<tauri::Error>`. Shared by every file/process command.
pub async fn blocking<T: Send + 'static, E: From<tauri::Error> + Send + 'static>(f: impl FnOnce() -> Result<T, E> + Send + 'static) -> Result<T, E> {
    tauri::async_runtime::spawn_blocking(f).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::ProjectError;

    #[test]
    fn returns_the_closure_result_and_turns_a_panic_into_the_error_type() {
        let ok = tauri::async_runtime::block_on(blocking(|| Ok::<_, ProjectError>(7)));
        assert_eq!(ok, Ok(7));
        let err = tauri::async_runtime::block_on(blocking(|| Err::<u8, _>(ProjectError::AlreadyExists)));
        assert_eq!(err, Err(ProjectError::AlreadyExists));
        let panicked = tauri::async_runtime::block_on(blocking(|| -> Result<u8, ProjectError> { panic!("worker panic") }));
        assert!(matches!(panicked, Err(ProjectError::Io { .. })));
    }
}
