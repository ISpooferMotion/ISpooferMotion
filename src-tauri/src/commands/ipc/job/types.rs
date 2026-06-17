use crate::commands::discord::AnyValue;
use validator::Validate;

#[derive(serde::Deserialize, specta::Type, Validate)]
// this struct defines all the settings you can pass into a spoofer job from the frontend ui
pub struct SpooferActionRequest {
    #[validate(length(min = 1))]
    pub assets: Option<String>,
    pub cookie: Option<String>,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(rename = "spoofSounds")]
    pub spoof_sounds: Option<bool>,
    #[serde(rename = "uploadTypes")]
    pub upload_types: Option<Vec<String>>,
    #[serde(rename = "downloadPath")]
    pub download_path: Option<String>,
    #[serde(rename = "forcePlaceIds")]
    pub force_place_ids: Option<String>,
    #[serde(rename = "placeIdSearchLimit")]
    pub place_id_search_limit: Option<String>,
    #[serde(rename = "placeName")]
    pub place_name: Option<String>,
    pub concurrent: Option<bool>,
    #[serde(rename = "maxConcurrency")]
    #[validate(range(min = 1, max = 100))]
    pub max_concurrency: Option<u32>,
    #[serde(rename = "skipOwned")]
    pub skip_owned: Option<bool>,
    #[serde(rename = "excludedUserIds")]
    pub excluded_user_ids: Option<String>,
    #[serde(rename = "excludedGroupIds")]
    pub excluded_group_ids: Option<String>,
    #[serde(rename = "skipExistingReplacements")]
    pub skip_existing_replacements: Option<bool>,
    #[serde(rename = "existingReplacements")]
    #[specta(type = Option<String>)]
    pub existing_replacements: Option<AnyValue>,
    #[specta(type = Option<String>)]
    pub account: Option<AnyValue>,
    #[specta(type = Option<String>)]
    pub group: Option<AnyValue>,
    #[serde(rename = "preserveMetadata")]
    pub preserve_metadata: Option<bool>,
    #[serde(rename = "enableArchiveRecovery")]
    pub enable_archive_recovery: Option<bool>,
    #[serde(rename = "proxyUrl")]
    pub proxy_url: Option<String>,
}

#[derive(Debug, Default)]
pub struct AssetDetails {
    pub name: String,
    pub description: String,
}
