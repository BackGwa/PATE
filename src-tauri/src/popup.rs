use tauri::{Runtime, WebviewWindow};

#[tauri::command]
pub fn show_popup<R: Runtime>(window: WebviewWindow<R>, focus: bool) -> Result<(), String> {
    disable_transitions(&window);
    window.show().map_err(|error| error.to_string())?;
    if focus {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn disable_transitions<R: Runtime>(window: &WebviewWindow<R>) {
    use std::ffi::c_void;
    use std::mem::size_of;

    use windows::Win32::Foundation::{HWND, TRUE};
    use windows::Win32::Graphics::Dwm::{DWMWA_TRANSITIONS_FORCEDISABLED, DwmSetWindowAttribute};
    use windows::core::BOOL;

    let Ok(handle) = window.hwnd() else {
        return;
    };
    let disabled: BOOL = TRUE;
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(handle.0 as _),
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &disabled as *const BOOL as *const c_void,
            size_of::<BOOL>() as u32,
        );
    }
}

#[cfg(not(windows))]
pub fn disable_transitions<R: Runtime>(_window: &WebviewWindow<R>) {}
