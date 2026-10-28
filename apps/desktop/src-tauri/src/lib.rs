#[cfg(feature = "dev-automation")]
mod automation;
mod audio;
mod commands;
mod fs_watch;
mod import_src;
mod project;
mod typst;

/// The app's command handlers. `extra` lets the dev-automation build add its own without duplicating the list.
macro_rules! app_handlers {
    ($($extra:path),*) => {
        tauri::generate_handler![
            commands::create_project,
            commands::read_project_file,
            commands::write_project_file,
            commands::backup_manifest,
            commands::trash_project_file,
            commands::list_project_trash,
            commands::restore_project_trash,
            commands::list_page_snapshots,
            commands::read_page_snapshot,
            commands::restore_page_snapshot,
            commands::prune_page_snapshots,
            commands::find_stale_pages,
            commands::write_project_bytes,
            commands::import_asset,
            commands::read_asset,
            commands::read_import_source,
            commands::read_import_image,
            commands::import_asset_bytes,
            commands::watch_project,
            typst::typst_find,
            typst::typst_list_fonts,
            typst::typst_compile,
            audio::commands::audio_voices,
            audio::commands::audio_render_chapter,
            audio::commands::audio_cancel,
            audio::commands::audio_forget,
            audio::commands::audio_files_exist,
            audio::commands::audio_sample,
            audio::commands::audio_packs,
            audio::commands::audio_download_pack,
            audio::commands::audio_delete_pack,
            commands::updates_supported
            $(, $extra)*
        ]
    };
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(fs_watch::WatchState::default())
        .manage(audio::AudioJobs::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Dev-only: lets an AI agent drive the real window. Debug builds with the feature only, and bound to
    // loopback because the plugin's default (all interfaces) would expose unauthenticated script execution.
    #[cfg(all(feature = "dev-automation", debug_assertions))]
    let builder = builder
        .manage(automation::DialogQueue::default())
        .plugin(tauri_plugin_mcp_bridge::Builder::new().bind_address("127.0.0.1").build());
    #[cfg(all(feature = "dev-automation", debug_assertions))]
    let builder = builder.invoke_handler(app_handlers![automation::automation_queue_dialog, automation::automation_take_dialog]);
    #[cfg(not(all(feature = "dev-automation", debug_assertions)))]
    let builder = builder.invoke_handler(app_handlers![]);

    builder
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().resource_dir() {
                typst::set_font_dir(dir.join("fonts"));
            }
            if let Ok(dir) = app.path().app_data_dir() {
                audio::set_voices_dir(dir.join("voices"));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CadabraCraft");
}
