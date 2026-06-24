use super::{
    apply_upload_auth, emit_transfer_update, is_valid_numeric_id, patch_asset_permissions,
    sanitize_filename, set_rate_limit, wait_rate_limit, AppHandle, Manager, PublishResult,
    RateLimitBucket, RobloxOperationResponse, TransferUpdate, UploadAuth, Value,
};
use serde::Serialize;
use tauri::Emitter;

fn extract_asset_id_from_value(resp_obj: &serde_json::Value) -> Option<String> {
    resp_obj.get("assetId").or(resp_obj.get("Id")).and_then(|id| {
        id.as_str()
            .map(std::string::ToString::to_string)
            .or_else(|| id.as_u64().map(|n| n.to_string()))
    })
}

fn format_wait_seconds(milliseconds: u64) -> String {
    format!("{:.1}s", milliseconds as f64 / 1000.0)
}

fn emit_spoofer_log(app: &AppHandle, level: &str, message: &str) {
    let _ = crate::commands::ipc::append_log_entry(app, level, "spoofer", message);
    let _ = app.emit(
        "spoofer-log",
        serde_json::json!({
            "message": message,
            "level": level,
        }),
    );
}

#[derive(Serialize, specta::Type)]
struct UploadMetadataCreator {
    #[serde(skip_serializing_if = "Option::is_none", rename = "userId")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "groupId")]
    pub group_id: Option<String>,
}

#[derive(Serialize, specta::Type)]
struct UploadMetadataCreationContext {
    pub creator: UploadMetadataCreator,
    #[serde(skip_serializing_if = "Option::is_none", rename = "expectedPrice")]
    pub expected_price: Option<i64>,
}

#[derive(Serialize, specta::Type)]
struct UploadMetadata {
    #[serde(skip_serializing_if = "Option::is_none", rename = "assetType")]
    pub asset_type: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "creationContext")]
    pub creation_context: Option<UploadMetadataCreationContext>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "assetId")]
    pub asset_id: Option<String>,
}

// repeatedly pings the operation endpoint until roblox finishes processing the uploaded asset and gives us the final id
async fn poll_roblox_operation(
    app: &AppHandle,
    client: &reqwest::Client,
    operation_path: &str,
    auth: &UploadAuth,
    transfer_id: &str,
    name: &str,
    original_asset_id: Option<&str>,
) -> Result<String, String> {
    let path = operation_path.trim_start_matches('/');
    let path =
        if path.starts_with("assets/v1/") { path.to_string() } else { format!("assets/v1/{path}") };
    let url = format!("https://apis.roblox.com/{path}");
    for attempt in 0..80 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(750)).await;
        }
        wait_rate_limit(RateLimitBucket::OperationPoll).await;
        let resp = match apply_upload_auth(client.get(&url), auth).send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("Operation poll request failed: {e}")),
        };
        if !resp.status().is_success() {
            if resp.status() == 429 || resp.status() == 403 {
                let retry_after_ms = crate::utils::extract_retry_after(&resp).unwrap_or(2000);
                if resp.status() == 429 {
                    crate::commands::spoofer::record_adaptive_rate_limit(Some(retry_after_ms));
                    set_rate_limit(
                        RateLimitBucket::OperationPoll,
                        std::time::Duration::from_millis(retry_after_ms),
                    );
                    if attempt % 5 == 0 {
                        let message = format!(
                            "Roblox rate limited operation polling for {name}; checking again in {}.",
                            format_wait_seconds(retry_after_ms)
                        );
                        emit_spoofer_log(app, "warn", &message);
                        emit_transfer_update(
                            app,
                            TransferUpdate {
                                id: transfer_id.to_string(),
                                name: Some(name.to_string()),
                                status: Some("rate_limited".into()),
                                direction: Some("upload".into()),
                                progress: None,
                                error: Some(message),
                                original_asset_id: original_asset_id.map(str::to_string),
                                size: None,
                                new_asset_id: None,
                            },
                        );
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(retry_after_ms)).await;
                continue;
            }
            return Err(format!("Operation poll returned error: {}", resp.status()));
        }
        let text = resp.text().await.unwrap_or_default();
        if let Ok(parsed) = serde_json::from_str::<RobloxOperationResponse>(&text) {
            if parsed.done == Some(true) {
                if let Some(error) = parsed.error {
                    return Err(format!("Operation failed: {:?}", error));
                }
                if let Some(resp_obj) = parsed.response {
                    let id = extract_asset_id_from_value(&resp_obj);
                    if let Some(asset_id) = id {
                        return Ok(asset_id);
                    }
                }
                return Err("Operation done but no assetId found.".into());
            }
        }
    }
    Err("Operation timed out after 60 seconds.".into())
}

struct UploadKind {
    asset_type: &'static str,
    file_type: &'static str,
    extension: &'static str,
    needs_universe_permissions: bool,
}

fn upload_kind_for_type(asset_type_name: Option<&str>) -> UploadKind {
    match asset_type_name {
        Some("Mesh") => UploadKind {
            asset_type: "Mesh",
            file_type: "model/x-rbxm",
            extension: "mesh",
            needs_universe_permissions: true,
        },
        Some("Audio") => UploadKind {
            asset_type: "Audio",
            file_type: "audio/ogg",
            extension: "ogg",
            needs_universe_permissions: false,
        },
        Some("Image") => UploadKind {
            asset_type: "Image",
            file_type: "image/png",
            extension: "png",
            needs_universe_permissions: true,
        },
        Some("Plugin") => UploadKind {
            asset_type: "Plugin",
            file_type: "model/x-rbxm",
            extension: "rbxm",
            needs_universe_permissions: false,
        },
        Some("Video") => UploadKind {
            asset_type: "Video",
            file_type: "video/mp4",
            extension: "mp4",
            needs_universe_permissions: false,
        },
        Some("Font") => UploadKind {
            asset_type: "Font",
            file_type: "font/ttf",
            extension: "ttf",
            needs_universe_permissions: false,
        },
        _ => UploadKind {
            asset_type: "Animation",
            file_type: "model/x-rbxm",
            extension: "rbxm",
            needs_universe_permissions: false,
        },
    }
}

// security check to make sure they aren't trying to upload sensitive files from completely random directories on their pc
async fn upload_path_allowed(
    app: &AppHandle,
    file_path: &std::path::Path,
    downloads_root: Option<&str>,
) -> crate::error::Result<std::path::PathBuf> {
    let canonical_file_path =
        tokio::fs::canonicalize(file_path).await.map_err(|_| "Upload file is unavailable.")?;

    let mut allowed_roots = vec![app.path().app_data_dir()?.join("downloads")];
    if let Some(root) = downloads_root.filter(|value| !value.trim().is_empty()) {
        allowed_roots.push(std::path::PathBuf::from(root));
    }

    for root in allowed_roots {
        if let Ok(canonical_root) = tokio::fs::canonicalize(&root).await {
            if canonical_file_path.ancestors().any(|a| a == canonical_root) {
                return Ok(canonical_file_path);
            }
        }
    }

    Err("Upload file path is outside an allowed downloads directory.".into())
}

#[tauri::command]
#[specta::specta]
// the main upload loop. sends the file to the open cloud api, handling retries, random failures, and chunk injection
pub async fn publish_asset_with_progress(
    app: AppHandle,
    file_path: String,
    name: String,
    description: String,
    cookie: String,
    csrf_token: String,
    group_id: Option<String>,
    transfer_id: String,
    asset_type_name: Option<String>,
    api_key: Option<String>,
    user_id: Option<String>,
    _replace_existing: bool,
    original_asset_id: Option<String>,
    universe_id: Option<String>,
    downloads_root: Option<String>,
    proxy_url: Option<String>,
) -> crate::error::Result<PublishResult> {
    for id in [group_id.as_deref(), user_id.as_deref(), original_asset_id.as_deref()]
        .into_iter()
        .flatten()
    {
        if !is_valid_numeric_id(id) {
            return Err("Invalid Roblox creator or asset id.".into());
        }
    }
    let canonical_file_path =
        upload_path_allowed(&app, std::path::Path::new(&file_path), downloads_root.as_deref())
            .await?;

    let file_metadata = match tokio::fs::metadata(&canonical_file_path).await {
        Ok(m) => m,
        Err(e) => {
            let msg = format!("File system error: {e}");
            emit_transfer_update(
                &app,
                TransferUpdate {
                    id: transfer_id.clone(),
                    name: Some(name.clone()),
                    status: Some("error".into()),
                    direction: Some("upload".into()),
                    error: Some(msg.clone()),
                    original_asset_id: None,
                    progress: None,
                    size: None,
                    new_asset_id: None,
                },
            );
            return Ok(PublishResult {
                success: false,
                error: Some(msg),
                asset_id: None,
                replaced_id: None,
            });
        }
    };

    emit_transfer_update(
        &app,
        TransferUpdate {
            id: transfer_id.clone(),
            name: Some(name.clone()),
            size: Some(file_metadata.len()),
            status: Some("processing".into()),
            direction: Some("upload".into()),
            progress: Some(0),
            error: None,
            original_asset_id: None,
            new_asset_id: None,
        },
    );

    let upload_kind = upload_kind_for_type(asset_type_name.as_deref());
    let asset_type = upload_kind.asset_type;
    let file_type = upload_kind.file_type;
    let file_name = format!("{}.{}", sanitize_filename(&name), upload_kind.extension);
    let _is_plugin = asset_type_name.as_deref() == Some("Plugin");

    let mut fallback_buffer: Option<Vec<u8>> = None;
    let mut final_asset_id = None;

    {
        let mut upload_auth = match &api_key {
            Some(k) if !k.trim().is_empty() => UploadAuth::ApiKey(k.clone()),
            _ => {
                let msg = "Uploads require an Open Cloud API key.".to_string();
                emit_transfer_update(
                    &app,
                    TransferUpdate {
                        id: transfer_id.clone(),
                        status: Some("error".into()),
                        error: Some(msg.clone()),
                        progress: Some(0),
                        name: None,
                        original_asset_id: None,
                        direction: None,
                        size: None,
                        new_asset_id: None,
                    },
                );
                return Ok(PublishResult {
                    success: false,
                    error: Some(msg),
                    asset_id: None,
                    replaced_id: None,
                });
            }
        };

        let creator = if let Some(gid) = &group_id {
            UploadMetadataCreator { group_id: Some(gid.clone()), user_id: None }
        } else if let Some(uid) = &user_id {
            UploadMetadataCreator { user_id: Some(uid.clone()), group_id: None }
        } else {
            let msg = "Uploads require a selected user or group creator.".to_string();
            emit_transfer_update(
                &app,
                TransferUpdate {
                    id: transfer_id.clone(),
                    status: Some("error".into()),
                    error: Some(msg.clone()),
                    progress: Some(0),
                    name: None,
                    original_asset_id: None,
                    direction: None,
                    size: None,
                    new_asset_id: None,
                },
            );
            return Ok(PublishResult {
                success: false,
                error: Some(msg),
                asset_id: None,
                replaced_id: None,
            });
        };

        let expected_price =
            if asset_type == "Audio" || asset_type == "Video" { Some(0) } else { None };

        let mut request_metadata = UploadMetadata {
            asset_type: Some(asset_type.to_string()),
            display_name: name.clone(),
            description: description.clone(),
            creation_context: Some(UploadMetadataCreationContext { creator, expected_price }),
            asset_id: None,
        };

        let client = crate::utils::get_http_client_with_proxy(proxy_url.as_deref());
        let url = "https://apis.roblox.com/assets/v1/assets";

        let mut meta_json = serde_json::to_string(&request_metadata)?;

        let mut upload_success = false;
        let mut upload_error = None;
        let mut operation_path = None;

        for attempt in 0..100 {
            wait_rate_limit(RateLimitBucket::Upload).await;

            if attempt == 0 && fallback_buffer.is_none() {
                fallback_buffer = tokio::fs::read(&canonical_file_path).await.ok();
            }

            let file_part = if let Some(buf) = &fallback_buffer {
                reqwest::multipart::Part::bytes(buf.clone())
                    .file_name(file_name.clone())
                    .mime_str(file_type)?
            } else {
                let file =
                    tokio::fs::File::open(&canonical_file_path).await.map_err(|e| e.to_string())?;
                reqwest::multipart::Part::stream(file)
                    .file_name(file_name.clone())
                    .mime_str(file_type)?
            };
            let form = reqwest::multipart::Form::new()
                .text("request", meta_json.clone())
                .part("fileContent", file_part);

            let resp = match apply_upload_auth(client.post(url), &upload_auth)
                .multipart(form)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    upload_error = Some(e.to_string());
                    break;
                }
            };

            let status = resp.status();
            let status_code = status.as_u16();

            if status_code == 401 {
                upload_error = Some(
                    "Invalid API key (401 Unauthorized). Check your Open Cloud API key."
                        .to_string(),
                );
                break;
            }

            if (500..600).contains(&status_code) {
                crate::commands::spoofer::record_adaptive_server_error();
                crate::commands::spoofer::set_circuit_breaker(std::time::Duration::from_secs(10));
                continue;
            }

            if status_code == 400 && request_metadata.asset_type.as_deref() == Some("Plugin") {
                request_metadata.asset_type = Some("Model".to_string());
                meta_json = serde_json::to_string(&request_metadata).unwrap_or(meta_json);
                continue;
            }

            if status_code == 400 && request_metadata.display_name != "Spoofed Asset" {
                request_metadata.display_name = "Spoofed Asset".to_string();
                request_metadata.description = "Uploaded by ISpooferMotion.".to_string();
                meta_json = serde_json::to_string(&request_metadata).unwrap_or(meta_json);
                continue;
            }

            if status_code == 409 {
                if fallback_buffer.is_none() {
                    fallback_buffer = tokio::fs::read(&canonical_file_path).await.ok();
                }
                if let Some(mut mutable_buffer) = fallback_buffer.take() {
                    if file_type == "image/png" {
                        let scan_start = mutable_buffer.len().saturating_sub(64);
                        if let Some(iend_offset) = mutable_buffer[scan_start..]
                            .windows(8)
                            .rposition(|window| window == b"\x00\x00\x00\x00IEND")
                        {
                            let iend_idx = scan_start + iend_offset;
                            let mut random_bytes = [0u8; 4];
                            random_bytes.copy_from_slice(&rand::random::<[u8; 4]>());
                            let chunk_data =
                                format!("ispoofer{}", hex::encode(random_bytes)).into_bytes();
                            let chunk_type = b"tEXt";
                            let mut chunk = Vec::new();
                            let chunk_len = u32::try_from(chunk_data.len()).unwrap_or(0);
                            chunk.extend_from_slice(&chunk_len.to_be_bytes());
                            chunk.extend_from_slice(chunk_type);
                            chunk.extend_from_slice(&chunk_data);
                            let mut crc_hasher = crc32fast::Hasher::new();
                            crc_hasher.update(chunk_type);
                            crc_hasher.update(&chunk_data);
                            chunk.extend_from_slice(&crc_hasher.finalize().to_be_bytes());

                            let mut new_buffer =
                                Vec::with_capacity(mutable_buffer.len() + chunk.len());
                            new_buffer.extend_from_slice(&mutable_buffer[..iend_idx]);
                            new_buffer.extend_from_slice(&chunk);
                            new_buffer.extend_from_slice(&mutable_buffer[iend_idx..]);
                            mutable_buffer = new_buffer;
                        } else {
                            upload_error =
                                Some("Cannot bypass 409 Conflict: Invalid PNG format".to_string());
                            break;
                        }
                    } else if file_type == "model/x-rbxm" {
                        if mutable_buffer.starts_with(b"<roblox!") {
                            if let Some(idx) =
                                mutable_buffer.windows(4).rposition(|w| w == b"END\0")
                            {
                                let mut random_bytes = [0u8; 4];
                                random_bytes.copy_from_slice(&rand::random::<[u8; 4]>());
                                let mut chunk =
                                    b"DUMY\x04\x00\x00\x00\x04\x00\x00\x00\x00\x00\x00\x00"
                                        .to_vec();
                                chunk.extend_from_slice(&random_bytes);
                                let mut new_buffer =
                                    Vec::with_capacity(mutable_buffer.len() + chunk.len());
                                new_buffer.extend_from_slice(&mutable_buffer[..idx]);
                                new_buffer.extend_from_slice(&chunk);
                                new_buffer.extend_from_slice(&mutable_buffer[idx..]);
                                mutable_buffer = new_buffer;
                            } else {
                                upload_error = Some(
                                    "Cannot bypass 409 Conflict: Invalid RBXM format".to_string(),
                                );
                                break;
                            }
                        } else if mutable_buffer.starts_with(b"<roblox xmlns:xmime=")
                            || mutable_buffer.starts_with(b"<roblox xmlns=")
                        {
                            let mut random_bytes = [0u8; 4];
                            random_bytes.copy_from_slice(&rand::random::<[u8; 4]>());
                            let hex_str = format!("<!-- ispoofer{} -->", hex::encode(random_bytes));
                            if let Some(idx) =
                                mutable_buffer.windows(9).rposition(|w| w == b"</roblox>")
                            {
                                let mut new_buffer =
                                    Vec::with_capacity(mutable_buffer.len() + hex_str.len());
                                new_buffer.extend_from_slice(&mutable_buffer[..idx]);
                                new_buffer.extend_from_slice(hex_str.as_bytes());
                                new_buffer.extend_from_slice(&mutable_buffer[idx..]);
                                mutable_buffer = new_buffer;
                            } else {
                                upload_error = Some(
                                    "Cannot bypass 409 Conflict: Invalid RBXMX format".to_string(),
                                );
                                break;
                            }
                        } else {
                            upload_error = Some(
                                "Cannot bypass 409 Conflict: Unknown model format".to_string(),
                            );
                            break;
                        }
                    } else {
                        upload_error = Some("Cannot bypass 409 Conflict: File type does not support hash modification".to_string());
                        break;
                    }
                    fallback_buffer = Some(mutable_buffer);
                }
                continue;
            }

            if status_code == 429 {
                let retry_after_ms = crate::utils::extract_retry_after(&resp).unwrap_or(30_000);
                let jitter_ms: u64 = {
                    use rand::Rng;
                    rand::rng().random_range(0..800)
                };
                let sleep_duration = retry_after_ms + jitter_ms;
                crate::commands::spoofer::record_adaptive_rate_limit(Some(sleep_duration));
                set_rate_limit(
                    RateLimitBucket::Upload,
                    std::time::Duration::from_millis(sleep_duration),
                );
                let message = format!(
                    "Roblox upload rate limit hit for {name}; backing off for {} before retry {} of 100.",
                    format_wait_seconds(sleep_duration),
                    attempt + 1
                );
                emit_spoofer_log(&app, "warn", &message);
                emit_transfer_update(
                    &app,
                    TransferUpdate {
                        id: transfer_id.clone(),
                        name: Some(name.clone()),
                        status: Some("rate_limited".into()),
                        direction: Some("upload".into()),
                        progress: None,
                        error: Some(message),
                        original_asset_id: original_asset_id.clone(),
                        size: None,
                        new_asset_id: None,
                    },
                );
                continue;
            }

            let resp_text = resp.text().await.unwrap_or_default();

            if status_code == 403 && resp_text.contains("Token Validation Failed") {
                if let Ok(new_token) =
                    crate::commands::auth::force_refresh_csrf_token(cookie.clone()).await
                {
                    let mut updated_auth = false;
                    if let UploadAuth::Cookie { token, .. } = &mut upload_auth {
                        *token = new_token;
                        updated_auth = true;
                    }
                    if updated_auth {
                        continue;
                    }
                }
            }

            if !status.is_success() {
                upload_error = Some(format!("Upload failed ({status}): {resp_text}"));
                break;
            }

            if let Ok(parsed) = serde_json::from_str::<RobloxOperationResponse>(&resp_text) {
                if parsed.done == Some(true) {
                    if let Some(resp_obj) = parsed.response {
                        let id = extract_asset_id_from_value(&resp_obj);
                        if let Some(aid) = id {
                            final_asset_id = Some(aid);
                            upload_success = true;
                            crate::commands::spoofer::record_adaptive_success();
                            break;
                        }
                    }
                } else if let Some(path) = parsed.path {
                    operation_path = Some(path);
                    upload_success = true;
                    crate::commands::spoofer::record_adaptive_success();
                    break;
                }
            } else if let Ok(parsed) = serde_json::from_str::<Value>(&resp_text) {
                let id = parsed.get("response").and_then(extract_asset_id_from_value);
                if let Some(aid) = id {
                    final_asset_id = Some(aid);
                    upload_success = true;
                    crate::commands::spoofer::record_adaptive_success();
                    break;
                }
            }

            upload_error = Some("Unexpected response format".into());
            break;
        }

        if !upload_success {
            let msg = upload_error.unwrap_or_else(|| "Unknown upload error".into());
            emit_transfer_update(
                &app,
                TransferUpdate {
                    id: transfer_id.clone(),
                    status: Some("error".into()),
                    error: Some(msg.clone()),
                    progress: Some(0),
                    name: None,
                    original_asset_id: None,
                    direction: None,
                    size: None,
                    new_asset_id: None,
                },
            );
            return Ok(PublishResult {
                success: false,
                error: Some(msg),
                asset_id: None,
                replaced_id: None,
            });
        }

        if let Some(op_path) = operation_path {
            match poll_roblox_operation(
                &app,
                &client,
                &op_path,
                &upload_auth,
                &transfer_id,
                &name,
                original_asset_id.as_deref(),
            )
            .await
            {
                Ok(id) => {
                    final_asset_id = Some(id);
                }
                Err(e) => {
                    let msg = e;
                    emit_transfer_update(
                        &app,
                        TransferUpdate {
                            id: transfer_id.clone(),
                            status: Some("error".into()),
                            error: Some(msg.clone()),
                            progress: Some(0),
                            name: None,
                            original_asset_id: None,
                            direction: None,
                            size: None,
                            new_asset_id: None,
                        },
                    );
                    return Ok(PublishResult {
                        success: false,
                        error: Some(msg),
                        asset_id: None,
                        replaced_id: None,
                    });
                }
            }
        }
    }

    if let Some(id) = final_asset_id {
        if upload_kind.needs_universe_permissions {
            if let Some(uid) = universe_id.filter(|value| !value.trim().is_empty()) {
                let _ = patch_asset_permissions(id.clone(), uid.clone(), cookie, csrf_token).await;
            }
        }

        emit_transfer_update(
            &app,
            TransferUpdate {
                id: transfer_id,
                progress: Some(100),
                status: Some("completed".into()),
                new_asset_id: Some(id.clone()),
                name: None,
                original_asset_id: None,
                direction: None,
                error: None,
                size: None,
            },
        );
        return Ok(PublishResult {
            success: true,
            asset_id: Some(id),
            replaced_id: None,
            error: None,
        });
    }

    let msg = "Upload returned success but no assetId was found.".to_string();
    emit_transfer_update(
        &app,
        TransferUpdate {
            id: transfer_id.clone(),
            status: Some("error".into()),
            error: Some(msg.clone()),
            progress: Some(0),
            name: None,
            original_asset_id: None,
            direction: None,
            size: None,
            new_asset_id: None,
        },
    );
    Ok(PublishResult { success: false, error: Some(msg), asset_id: None, replaced_id: None })
}

#[cfg(test)]
mod tests {
    use super::upload_kind_for_type;

    #[test]
    fn maps_image_and_mesh_upload_kinds() {
        let image = upload_kind_for_type(Some("Image"));
        assert_eq!(image.asset_type, "Image");
        assert!(image.needs_universe_permissions);

        let mesh = upload_kind_for_type(Some("Mesh"));
        assert_eq!(mesh.asset_type, "Mesh");
        assert_eq!(mesh.extension, "mesh");
    }
}
