use base64::{engine::general_purpose::STANDARD, Engine as _};
use screenshots::image::{DynamicImage, ImageFormat};
use std::io::Cursor;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
    let screen = screens
        .iter()
        .find(|s| s.display_info.is_primary)
        .or_else(|| screens.first())
        .ok_or_else(|| "no screen found".to_string())?;
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
async fn start_region_capture(app: AppHandle) -> Result<(), String> {
    perform_region_capture(app).await
}

async fn perform_region_capture(app: AppHandle) -> Result<(), String> {
    eprintln!("[capture] perform_region_capture invoked");
    let main = app.get_webview_window("main").ok_or("no main window")?;
    let _ = main.hide();
    eprintln!("[capture] main hidden");
    std::thread::sleep(std::time::Duration::from_millis(180));

    let state = app.state::<AppState>();

    let run = || -> Result<(), String> {
        let monitor = main
            .primary_monitor()
            .map_err(|e| format!("primary_monitor err: {e}"))?
            .ok_or_else(|| "no primary monitor".to_string())?;
        let monitor_size = monitor.size();
        let scale_factor = monitor.scale_factor();
        let logical_w = monitor_size.width as f64 / scale_factor;
        let logical_h = monitor_size.height as f64 / scale_factor;
        eprintln!(
            "[capture] monitor physical={}x{} scale={} logical={}x{}",
            monitor_size.width, monitor_size.height, scale_factor, logical_w, logical_h
        );

        let payload = capture_primary(scale_factor)
            .map_err(|e| format!("capture_primary err: {e}"))?;
        eprintln!(
            "[capture] screenshot captured data_url_len={} info={}x{}",
            payload.data_url.len(),
            payload.info.width,
            payload.info.height
        );

        {
            let mut guard = state.pending_screenshot.lock().map_err(|e| e.to_string())?;
            *guard = Some(payload);
        }

        if let Some(existing) = app.get_webview_window("overlay") {
            eprintln!("[capture] closing stale overlay window");
            let _ = existing.close();
        }

        eprintln!("[capture] building overlay webview window");
        let overlay = WebviewWindowBuilder::new(
            &app,
            "overlay",
            WebviewUrl::App("index.html?overlay=capture".into()),
        )
        .title("MarkShot Overlay")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .shadow(false)
        .position(0.0, 0.0)
        .inner_size(logical_w, logical_h)
        .build()
        .map_err(|e| format!("overlay build err: {e}"))?;

        eprintln!("[capture] overlay built label={}", overlay.label());
        let _ = overlay.show();
        let _ = overlay.set_focus();
        eprintln!("[capture] overlay show/focus called");

        Ok(())
    };

    match run() {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("[capture] ERROR: {e} — restoring main window");
            let _ = main.show();
            let _ = main.set_focus();
            Err(e)
        }
    }
}

#[tauri::command]
fn overlay_ready(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    eprintln!("[capture] overlay_ready invoked");
    let payload = state
        .pending_screenshot
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    match (payload, app.get_webview_window("overlay")) {
        (Some(p), Some(overlay)) => {
            overlay
                .emit("overlay:screenshot", &p)
                .map_err(|e| e.to_string())?;
            eprintln!("[capture] overlay_ready emitted screenshot");
        }
        (None, _) => eprintln!("[capture] overlay_ready: no pending screenshot"),
        (_, None) => eprintln!("[capture] overlay_ready: no overlay window"),
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

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CaptureCompletePayload {
    data_url: String,
    saved_path: Option<String>,
}

#[tauri::command]
async fn overlay_region_selected(
    app: AppHandle,
    data_url: String,
    filename: String,
) -> Result<(), String> {
    let base64_part = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "invalid data url".to_string())?;
    let png_bytes = STANDARD.decode(base64_part).map_err(|e| e.to_string())?;

    let dyn_img = screenshots::image::load_from_memory(&png_bytes).map_err(|e| e.to_string())?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let rgba_bytes: Vec<u8> = rgba.into_raw();

    let img = tauri::image::Image::new(&rgba_bytes, w, h);
    app.clipboard()
        .write_image(&img)
        .map_err(|e| e.to_string())?;

    let saved_path = match save_png_to_pictures(&app, &filename, &png_bytes) {
        Ok(p) => {
            eprintln!("[capture] saved png to {}", p);
            Some(p)
        }
        Err(e) => {
            eprintln!("[capture] save failed: {e}");
            None
        }
    };

    restore_main_and_close_overlay(&app);
    if let Some(main) = app.get_webview_window("main") {
        let payload = CaptureCompletePayload {
            data_url,
            saved_path,
        };
        let _ = main.emit("capture:complete", &payload);
    }
    Ok(())
}

fn save_png_to_pictures(app: &AppHandle, filename: &str, bytes: &[u8]) -> Result<String, String> {
    let base = app
        .path()
        .picture_dir()
        .map_err(|e| format!("picture_dir err: {e}"))?;
    let dir = base.join("MarkShot");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir err: {e}"))?;
    let path = dir.join(filename);
    std::fs::write(&path, bytes).map_err(|e| format!("write err: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyS)
                    {
                        eprintln!("[shortcut] Ctrl+Shift+S pressed");
                        if app.get_webview_window("overlay").is_some() {
                            eprintln!("[shortcut] overlay already open, ignoring");
                            return;
                        }
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = perform_region_capture(handle).await {
                                eprintln!("[shortcut] capture err: {e}");
                            }
                        });
                    }
                })
                .build(),
        )
        .manage(AppState {
            pending_screenshot: Mutex::new(None),
        })
        .setup(|app| {
            let ctrl_shift_s =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS);
            if let Err(e) = app.global_shortcut().register(ctrl_shift_s) {
                eprintln!("[shortcut] register Ctrl+Shift+S failed: {e}");
            } else {
                eprintln!("[shortcut] registered Ctrl+Shift+S");
            }
            Ok(())
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
