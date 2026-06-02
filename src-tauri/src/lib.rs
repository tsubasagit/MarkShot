use base64::{engine::general_purpose::STANDARD, Engine as _};
use screenshots::image::imageops::FilterType;
use screenshots::image::{DynamicImage, ImageFormat};
use screenshots::Screen;
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DisplayInfo {
    id: u32,
    width: u32,
    height: u32,
    scale_factor: f64,
    is_primary: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScreenshotPayload {
    data_url: String,
    info: DisplayInfo,
}

/// 録画スレッドと共有する停止/一時停止フラグ。
struct RecordingState {
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}

struct AppState {
    /// オーバーレイ窓ラベル -> 当該モニタのスクリーンショット
    pending_screenshots: Mutex<HashMap<String, ScreenshotPayload>>,
    /// 進行中の GIF 録画（無ければ None）
    recording: Mutex<Option<RecordingState>>,
}

// ---------------------------------------------------------------------------
// スクリーンショット（マルチモニタ対応）
// ---------------------------------------------------------------------------

/// 1 画面分をキャプチャして PNG data URL + 表示情報を返す。
fn capture_screen_payload(screen: &Screen) -> Result<ScreenshotPayload, String> {
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
            id: screen.display_info.id,
            width,
            height,
            scale_factor: screen.display_info.scale_factor as f64,
            is_primary: screen.display_info.is_primary,
        },
    })
}

/// 旧 API 互換：プライマリのみキャプチャして data URL を返す（現 UI からは未使用）。
#[tauri::command]
fn capture_primary_screen(app: AppHandle) -> Result<String, String> {
    let main = app.get_webview_window("main");
    if let Some(w) = &main {
        let _ = w.hide();
    }
    std::thread::sleep(Duration::from_millis(150));

    let screens = Screen::all().map_err(|e| e.to_string())?;
    let screen = screens
        .iter()
        .find(|s| s.display_info.is_primary)
        .or_else(|| screens.first())
        .ok_or_else(|| "no screen found".to_string())?;
    let result = capture_screen_payload(screen).map(|p| p.data_url);

    if let Some(w) = main {
        let _ = w.show();
        let _ = w.set_focus();
    }
    result
}

/// 全オーバーレイ窓（label が "overlay" で始まる）を閉じる。
fn close_overlays(app: &AppHandle) -> bool {
    let mut closed = false;
    for (label, w) in app.webview_windows() {
        if label.starts_with("overlay") {
            let _ = w.close();
            closed = true;
        }
    }
    closed
}

fn close_overlays_and_restore_main(app: &AppHandle) {
    close_overlays(app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
async fn start_region_capture(app: AppHandle, mode: Option<String>) -> Result<(), String> {
    perform_region_capture(app, mode.unwrap_or_else(|| "screenshot".into())).await
}

async fn perform_region_capture(app: AppHandle, mode: String) -> Result<(), String> {
    eprintln!("[capture] perform_region_capture mode={mode}");

    // 直前のキャプチャでオーバーレイが残っていたら先に閉じて、完全に画面から消えるのを待つ
    if close_overlays(&app) {
        eprintln!("[capture] closed leftover overlays before capture");
        std::thread::sleep(Duration::from_millis(250));
    }

    let main = app.get_webview_window("main").ok_or("no main window")?;
    if let Err(e) = main.hide() {
        eprintln!("[capture] main.hide() err: {e}");
    }
    // hide メッセージ処理 + 描画更新が完了するまで待つ（メイン UI の写り込み防止）
    std::thread::sleep(Duration::from_millis(350));

    let state = app.state::<AppState>();

    let run = || -> Result<(), String> {
        let screens = Screen::all().map_err(|e| format!("Screen::all err: {e}"))?;
        if screens.is_empty() {
            return Err("no screen found".into());
        }
        eprintln!("[capture] {} screen(s) detected", screens.len());

        // 既存の保留分をクリア
        {
            let mut guard = state
                .pending_screenshots
                .lock()
                .map_err(|e| e.to_string())?;
            guard.clear();
        }

        let url_q = if mode == "gif" { "capture-gif" } else { "capture" };

        for (idx, screen) in screens.iter().enumerate() {
            let di = screen.display_info;
            let label = format!("overlay-{idx}");

            let payload = capture_screen_payload(screen)
                .map_err(|e| format!("capture screen {idx} err: {e}"))?;
            eprintln!(
                "[capture] screen {idx} id={} phys=({},{}) {}x{} scale={} primary={}",
                di.id, di.x, di.y, di.width, di.height, di.scale_factor, di.is_primary
            );

            {
                let mut guard = state
                    .pending_screenshots
                    .lock()
                    .map_err(|e| e.to_string())?;
                guard.insert(label.clone(), payload);
            }

            let overlay = WebviewWindowBuilder::new(
                &app,
                &label,
                WebviewUrl::App(format!("index.html?overlay={url_q}").into()),
            )
            .title("MarkShot Overlay")
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .shadow(false)
            .visible(false)
            .build()
            .map_err(|e| format!("overlay {idx} build err: {e}"))?;

            // モニタごとに物理座標で正確に配置（混在 DPI でもズレない）
            let _ = overlay.set_position(Position::Physical(PhysicalPosition::new(di.x, di.y)));
            let _ = overlay.set_size(Size::Physical(PhysicalSize::new(di.width, di.height)));
            let _ = overlay.show();
            if di.is_primary {
                let _ = overlay.set_focus();
            }
        }

        Ok(())
    };

    match run() {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("[capture] ERROR: {e} — restoring main window");
            close_overlays(&app);
            let _ = main.show();
            let _ = main.set_focus();
            Err(e)
        }
    }
}

/// 各オーバーレイ窓が読み込み完了時に呼ぶ。自窓ラベル宛にスクリーンショットを送る。
#[tauri::command]
fn overlay_ready(app: AppHandle, window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    let label = window.label().to_string();
    let payload = state
        .pending_screenshots
        .lock()
        .map_err(|e| e.to_string())?
        .get(&label)
        .cloned();
    match payload {
        Some(p) => {
            // ラベル別イベント名でブロードキャストし、対応する窓のみが受け取る。
            app.emit(&format!("overlay:screenshot:{label}"), &p)
                .map_err(|e| e.to_string())?;
            eprintln!("[capture] overlay_ready emitted to {label}");
        }
        None => eprintln!("[capture] overlay_ready: no pending screenshot for {label}"),
    }
    Ok(())
}

#[tauri::command]
fn overlay_cancel(app: AppHandle) -> Result<(), String> {
    close_overlays_and_restore_main(&app);
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
    auto_save: bool,
    save_dir: Option<String>,
    copy_to_clipboard: bool,
) -> Result<(), String> {
    let base64_part = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "invalid data url".to_string())?;
    let png_bytes = STANDARD.decode(base64_part).map_err(|e| e.to_string())?;

    if copy_to_clipboard {
        let dyn_img =
            screenshots::image::load_from_memory(&png_bytes).map_err(|e| e.to_string())?;
        let rgba = dyn_img.to_rgba8();
        let (w, h) = (rgba.width(), rgba.height());
        let rgba_bytes: Vec<u8> = rgba.into_raw();
        let img = tauri::image::Image::new(&rgba_bytes, w, h);
        app.clipboard()
            .write_image(&img)
            .map_err(|e| e.to_string())?;
    }

    let saved_path = if auto_save {
        match save_bytes_to_disk(&app, save_dir.as_deref(), &filename, &png_bytes) {
            Ok(p) => {
                eprintln!("[capture] saved png to {}", p);
                Some(p)
            }
            Err(e) => {
                eprintln!("[capture] save failed: {e}");
                None
            }
        }
    } else {
        None
    };

    close_overlays_and_restore_main(&app);
    if let Some(main) = app.get_webview_window("main") {
        let payload = CaptureCompletePayload {
            data_url,
            saved_path,
        };
        let _ = main.emit("capture:complete", &payload);
    }
    Ok(())
}

fn process_png_output(
    app: &AppHandle,
    data_url: &str,
    filename: &str,
    auto_save: bool,
    save_dir: Option<&str>,
    copy_to_clipboard: bool,
) -> Result<Option<String>, String> {
    let base64_part = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "invalid data url".to_string())?;
    let png_bytes = STANDARD.decode(base64_part).map_err(|e| e.to_string())?;

    if copy_to_clipboard {
        let dyn_img =
            screenshots::image::load_from_memory(&png_bytes).map_err(|e| e.to_string())?;
        let rgba = dyn_img.to_rgba8();
        let (w, h) = (rgba.width(), rgba.height());
        let rgba_bytes: Vec<u8> = rgba.into_raw();
        let img = tauri::image::Image::new(&rgba_bytes, w, h);
        app.clipboard()
            .write_image(&img)
            .map_err(|e| e.to_string())?;
    }

    if auto_save {
        match save_bytes_to_disk(app, save_dir, filename, &png_bytes) {
            Ok(p) => Ok(Some(p)),
            Err(e) => {
                eprintln!("[output] save failed: {e}");
                Ok(None)
            }
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn save_annotated_image(
    app: AppHandle,
    data_url: String,
    filename: String,
    auto_save: bool,
    save_dir: Option<String>,
    copy_to_clipboard: bool,
) -> Result<Option<String>, String> {
    process_png_output(
        &app,
        &data_url,
        &filename,
        auto_save,
        save_dir.as_deref(),
        copy_to_clipboard,
    )
}

fn save_bytes_to_disk(
    app: &AppHandle,
    save_dir: Option<&str>,
    filename: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let dir = match save_dir {
        Some(custom) if !custom.trim().is_empty() => std::path::PathBuf::from(custom),
        _ => app
            .path()
            .picture_dir()
            .map_err(|e| format!("picture_dir err: {e}"))?
            .join("MarkShot"),
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir err: {e}"))?;
    let path = dir.join(filename);
    std::fs::write(&path, bytes).map_err(|e| format!("write err: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn overlay_bring_to_front(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let _ = window.set_focus();
    let _ = app; // 互換のため引数は残す
    Ok(())
}

#[tauri::command]
fn overlay_screenshot_loaded() {}

#[tauri::command]
fn overlay_painted() {}

// ---------------------------------------------------------------------------
// GIF 録画（Rust ネイティブ：選択範囲を一定 FPS で連写し GIF にエンコード）
// ---------------------------------------------------------------------------

const GIF_FPS: u32 = 10;
const GIF_MAX_SECONDS: u32 = 60;
const GIF_MAX_WIDTH: u32 = 800;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GifCompletePayload {
    data_url: String,
    saved_path: Option<String>,
}

/// GIF モードで範囲確定したときに呼ばれる。録画を開始する。
/// x, y, width, height は当該モニタ内のローカル物理ピクセル座標。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn overlay_gif_region_selected(
    app: AppHandle,
    monitor_id: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
    filename: String,
    auto_save: bool,
    save_dir: Option<String>,
) -> Result<(), String> {
    close_overlays(&app);
    // メイン窓は隠したまま録画する（範囲外に出るので写り込まない）
    std::thread::sleep(Duration::from_millis(300));

    // 失敗時は必ずメイン窓を復帰させてエラーを通知する
    let fail = |app: &AppHandle, msg: String| -> Result<(), String> {
        close_overlays_and_restore_main(app);
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.emit("gif:error", msg.clone());
        }
        Err(msg)
    };

    if width < 2 || height < 2 {
        return fail(&app, "録画範囲が小さすぎます".into());
    }

    let screens = match Screen::all() {
        Ok(s) => s,
        Err(e) => return fail(&app, format!("Screen::all err: {e}")),
    };
    let screen = match screens.iter().find(|s| s.display_info.id == monitor_id) {
        Some(s) => *s,
        None => return fail(&app, "対象モニタが見つかりません".into()),
    };
    let di = screen.display_info;

    // --- 録画範囲を示すボーダーオーバーレイ（クリックスルー・透明）---
    let overlay_hash = format!("#/recording-overlay/{x}/{y}/{width}/{height}/{scale_factor}");
    if let Ok(overlay) = WebviewWindowBuilder::new(
        &app,
        "recording-overlay",
        WebviewUrl::App(format!("index.html{overlay_hash}").into()),
    )
    .title("MarkShot Recording")
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .transparent(true)
    .shadow(false)
    .visible(false)
    .build()
    {
        let _ = overlay.set_position(Position::Physical(PhysicalPosition::new(di.x, di.y)));
        let _ = overlay.set_size(Size::Physical(PhysicalSize::new(di.width, di.height)));
        let _ = overlay.set_ignore_cursor_events(true);
        let _ = overlay.show();
    }

    // --- 録画コントロール窓（タイマー＋停止/一時停止）。録画範囲の外側に置く ---
    spawn_recording_control(&app, &di, x, y, width, height);

    // --- 録画スレッド開始 ---
    let stop = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let mut lock_ok = false;
    {
        let state = app.state::<AppState>();
        let guard_result = state.recording.lock();
        if let Ok(mut guard) = guard_result {
            *guard = Some(RecordingState {
                stop: stop.clone(),
                paused: paused.clone(),
            });
            lock_ok = true;
        }
    }
    if !lock_ok {
        for label in ["recording-control", "recording-overlay"] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.close();
            }
        }
        return fail(&app, "recording state lock err".into());
    }

    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = record_gif(screen, x, y, width, height, &stop, &paused);

        // 録画状態をクリア
        let state = app2.state::<AppState>();
        if let Ok(mut g) = state.recording.lock() {
            *g = None;
        }

        // 録画用の窓を閉じてメインを復帰
        for label in ["recording-control", "recording-overlay"] {
            if let Some(w) = app2.get_webview_window(label) {
                let _ = w.close();
            }
        }
        if let Some(main) = app2.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }

        match result {
            Ok(bytes) => {
                if bytes.len() < 64 {
                    if let Some(main) = app2.get_webview_window("main") {
                        let _ = main.emit("gif:error", "録画フレームがありません");
                    }
                    return;
                }
                let saved_path = if auto_save {
                    save_bytes_to_disk(&app2, save_dir.as_deref(), &filename, &bytes).ok()
                } else {
                    None
                };
                let data_url = format!("data:image/gif;base64,{}", STANDARD.encode(&bytes));
                if let Some(main) = app2.get_webview_window("main") {
                    let _ = main.emit(
                        "gif:complete",
                        &GifCompletePayload {
                            data_url,
                            saved_path,
                        },
                    );
                }
            }
            Err(e) => {
                eprintln!("[gif] record error: {e}");
                if let Some(main) = app2.get_webview_window("main") {
                    let _ = main.emit("gif:error", e);
                }
            }
        }
    });

    Ok(())
}

/// 録画コントロール窓を録画範囲の外（下、無理なら上）に生成する。
fn spawn_recording_control(
    app: &AppHandle,
    di: &screenshots::display_info::DisplayInfo,
    x: i32,
    y: i32,
    _width: u32,
    height: u32,
) {
    let sf = di.scale_factor.max(0.1) as f64;
    let ctrl_w_logical = 290.0_f64;
    let ctrl_h_logical = 52.0_f64;
    let ctrl_h_phys = (ctrl_h_logical * sf) as i32;
    let margin = (12.0 * sf) as i32;

    // 物理座標で配置位置を決める
    let region_bottom = di.y + y + height as i32;
    let region_top = di.y + y;
    let monitor_bottom = di.y + di.height as i32;

    let pos_y = if region_bottom + margin + ctrl_h_phys <= monitor_bottom {
        region_bottom + margin
    } else if region_top - margin - ctrl_h_phys >= di.y {
        region_top - margin - ctrl_h_phys
    } else {
        // 範囲がモニタをほぼ覆う場合は最下部に重ねる
        monitor_bottom - ctrl_h_phys - margin
    };
    let pos_x = di.x + x; // 範囲左端に揃える

    if let Ok(ctrl) = WebviewWindowBuilder::new(
        app,
        "recording-control",
        WebviewUrl::App("index.html#/recording-control".into()),
    )
    .title("MarkShot")
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .transparent(true)
    .shadow(false)
    .visible(false)
    .build()
    {
        let _ = ctrl.set_position(Position::Physical(PhysicalPosition::new(pos_x, pos_y)));
        let _ = ctrl.set_size(Size::Logical(LogicalSize::new(ctrl_w_logical, ctrl_h_logical)));
        let _ = ctrl.show();
        let _ = ctrl.set_focus();
    }
}

/// 選択範囲を一定 FPS で連写して GIF バイト列にエンコードする（呼び出しスレッドで実行）。
fn record_gif(
    screen: Screen,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    stop: &AtomicBool,
    paused: &AtomicBool,
) -> Result<Vec<u8>, String> {
    // 出力サイズ（横幅 GIF_MAX_WIDTH を上限に縮小）
    let (out_w, out_h) = if width > GIF_MAX_WIDTH {
        let scale = GIF_MAX_WIDTH as f64 / width as f64;
        (GIF_MAX_WIDTH, ((height as f64) * scale).round().max(1.0) as u32)
    } else {
        (width, height)
    };

    let max_frames = GIF_FPS * GIF_MAX_SECONDS;
    let frame_delay = Duration::from_millis((1000 / GIF_FPS) as u64);
    let gif_delay_cs = (100 / GIF_FPS) as u16; // 1/100 秒単位

    let mut buf: Vec<u8> = Vec::new();
    {
        let mut encoder = gif::Encoder::new(&mut buf, out_w as u16, out_h as u16, &[])
            .map_err(|e| format!("gif encoder err: {e}"))?;
        encoder
            .set_repeat(gif::Repeat::Infinite)
            .map_err(|e| e.to_string())?;

        let mut frames = 0u32;
        while !stop.load(Ordering::Acquire) && frames < max_frames {
            if paused.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            let tick_start = Instant::now();

            let captured = screen
                .capture_area(x, y, width, height)
                .map_err(|e| format!("capture_area err: {e}"))?;

            let mut raw = if out_w != width || out_h != height {
                screenshots::image::imageops::resize(&captured, out_w, out_h, FilterType::Triangle)
                    .into_raw()
            } else {
                captured.into_raw()
            };

            let mut frame =
                gif::Frame::from_rgba_speed(out_w as u16, out_h as u16, &mut raw, 10);
            frame.delay = gif_delay_cs;
            encoder
                .write_frame(&frame)
                .map_err(|e| format!("write_frame err: {e}"))?;
            frames += 1;

            let elapsed = tick_start.elapsed();
            if elapsed < frame_delay {
                std::thread::sleep(frame_delay - elapsed);
            }
        }
        eprintln!("[gif] captured {frames} frames ({out_w}x{out_h})");
    } // encoder drop でトレーラ書き出し

    Ok(buf)
}

#[tauri::command]
fn stop_gif_recording(state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(g) = state.recording.lock() {
        if let Some(r) = g.as_ref() {
            r.stop.store(true, Ordering::Release);
        }
    }
    Ok(())
}

#[tauri::command]
fn pause_gif_recording(state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(g) = state.recording.lock() {
        if let Some(r) = g.as_ref() {
            r.paused.store(true, Ordering::Release);
        }
    }
    Ok(())
}

#[tauri::command]
fn resume_gif_recording(state: State<'_, AppState>) -> Result<(), String> {
    if let Ok(g) = state.recording.lock() {
        if let Some(r) = g.as_ref() {
            r.paused.store(false, Ordering::Release);
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState {
            pending_screenshots: Mutex::new(HashMap::new()),
            recording: Mutex::new(None),
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
            save_annotated_image,
            overlay_gif_region_selected,
            stop_gif_recording,
            pause_gif_recording,
            resume_gif_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
