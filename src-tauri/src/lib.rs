/// Answers WebView2 camera/microphone permission requests from the app's own
/// origin so users never see the browser-style permission prompt. Windows'
/// global camera/microphone privacy settings still apply.
#[cfg(windows)]
fn auto_allow_media_permissions(window: &tauri::WebviewWindow) {
    use webview2_com::{
        take_pwstr,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        },
        PermissionRequestedEventHandler,
    };

    let result = window.with_webview(|webview| unsafe {
        let core = match webview.controller().CoreWebView2() {
            Ok(core) => core,
            Err(error) => {
                eprintln!("auto_allow_media_permissions: no CoreWebView2: {error}");
                return;
            }
        };

        let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
            let Some(args) = args else {
                return Ok(());
            };

            let mut uri = windows::core::PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            let own_origin = uri.starts_with("http://tauri.localhost")
                || uri.starts_with("https://tauri.localhost")
                || uri.starts_with("http://localhost:1420");

            let mut kind = Default::default();
            args.PermissionKind(&mut kind)?;

            if own_origin
                && (kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                    || kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE)
            {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }

            Ok(())
        }));

        let mut token = 0i64;
        if let Err(error) = core.add_PermissionRequested(&handler, &mut token) {
            eprintln!("auto_allow_media_permissions: could not register handler: {error}");
        }
    });

    if let Err(error) = result {
        eprintln!("auto_allow_media_permissions: with_webview failed: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    auto_allow_media_permissions(&window);
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
