use crate::commands::discord::AnyValue;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use super::ipc::{read_json_file, write_json_file};

static JOB_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

fn job_mutex() -> &'static Mutex<()> {
    JOB_MUTEX.get_or_init(|| Mutex::new(()))
}

fn get_jobs_path(app: &AppHandle) -> crate::error::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("job-history.json"))
}

// strip out cookies and api keys before saving the job history so we don't leak creds to disk
fn sanitize_job(job: &mut Value) {
    if let Some(config) = job.get_mut("config").and_then(Value::as_object_mut) {
        config.remove("cookie");
        config.remove("apiKey");
        config.remove("api_key");
    }
}

fn sanitize_job_history(jobs: &mut Value) {
    if let Some(entries) = jobs.as_array_mut() {
        for job in entries {
            sanitize_job(job);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_jobs(app: AppHandle) -> crate::error::Result<AnyValue> {
    let _guard = job_mutex().lock().await;
    let path = get_jobs_path(&app)?;
    let mut jobs = read_json_file(&path).await;
    if !jobs.is_array() {
        jobs = Value::Array(vec![]);
    }
    let original = jobs.clone();
    sanitize_job_history(&mut jobs);
    if jobs != original {
        write_json_file(&path, &jobs).await?;
    }
    Ok(AnyValue(jobs))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_job(app: AppHandle, job_id: String) -> crate::error::Result<bool> {
    let _guard = job_mutex().lock().await;
    let path = get_jobs_path(&app)?;
    let mut jobs = read_json_file(&path).await;
    if let Some(entries) = jobs.as_array_mut() {
        let before_len = entries.len();
        entries.retain(|job| job.get("id").and_then(Value::as_str) != Some(&job_id));
        if entries.len() == before_len {
            return Ok(false);
        }
        write_json_file(&path, &jobs).await?;
    }
    Ok(true)
}

// shove a new job into the history file, capping it at 250 entries so it doesn't get huge
pub(super) async fn persist_job(app: &AppHandle, job: Value) -> crate::error::Result<bool> {
    let _guard = job_mutex().lock().await;
    let path = get_jobs_path(app)?;
    let mut jobs = read_json_file(&path).await;
    if !jobs.is_array() {
        jobs = Value::Array(vec![]);
    }
    let mut sanitized_job = job;
    sanitize_job(&mut sanitized_job);
    if let Some(entries) = jobs.as_array_mut() {
        entries.insert(0, sanitized_job);
        entries.truncate(250);
    }
    write_json_file(&path, &jobs).await?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn open_job_log(app: AppHandle, log_path: String) -> crate::error::Result<bool> {
    let logs_dir = app.path().app_data_dir()?.join("ispoofer_logs");
    let canonical_logs_dir = tokio::fs::canonicalize(logs_dir).await?;
    let canonical_log_path = tokio::fs::canonicalize(log_path).await?;

    // sanity check the path to make sure they aren't trying to open an arbitrary file on the system
    if !canonical_log_path.starts_with(canonical_logs_dir) {
        return Err("Job log path is outside the logs directory.".into());
    }
    use tauri_plugin_opener::OpenerExt;
    let _ =
        app.opener().open_path(canonical_log_path.to_string_lossy().to_string(), None::<String>);
    Ok(true)
}
