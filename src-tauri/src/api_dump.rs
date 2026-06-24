// This file is responsible for fetching and parsing the Roblox API dump.
// We mainly use this to figure out which properties are actually assets or strings we need to scan.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::RwLock;

// Pulling straight from MaximumADHD's tracker, bless that repo.
const API_DUMP_URL: &str =
    "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json";

#[derive(Serialize, Deserialize, Debug, Clone)]
#[allow(non_snake_case)]
pub struct MemberType {
    pub Name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[allow(non_snake_case)]
pub struct Member {
    pub Name: String,
    pub MemberType: String,
    pub ValueType: Option<MemberType>,
    pub Tags: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[allow(non_snake_case)]
pub struct Class {
    pub Name: String,
    pub Superclass: String,
    pub Members: Option<Vec<Member>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[allow(non_snake_case)]
pub struct ApiDump {
    pub Classes: Vec<Class>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApiDumpProperties {
    pub asset_properties: HashMap<String, Vec<String>>,
    pub string_scan_properties: HashMap<String, Vec<String>>,
}

// Filters out read-only properties since we obviously can't spoof what we can't write to.
fn is_writable(member: &Member) -> bool {
    if let Some(tags) = &member.Tags {
        for tag in tags {
            if tag == "Hidden" || tag == "ReadOnly" || tag == "NotScriptable" {
                return false;
            }
        }
    }
    true
}

// Gross heuristic but it works. We check property names to see if they sound like they hold an asset.
// Kept all lowercase to make the string matching easier.
fn is_asset_like_property_name(name: &str) -> bool {
    let lower_name = name.to_lowercase();
    lower_name.ends_with("id")
        || lower_name.ends_with("url")
        || lower_name.ends_with("asset")
        || lower_name.ends_with("content")
        || lower_name.ends_with("path")
        || lower_name.ends_with("link")
        || lower_name.ends_with("ref")
        || lower_name.contains("assetid")
        || lower_name.contains("animationid")
        || lower_name.contains("soundid")
        || lower_name.contains("meshid")
        || lower_name.contains("textureid")
        || lower_name.contains("imageid")
        || lower_name.contains("animation")
        || lower_name.contains("sound")
        || lower_name.contains("audio")
        || lower_name.contains("music")
        || lower_name.contains("mesh")
        || lower_name.contains("texture")
        || lower_name.contains("image")
        || lower_name.contains("video")
        || lower_name.contains("decal")
        || lower_name.contains("icon")
        || lower_name.contains("thumbnail")
        || lower_name.contains("skybox")
        || lower_name.contains("accessory")
}

// HumanoidDescription is a bit of a special snowflake, handle it specifically here.
fn is_humanoid_description_asset(class_name: &str, name: &str, val_type: &str) -> bool {
    if class_name != "HumanoidDescription" {
        return false;
    }
    // These body parts / clothing items are stored as raw int64 asset IDs
    if val_type == "int64"
        && (name.contains("Animation")
            || name == "Face"
            || name == "Head"
            || name == "LeftArm"
            || name == "LeftLeg"
            || name == "RightArm"
            || name == "RightLeg"
            || name == "Torso"
            || name == "GraphicTShirt"
            || name == "Pants"
            || name == "Shirt")
    {
        return true;
    }
    // And accessories are just string arrays of IDs separated by commas, or arrays/ints
    (val_type == "string" || val_type == "int64" || val_type.contains("Array"))
        && name.contains("Accessory")
}

fn is_asset_property(class_name: &str, member: &Member) -> bool {
    let val_type = member.ValueType.as_ref().map(|v| v.Name.as_str()).unwrap_or("");
    let name = &member.Name;

    let mut is_asset = val_type == "Content" || val_type == "ContentId";

    if !is_asset
        && (val_type == "string" || val_type == "int64")
        && is_asset_like_property_name(name)
    {
        is_asset = true;
    }

    if !is_asset && is_humanoid_description_asset(class_name, name, val_type) {
        is_asset = true;
    }

    is_asset
}

fn is_string_scan_property(member: &Member) -> bool {
    let val_type = member.ValueType.as_ref().map(|v| v.Name.as_str()).unwrap_or("");
    val_type == "string" || val_type == "Content" || val_type == "ContentId"
}

fn build_class_hierarchy<F>(classes: &[Class], pick_property: F) -> HashMap<String, Vec<String>>
where
    F: FnMut(&str, &Member) -> bool + Copy,
{
    let class_map: HashMap<String, &Class> = classes.iter().map(|c| (c.Name.clone(), c)).collect();
    let mut resolved_properties: HashMap<String, HashSet<String>> = HashMap::new();

    fn get_properties(
        class_name: &str,
        class_map: &HashMap<String, &Class>,
        resolved_properties: &mut HashMap<String, HashSet<String>>,
        mut pick_property: impl FnMut(&str, &Member) -> bool + Copy,
    ) -> HashSet<String> {
        if let Some(props) = resolved_properties.get(class_name) {
            return props.clone();
        }

        let mut props = HashSet::new();
        let Some(cls) = class_map.get(class_name) else {
            resolved_properties.insert(class_name.to_string(), props.clone());
            return props;
        };

        // if the class inherits from something, grab those properties too
        if cls.Superclass != "<<<ROOT>>>" && !cls.Superclass.is_empty() {
            let super_props =
                get_properties(&cls.Superclass, class_map, resolved_properties, pick_property);
            for p in super_props {
                props.insert(p);
            }
        }

        if let Some(members) = &cls.Members {
            for member in members {
                if member.MemberType == "Property"
                    && is_writable(member)
                    && pick_property(class_name, member)
                {
                    props.insert(member.Name.clone());
                }
            }
        }

        resolved_properties.insert(class_name.to_string(), props.clone());
        props
    }

    let mut final_map = HashMap::new();
    for cls in classes {
        let props = get_properties(&cls.Name, &class_map, &mut resolved_properties, pick_property);
        if !props.is_empty() {
            let mut sorted_props: Vec<String> = props.into_iter().collect();
            sorted_props.sort();
            final_map.insert(cls.Name.clone(), sorted_props);
        }
    }

    final_map
}

static CACHED_DUMP: tokio::sync::OnceCell<Arc<RwLock<Option<ApiDumpProperties>>>> =
    tokio::sync::OnceCell::const_new();

async fn get_cached_dump_cell() -> &'static Arc<RwLock<Option<ApiDumpProperties>>> {
    CACHED_DUMP.get_or_init(|| async { Arc::new(RwLock::new(None)) }).await
}

pub async fn get_api_dump_properties() -> ApiDumpProperties {
    let cell = get_cached_dump_cell().await;

    // Acquire a write lock immediately to prevent cache stampede.
    // If multiple threads hit this simultaneously, only one will perform the fetch.
    let mut guard = cell.write().await;
    if let Some(cached) = &*guard {
        return cached.clone();
    }

    let mut properties = ApiDumpProperties::default();
    let cache_file = std::env::temp_dir().join("ispoofer_api_dump_v2.json");

    // we cache the dump to a temp file for 24 hours so we aren't spamming the api dump url
    let mut should_fetch = true;
    if let Ok(metadata) = tokio::fs::metadata(&cache_file).await {
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = SystemTime::now().duration_since(modified) {
                if duration.as_secs() < 24 * 60 * 60 {
                    should_fetch = false;
                }
            }
        }
    }

    let mut parsed_dump: Option<ApiDump> = None;

    if !should_fetch {
        if let Ok(content) = tokio::fs::read_to_string(&cache_file).await {
            if let Ok(dump) = serde_json::from_str::<ApiDump>(&content) {
                parsed_dump = Some(dump);
            } else {
                should_fetch = true;
            }
        } else {
            should_fetch = true;
        }
    }

    if should_fetch {
        let client = crate::utils::get_http_client();
        if let Ok(res) = client
            .get(API_DUMP_URL)
            .header(reqwest::header::USER_AGENT, "ISpooferMotion-V2")
            .send()
            .await
        {
            if let Ok(text) = res.text().await {
                if let Ok(dump) = serde_json::from_str::<ApiDump>(&text) {
                    if let Some(parent) = cache_file.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    let _ = tokio::fs::write(&cache_file, &text).await;
                    parsed_dump = Some(dump);
                }
            }
        }
    }

    if parsed_dump.is_none() {
        let fallback_text = include_str!("api_dump_fallback.json");
        if let Ok(dump) = serde_json::from_str::<ApiDump>(fallback_text) {
            parsed_dump = Some(dump);
        }
    }

    if let Some(dump) = parsed_dump {
        properties.asset_properties = build_class_hierarchy(&dump.Classes, |class_name, member| {
            is_asset_property(class_name, member)
        });
        properties.string_scan_properties =
            build_class_hierarchy(&dump.Classes, |_, m| is_string_scan_property(m));
    }

    *guard = Some(properties.clone());

    properties
}
