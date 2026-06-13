use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, specta::Type)]
pub struct ConcurrentDownloadTask {
    pub direct_url: Option<String>,
    pub file_path: String,
    pub transfer_id: String,
    pub name: String,
    pub asset_id: String,
    pub asset_type: Option<String>,
}
