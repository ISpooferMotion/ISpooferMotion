use log::{error, info};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_TRANSFER_DIAGNOSTICS: usize = 10;

#[derive(Serialize, Deserialize, Debug, specta::Type)]
pub struct DiagnosticMetadata {
    pub timestamp: String,
    pub asset_id: String,
    pub asset_mode: String,
    pub error: String,
    pub payload_file: String,
}

#[must_use]
pub fn get_transfer_diagnostics_directory(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().map(|p| p.join("failed-transfer-diagnostics")).ok()
}

pub async fn prune_transfer_diagnostics(dir_path: &Path) {
    if let Ok(mut entries) = tokio::fs::read_dir(dir_path).await {
        let mut dirs = Vec::new();
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(file_type) = entry.file_type().await {
                if file_type.is_dir() {
                    dirs.push(entry.path());
                }
            }
        }

        dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

        if dirs.len() > MAX_TRANSFER_DIAGNOSTICS {
            for dir_to_remove in dirs.iter().skip(MAX_TRANSFER_DIAGNOSTICS) {
                let _ = tokio::fs::remove_dir_all(dir_to_remove).await;
            }
        }
    }
}

pub async fn record_failed_transfer_diagnostic(
    app: &AppHandle,
    asset_id: &str,
    asset_type: Option<&str>,
    file_path: &Path,
    error_msg: &str,
) {
    let Some(diagnostics_dir) = get_transfer_diagnostics_directory(app) else {
        return;
    };

    let _ = tokio::fs::create_dir_all(&diagnostics_dir).await;

    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S%.3fZ").to_string();
    let safe_asset_id = crate::utils::sanitize_filename(asset_id);
    let safe_asset_mode = crate::utils::sanitize_filename(asset_type.unwrap_or("asset"));
    let uuid_str = uuid::Uuid::new_v4().to_string();
    let short_uuid = &uuid_str[0..8];

    let record_name = format!("{timestamp}_{safe_asset_mode}_{safe_asset_id}_{short_uuid}");
    let record_dir = diagnostics_dir.join(record_name);

    if tokio::fs::create_dir_all(&record_dir).await.is_err() {
        return;
    }

    let payload_filename = if let Some(ext) = file_path.extension().and_then(|s| s.to_str()) {
        format!("payload.{ext}")
    } else {
        "payload.bin".to_string()
    };

    let payload_dest = record_dir.join(&payload_filename);
    let _ = tokio::fs::copy(file_path, &payload_dest).await;

    let metadata = DiagnosticMetadata {
        timestamp: chrono::Utc::now().to_rfc3339(),
        asset_id: asset_id.to_string(),
        asset_mode: asset_type.unwrap_or("asset").to_string(),
        error: error_msg.to_string(),
        payload_file: payload_filename,
    };

    let metadata_path = record_dir.join("metadata.json");
    if let Ok(json) = serde_json::to_string_pretty(&metadata) {
        let _ = tokio::fs::write(&metadata_path, json).await;
    } else {
        error!("Failed to serialize diagnostic metadata for {asset_id}");
    }

    info!("Saved failed transfer diagnostic to {record_dir:?}");
    prune_transfer_diagnostics(&diagnostics_dir).await;
}
