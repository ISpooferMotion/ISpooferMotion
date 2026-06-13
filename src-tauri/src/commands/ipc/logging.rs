use super::{
    app, append_log_entry, redact_log_message, write_json_file, AppHandle, Command, Manager, Path,
    Value,
};
use crate::commands::discord::AnyValue;

pub(super) fn cleanup_logs_dir(logs_dir: &Path) {
    const MAX_LOG_AGE: std::time::Duration = std::time::Duration::from_secs(60 * 60 * 24 * 30);

    let Ok(entries) = std::fs::read_dir(logs_dir) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_log = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("debug-") || name.starts_with("job-"));
        if !is_log {
            continue;
        }
        let is_expired = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > MAX_LOG_AGE);
        if is_expired {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn redact_json_value(value: &mut Value) {
    match value {
        Value::String(text) => *text = redact_log_message(text),
        Value::Array(values) => values.iter_mut().for_each(redact_json_value),
        Value::Object(values) => {
            for (key, value) in values {
                let normalized_key = key.to_ascii_lowercase().replace(['_', '-', ' '], "");
                if matches!(
                    normalized_key.as_str(),
                    "cookie" | "roblosecurity" | "apikey" | "xapikey" | "secret" | "token"
                ) {
                    *value = Value::String("####".into());
                } else {
                    redact_json_value(value);
                }
            }
        }
        _ => {}
    }
}

fn sanitized_context(context: Option<Value>) -> Value {
    let mut context = context.unwrap_or(Value::Null);
    redact_json_value(&mut context);
    context
}

#[cfg(test)]
pub(super) fn sanitized_context_pub(context: Option<Value>) -> Value {
    sanitized_context(context)
}

#[tauri::command]
#[specta::specta]
pub async fn append_debug_log(
    app: AppHandle,
    level: String,
    source: Option<String>,
    message: String,
) -> crate::error::Result<bool> {
    append_log_entry(&app, &level, source.as_deref().unwrap_or("ui"), &message)?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn open_logs_folder(app: AppHandle) -> crate::error::Result<bool> {
    let logs_dir = app.path().app_data_dir()?.join("ispoofer_logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    cleanup_logs_dir(&logs_dir);

    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(&logs_dir).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&logs_dir).spawn();
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&logs_dir).spawn();

    Ok(result.is_ok())
}

#[tauri::command]
#[specta::specta]
pub async fn open_plugins_folder(app: AppHandle) -> crate::error::Result<bool> {
    let plugins_dir = app.path().app_data_dir()?.join("plugins");
    let _ = std::fs::create_dir_all(&plugins_dir);

    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(&plugins_dir).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&plugins_dir).spawn();
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&plugins_dir).spawn();

    Ok(result.is_ok())
}

#[tauri::command]
#[specta::specta]
pub async fn copy_debug_info(context: Option<AnyValue>) -> crate::error::Result<String> {
    let context = context.map(|c| c.0);
    let info = serde_json::json!({
        "appVersion": app::APP_VERSION,
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "runtime": "tauri",
        "context": sanitized_context(context)
    });
    serde_json::to_string_pretty(&info).map_err(crate::error::AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn export_support_report(
    app: AppHandle,
    context: Option<AnyValue>,
) -> crate::error::Result<String> {
    let context = context.map(|c| c.0);
    let dir = app.path().app_data_dir()?;
    let report_path =
        dir.join(format!("support-report-{}.json", chrono::Utc::now().timestamp_millis()));
    let report = serde_json::json!({
        "appVersion": app::APP_VERSION,
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "runtime": "tauri",
        "context": sanitized_context(context),
        "createdAt": chrono::Utc::now().to_rfc3339()
    });
    write_json_file(&report_path, &report).await?;
    Ok(report_path.to_string_lossy().to_string())
}
