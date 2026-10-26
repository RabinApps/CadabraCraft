mod commands;
mod fs_watch;
mod import_src;
mod project;
mod typst;

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
            commands::import_asset,
            commands::read_asset,
            commands::read_import_source,
            commands::read_import_image,
            commands::import_asset_bytes,
            commands::watch_project,
            typst::typst_find,
            typst::typst_list_fonts,
            typst::typst_compile
        ])
        .run(tauri::generate_context!())
        .expect("error while running CadabraCraft");
}
