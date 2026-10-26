mod commands;
mod fs_watch;
mod project;

pub fn run() {
    tauri::Builder::default()
        .manage(fs_watch::WatchState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::create_project,
            commands::read_project_file,
            commands::write_project_file,
            commands::backup_manifest,
            commands::trash_project_file,
            commands::write_project_bytes,
            commands::watch_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running CadabraCraft");
}
