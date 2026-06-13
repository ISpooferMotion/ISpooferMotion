#![allow(clippy::needless_pass_by_value)]
pub mod processor;
pub mod state;
pub mod types;

use crate::commands::discord::AnyValue;
use tauri::AppHandle;

use processor::process_spoofer_action;
use state::update_spoofer_control;
use types::SpooferActionRequest;

#[tauri::command]
#[specta::specta]
pub async fn run_spoofer_action(
    app: AppHandle,
    data: SpooferActionRequest,
) -> crate::error::Result<()> {
    process_spoofer_action(app, data).await
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn spoofer_pause(job_id: String) -> bool {
    update_spoofer_control(&job_id, |control| control.paused = true)
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn spoofer_resume(job_id: String) -> bool {
    update_spoofer_control(&job_id, |control| control.paused = false)
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn spoofer_cancel(job_id: String) -> bool {
    update_spoofer_control(&job_id, |control| control.cancelled = true)
}

#[tauri::command]
#[specta::specta]
pub async fn check_session(app: AppHandle) -> crate::error::Result<AnyValue> {
    let result = crate::commands::session::load_session(app).await?;
    Ok(result.unwrap_or(AnyValue(serde_json::Value::Null)))
}
