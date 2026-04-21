use base64::{engine::general_purpose::STANDARD, Engine as _};
use screenshots::image::{self, DynamicImage, ImageFormat};
use std::io::Cursor;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DisplayInfo {
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScreenshotPayload {
    data_url: String,
    info: DisplayInfo,
}

struct AppState {
    pending_screenshot: Mutex<Option<ScreenshotPayload>>,
}

fn capture_primary(scale_factor: f64) -> Result<ScreenshotPayload, String> {
    let screens = screenshots::Screen::all().map_err(|e| e.to_string())?;
    let screen = screens.first().ok_or_else(|| "no screen found".to_string())?;
    let rgba = screen.capture().map_err(|e| e.to_string())?;
    let width = rgba.width();
    let height = rgba.height();
    let dyn_img = DynamicImage::ImageRgba8(rgba);
    let mut png_bytes: Vec<u8> = Vec::new();
    dyn_img
        .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(ScreenshotPayload {
        data_url: format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes)),
        info: DisplayInfo {
            width,
            height,
            scale_factor,
        },
    })
}

#[tauri::command]
fn capture_primary_screen(app: AppHandle) -> Result<String, String> {
    let main = app.get_webview_window("main");
    if let Some(w) = &main {
        let _ = w.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(150));

    let scale_factor = main
        .as_ref()
        .and_then(|w| w.primary_monitor().ok().flatten())
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    let result = capture_primary(scale_factor).map(|p| p.data_url);

    if let Some(w) = main {
        let _ = w.show();
        let _ = w.set_focus();
    }
    result
}

#[tauri::command]
fn start_region_capture(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("no main window")?;
    let _ = main.hide();
    std::thread::sleep(std::time::Duration::from_millis(180));

    let monitor = main
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no primary monitor".to_string())?;
    let monitor_size = monitor.size();
    let scale_factor = monitor.scale_factor();
    let logical_w = monitor_size.width as f64 / scale_factor;
    let logical_h = monitor_size.height as f64 / scale_factor;

    let payload = match capture_primary(scale_factor) {
        Ok(p) => p,
        Err(e) => {
            let _ = main.show();
            return Err(e);
        }
    };

    {
        let mut guard = state.pending_screenshot.lock().map_err(|e| e.to_string())?;
        *guard = Some(payload);
    }

    if let Some(existing) = app.get_webview_window("overlay") {
        let _ = existing.close();
    }

    WebviewWindowBuilder::new(
        &app,
        "overlay",
        WebviewUrl::App("index.html#/capture".into()),
    )
    .title("")
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .shadow(false)
    .position(0.0, 0.0)
    .inner_size(logical_w, logical_h)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn overlay_ready(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let payload = state
        .pending_screenshot
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if let Some(p) = payload {
        if let Some(overlay) = app.get_webview_window("overlay") {
            overlay
                .emit("overlay:screenshot", &p)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn restore_main_and_close_overlay(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
fn overlay_cancel(app: AppHandle) -> Result<(), String> {
    restore_main_and_close_overlay(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("capture:cancelled", ());
    }
    Ok(())
}

#[tauri::command]
fn overlay_region_selected(app: AppHandle, data_url: String) -> Result<(), String> {
    let base64_part = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "invalid data url".to_string())?;
    let png_bytes = STANDARD.decode(base64_part).map_err(|e| e.to_string())?;

    let dyn_img = image::load_from_memory(&png_bytes).map_err(|e| e.to_string())?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let rgba_bytes: Vec<u8> = rgba.into_raw();

    let img = tauri::image::Image::new(&rgba_bytes, w, h);
    app.clipboard()
        .write_image(&img)
        .map_err(|e| e.to_string())?;

    restore_main_and_close_overlay(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("capture:complete", &data_url);
    }
    Ok(())
}

#[tauri::command]
fn overlay_bring_to_front(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn overlay_screenshot_loaded() {}

#[tauri::command]
fn overlay_painted() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            pending_screenshot: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            capture_primary_screen,
            start_region_capture,
            overlay_ready,
            overlay_cancel,
            overlay_region_selected,
            overlay_bring_to_front,
            overlay_screenshot_loaded,
            overlay_painted,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
