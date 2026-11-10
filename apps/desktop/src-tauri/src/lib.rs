mod audio;
#[cfg(feature = "dev-automation")]
mod automation;
mod commands;
mod fonts;
mod import_docx;
mod import_src;
mod platform;
mod project;
mod epubcheck;
mod typst;

/// The app's command handlers. `extra` lets the dev-automation build add its own without duplicating the list.
macro_rules! app_handlers {
    ($($extra:path),*) => {
        tauri::generate_handler![
            commands::pick_folder,
            commands::pick_image,
            commands::pick_import_source,
            commands::pick_reference_files,
            commands::pick_font_file,
            commands::pick_library_folder,
            commands::scan_library,
            commands::stat_asset,
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
            commands::list_book_snapshots,
            commands::create_book_snapshot,
            commands::prune_book_snapshots,
            commands::rename_book_snapshot,
            commands::pin_book_snapshot,
            commands::read_book_snapshot_page,
            commands::restore_book_snapshot,
            commands::restore_page_from_book_snapshot,
            commands::delete_book_snapshot,
            commands::write_project_bytes,
            commands::import_asset,
            commands::read_asset,
            commands::read_import_source,
            commands::read_import_image,
            commands::import_docx_source,
            commands::import_asset_bytes,
            commands::import_reference,
            commands::stat_reference,
            commands::read_reference,
            commands::trash_reference,
            commands::open_reference,
            commands::open_reference_url,
            commands::reference_stream_url,
            commands::watch_project,
            commands::unwatch_project,
            epubcheck::commands::epubcheck_find,
            epubcheck::commands::epubcheck_validate,
            epubcheck::commands::epubcheck_cancel,
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
            audio::commands::audio_write_transcript,
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
            commands::updates_supported,
            commands::read_license
            $(, $extra)*
        ]
    };
}

/// The handlers without extras, generic over the runtime so the real app and the IPC tests (mock runtime) share one
/// expansion of every command's generated glue.
fn handlers<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    app_handlers![]
}

#[cfg(test)]
mod ipc_tests;

/// The `cadabra-ref` scheme's handler: the file read runs on the blocking pool, off the UI thread.
fn serve_media<R: tauri::Runtime>(app: &tauri::AppHandle<R>, req: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    use tauri::Manager;
    let roots = app.state::<commands::MediaRoots>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || responder.respond(commands::respond(&roots, &req).map(std::borrow::Cow::Owned)));
}

/// Whether the webview may navigate to `url`: only the app's own origin (`tauri://localhost`, or
/// `http://tauri.localhost` on Windows and Android), plus the Vite dev server in debug builds. Everything else (any
/// remote page, `file:`, `data:`, `javascript:`) is refused, so a link or script cannot turn the window into a browser
/// that carries the app's IPC and picked-path rights.
fn navigation_allowed(url: &tauri::Url, dev: bool) -> bool {
    match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) | ("http", Some("tauri.localhost"), None) => true,
        ("http", Some("localhost"), Some(1420)) => dev,
        _ => false,
    }
}

/// A plugin whose only job is the navigation guard. A plugin hook is used because the main window is created from
/// `tauri.conf.json`, so there is no window builder to put `on_navigation` on.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard").on_navigation(|_, url| navigation_allowed(url, cfg!(debug_assertions))).build()
}

/// Files dropped on the window are remembered as picked references (the drop is the author's own choice, and the
/// event comes from the operating system, not from the page).
fn remember_drop<R: tauri::Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    use tauri::Manager;
    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
        if let Some(picked) = window.try_state::<commands::PickedPaths>() {
            commands::record_drop(&picked, paths);
        }
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(platform::fs_watch::WatchState::default())
        .manage(audio::AudioJobs::default())
        .manage(epubcheck::EpubcheckJob::default())
        .manage(commands::MediaRoots::default())
        .manage(commands::PickedPaths::default())
        .register_asynchronous_uri_scheme_protocol(commands::MEDIA_SCHEME, |ctx, req, responder| serve_media(ctx.app_handle(), req, responder))
        .plugin(navigation_guard())
        .on_window_event(remember_drop)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Dev-only: lets an AI agent drive the real window. Debug builds with the feature only, and bound to
    // loopback because the plugin's default (all interfaces) would expose unauthenticated script execution.
    #[cfg(all(feature = "dev-automation", debug_assertions))]
    let builder = builder.manage(automation::DialogQueue::default()).plugin(tauri_plugin_mcp_bridge::Builder::new().bind_address("127.0.0.1").build());
    #[cfg(all(feature = "dev-automation", debug_assertions))]
    let builder = builder.invoke_handler(app_handlers![automation::automation_queue_dialog]);
    #[cfg(not(all(feature = "dev-automation", debug_assertions)))]
    let builder = builder.invoke_handler(handlers());

    builder
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().resource_dir() {
                typst::set_font_dir(dir.join("fonts"));
                epubcheck::set_resource_dir(dir.clone());
            }
            if let Ok(dir) = app.path().app_data_dir() {
                audio::set_voices_dir(dir.join("voices"));
                fonts::set_fonts_dir(dir.join("fonts"));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running CadabraCraft: {e}");
            std::process::exit(1)
        });
}

#[cfg(test)]
mod navigation_tests {
    use super::navigation_allowed;

    fn allowed(url: &str, dev: bool) -> bool {
        navigation_allowed(&url.parse().unwrap(), dev)
    }

    #[test]
    fn only_the_apps_own_origin_may_be_navigated_to() {
        for ok in ["tauri://localhost", "tauri://localhost/index.html", "http://tauri.localhost/", "http://tauri.localhost/index.html#x"] {
            assert!(allowed(ok, false) && allowed(ok, true), "{ok}");
        }
        for bad in [
            "https://example.com",
            "http://example.com/tauri://localhost",
            "https://tauri.localhost",
            "tauri://evil",
            "tauri://localhost.evil.com",
            "http://tauri.localhost.evil.com",
            "http://tauri.localhost:8080/",
            "http://localhost:1421/",
            "file:///usr/bin/x",
            "data:text/html,hi",
            "javascript:alert(1)",
            "blob:tauri://localhost/x",
            "cadabra-ref://localhost/t/a.mp4",
            "about:blank",
            "ftp://tauri.localhost",
        ] {
            assert!(!allowed(bad, true), "{bad}");
            assert!(!allowed(bad, false), "{bad}");
        }
    }

    #[test]
    fn the_dev_server_is_allowed_in_debug_builds_only() {
        assert!(allowed("http://localhost:1420/", true));
        assert!(allowed("http://localhost:1420/src/main.tsx", true));
        assert!(!allowed("http://localhost:1420/", false));
        assert!(!allowed("http://localhost/", true));
        assert!(!allowed("http://localhost:3000/", true));
        assert!(!allowed("https://localhost:1420/", true));
        assert!(!allowed("http://127.0.0.1:1420/", true));
    }
}
