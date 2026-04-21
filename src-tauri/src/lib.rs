use base64::{engine::general_purpose::STANDARD, Engine as _};
use screenshots::image::{DynamicImage, ImageFormat};
use std::io::Cursor;
use tauri::Manager;

#[tauri::command]
fn capture_primary_screen(app: tauri::AppHandle) -> Result<String, String> {
    let main = app.get_webview_window("main");
    if let Some(w) = &main {
        let _ = w.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(150));

    let result: Result<String, String> = (|| {
        let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
        let screen = screens.first().ok_or_else(|| "no screen found".to_string())?;
        let rgba = screen.capture().map_err(|e| e.to_string())?;
        let dyn_img = DynamicImage::ImageRgba8(rgba);
        let mut png_bytes: Vec<u8> = Vec::new();
        dyn_img
            .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        Ok(format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes)))
    })();

    if let Some(w) = main {
        let _ = w.show();
        let _ = w.set_focus();
    }

    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![capture_primary_screen])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
