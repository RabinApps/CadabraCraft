mod commands;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::load_chapter,
            commands::save_chapter,
            commands::save_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running CadabraCraft");
}
