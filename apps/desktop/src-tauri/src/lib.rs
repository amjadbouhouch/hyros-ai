/// All application logic lives here (required for mobile builds — Tauri
/// replaces `main()` with `mobile_entry_point` on mobile targets).
///
/// Commands not registered in `generate_handler![]` silently fail when
/// invoked from the frontend, so every `#[tauri::command]` must be listed.

#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}! Welcome to Hyros AI Desktop.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}