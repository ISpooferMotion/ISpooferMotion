// This file contains all the Axum route handlers for the bridge server.
// We keep the state locked down so we don't accidentally race between the UI and Studio requests.
use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

use super::messages::{
    analyze_records, count_keyframe_warnings, plan_patches, AssetStore, StudioRecord,
};
use super::{
    allow_key_discovery, get_persistent_api_key, pairing_confirmed, AppState, PLUGIN_API_KEY,
    STUDIO_PROTOCOL_VERSION,
};

pub async fn handle_discover_key() -> Response {
    if !*allow_key_discovery().read().await {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "pairing_closed" }))).into_response();
    }
    Json(json!({ "key": PLUGIN_API_KEY.get_or_init(get_persistent_api_key) })).into_response()
}

pub async fn handle_confirm_pairing() -> Json<Value> {
    *pairing_confirmed().write().await = true;
    *allow_key_discovery().write().await = false;
    Json(json!({ "ok": true }))
}

pub async fn handle_studio_health(State(state): State<AppState>) -> Json<Value> {
    let guard = state.data.read().await;
    let synced =
        guard.last_plugin_poll_time.is_some_and(|poll| poll.elapsed() < Duration::from_secs(5));
    Json(serde_json::json!({
        "synced": synced,
        "protocolVersion": STUDIO_PROTOCOL_VERSION,
        "scanStatus": guard.scan_status,
        "studioPlaceId": guard.studio_place_id
    }))
}

// Fired when Studio starts dumping the entire workspace to us.
// We reset all the old state so we're working with fresh data.
pub async fn handle_scan_start(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> &'static str {
    let mut guard = state.data.write().await;
    guard.last_plugin_poll_time = Some(Instant::now());
    guard.pending_studio_records = std::sync::Arc::new(Vec::new());
    let incoming_place_id = payload
        .get("placeId")
        .and_then(|value| {
            value
                .as_u64()
                .map(|id| id.to_string())
                .or_else(|| value.as_str().map(std::string::ToString::to_string))
        })
        .filter(|id| id != "0" && id.chars().all(|character| character.is_ascii_digit()));
    if incoming_place_id.is_some() {
        guard.studio_place_id = incoming_place_id;
    }
    guard.last_sounds = AssetStore { scanning: true, ..Default::default() };
    guard.last_animations = AssetStore { scanning: true, ..Default::default() };
    guard.last_images = AssetStore { scanning: true, ..Default::default() };
    guard.last_meshes = AssetStore { scanning: true, ..Default::default() };
    guard.last_script_refs = AssetStore { scanning: true, ..Default::default() };
    guard.scan_records_truncated = false;
    guard.scan_status = Some(serde_json::json!({
        "scanning": true,
        "current_service": "Initializing...",
        "scanned": 0,
        "total": 0
    }));
    "ok"
}

pub async fn handle_scan_progress(
    State(state): State<AppState>,
    Json(mut payload): Json<Value>,
) -> &'static str {
    let mut guard = state.data.write().await;
    guard.last_plugin_poll_time = Some(Instant::now());
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("scanning".to_string(), Value::Bool(true));
    }
    guard.scan_status = Some(payload);
    "ok"
}

pub async fn handle_scan_records(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> &'static str {
    let Some(records) = payload.get("records").and_then(Value::as_array) else {
        return "ok";
    };
    let mut guard = state.data.write().await;
    guard.last_plugin_poll_time = Some(Instant::now());
    let mut truncated = false;
    for record in records {
        if guard.pending_studio_records.len() >= super::MAX_STUDIO_RECORDS {
            truncated = true;
            break;
        }
        if let Ok(record) = serde_json::from_value::<StudioRecord>(record.clone()) {
            if record.property != "Source" || record.value.len() <= super::MAX_SCRIPT_SOURCE_BYTES {
                std::sync::Arc::make_mut(&mut guard.pending_studio_records).push(record);
            }
        }
    }
    if truncated {
        guard.scan_records_truncated = true;
    }
    "ok"
}

pub async fn handle_scan_complete(State(state): State<AppState>) -> Json<Value> {
    let records = {
        let mut guard = state.data.write().await;
        guard.last_plugin_poll_time = Some(Instant::now());
        guard.scan_status = None;
        guard.studio_records = guard.pending_studio_records.clone();
        std::sync::Arc::clone(&guard.studio_records)
    };
    let stores =
        tokio::task::spawn_blocking(move || analyze_records(&records)).await.unwrap_or_else(|e| {
            log::error!("Failed to analyze records: {}", e);
            (
                AssetStore::completed(),
                AssetStore::completed(),
                AssetStore::completed(),
                AssetStore::completed(),
                AssetStore::completed(),
            )
        });
    let mut guard = state.data.write().await;
    (
        guard.last_animations,
        guard.last_sounds,
        guard.last_images,
        guard.last_meshes,
        guard.last_script_refs,
    ) = stores;
    let kf_warnings = count_keyframe_warnings(&guard.last_script_refs);
    guard.keyframe_warning_count = kf_warnings;
    Json(serde_json::json!({
        "ok": true,
        "recordsTruncated": guard.scan_records_truncated,
        "keyframeWarningCount": kf_warnings,
        "totals": {
            "animations": guard.last_animations.assets.len(),
            "sounds": guard.last_sounds.assets.len(),
            "images": guard.last_images.assets.len(),
            "meshes": guard.last_meshes.assets.len(),
            "scriptRefs": guard.last_script_refs.assets.len()
        }
    }))
}

pub async fn handle_scan_abort(State(state): State<AppState>) -> &'static str {
    let mut guard = state.data.write().await;
    guard.scan_status = None;
    guard.pending_studio_records = std::sync::Arc::new(Vec::new());
    guard.last_sounds.scanning = false;
    guard.last_animations.scanning = false;
    guard.last_images.scanning = false;
    guard.last_meshes.scanning = false;
    guard.last_script_refs.scanning = false;
    "ok"
}

// Studio long-polls this endpoint waiting for us to tell it to do something.
// If we have nothing to do for 25 seconds we just return empty so it can loop again.
pub async fn handle_poll(State(state): State<AppState>) -> Json<Value> {
    let timeout = tokio::time::Duration::from_secs(25);
    let start = Instant::now();
    loop {
        {
            let mut guard = state.data.write().await;
            guard.last_plugin_poll_time = Some(Instant::now());
            let request_assets = guard.request_sounds
                || guard.request_animations
                || guard.request_images
                || guard.request_meshes
                || guard.request_script_refs;
            if request_assets {
                guard.request_sounds = false;
                guard.request_animations = false;
                guard.request_images = false;
                guard.request_meshes = false;
                guard.request_script_refs = false;
                return Json(serde_json::json!({ "requestAssets": true }));
            }
        }
        if start.elapsed() > timeout {
            return Json(serde_json::json!({ "requestAssets": false }));
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
    }
}

pub async fn handle_poll_replacements(State(state): State<AppState>) -> Json<Value> {
    let timeout = tokio::time::Duration::from_secs(25);
    let start = Instant::now();
    loop {
        {
            let mut guard = state.data.write().await;
            guard.last_plugin_poll_time = Some(Instant::now());
            if !guard.stored_mappings.is_empty() || !guard.stored_patches.is_empty() {
                let mappings = std::mem::take(&mut guard.stored_mappings);
                let patches = std::mem::take(&mut guard.stored_patches);
                return Json(serde_json::json!({ "mappings": mappings, "patches": patches }));
            }
        }
        if start.elapsed() > timeout {
            return Json(serde_json::json!({ "mappings": [], "patches": [] }));
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
    }
}

// When the UI is done spoofing and wants to swap out old IDs for new ones,
// we queue up the patches here for Studio to grab on its next poll.
pub async fn handle_replace_ids(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    let mappings_raw =
        payload.get("mappings").and_then(Value::as_array).cloned().unwrap_or_default();
    let over_limit = mappings_raw.len() > 5_000;
    let mappings = mappings_raw.into_iter().take(5_000).collect::<Vec<_>>();
    let records = std::sync::Arc::clone(&state.data.read().await.studio_records);
    let plan_mappings = mappings.clone();
    let patches = tokio::task::spawn_blocking(move || plan_patches(&records, &plan_mappings))
        .await
        .unwrap_or_else(|e| {
            log::error!("Failed to plan patches: {}", e);
            Vec::new()
        });
    let mut guard = state.data.write().await;
    guard.stored_mappings = mappings;
    guard.stored_patches = patches;
    Json(serde_json::json!({ "ok": true, "truncated": over_limit }))
}

fn clear_stale(store: &mut AssetStore) {
    let stale_incomplete = store.timestamp.is_some_and(|t| {
        !store.scanning && !store.complete && t.elapsed() > Duration::from_secs(60)
    });
    let stale_complete =
        store.timestamp.is_some_and(|t| store.complete && t.elapsed() > Duration::from_secs(600));
    if stale_incomplete || stale_complete {
        store.assets.clear();
        store.complete = false;
        store.timestamp = None;
    }
}

fn snapshot(store: &mut AssetStore) -> AssetStore {
    clear_stale(store);
    store.clone()
}

macro_rules! snapshot_handler {
    ($name:ident, $field:ident) => {
        pub async fn $name(State(state): State<AppState>) -> Json<AssetStore> {
            Json(snapshot(&mut state.data.write().await.$field))
        }
    };
}

snapshot_handler!(get_last_sounds, last_sounds);
snapshot_handler!(get_last_animations, last_animations);
snapshot_handler!(get_last_images, last_images);
snapshot_handler!(get_last_meshes, last_meshes);
snapshot_handler!(get_last_script_refs, last_script_refs);

macro_rules! request_handler {
    ($name:ident, $flag:ident, $store:ident) => {
        pub async fn $name(State(state): State<AppState>) -> &'static str {
            let mut guard = state.data.write().await;
            guard.$flag = true;
            if !guard.$store.scanning {
                guard.$store = AssetStore::default();
            }
            "ok"
        }
    };
}

request_handler!(request_sounds, request_sounds, last_sounds);
request_handler!(request_animations, request_animations, last_animations);
request_handler!(request_images, request_images, last_images);
request_handler!(request_meshes, request_meshes, last_meshes);
request_handler!(request_script_refs, request_script_refs, last_script_refs);

async fn legacy_poll(State(state): State<AppState>, kind: &'static str) -> Json<Value> {
    let timeout = tokio::time::Duration::from_secs(25);
    let start = Instant::now();
    loop {
        {
            let mut guard = state.data.write().await;
            guard.last_plugin_poll_time = Some(Instant::now());
            let request_assets = match kind {
                "sounds" => std::mem::take(&mut guard.request_sounds),
                "animations" => std::mem::take(&mut guard.request_animations),
                "images" => std::mem::take(&mut guard.request_images),
                _ => false,
            };
            if request_assets {
                return Json(
                    serde_json::json!({ "requestAssets": request_assets, "skipOwnedCheck": guard.skip_owned_check }),
                );
            }
        }
        if start.elapsed() > timeout {
            let skip_owned = state.data.read().await.skip_owned_check;
            return Json(
                serde_json::json!({ "requestAssets": false, "skipOwnedCheck": skip_owned }),
            );
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
    }
}

pub async fn handle_poll_sounds(state: State<AppState>) -> Json<Value> {
    legacy_poll(state, "sounds").await
}

pub async fn handle_poll_animations(state: State<AppState>) -> Json<Value> {
    legacy_poll(state, "animations").await
}

pub async fn handle_poll_images(state: State<AppState>) -> Json<Value> {
    legacy_poll(state, "images").await
}

fn append_legacy_assets(store: &mut AssetStore, payload: &Value) {
    if let Some(assets) = payload.get("assets").and_then(Value::as_array) {
        store.assets.extend(assets.iter().cloned());
    }
}

macro_rules! legacy_assets_handler {
    ($name:ident, $field:ident) => {
        pub async fn $name(
            State(state): State<AppState>,
            Json(payload): Json<Value>,
        ) -> &'static str {
            append_legacy_assets(&mut state.data.write().await.$field, &payload);
            "ok"
        }
    };
}

legacy_assets_handler!(handle_assets_sounds, last_sounds);
legacy_assets_handler!(handle_assets_animations, last_animations);
legacy_assets_handler!(handle_assets_images, last_images);
legacy_assets_handler!(handle_assets_meshes, last_meshes);
legacy_assets_handler!(handle_assets_script_refs, last_script_refs);

macro_rules! legacy_complete_handler {
    ($name:ident, $field:ident) => {
        pub async fn $name(State(state): State<AppState>) -> &'static str {
            let mut guard = state.data.write().await;
            guard.$field.scanning = false;
            guard.$field.complete = true;
            guard.$field.timestamp = Some(Instant::now());
            "ok"
        }
    };
}

legacy_complete_handler!(handle_sounds_complete, last_sounds);
legacy_complete_handler!(handle_animations_complete, last_animations);
legacy_complete_handler!(handle_images_complete, last_images);
legacy_complete_handler!(handle_meshes_complete, last_meshes);
legacy_complete_handler!(handle_script_refs_complete, last_script_refs);

pub async fn handle_api_dump() -> Json<crate::api_dump::ApiDumpProperties> {
    Json(crate::api_dump::get_api_dump_properties().await)
}

pub async fn handle_cloud_theme_sync_now(State(state): State<AppState>) -> Json<Value> {
    use tauri::Emitter;
    let _ = state.app_handle.emit("cloud-theme-sync-now", ());
    Json(json!({ "ok": true }))
}
