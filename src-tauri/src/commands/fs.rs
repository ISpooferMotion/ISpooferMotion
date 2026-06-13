#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::utils::build_roblox_cookie_header;

#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x00000008;

#[derive(serde::Deserialize, specta::Type)]
pub struct NotificationOptions {
    pub title: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn open_data_folder(app: AppHandle) -> crate::error::Result<bool> {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return Ok(false);
    };

    #[cfg(target_os = "windows")]
    let cmd = Command::new("explorer").arg(data_dir).spawn();
    #[cfg(target_os = "macos")]
    let cmd = Command::new("open").arg(data_dir).spawn();
    #[cfg(target_os = "linux")]
    let cmd = Command::new("xdg-open").arg(data_dir).spawn();

    Ok(cmd.is_ok())
}

#[tauri::command]
#[specta::specta]
pub async fn open_themes_folder(app: AppHandle) -> crate::error::Result<bool> {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return Ok(false);
    };

    let themes_dir = data_dir.join("themes");
    if !themes_dir.exists() {
        let _ = tokio::fs::create_dir_all(&themes_dir).await;
    }

    #[cfg(target_os = "windows")]
    let cmd = Command::new("explorer").arg(themes_dir).spawn();
    #[cfg(target_os = "macos")]
    let cmd = Command::new("open").arg(themes_dir).spawn();
    #[cfg(target_os = "linux")]
    let cmd = Command::new("xdg-open").arg(themes_dir).spawn();

    Ok(cmd.is_ok())
}

#[tauri::command]
#[specta::specta]
pub async fn clear_app_cache(app: AppHandle) -> crate::error::Result<bool> {
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let _ = tokio::fs::remove_dir_all(&cache_dir).await;
        let _ = tokio::fs::create_dir_all(&cache_dir).await;
    }
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn play_roblox_audio(
    app: AppHandle,
    asset_id: String,
    cookie: Option<String>,
    enable_cache: Option<bool>,
) -> crate::error::Result<String> {
    let asset_id = asset_id.trim();
    if asset_id.is_empty() || !asset_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid Roblox audio asset id.".into());
    }

    let cache_enabled = enable_cache.unwrap_or(true);
    let audio_dir = app.path().app_cache_dir()?.join("roblox_audio");
    tokio::fs::create_dir_all(&audio_dir).await?;

    let existing_file = ["ogg", "mp3"]
        .iter()
        .map(|ext| audio_dir.join(format!("sound_{asset_id}.{ext}")))
        .find(|path| path.exists());

    let audio_path = if cache_enabled {
        if let Some(path) = existing_file {
            path
        } else {
            download_roblox_audio(&audio_dir, asset_id, cookie.as_deref()).await?
        }
    } else {
        for ext in ["ogg", "mp3"] {
            let _ = tokio::fs::remove_file(audio_dir.join(format!("sound_{asset_id}.{ext}"))).await;
        }
        download_roblox_audio(&audio_dir, asset_id, cookie.as_deref()).await?
    };

    Ok(audio_path.to_string_lossy().into_owned())
}

async fn download_roblox_audio(
    audio_dir: &std::path::Path,
    asset_id: &str,
    cookie: Option<&str>,
) -> crate::error::Result<std::path::PathBuf> {
    let client =
        reqwest::Client::builder().redirect(reqwest::redirect::Policy::limited(10)).build()?;
    let mut request = client
        .get(format!("https://assetdelivery.roblox.com/v1/asset/?id={asset_id}"))
        .header(reqwest::header::USER_AGENT, "ISpooferMotion/2.0");

    if let Some(cookie_value) = cookie {
        let cookie_header = build_roblox_cookie_header(cookie_value);
        if !cookie_header.is_empty() {
            request = request.header(reqwest::header::COOKIE, cookie_header);
        }
    }

    let response = request.send().await?;
    if !response.status().is_success() {
        return Err(format!("Roblox audio download failed with HTTP {}.", response.status()).into());
    }

    let extension = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map_or("ogg", |content_type| if content_type.contains("mpeg") { "mp3" } else { "ogg" });
    let audio_path = audio_dir.join(format!("sound_{asset_id}.{extension}"));
    let bytes = response.bytes().await?;
    tokio::fs::write(&audio_path, bytes).await?;
    Ok(audio_path)
}

#[tauri::command]
#[specta::specta]
pub async fn show_notification(
    app: AppHandle,
    options: NotificationOptions,
) -> crate::error::Result<bool> {
    app.notification()
        .builder()
        .title(options.title.as_deref().unwrap_or("ISpooferMotion"))
        .body(options.body.as_deref().unwrap_or("Notification"))
        .icon("app-icon")
        .show()
        .map_err(|err| err.to_string())?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn open_dev_console(app: AppHandle) -> crate::error::Result<bool> {
    let logs_dir = app.path().app_data_dir()?.join("ispoofer_logs");

    let mut entries: Vec<_> = match tokio::fs::read_dir(&logs_dir).await {
        Ok(mut dir) => {
            let mut res = Vec::new();
            while let Ok(Some(entry)) = dir.next_entry().await {
                res.push(entry);
            }
            res
        }
        Err(_) => return Ok(false),
    };

    entries.retain(|e| {
        let name = e.file_name().to_string_lossy().to_string();
        name.starts_with("debug-") && name.ends_with(".txt")
    });
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_string());

    if let Some(latest) = entries.last() {
        let path = latest.path();

        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("powershell.exe");
            cmd.args(["-NoExit", "-Command", "Get-Content -LiteralPath $args[0] -Wait"]);
            cmd.arg(path.as_os_str());
            cmd.creation_flags(DETACHED_PROCESS);
            let _ = cmd.spawn();
        }

        #[cfg(target_os = "macos")]
        {
            let path_text = path.to_string_lossy();
            let script = format!(
                "tell application \"Terminal\" to do script \"tail -f \\\"{}\\\"\"",
                path_text.replace("\\", "\\\\").replace("\"", "\\\"")
            );
            let mut cmd = Command::new("osascript");
            cmd.args(["-e", &script]);
            let _ = cmd.spawn();
        }

        #[cfg(target_os = "linux")]
        {
            let mut cmd = Command::new("x-terminal-emulator");
            cmd.args(["-e", "tail", "-f"]);
            cmd.arg(path.as_os_str());
            let _ = cmd.spawn();
        }

        Ok(true)
    } else {
        Ok(false)
    }
}
