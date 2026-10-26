//! Dev-only helpers for agent-driven testing. Compiled only with `--features dev-automation`.
//!
//! Native file dialogs live outside the webview, so an automation client cannot click them. Instead it queues
//! the answers the next dialogs should return; `bridge.ts` consumes a queued answer before opening a real dialog.
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;

#[derive(Default)]
pub struct DialogQueue(Mutex<VecDeque<Option<String>>>);

#[derive(Serialize)]
pub struct Dialog {
    /// None means "the user cancelled the dialog".
    pub answer: Option<String>,
}

/// Replaces the queue. Each entry answers one dialog in order; null cancels it.
#[tauri::command]
pub fn automation_queue_dialog(state: tauri::State<DialogQueue>, answers: Vec<Option<String>>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = answers.into();
    Ok(())
}

/// Pops the next queued answer, or None when the queue is empty (the real dialog should open).
#[tauri::command]
pub fn automation_take_dialog(state: tauri::State<DialogQueue>) -> Result<Option<Dialog>, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.pop_front().map(|answer| Dialog { answer }))
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
