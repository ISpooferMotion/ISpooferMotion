#[tauri::command]
#[specta::specta]
pub const fn find_studio_process() -> Option<u32> {
    None
}

#[derive(serde::Serialize, specta::Type)]
pub struct MemoryInjectionResult {
    #[specta(type = u32)]
    pub utf8_replaced: usize,
    #[specta(type = u32)]
    pub utf16_replaced: usize,
    #[specta(type = u32)]
    pub total_replaced: usize,
}

#[tauri::command]
#[specta::specta]
pub async fn scan_and_replace_multiple_strings(
    _app: tauri::AppHandle,
    _pid: u32,
    _replacements: std::collections::HashMap<String, String>,
) -> Result<std::collections::HashMap<String, MemoryInjectionResult>, String> {
    Err("Memory injection is only supported on Windows.".into())
}

#[tauri::command]
#[specta::specta]
pub async fn focus_and_save_studio(_pid: u32) -> Result<(), String> {
    Err("Auto-focus and auto-save are only supported on Windows.".into())
}
