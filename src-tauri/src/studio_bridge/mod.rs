// Sets up the HTTP server that talks locally to the Roblox Studio plugin.
// This acts as the "bridge" between the Tauri app and Studio.
pub mod messages;
pub mod middleware;
pub mod server;

use crate::commands::discord::AnyValue;
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, Method},
    middleware as axum_middleware,
    routing::{get, post},
    Json, Router,
};
use keyring::Entry;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
};
use uuid::Uuid;

use messages::plan_patches;
use middleware::{require_auth, require_json_for_post};
use server::{
    get_last_animations, get_last_images, get_last_meshes, get_last_script_refs, get_last_sounds,
    handle_animations_complete, handle_api_dump, handle_assets_animations, handle_assets_images,
    handle_assets_meshes, handle_assets_script_refs, handle_assets_sounds,
    handle_cloud_theme_sync_now, handle_confirm_pairing, handle_discover_key,
    handle_images_complete, handle_meshes_complete, handle_poll, handle_poll_animations,
    handle_poll_images, handle_poll_replacements, handle_poll_sounds, handle_replace_ids,
    handle_scan_abort, handle_scan_complete, handle_scan_progress, handle_scan_records,
    handle_scan_start, handle_script_refs_complete, handle_sounds_complete, handle_studio_health,
    request_animations, request_images, request_meshes, request_script_refs, request_sounds,
};

const PLUGIN_PORT_START: u16 = 14285;
const PLUGIN_PORT_END: u16 = 14289;
const STUDIO_PROTOCOL_VERSION: u8 = 2;
const MAX_STUDIO_RECORDS: usize = 2_000_000;
const MAX_SCRIPT_SOURCE_BYTES: usize = 8_000_000;

static PLUGIN_API_KEY: OnceLock<String> = OnceLock::new();
static ACTIVE_BRIDGE_PORT: OnceLock<RwLock<Option<u16>>> = OnceLock::new();
static ALLOW_KEY_DISCOVERY: OnceLock<RwLock<bool>> = OnceLock::new();
static PAIRING_CONFIRMED: OnceLock<RwLock<bool>> = OnceLock::new();
static BRIDGE_DATA: OnceLock<Arc<RwLock<AssetServerStateData>>> = OnceLock::new();

pub fn bridge_data() -> Option<Arc<RwLock<AssetServerStateData>>> {
    BRIDGE_DATA.get().cloned()
}

pub fn bridge_api_key() -> String {
    PLUGIN_API_KEY.get_or_init(get_persistent_api_key).clone()
}

pub(crate) fn active_bridge_port() -> &'static RwLock<Option<u16>> {
    ACTIVE_BRIDGE_PORT.get_or_init(|| RwLock::new(None))
}

pub(crate) fn allow_key_discovery() -> &'static RwLock<bool> {
    ALLOW_KEY_DISCOVERY.get_or_init(|| RwLock::new(true))
}

pub(crate) fn pairing_confirmed() -> &'static RwLock<bool> {
    PAIRING_CONFIRMED.get_or_init(|| RwLock::new(false))
}

pub(crate) fn get_persistent_api_key() -> String {
    let entry = Entry::new("ISpooferMotion", "plugin_api_key");
    if let Ok(entry) = entry {
        if let Ok(key) = entry.get_password() {
            return key;
        }
        let new_key = Uuid::new_v4().to_string();
        let _ = entry.set_password(&new_key);
        new_key
    } else {
        Uuid::new_v4().to_string()
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_plugin_api_key() -> String {
    PLUGIN_API_KEY.get_or_init(get_persistent_api_key).clone()
}

#[tauri::command]
#[specta::specta]
pub async fn trigger_key_pairing() {
    *allow_key_discovery().write().await = true;
    *pairing_confirmed().write().await = false;
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn confirm_key_pairing() -> bool {
    *pairing_confirmed().read().await
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn set_bridge_skip_owned_check(skip_owned: bool) -> bool {
    if let Some(data) = bridge_data() {
        data.write().await.skip_owned_check = skip_owned;
        return true;
    }
    false
}

#[must_use]
pub async fn queue_replace_mappings_internal(mappings: Vec<Value>) -> bool {
    let Some(data) = bridge_data() else {
        return false;
    };
    let records = std::sync::Arc::clone(&data.read().await.studio_records);
    if records.is_empty() || mappings.is_empty() {
        return false;
    }
    let patches = plan_patches(&records, &mappings);
    let mut guard = data.write().await;
    guard.stored_mappings = mappings;
    guard.stored_patches = patches;
    true
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn get_pairing_status() -> AnyValue {
    let confirmed = *pairing_confirmed().read().await;
    let open = *allow_key_discovery().read().await;
    AnyValue(json!({ "confirmed": confirmed, "open": open }))
}

use messages::AssetServerStateData;

#[derive(Clone)]
pub struct AppState {
    pub data: Arc<RwLock<AssetServerStateData>>,
    pub bridge_port: u16,
    pub started_at: u128,
    pub app_handle: AppHandle,
}

pub async fn start_server(_app_handle: AppHandle) {
    let Some((listener, addr)) = bind_available_listener().await else {
        eprintln!(
            "Could not start plugin HTTP server: ports {PLUGIN_PORT_START}-{PLUGIN_PORT_END} are unavailable"
        );
        return;
    };
    let data = Arc::new(RwLock::new(AssetServerStateData::default()));
    let _ = BRIDGE_DATA.set(Arc::clone(&data));
    let state = AppState {
        data: Arc::clone(&data),
        bridge_port: addr.port(),
        started_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
        app_handle: _app_handle.clone(),
    };
    *active_bridge_port().write().await = Some(addr.port());

    // We allow localhost/tauri origins so the web frontend can actually hit this API.
    // Pretty permissive because it's only running on localhost anyway.
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _req_parts: &axum::http::request::Parts| {
                let bytes = origin.as_bytes();
                // Permit null/empty origins (chrome-error://, local IPC, etc.)
                if bytes.is_empty() || bytes == b"null" {
                    return true;
                }
                matches!(
                    origin.to_str().unwrap_or(""),
                    "http://localhost:5173"
                        | "http://127.0.0.1:5173"
                        | "http://localhost:3000"
                        | "http://127.0.0.1:3000"
                        | "https://ispoofermotion.com"
                        | "tauri://localhost"
                        | "http://tauri.localhost"
                        | "https://tauri.localhost"
                )
            },
        ))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::HeaderName::from_static("x-api-key"),
        ])
        .allow_private_network(true);

    let app = Router::new()
        .route(
            "/health",
            get(|State(state): State<AppState>| async move {
                let port = *active_bridge_port().read().await;
                let open = *allow_key_discovery().read().await;
                Json(json!({
                    "app": "ISpooferMotion",
                    "port": port.unwrap_or(14285),
                    "startedAt": state.started_at,
                    "allowStudioPairing": open
                }))
            }),
        )
        .route("/auth/discord", post(handle_auth_discord))
        .route("/cloud-theme/sync-now", post(handle_cloud_theme_sync_now))
        .route("/discover-key", get(handle_discover_key))
        .route("/confirm-pairing", get(handle_confirm_pairing))
        .route("/studio-health", get(handle_studio_health))
        .route("/api-dump", get(handle_api_dump))
        .route("/poll", get(handle_poll))
        .route("/scan-start", post(handle_scan_start))
        .route("/scan-progress", post(handle_scan_progress))
        .route("/scan-records", post(handle_scan_records))
        .route("/scan-complete", post(handle_scan_complete))
        .route("/scan-abort", post(handle_scan_abort))
        .route("/poll-sounds", get(handle_poll_sounds))
        .route("/assets-sounds", post(handle_assets_sounds))
        .route("/sounds-complete", post(handle_sounds_complete))
        .route("/poll-animations", get(handle_poll_animations))
        .route("/assets-animations", post(handle_assets_animations))
        .route("/animations-complete", post(handle_animations_complete))
        .route("/poll-images", get(handle_poll_images))
        .route("/assets-images", post(handle_assets_images))
        .route("/images-complete", post(handle_images_complete))
        .route("/assets-meshes", post(handle_assets_meshes))
        .route("/meshes-complete", post(handle_meshes_complete))
        .route("/assets-script-refs", post(handle_assets_script_refs))
        .route("/script-refs-complete", post(handle_script_refs_complete))
        .route("/poll-replacements", get(handle_poll_replacements))
        .route("/replace-ids", post(handle_replace_ids))
        .route("/last-sounds", get(get_last_sounds))
        .route("/last-animations", get(get_last_animations))
        .route("/last-images", get(get_last_images))
        .route("/last-meshes", get(get_last_meshes))
        .route("/last-script-refs", get(get_last_script_refs))
        .route("/request-sounds", post(request_sounds))
        .route("/request-animations", post(request_animations))
        .route("/request-images", post(request_images))
        .route("/request-meshes", post(request_meshes))
        .route("/request-script-refs", post(request_script_refs))
        .layer(axum_middleware::from_fn(require_auth))
        .layer(axum_middleware::from_fn(require_json_for_post))
        .layer(RequestBodyLimitLayer::new(64 * 1024 * 1024))
        .layer(DefaultBodyLimit::disable())
        .layer(cors)
        .with_state(state);

    tokio::spawn(async move {
        println!("Plugin HTTP server listening on {addr}");
        let _ = axum::serve(listener, app).await;
        let mut active_port = active_bridge_port().write().await;
        if *active_port == Some(addr.port()) {
            *active_port = None;
        }
    });
}

#[derive(serde::Deserialize)]
pub struct AuthDiscordPayload {
    #[serde(rename = "loginToken")]
    pub login_token: String,
    pub user: Option<Value>,
}

pub async fn handle_auth_discord(
    State(state): State<AppState>,
    Json(payload): Json<AuthDiscordPayload>,
) -> impl axum::response::IntoResponse {
    let mut auth_payload = serde_json::json!({ "loginToken": payload.login_token });
    if let Some(user) = payload.user {
        auth_payload["user"] = user;
    }
    let _ = crate::commands::discord::save_discord_report_auth(crate::commands::discord::AnyValue(
        auth_payload,
    ));
    let _ = state.app_handle.emit("discord-login-success", ());
    Json(serde_json::json!({ "success": true }))
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn get_plugin_bridge_port() -> Option<u16> {
    *active_bridge_port().read().await
}

// Try a few ports in sequence. People run multiple studio instances sometimes
// or have weird port bindings so we try a small range.
async fn bind_available_listener() -> Option<(tokio::net::TcpListener, SocketAddr)> {
    for port in PLUGIN_PORT_START..=PLUGIN_PORT_END {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
            return Some((listener, addr));
        }
    }
    None
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn get_studio_health_status() -> AnyValue {
    let Some(data) = bridge_data() else {
        return AnyValue(
            json!({ "synced": false, "protocolVersion": STUDIO_PROTOCOL_VERSION, "scanStatus": null, "studioPlaceId": null }),
        );
    };
    let guard = data.read().await;
    let synced = guard
        .last_plugin_poll_time
        .is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(3));
    AnyValue(json!({
        "synced": synced,
        "protocolVersion": STUDIO_PROTOCOL_VERSION,
        "scanStatus": guard.scan_status,
        "studioPlaceId": guard.studio_place_id
    }))
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub async fn get_studio_asset_snapshots() -> AnyValue {
    let Some(data) = bridge_data() else {
        return AnyValue(json!({
            "anims": { "assets": [], "scanning": false, "complete": false },
            "sounds": { "assets": [], "scanning": false, "complete": false },
            "images": { "assets": [], "scanning": false, "complete": false },
            "meshes": { "assets": [], "scanning": false, "complete": false },
            "scriptRefs": { "assets": [], "scanning": false, "complete": false }
        }));
    };
    let guard = data.read().await;
    AnyValue(json!({
        "anims": guard.last_animations,
        "sounds": guard.last_sounds,
        "images": guard.last_images,
        "meshes": guard.last_meshes,
        "scriptRefs": guard.last_script_refs
    }))
}
