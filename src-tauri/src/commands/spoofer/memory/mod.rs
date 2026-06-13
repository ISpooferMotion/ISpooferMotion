#[cfg(not(target_os = "windows"))]
pub mod stub;
#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(not(target_os = "windows"))]
pub use stub::*;
#[cfg(target_os = "windows")]
pub use windows::*;
