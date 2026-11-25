use tauri::Manager;

mod motion;
mod pet_window;
mod platforms;
mod popup;
mod sheet;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            pet_window::manage(app.handle())?;
            if let Some(window) = app.get_webview_window(pet_window::PET_WINDOW) {
                popup::disable_transitions(&window);
            }
            pet_window::spawn_ticker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pet_window::place_pet,
            pet_window::resize_pet,
            pet_window::set_foot_inset,
            pet_window::drag_start,
            pet_window::drag_end,
            pet_window::pointer_offset,
            pet_window::quit_app,
            pet_window::follow_pet,
            pet_window::start_walk,
            pet_window::stop_walk,
            sheet::read_sheet,
            popup::show_popup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PATE");
}
