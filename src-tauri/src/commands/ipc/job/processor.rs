use futures::stream::{self, StreamExt};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use super::state::{begin_spoofer_job, finish_spoofer_job, wait_if_paused};
use super::types::{AssetDetails, SpooferActionRequest};
use crate::commands::ipc::{append_log_entry, logging, redact_log_message};
use std::fs::OpenOptions;
use std::io::Write;
use tauri::{AppHandle, Emitter, Manager};

fn first_valid_place_id(raw: Option<&str>) -> Option<String> {
    raw.unwrap_or_default()
        .split(|character: char| character == ',' || character.is_whitespace())
        .map(str::trim)
        .find(|candidate| !candidate.is_empty() && candidate.chars().all(|c| c.is_ascii_digit()))
        .map(std::string::ToString::to_string)
}

fn valid_place_ids(raw: Option<&str>) -> Vec<String> {
    let mut ids = Vec::new();
    for candidate in raw
        .unwrap_or_default()
        .split(|character: char| character == ',' || character.is_whitespace())
        .map(str::trim)
    {
        if candidate.is_empty() || !candidate.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        if !ids.iter().any(|existing| existing == candidate) {
            ids.push(candidate.to_string());
        }
    }
    ids
}

fn numeric_value_to_string(value: &serde_json::Value) -> Option<String> {
    value
        .as_u64()
        .map(|number| number.to_string())
        .or_else(|| value.as_str().map(std::string::ToString::to_string))
        .filter(|id| !id.is_empty() && id.chars().all(|character| character.is_ascii_digit()))
}

fn selected_account_id(account: &serde_json::Value) -> Option<String> {
    account.get("id").and_then(numeric_value_to_string)
}

async fn fetch_asset_details(
    asset_id: &str,
    cookie: &str,
    client: &reqwest::Client,
) -> Option<AssetDetails> {
    let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
    let req = client.get(&url).header("Cookie", format!(".ROBLOSECURITY={cookie}"));
    let res = req.send().await.ok()?;
    let json: serde_json::Value = res.json().await.ok()?;

    let name = json.get("Name").and_then(|v| v.as_str()).unwrap_or("Spoofed Asset").to_string();
    let description = json
        .get("Description")
        .and_then(|v| v.as_str())
        .unwrap_or("Uploaded by ISpooferMotion.")
        .to_string();

    Some(AssetDetails { name, description })
}

#[allow(clippy::too_many_lines)]
pub async fn process_spoofer_action(
    app: AppHandle,
    data: SpooferActionRequest,
) -> crate::error::Result<()> {
    let start_time = chrono::Utc::now();
    let job_id = format!("{}", chrono::Utc::now().timestamp_millis());
    let app_data_dir = app.path().app_data_dir()?;
    let logs_dir = app_data_dir.join("ispoofer_logs");
    std::fs::create_dir_all(&logs_dir)?;
    logging::cleanup_logs_dir(&logs_dir);

    let user_download_path = data.download_path.clone();
    let base_downloads_dir = if let Some(dp) = user_download_path.filter(|s| !s.trim().is_empty()) {
        std::path::PathBuf::from(dp)
    } else {
        app_data_dir.join("downloads")
    };
    tokio::fs::create_dir_all(&base_downloads_dir).await?;

    let place_name_raw = data.place_name.clone().unwrap_or_else(|| "UnknownPlace".to_string());

    let safe_place_name =
        place_name_raw.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-', "_");

    begin_spoofer_job(&job_id)?;
    let _ = app.emit(
        "spoofer-started",
        serde_json::json!({ "jobId": job_id, "logFilePath": logs_dir.join(format!("job-{job_id}.txt")).to_string_lossy() }),
    );
    let job_log_path = logs_dir.join(format!("job-{job_id}.txt")).to_string_lossy().to_string();
    let enable_archive_recovery = data.enable_archive_recovery.unwrap_or(false);

    let job_log_path_clone = job_log_path.clone();
    let emit_job_log = |app: &AppHandle, msg: &str, level: &str| {
        let _ = append_log_entry(app, level, "spoofer", msg);
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&job_log_path_clone)
        {
            let _ = writeln!(
                file,
                "[{}] [{}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                level.to_uppercase(),
                redact_log_message(msg)
            );
        }
        let _ = app.emit(
            "spoofer-log",
            serde_json::json!({
                "message": msg,
                "level": level
            }),
        );
    };

    emit_job_log(&app, "Starting spoofer job...", "info");

    let proxy_url = data.proxy_url.clone();
    if let Some(url) = proxy_url.as_deref().filter(|s| !s.trim().is_empty()) {
        emit_job_log(&app, &format!("Using HTTP proxy: {}", url), "info");
    }
    let client = Arc::new(crate::utils::get_http_client_with_proxy(proxy_url.as_deref()));

    let assets_str = data.assets.unwrap_or_default();
    let cookie = data.cookie.unwrap_or_default();
    let api_key = data.api_key.unwrap_or_default();
    let group_id = data.group_id.clone();
    let upload_types = data.upload_types.clone().unwrap_or_else(|| {
        vec!["animation".into(), "audio".into(), "image".into(), "mesh".into(), "script_ref".into()]
    });
    let concurrent_enabled = data.concurrent.unwrap_or(false);
    let max_concurrency =
        data.max_concurrency.unwrap_or(if concurrent_enabled { 100 } else { 5 }).clamp(1, 100)
            as usize;
    crate::commands::spoofer::configure_adaptive_concurrency(max_concurrency);
    let skip_owned = data.skip_owned.unwrap_or(false);
    let preserve_metadata = data.preserve_metadata.unwrap_or(true);
    let excluded_users =
        crate::commands::spoofer::parse_excluded_id_list(data.excluded_user_ids.as_deref());
    let excluded_groups =
        crate::commands::spoofer::parse_excluded_id_list(data.excluded_group_ids.as_deref());
    let skip_existing_replacements = data.skip_existing_replacements.unwrap_or(true);
    let existing_replacements: HashMap<String, String> = data
        .existing_replacements
        .and_then(|value| value.0.as_object().cloned())
        .map(|entries| {
            entries
                .into_iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|replacement| (key, replacement.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    let account = data.account.unwrap_or_else(|| {
        crate::commands::discord::AnyValue(serde_json::json!({
            "id": "unknown",
            "name": "Unknown",
            "avatarUrl": ""
        }))
    });
    let account_id = selected_account_id(&account.0);
    let group = data.group;

    if cookie.trim().len() < 50 {
        emit_job_log(&app, "A valid Roblox cookie is required before spoofing.", "error");
        let _ = app.emit(
            "spoofer-result",
            serde_json::json!({"success": false, "output": "Missing Roblox cookie", "jobId": job_id, "logFilePath": job_log_path}),
        );
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    if api_key.trim().len() < 20 {
        emit_job_log(
            &app,
            "An Open Cloud API key is required before spoofing. Create one with Assets read/write access for the selected creator.",
            "error",
        );
        let _ = app.emit(
            "spoofer-result",
            serde_json::json!({"success": false, "output": "Missing Open Cloud API key", "jobId": job_id, "logFilePath": job_log_path}),
        );
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    let mut parsed_assets: Vec<(String, String)> = Vec::new();
    if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&assets_str) {
        for val in arr {
            if let (Some(id), Some(t)) =
                (val.get("id").and_then(|v| v.as_str()), val.get("type").and_then(|v| v.as_str()))
            {
                parsed_assets.push((id.to_string(), t.to_string()));
            }
        }
    } else {
        let parts: Vec<&str> = assets_str
            .split(|c: char| c.is_whitespace() || c == ',' || c == '[' || c == ']')
            .filter(|s| !s.is_empty())
            .collect();
        for p in parts {
            if let Ok(id) = p.parse::<u64>() {
                parsed_assets.push((
                    id.to_string(),
                    if data.spoof_sounds.unwrap_or(false) {
                        "audio".to_string()
                    } else {
                        "animation".to_string()
                    },
                ));
            }
        }
    }

    if parsed_assets.is_empty() {
        emit_job_log(&app, "No valid numeric asset IDs found in input.", "error");
        let _ = app.emit(
            "spoofer-result",
            serde_json::json!({"success": false, "output": "No valid IDs", "jobId": job_id, "logFilePath": job_log_path}),
        );
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    let mut deduped_assets: Vec<(String, String)> = Vec::new();
    let mut seen_asset_ids = HashSet::new();
    for (asset_id, asset_type) in parsed_assets {
        if !seen_asset_ids.insert(asset_id.clone()) {
            continue;
        }
        if skip_existing_replacements && existing_replacements.contains_key(&asset_id) {
            continue;
        }
        deduped_assets.push((asset_id, asset_type));
    }
    parsed_assets = deduped_assets;

    if parsed_assets.is_empty() {
        emit_job_log(
            &app,
            "No assets left to process after deduplication and replacement filters.",
            "warn",
        );
        let _ = app.emit(
            "spoofer-result",
            serde_json::json!({
                "success": true,
                "output": "Nothing to process",
                "jobId": job_id,
                "logFilePath": job_log_path,
                "replacements": {},
                "assetResults": []
            }),
        );
        finish_spoofer_job(&job_id);
        return Ok(());
    }

    let asset_ids: Vec<String> = parsed_assets.iter().map(|(id, _)| id.clone()).collect();
    emit_job_log(&app, &format!("Found {} asset(s) to process.", parsed_assets.len()), "info");
    let total = parsed_assets.len();
    let forced_place_ids = valid_place_ids(data.force_place_ids.as_deref());
    let forced_place_id = first_valid_place_id(data.force_place_ids.as_deref());
    let place_id_search_limit = data
        .place_id_search_limit
        .as_deref()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(10)
        .clamp(1, 50);
    if let Some(place_id) = forced_place_id.as_deref() {
        emit_job_log(
            &app,
            &format!("Using forced Place ID {place_id} for asset delivery."),
            "info",
        );
    } else {
        emit_job_log(
            &app,
            "No Place ID is available for asset delivery. Private or place-scoped assets may fail; save/publish the place in Studio or set Force Place ID(s).",
            "warn",
        );
    }

    let universe_id = if let Some(place_id) = forced_place_id.clone() {
        crate::commands::spoofer::get_universe_id_from_place_id(place_id, cookie.clone()).await.ok()
    } else {
        None
    };
    if let Some(ref universe_id) = universe_id {
        emit_job_log(
            &app,
            &format!("Resolved universe {universe_id} for post-upload asset permissions."),
            "info",
        );
    }

    let csrf_token = Arc::new(Mutex::new(
        crate::commands::auth::get_csrf_token(app.clone(), cookie.clone())
            .await
            .unwrap_or_default(),
    ));
    let downloads_root = base_downloads_dir.to_string_lossy().to_string();
    let upload_group_id = group_id.as_deref();

    let success_count = Arc::new(AtomicUsize::new(0));
    let skip_count = Arc::new(AtomicUsize::new(0));
    let fail_count = Arc::new(AtomicUsize::new(0));
    let interrupted = Arc::new(AtomicBool::new(false));
    let replacements = Arc::new(dashmap::DashMap::new());
    let asset_results = Arc::new(Mutex::new(Vec::new()));
    let creator_place_ids_cache = Arc::new(dashmap::DashMap::<String, Vec<String>>::new());

    let mut batch_urls = std::collections::HashMap::new();
    if let Ok(urls) = crate::commands::spoofer::batch_get_download_urls_for_assets(
        app.clone(),
        parsed_assets.clone(),
        cookie.clone(),
        forced_place_id.clone(),
    )
    .await
    {
        emit_job_log(
            &app,
            &format!("Successfully resolved {} download URLs via batch endpoint.", urls.len()),
            "info",
        );
        batch_urls = urls;
    } else {
        emit_job_log(&app, "Failed to resolve download URLs via batch endpoint. Falling back to individual resolution.", "warn");
    }

    let batch_urls = Arc::new(batch_urls);

    let stream = stream::iter(parsed_assets.into_iter().enumerate());
    stream
        .for_each_concurrent(max_concurrency, |(i, (asset_id, asset_type))| {
            let app = app.clone();
            let job_id = job_id.clone();
            let cookie = cookie.clone();
            let api_key = api_key.clone();
            let group_id = group_id.clone();
            let upload_types = upload_types.clone();
            let account_id = account_id.clone();
            let upload_group_id = upload_group_id.map(std::string::ToString::to_string);
            let forced_place_ids = forced_place_ids.clone();
            let batch_urls = Arc::clone(&batch_urls);
            let creator_place_ids_cache = Arc::clone(&creator_place_ids_cache);
            let replacements = Arc::clone(&replacements);
            let asset_results = Arc::clone(&asset_results);
            let success_count = Arc::clone(&success_count);
            let skip_count = Arc::clone(&skip_count);
            let fail_count = Arc::clone(&fail_count);
            let interrupted = Arc::clone(&interrupted);
            let safe_place_name = safe_place_name.clone();
            let base_downloads_dir = base_downloads_dir.clone();
            let universe_id = universe_id.clone();
            let csrf_token = Arc::clone(&csrf_token);
            let downloads_root = downloads_root.clone();
            let excluded_users = excluded_users.clone();
            let excluded_groups = excluded_groups.clone();
            let proxy_url = proxy_url.clone();
            let client = Arc::clone(&client);

            async move {
                let _adaptive_permit = crate::commands::spoofer::acquire_adaptive_permit().await;
                if interrupted.load(Ordering::Relaxed) {
                    return;
                }
                if let Err(e) = wait_if_paused(&job_id).await {
                    let _ = append_log_entry(&app, "warn", "spoofer", &e.to_string());
                    interrupted.store(true, Ordering::Relaxed);
                    return;
                }

                let _ = app.emit(
                    "spoofer-progress",
                    serde_json::json!({ "jobId": job_id, "current": i + 1, "total": total }),
                );

                if crate::commands::spoofer::should_skip_asset_for_spoofing(
                    app.clone(),
                    &asset_id,
                    &cookie,
                    skip_owned,
                    account_id.as_deref(),
                    upload_group_id.as_deref(),
                    &excluded_users,
                    &excluded_groups,
                )
                .await
                {
                    skip_count.fetch_add(1, Ordering::Relaxed);
                    if let Ok(mut results) = asset_results.lock() {
                        results.push(serde_json::json!({
                            "id": asset_id.clone(),
                            "type": asset_type.clone(),
                            "success": true,
                            "skipped": true,
                            "reason": "filtered"
                        }));
                    }
                    return;
                }

                let msg = format!("Processing asset {} ({}/{})", asset_id, i + 1, total);
                let _ = append_log_entry(&app, "info", "spoofer", &msg);
                let _ =
                    app.emit("spoofer-log", serde_json::json!({ "message": msg, "level": "info" }));

                let mapped_type_name = match asset_type.as_str() {
                    "audio" => "Audio",
                    "mesh" => "Mesh",
                    "image" => "Image",
                    "script_ref" => "Script",
                    "plugin" => "Plugin",
                    _ => "Animation",
                };

                let folder_type_name = match mapped_type_name {
                    "Audio" => "Sounds",
                    "Animation" => "Animations",
                    "Mesh" => "Meshes",
                    "Image" => "Images",
                    "Script" => "Scripts",
                    "Plugin" => "Plugins",
                    _ => "Assets",
                };

                let downloads_dir =
                    base_downloads_dir.join(&safe_place_name).join(folder_type_name);
                let _ = tokio::fs::create_dir_all(&downloads_dir).await;

                let file_ext = if mapped_type_name == "Audio" {
                    "ogg"
                } else if mapped_type_name == "Image" {
                    "png"
                } else {
                    "rbxm"
                };
                let file_path = downloads_dir
                    .join(format!("{asset_id}.{file_ext}"))
                    .to_string_lossy()
                    .to_string();

                let direct_url =
                    if asset_type == "plugin" { None } else { batch_urls.get(&asset_id).cloned() };
                let place_ids_for_download = if forced_place_ids.is_empty() {
                    match crate::commands::spoofer::get_asset_creator_for_asset(
                        app.clone(),
                        asset_id.clone(),
                        cookie.clone(),
                    )
                    .await
                    {
                        Ok((creator_type, creator_id)) => {
                            let cache_key = format!("{creator_type}:{creator_id}");
                            let cached =
                                creator_place_ids_cache.get(&cache_key).map(|v| v.value().clone());
                            if let Some(ids) = cached {
                                ids
                            } else {
                                match crate::commands::spoofer::get_place_id_from_creator(
                                    app.clone(),
                                    creator_type.clone(),
                                    creator_id.clone(),
                                    cookie.clone(),
                                    Some(place_id_search_limit),
                                )
                                .await
                                {
                                    Ok(ids) => {
                                        if !ids.is_empty() {
                                            let msg = format!(
                                                "Found {} candidate Place ID(s) for {} {}.",
                                                ids.len(),
                                                creator_type,
                                                creator_id
                                            );
                                            let _ = append_log_entry(&app, "info", "spoofer", &msg);
                                            let _ = app.emit(
                                            "spoofer-log",
                                            serde_json::json!({ "message": msg, "level": "info" }),
                                        );
                                        }
                                        creator_place_ids_cache.insert(cache_key, ids.clone());
                                        ids
                                    }
                                    Err(_) => Vec::new(),
                                }
                            }
                        }
                        Err(_) => Vec::new(),
                    }
                } else {
                    forced_place_ids.clone()
                };
                let place_id_arg = if place_ids_for_download.is_empty() {
                    None
                } else {
                    Some(place_ids_for_download.join(","))
                };

                let dl_res = crate::commands::spoofer::download_animation_asset_with_progress(
                    app.clone(),
                    direct_url,
                    cookie.clone(),
                    file_path.clone(),
                    format!("dl_{asset_id}"),
                    format!("Asset {asset_id}"),
                    asset_id.clone(),
                    Some(asset_type.clone()),
                    place_id_arg,
                    enable_archive_recovery,
                    proxy_url.clone(),
                )
                .await;

                let mut remove_download_file = false;
                match dl_res {
                    Ok(res) if res.success => {
                        let download_only = asset_type == "script_ref"
                            || !upload_types.contains(&asset_type)
                            || asset_type == "plugin";
                        if download_only {
                            success_count.fetch_add(1, Ordering::Relaxed);
                            skip_count.fetch_add(1, Ordering::Relaxed);
                            if let Ok(mut results) = asset_results.lock() {
                                results.push(serde_json::json!({
                                    "id": asset_id.clone(),
                                    "type": asset_type.clone(),
                                    "success": true
                                }));
                            }
                            return;
                        }

                        if interrupted.load(Ordering::Relaxed) {
                            return;
                        }

                        let upload_user_id =
                            if group_id.is_none() { account_id.clone() } else { None };
                        if group_id.is_none() && upload_user_id.is_none() {
                            fail_count.fetch_add(1, Ordering::Relaxed);
                            if let Ok(mut results) = asset_results.lock() {
                                results.push(serde_json::json!({
                                    "id": asset_id.clone(),
                                    "type": asset_type.clone(),
                                    "success": false,
                                    "stage": "upload",
                                    "errorReason": "No valid user ID"
                                }));
                            }
                            return;
                        }

                        let details = fetch_asset_details(&asset_id, &cookie, &client)
                            .await
                            .unwrap_or_else(|| AssetDetails {
                                name: format!("Spoofed {asset_id}"),
                                description: "Uploaded by ISpooferMotion.".to_string(),
                            });

                        let final_description = if preserve_metadata {
                            details.description
                        } else {
                            "Uploaded by ISpooferMotion.".to_string()
                        };

                        let current_csrf_token =
                            csrf_token.lock().map(|t| t.clone()).unwrap_or_default();

                        let up_res = crate::commands::spoofer::publish_asset_with_progress(
                            app.clone(),
                            file_path.clone(),
                            details.name,
                            final_description,
                            cookie.clone(),
                            current_csrf_token.clone(),
                            group_id.clone(),
                            format!("up_{asset_id}"),
                            Some(mapped_type_name.to_string()),
                            Some(api_key.clone()),
                            upload_user_id,
                            false,
                            Some(asset_id.clone()),
                            universe_id.clone(),
                            Some(downloads_root.clone()),
                            proxy_url.clone(),
                        )
                        .await;

                        match up_res {
                            Ok(up) if up.success => {
                                let new_id = up.asset_id.unwrap_or_default();
                                let msg = format!("Upload successful! New ID: {new_id}");
                                let _ = append_log_entry(&app, "success", "spoofer", &msg);
                                let _ = app.emit(
                                    "spoofer-log",
                                    serde_json::json!({ "message": msg, "level": "success" }),
                                );

                                replacements.insert(
                                    asset_id.clone(),
                                    serde_json::Value::String(new_id.clone()),
                                );
                                if let Ok(mut results) = asset_results.lock() {
                                    results.push(serde_json::json!({
                                        "id": asset_id.clone(),
                                        "type": asset_type.clone(),
                                        "success": true,
                                        "newId": new_id
                                    }));
                                }
                                success_count.fetch_add(1, Ordering::Relaxed);
                                remove_download_file = true;
                            }
                            Ok(up) => {
                                fail_count.fetch_add(1, Ordering::Relaxed);
                                let err_msg = up.error.unwrap_or_default();
                                let msg = format!("Upload failed for {asset_id}: {err_msg}");
                                let _ = append_log_entry(&app, "error", "spoofer", &msg);
                                let _ = app.emit(
                                    "spoofer-log",
                                    serde_json::json!({ "message": msg, "level": "error" }),
                                );
                                if let Ok(mut results) = asset_results.lock() {
                                    results.push(serde_json::json!({
                                        "id": asset_id.clone(),
                                        "type": asset_type.clone(),
                                        "success": false,
                                        "stage": "upload",
                                        "errorReason": err_msg
                                    }));
                                }
                            }
                            Err(e) => {
                                fail_count.fetch_add(1, Ordering::Relaxed);
                                let msg = format!("Upload error for {asset_id}: {e}");
                                let _ = append_log_entry(&app, "error", "spoofer", &msg);
                                let _ = app.emit(
                                    "spoofer-log",
                                    serde_json::json!({ "message": msg, "level": "error" }),
                                );
                                if let Ok(mut results) = asset_results.lock() {
                                    results.push(serde_json::json!({
                                        "id": asset_id.clone(),
                                        "type": asset_type.clone(),
                                        "success": false,
                                        "stage": "upload",
                                        "errorReason": e.to_string()
                                    }));
                                }
                            }
                        }
                    }
                    Ok(res) => {
                        fail_count.fetch_add(1, Ordering::Relaxed);
                        let err_msg = res.error.unwrap_or_default();
                        let msg = format!("Download failed for {asset_id}: {err_msg}");
                        let _ = append_log_entry(&app, "error", "spoofer", &msg);
                        let _ = app.emit(
                            "spoofer-log",
                            serde_json::json!({ "message": msg, "level": "error" }),
                        );
                        if let Ok(mut results) = asset_results.lock() {
                            results.push(serde_json::json!({
                                "id": asset_id.clone(),
                                "type": asset_type.clone(),
                                "success": false,
                                "stage": "download",
                                "errorReason": err_msg
                            }));
                        }
                    }
                    Err(e) => {
                        fail_count.fetch_add(1, Ordering::Relaxed);
                        let msg = format!("Download error for {asset_id}: {e}");
                        let _ = append_log_entry(&app, "error", "spoofer", &msg);
                        let _ = app.emit(
                            "spoofer-log",
                            serde_json::json!({ "message": msg, "level": "error" }),
                        );
                        if let Ok(mut results) = asset_results.lock() {
                            results.push(serde_json::json!({
                                "id": asset_id.clone(),
                                "type": asset_type.clone(),
                                "success": false,
                                "stage": "download",
                                "errorReason": e.to_string()
                            }));
                        }
                    }
                }

                if remove_download_file {
                    let _ = tokio::fs::remove_file(&file_path).await;
                }
            }
        })
        .await;

    let success = success_count.load(Ordering::Relaxed);
    let skipped = skip_count.load(Ordering::Relaxed);
    let failed = fail_count.load(Ordering::Relaxed);
    let interrupted_flag = interrupted.load(Ordering::Relaxed);

    let completed_successfully = !interrupted_flag && failed == 0;
    let status = if completed_successfully {
        "successful"
    } else if success == 0 {
        "errored"
    } else {
        "partially_finished"
    };

    let end_time = chrono::Utc::now();
    let duration_ms = (end_time - start_time).num_milliseconds().max(0);

    let final_asset_results = asset_results.lock().map(|r| r.clone()).unwrap_or_default();
    let final_replacements: serde_json::Map<String, serde_json::Value> =
        replacements.iter().map(|kv| (kv.key().clone(), kv.value().clone())).collect();

    let job = serde_json::json!({
        "id": job_id.clone(),
        "status": status,
        "startTime": start_time.to_rfc3339(),
        "endTime": end_time.to_rfc3339(),
        "durationMs": duration_ms,
        "account": account,
        "group": group,
        "assetResults": final_asset_results,
        "config": {
            "assets": asset_ids.join(","),
            "groupId": group_id.clone(),
            "spoofSounds": data.spoof_sounds.unwrap_or(false),
            "uploadTypes": upload_types.clone(),
            "placeName": data.place_name.clone()
        },
        "logFilePath": job_log_path.clone()
    });
    if let Err(error) = crate::commands::jobs::persist_job(&app, job).await {
        emit_job_log(&app, &format!("Could not save spoofing job history: {error}"), "error");
    }

    let summary = format!(
        "Total Assets: {total}
Successful: {success} (Skipped Uploads: {skipped})
Failed: {failed}"
    );
    emit_job_log(&app, &summary, if completed_successfully { "success" } else { "warn" });
    if !final_replacements.is_empty() {
        emit_job_log(
            &app,
            "Save your place in Roblox Studio after replacements are applied.",
            "info",
        );
    }

    let _ = app.emit(
        "spoofer-result",
        serde_json::json!({
            "success": completed_successfully,
            "partial": !completed_successfully && success > 0,
            "replacements": final_replacements,
            "output": format!("Processed {}/{} assets.", success, total),
            "jobId": job_id,
            "logFilePath": job_log_path,
            "assetResults": final_asset_results
        }),
    );
    finish_spoofer_job(&job_id);

    let is_download_only = data.upload_types.as_ref().is_some_and(|types| {
        types.contains(&"download".to_string()) && !types.contains(&"upload".to_string())
    });

    if success > 0 && is_download_only {
        use tauri_plugin_opener::OpenerExt;
        let _ = app
            .opener()
            .open_path(base_downloads_dir.to_string_lossy().to_string(), None::<String>);
    }

    Ok(())
}
