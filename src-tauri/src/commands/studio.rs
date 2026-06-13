use crate::commands::discord::AnyValue;

#[tauri::command]
#[specta::specta]
pub async fn push_to_studio(
    replacements_map: Option<AnyValue>,
    plugin_port: Option<String>,
) -> crate::error::Result<bool> {
    let mappings = replacements_map
        .and_then(|value| value.0.as_object().cloned())
        .map(|replacements| {
            replacements
                .into_iter()
                .map(|(original_id, new_id)| {
                    serde_json::json!({
                        "originalId": original_id,
                        "newId": new_id.as_str().unwrap_or_default(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if mappings.is_empty() {
        return Ok(false);
    }

    if crate::studio_bridge::queue_replace_mappings_internal(mappings.clone()).await {
        return Ok(true);
    }

    let port = plugin_port.and_then(|value| value.parse::<u16>().ok()).unwrap_or(14285);
    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/replace-ids"))
        .header("X-API-Key", crate::studio_bridge::bridge_api_key())
        .json(&serde_json::json!({ "mappings": mappings }))
        .send()
        .await?;
    Ok(response.status().is_success())
}
