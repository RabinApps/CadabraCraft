#[cfg(feature = "dev-automation")]
mod automation;
mod audio;
mod commands;
mod fonts;
mod import_src;
mod platform;
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
            commands::import_reference,
            commands::stat_reference,
            commands::read_reference,
            commands::trash_reference,
            commands::open_reference,
            commands::reference_stream_url,
            commands::watch_project,
            commands::unwatch_project,
            typst::commands::typst_find,
            typst::commands::typst_list_fonts,
            typst::commands::typst_compile,
            typst::commands::typst_query,
            audio::commands::audio_voices,
            audio::commands::audio_render_chapter,
            audio::commands::audio_cancel,
            audio::commands::audio_forget,
            audio::commands::audio_files_exist,
            audio::commands::audio_sample,
            audio::commands::audio_build_m4b,
            audio::commands::audio_packs,
            audio::commands::audio_download_pack,
            audio::commands::audio_delete_pack,
            fonts::commands::fonts_catalog,
            fonts::commands::fonts_installed,
            fonts::commands::fonts_download,
            fonts::commands::fonts_cancel,
            fonts::commands::fonts_import,
            fonts::commands::fonts_delete,
            fonts::commands::fonts_data,
            commands::updates_supported
            $(, $extra)*
        ]
    };
}

#[cfg(test)]
mod ipc_tests;

/// The `cadabra-ref` scheme's handler: the file read runs on the blocking pool, off the UI thread.
fn serve_media<R: tauri::Runtime>(app: &tauri::AppHandle<R>, req: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    use tauri::Manager;
    let roots = app.state::<commands::MediaRoots>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || responder.respond(commands::respond(&roots, &req).map(std::borrow::Cow::Owned)));
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(platform::fs_watch::WatchState::default())
        .manage(audio::AudioJobs::default())
        .manage(commands::MediaRoots::default())
        .register_asynchronous_uri_scheme_protocol(commands::MEDIA_SCHEME, |ctx, req, responder| serve_media(ctx.app_handle(), req, responder))
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
                fonts::set_fonts_dir(dir.join("fonts"));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CadabraCraft");
}
