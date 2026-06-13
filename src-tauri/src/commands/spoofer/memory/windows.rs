use aho_corasick::AhoCorasick;
use rayon::prelude::{IntoParallelRefIterator, ParallelIterator};
use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::size_of;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use sysinfo::System;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
use windows_sys::Win32::System::Diagnostics::Debug::{ReadProcessMemory, WriteProcessMemory};
use windows_sys::Win32::System::Memory::{
    VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, MEM_PRIVATE, PAGE_EXECUTE_READWRITE,
    PAGE_READWRITE,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION,
    PROCESS_VM_READ, PROCESS_VM_WRITE,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, SetForegroundWindow,
};

const PROCESS_MEMORY_ACCESS: u32 =
    PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION;

const WIN_ERROR_ACCESS_DENIED: u32 = 5;
const MEMORY_SCAN_CHUNK_SIZE: usize = 4 * 1024 * 1024;
const PROGRESS_CHUNK_INTERVAL: usize = 16;

struct CachedStudio {
    pid: u32,
    hwnd: windows_sys::Win32::Foundation::HWND,
}

unsafe impl Send for CachedStudio {}
unsafe impl Sync for CachedStudio {}

static STUDIO_CACHE: std::sync::OnceLock<std::sync::RwLock<Option<CachedStudio>>> =
    std::sync::OnceLock::new();

fn is_process_alive(pid: u32) -> bool {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }
    let mut exit_code: u32 = 0;
    let success = unsafe { GetExitCodeProcess(handle, &mut exit_code) };
    unsafe { CloseHandle(handle) };
    success != 0 && exit_code == 259 // STILL_ACTIVE
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn find_studio_process() -> Option<u32> {
    static LAST_SCAN_SECS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    if let Some(cache) = STUDIO_CACHE
        .get_or_init(|| std::sync::RwLock::new(None))
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
    {
        if is_process_alive(cache.pid) {
            return Some(cache.pid);
        }
    }

    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let last = LAST_SCAN_SECS.load(std::sync::atomic::Ordering::Relaxed);
    if now_secs.saturating_sub(last) < 5 {
        return None;
    }
    LAST_SCAN_SECS.store(now_secs, std::sync::atomic::Ordering::Relaxed);

    let mut sys = System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    for (sys_pid, process) in sys.processes() {
        if process.name().to_string_lossy().as_ref() == "RobloxStudioBeta.exe" {
            let pid_u32 = sys_pid.as_u32();
            if let Ok(mut guard) = STUDIO_CACHE.get_or_init(|| std::sync::RwLock::new(None)).write()
            {
                *guard = Some(CachedStudio { pid: pid_u32, hwnd: std::ptr::null_mut() });
            }
            return Some(pid_u32);
        }
    }
    None
}

struct EnumData {
    pid: u32,
    hwnd: windows_sys::Win32::Foundation::HWND,
}

unsafe extern "system" fn enum_windows_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    lparam: isize,
) -> i32 {
    let mut window_pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut window_pid);

    let data = &mut *(lparam as *mut EnumData);

    if window_pid == data.pid {
        use windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible;
        if IsWindowVisible(hwnd) != 0 {
            data.hwnd = hwnd;
            return 0;
        }
    }
    1
}

#[tauri::command]
#[specta::specta]
pub async fn focus_and_save_studio(pid: u32) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut target_hwnd = std::ptr::null_mut();

        if let Some(cache) = STUDIO_CACHE
            .get_or_init(|| std::sync::RwLock::new(None))
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            if cache.pid == pid && !cache.hwnd.is_null() && is_process_alive(pid) {
                target_hwnd = cache.hwnd;
            }
        }

        if target_hwnd.is_null() {
            let mut data = EnumData { pid, hwnd: std::ptr::null_mut() };
            unsafe {
                EnumWindows(Some(enum_windows_proc), std::ptr::addr_of_mut!(data) as isize);
            }
            target_hwnd = data.hwnd;

            if !target_hwnd.is_null() {
                let mut guard = STUDIO_CACHE
                    .get_or_init(|| std::sync::RwLock::new(None))
                    .write()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                *guard = Some(CachedStudio { pid, hwnd: target_hwnd });
            }
        }

        if target_hwnd.is_null() {
            return Err("Could not find visible window for process".to_string());
        }

        unsafe {
            SetForegroundWindow(target_hwnd);

            let mut inputs = [
                INPUT { r#type: INPUT_KEYBOARD, Anonymous: std::mem::zeroed() },
                INPUT { r#type: INPUT_KEYBOARD, Anonymous: std::mem::zeroed() },
                INPUT { r#type: INPUT_KEYBOARD, Anonymous: std::mem::zeroed() },
                INPUT { r#type: INPUT_KEYBOARD, Anonymous: std::mem::zeroed() },
            ];

            inputs[0].Anonymous.ki =
                KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 };

            inputs[1].Anonymous.ki =
                KEYBDINPUT { wVk: 0x53, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0 };

            inputs[2].Anonymous.ki = KEYBDINPUT {
                wVk: 0x53,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            inputs[3].Anonymous.ki = KEYBDINPUT {
                wVk: VK_CONTROL,
                wScan: 0,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
            };

            SendInput(inputs.len() as u32, inputs.as_mut_ptr(), size_of::<INPUT>() as i32);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

struct ProcessHandle(HANDLE);

unsafe impl Send for ProcessHandle {}
unsafe impl Sync for ProcessHandle {}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

struct MemoryRegion {
    base_address: *mut c_void,
    region_size: usize,
}

unsafe impl Send for MemoryRegion {}
unsafe impl Sync for MemoryRegion {}

fn open_process_for_memory(pid: u32) -> Result<ProcessHandle, String> {
    let handle = unsafe { OpenProcess(PROCESS_MEMORY_ACCESS, 0, pid) };
    if !handle.is_null() {
        return Ok(ProcessHandle(handle));
    }

    let error = unsafe { GetLastError() };
    Err(match error {
        WIN_ERROR_ACCESS_DENIED => "Could not access Roblox Studio memory. If Studio is running as \
            Administrator, run ISpooferMotion as Administrator too (or run Studio without elevation)."
            .into(),
        _ => format!(
            "Could not open Roblox Studio process (Win32 error {error}). Ensure Studio is running."
        ),
    })
}

fn validate_asset_id_pair(target: &str, replacement: &str) -> Result<(), String> {
    if target.is_empty() {
        return Err("Memory injection requires a numeric Roblox asset ID target.".into());
    }
    if !target.chars().all(|c| c.is_ascii_digit()) {
        return Err("Memory injection only supports numeric Roblox asset IDs.".into());
    }
    if replacement.is_empty() || !replacement.chars().all(|c| c.is_ascii_digit()) {
        return Err("Replacement value must be a numeric Roblox asset ID.".into());
    }
    if target.len() != replacement.len() {
        return Err(format!(
            "Memory injection requires old and new asset IDs to be the same length ({} vs {}). \
             Use the plugin bridge for different-length IDs.",
            target.len(),
            replacement.len()
        ));
    }
    Ok(())
}

fn is_bounded_numeric_match(buffer: &[u8], offset: usize, len: usize) -> bool {
    if len == 0 {
        return false;
    }
    if offset > 0 && buffer[offset - 1].is_ascii_digit() {
        return false;
    }
    let after = offset + len;
    if after < buffer.len() && buffer[after].is_ascii_digit() {
        return false;
    }
    true
}

fn is_bounded_numeric_match_utf16(buffer: &[u8], offset: usize, len: usize) -> bool {
    if len == 0 {
        return false;
    }
    if offset >= 2 {
        let prev = u16::from_le_bytes([buffer[offset - 2], buffer[offset - 1]]);
        if prev >= u16::from(b'0') && prev <= u16::from(b'9') {
            return false;
        }
    }
    let after = offset + len;
    if after + 1 < buffer.len() {
        let next = u16::from_le_bytes([buffer[after], buffer[after + 1]]);
        if next >= u16::from(b'0') && next <= u16::from(b'9') {
            return false;
        }
    }
    true
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

#[derive(Clone, serde::Serialize, specta::Type)]
struct MemoryPatchProgress {
    phase: &'static str,
    regions_total: usize,
    regions_scanned: usize,
    chunks_total: usize,
    chunks_scanned: usize,
    bytes_scanned: usize,
    matches_found: usize,
    writes_completed: usize,
}

fn emit_memory_patch_progress(app: &AppHandle, payload: MemoryPatchProgress) {
    let _ = app.emit("memory-patch-progress", payload);
}

const fn chunk_count(size: usize) -> usize {
    if size == 0 {
        return 0;
    }
    size.div_ceil(MEMORY_SCAN_CHUNK_SIZE)
}

fn read_process_chunk(
    handle: HANDLE,
    base_address: *mut c_void,
    region_offset: usize,
    read_size: usize,
) -> Option<Vec<u8>> {
    let mut buffer = vec![0u8; read_size];
    let mut bytes_read = 0;
    let read_address = (base_address as usize + region_offset) as *const c_void;

    let read_ok = unsafe {
        ReadProcessMemory(
            handle,
            read_address,
            buffer.as_mut_ptr().cast::<c_void>(),
            read_size,
            &mut bytes_read,
        )
    } != 0;

    if !read_ok || bytes_read == 0 {
        return None;
    }

    buffer.truncate(bytes_read);
    Some(buffer)
}

#[tauri::command]
#[specta::specta]
pub async fn scan_and_replace_multiple_strings(
    app: AppHandle,
    pid: u32,
    replacements: HashMap<String, String>,
) -> Result<HashMap<String, MemoryInjectionResult>, String> {
    if replacements.is_empty() {
        return Ok(HashMap::new());
    }

    let res = tokio::task::spawn_blocking(move || {
        let mut results = HashMap::new();

        for (target, replacement) in &replacements {
            validate_asset_id_pair(target, replacement)?;
        }

        if let Some(studio_pid) = find_studio_process() {
            if studio_pid != pid {
                return Err(format!(
                    "Security error: PID {pid} does not match Roblox Studio process ({studio_pid})"
                ));
            }
        }

        let process_handle = Arc::new(open_process_for_memory(pid)?);

        struct ReplacementData {
            target: String,
            target_bytes: Vec<u8>,
            replacement_bytes: Vec<u8>,
            target_utf16_bytes: Vec<u8>,
            replacement_utf16_bytes: Vec<u8>,
            utf8_count: AtomicUsize,
            utf16_count: AtomicUsize,
        }

        let mut data_items = Vec::new();
        for (target, replacement) in replacements {
            data_items.push(ReplacementData {
                target: target.clone(),
                target_bytes: target.as_bytes().to_vec(),
                replacement_bytes: replacement.as_bytes().to_vec(),
                target_utf16_bytes: target.encode_utf16().flat_map(u16::to_le_bytes).collect(),
                replacement_utf16_bytes: replacement
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect(),
                utf8_count: AtomicUsize::new(0),
                utf16_count: AtomicUsize::new(0),
            });
        }

        let utf8_patterns: Vec<&[u8]> =
            data_items.iter().map(|item| item.target_bytes.as_slice()).collect();
        let utf16_patterns: Vec<&[u8]> =
            data_items.iter().map(|item| item.target_utf16_bytes.as_slice()).collect();
        let utf8_matcher =
            AhoCorasick::new(utf8_patterns).map_err(|e| format!("UTF-8 matcher failed: {e}"))?;
        let utf16_matcher =
            AhoCorasick::new(utf16_patterns).map_err(|e| format!("UTF-16 matcher failed: {e}"))?;
        let max_pattern_len = data_items
            .iter()
            .flat_map(|item| [item.target_bytes.len(), item.target_utf16_bytes.len()])
            .max()
            .unwrap_or(1);
        let chunk_overlap = max_pattern_len.saturating_sub(1);

        let mut address: usize = 0;
        let mut mem_info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
        let sys_info_size = size_of::<MEMORY_BASIC_INFORMATION>();
        let mut regions = Vec::new();

        while unsafe {
            VirtualQueryEx(process_handle.0, address as *const c_void, &mut mem_info, sys_info_size)
        } != 0
        {
            const PAGE_GUARD: u32 = 0x100;
            if (mem_info.Protect & PAGE_GUARD) != 0 {
                address = mem_info.BaseAddress as usize + mem_info.RegionSize;
                continue;
            }
            let protect = mem_info.Protect & 0xFF;
            if mem_info.State == MEM_COMMIT
                && mem_info.Type == MEM_PRIVATE
                && (protect == PAGE_READWRITE || protect == PAGE_EXECUTE_READWRITE)
            {
                regions.push(MemoryRegion {
                    base_address: mem_info.BaseAddress,
                    region_size: mem_info.RegionSize,
                });
            }
            address = mem_info.BaseAddress as usize + mem_info.RegionSize;
        }

        let regions_total = regions.len();
        let chunks_total =
            regions.iter().map(|region| chunk_count(region.region_size)).sum::<usize>();
        let regions_scanned = AtomicUsize::new(0);
        let chunks_scanned = AtomicUsize::new(0);
        let bytes_scanned = AtomicUsize::new(0);
        let matches_found = AtomicUsize::new(0);
        let writes_completed = AtomicUsize::new(0);

        emit_memory_patch_progress(
            &app,
            MemoryPatchProgress {
                phase: "started",
                regions_total,
                regions_scanned: 0,
                chunks_total,
                chunks_scanned: 0,
                bytes_scanned: 0,
                matches_found: 0,
                writes_completed: 0,
            },
        );

        regions.par_iter().for_each(|region| {
            let mut region_offset = 0usize;

            while region_offset < region.region_size {
                let primary_size =
                    MEMORY_SCAN_CHUNK_SIZE.min(region.region_size.saturating_sub(region_offset));
                let prefix_size = 2.min(region_offset);
                let read_offset = region_offset - prefix_size;
                let read_size = (prefix_size + primary_size + chunk_overlap)
                    .min(region.region_size.saturating_sub(read_offset));
                let primary_start = prefix_size;
                let primary_end = primary_start + primary_size;

                if let Some(buffer) = read_process_chunk(
                    process_handle.0,
                    region.base_address,
                    read_offset,
                    read_size,
                ) {
                    bytes_scanned.fetch_add(buffer.len(), Ordering::Relaxed);

                    for mat in utf8_matcher.find_iter(&buffer) {
                        let offset = mat.start();
                        if offset < primary_start || offset >= primary_end {
                            continue;
                        }

                        let item = &data_items[mat.pattern().as_usize()];
                        if !is_bounded_numeric_match(&buffer, offset, item.target_bytes.len()) {
                            continue;
                        }

                        matches_found.fetch_add(1, Ordering::Relaxed);
                        let write_address =
                            (region.base_address as usize + read_offset + offset) as *mut c_void;
                        let mut bytes_written = 0;

                        if unsafe {
                            WriteProcessMemory(
                                process_handle.0,
                                write_address,
                                item.replacement_bytes.as_ptr().cast::<c_void>(),
                                item.replacement_bytes.len(),
                                &mut bytes_written,
                            )
                        } != 0
                            && bytes_written == item.replacement_bytes.len()
                        {
                            item.utf8_count.fetch_add(1, Ordering::Relaxed);
                            writes_completed.fetch_add(1, Ordering::Relaxed);
                        }
                    }

                    for mat in utf16_matcher.find_iter(&buffer) {
                        let offset = mat.start();
                        if offset < primary_start || offset >= primary_end {
                            continue;
                        }

                        let item = &data_items[mat.pattern().as_usize()];
                        if !is_bounded_numeric_match_utf16(
                            &buffer,
                            offset,
                            item.target_utf16_bytes.len(),
                        ) {
                            continue;
                        }

                        matches_found.fetch_add(1, Ordering::Relaxed);
                        let write_address =
                            (region.base_address as usize + read_offset + offset) as *mut c_void;
                        let mut bytes_written = 0;

                        if unsafe {
                            WriteProcessMemory(
                                process_handle.0,
                                write_address,
                                item.replacement_utf16_bytes.as_ptr().cast::<c_void>(),
                                item.replacement_utf16_bytes.len(),
                                &mut bytes_written,
                            )
                        } != 0
                            && bytes_written == item.replacement_utf16_bytes.len()
                        {
                            item.utf16_count.fetch_add(1, Ordering::Relaxed);
                            writes_completed.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }

                let scanned = chunks_scanned.fetch_add(1, Ordering::Relaxed) + 1;
                if scanned % PROGRESS_CHUNK_INTERVAL == 0 || scanned == chunks_total {
                    emit_memory_patch_progress(
                        &app,
                        MemoryPatchProgress {
                            phase: "scanning",
                            regions_total,
                            regions_scanned: regions_scanned.load(Ordering::Relaxed),
                            chunks_total,
                            chunks_scanned: scanned,
                            bytes_scanned: bytes_scanned.load(Ordering::Relaxed),
                            matches_found: matches_found.load(Ordering::Relaxed),
                            writes_completed: writes_completed.load(Ordering::Relaxed),
                        },
                    );
                }

                region_offset += primary_size;
            }

            regions_scanned.fetch_add(1, Ordering::Relaxed);
        });

        emit_memory_patch_progress(
            &app,
            MemoryPatchProgress {
                phase: "complete",
                regions_total,
                regions_scanned: regions_scanned.load(Ordering::Relaxed),
                chunks_total,
                chunks_scanned: chunks_scanned.load(Ordering::Relaxed),
                bytes_scanned: bytes_scanned.load(Ordering::Relaxed),
                matches_found: matches_found.load(Ordering::Relaxed),
                writes_completed: writes_completed.load(Ordering::Relaxed),
            },
        );

        for item in data_items {
            let u8_val = item.utf8_count.into_inner();
            let u16_val = item.utf16_count.into_inner();
            results.insert(
                item.target,
                MemoryInjectionResult {
                    utf8_replaced: u8_val,
                    utf16_replaced: u16_val,
                    total_replaced: u8_val + u16_val,
                },
            );
        }

        Ok(results)
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?;

    res
}

#[cfg(test)]
mod tests {
    use super::{is_bounded_numeric_match, validate_asset_id_pair};

    #[test]
    fn rejects_non_numeric_ids() {
        assert!(validate_asset_id_pair("", "123").is_err());
        assert!(validate_asset_id_pair("abc", "123").is_err());
        assert!(validate_asset_id_pair("123", "abc").is_err());
        assert!(validate_asset_id_pair("123", "").is_err());
    }

    #[test]
    fn rejects_different_lengths() {
        assert!(validate_asset_id_pair("12345", "123456").is_err());
    }

    #[test]
    fn accepts_matching_numeric_pair() {
        assert!(validate_asset_id_pair("12345", "67890").is_ok());
    }

    #[test]
    fn bounded_match_rejects_embedded_substring() {
        let buf = b"asset:1234567:end";
        assert!(!is_bounded_numeric_match(buf, 6, 3));
        assert!(is_bounded_numeric_match(buf, 6, 7));
    }
}
