use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewWindow};

use crate::motion::{Area, Display, Facing, Frame, Motion, MotionEvent, MotionSnapshot, SupportSnapshot, Surroundings};
use crate::platforms;

pub const PET_WINDOW: &str = "main";
pub const POPUP_WINDOW: &str = "popup";
const MOTION_EVENT: &str = "pet-motion";
const DEBUG_EVENT: &str = "pet-debug";
const IMPACT_EVENT: &str = "pet-impact";
const DEBUG_INTERVAL: Duration = Duration::from_millis(100);
const DEBUG_PANEL_GAP: f64 = 4.0;
const TICK: Duration = Duration::from_millis(16);
const DISPLAY_REFRESH: Duration = Duration::from_millis(500);

pub struct PetState {
    motion: Mutex<Motion>,
    last_event: Mutex<Option<MotionEvent>>,
    debug_panel: Mutex<Option<DebugPanel>>,
}

#[derive(Clone, Copy)]
struct DebugPanel {
    width: f64,
    height: f64,
    reported_at: Option<Instant>,
}

#[derive(Serialize, Clone)]
struct DebugInfo {
    #[serde(flatten)]
    motion: MotionSnapshot,
    title: Option<String>,
    display_scale: f64,
}

#[derive(Serialize)]
pub struct PointerOffset {
    x: f64,
    y: f64,
}

pub fn manage<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let window = pet_window(app)?;
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    app.manage(PetState {
        motion: Mutex::new(Motion::new(Frame {
            x: position.x as f64,
            y: position.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        })),
        last_event: Mutex::new(None),
        debug_panel: Mutex::new(None),
    });
    Ok(())
}

pub fn spawn_ticker<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut displays = capture_displays(&app);
        let mut displays_at = Instant::now();
        let mut last_tick = Instant::now();
        loop {
            std::thread::sleep(TICK);
            let now = Instant::now();
            if now.duration_since(displays_at) >= DISPLAY_REFRESH {
                displays = capture_displays(&app);
                displays_at = now;
            }
            let cursor = app.cursor_position().ok().map(|cursor| (cursor.x, cursor.y));
            let state = app.state::<PetState>();
            let needs_platforms = state.motion.lock().unwrap().needs_platforms();
            let surroundings = Surroundings {
                platforms: if needs_platforms {
                    platforms::list_platforms(pet_display_scale(&state, &displays))
                } else {
                    Vec::new()
                },
                displays: displays.clone(),
            };
            let mut motion = state.motion.lock().unwrap();
            let before = motion.frame();
            motion.step(now.duration_since(last_tick), now, cursor, &surroundings);
            last_tick = now;
            if motion.frame() != before {
                apply_frame(&app, motion.frame());
            }
            publish(&app, &state, &motion);
            if let Some(impact) = motion.take_impact() {
                let _ = app.emit_to(PET_WINDOW, IMPACT_EVENT, impact);
            }
            follow_with_debug_panel(&app, &state, &motion, &displays, now);
        }
    });
}

#[tauri::command]
pub async fn follow_pet(state: State<'_, PetState>, size: Option<(f64, f64)>) -> Result<(), String> {
    *state.debug_panel.lock().unwrap() = size.map(|(width, height)| DebugPanel {
        width,
        height,
        reported_at: None,
    });
    Ok(())
}

fn follow_with_debug_panel<R: Runtime>(
    app: &AppHandle<R>,
    state: &PetState,
    motion: &Motion,
    displays: &[Display],
    now: Instant,
) {
    let mut debug_panel = state.debug_panel.lock().unwrap();
    let Some(panel) = debug_panel.as_mut() else {
        return;
    };
    let Some(popup) = app.get_webview_window(POPUP_WINDOW) else {
        return;
    };
    let frame = motion.frame();
    let surroundings = Surroundings {
        displays: displays.to_vec(),
        platforms: Vec::new(),
    };
    let Some(display) = surroundings
        .display_at(frame.x + frame.width / 2.0, frame.y + frame.height / 2.0)
        .copied()
    else {
        return;
    };
    let width = panel.width * display.scale;
    let height = panel.height * display.scale;
    let gap = DEBUG_PANEL_GAP * display.scale;
    let right_side = frame.x + frame.width + gap;
    let x = if right_side + width <= display.bounds.right {
        right_side
    } else {
        frame.x - gap - width
    };
    let y = frame.y.clamp(display.bounds.top, (display.bounds.bottom - height).max(display.bounds.top));
    let _ = popup.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    if panel.reported_at.is_some_and(|at| now.duration_since(at) < DEBUG_INTERVAL) {
        return;
    }
    panel.reported_at = Some(now);
    let snapshot = motion.snapshot();
    let title = match snapshot.support {
        Some(SupportSnapshot::Window { id }) => platforms::window_title(id),
        _ => None,
    };
    let _ = app.emit_to(
        POPUP_WINDOW,
        DEBUG_EVENT,
        DebugInfo {
            motion: snapshot,
            title,
            display_scale: display.scale,
        },
    );
}

#[tauri::command]
pub async fn place_pet<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PetState>,
    position: Option<(f64, f64)>,
) -> Result<(), String> {
    let displays = capture_displays(&app);
    let surroundings = Surroundings {
        platforms: platforms::list_platforms(pet_display_scale(&state, &displays)),
        displays,
    };
    let mut motion = state.motion.lock().unwrap();
    motion.place(position, &surroundings);
    apply_frame(&app, motion.frame());
    *state.last_event.lock().unwrap() = None;
    publish(&app, &state, &motion);
    Ok(())
}

#[tauri::command]
pub async fn resize_pet<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PetState>,
    scale: f64,
) -> Result<(), String> {
    let display_scale = pet_display_scale(&state, &capture_displays(&app));
    let mut motion = state.motion.lock().unwrap();
    motion.resize(scale, display_scale);
    let frame = motion.frame();
    let window = pet_window(&app).map_err(|error| error.to_string())?;
    window
        .set_size(PhysicalSize::new(frame.width as u32, frame.height as u32))
        .map_err(|error| error.to_string())?;
    apply_frame(&app, frame);
    Ok(())
}

#[tauri::command]
pub async fn set_foot_inset(state: State<'_, PetState>, ratio: f64) -> Result<(), String> {
    state.motion.lock().unwrap().set_foot_inset_ratio(ratio);
    Ok(())
}

#[tauri::command]
pub async fn start_walk<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PetState>,
    facing: Facing,
    distance: f64,
    leap: bool,
) -> Result<(), String> {
    let display_scale = pet_display_scale(&state, &capture_displays(&app));
    let mut motion = state.motion.lock().unwrap();
    motion.start_walk(facing, distance, leap, display_scale);
    publish(&app, &state, &motion);
    Ok(())
}

#[tauri::command]
pub async fn stop_walk<R: Runtime>(app: AppHandle<R>, state: State<'_, PetState>) -> Result<(), String> {
    let mut motion = state.motion.lock().unwrap();
    motion.stop_walk();
    publish(&app, &state, &motion);
    Ok(())
}

#[tauri::command]
pub async fn drag_start<R: Runtime>(app: AppHandle<R>, state: State<'_, PetState>) -> Result<(), String> {
    let cursor = app.cursor_position().map_err(|error| error.to_string())?;
    let mut motion = state.motion.lock().unwrap();
    motion.start_drag(cursor.x, cursor.y);
    publish(&app, &state, &motion);
    Ok(())
}

#[tauri::command]
pub async fn drag_end<R: Runtime>(app: AppHandle<R>, state: State<'_, PetState>) -> Result<(), String> {
    let display_scale = pet_display_scale(&state, &capture_displays(&app));
    let mut motion = state.motion.lock().unwrap();
    motion.release(display_scale);
    publish(&app, &state, &motion);
    Ok(())
}

#[tauri::command]
pub async fn pointer_offset<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, PetState>,
) -> Result<PointerOffset, String> {
    let cursor = app.cursor_position().map_err(|error| error.to_string())?;
    let display_scale = pet_display_scale(&state, &capture_displays(&app));
    let frame = state.motion.lock().unwrap().frame();
    Ok(PointerOffset {
        x: (cursor.x - frame.x) / display_scale,
        y: (cursor.y - frame.y) / display_scale,
    })
}

#[tauri::command]
pub fn quit_app<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

fn pet_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    app.get_webview_window(PET_WINDOW)
        .ok_or(tauri::Error::WindowNotFound)
}

fn apply_frame<R: Runtime>(app: &AppHandle<R>, frame: Frame) {
    if let Ok(window) = pet_window(app) {
        let _ = window.set_position(PhysicalPosition::new(frame.x.round() as i32, frame.y.round() as i32));
    }
}

fn publish<R: Runtime>(app: &AppHandle<R>, state: &PetState, motion: &Motion) {
    let event = motion.event();
    let mut last_event = state.last_event.lock().unwrap();
    if event != *last_event {
        if let Some(event) = &event {
            let _ = app.emit_to(PET_WINDOW, MOTION_EVENT, event);
        }
        *last_event = event;
    }
}

fn pet_display_scale(state: &PetState, displays: &[Display]) -> f64 {
    let frame = state.motion.lock().unwrap().frame();
    Surroundings {
        displays: displays.to_vec(),
        platforms: Vec::new(),
    }
    .display_at(frame.x + frame.width / 2.0, frame.y + frame.height / 2.0)
    .map_or(1.0, |display| display.scale)
}

fn capture_displays<R: Runtime>(app: &AppHandle<R>) -> Vec<Display> {
    let primary_position = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| *monitor.position());
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let work_area = monitor.work_area();
            Display {
                bounds: Area {
                    left: position.x as f64,
                    top: position.y as f64,
                    right: position.x as f64 + size.width as f64,
                    bottom: position.y as f64 + size.height as f64,
                },
                work_area: Area {
                    left: work_area.position.x as f64,
                    top: work_area.position.y as f64,
                    right: work_area.position.x as f64 + work_area.size.width as f64,
                    bottom: work_area.position.y as f64 + work_area.size.height as f64,
                },
                scale: monitor.scale_factor(),
                primary: Some(*position) == primary_position,
            }
        })
        .collect()
}
