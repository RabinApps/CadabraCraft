// No console window beside the app on Windows in release builds; a debug build keeps it for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cadabracraft_lib::run()
}
