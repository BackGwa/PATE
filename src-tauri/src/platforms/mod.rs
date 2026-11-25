#[cfg(windows)]
mod windows;
#[cfg(target_os = "macos")]
mod macos;

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct PlatformRect {
    pub id: u64,
    pub left: f64,
    pub top: f64,
    pub right: f64,
}

#[cfg(windows)]
pub fn list_platforms(_points_to_physical: f64) -> Vec<PlatformRect> {
    windows::list_platforms()
}

#[cfg(target_os = "macos")]
pub fn list_platforms(points_to_physical: f64) -> Vec<PlatformRect> {
    macos::list_platforms(points_to_physical)
}
