use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer,
    kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowNumber,
    kCGWindowOwnerPID,
};

use super::PlatformRect;

type WindowInfo = CFDictionary<CFString, CFType>;

pub fn list_platforms(points_to_physical: f64) -> Vec<PlatformRect> {
    let Some(windows) = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    ) else {
        return Vec::new();
    };
    let own_process_id = std::process::id() as f64;
    windows
        .iter()
        .filter_map(|item| {
            let info: WindowInfo = unsafe { CFDictionary::wrap_under_get_rule(*item as _) };
            platform_of(&info, own_process_id, points_to_physical)
        })
        .collect()
}

fn platform_of(info: &WindowInfo, own_process_id: f64, points_to_physical: f64) -> Option<PlatformRect> {
    if number(info, unsafe { kCGWindowLayer })? != 0.0 {
        return None;
    }
    if number(info, unsafe { kCGWindowOwnerPID })? == own_process_id {
        return None;
    }
    let id = number(info, unsafe { kCGWindowNumber })? as u64;
    let bounds = dictionary(info, unsafe { kCGWindowBounds })?;
    let left = number(&bounds, CFString::from_static_string("X").as_concrete_TypeRef())?;
    let top = number(&bounds, CFString::from_static_string("Y").as_concrete_TypeRef())?;
    let width = number(&bounds, CFString::from_static_string("Width").as_concrete_TypeRef())?;
    if width <= 0.0 {
        return None;
    }
    Some(PlatformRect {
        id,
        left: left * points_to_physical,
        top: top * points_to_physical,
        right: (left + width) * points_to_physical,
    })
}

fn number(info: &WindowInfo, key: CFStringRef) -> Option<f64> {
    let key = unsafe { CFString::wrap_under_get_rule(key) };
    info.find(&key)?.downcast::<CFNumber>()?.to_f64()
}

fn dictionary(info: &WindowInfo, key: CFStringRef) -> Option<WindowInfo> {
    let key = unsafe { CFString::wrap_under_get_rule(key) };
    let value = info.find(&key)?.downcast::<CFDictionary>()?;
    Some(unsafe { CFDictionary::wrap_under_get_rule(value.as_concrete_TypeRef()) })
}
