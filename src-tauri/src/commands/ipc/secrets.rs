use super::{read_json_file, write_json_file, AppHandle, Entry, Manager, PathBuf};
use crate::commands::discord::AnyValue;
use serde_json::Value;

fn get_settings_path(app: &AppHandle) -> crate::error::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("renderer-settings.json"))
}

fn get_profile_secrets_path(app: &AppHandle) -> crate::error::Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    Ok(dir.join("profile-secrets.json"))
}

pub(super) fn get_secrets_keyring_entry() -> crate::error::Result<Entry> {
    Entry::new("ISpooferMotion.ProfileSecrets", "default").map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to open credential store: {e}"))
    })
}

#[tauri::command]
#[specta::specta]
pub async fn load_renderer_settings(app: AppHandle) -> crate::error::Result<AnyValue> {
    let path = get_settings_path(&app)?;
    Ok(AnyValue(read_json_file(&path).await))
}

#[tauri::command]
#[specta::specta]
pub async fn save_renderer_settings(
    app: AppHandle,
    settings: AnyValue,
) -> crate::error::Result<bool> {
    let settings = settings.0;
    let path = get_settings_path(&app)?;
    write_json_file(&path, &settings).await?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn load_profile_secrets(app: AppHandle) -> crate::error::Result<AnyValue> {
    if let Ok(entry) = get_secrets_keyring_entry() {
        if let Ok(password) = entry.get_password() {
            if let Ok(value) = serde_json::from_str(&password) {
                return Ok(AnyValue(value));
            }
        }
    }
    let path = get_profile_secrets_path(&app)?;
    if !path.exists() {
        return Ok(AnyValue(Value::Object(serde_json::Map::new())));
    }
    let legacy_secrets = read_json_file(&path).await;
    if legacy_secrets.is_object() {
        let entry = get_secrets_keyring_entry()?;
        let json_str = serde_json::to_string(&legacy_secrets)?;
        entry.set_password(&json_str).map_err(|error| {
            crate::error::AppError::Custom(format!(
                "Failed to migrate secrets into credential store: {error}"
            ))
        })?;
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(AnyValue(legacy_secrets))
}

#[tauri::command]
#[specta::specta]
pub async fn save_profile_secrets(
    app: AppHandle,
    data: AnyValue,
) -> crate::error::Result<AnyValue> {
    let data = data.0;
    let mut all_secrets = load_profile_secrets(app.clone()).await?.0;

    if let (Some(all_obj), Some(data_obj)) = (all_secrets.as_object_mut(), data.as_object()) {
        for (k, v) in data_obj {
            if k != "action" && k != "secrets" {
                if k == "profileCookies" {
                    let profile_cookies = all_obj
                        .entry(k.clone())
                        .or_insert_with(|| Value::Object(serde_json::Map::new()));
                    if let (Some(existing), Some(incoming)) =
                        (profile_cookies.as_object_mut(), v.as_object())
                    {
                        for (profile_id, cookie) in incoming {
                            existing.insert(profile_id.clone(), cookie.clone());
                        }
                    }
                } else {
                    all_obj.insert(k.clone(), v.clone());
                }
            } else if k == "secrets" {
                if let Some(secrets_obj) = v.as_object() {
                    for (sk, sv) in secrets_obj {
                        all_obj.insert(sk.clone(), sv.clone());
                    }
                }
            }
        }
    } else {
        all_secrets = data.clone();
    }

    let entry = get_secrets_keyring_entry()?;
    let json_str = serde_json::to_string(&all_secrets)?;
    entry.set_password(&json_str).map_err(|error| {
        crate::error::AppError::Custom(format!(
            "Failed to save secrets to credential store: {error}"
        ))
    })?;

    let path = get_profile_secrets_path(&app)?;
    let _ = tokio::fs::remove_file(path).await;

    Ok(AnyValue(all_secrets))
}

#[tauri::command]
#[specta::specta]
pub async fn clear_profile_secrets(
    app: AppHandle,
    _profile_id: Option<String>,
) -> crate::error::Result<bool> {
    if let Ok(entry) = get_secrets_keyring_entry() {
        let _ = entry.delete_credential();
    }
    let path = get_profile_secrets_path(&app)?;
    let _ = tokio::fs::remove_file(path).await;
    Ok(true)
}

#[derive(serde::Deserialize, specta::Type)]
pub struct ProfileRequest {
    #[serde(rename = "autoDetect")]
    pub auto_detect: Option<bool>,
    pub cookie: Option<String>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
}
