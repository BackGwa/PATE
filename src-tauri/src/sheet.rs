use tauri::ipc::Response;

#[tauri::command]
pub async fn read_sheet(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|error| error.to_string())
}
