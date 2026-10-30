//! Dev-only helpers for agent-driven testing. Compiled only with `--features dev-automation`.
//!
//! Native file dialogs live outside the webview, so an automation client cannot click them. Instead it queues
//! the answers the next dialogs should return. Every picker runs in Rust (folder, image, import source, reference, font) and
//! pops an answer itself via `take_queued`, recording it as picked like a real pick. The webview can only queue answers.
use std::collections::VecDeque;
use std::sync::Mutex;

#[derive(Default)]
pub struct DialogQueue(Mutex<VecDeque<Option<String>>>);

/// Pops the next queued answer for a picker that runs in Rust (`commands/picked.rs`); None when nothing is queued.
pub fn take_queued<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<Option<String>> {
    use tauri::Manager;
    app.try_state::<DialogQueue>()?.0.lock().ok()?.pop_front()
}

/// Replaces the queue. Each entry answers one dialog in order; null cancels it.
#[tauri::command]
pub fn automation_queue_dialog(state: tauri::State<DialogQueue>, answers: Vec<Option<String>>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = answers.into();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_is_fifo_and_supports_cancel() {
        let q = DialogQueue::default();
        *q.0.lock().unwrap() = vec![Some("/a".to_string()), None].into();
        let mut g = q.0.lock().unwrap();
        assert_eq!(g.pop_front(), Some(Some("/a".to_string())));
        assert_eq!(g.pop_front(), Some(None));
        assert_eq!(g.pop_front(), None);
    }
}
