#![allow(clippy::needless_pass_by_value)]
use super::{clear_profile_secrets, AppHandle, DialogExt, Manager};
use crate::commands::discord::AnyValue;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[tauri::command]
#[specta::specta]
pub fn window_minimize(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
#[specta::specta]
pub fn open_frontend_devtools(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        #[cfg(debug_assertions)]
        win.open_devtools();
        #[cfg(not(debug_assertions))]
        {
            // DevTools are restricted to debug builds.
            // Notify the frontend so the user knows.
            let _ = win.eval(
                "console.warn('[ISpooferMotion] DevTools are not available in this release build.')"
            );
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn window_close(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

#[tauri::command]
#[specta::specta]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn get_app_version() -> String {
    APP_VERSION.to_string()
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn get_release_source() -> String {
    "ISpooferMotion/ISpooferMotion-V2".to_string()
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn get_runtime_info() -> AnyValue {
    AnyValue(serde_json::json!({
        "appVersion": APP_VERSION,
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "runtime": "tauri"
    }))
}

#[tauri::command]
#[specta::specta]
pub fn open_external(app: AppHandle, url: String) -> crate::error::Result<bool> {
    // just a tiny sanity check so we don't accidentally run arbitrary schemes
    if url.starts_with("https://") || url.starts_with("http://") {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(url, None::<String>);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
#[specta::specta]
pub async fn select_folder(app: AppHandle) -> crate::error::Result<Option<String>> {
    let folder = tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .map_err(|err| err.to_string())?;
    folder
        .map(|path| {
            path.into_path()
                .map(|path| path.to_string_lossy().to_string())
                .map_err(|err| err.to_string().into())
        })
        .transpose()
}

#[tauri::command]
#[specta::specta]
pub async fn uninstall_app(app: AppHandle) -> crate::error::Result<bool> {
    // nuke all user data and credentials before exiting
    let _ = clear_profile_secrets(app.clone(), None).await;
    let _ = crate::commands::discord::clear_discord_report_auth();
    if let Ok(data_dir) = app.path().app_data_dir() {
        let _ = std::fs::remove_dir_all(&data_dir);
    }
    app.exit(0);
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn clear_plugin_cache() -> crate::error::Result<bool> {
    crate::commands::spoofer::clear_asset_cache();
    Ok(true)
}
