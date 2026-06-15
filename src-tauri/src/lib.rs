use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::Path,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::Duration,
};

const FFL_STORE_DATA_LEN: usize = 96;
const SWITCH_CHAR_INFO_LEN: usize = 88;
const STUDIO_RAW_LEN: usize = 46;
const STUDIO_ENCODED_LEN: usize = 47;
const LEGACY_MIIC_DATA_LENS: &[usize] = &[104, 106, 108];
const CURRENT_MIIC_DATA_LEN: usize = 128;
const RENDERER_IMAGE_URL: &str = "http://127.0.0.1:5000/miis/image.png";
const RENDERER_GLB_URL: &str = "http://127.0.0.1:5000/miis/image.glb";
const ALL_FFL_EXPRESSIONS: &str = "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18";
const OUTPUT_SERVER_ADDR: &str = "127.0.0.1:49321";
const OUTPUT_FRAME_URL: &str = "http://127.0.0.1:49321/frame.jpg";
const OUTPUT_PNG_FRAME_URL: &str = "http://127.0.0.1:49321/frame.png";
const OUTPUT_MJPEG_URL: &str = "http://127.0.0.1:49321/stream.mjpeg";
const OUTPUT_TRANSPARENT_SOURCE_URL: &str = "http://127.0.0.1:49321/source-transparent.html";
const MJPEG_BOUNDARY: &str = "miituber-frame";
const OUTPUT_SERVER_HOME_MARKER: &str = "MiiTuber output server";

#[derive(serde::Serialize)]
struct RendererStatus {
    reachable: bool,
    message: String,
}

#[derive(Default)]
struct RenderCache {
    glb_by_hash: Mutex<HashMap<String, Vec<u8>>>,
    png_by_hash: Mutex<HashMap<String, Vec<u8>>>,
}

type SharedRenderCache = Arc<RenderCache>;

#[derive(Default)]
struct NativeCameraSinkState {
    device_installed: bool,
    raw_frame_sink_ready: bool,
    width: u32,
    height: u32,
    fps: u32,
    published_frame_count: u64,
    last_frame_bytes: usize,
}

impl NativeCameraSinkState {
    fn configure_output(&mut self, width: u32, height: u32, fps: u32) {
        self.width = width;
        self.height = height;
        self.fps = fps;
        self.published_frame_count = 0;
        self.last_frame_bytes = 0;
    }

    fn clear_output(&mut self) {
        self.width = 0;
        self.height = 0;
        self.fps = 0;
        self.published_frame_count = 0;
        self.last_frame_bytes = 0;
    }

    fn publish_raw_frame(
        &mut self,
        frame_index: u64,
        rgba_bytes: Option<&[u8]>,
    ) -> Result<(), String> {
        if !self.raw_frame_sink_ready {
            return Ok(());
        }

        let rgba_bytes = rgba_bytes.ok_or_else(|| {
            "Native camera sink is ready, but no raw RGBA frame was provided".to_string()
        })?;
        let expected_len = self.expected_raw_frame_len()?;
        if rgba_bytes.len() != expected_len {
            return Err(format!(
                "Native camera sink received {} raw RGBA bytes, expected {expected_len} for {}x{}",
                rgba_bytes.len(),
                self.width,
                self.height
            ));
        }

        self.published_frame_count = frame_index;
        self.last_frame_bytes = rgba_bytes.len();
        Ok(())
    }

    fn expected_raw_frame_len(&self) -> Result<usize, String> {
        if self.width == 0 || self.height == 0 || self.fps == 0 {
            return Err(
                "Native camera sink is ready, but no output format is configured".to_string(),
            );
        }

        expected_rgba_frame_len(self.width, self.height)
    }
}

type SharedNativeCameraSinkState = Arc<Mutex<NativeCameraSinkState>>;

#[derive(Default)]
struct VirtualCameraState {
    session: Mutex<VirtualCameraSession>,
    frames: OutputFrameStore,
}

#[derive(Default)]
struct OutputFrameStore {
    latest_jpeg: Mutex<Option<Vec<u8>>>,
    latest_png: Mutex<Option<Vec<u8>>>,
    latest_rgba: Mutex<Option<Vec<u8>>>,
}

impl OutputFrameStore {
    fn publish(
        &self,
        jpeg_bytes: Vec<u8>,
        png_bytes: Option<Vec<u8>>,
        rgba_bytes: Option<Vec<u8>>,
    ) -> Result<(), String> {
        *self
            .latest_jpeg
            .lock()
            .map_err(|_| "Latest output frame lock failed".to_string())? = Some(jpeg_bytes);
        *self
            .latest_png
            .lock()
            .map_err(|_| "Latest transparent output frame lock failed".to_string())? = png_bytes;
        *self
            .latest_rgba
            .lock()
            .map_err(|_| "Latest raw output frame lock failed".to_string())? = rgba_bytes;

        Ok(())
    }

    fn clear(&self) -> Result<(), String> {
        *self
            .latest_jpeg
            .lock()
            .map_err(|_| "Latest output frame lock failed".to_string())? = None;
        *self
            .latest_png
            .lock()
            .map_err(|_| "Latest transparent output frame lock failed".to_string())? = None;
        *self
            .latest_rgba
            .lock()
            .map_err(|_| "Latest raw output frame lock failed".to_string())? = None;

        Ok(())
    }

    fn latest_jpeg(&self) -> Option<Vec<u8>> {
        self.latest_jpeg.lock().ok().and_then(|frame| frame.clone())
    }

    fn latest_png(&self) -> Option<Vec<u8>> {
        self.latest_png.lock().ok().and_then(|frame| frame.clone())
    }

    #[cfg(test)]
    fn latest_rgba(&self) -> Option<Vec<u8>> {
        self.latest_rgba.lock().ok().and_then(|frame| frame.clone())
    }
}

#[derive(Default)]
struct VirtualCameraSession {
    running: bool,
    width: u32,
    height: u32,
    fps: u32,
    frame_count: u64,
    last_frame_bytes: usize,
    last_rgba_frame_bytes: usize,
    frame_url: String,
    png_frame_url: String,
    mjpeg_url: String,
    transparent_source_url: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartVirtualCameraRequest {
    width: u32,
    height: u32,
    fps: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishVirtualCameraFrameRequest {
    width: u32,
    height: u32,
    fps: u32,
    frame_index: u64,
    jpeg_bytes: Vec<u8>,
    png_bytes: Option<Vec<u8>>,
    rgba_bytes: Option<Vec<u8>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VirtualCameraStatus {
    running: bool,
    supported: bool,
    obs_detected: bool,
    message: String,
    width: u32,
    height: u32,
    fps: u32,
    frame_count: u64,
    last_frame_bytes: usize,
    last_rgba_frame_bytes: usize,
    frame_url: String,
    png_frame_url: String,
    mjpeg_url: String,
    transparent_source_url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCameraStatus {
    platform_supported: bool,
    device_installed: bool,
    raw_frame_sink_ready: bool,
    width: u32,
    height: u32,
    fps: u32,
    published_frame_count: u64,
    last_frame_bytes: usize,
    device_name: String,
    message: String,
}

type SharedVirtualCameraState = Arc<VirtualCameraState>;

static OUTPUT_SERVER_STARTED: OnceLock<()> = OnceLock::new();

#[derive(Debug)]
struct RendererPayload {
    bytes: Vec<u8>,
    verify_char_info: bool,
}

#[tauri::command]
async fn render_mii_png(
    mii_bytes: Vec<u8>,
    cache: tauri::State<'_, SharedRenderCache>,
) -> Result<Vec<u8>, String> {
    let renderer_payload = normalize_mii_data_for_renderer(&mii_bytes)?;
    let cache_key = renderer_cache_key(&renderer_payload);

    if let Some(cached_png) = cache
        .png_by_hash
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())?
        .get(&cache_key)
        .cloned()
    {
        println!(
            "render_mii_png: cache hit input_len={} renderer_len={} verify_char_info={} sha256={cache_key}",
            mii_bytes.len(),
            renderer_payload.bytes.len(),
            renderer_payload.verify_char_info
        );
        return Ok(cached_png);
    }

    let hex_data = hex_encode(&renderer_payload.bytes);
    let verify_char_info = if renderer_payload.verify_char_info {
        "1"
    } else {
        "0"
    };
    println!(
        "render_mii_png: requesting PNG input_len={} renderer_len={} verify_char_info={} sha256={cache_key} url={RENDERER_IMAGE_URL}",
        mii_bytes.len(),
        renderer_payload.bytes.len(),
        renderer_payload.verify_char_info
    );

    let client = reqwest::Client::new();
    let response = client
        .get(RENDERER_IMAGE_URL)
        .query(&[
            ("data", hex_data.as_str()),
            ("verifyCharInfo", verify_char_info),
        ])
        .send()
        .await
        .map_err(|error| format!("Could not reach FFL renderer on port 5000: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|error| format!("Could not read renderer error body: {error}"));
        eprintln!(
            "render_mii_png: renderer rejected request input_len={} renderer_len={} sha256={cache_key} status={status} body={body}",
            mii_bytes.len(),
            renderer_payload.bytes.len()
        );

        return Err(format!(
            "FFL renderer rejected the avatar data with HTTP {status}. Renderer said: {}",
            compact_error_body(&body)
        ));
    }

    let png_bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read renderer response: {error}"))?
        .to_vec();

    if !png_bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        eprintln!(
            "render_mii_png: renderer returned non-PNG input_len={} renderer_len={} sha256={cache_key} response_bytes={}",
            mii_bytes.len(),
            renderer_payload.bytes.len(),
            png_bytes.len()
        );
        return Err("Renderer response was not a PNG image".to_string());
    }

    println!(
        "render_mii_png: renderer returned PNG input_len={} renderer_len={} sha256={cache_key} response_bytes={}",
        mii_bytes.len(),
        renderer_payload.bytes.len(),
        png_bytes.len()
    );

    cache
        .png_by_hash
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())?
        .insert(cache_key, png_bytes.clone());

    Ok(png_bytes)
}

#[tauri::command]
async fn render_mii_glb(
    mii_bytes: Vec<u8>,
    cache: tauri::State<'_, SharedRenderCache>,
) -> Result<Vec<u8>, String> {
    let renderer_payload = normalize_mii_data_for_renderer(&mii_bytes)?;
    let cache_key = renderer_cache_key(&renderer_payload);

    if let Some(cached_glb) = cache
        .glb_by_hash
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())?
        .get(&cache_key)
        .cloned()
    {
        println!(
            "render_mii_glb: cache hit input_len={} renderer_len={} verify_char_info={} sha256={cache_key}",
            mii_bytes.len(),
            renderer_payload.bytes.len(),
            renderer_payload.verify_char_info
        );
        return Ok(cached_glb);
    }

    let glb_bytes = fetch_renderer_bytes(
        RENDERER_GLB_URL,
        &renderer_payload,
        &[
            ("expression", ALL_FFL_EXPRESSIONS),
            ("shaderType", "wiiu"),
            ("type", "face"),
            ("width", "512"),
            ("height", "512"),
        ],
        mii_bytes.len(),
        "GLB",
        &cache_key,
    )
    .await?;

    if !glb_bytes.starts_with(b"glTF") {
        eprintln!(
            "render_mii_glb: renderer returned non-GLB input_len={} renderer_len={} sha256={cache_key} response_bytes={}",
            mii_bytes.len(),
            renderer_payload.bytes.len(),
            glb_bytes.len()
        );
        return Err("Renderer response was not a GLB model".to_string());
    }

    println!(
        "render_mii_glb: renderer returned GLB input_len={} renderer_len={} sha256={cache_key} response_bytes={}",
        mii_bytes.len(),
        renderer_payload.bytes.len(),
        glb_bytes.len()
    );

    cache
        .glb_by_hash
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())?
        .insert(cache_key, glb_bytes.clone());

    Ok(glb_bytes)
}

#[tauri::command]
async fn check_renderer_status() -> RendererStatus {
    let client = reqwest::Client::new();
    let result = client
        .get(RENDERER_IMAGE_URL)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;

    match result {
        Ok(response) => RendererStatus {
            reachable: true,
            message: format!(
                "FFL renderer is reachable on port 5000 ({})",
                response.status()
            ),
        },
        Err(error) => RendererStatus {
            reachable: false,
            message: format!("FFL renderer is not reachable on port 5000: {error}"),
        },
    }
}

#[tauri::command]
async fn start_virtual_camera(
    request: StartVirtualCameraRequest,
    state: tauri::State<'_, SharedVirtualCameraState>,
    native_sink: tauri::State<'_, SharedNativeCameraSinkState>,
) -> Result<VirtualCameraStatus, String> {
    validate_output_settings(request.width, request.height, request.fps)?;
    ensure_output_server_ready()?;

    start_output_session(request, &state, &native_sink)
}

fn start_output_session(
    request: StartVirtualCameraRequest,
    state: &SharedVirtualCameraState,
    native_sink: &SharedNativeCameraSinkState,
) -> Result<VirtualCameraStatus, String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "Virtual camera state lock failed".to_string())?;
    session.running = true;
    session.width = request.width;
    session.height = request.height;
    session.fps = request.fps;
    session.frame_count = 0;
    session.last_frame_bytes = 0;
    session.last_rgba_frame_bytes = 0;
    session.frame_url = OUTPUT_FRAME_URL.to_string();
    session.png_frame_url = OUTPUT_PNG_FRAME_URL.to_string();
    session.mjpeg_url = OUTPUT_MJPEG_URL.to_string();
    session.transparent_source_url = OUTPUT_TRANSPARENT_SOURCE_URL.to_string();
    native_sink
        .lock()
        .map_err(|_| "Native camera sink state lock failed".to_string())?
        .configure_output(request.width, request.height, request.fps);
    clear_latest_output_frame(&state)?;

    Ok(virtual_camera_status_from_session(&session))
}

#[tauri::command]
async fn stop_virtual_camera(
    state: tauri::State<'_, SharedVirtualCameraState>,
    native_sink: tauri::State<'_, SharedNativeCameraSinkState>,
) -> Result<VirtualCameraStatus, String> {
    stop_output_session(&state, &native_sink)
}

fn stop_output_session(
    state: &SharedVirtualCameraState,
    native_sink: &SharedNativeCameraSinkState,
) -> Result<VirtualCameraStatus, String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "Virtual camera state lock failed".to_string())?;
    session.running = false;
    session.frame_count = 0;
    session.last_frame_bytes = 0;
    session.last_rgba_frame_bytes = 0;
    native_sink
        .lock()
        .map_err(|_| "Native camera sink state lock failed".to_string())?
        .clear_output();
    clear_latest_output_frame(&state)?;

    Ok(virtual_camera_status_from_session(&session))
}

#[tauri::command]
async fn get_virtual_camera_status(
    state: tauri::State<'_, SharedVirtualCameraState>,
) -> Result<VirtualCameraStatus, String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "Virtual camera state lock failed".to_string())?;

    Ok(virtual_camera_status_from_session(&session))
}

#[tauri::command]
async fn get_native_camera_status(
    native_sink: tauri::State<'_, SharedNativeCameraSinkState>,
) -> Result<NativeCameraStatus, String> {
    let native_sink = native_sink
        .lock()
        .map(|state| NativeCameraSinkState {
            device_installed: state.device_installed,
            raw_frame_sink_ready: state.raw_frame_sink_ready,
            width: state.width,
            height: state.height,
            fps: state.fps,
            published_frame_count: state.published_frame_count,
            last_frame_bytes: state.last_frame_bytes,
        })
        .map_err(|_| "Native camera sink state lock failed".to_string())?;

    Ok(native_camera_status_from_sink(&native_sink))
}

#[tauri::command]
async fn publish_virtual_camera_frame(
    request: PublishVirtualCameraFrameRequest,
    state: tauri::State<'_, SharedVirtualCameraState>,
    native_sink: tauri::State<'_, SharedNativeCameraSinkState>,
) -> Result<VirtualCameraStatus, String> {
    publish_output_frame(request, &state, &native_sink)
}

fn publish_output_frame(
    request: PublishVirtualCameraFrameRequest,
    state: &SharedVirtualCameraState,
    native_sink: &SharedNativeCameraSinkState,
) -> Result<VirtualCameraStatus, String> {
    if !is_jpeg_frame(&request.jpeg_bytes) {
        return Err("Output frame was not a JPEG image".to_string());
    }

    if let Some(png_bytes) = &request.png_bytes {
        if !is_png_frame(png_bytes) {
            return Err("Transparent output frame was not a PNG image".to_string());
        }
    }

    let mut session = state
        .session
        .lock()
        .map_err(|_| "Virtual camera state lock failed".to_string())?;

    if !session.running {
        return Err("Virtual camera output is not running".to_string());
    }

    if request.width != session.width || request.height != session.height {
        return Err(format!(
            "Output frame size changed from {}x{} to {}x{}",
            session.width, session.height, request.width, request.height
        ));
    }

    if request.fps != session.fps {
        return Err(format!(
            "Output frame rate changed from {} fps to {} fps",
            session.fps, request.fps
        ));
    }

    validate_rgba_frame(request.rgba_bytes.as_deref(), request.width, request.height)?;

    let frame_bytes = request.jpeg_bytes.len();
    let rgba_frame_bytes = request.rgba_bytes.as_ref().map_or(0, Vec::len);
    native_sink
        .lock()
        .map_err(|_| "Native camera sink state lock failed".to_string())?
        .publish_raw_frame(request.frame_index, request.rgba_bytes.as_deref())?;
    state
        .frames
        .publish(request.jpeg_bytes, request.png_bytes, request.rgba_bytes)?;
    session.frame_count = request.frame_index;
    session.last_frame_bytes = frame_bytes;
    session.last_rgba_frame_bytes = rgba_frame_bytes;

    Ok(virtual_camera_status_from_session(&session))
}

fn virtual_camera_status_from_session(session: &VirtualCameraSession) -> VirtualCameraStatus {
    let obs_detected = obs_installation_likely_available();
    let message = if obs_detected {
        format!("Local output stream is running. OBS appears to be installed; add Browser Source: {OUTPUT_MJPEG_URL}")
    } else {
        format!("Local output stream is running, but OBS was not detected in the usual Windows install paths. Install OBS Studio or use an existing OBS install, then add Browser Source: {OUTPUT_MJPEG_URL}")
    };

    VirtualCameraStatus {
        running: session.running,
        supported: true,
        obs_detected,
        message,
        width: session.width,
        height: session.height,
        fps: session.fps,
        frame_count: session.frame_count,
        last_frame_bytes: session.last_frame_bytes,
        last_rgba_frame_bytes: session.last_rgba_frame_bytes,
        frame_url: session.frame_url.clone(),
        png_frame_url: session.png_frame_url.clone(),
        mjpeg_url: session.mjpeg_url.clone(),
        transparent_source_url: session.transparent_source_url.clone(),
    }
}

fn native_camera_status_from_sink(sink: &NativeCameraSinkState) -> NativeCameraStatus {
    let device_name = "MiiTuber Camera".to_string();

    #[cfg(target_os = "windows")]
    {
        NativeCameraStatus {
            platform_supported: true,
            device_installed: sink.device_installed,
            raw_frame_sink_ready: sink.raw_frame_sink_ready,
            width: sink.width,
            height: sink.height,
            fps: sink.fps,
            published_frame_count: sink.published_frame_count,
            last_frame_bytes: sink.last_frame_bytes,
            device_name,
            message: native_camera_status_message(sink),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        NativeCameraStatus {
            platform_supported: false,
            device_installed: false,
            raw_frame_sink_ready: false,
            width: 0,
            height: 0,
            fps: 0,
            published_frame_count: 0,
            last_frame_bytes: 0,
            device_name,
            message:
                "Native MiiTuber Camera is planned for Windows first; use the OBS output stream on this platform."
                    .to_string(),
        }
    }
}

#[cfg(target_os = "windows")]
fn native_camera_status_message(sink: &NativeCameraSinkState) -> String {
    if sink.raw_frame_sink_ready {
        "Native Windows camera sink is ready for raw frames.".to_string()
    } else if sink.device_installed {
        "Native Windows camera device is installed, but the frame sink is not ready yet. Use the OBS Browser Source path for now.".to_string()
    } else {
        "Native Windows camera device is not installed yet. Use the OBS Browser Source path for now; the Windows camera sink will attach to the same output frames.".to_string()
    }
}

fn ensure_output_server_started(state: SharedVirtualCameraState) {
    OUTPUT_SERVER_STARTED.get_or_init(|| {
        thread::spawn(move || run_output_server(state));
    });
}

fn run_output_server(state: SharedVirtualCameraState) {
    let listener = match TcpListener::bind(OUTPUT_SERVER_ADDR) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("output_server: could not bind {OUTPUT_SERVER_ADDR}: {error}");
            return;
        }
    };

    println!("output_server: serving frames on {OUTPUT_SERVER_ADDR}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let state = Arc::clone(&state);
                thread::spawn(move || handle_output_client(stream, state));
            }
            Err(error) => eprintln!("output_server: client accept failed: {error}"),
        }
    }
}

fn handle_output_client(mut stream: TcpStream, state: SharedVirtualCameraState) {
    let mut request = [0_u8; 1024];
    let read_len = match stream.read(&mut request) {
        Ok(read_len) => read_len,
        Err(error) => {
            eprintln!("output_server: could not read request: {error}");
            return;
        }
    };
    let request = String::from_utf8_lossy(&request[..read_len]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    match path {
        "/frame.jpg" => write_latest_jpeg_response(&mut stream, &state),
        "/frame.png" => write_latest_png_response(&mut stream, &state),
        "/stream.mjpeg" => write_mjpeg_stream(&mut stream, &state),
        "/source-transparent.html" => write_text_response(
            &mut stream,
            200,
            "text/html; charset=utf-8",
            transparent_source_html().as_bytes(),
        ),
        "/" => write_text_response(
            &mut stream,
            200,
            "text/plain; charset=utf-8",
            format!(
                "{OUTPUT_SERVER_HOME_MARKER}\nJPEG: {OUTPUT_FRAME_URL}\nPNG: {OUTPUT_PNG_FRAME_URL}\nMJPEG: {OUTPUT_MJPEG_URL}\nTransparent OBS Source: {OUTPUT_TRANSPARENT_SOURCE_URL}\n"
            )
            .as_bytes(),
        ),
        _ => write_text_response(
            &mut stream,
            404,
            "text/plain; charset=utf-8",
            b"Not found. Use /frame.jpg, /frame.png, /stream.mjpeg, or /source-transparent.html.\n",
        ),
    }
}

fn write_latest_jpeg_response(stream: &mut TcpStream, state: &SharedVirtualCameraState) {
    match latest_jpeg(state) {
        Some(jpeg) => write_text_response(stream, 200, "image/jpeg", &jpeg),
        None => write_text_response(
            stream,
            503,
            "text/plain; charset=utf-8",
            b"No MiiTuber output frame has been published yet.\n",
        ),
    }
}

fn write_latest_png_response(stream: &mut TcpStream, state: &SharedVirtualCameraState) {
    match latest_png(state) {
        Some(png) => write_text_response(stream, 200, "image/png", &png),
        None => write_text_response(
            stream,
            503,
            "text/plain; charset=utf-8",
            b"No transparent MiiTuber output frame has been published yet. Enable transparent background and Start Output.\n",
        ),
    }
}

fn write_mjpeg_stream(stream: &mut TcpStream, state: &SharedVirtualCameraState) {
    if !output_session_is_running(state) {
        write_text_response(
            stream,
            503,
            "text/plain; charset=utf-8",
            b"MiiTuber output is not running. Click Start Output before opening the MJPEG stream.\n",
        );
        return;
    }

    let header = format!(
        "HTTP/1.1 200 OK\r\nCache-Control: no-cache\r\nPragma: no-cache\r\nConnection: close\r\nContent-Type: multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}\r\n\r\n"
    );
    if stream.write_all(header.as_bytes()).is_err() {
        return;
    }

    loop {
        if !output_session_is_running(state) {
            return;
        }

        let Some(jpeg) = latest_jpeg(state) else {
            thread::sleep(Duration::from_millis(50));
            continue;
        };
        let part_header = format!(
            "--{MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
            jpeg.len()
        );

        if stream.write_all(part_header.as_bytes()).is_err()
            || stream.write_all(&jpeg).is_err()
            || stream.write_all(b"\r\n").is_err()
            || stream.flush().is_err()
        {
            return;
        }

        let fps = state
            .session
            .lock()
            .map(|session| session.fps)
            .unwrap_or(30);
        thread::sleep(Duration::from_millis(1000 / u64::from(fps.max(1))));
    }
}

fn transparent_source_html() -> String {
    format!(
        r#"<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body {{ margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }}
body {{ display: grid; place-items: stretch; }}
img {{ width: 100vw; height: 100vh; object-fit: contain; }}
</style>
</head>
<body>
<img id="frame" alt="MiiTuber transparent output">
<script>
const frame = document.getElementById("frame");
let inFlight = false;
async function updateFrame() {{
  if (inFlight) {{
    requestAnimationFrame(updateFrame);
    return;
  }}
  inFlight = true;
  frame.src = "/frame.png?t=" + Date.now();
  frame.onload = frame.onerror = () => {{ inFlight = false; }};
  requestAnimationFrame(updateFrame);
}}
updateFrame();
</script>
</body>
</html>
"#
    )
}

fn output_session_is_running(state: &SharedVirtualCameraState) -> bool {
    state
        .session
        .lock()
        .map(|session| session.running)
        .unwrap_or(false)
}

fn latest_png(state: &SharedVirtualCameraState) -> Option<Vec<u8>> {
    state.frames.latest_png()
}

#[cfg(test)]
fn latest_rgba(state: &SharedVirtualCameraState) -> Option<Vec<u8>> {
    state.frames.latest_rgba()
}

fn latest_jpeg(state: &SharedVirtualCameraState) -> Option<Vec<u8>> {
    state.frames.latest_jpeg()
}

fn clear_latest_output_frame(state: &SharedVirtualCameraState) -> Result<(), String> {
    state.frames.clear()
}

fn is_jpeg_frame(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xff, 0xd8, 0xff])
}

fn is_png_frame(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
}

fn validate_rgba_frame(bytes: Option<&[u8]>, width: u32, height: u32) -> Result<(), String> {
    let Some(bytes) = bytes else {
        return Ok(());
    };

    let expected_len = expected_rgba_frame_len(width, height)?;
    if bytes.len() != expected_len {
        return Err(format!(
            "Raw RGBA output frame was {} bytes, expected {expected_len} for {width}x{height}",
            bytes.len()
        ));
    }

    Ok(())
}

fn expected_rgba_frame_len(width: u32, height: u32) -> Result<usize, String> {
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|value| value.checked_mul(4))
        .ok_or_else(|| "Raw RGBA output frame dimensions overflowed".to_string())?;

    usize::try_from(pixels).map_err(|_| "Raw RGBA output frame is too large".to_string())
}

fn write_text_response(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) {
    let response = http_response_bytes(status, content_type, body);
    let _ = stream.write_all(&response);
}

fn http_response_bytes(status: u16, content_type: &str, body: &[u8]) -> Vec<u8> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        503 => "Service Unavailable",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut response = Vec::with_capacity(header.len() + body.len());
    response.extend_from_slice(header.as_bytes());
    response.extend_from_slice(body);
    response
}

fn validate_output_settings(width: u32, height: u32, fps: u32) -> Result<(), String> {
    if width < 320 || height < 180 {
        return Err("Output resolution must be at least 320x180".to_string());
    }

    if width > 3840 || height > 2160 {
        return Err("Output resolution must be 3840x2160 or smaller".to_string());
    }

    if fps != 30 && fps != 60 {
        return Err("Output FPS must be 30 or 60 for this Phase 4 path".to_string());
    }

    Ok(())
}

fn ensure_output_server_ready() -> Result<(), String> {
    let addr: SocketAddr = OUTPUT_SERVER_ADDR
        .parse()
        .map_err(|_| "Output server address is invalid".to_string())?;

    for _ in 0..10 {
        if output_server_home_is_reachable(addr)? {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(20));
    }

    Err(format!(
        "MiiTuber output server is not responding on {OUTPUT_SERVER_ADDR}. Restart the app; if it keeps happening, another process may be using port 49321."
    ))
}

fn output_server_home_is_reachable(addr: SocketAddr) -> Result<bool, String> {
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
        Ok(stream) => stream,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionRefused
                    | std::io::ErrorKind::TimedOut
                    | std::io::ErrorKind::NotConnected
            ) =>
        {
            return Ok(false);
        }
        Err(error) => {
            return Err(format!(
                "Could not connect to MiiTuber output server on {OUTPUT_SERVER_ADDR}: {error}"
            ));
        }
    };

    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| format!("Could not set output server read timeout: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| format!("Could not set output server write timeout: {error}"))?;
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|error| format!("Could not query MiiTuber output server: {error}"))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| format!("Could not read MiiTuber output server response: {error}"))?;

    Ok(output_server_home_response_is_ours(&response))
}

fn output_server_home_response_is_ours(response: &[u8]) -> bool {
    let text = String::from_utf8_lossy(response);
    text.starts_with("HTTP/1.1 200 OK") && text.contains(OUTPUT_SERVER_HOME_MARKER)
}

fn obs_installation_likely_available() -> bool {
    cfg!(target_os = "windows")
        && (Path::new(r"C:\Program Files\obs-studio\bin\64bit\obs64.exe").exists()
            || Path::new(r"C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe").exists())
}

fn compact_error_body(body: &str) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");

    if compact.len() > 500 {
        format!("{}...", &compact[..500])
    } else if compact.is_empty() {
        "(empty response body)".to_string()
    } else {
        compact
    }
}

fn renderer_cache_key(renderer_payload: &RendererPayload) -> String {
    let mut hasher = Sha256::new();
    hasher.update(&renderer_payload.bytes);
    hasher.update([renderer_payload.verify_char_info as u8]);
    let hash = hasher.finalize();

    format!("{hash:x}")
}

async fn fetch_renderer_bytes(
    url: &str,
    renderer_payload: &RendererPayload,
    extra_query: &[(&str, &str)],
    input_len: usize,
    output_label: &str,
    cache_key: &str,
) -> Result<Vec<u8>, String> {
    let hex_data = hex_encode(&renderer_payload.bytes);
    let verify_char_info = if renderer_payload.verify_char_info {
        "1"
    } else {
        "0"
    };
    println!(
        "fetch_renderer_bytes: requesting {output_label} input_len={} renderer_len={} verify_char_info={} sha256={cache_key} url={url}",
        input_len,
        renderer_payload.bytes.len(),
        renderer_payload.verify_char_info
    );

    let client = reqwest::Client::new();
    let mut query = vec![
        ("data", hex_data.as_str()),
        ("verifyCharInfo", verify_char_info),
    ];
    query.extend(extra_query.iter().copied());

    let response = client
        .get(url)
        .query(&query)
        .send()
        .await
        .map_err(|error| format!("Could not reach FFL renderer on port 5000: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|error| format!("Could not read renderer error body: {error}"));
        eprintln!(
            "fetch_renderer_bytes: renderer rejected request input_len={} renderer_len={} sha256={cache_key} status={status} body={body}",
            input_len,
            renderer_payload.bytes.len()
        );

        return Err(format!(
            "FFL renderer rejected the avatar data with HTTP {status}. Renderer said: {}",
            compact_error_body(&body)
        ));
    }

    response
        .bytes()
        .await
        .map_err(|error| format!("Could not read renderer response: {error}"))
        .map(|bytes| bytes.to_vec())
}

fn normalize_mii_data_for_renderer(bytes: &[u8]) -> Result<RendererPayload, String> {
    match bytes.len() {
        FFL_STORE_DATA_LEN | SWITCH_CHAR_INFO_LEN | STUDIO_RAW_LEN | STUDIO_ENCODED_LEN => Ok(RendererPayload {
            bytes: bytes.to_vec(),
            verify_char_info: true,
        }),
        len if LEGACY_MIIC_DATA_LENS.contains(&len) => {
            println!("normalize_mii_data_for_renderer: converting legacy .miic input len={len} to 96-byte FFSD payload");
            Ok(RendererPayload {
                bytes: miic_to_ffsd_payload(bytes),
                verify_char_info: true,
            })
        }
        CURRENT_MIIC_DATA_LEN => Err(
            "This 128-byte .miic file is the current Mii Creator v4 format. The local renderer cannot read it directly, and the public legacy decoder renders this sample incorrectly. Export this avatar as .ffsd or Mii Studio/CharInfo data, or add a real v4 .miic converter before rendering it.".to_string()
        ),
        actual_len => Err(format!(
            "Unsupported avatar data length: expected {FFL_STORE_DATA_LEN} bytes for FFSD, {SWITCH_CHAR_INFO_LEN} bytes for Switch CharInfo, {STUDIO_RAW_LEN}/{STUDIO_ENCODED_LEN} bytes for Studio data, or legacy .miic extended FFSD data ({:?} bytes), got {actual_len} bytes",
            LEGACY_MIIC_DATA_LENS
        )),
    }
}

fn miic_to_ffsd_payload(bytes: &[u8]) -> Vec<u8> {
    let mut ffsd = bytes[..FFL_STORE_DATA_LEN].to_vec();
    let crc = calculate_ffsd_crc16(&ffsd);

    ffsd[94] = (crc >> 8) as u8;
    ffsd[95] = (crc & 0xff) as u8;

    ffsd
}

fn calculate_ffsd_crc16(bytes: &[u8]) -> u16 {
    let mut crc = 0u32;

    for byte in &bytes[..94] {
        for bit in (0..=7).rev() {
            let flag = (crc & 0x8000) != 0;
            crc = (crc << 1) | ((byte >> bit) & 1) as u32;

            if flag {
                crc ^= 0x1021;
            }
        }
    }

    for _ in 0..16 {
        let flag = (crc & 0x8000) != 0;
        crc <<= 1;

        if flag {
            crc ^= 0x1021;
        }
    }

    (crc & 0xffff) as u16
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_ffsd_crc16, clear_latest_output_frame, hex_encode, http_response_bytes,
        is_jpeg_frame, is_png_frame, latest_jpeg, latest_png, latest_rgba,
        native_camera_status_from_sink, normalize_mii_data_for_renderer,
        output_server_home_response_is_ours, output_session_is_running, publish_output_frame,
        start_output_session, stop_output_session, validate_rgba_frame,
        virtual_camera_status_from_session, NativeCameraSinkState,
        PublishVirtualCameraFrameRequest, SharedNativeCameraSinkState, SharedVirtualCameraState,
        StartVirtualCameraRequest, VirtualCameraSession, FFL_STORE_DATA_LEN, LEGACY_MIIC_DATA_LENS,
        OUTPUT_FRAME_URL, OUTPUT_MJPEG_URL, OUTPUT_PNG_FRAME_URL, OUTPUT_SERVER_HOME_MARKER,
        OUTPUT_TRANSPARENT_SOURCE_URL, STUDIO_ENCODED_LEN, STUDIO_RAW_LEN, SWITCH_CHAR_INFO_LEN,
    };

    fn running_output_state(width: u32, height: u32, fps: u32) -> SharedVirtualCameraState {
        let state = SharedVirtualCameraState::default();
        {
            let mut session = state.session.lock().unwrap();
            session.running = true;
            session.width = width;
            session.height = height;
            session.fps = fps;
            session.frame_url = OUTPUT_FRAME_URL.to_string();
            session.png_frame_url = OUTPUT_PNG_FRAME_URL.to_string();
            session.mjpeg_url = OUTPUT_MJPEG_URL.to_string();
            session.transparent_source_url = OUTPUT_TRANSPARENT_SOURCE_URL.to_string();
        }
        state
    }

    fn output_frame_request(
        width: u32,
        height: u32,
        frame_index: u64,
        rgba_bytes: Option<Vec<u8>>,
    ) -> PublishVirtualCameraFrameRequest {
        PublishVirtualCameraFrameRequest {
            width,
            height,
            fps: 30,
            frame_index,
            jpeg_bytes: vec![0xff, 0xd8, 0xff, 0xe0],
            png_bytes: None,
            rgba_bytes,
        }
    }

    #[test]
    fn accepts_supported_mii_data_lengths() {
        let ffsd = normalize_mii_data_for_renderer(&vec![0; FFL_STORE_DATA_LEN]).unwrap();
        let switch_char_info =
            normalize_mii_data_for_renderer(&vec![0; SWITCH_CHAR_INFO_LEN]).unwrap();
        let studio_raw = normalize_mii_data_for_renderer(&vec![0; STUDIO_RAW_LEN]).unwrap();
        let studio_encoded = normalize_mii_data_for_renderer(&vec![0; STUDIO_ENCODED_LEN]).unwrap();

        assert!(ffsd.verify_char_info);
        assert!(switch_char_info.verify_char_info);
        assert!(studio_raw.verify_char_info);
        assert!(studio_encoded.verify_char_info);
    }

    #[test]
    fn converts_legacy_miic_like_data_to_ffsd_payload() {
        for len in LEGACY_MIIC_DATA_LENS {
            let input = vec![7; *len];
            let renderer_payload = normalize_mii_data_for_renderer(&input).unwrap();

            assert_eq!(renderer_payload.bytes.len(), FFL_STORE_DATA_LEN);
            assert!(renderer_payload.verify_char_info);
            assert_eq!(&renderer_payload.bytes[..94], vec![7; 94]);
            assert_ne!(&renderer_payload.bytes[94..], &[7, 7]);
        }
    }

    #[test]
    fn conversion_rewrites_ffsd_crc16() {
        let mut input = vec![7; 108];
        input[94] = 0;
        input[95] = 0;

        let renderer_payload = normalize_mii_data_for_renderer(&input).unwrap();
        let crc = calculate_ffsd_crc16(&renderer_payload.bytes);

        assert_eq!(renderer_payload.bytes[94], (crc >> 8) as u8);
        assert_eq!(renderer_payload.bytes[95], (crc & 0xff) as u8);
    }

    #[test]
    fn rejects_unsupported_mii_data_lengths() {
        assert!(normalize_mii_data_for_renderer(&vec![0; FFL_STORE_DATA_LEN - 1]).is_err());
        assert!(normalize_mii_data_for_renderer(&vec![0; FFL_STORE_DATA_LEN + 1]).is_err());
    }

    #[test]
    fn rejects_current_miic_v4_until_converter_exists() {
        let error = normalize_mii_data_for_renderer(&vec![0; 128]).unwrap_err();

        assert!(error.contains("128-byte .miic"));
        assert!(error.contains("Mii Creator v4"));
        assert!(error.contains("real v4 .miic converter"));
    }

    #[test]
    fn hex_encodes_bytes_for_renderer_query_param() {
        assert_eq!(hex_encode(&[0x00, 0x0f, 0xa4, 0xff]), "000fa4ff");
    }

    #[test]
    fn compacts_renderer_error_body() {
        assert_eq!(super::compact_error_body("bad\n\nrequest"), "bad request");
        assert_eq!(super::compact_error_body("   "), "(empty response body)");
    }

    #[test]
    fn detects_jpeg_output_frames() {
        assert!(is_jpeg_frame(&[0xff, 0xd8, 0xff, 0xe0]));
        assert!(!is_jpeg_frame(b"\x89PNG\r\n\x1a\n"));
        assert!(!is_jpeg_frame(&[0xff, 0xd8]));
    }

    #[test]
    fn detects_png_output_frames() {
        assert!(is_png_frame(b"\x89PNG\r\n\x1a\nabc"));
        assert!(!is_png_frame(&[0xff, 0xd8, 0xff, 0xe0]));
        assert!(!is_png_frame(b"\x89PNG\r\n"));
    }

    #[test]
    fn latest_jpeg_reads_published_frame_snapshot() {
        let state = SharedVirtualCameraState::default();
        state
            .frames
            .publish(vec![0xff, 0xd8, 0xff, 0xe0], None, None)
            .unwrap();

        assert_eq!(latest_jpeg(&state), Some(vec![0xff, 0xd8, 0xff, 0xe0]));
    }

    #[test]
    fn clear_latest_output_frame_removes_stale_frame() {
        let state = SharedVirtualCameraState::default();
        state
            .frames
            .publish(
                vec![0xff, 0xd8, 0xff, 0xe0],
                Some(b"\x89PNG\r\n\x1a\n".to_vec()),
                Some(vec![0, 1, 2, 3]),
            )
            .unwrap();

        clear_latest_output_frame(&state).unwrap();

        assert_eq!(latest_jpeg(&state), None);
        assert_eq!(latest_png(&state), None);
        assert_eq!(latest_rgba(&state), None);
    }

    #[test]
    fn output_frame_store_tracks_jpeg_transparent_and_raw_frames_together() {
        let state = SharedVirtualCameraState::default();

        state
            .frames
            .publish(
                vec![0xff, 0xd8, 0xff, 0xe0],
                Some(b"\x89PNG\r\n\x1a\nabc".to_vec()),
                Some(vec![0, 1, 2, 3, 4, 5, 6, 7]),
            )
            .unwrap();

        assert_eq!(latest_jpeg(&state), Some(vec![0xff, 0xd8, 0xff, 0xe0]));
        assert_eq!(latest_png(&state), Some(b"\x89PNG\r\n\x1a\nabc".to_vec()));
        assert_eq!(latest_rgba(&state), Some(vec![0, 1, 2, 3, 4, 5, 6, 7]));
    }

    #[test]
    fn accepts_rgba_frame_with_expected_size() {
        assert!(validate_rgba_frame(Some(&[0; 16]), 2, 2).is_ok());
        assert!(validate_rgba_frame(None, 2, 2).is_ok());
    }

    #[test]
    fn rejects_rgba_frame_with_unexpected_size() {
        let error = validate_rgba_frame(Some(&[0; 15]), 2, 2).unwrap_err();

        assert!(error.contains("Raw RGBA output frame"));
        assert!(error.contains("expected 16"));
    }

    #[test]
    fn output_session_running_reflects_session_state() {
        let state = SharedVirtualCameraState::default();

        assert!(!output_session_is_running(&state));

        state.session.lock().unwrap().running = true;
        assert!(output_session_is_running(&state));
    }

    #[test]
    fn start_output_session_configures_native_sink_format() {
        let output_state = SharedVirtualCameraState::default();
        let native_sink = SharedNativeCameraSinkState::default();

        let status = start_output_session(
            StartVirtualCameraRequest {
                width: 1280,
                height: 720,
                fps: 30,
            },
            &output_state,
            &native_sink,
        )
        .unwrap();

        assert!(status.running);
        assert_eq!(status.width, 1280);
        assert_eq!(status.height, 720);
        assert_eq!(status.fps, 30);

        let sink = native_sink.lock().unwrap();
        assert_eq!(sink.width, 1280);
        assert_eq!(sink.height, 720);
        assert_eq!(sink.fps, 30);
    }

    #[test]
    fn stop_output_session_clears_native_sink_format_and_counters() {
        let output_state = running_output_state(2, 2, 30);
        let native_sink = SharedNativeCameraSinkState::default();
        {
            let mut sink = native_sink.lock().unwrap();
            sink.configure_output(2, 2, 30);
            sink.raw_frame_sink_ready = true;
            sink.publish_raw_frame(12, Some(&[0; 16])).unwrap();
        }

        let status = stop_output_session(&output_state, &native_sink).unwrap();

        assert!(!status.running);
        let sink = native_sink.lock().unwrap();
        assert_eq!(sink.width, 0);
        assert_eq!(sink.height, 0);
        assert_eq!(sink.fps, 0);
        assert_eq!(sink.published_frame_count, 0);
        assert_eq!(sink.last_frame_bytes, 0);
    }

    #[test]
    fn builds_http_response_with_content_type_and_length() {
        let response = http_response_bytes(200, "image/jpeg", b"abc");
        let text = String::from_utf8_lossy(&response);

        assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(text.contains("Content-Type: image/jpeg\r\n"));
        assert!(text.contains("Content-Length: 3\r\n"));
        assert!(text.ends_with("\r\n\r\nabc"));
    }

    #[test]
    fn transparent_source_page_polls_png_with_transparent_background() {
        let html = super::transparent_source_html();

        assert!(html.contains("background: transparent"));
        assert!(html.contains("/frame.png?t="));
        assert!(html.contains("requestAnimationFrame(updateFrame)"));
    }

    #[test]
    fn virtual_camera_status_keeps_local_stream_supported() {
        let session = VirtualCameraSession {
            running: true,
            width: 1280,
            height: 720,
            fps: 30,
            frame_count: 12,
            last_frame_bytes: 4096,
            last_rgba_frame_bytes: 1280 * 720 * 4,
            frame_url: OUTPUT_FRAME_URL.to_string(),
            png_frame_url: OUTPUT_PNG_FRAME_URL.to_string(),
            mjpeg_url: OUTPUT_MJPEG_URL.to_string(),
            transparent_source_url: OUTPUT_TRANSPARENT_SOURCE_URL.to_string(),
        };

        let status = virtual_camera_status_from_session(&session);

        assert!(status.supported);
        assert!(status.message.contains(OUTPUT_MJPEG_URL));
        assert_eq!(status.last_rgba_frame_bytes, 1280 * 720 * 4);
        assert_eq!(status.frame_url, OUTPUT_FRAME_URL);
        assert_eq!(status.png_frame_url, OUTPUT_PNG_FRAME_URL);
        assert_eq!(status.mjpeg_url, OUTPUT_MJPEG_URL);
        assert_eq!(status.transparent_source_url, OUTPUT_TRANSPARENT_SOURCE_URL);
    }

    #[test]
    fn native_camera_status_is_explicit_about_install_state() {
        let status = native_camera_status_from_sink(&NativeCameraSinkState::default());

        assert_eq!(status.device_name, "MiiTuber Camera");
        assert!(!status.device_installed);
        assert!(!status.raw_frame_sink_ready);
        assert!(status.message.contains("OBS") || status.message.contains("Windows"));
    }

    #[test]
    fn native_camera_status_reflects_sink_readiness() {
        let status = native_camera_status_from_sink(&NativeCameraSinkState {
            device_installed: true,
            raw_frame_sink_ready: true,
            width: 1280,
            height: 720,
            fps: 30,
            published_frame_count: 7,
            last_frame_bytes: 16,
        });

        assert_eq!(status.device_name, "MiiTuber Camera");

        #[cfg(target_os = "windows")]
        {
            assert!(status.platform_supported);
            assert!(status.device_installed);
            assert!(status.raw_frame_sink_ready);
        }

        #[cfg(not(target_os = "windows"))]
        {
            assert!(!status.platform_supported);
            assert!(!status.device_installed);
            assert!(!status.raw_frame_sink_ready);
        }
    }

    #[test]
    fn native_camera_sink_ignores_raw_frames_until_ready() {
        let mut sink = NativeCameraSinkState::default();

        sink.publish_raw_frame(7, None).unwrap();

        assert_eq!(sink.published_frame_count, 0);
        assert_eq!(sink.last_frame_bytes, 0);
    }

    #[test]
    fn native_camera_sink_tracks_configured_output_format() {
        let mut sink = NativeCameraSinkState::default();

        sink.configure_output(1280, 720, 30);

        assert_eq!(sink.width, 1280);
        assert_eq!(sink.height, 720);
        assert_eq!(sink.fps, 30);

        sink.publish_raw_frame(7, None).unwrap();
        sink.clear_output();

        assert_eq!(sink.width, 0);
        assert_eq!(sink.height, 0);
        assert_eq!(sink.fps, 0);
        assert_eq!(sink.published_frame_count, 0);
        assert_eq!(sink.last_frame_bytes, 0);
    }

    #[test]
    fn native_camera_sink_counts_raw_frames_when_ready() {
        let mut sink = NativeCameraSinkState {
            device_installed: true,
            raw_frame_sink_ready: true,
            width: 2,
            height: 2,
            fps: 30,
            published_frame_count: 0,
            last_frame_bytes: 0,
        };

        sink.publish_raw_frame(7, Some(&[0; 16])).unwrap();

        assert_eq!(sink.published_frame_count, 7);
        assert_eq!(sink.last_frame_bytes, 16);
        assert!(sink.publish_raw_frame(8, None).is_err());
    }

    #[test]
    fn native_camera_sink_requires_configured_format_when_ready() {
        let mut sink = NativeCameraSinkState {
            device_installed: true,
            raw_frame_sink_ready: true,
            width: 0,
            height: 0,
            fps: 0,
            published_frame_count: 0,
            last_frame_bytes: 0,
        };

        let error = sink.publish_raw_frame(7, Some(&[0; 16])).unwrap_err();

        assert!(error.contains("no output format"));
        assert_eq!(sink.published_frame_count, 0);
    }

    #[test]
    fn native_camera_sink_rejects_wrong_raw_frame_size() {
        let mut sink = NativeCameraSinkState {
            device_installed: true,
            raw_frame_sink_ready: true,
            width: 2,
            height: 2,
            fps: 30,
            published_frame_count: 0,
            last_frame_bytes: 0,
        };

        let error = sink.publish_raw_frame(7, Some(&[0; 15])).unwrap_err();

        assert!(error.contains("expected 16"));
        assert_eq!(sink.published_frame_count, 0);
    }

    #[test]
    fn publish_output_frame_hands_raw_frame_to_ready_native_sink() {
        let output_state = running_output_state(2, 2, 30);
        let native_sink = SharedNativeCameraSinkState::default();
        {
            let mut sink = native_sink.lock().unwrap();
            sink.device_installed = true;
            sink.raw_frame_sink_ready = true;
            sink.configure_output(2, 2, 30);
        }

        let status = publish_output_frame(
            output_frame_request(2, 2, 7, Some(vec![0; 16])),
            &output_state,
            &native_sink,
        )
        .unwrap();

        assert_eq!(status.frame_count, 7);
        assert_eq!(status.last_rgba_frame_bytes, 16);
        let sink = native_sink.lock().unwrap();
        assert_eq!(sink.published_frame_count, 7);
        assert_eq!(sink.last_frame_bytes, 16);
    }

    #[test]
    fn publish_output_frame_requires_raw_frame_when_native_sink_is_ready() {
        let output_state = running_output_state(2, 2, 30);
        let native_sink = SharedNativeCameraSinkState::default();
        native_sink.lock().unwrap().raw_frame_sink_ready = true;

        let error = match publish_output_frame(
            output_frame_request(2, 2, 7, None),
            &output_state,
            &native_sink,
        ) {
            Ok(_) => panic!("expected missing raw frame to fail"),
            Err(error) => error,
        };

        assert!(error.contains("no raw RGBA frame"));
        assert_eq!(output_state.session.lock().unwrap().frame_count, 0);
    }

    #[test]
    fn identifies_miituber_output_server_home_response() {
        let response = http_response_bytes(
            200,
            "text/plain; charset=utf-8",
            OUTPUT_SERVER_HOME_MARKER.as_bytes(),
        );

        assert!(output_server_home_response_is_ours(&response));
        assert!(!output_server_home_response_is_ours(
            b"HTTP/1.1 200 OK\r\n\r\nSome other server"
        ));
        assert!(!output_server_home_response_is_ours(
            b"HTTP/1.1 404 Not Found\r\n\r\nMiiTuber output server"
        ));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let virtual_camera_state = SharedVirtualCameraState::default();
    ensure_output_server_started(Arc::clone(&virtual_camera_state));

    tauri::Builder::default()
        .manage(SharedRenderCache::default())
        .manage(SharedNativeCameraSinkState::default())
        .manage(virtual_camera_state)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_renderer_status,
            get_native_camera_status,
            get_virtual_camera_status,
            publish_virtual_camera_frame,
            render_mii_glb,
            render_mii_png,
            start_virtual_camera,
            stop_virtual_camera
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
