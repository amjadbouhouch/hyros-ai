// Thin passthrough — all application logic lives in lib.rs.
// This split is required for mobile builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hyros_ai_desktop_lib::run();
}