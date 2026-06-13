pub mod app;
pub mod job;
pub mod logging;
pub mod profile;
pub mod secrets;

pub use app::{
    __cmd__clear_plugin_cache, __cmd__get_app_version, __cmd__get_release_source,
    __cmd__get_runtime_info, __cmd__open_external, __cmd__quit_app, __cmd__select_folder,
    __cmd__uninstall_app, __cmd__window_close, __cmd__window_minimize,
    __tauri_command_name_clear_plugin_cache, __tauri_command_name_get_app_version,
    __tauri_command_name_get_release_source, __tauri_command_name_get_runtime_info,
    __tauri_command_name_open_external, __tauri_command_name_quit_app,
    __tauri_command_name_select_folder, __tauri_command_name_uninstall_app,
    __tauri_command_name_window_close, __tauri_command_name_window_minimize, clear_plugin_cache,
    get_app_version, get_release_source, get_runtime_info, open_external, quit_app, select_folder,
    uninstall_app, window_close, window_minimize,
};
pub use job::{
    __cmd__check_session, __cmd__run_spoofer_action, __cmd__spoofer_cancel, __cmd__spoofer_pause,
    __cmd__spoofer_resume, __tauri_command_name_check_session,
    __tauri_command_name_run_spoofer_action, __tauri_command_name_spoofer_cancel,
    __tauri_command_name_spoofer_pause, __tauri_command_name_spoofer_resume, check_session,
    run_spoofer_action, spoofer_cancel, spoofer_pause, spoofer_resume,
};
pub use logging::{
    __cmd__append_debug_log, __cmd__copy_debug_info, __cmd__export_support_report,
    __cmd__open_logs_folder, __cmd__open_plugins_folder, __tauri_command_name_append_debug_log,
    __tauri_command_name_copy_debug_info, __tauri_command_name_export_support_report,
    __tauri_command_name_open_logs_folder, __tauri_command_name_open_plugins_folder,
    append_debug_log, copy_debug_info, export_support_report, open_logs_folder,
    open_plugins_folder,
};
pub use profile::{
    __cmd__fetch_audio_quota, __cmd__get_roblox_profile, __tauri_command_name_fetch_audio_quota,
    __tauri_command_name_get_roblox_profile, fetch_audio_quota, get_roblox_profile,
};
pub use secrets::{
    __cmd__clear_profile_secrets, __cmd__load_profile_secrets, __cmd__load_renderer_settings,
    __cmd__save_profile_secrets, __cmd__save_renderer_settings,
    __tauri_command_name_clear_profile_secrets, __tauri_command_name_load_profile_secrets,
    __tauri_command_name_load_renderer_settings, __tauri_command_name_save_profile_secrets,
    __tauri_command_name_save_renderer_settings, clear_profile_secrets, load_profile_secrets,
    load_renderer_settings, save_profile_secrets, save_renderer_settings, ProfileRequest,
};

use keyring::Entry;
use regex::Regex;
use reqwest::header::{COOKIE, USER_AGENT};
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::utils::build_roblox_cookie_header;

pub(super) async fn read_json_file(path: &PathBuf) -> Value {
    match tokio::fs::read_to_string(path).await {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or(Value::Object(serde_json::Map::new()))
        }
        Err(_) => Value::Object(serde_json::Map::new()),
    }
}

pub(super) async fn write_json_file(path: &PathBuf, value: &Value) -> crate::error::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let json_str = serde_json::to_string_pretty(value)?;
    tokio::fs::write(path, json_str).await.map_err(crate::error::AppError::from)
}

pub(super) fn redact_log_message(message: &str) -> String {
    let mut redacted = message.to_string();
    for key in ["USERPROFILE", "HOME"] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                redacted = redacted.replace(&value, "####");
            }
        }
    }
    for key in ["USERNAME", "USER"] {
        if let Ok(value) = std::env::var(key) {
            if value.len() > 2 {
                redacted = redacted.replace(&value, "####");
            }
        }
    }

    let patterns = [
        (r"(?i)([a-z]:\\users\\)[^\\/\s]+", "$1####"),
        (r"(?i)(/users/)[^/\s]+", "$1####"),
        (r"(?i)(/home/)[^/\s]+", "$1####"),
        (r"(?i)(\b(?:user(?:name)?|display[_ -]?name|profile)\s*[:=]\s*)[^\s,;]+", "$1####"),
        (r"(?i)(\.roblosecurity=)[^\s,;]+", "$1####"),
        (r"(?i)(\b(?:x-api-key|api[_ -]?key)\s*[:=]\s*)[^\s,;]+", "$1####"),
    ];
    for (pattern, replacement) in patterns {
        if let Ok(regex) = Regex::new(pattern) {
            redacted = regex.replace_all(&redacted, replacement).into_owned();
        }
    }
    redacted
}

pub fn append_log_entry(
    app: &AppHandle,
    level: &str,
    source: &str,
    message: &str,
) -> crate::error::Result<()> {
    let logs_dir = app.path().app_data_dir()?.join("ispoofer_logs");
    std::fs::create_dir_all(&logs_dir)?;
    logging::cleanup_logs_dir(&logs_dir);
    let file_path = logs_dir.join(format!("debug-{}.txt", chrono::Local::now().format("%Y-%m-%d")));
    let mut file = OpenOptions::new().create(true).append(true).open(file_path)?;
    writeln!(
        file,
        "[{}] [{}] [{}] {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        level.to_uppercase(),
        source,
        redact_log_message(message)
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{logging::sanitized_context_pub, redact_log_message};

    #[test]
    fn redacts_identifying_paths_and_cookie_values() {
        let message = r#"C:\Users\private-name\project /Users/private-name/project /home/private-name/project username=private-name .ROBLOSECURITY=secret x-api-key=also-secret apiKey=another-secret"#;
        let redacted = redact_log_message(message);

        assert!(!redacted.contains("private-name"));
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("####"));
    }

    #[test]
    fn redacts_sensitive_support_report_context() {
        let context = serde_json::json!({
            "cookie": "secret-cookie",
            "apiKey": "secret-key",
            "nested": {
                "path": r"C:\Users\private-name\project"
            }
        });
        let redacted = sanitized_context_pub(Some(context)).to_string();

        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("private-name"));
        assert!(redacted.contains("####"));
    }
}
