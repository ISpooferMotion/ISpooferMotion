fn main() {
    let b = tauri_specta::Builder::<tauri::Wry>::new();
    let h: fn(tauri::Invoke<tauri::Wry>) -> bool = b.invoke_handler();
}
