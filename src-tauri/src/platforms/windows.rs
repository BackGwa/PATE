use std::ffi::c_void;
use std::mem::size_of;

use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetClassNameW, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, WS_EX_TOOLWINDOW,
};
use windows::core::BOOL;

use super::PlatformRect;

const DESKTOP_CLASSES: [&str; 2] = ["Progman", "WorkerW"];

pub fn list_platforms() -> Vec<PlatformRect> {
    let mut platforms = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(collect_platform),
            LPARAM(&mut platforms as *mut Vec<PlatformRect> as isize),
        );
    }
    platforms
}

pub fn window_title(id: u64) -> Option<String> {
    let hwnd = HWND(id as usize as *mut c_void);
    let mut buffer = vec![0u16; unsafe { GetWindowTextLengthW(hwnd) }.max(0) as usize + 1];
    let length = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    (length > 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
}

unsafe extern "system" fn collect_platform(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let platforms = unsafe { &mut *(lparam.0 as *mut Vec<PlatformRect>) };
    if let Some(platform) = unsafe { platform_of(hwnd) } {
        platforms.push(platform);
    }
    BOOL(1)
}

unsafe fn platform_of(hwnd: HWND) -> Option<PlatformRect> {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return None;
        }
        if GetWindowTextLengthW(hwnd) == 0 {
            return None;
        }
        if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
            return None;
        }
        if is_own_window(hwnd) || is_desktop_window(hwnd) || is_cloaked(hwnd) {
            return None;
        }
        let bounds = frame_bounds(hwnd)?;
        if bounds.right <= bounds.left || bounds.bottom <= bounds.top {
            return None;
        }
        Some(PlatformRect {
            id: hwnd.0 as usize as u64,
            left: bounds.left as f64,
            top: bounds.top as f64,
            right: bounds.right as f64,
            bottom: bounds.bottom as f64,
        })
    }
}

unsafe fn is_own_window(hwnd: HWND) -> bool {
    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    process_id == std::process::id()
}

unsafe fn is_desktop_window(hwnd: HWND) -> bool {
    let mut buffer = [0u16; 32];
    let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
    let class_name = String::from_utf16_lossy(&buffer[..length.max(0) as usize]);
    DESKTOP_CLASSES.contains(&class_name.as_str())
}

unsafe fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    let result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            size_of::<u32>() as u32,
        )
    };
    result.is_ok() && cloaked != 0
}

unsafe fn frame_bounds(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut c_void,
            size_of::<RECT>() as u32,
        )
    }
    .ok()?;
    Some(rect)
}
