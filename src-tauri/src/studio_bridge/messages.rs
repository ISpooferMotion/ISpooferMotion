// This is the big one. Handles parsing asset references out of everything Studio throws at us.
// Warning: Lots of messy regex in here because Roblox strings are chaotic.
#![allow(clippy::unwrap_used)]
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use std::time::Instant;

// Basic container for parsed assets we send back to the UI
#[derive(Clone, Default, Serialize, Debug, specta::Type)]
pub struct AssetStore {
    #[specta(type = Vec<String>)]
    pub assets: Vec<Value>,
    pub scanning: bool,
    pub complete: bool,
    #[serde(skip)]
    pub timestamp: Option<Instant>,
}

impl AssetStore {
    #[must_use]
    pub fn completed() -> Self {
        Self { complete: true, timestamp: Some(Instant::now()), ..Default::default() }
    }
}

// Holds all the active state for the Studio bridge.
// Keeps track of the current scan status and what we've found so far.
#[derive(Default, Debug)]
pub struct AssetServerStateData {
    pub request_sounds: bool,
    pub request_animations: bool,
    pub request_images: bool,
    pub request_meshes: bool,
    pub request_script_refs: bool,
    pub last_sounds: AssetStore,
    pub last_animations: AssetStore,
    pub last_images: AssetStore,
    pub last_meshes: AssetStore,
    pub last_script_refs: AssetStore,
    pub stored_mappings: Vec<Value>,
    pub stored_patches: Vec<Value>,
    pub studio_records: std::sync::Arc<Vec<StudioRecord>>,
    pub pending_studio_records: std::sync::Arc<Vec<StudioRecord>>,
    pub last_plugin_poll_time: Option<Instant>,
    pub skip_owned_check: bool,
    pub scan_status: Option<Value>,
    pub studio_place_id: Option<String>,
    pub keyframe_warning_count: usize,
    pub scan_records_truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StudioRecord {
    pub token: String,
    pub class_name: String,
    pub name: String,
    pub full_name: String,
    pub property: String,
    pub value: String,
}

// Tries to match any valid Roblox asset URL or just a raw ID.
fn asset_id_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"^(?i)(?:(?:https?://(?:www\.)?)?roblox\.com/(?:asset/?\?.*?id=|library/)|create\.roblox\.com/(?:marketplace/)?|rbxassetid://|rbxasset://|rbxthumb://[^/]*/?)?(\d+)$",
        )
        .unwrap_or_else(|e| {
            log::error!("Invalid asset id regex: {}", e);
            Regex::new("^$").unwrap()
        })
    })
}

fn script_ref_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?ix)(?:(?:https?://(?:www\.)?)?roblox\.com/asset/?\?.*?id=|rbxassetid://|rbxthumb://[^/]*/?)?(\d{7,15})",
        )
        .unwrap_or_else(|e| {
            log::error!("Invalid script reference regex: {}", e);
            Regex::new("^$").unwrap()
        })
    })
}

fn script_rewrite_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?ix)((?:(?:https?://(?:www\.)?)?roblox\.com/asset/?\?.*?id=|rbxassetid://|rbxthumb://[^/]*/?)?)(\d{4,15})")
            .unwrap_or_else(|e| {
                log::error!("Invalid script rewrite regex: {}", e);
                Regex::new("^$").unwrap()
            })
    })
}

fn table_block_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?ix)(?:(anim|sound|audio|music|mesh|texture|image|assetid)[a-zA-Z0-9_]*\s*(?:=|:)\s*\{)")
            .unwrap_or_else(|e| {
                log::error!("Invalid table block regex: {}", e);
                Regex::new("^$").unwrap()
            })
    })
}

fn rich_text_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?i)<image\s*=\s*["']?(?:rbxassetid://)?(\d{4,15})["']?\s*/?>"#)
            .unwrap_or_else(|e| {
                log::error!("Invalid rich text regex: {}", e);
                Regex::new("^$").unwrap()
            })
    })
}

// Looks for require() or InsertService calls that pull assets dynamically
fn runtime_load_pattern() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?x)
            (?:
                (?:InsertService|game\.InsertService)\s*:\s*LoadAsset\s*\(\s*(\d{7,15})\s*\)
                |
                \brequire\s*\(\s*(\d{7,15})\s*\)
                |
                :\s*GetAsync\s*\(\s*["']?(\d{7,15})["']?\s*\)
                |
                DataStoreService\s*:\s*GetDataStore\s*\(\s*["'](\d{7,15})["']
            )"#,
        )
        .unwrap_or_else(|e| {
            log::error!("Invalid runtime load regex: {}", e);
            Regex::new("^$").unwrap()
        })
    })
}

fn infer_category_from_property(property: &str) -> Option<&'static str> {
    match property {
        "AnimationId" | "ClimbAnimation" | "FallAnimation" | "IdleAnimation" | "JumpAnimation"
        | "RunAnimation" | "SwimAnimation" | "WalkAnimation" | "MoodAnimation" => Some("animation"),
        "SoundId" | "AudioContent" | "Asset" => Some("sound"),
        "Video" => Some("image"),
        "MeshId" | "MeshContent" | "TextureID" | "ReferenceMeshId" | "CageMeshId" => Some("mesh"),
        "BackAccessory" | "FaceAccessory" | "FrontAccessory" | "HairAccessory" | "HatAccessory"
        | "NeckAccessory" | "ShouldersAccessory" | "WaistAccessory" | "Head" | "LeftArm"
        | "LeftLeg" | "RightArm" | "RightLeg" | "Torso" => Some("mesh"),
        "Texture" | "Image" | "HoverImage" | "PressedImage" | "CursorIcon" | "BaseTextureId"
        | "OverlayTextureId" | "ColorMap" | "MetalnessMap" | "NormalMap" | "RoughnessMap"
        | "ShirtTemplate" | "PantsTemplate" | "Graphic" | "SkyboxBk" | "SkyboxDn" | "SkyboxFt"
        | "SkyboxLf" | "SkyboxRt" | "SkyboxUp" | "SunTextureId" | "MoonTextureId" | "TextureId"
        | "Face" | "GraphicTShirt" | "Pants" | "Shirt" => Some("image"),
        prop if prop.ends_with("Animation") => Some("animation"),
        prop if prop.ends_with("Sound") => Some("sound"),
        prop if prop.ends_with("Accessory") => Some("mesh"),
        prop if prop.ends_with("Map") => Some("image"),
        prop if prop.ends_with("Image") || prop.ends_with("Texture") => Some("image"),
        prop if prop.ends_with("Template") => Some("image"),
        _ => None,
    }
}

fn infer_category_from_attribute_name(property: &str) -> &'static str {
    let lower = property.to_lowercase();
    if lower.contains("anim") {
        "animation"
    } else if lower.contains("sound") || lower.contains("audio") || lower.contains("music") {
        "sound"
    } else if lower.contains("mesh") {
        "mesh"
    } else if lower.contains("image")
        || lower.contains("texture")
        || lower.contains("video")
        || lower.contains("decal")
        || lower.contains("icon")
        || lower.contains("id")
    {
        "image"
    } else {
        "unknown"
    }
}

fn has_explicit_asset_reference(source: &str, asset_id: &str) -> bool {
    source.contains(&format!("rbxassetid://{asset_id}"))
        || source.contains(&format!("rbxasset://{asset_id}"))
        || source.contains(&format!("id={asset_id}"))
        || source.contains(&format!("roblox.com/asset/?id={asset_id}"))
        || source.contains(&format!("roblox.com/library/{asset_id}"))
        || source.contains(&format!("create.roblox.com/marketplace/asset/{asset_id}"))
}

fn extract_rich_text_asset_ids(text: &str) -> Vec<String> {
    let mut ids = Vec::new();
    for cap in rich_text_pattern().captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let id = m.as_str();
            if id != "0" {
                ids.push(id.to_string());
            }
        }
    }
    ids
}

fn walk_json_for_asset_ids(value: &Value, out: &mut Vec<String>, depth: u8) {
    if depth > 8 {
        return;
    }
    match value {
        Value::String(s) => {
            if let Some(id) = normalize_asset_id(s) {
                out.push(id.to_string());
            }

            if s.len() > 50 {
                if let Ok(nested) = serde_json::from_str::<Value>(s) {
                    walk_json_for_asset_ids(&nested, out, depth + 1);
                }
            }
        }
        Value::Number(n) => {
            if let Some(id_num) = n.as_u64() {
                let s = id_num.to_string();
                if s.len() >= 7 && s.len() <= 15 {
                    out.push(s);
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                walk_json_for_asset_ids(item, out, depth + 1);
            }
        }
        Value::Object(map) => {
            for v in map.values() {
                walk_json_for_asset_ids(v, out, depth + 1);
            }
        }
        _ => {}
    }
}

fn deep_scan_string(value: &str) -> Vec<String> {
    if value.len() < 20 {
        return vec![];
    }

    let mut found = Vec::new();

    if let Ok(parsed) = serde_json::from_str::<Value>(value) {
        walk_json_for_asset_ids(&parsed, &mut found, 0);

        if !found.is_empty() {
            return found;
        }
    }

    let trimmed = value.trim();

    let looks_base64 = trimmed.len() >= 8
        && trimmed.chars().all(|c| {
            c.is_alphanumeric() || c == '+' || c == '/' || c == '=' || c == '-' || c == '_'
        });

    if looks_base64 {
        let decoded = B64
            .decode(trimmed)
            .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(trimmed));
        if let Ok(bytes) = decoded {
            if let Ok(text) = std::str::from_utf8(&bytes) {
                if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                    walk_json_for_asset_ids(&parsed, &mut found, 0);
                }
            }
        }
    }

    found
}

const ANIM_KEYWORDS: &[&str] = &[
    "anim", "walk", "run", "idle", "jump", "swim", "climb", "fall", "emote", "dance", "crouch",
    "sprint", "roll", "strafe", "pose", "gesture",
];
const SOUND_KEYWORDS: &[&str] = &["sound", "audio", "music", "sfx", "track", "bgm", "noise"];
const IMAGE_KEYWORDS: &[&str] = &[
    "image",
    "icon",
    "texture",
    "decal",
    "badge",
    "thumbnail",
    "sprite",
    "logo",
    "banner",
    "avatar",
    "portrait",
];
const MESH_KEYWORDS: &[&str] = &["mesh", "hat", "gear", "accessory", "model", "asset", "catalog"];

fn infer_category_from_line(line: &str) -> Option<&'static str> {
    let lower = line.to_lowercase();

    let context: String = Regex::new(r"\d{4,15}").ok()?.replace_all(&lower, "").into_owned();

    if ANIM_KEYWORDS.iter().any(|kw| context.contains(kw)) {
        return Some("animation");
    }
    if SOUND_KEYWORDS.iter().any(|kw| context.contains(kw)) {
        return Some("sound");
    }
    if IMAGE_KEYWORDS.iter().any(|kw| context.contains(kw)) {
        return Some("image");
    }
    if MESH_KEYWORDS.iter().any(|kw| context.contains(kw)) {
        return Some("mesh");
    }
    None
}

fn extract_table_block_ids_with_context(source: &str) -> Vec<(String, Option<&'static str>)> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    for captures in table_block_pattern().captures_iter(source) {
        let Some(match_whole) = captures.get(0) else {
            continue;
        };
        let Some(keyword_match) = captures.get(1) else {
            continue;
        };
        let keyword = keyword_match.as_str().to_lowercase();

        let hint = if keyword.contains("anim") {
            Some("animation")
        } else if keyword.contains("sound")
            || keyword.contains("audio")
            || keyword.contains("music")
        {
            Some("sound")
        } else if keyword.contains("mesh") {
            Some("mesh")
        } else if keyword.contains("texture") || keyword.contains("image") {
            Some("image")
        } else {
            None
        };

        let mut depth = 1;
        let mut block_end = match_whole.end();
        let bytes = source.as_bytes();

        while block_end < bytes.len() && depth > 0 {
            let ch = bytes[block_end];
            if ch == b'{' {
                depth += 1;
            } else if ch == b'}' {
                depth -= 1;
            }
            block_end += 1;
        }

        if depth == 0 {
            let block_text = &source[match_whole.end()..(block_end - 1)];

            for id_cap in script_ref_pattern().captures_iter(block_text) {
                if let Some(asset_id) = id_cap.get(1) {
                    if asset_id.as_str() != "0" && seen.insert(asset_id.as_str().to_string()) {
                        results.push((asset_id.as_str().to_string(), hint));
                    }
                }
            }
        }
    }
    results
}

fn find_line_containing(source: &str, index: usize) -> &str {
    let mut start = index;
    let bytes = source.as_bytes();
    while start > 0 && bytes[start - 1] != b'\n' {
        start -= 1;
    }
    let mut end = index;
    while end < source.len() && bytes[end] != b'\n' && bytes[end] != b'\r' {
        end += 1;
    }
    &source[start..end]
}

fn extract_script_asset_ids_with_context(source: &str) -> Vec<(String, Option<&'static str>)> {
    let pattern = script_ref_pattern();
    let mut seen: HashSet<String> = HashSet::new();
    let mut results = Vec::new();

    for captures in pattern.captures_iter(source) {
        let Some(mat) = captures.get(1) else {
            continue;
        };
        let asset_id = mat.as_str();
        if asset_id == "0" {
            continue;
        }

        let start = mat.start();
        let line = find_line_containing(source, start);
        let mut hint = infer_category_from_line(line);

        if hint.is_none() {
            let mut context_start = start.saturating_sub(160);
            while context_start > 0 && !source.is_char_boundary(context_start) {
                context_start -= 1;
            }
            let mut context_end = (start + 160).min(source.len());
            while context_end < source.len() && !source.is_char_boundary(context_end) {
                context_end += 1;
            }
            let context = &source[context_start..context_end];
            hint = infer_category_from_line(context);
        }

        if seen.insert(asset_id.to_string()) {
            results.push((asset_id.to_string(), hint));
        }
    }

    results
}

#[derive(Debug)]
struct RuntimeLoadRef {
    asset_id: String,
    call_type: &'static str,
}

fn extract_runtime_load_ids(source: &str) -> Vec<RuntimeLoadRef> {
    let pattern = runtime_load_pattern();
    let mut seen: HashSet<String> = HashSet::new();
    let mut results = Vec::new();

    for cap in pattern.captures_iter(source) {
        let (id, call_type) = if let Some(m) = cap.get(1) {
            (m.as_str(), "LoadAsset")
        } else if let Some(m) = cap.get(2) {
            (m.as_str(), "Require")
        } else if let Some(m) = cap.get(3) {
            (m.as_str(), "GetAsync")
        } else if let Some(m) = cap.get(4) {
            (m.as_str(), "DataStore")
        } else {
            continue;
        };

        if id != "0" && seen.insert(id.to_string()) {
            results.push(RuntimeLoadRef { asset_id: id.to_string(), call_type });
        }
    }

    results
}

#[must_use]
pub fn analyze_records(
    records: &[StudioRecord],
) -> (AssetStore, AssetStore, AssetStore, AssetStore, AssetStore) {
    let mut animations = AssetStore::completed();
    let mut sounds = AssetStore::completed();
    let mut images = AssetStore::completed();
    let mut meshes = AssetStore::completed();
    let mut script_refs = AssetStore::completed();
    let mut seen: HashSet<(String, String, String)> = HashSet::new();

    let mut category_id_indices: HashMap<(&'static str, String), usize> = HashMap::new();

    for record in records {
        if record.property == "KeyframeSequence" {
            if seen.insert(("kf".into(), record.token.clone(), record.full_name.clone())) {
                script_refs.assets.push(json!({
                    "kind": "UnuploadedAnimation",
                    "script": record.full_name,
                    "scriptType": record.class_name,
                    "assetId": null,
                    "rawUrl": null,
                    "resolvedType": "unuploaded",
                    "warning": "This animation has not been uploaded to Roblox yet and cannot be spoofed."
                }));
            }
            continue;
        }

        let is_script =
            matches!(record.class_name.as_str(), "Script" | "LocalScript" | "ModuleScript")
                && record.property == "Source";

        if is_script
            || matches!(record.property.as_str(), "__Tags__" | "__Emotes__" | "__Accessories__")
        {
            if is_script {
                for rt in extract_runtime_load_ids(&record.value) {
                    let key = ("runtime".to_string(), record.token.clone(), rt.asset_id.clone());
                    if seen.insert(key) {
                        script_refs.assets.push(json!({
                            "kind": "RuntimeLoad",
                            "script": record.full_name,
                            "scriptType": record.class_name,
                            "assetId": rt.asset_id,
                            "rawUrl": format!("rbxassetid://{}", rt.asset_id),
                            "resolvedType": "unknown",
                            "callType": rt.call_type
                        }));
                    }
                }
            }

            let all_extracted = if is_script {
                let mut table_extracted = extract_table_block_ids_with_context(&record.value);
                let line_extracted = extract_script_asset_ids_with_context(&record.value);
                let mut block_seen: HashSet<String> =
                    table_extracted.iter().map(|(id, _)| id.clone()).collect();
                for (id, hint) in line_extracted {
                    if block_seen.insert(id.clone()) {
                        table_extracted.push((id, hint));
                    }
                }
                table_extracted
            } else if record.property == "__Emotes__" {
                extract_script_asset_ids(&record.value)
                    .into_iter()
                    .map(|id| (id.clone(), Some("animation")))
                    .collect()
            } else if record.property == "__Accessories__" {
                extract_script_asset_ids(&record.value)
                    .into_iter()
                    .map(|id| (id.clone(), Some("mesh")))
                    .collect()
            } else {
                extract_script_asset_ids(&record.value)
                    .into_iter()
                    .map(|id| (id.clone(), None))
                    .collect()
            };

            for (asset_id, hint) in all_extracted {
                match hint {
                    Some("animation") => {
                        use std::collections::hash_map::Entry;
                        match category_id_indices.entry(("animation", asset_id.clone())) {
                            Entry::Vacant(e) => {
                                e.insert(animations.assets.len());
                                animations.assets.push(json!({
                                    "kind": record.class_name,
                                    "name": record.name,
                                    "fullName": record.full_name,
                                    "property": record.property,
                                    "assetId": asset_id,
                                    "instanceCount": 1,
                                    "sourceHint": "animation"
                                }));
                            }
                            Entry::Occupied(e) => {
                                if let Some(existing) = animations.assets.get_mut(*e.get()) {
                                    existing["instanceCount"] =
                                        json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                                }
                            }
                        }
                        continue;
                    }
                    Some("sound") => {
                        use std::collections::hash_map::Entry;
                        match category_id_indices.entry(("sound", asset_id.clone())) {
                            Entry::Vacant(e) => {
                                e.insert(sounds.assets.len());
                                sounds.assets.push(json!({
                                    "kind": record.class_name,
                                    "name": record.name,
                                    "fullName": record.full_name,
                                    "property": record.property,
                                    "assetId": asset_id,
                                    "instanceCount": 1,
                                    "sourceHint": "sound"
                                }));
                            }
                            Entry::Occupied(e) => {
                                if let Some(existing) = sounds.assets.get_mut(*e.get()) {
                                    existing["instanceCount"] =
                                        json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                                }
                            }
                        }
                        continue;
                    }
                    Some("image") => {
                        use std::collections::hash_map::Entry;
                        match category_id_indices.entry(("image", asset_id.clone())) {
                            Entry::Vacant(e) => {
                                e.insert(images.assets.len());
                                images.assets.push(json!({
                                    "kind": record.class_name,
                                    "name": record.name,
                                    "fullName": record.full_name,
                                    "property": record.property,
                                    "assetId": asset_id,
                                    "instanceCount": 1,
                                    "sourceHint": "image"
                                }));
                            }
                            Entry::Occupied(e) => {
                                if let Some(existing) = images.assets.get_mut(*e.get()) {
                                    existing["instanceCount"] =
                                        json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                                }
                            }
                        }
                        continue;
                    }
                    Some("mesh") => {
                        use std::collections::hash_map::Entry;
                        match category_id_indices.entry(("mesh", asset_id.clone())) {
                            Entry::Vacant(e) => {
                                e.insert(meshes.assets.len());
                                meshes.assets.push(json!({
                                    "kind": record.class_name,
                                    "name": record.name,
                                    "fullName": record.full_name,
                                    "property": record.property,
                                    "assetId": asset_id,
                                    "instanceCount": 1,
                                    "sourceHint": "mesh"
                                }));
                            }
                            Entry::Occupied(e) => {
                                if let Some(existing) = meshes.assets.get_mut(*e.get()) {
                                    existing["instanceCount"] =
                                        json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                                }
                            }
                        }
                        continue;
                    }
                    _ => {}
                }

                if has_explicit_asset_reference(&record.value, &asset_id)
                    && seen.insert(("script".to_string(), record.token.clone(), asset_id.clone()))
                {
                    script_refs.assets.push(json!({
                        "kind": "ScriptReference",
                        "script": record.full_name,
                        "scriptType": record.class_name,
                        "assetId": asset_id,
                        "rawUrl": format!("rbxassetid://{asset_id}"),
                        "resolvedType": "unknown"
                    }));
                }
            }
            continue;
        }

        if !record.value.is_empty()
            && record.property != "Source"
            && !matches!(record.property.as_str(), "__Tags__" | "__Emotes__" | "__Accessories__")
        {
            for asset_id in extract_rich_text_asset_ids(&record.value) {
                if seen.insert(("richtext".to_string(), record.token.clone(), asset_id.clone())) {
                    images.assets.push(json!({
                        "kind": record.class_name,
                        "name": record.name,
                        "fullName": record.full_name,
                        "property": record.property,
                        "assetId": asset_id,
                        "instanceCount": 1,
                        "sourceHint": "richtext"
                    }));
                }
            }

            for asset_id in extract_script_asset_ids(&record.value) {
                if let Some(category) = infer_category_from_property(&record.property) {
                    use std::collections::hash_map::Entry;
                    match category_id_indices.entry((category, asset_id.clone())) {
                        Entry::Vacant(e) => {
                            let store = match category {
                                "animation" => &mut animations,
                                "sound" => &mut sounds,
                                "image" => &mut images,
                                "mesh" => &mut meshes,
                                _ => continue,
                            };
                            e.insert(store.assets.len());
                            store.assets.push(json!({
                                "kind": record.class_name,
                                "name": record.name,
                                "fullName": record.full_name,
                                "property": record.property,
                                "assetId": asset_id,
                                "instanceCount": 1,
                                "sourceHint": "embedded"
                            }));
                        }
                        Entry::Occupied(e) => {
                            let store = match category {
                                "animation" => &mut animations,
                                "sound" => &mut sounds,
                                "image" => &mut images,
                                "mesh" => &mut meshes,
                                _ => continue,
                            };
                            if let Some(existing) = store.assets.get_mut(*e.get()) {
                                existing["instanceCount"] =
                                    json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                            }
                        }
                    }
                }
            }
        }

        if record.value.len() >= 20
            && record.property != "Source"
            && !matches!(record.property.as_str(), "__Tags__" | "__Emotes__" | "__Accessories__")
        {
            for asset_id in deep_scan_string(&record.value) {
                let category = infer_category_from_property(&record.property)
                    .or_else(|| {
                        if record.property.starts_with("__Attribute__:") {
                            Some(infer_category_from_attribute_name(
                                &record.property["__Attribute__:".len()..],
                            ))
                        } else {
                            None
                        }
                    })
                    .filter(|cat| *cat != "unknown");

                if let Some(category) = category {
                    use std::collections::hash_map::Entry;
                    match category_id_indices.entry((category, asset_id.clone())) {
                        Entry::Vacant(e) => {
                            let store = match category {
                                "animation" => &mut animations,
                                "sound" => &mut sounds,
                                "image" => &mut images,
                                "mesh" => &mut meshes,
                                _ => continue,
                            };
                            e.insert(store.assets.len());
                            store.assets.push(json!({
                                "kind": record.class_name,
                                "name": record.name,
                                "fullName": record.full_name,
                                "property": record.property,
                                "assetId": asset_id,
                                "instanceCount": 1,
                                "sourceHint": "deepscan"
                            }));
                        }
                        Entry::Occupied(e) => {
                            let store = match category {
                                "animation" => &mut animations,
                                "sound" => &mut sounds,
                                "image" => &mut images,
                                "mesh" => &mut meshes,
                                _ => continue,
                            };
                            if let Some(existing) = store.assets.get_mut(*e.get()) {
                                existing["instanceCount"] =
                                    json!(existing["instanceCount"].as_u64().unwrap_or(1) + 1);
                            }
                        }
                    }
                    continue;
                }

                if seen.insert(("deepscan".to_string(), record.token.clone(), asset_id.clone())) {
                    script_refs.assets.push(json!({
                        "kind": "DeepScan",
                        "script": record.full_name,
                        "scriptType": record.class_name,
                        "assetId": asset_id,
                        "rawUrl": format!("rbxassetid://{asset_id}"),
                        "resolvedType": "unknown"
                    }));
                }
            }
        }

        let Some(asset_id) = normalize_asset_id(&record.value) else {
            continue;
        };
        let category = if record.property.starts_with("__Attribute__:") {
            infer_category_from_attribute_name(&record.property["__Attribute__:".len()..])
        } else if record.property == "Value" {
            let lower = record.name.to_lowercase();
            if lower.contains("anim") {
                "animation"
            } else if lower.contains("sound") || lower.contains("audio") || lower.contains("music")
            {
                "sound"
            } else if lower.contains("mesh") {
                "mesh"
            } else if lower.contains("image")
                || lower.contains("texture")
                || lower.contains("video")
                || lower.contains("id")
            {
                "image"
            } else {
                "unknown"
            }
        } else {
            infer_category_from_property(&record.property).unwrap_or("unknown")
        };
        if category.is_empty() {
            continue;
        }

        if category == "unknown" {
            if has_explicit_asset_reference(&record.value, asset_id)
                && seen.insert(("script".to_string(), record.token.clone(), asset_id.to_string()))
            {
                script_refs.assets.push(json!({
                    "kind": "ScriptReference",
                    "script": record.full_name,
                    "scriptType": record.class_name,
                    "assetId": asset_id,
                    "rawUrl": format!("rbxassetid://{asset_id}"),
                    "resolvedType": "unknown"
                }));
            }
            continue;
        }

        if !seen.insert((category.to_string(), String::new(), asset_id.to_string())) {
            let store = match category {
                "animation" => &mut animations,
                "sound" => &mut sounds,
                "image" => &mut images,
                "mesh" => &mut meshes,
                _ => continue,
            };
            if let Some(last) = store.assets.iter_mut().find(|a| a["assetId"] == asset_id) {
                last["instanceCount"] = json!(last["instanceCount"].as_u64().unwrap_or(1) + 1);
            }
            continue;
        }
        let asset = json!({
            "kind": record.class_name,
            "name": record.name,
            "fullName": record.full_name,
            "property": record.property,
            "assetId": asset_id,
            "instanceCount": 1
        });
        match category {
            "animation" => animations.assets.push(asset),
            "sound" => sounds.assets.push(asset),
            "image" => images.assets.push(asset),
            "mesh" => meshes.assets.push(asset),
            _ => {}
        }
    }

    (animations, sounds, images, meshes, script_refs)
}

#[must_use]
pub fn plan_patches(records: &[StudioRecord], mappings: &[Value]) -> Vec<Value> {
    let mapping_map: HashMap<&str, &str> = mappings
        .iter()
        .filter_map(|mapping| {
            Some((mapping.get("originalId")?.as_str()?, mapping.get("newId")?.as_str()?))
        })
        .collect();
    let mut patches = Vec::new();
    let mut mesh_patches: HashMap<String, Value> = HashMap::new();

    for record in records {
        if matches!(
            record.property.as_str(),
            "Source" | "__Tags__" | "__Emotes__" | "__Accessories__"
        ) {
            let rewritten = replace_script_asset_ids(&record.value, &mapping_map);
            if let std::borrow::Cow::Owned(rewritten) = rewritten {
                let action = match record.property.as_str() {
                    "Source" => "replaceScriptSource",
                    "__Tags__" => "replaceTags",
                    "__Emotes__" => "replaceEmotes",
                    "__Accessories__" => "replaceAccessories",
                    _ => unreachable!(),
                };
                patches.push(json!({
                    "action": action,
                    "token": record.token,
                    "fullName": record.full_name,
                    "value": rewritten
                }));
            }
            continue;
        }

        let Some(asset_id) = normalize_asset_id(&record.value) else {
            continue;
        };
        let Some(new_id) = mapping_map.get(&asset_id) else {
            continue;
        };

        if record.class_name == "MeshPart"
            && matches!(record.property.as_str(), "MeshId" | "MeshContent" | "TextureID")
        {
            let patch = mesh_patches.entry(record.token.clone()).or_insert_with(|| {
                json!({
                    "action": "replaceMeshPart",
                    "token": record.token,
                    "fullName": record.full_name
                })
            });
            patch[if record.property == "TextureID" { "textureId" } else { "meshId" }] =
                Value::String((*new_id).to_string());
            continue;
        }

        if record.property.starts_with("__Attribute__:") {
            let attr_name = &record.property["__Attribute__:".len()..];
            let replaced_str = record.value.replace(asset_id, new_id);
            let replaced_val = if replaced_str.chars().all(|c| c.is_ascii_digit()) {
                Value::Number(replaced_str.parse::<u64>().unwrap_or(0).into())
            } else {
                Value::String(replaced_str)
            };
            patches.push(json!({
                "action": "replaceAttribute",
                "token": record.token,
                "fullName": record.full_name,
                "property": attr_name,
                "value": replaced_val
            }));
            continue;
        }

        patches.push(json!({
            "action": "setProperty",
            "token": record.token,
            "fullName": record.full_name,
            "property": record.property,
            "value": record.value.replace(asset_id, new_id)
        }));
    }

    patches.extend(mesh_patches.into_values());
    patches.truncate(100_000);
    patches
}

fn normalize_asset_id(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "0" {
        return None;
    }

    if let Some(captures) = asset_id_pattern().captures(trimmed) {
        if let Some(asset_id) = captures.get(1) {
            let id = asset_id.as_str();
            if id != "0" && !id.is_empty() {
                return Some(id);
            }
        }
    }

    let captures = script_ref_pattern().captures(trimmed)?;
    let asset_id = captures.get(1)?.as_str();
    (asset_id != "0").then_some(asset_id)
}

fn extract_script_asset_ids(source: &str) -> Vec<String> {
    struct AstExtractor {
        ids: HashSet<String>,
    }

    impl full_moon::visitors::Visitor for AstExtractor {
        fn visit_string_literal(&mut self, token: &full_moon::tokenizer::Token) {
            let text = token.to_string();
            let pattern = script_ref_pattern();
            for captures in pattern.captures_iter(&text) {
                if let Some(asset_id) = captures.get(1) {
                    if asset_id.as_str() != "0" {
                        self.ids.insert(asset_id.as_str().to_string());
                    }
                }
            }
        }

        fn visit_number(&mut self, token: &full_moon::tokenizer::Token) {
            let text = token.to_string();
            if text.len() >= 4 && text.chars().all(|c| c.is_ascii_digit()) && text != "0" {
                self.ids.insert(text);
            }
        }
    }

    if let Ok(ast) = full_moon::parse(source) {
        let mut extractor = AstExtractor { ids: HashSet::new() };
        full_moon::visitors::Visitor::visit_ast(&mut extractor, &ast);
        return extractor.ids.into_iter().collect();
    }

    // Fallback to regex if parsing fails
    let pattern = script_ref_pattern();
    let mut ids = HashSet::new();
    for captures in pattern.captures_iter(source) {
        if let Some(asset_id) = captures.get(1) {
            if asset_id.as_str() != "0" {
                ids.insert(asset_id.as_str().to_string());
            }
        }
    }
    ids.into_iter().collect()
}

fn replace_script_asset_ids<'a>(
    source: &'a str,
    mappings: &HashMap<&str, &str>,
) -> std::borrow::Cow<'a, str> {
    struct AstReplacer<'m> {
        mappings: &'m HashMap<&'m str, &'m str>,
    }

    impl<'m> full_moon::visitors::VisitorMut for AstReplacer<'m> {
        fn visit_string_literal(
            &mut self,
            token: full_moon::tokenizer::Token,
        ) -> full_moon::tokenizer::Token {
            let mut text = token.to_string();
            let mut changed = false;
            for (old, new) in self.mappings {
                if text.contains(old) {
                    text = text.replace(old, new);
                    changed = true;
                }
            }
            if changed {
                return full_moon::tokenizer::Token::new(
                    full_moon::tokenizer::TokenType::StringLiteral {
                        literal: text
                            .trim_matches(|c| c == '\'' || c == '"' || c == '[' || c == ']')
                            .into(),
                        multi_line_depth: match token.token_type() {
                            full_moon::tokenizer::TokenType::StringLiteral {
                                multi_line_depth,
                                ..
                            } => *multi_line_depth,
                            _ => 0,
                        },
                        quote_type: match token.token_type() {
                            full_moon::tokenizer::TokenType::StringLiteral {
                                quote_type, ..
                            } => *quote_type,
                            _ => full_moon::tokenizer::StringLiteralQuoteType::Double,
                        },
                    },
                );
            }
            token
        }

        fn visit_number(
            &mut self,
            token: full_moon::tokenizer::Token,
        ) -> full_moon::tokenizer::Token {
            let text = token.to_string();
            let mut replaced = text.clone();
            for (old, new) in self.mappings {
                if replaced == *old {
                    replaced = (*new).to_string();
                }
            }
            if replaced != text {
                return full_moon::tokenizer::Token::new(full_moon::tokenizer::TokenType::Number {
                    text: replaced.into(),
                });
            }
            token
        }
    }

    if let Ok(ast) = full_moon::parse(source) {
        let mut replacer = AstReplacer { mappings };
        let new_ast = full_moon::visitors::VisitorMut::visit_ast(&mut replacer, ast);
        let new_source = new_ast.to_string();
        if new_source != source {
            return std::borrow::Cow::Owned(new_source);
        }
        return std::borrow::Cow::Borrowed(source);
    }

    // Fallback to regex if parsing fails
    script_rewrite_pattern().replace_all(source, |captures: &Captures<'_>| {
        let prefix = captures.get(1).map_or("", |item| item.as_str());
        let asset_id = captures.get(2).map_or("", |item| item.as_str());
        mappings
            .get(asset_id)
            .map_or_else(|| captures[0].to_string(), |new_id| format!("{prefix}{new_id}"))
    })
}

#[must_use]
pub fn count_keyframe_warnings(script_refs: &AssetStore) -> usize {
    script_refs.assets.iter().filter(|a| a["kind"] == "UnuploadedAnimation").count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(property: &str, value: &str) -> StudioRecord {
        StudioRecord {
            token: "1".into(),
            class_name: "Animation".into(),
            name: "Example".into(),
            full_name: "Workspace.Example".into(),
            property: property.into(),
            value: value.into(),
        }
    }

    #[test]
    fn extracts_supported_content_ids() {
        assert_eq!(normalize_asset_id("rbxassetid://12345"), Some("12345"));
        assert_eq!(normalize_asset_id("0"), None);
    }

    #[test]
    fn extracts_all_long_numbers_as_script_ids() {
        let mut ids = extract_script_asset_ids("local count = 12345678\nlocal soundId = 87654321");
        ids.sort();
        assert_eq!(ids, vec!["12345678".to_string(), "87654321".to_string()]);
    }

    #[test]
    fn ignores_unhinted_script_numbers() {
        let records = vec![StudioRecord {
            token: "6".into(),
            class_name: "Script".into(),
            name: "Script".into(),
            full_name: "Workspace.Script".into(),
            property: "Source".into(),
            value: "local score = 12345678\nlocal cooldown = 87654321".into(),
        }];
        let (animations, sounds, images, meshes, script_refs) = analyze_records(&records);
        assert!(animations.assets.is_empty());
        assert!(sounds.assets.is_empty());
        assert!(images.assets.is_empty());
        assert!(meshes.assets.is_empty());
        assert!(script_refs.assets.is_empty());
    }

    #[test]
    fn ignores_unhinted_non_asset_strings() {
        let records = vec![StudioRecord {
            token: "7".into(),
            class_name: "StringValue".into(),
            name: "BuildNumber".into(),
            full_name: "ReplicatedStorage.BuildNumber".into(),
            property: "Value".into(),
            value: "build 12345678 generated at 87654321".into(),
        }];
        let (animations, sounds, images, meshes, script_refs) = analyze_records(&records);
        assert!(animations.assets.is_empty());
        assert!(sounds.assets.is_empty());
        assert!(images.assets.is_empty());
        assert!(meshes.assets.is_empty());
        assert!(script_refs.assets.is_empty());
    }

    #[test]
    fn rewrites_all_script_references() {
        let mappings = HashMap::from([("87654321", "99999999"), ("12345678", "11111111")]);
        let rewritten =
            replace_script_asset_ids("local count = 12345678\nlocal soundId = 87654321", &mappings);
        assert_eq!(rewritten.into_owned(), "local count = 11111111\nlocal soundId = 99999999");
    }

    #[test]
    fn categorizes_records_and_builds_targeted_patches() {
        let mut records = vec![record("AnimationId", "rbxassetid://123")];
        records.push(StudioRecord {
            token: "2".into(),
            class_name: "Script".into(),
            name: "Script".into(),
            full_name: "Workspace.Script".into(),
            property: "Source".into(),
            value: "local animationId = 12345678".into(),
        });
        let (animations, _, _, _, script_refs) = analyze_records(&records);
        assert_eq!(animations.assets.len(), 2);

        assert_eq!(script_refs.assets.len(), 0);
        let patches = plan_patches(
            &records,
            &[
                json!({"originalId": "123", "newId": "456"}),
                json!({"originalId": "12345678", "newId": "87654321"}),
            ],
        );
        assert_eq!(patches.len(), 2);
    }

    #[test]
    fn categorizes_attribute_records() {
        let records = vec![StudioRecord {
            token: "3".into(),
            class_name: "Part".into(),
            name: "Example".into(),
            full_name: "Workspace.Example".into(),
            property: "__Attribute__:RunAnimationId".into(),
            value: "rbxassetid://12345678".into(),
        }];
        let (animations, _, _, _, script_refs) = analyze_records(&records);
        assert_eq!(animations.assets.len(), 1);
        assert_eq!(script_refs.assets.len(), 0);
    }

    #[test]
    fn rich_text_extracts_image_ids() {
        let ids = extract_rich_text_asset_ids(
            r#"Hello <image="rbxassetid://12345678"></image> and <image="rbxassetid://87654321"></image>"#,
        );
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"12345678".to_string()));
        assert!(ids.contains(&"87654321".to_string()));
    }

    #[test]
    fn deep_scan_extracts_ids_from_json() {
        let json_blob = r#"{"animations":{"run":12345678,"idle":87654321, "padding": "this is some padding to make the string longer than 50 chars"}}"#;
        let ids = deep_scan_string(json_blob);
        assert!(ids.contains(&"12345678".to_string()));
        assert!(ids.contains(&"87654321".to_string()));
    }

    #[test]
    fn ast_hints_animation_from_variable_name() {
        let results = extract_script_asset_ids_with_context("local RunAnimation = 12345678");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1, Some("animation"));
    }

    #[test]
    fn ast_hints_sound_from_variable_name() {
        let results = extract_script_asset_ids_with_context("local backgroundMusic = 12345678");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1, Some("sound"));
    }

    #[test]
    fn ast_hints_from_multi_line_table() {
        let source = r#"
        local PlayerAnimations = {
            Idle = 12345678,
            Run = 87654321,
            -- Even nested tables work
            Actions = {
                Jump = 99999999
            }
        }
        "#;
        let results = extract_table_block_ids_with_context(source);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].1, Some("animation"));
        assert_eq!(results[1].1, Some("animation"));
        assert_eq!(results[2].1, Some("animation"));
        assert!(results.iter().any(|(id, _)| id == "12345678"));
        assert!(results.iter().any(|(id, _)| id == "87654321"));
        assert!(results.iter().any(|(id, _)| id == "99999999"));
    }

    #[test]
    fn runtime_load_detects_loadasset() {
        let refs = extract_runtime_load_ids(
            "local obj = InsertService:LoadAsset(12345678)\nrequire(87654321)",
        );
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].call_type, "LoadAsset");
        assert_eq!(refs[1].call_type, "Require");
    }

    #[test]
    fn keyframe_sequence_warning_detected() {
        let records = vec![StudioRecord {
            token: "5".into(),
            class_name: "KeyframeSequence".into(),
            name: "Run".into(),
            full_name: "Workspace.Character.Animate.run.RunAnim".into(),
            property: "KeyframeSequence".into(),
            value: "Workspace.Character.Animate.run.RunAnim".into(),
        }];
        let (_, _, _, _, script_refs) = analyze_records(&records);
        assert_eq!(count_keyframe_warnings(&script_refs), 1);
        assert_eq!(script_refs.assets[0]["kind"], "UnuploadedAnimation");
    }
}
