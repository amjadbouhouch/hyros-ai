/// All application logic lives here (required for mobile builds — Tauri
/// replaces `main()` with `mobile_entry_point` on mobile targets).
///
/// Commands not registered in `generate_handler![]` silently fail when
/// invoked from the frontend, so every `#[tauri::command]` must be listed.

const KEYCHAIN_SERVICE: &str = "com.hyros-ai.desktop";
const KEYCHAIN_ACCOUNT: &str = "supabase-session";

#[tauri::command]
fn greet(name: String) -> String {
    format!("Hello, {}! Welcome to Hyros AI Desktop.", name)
}

/// Open a URL in the system default browser. Used by the Google OAuth flow
/// (TASK-004) to open the Supabase consent page in the user's real browser
/// (e.g. Chrome), where their Google account is already signed in — instead of
/// an embedded webview that would force them to type credentials again.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

/// Save the Supabase session JSON to the OS keychain (macOS Keychain,
/// Windows Credential Manager, Linux Secret Service). Called after a
/// successful OAuth exchange so the session survives app restarts.
#[tauri::command]
fn save_session(session: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| e.to_string())?;
    entry.set_password(&session).map_err(|e| e.to_string())
}

/// Read the persisted Supabase session JSON from the OS keychain.
/// Returns Ok(None) if no session is stored (first launch / signed out).
#[tauri::command]
fn get_session() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Clear the persisted session from the keychain (sign-out).
#[tauri::command]
fn clear_session() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Guards against keyring's silent mock fallback: without the
    /// `apple-native` cargo feature, `set_password` on one `Entry` instance
    /// and `get_password` on a fresh one (exactly how `save_session` /
    /// `get_session` are invoked from the frontend) does NOT round-trip —
    /// which is how the mock store broke dev-mode sign-in. This test only
    /// passes against a real platform credential store.
    #[test]
    fn keychain_round_trip_across_entry_instances() {
        const ACCOUNT: &str = "roundtrip-test";

        let writer = keyring::Entry::new(KEYCHAIN_SERVICE, ACCOUNT).unwrap();
        writer.set_password("secret").unwrap();

        let reader = keyring::Entry::new(KEYCHAIN_SERVICE, ACCOUNT).unwrap();
        assert_eq!(reader.get_password().unwrap(), "secret");

        let cleaner = keyring::Entry::new(KEYCHAIN_SERVICE, ACCOUNT).unwrap();
        cleaner.delete_credential().unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_url,
            save_session,
            get_session,
            clear_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}