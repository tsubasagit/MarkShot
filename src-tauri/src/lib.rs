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

/// 録画した GIF（data URL）を手動でディスクに保存する。保存先パスを返す。
#[tauri::command]
async fn save_gif(
    app: AppHandle,
    data_url: String,
    filename: String,
    save_dir: Option<String>,
) -> Result<String, String> {
    let base64_part = data_url
        .strip_prefix("data:image/gif;base64,")
        .ok_or_else(|| "invalid gif data url".to_string())?;
    let bytes = STANDARD.decode(base64_part).map_err(|e| e.to_string())?;
    save_bytes_to_disk(&app, save_dir.as_deref(), &filename, &bytes)
}

/// 保存先フォルダを決める。設定が空なら Pictures/MarkShot。
fn resolve_save_dir(app: &AppHandle, save_dir: Option<&str>) -> Result<std::path::PathBuf, String> {
    match save_dir {
        Some(custom) if !custom.trim().is_empty() => Ok(std::path::PathBuf::from(custom)),
        _ => Ok(app
            .path()
            .picture_dir()
            .map_err(|e| format!("picture_dir err: {e}"))?
            .join("MarkShot")),
    }
}

fn save_bytes_to_disk(
    app: &AppHandle,
    save_dir: Option<&str>,
    filename: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let dir = resolve_save_dir(app, save_dir)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir err: {e}"))?;
    let path = dir.join(filename);
    std::fs::write(&path, bytes).map_err(|e| format!("write err: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// 現在の保存先フォルダをエクスプローラー（mac は Finder）で開く。開いたパスを返す。
/// 既定の Pictures/MarkShot は初回保存まで存在しないので、無ければ作ってから開く。
#[tauri::command]
fn open_save_dir(app: AppHandle, save_dir: Option<String>) -> Result<String, String> {
    let dir = resolve_save_dir(&app, save_dir.as_deref())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir err: {e}"))?;
    #[cfg(windows)]
    let opener = "explorer";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = "xdg-open";
    // explorer.exe は開けても終了コード 1 を返すので、終了を待たず起動できたかだけ見る。
    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("open dir err: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
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
/// これを超える幅の範囲だけ縮小する。以前は 800 で、高 DPI 画面では文字がつぶれていた。
const GIF_MAX_WIDTH: u32 = 1920;
/// 減色（NeuQuant）で学習に使う画素数の目安。範囲が広いほど間引きを強くして速度を保つ。
const GIF_QUANT_SAMPLE_BUDGET: usize = 150_000;
/// キャプチャ→エンコード間に溜められるフレーム数（1 枚 = 幅×高さ×4 バイト）。
const GIF_FRAME_QUEUE: usize = 8;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GifCompletePayload {
    data_url: String,
    saved_path: Option<String>,
    /// 手動「保存」用に提案するファイル名（自動保存しなかった場合に使用）。
    filename: String,
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

    // 録画コントロール窓（タイマー＋停止/一時停止）はカウントダウン後に生成する。

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
        // --- 録画開始前のカウントダウン（3 → 2 → 1）---
        // 赤枠オーバーレイに数字を表示し、本録画の前に間を置くことで
        // 範囲確定直後の余計な操作が GIF に写り込まないようにする。
        // WebView の listen 登録が間に合うよう、最初に少しだけ待つ。
        std::thread::sleep(Duration::from_millis(300));
        for n in (1..=3).rev() {
            if let Some(ov) = app2.get_webview_window("recording-overlay") {
                let _ = ov.emit("gif:countdown", n);
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        // 0 を送って数字を消す
        if let Some(ov) = app2.get_webview_window("recording-overlay") {
            let _ = ov.emit("gif:countdown", 0);
        }

        // カウントダウン後に録画コントロール窓を出し、タイマーを録画と同期させる。
        spawn_recording_control(&app2, &di, x, y, width, height);

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
                            filename: filename.clone(),
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

/// 現在のマウスカーソルを、キャプチャ済みフレーム（RGBA）に合成する。
///
/// `screenshots` クレートの `capture_area` はカーソルを含まないため、Win32 から
/// 実際のカーソル画像を取得して描き込む。透過の正確な復元のために、黒背景・白背景へ
/// それぞれ `DrawIconEx` し、その差分から不透明度を求めて合成する（モノクロ／カラー／
/// 半透明いずれのカーソルでも破綻しない定番手法）。
///
/// `region_left` / `region_top` はキャプチャ範囲左上の「仮想デスクトップ物理座標」。
#[cfg(windows)]
fn composite_cursor(
    frame: &mut screenshots::image::RgbaImage,
    region_left: i32,
    region_top: i32,
) {
    use core::ffi::c_void;
    use core::mem::size_of;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetObjectW, ReleaseDC,
        SelectObject, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, HICON,
        ICONINFO,
    };

    unsafe {
        let mut ci = CURSORINFO {
            cbSize: size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        if GetCursorInfo(&mut ci).is_err() {
            return;
        }
        // カーソル非表示中（動画再生中など）は描かない。
        if (ci.flags.0 & CURSOR_SHOWING.0) == 0 || ci.hCursor.is_invalid() {
            return;
        }
        let hicon = HICON(ci.hCursor.0);

        let mut ii = ICONINFO::default();
        if GetIconInfo(hicon, &mut ii).is_err() {
            return;
        }
        // GetIconInfo が生成したビットマップは必ず解放する。
        let free_ii = |ii: &ICONINFO| {
            if !ii.hbmColor.is_invalid() {
                let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
            }
            if !ii.hbmMask.is_invalid() {
                let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
            }
        };

        // カーソルの実寸（高 DPI では 48/64px などになる）をマスクビットマップから得る。
        let mut bm = BITMAP::default();
        let got = GetObjectW(
            HGDIOBJ(ii.hbmMask.0),
            size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut c_void),
        );
        let (cw, ch) = if got != 0 {
            let w = bm.bmWidth.max(1);
            // モノクロカーソルはマスクが AND/XOR の縦 2 枚組なので高さは半分。
            let h = if ii.hbmColor.is_invalid() {
                (bm.bmHeight / 2).max(1)
            } else {
                bm.bmHeight.max(1)
            };
            (w, h)
        } else {
            (32, 32)
        };

        // ホットスポット補正後の、フレーム内ローカル左上座標。
        let left = ci.ptScreenPos.x - ii.xHotspot as i32 - region_left;
        let top = ci.ptScreenPos.y - ii.yHotspot as i32 - region_top;

        let fw = frame.width() as i32;
        let fh = frame.height() as i32;
        if left >= fw || top >= fh || left + cw <= 0 || top + ch <= 0 {
            free_ii(&ii);
            return;
        }

        // カーソルサイズの 32bpp トップダウン DIB を 1 枚用意し、黒・白 2 回描く。
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: cw,
            biHeight: -ch, // 負 = トップダウン
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        };

        let screen_dc = GetDC(None);
        let mem_dc = CreateCompatibleDC(Some(screen_dc));
        let mut bits_ptr: *mut c_void = core::ptr::null_mut();
        let dib = CreateDIBSection(Some(mem_dc), &bmi, DIB_RGB_COLORS, &mut bits_ptr, None, 0);
        let _ = ReleaseDC(None, screen_dc);
        let dib = match dib {
            Ok(d) if !bits_ptr.is_null() => d,
            _ => {
                let _ = DeleteDC(mem_dc);
                free_ii(&ii);
                return;
            }
        };
        let old = SelectObject(mem_dc, HGDIOBJ(dib.0));

        let npix = (cw * ch) as usize;
        let bits = core::slice::from_raw_parts_mut(bits_ptr as *mut u8, npix * 4);

        // 黒背景に描いて控える（= プリマルチプライ済み前景色）。
        bits.iter_mut().for_each(|b| *b = 0);
        let _ = DrawIconEx(mem_dc, 0, 0, hicon, cw, ch, 0, None, DI_NORMAL);
        let on_black = bits.to_vec();

        // 白背景に描く（現在の DIB がそのまま白背景の結果になる）。
        bits.iter_mut().for_each(|b| *b = 0xFF);
        let _ = DrawIconEx(mem_dc, 0, 0, hicon, cw, ch, 0, None, DI_NORMAL);
        let on_white = &*bits;

        // 各画素: white-black = (1-α)*255。new = black + dst*(white-black)/255。
        // （black はプリマルチ前景なので over 合成がこの 1 式で済む）DIB は BGRA 順。
        for cy in 0..ch {
            let fy = top + cy;
            if fy < 0 || fy >= fh {
                continue;
            }
            for cx in 0..cw {
                let fx = left + cx;
                if fx < 0 || fx >= fw {
                    continue;
                }
                let idx = ((cy * cw + cx) * 4) as usize;
                let inv_b = (on_white[idx] as i32 - on_black[idx] as i32).clamp(0, 255);
                let inv_g = (on_white[idx + 1] as i32 - on_black[idx + 1] as i32).clamp(0, 255);
                let inv_r = (on_white[idx + 2] as i32 - on_black[idx + 2] as i32).clamp(0, 255);
                let px = frame.get_pixel_mut(fx as u32, fy as u32);
                let dr = px.0[0] as i32;
                let dg = px.0[1] as i32;
                let db = px.0[2] as i32;
                px.0[0] = (on_black[idx + 2] as i32 + dr * inv_r / 255).clamp(0, 255) as u8;
                px.0[1] = (on_black[idx + 1] as i32 + dg * inv_g / 255).clamp(0, 255) as u8;
                px.0[2] = (on_black[idx] as i32 + db * inv_b / 255).clamp(0, 255) as u8;
                // アルファ（px.0[3]）は不透明のまま維持。
            }
        }

        SelectObject(mem_dc, old);
        let _ = DeleteObject(HGDIOBJ(dib.0));
        let _ = DeleteDC(mem_dc);
        free_ii(&ii);
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

    // キャプチャ範囲左上の仮想デスクトップ物理座標（カーソル合成の基準）。
    let abs_left = screen.display_info.x + x;
    let abs_top = screen.display_info.y + y;

    // 減色は重いので別スレッドで行い、キャプチャの間隔を乱さない。
    let (tx, rx) = std::sync::mpsc::sync_channel::<(Vec<u8>, Duration)>(GIF_FRAME_QUEUE);
    let encoder_thread =
        std::thread::spawn(move || encode_gif_frames(rx, out_w, out_h, frame_delay));

    // 一時停止中の時間を除いた録画時刻（GIF の表示時間はこれの差から決める）。
    let start = Instant::now();
    let mut paused_total = Duration::ZERO;
    let mut pause_started: Option<Instant> = None;

    let mut frames = 0u32;
    let mut capture_err: Option<String> = None;
    while !stop.load(Ordering::Acquire) && frames < max_frames {
        if paused.load(Ordering::Acquire) {
            pause_started.get_or_insert_with(Instant::now);
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        if let Some(p) = pause_started.take() {
            paused_total += p.elapsed();
        }
        let tick_start = Instant::now();
        let t = tick_start.duration_since(start).saturating_sub(paused_total);

        let mut captured = match screen.capture_area(x, y, width, height) {
            Ok(c) => c,
            Err(e) => {
                capture_err = Some(format!("capture_area err: {e}"));
                break;
            }
        };

        // OS カーソルはキャプチャに含まれないため、リサイズ前のフレームに描き込む。
        #[cfg(windows)]
        composite_cursor(&mut captured, abs_left, abs_top);

        let raw = if out_w != width || out_h != height {
            screenshots::image::imageops::resize(&captured, out_w, out_h, FilterType::Lanczos3)
                .into_raw()
        } else {
            captured.into_raw()
        };

        if tx.send((raw, t)).is_err() {
            break; // エンコーダ側が失敗して終了している
        }
        frames += 1;

        let elapsed = tick_start.elapsed();
        if elapsed < frame_delay {
            std::thread::sleep(frame_delay - elapsed);
        }
    }
    drop(tx);
    eprintln!("[gif] captured {frames} frames ({out_w}x{out_h})");

    let encoded = encoder_thread
        .join()
        .map_err(|_| "gif encoder thread panicked".to_string())?;
    if let Some(e) = capture_err {
        return Err(e);
    }
    encoded
}

/// 受け取ったフレームを GIF にエンコードする。
/// - 前フレームから変わった矩形だけを書く（同じ画面が続く間はフレームを足さず表示時間を延ばす）
/// - 256 色以内の範囲は無劣化のパレット、それを超える範囲だけ NeuQuant で減色する
fn encode_gif_frames(
    rx: std::sync::mpsc::Receiver<(Vec<u8>, Duration)>,
    w: u32,
    h: u32,
    frame_delay: Duration,
) -> Result<Vec<u8>, String> {
    // 表示時間は 1/100 秒単位。累積時刻を丸めてから差を取り、誤差を溜めない。
    let cs = |t: Duration| (t.as_millis() / 10) as u64;

    let mut buf: Vec<u8> = Vec::new();
    {
        let mut encoder = gif::Encoder::new(&mut buf, w as u16, h as u16, &[])
            .map_err(|e| format!("gif encoder err: {e}"))?;
        encoder
            .set_repeat(gif::Repeat::Infinite)
            .map_err(|e| e.to_string())?;

        let mut prev: Option<Vec<u8>> = None;
        // 表示時間が次のフレーム到着まで決まらないので 1 枚持っておく。
        let mut pending: Option<(gif::Frame<'static>, Duration)> = None;
        let mut last_t = Duration::ZERO;
        let mut written = 0u32;

        let mut flush = |encoder: &mut gif::Encoder<&mut Vec<u8>>,
                         mut f: gif::Frame<'static>,
                         t0: Duration,
                         t1: Duration|
         -> Result<(), String> {
            // 1/100 秒以下はブラウザが 0.1 秒扱いにするため最低 2 にする。
            f.delay = (cs(t1).saturating_sub(cs(t0))).clamp(2, u16::MAX as u64) as u16;
            written += 1;
            encoder
                .write_frame(&f)
                .map_err(|e| format!("write_frame err: {e}"))
        };

        for (rgba, t) in rx {
            last_t = t;
            let rect = match &prev {
                None => Some((0, 0, w, h)),
                Some(p) => dirty_rect(p, &rgba, w, h),
            };
            let Some((rx0, ry0, rw, rh)) = rect else {
                continue; // 変化なし：前のフレームの表示時間を延ばすだけ
            };
            if let Some((f, t0)) = pending.take() {
                flush(&mut encoder, f, t0, t)?;
            }
            let mut sub = crop_rgba(&rgba, w, rx0, ry0, rw, rh);
            let px = (rw * rh) as usize;
            let speed = px.div_ceil(GIF_QUANT_SAMPLE_BUDGET).clamp(1, 30) as i32;
            let mut f = gif::Frame::from_rgba_speed(rw as u16, rh as u16, &mut sub, speed);
            f.left = rx0 as u16;
            f.top = ry0 as u16;
            f.dispose = gif::DisposalMethod::Keep;
            pending = Some((f, t));
            prev = Some(rgba);
        }
        if let Some((f, t0)) = pending.take() {
            flush(&mut encoder, f, t0, last_t + frame_delay)?;
        }
        eprintln!("[gif] encoded {written} frames");
    } // encoder drop でトレーラ書き出し

    Ok(buf)
}

/// 2 枚の RGBA フレームで画素が違う最小の矩形 (x, y, w, h)。同一なら None。
fn dirty_rect(a: &[u8], b: &[u8], w: u32, h: u32) -> Option<(u32, u32, u32, u32)> {
    let stride = (w * 4) as usize;
    let row = |y: u32| -> std::ops::Range<usize> {
        let s = y as usize * stride;
        s..s + stride
    };
    let differs = |y: u32| a[row(y)] != b[row(y)];
    let top = (0..h).find(|&y| differs(y))?;
    let bottom = (top..h).rev().find(|&y| differs(y)).unwrap_or(top);

    let px = |buf: &[u8], y: u32, x: u32| {
        let i = y as usize * stride + x as usize * 4;
        [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
    };
    let (mut left, mut right) = (w, 0u32);
    for y in top..=bottom {
        if let Some(x) = (0..left).find(|&x| px(a, y, x) != px(b, y, x)) {
            left = x;
        }
        if let Some(x) = (right..w).rev().find(|&x| px(a, y, x) != px(b, y, x)) {
            right = right.max(x);
        }
    }
    if left > right {
        return None;
    }
    Some((left, top, right - left + 1, bottom - top + 1))
}

/// RGBA フレームから矩形を切り出す。
fn crop_rgba(src: &[u8], src_w: u32, x: u32, y: u32, w: u32, h: u32) -> Vec<u8> {
    let stride = (src_w * 4) as usize;
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for row in y..y + h {
        let s = row as usize * stride + x as usize * 4;
        out.extend_from_slice(&src[s..s + (w * 4) as usize]);
    }
    out
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
            save_gif,
            open_save_dir,
            overlay_gif_region_selected,
            stop_gif_recording,
            pause_gif_recording,
            resume_gif_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod gif_tests {
    use super::*;

    fn solid(w: u32, h: u32, c: [u8; 4]) -> Vec<u8> {
        c.iter().copied().cycle().take((w * h * 4) as usize).collect()
    }

    #[test]
    fn dirty_rect_finds_changed_box() {
        let (w, h) = (20, 10);
        let a = solid(w, h, [255, 255, 255, 255]);
        assert_eq!(dirty_rect(&a, &a, w, h), None);
        let mut b = a.clone();
        for (x, y) in [(3u32, 2u32), (7, 5)] {
            let i = ((y * w + x) * 4) as usize;
            b[i] = 0;
        }
        assert_eq!(dirty_rect(&a, &b, w, h), Some((3, 2, 5, 4)));
    }

    /// 変化した矩形だけ書いても、デコード結果は元の画面と一致する（色数 256 以内なので無劣化）。
    #[test]
    fn encode_roundtrip_is_lossless_for_few_colors() {
        let (w, h) = (64u32, 32u32);
        let mut f1 = solid(w, h, [255, 255, 255, 255]);
        for x in 0..w {
            let i = ((10 * w + x) * 4) as usize;
            f1[i..i + 4].copy_from_slice(&[(x * 4) as u8, 0, 128, 255]);
        }
        let mut f2 = f1.clone();
        let i = ((20 * w + 30) * 4) as usize;
        f2[i..i + 4].copy_from_slice(&[0, 0, 0, 255]);

        let (tx, rx) = std::sync::mpsc::sync_channel(8);
        tx.send((f1.clone(), Duration::from_millis(0))).unwrap();
        tx.send((f1.clone(), Duration::from_millis(100))).unwrap(); // 同じ画面 → 足さない
        tx.send((f2.clone(), Duration::from_millis(200))).unwrap();
        drop(tx);
        let bytes = encode_gif_frames(rx, w, h, Duration::from_millis(100)).unwrap();

        let mut opts = gif::DecodeOptions::new();
        opts.set_color_output(gif::ColorOutput::RGBA);
        let mut dec = opts.read_info(std::io::Cursor::new(bytes)).unwrap();
        let mut canvas = vec![0u8; (w * h * 4) as usize];
        let mut delays = vec![];
        let mut canvases = vec![];
        while let Some(fr) = dec.read_next_frame().unwrap() {
            delays.push(fr.delay);
            for yy in 0..fr.height as u32 {
                for xx in 0..fr.width as u32 {
                    let s = ((yy * fr.width as u32 + xx) * 4) as usize;
                    let d = (((yy + fr.top as u32) * w + xx + fr.left as u32) * 4) as usize;
                    canvas[d..d + 4].copy_from_slice(&fr.buffer[s..s + 4]);
                }
            }
            canvases.push(canvas.clone());
        }
        assert_eq!(delays, vec![20, 10]);
        assert_eq!(canvases[0], f1);
        assert_eq!(canvases[1], f2);
    }
}

#[cfg(test)]
mod gif_live_bench {
    use super::*;

    /// 実画面を 3 秒録って GIF を書き出す（手動確認用）。
    /// MARKSHOT_GIF_OUT=出力先 cargo test --release --lib gif_live_bench -- --ignored --nocapture
    #[test]
    #[ignore]
    fn record_real_screen() {
        let screen = Screen::all().unwrap().into_iter().max_by_key(|s| s.display_info.width).unwrap();
        let (w, h) = (screen.display_info.width, screen.display_info.height);
        let stop = Arc::new(AtomicBool::new(false));
        let paused = AtomicBool::new(false);
        let s2 = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(3));
            s2.store(true, Ordering::Release);
        });
        let t = Instant::now();
        let bytes = record_gif(screen, 0, 0, w, h, &stop, &paused).unwrap();
        eprintln!("{w}x{h}: {} bytes, total {:?}", bytes.len(), t.elapsed());
        std::fs::write(std::env::var("MARKSHOT_GIF_OUT").unwrap(), bytes).unwrap();
    }

    /// 画面全体が毎フレーム変わる最悪ケース（スクロール）のエンコード速度。
    #[test]
    #[ignore]
    fn encode_full_change_speed() {
        let screen = Screen::all().unwrap().into_iter().max_by_key(|s| s.display_info.width).unwrap();
        let (w, h) = (screen.display_info.width, screen.display_info.height);
        let base = screen.capture_area(0, 0, w, h).unwrap().into_raw();
        let stride = (w * 4) as usize;
        let (tx, rx) = std::sync::mpsc::sync_channel(64);
        for i in 0..20u32 {
            let shift = (i * 7) as usize * stride;
            let mut f = base[shift..].to_vec();
            f.extend_from_slice(&base[..shift]);
            tx.send((f, Duration::from_millis(i as u64 * 100))).unwrap();
        }
        drop(tx);
        let t = Instant::now();
        let bytes = encode_gif_frames(rx, w, h, Duration::from_millis(100)).unwrap();
        if let Ok(out) = std::env::var("MARKSHOT_GIF_OUT") {
            std::fs::write(out, &bytes).unwrap();
        }
        eprintln!("full-change 20 frames {w}x{h}: {:?} ({:?}/frame), {} bytes", t.elapsed(), t.elapsed() / 20, bytes.len());
    }
}
