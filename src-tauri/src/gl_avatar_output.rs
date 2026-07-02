//! Native OpenGL avatar output window (Step 2).
//!
//! Renders the FFL Mii GLB in a native Win32 + OpenGL window so OBS Game
//! Capture (+ Allow Transparency) can pull real per-pixel alpha at full FPS.
//! The rendered back buffer IS the output — there is no pixel readback, no IPC
//! frame copy, no GDI blit (those caused the old ~10fps bottleneck).
//!
//! The window keeps native decorations (hard constraint). The avatar is drawn
//! opaque (alpha = 1) over a background cleared to alpha = 0, so on the opaque
//! desktop window the user sees the background colour while OBS drops it out.
//!
//! Rendering stack: a native WGL 3.3-core context handed to three-d via its
//! re-exported glow loader. Live head pose (`set_pose`) and expression variant
//! swapping (`set_expression`, from KHR_materials_variants) are pushed lock-free
//! from the frontend and applied per frame.

#![cfg(windows)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use three_d::*;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{GetDC, ReleaseDC};
use windows_sys::Win32::Graphics::OpenGL::{
    wglCreateContext, wglDeleteContext, wglGetProcAddress, wglMakeCurrent, ChoosePixelFormat,
    SetPixelFormat, SwapBuffers, PFD_DOUBLEBUFFER, PFD_DRAW_TO_WINDOW, PFD_MAIN_PLANE,
    PFD_SUPPORT_OPENGL, PFD_TYPE_RGBA, PIXELFORMATDESCRIPTOR,
};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, LoadCursorW,
    PeekMessageW, PostQuitMessage, RegisterClassW, TranslateMessage, CS_HREDRAW, CS_OWNDC,
    CS_VREDRAW, CW_USEDEFAULT, IDC_ARROW, MSG, PM_REMOVE, WM_CLOSE, WM_DESTROY, WM_QUIT, WNDCLASSW,
    WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};

// WGL_ARB_create_context constants (not in windows-sys; they are extension defs).
const WGL_CONTEXT_MAJOR_VERSION_ARB: i32 = 0x2091;
const WGL_CONTEXT_MINOR_VERSION_ARB: i32 = 0x2092;
const WGL_CONTEXT_PROFILE_MASK_ARB: i32 = 0x9126;
const WGL_CONTEXT_CORE_PROFILE_BIT_ARB: i32 = 0x0000_0001;

type WglCreateContextAttribsArb = unsafe extern "system" fn(
    hdc: *mut std::ffi::c_void,
    share: *mut std::ffi::c_void,
    attribs: *const i32,
) -> *mut std::ffi::c_void;

/// Only one output window at a time.
static OUTPUT_OPEN: AtomicBool = AtomicBool::new(false);

/// Live head pose pushed from the frontend tracking loop, in degrees, stored as
/// f32 bits so the render thread can read it lock-free each frame.
static POSE_PITCH: AtomicU32 = AtomicU32::new(0);
static POSE_YAW: AtomicU32 = AtomicU32::new(0);
static POSE_ROLL: AtomicU32 = AtomicU32::new(0);

/// Live expression index pushed from the frontend tracking loop. The render
/// thread reads it lock-free each frame and swaps the face material.
static POSE_EXPRESSION: AtomicU32 = AtomicU32::new(0);

/// Update the live head pose (degrees). Cheap and safe to call even when no
/// output window is open.
pub fn set_pose(pitch: f32, yaw: f32, roll: f32) {
    POSE_PITCH.store(pitch.to_bits(), Ordering::Relaxed);
    POSE_YAW.store(yaw.to_bits(), Ordering::Relaxed);
    POSE_ROLL.store(roll.to_bits(), Ordering::Relaxed);
}

/// Update the live expression index. Cheap and safe to call even when no output
/// window is open.
pub fn set_expression(index: u32) {
    POSE_EXPRESSION.store(index, Ordering::Relaxed);
}

fn read_pose() -> (f32, f32, f32) {
    (
        f32::from_bits(POSE_PITCH.load(Ordering::Relaxed)),
        f32::from_bits(POSE_YAW.load(Ordering::Relaxed)),
        f32::from_bits(POSE_ROLL.load(Ordering::Relaxed)),
    )
}

fn read_expression() -> u32 {
    POSE_EXPRESSION.load(Ordering::Relaxed)
}

/// Material name the webview stamps on the face mask mesh before GLB export
/// (see `src/lib/fflExport.ts`). The native side locates the face part by it.
const FFL_MASK_MATERIAL_NAME: &str = "FFLMask";

/// One face mask (eyes/mouth/brows) for a single expression, read off the GPU in
/// the webview. In the FFL.js (option 1b) path the native renderer rebinds the
/// face part's texture to `masks[expr]` each time the expression changes.
pub struct MaskTexture {
    pub expression: u32,
    pub width: u32,
    pub height: u32,
    /// Tightly-packed RGBA (width * height * 4).
    pub rgba: Vec<u8>,
}

/// Open the native output window from the raw payload the frontend packs (a
/// static GLB followed by the mask textures). See `parse_payload` for the
/// layout. An empty mask list selects the legacy server-GLB material-swap path.
pub fn open_from_payload(payload: Vec<u8>) -> Result<(), String> {
    let (glb_bytes, masks) = parse_payload(&payload)?;
    if glb_bytes.is_empty() {
        return Err("No GLB bytes were provided for the native output window.".to_string());
    }
    if OUTPUT_OPEN.swap(true, Ordering::SeqCst) {
        return Ok(()); // A window is already open; ignore the repeat request.
    }

    std::thread::spawn(move || {
        if let Err(error) = unsafe { run(glb_bytes, masks) } {
            eprintln!("gl_avatar_output: {error}");
            let log_path = std::env::temp_dir().join("miituber_gl_output.log");
            let _ = std::fs::write(&log_path, format!("gl_avatar_output error: {error}\n"));
        }
        OUTPUT_OPEN.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// Parse the little-endian native-output payload built by `packNativeOutputPayload`
/// (src/lib/fflExport.ts):
///   u32 glbLen | glb bytes | u32 maskCount |
///   repeat: u32 expression, u32 width, u32 height, u32 rgbaLen, rgba bytes
fn parse_payload(bytes: &[u8]) -> Result<(Vec<u8>, Vec<MaskTexture>), String> {
    let mut off = 0usize;
    let glb_len = read_u32(bytes, &mut off)? as usize;
    let glb = read_slice(bytes, &mut off, glb_len)?.to_vec();

    let mask_count = read_u32(bytes, &mut off)?;
    let mut masks = Vec::with_capacity(mask_count as usize);
    for _ in 0..mask_count {
        let expression = read_u32(bytes, &mut off)?;
        let width = read_u32(bytes, &mut off)?;
        let height = read_u32(bytes, &mut off)?;
        let rgba_len = read_u32(bytes, &mut off)? as usize;
        let rgba = read_slice(bytes, &mut off, rgba_len)?.to_vec();
        masks.push(MaskTexture {
            expression,
            width,
            height,
            rgba,
        });
    }

    Ok((glb, masks))
}

fn read_u32(bytes: &[u8], off: &mut usize) -> Result<u32, String> {
    let end = *off + 4;
    if end > bytes.len() {
        return Err("native output payload truncated (u32)".to_string());
    }
    let value = u32::from_le_bytes([bytes[*off], bytes[*off + 1], bytes[*off + 2], bytes[*off + 3]]);
    *off = end;
    Ok(value)
}

fn read_slice<'a>(bytes: &'a [u8], off: &mut usize, len: usize) -> Result<&'a [u8], String> {
    let end = *off + len;
    if end > bytes.len() {
        return Err("native output payload truncated (slice)".to_string());
    }
    let slice = &bytes[*off..end];
    *off = end;
    Ok(slice)
}

fn encode_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CLOSE => {
            DestroyWindow(hwnd);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe fn run(glb_bytes: Vec<u8>, masks: Vec<MaskTexture>) -> Result<(), String> {
    let h_instance = GetModuleHandleW(std::ptr::null());
    let class_name = encode_wide("MiiTuberGlAvatarOutput");
    let title = encode_wide("MiiTuber OBS Output (native GL)");

    let mut wnd_class: WNDCLASSW = std::mem::zeroed();
    wnd_class.style = CS_OWNDC | CS_HREDRAW | CS_VREDRAW;
    wnd_class.lpfnWndProc = Some(wnd_proc);
    wnd_class.hInstance = h_instance;
    wnd_class.hCursor = LoadCursorW(std::ptr::null_mut(), IDC_ARROW);
    wnd_class.lpszClassName = class_name.as_ptr();
    RegisterClassW(&wnd_class);

    let hwnd = CreateWindowExW(
        0,
        class_name.as_ptr(),
        title.as_ptr(),
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        760,
        760,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        h_instance,
        std::ptr::null(),
    );
    if hwnd.is_null() {
        return Err("failed to create output window".into());
    }

    let hdc = GetDC(hwnd);
    if hdc.is_null() {
        DestroyWindow(hwnd);
        return Err("failed to get device context".into());
    }

    // Alpha-capable, double-buffered RGBA pixel format. The alpha channel is
    // what OBS Game Capture reads.
    let mut pfd: PIXELFORMATDESCRIPTOR = std::mem::zeroed();
    pfd.nSize = std::mem::size_of::<PIXELFORMATDESCRIPTOR>() as u16;
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA as u8;
    pfd.cColorBits = 32;
    pfd.cAlphaBits = 8;
    pfd.cDepthBits = 24;
    pfd.iLayerType = PFD_MAIN_PLANE as u8;

    let pixel_format = ChoosePixelFormat(hdc, &pfd);
    if pixel_format == 0 || SetPixelFormat(hdc, pixel_format, &pfd) == 0 {
        ReleaseDC(hwnd, hdc);
        DestroyWindow(hwnd);
        return Err("failed to set pixel format".into());
    }

    // Bootstrap: a legacy context lets us load wglCreateContextAttribsARB, then
    // create a real 3.3 core context that three-d/glow needs.
    let legacy = wglCreateContext(hdc);
    if legacy.is_null() || wglMakeCurrent(hdc, legacy) == 0 {
        ReleaseDC(hwnd, hdc);
        DestroyWindow(hwnd);
        return Err("failed to create legacy GL context".into());
    }

    let gl_context = create_core_context(hdc, legacy);

    // Build a glow context from a WGL loader (wglGetProcAddress, falling back to
    // opengl32.dll for the 1.1 core entry points).
    let opengl32 = GetModuleHandleW(encode_wide("opengl32.dll").as_ptr());
    let gl =
        three_d::context::Context::from_loader_function(|symbol| load_gl_symbol(opengl32, symbol));
    let context = Context::from_gl_context(Arc::new(gl))
        .map_err(|error| format!("three-d context init failed: {error}"))?;

    let render_result = render_loop(hwnd, hdc, &context, glb_bytes, masks);

    wglMakeCurrent(std::ptr::null_mut(), std::ptr::null_mut());
    wglDeleteContext(gl_context);
    ReleaseDC(hwnd, hdc);

    render_result
}

/// Create and activate a 3.3 core context, deleting the legacy one. Falls back
/// to the legacy context if the driver lacks wglCreateContextAttribsARB.
unsafe fn create_core_context(
    hdc: *mut std::ffi::c_void,
    legacy: *mut std::ffi::c_void,
) -> *mut std::ffi::c_void {
    let proc_name = b"wglCreateContextAttribsARB\0";
    let raw = wglGetProcAddress(proc_name.as_ptr());
    let create_attribs: Option<WglCreateContextAttribsArb> = raw.map(|f| std::mem::transmute(f));

    let Some(create_attribs) = create_attribs else {
        return legacy;
    };

    let attribs: [i32; 7] = [
        WGL_CONTEXT_MAJOR_VERSION_ARB,
        3,
        WGL_CONTEXT_MINOR_VERSION_ARB,
        3,
        WGL_CONTEXT_PROFILE_MASK_ARB,
        WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
        0,
    ];

    let core = create_attribs(hdc, std::ptr::null_mut(), attribs.as_ptr());
    if core.is_null() {
        return legacy;
    }

    wglMakeCurrent(std::ptr::null_mut(), std::ptr::null_mut());
    wglDeleteContext(legacy);
    wglMakeCurrent(hdc, core);
    core
}

/// Resolve a GL symbol: try WGL first, then opengl32.dll for 1.1 entry points.
unsafe fn load_gl_symbol(opengl32: *mut std::ffi::c_void, symbol: &str) -> *const std::ffi::c_void {
    let Ok(name) = std::ffi::CString::new(symbol) else {
        return std::ptr::null();
    };

    if let Some(f) = wglGetProcAddress(name.as_ptr() as *const u8) {
        return f as usize as *const std::ffi::c_void;
    }

    if !opengl32.is_null() {
        if let Some(f) = GetProcAddress(opengl32, name.as_ptr() as *const u8) {
            return f as usize as *const std::ffi::c_void;
        }
    }

    std::ptr::null()
}

unsafe fn render_loop(
    hwnd: HWND,
    hdc: *mut std::ffi::c_void,
    context: &Context,
    glb_bytes: Vec<u8>,
    masks: Vec<MaskTexture>,
) -> Result<(), String> {
    let glb_bytes = strip_custom_vertex_attributes(glb_bytes);

    let mut raw_assets = three_d_asset::io::RawAssets::new();
    raw_assets.insert("avatar.glb", glb_bytes);
    let cpu_model: CpuModel = raw_assets
        .deserialize("avatar.glb")
        .map_err(|error| format!("failed to parse GLB: {error}"))?;

    // One-shot diagnostic: dump every loaded primitive so rendering problems
    // (a missing part, absent normals, unexpected albedo) can be diagnosed from
    // the log instead of guessed at. Runs once per window open.
    for prim in &cpu_model.geometries {
        let (verts, has_normals, has_tangents, has_uvs, normal_spread) = match &prim.geometry {
            three_d_asset::Geometry::Triangles(mesh) => {
                // If a strong side light produces no shading, the normals may be
                // present but degenerate (all pointing the same way). Measure the
                // per-axis min/max spread: a real curved surface spans a wide
                // range on each axis; a constant/degenerate set collapses to ~0.
                let spread = mesh.normals.as_ref().map(|normals| {
                    let mut min = vec3(f32::MAX, f32::MAX, f32::MAX);
                    let mut max = vec3(f32::MIN, f32::MIN, f32::MIN);
                    for n in normals {
                        min = vec3(min.x.min(n.x), min.y.min(n.y), min.z.min(n.z));
                        max = vec3(max.x.max(n.x), max.y.max(n.y), max.z.max(n.z));
                    }
                    (max.x - min.x, max.y - min.y, max.z - min.z)
                });
                (
                    mesh.positions.len(),
                    mesh.normals.is_some(),
                    mesh.tangents.is_some(),
                    mesh.uvs.is_some(),
                    spread,
                )
            }
            _ => (0, false, false, false, None),
        };
        let material = prim.material_index.and_then(|i| cpu_model.materials.get(i));
        let mat_name = material.map(|m| m.name.as_str()).unwrap_or("<none>");
        let albedo = material.map(|m| m.albedo).unwrap_or(Srgba::WHITE);
        let (sx, sy, sz) = normal_spread.unwrap_or((0.0, 0.0, 0.0));
        eprintln!(
            "gl_avatar_output: part '{}' verts={verts} normals={has_normals} \
             tangents={has_tangents} uvs={has_uvs} material='{mat_name}' \
             albedo={},{},{},{} normal_spread={sx:.2},{sy:.2},{sz:.2}",
            prim.name, albedo.r, albedo.g, albedo.b, albedo.a
        );
    }

    let mut model = Model::<PhysicalMaterial>::new(context, &cpu_model)
        .map_err(|error| format!("failed to build model: {error}"))?;

    // The FFL renderer omits metallicFactor/roughnessFactor, so glTF defaults
    // them to fully metallic + fully rough. FFL's own shader ignores PBR
    // metalness, but three-d honours it: a metal with no environment map renders
    // near-black. Force the materials diffuse so the key + ambient lights show
    // the avatar's real colours, matching the web preview.
    for part in model.iter_mut() {
        part.material.metallic = 0.0;
        part.material.roughness = 1.0;
    }

    // Build the per-expression face materials + locate the face part. Two paths:
    //   * FFL.js (option 1b): `masks` carries one texture per expression; clone
    //     the face material and rebind its albedo texture per expression.
    //   * legacy server GLB: expressions are baked as `Material_XluMask_<n>`
    //     materials + KHR_materials_variants; rebuild those from the CpuModel.
    let (expression_materials, face_part_index) = if masks.is_empty() {
        build_legacy_expression_materials(context, &cpu_model, &model)
    } else {
        build_mask_expression_materials(context, &model, &masks)?
    };
    let mut applied_expression = u32::MAX;

    let (scale, center) = model_framing(&model);

    let mut camera = Camera::new_perspective(
        Viewport::new_at_origo(760, 760),
        vec3(0.0, 0.05, 3.0),
        vec3(0.0, 0.0, 0.0),
        vec3(0.0, 1.0, 0.0),
        degrees(35.0),
        0.01,
        100.0,
    );

    // Depth on a frontal-facing face only appears when the key light *rakes*
    // across it from the side: the camera looks down -Z and a nose points toward
    // it just like the cheeks, so a frontal light (large -Z direction) gives them
    // the same N·L and the nose bump vanishes. Drive the light mostly from the
    // side (dominant -X) and above (-Y) with only a little front (-Z) so one side
    // of the nose falls into shadow and reads as depth. A modest ambient fills
    // the shadow without flattening it (three-d adds ambient as intensity*albedo
    // unconditionally, so keep it well under 1).
    let key_light = DirectionalLight::new(context, 2.4, Srgba::WHITE, vec3(-2.6, -1.4, -0.7));
    let ambient = AmbientLight::new(context, 0.35, Srgba::WHITE);

    let mut msg: MSG = std::mem::zeroed();
    loop {
        while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
            if msg.message == WM_QUIT {
                return Ok(());
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let mut rect: RECT = std::mem::zeroed();
        GetClientRect(hwnd, &mut rect);
        let width = (rect.right - rect.left).max(1) as u32;
        let height = (rect.bottom - rect.top).max(1) as u32;

        let viewport = Viewport::new_at_origo(width, height);
        camera.set_viewport(viewport);

        // Swap the face material when the tracked expression changes. Cloning a
        // PhysicalMaterial shares the GPU textures (Texture2DRef is ref-counted),
        // so this is only a cheap handle copy, and only on change.
        if let Some(face_index) = face_part_index {
            let expression = read_expression();
            if expression != applied_expression {
                if let Some(material) = expression_materials.get(&expression) {
                    model[face_index].material = material.clone();
                    applied_expression = expression;
                }
            }
        }

        // Apply the live head pose. Matches scene.ts: rotate the framed
        // (scaled + centred) model about its origin by pitch/yaw/roll.
        let (pitch, yaw, roll) = read_pose();
        let rotation = Mat4::from_angle_x(degrees(pitch))
            * Mat4::from_angle_y(degrees(yaw))
            * Mat4::from_angle_z(degrees(roll));
        let transform =
            Mat4::from_translation(-center * scale) * rotation * Mat4::from_scale(scale);
        for part in model.iter_mut() {
            part.set_transformation(transform);
        }

        // Clear to a mid grey with alpha 0: opaque-grey to the eye on the
        // desktop, fully transparent to OBS Game Capture.
        RenderTarget::screen(context, width, height)
            .clear(ClearState::color_and_depth(0.55, 0.55, 0.55, 0.0, 1.0))
            .render(&camera, &model, &[&key_light, &ambient]);

        SwapBuffers(hdc);
    }
}

/// The FFL renderer GLB tags each primitive with a custom `_COLOR` vertex
/// attribute (its per-vertex modulate colour). The Rust `gltf` crate's strict
/// validator rejects application-specific `_`-prefixed semantics, so three-d's
/// loader bails before we ever reach GL. three-d's `PhysicalMaterial` ignores
/// that attribute anyway, so we rewrite the GLB's JSON chunk to drop every
/// `_`-prefixed attribute, leaving the binary buffer untouched.
///
/// Returns the original bytes unchanged if anything about the container looks
/// unexpected — the downstream parser will then surface a precise error.
fn strip_custom_vertex_attributes(glb: Vec<u8>) -> Vec<u8> {
    const HEADER_LEN: usize = 12;
    const CHUNK_HEADER_LEN: usize = 8;
    const JSON_CHUNK_TYPE: &[u8] = b"JSON";

    if glb.len() < HEADER_LEN + CHUNK_HEADER_LEN || &glb[0..4] != b"glTF" {
        return glb;
    }

    let version = u32::from_le_bytes([glb[4], glb[5], glb[6], glb[7]]);
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let json_type = &glb[16..20];
    let json_start = HEADER_LEN + CHUNK_HEADER_LEN;
    let json_end = json_start + json_len;
    if json_type != JSON_CHUNK_TYPE || json_end > glb.len() {
        return glb;
    }

    let Ok(mut doc) = serde_json::from_slice::<serde_json::Value>(&glb[json_start..json_end])
    else {
        return glb;
    };

    let mut removed = false;
    if let Some(meshes) = doc.get_mut("meshes").and_then(|m| m.as_array_mut()) {
        for mesh in meshes {
            let Some(primitives) = mesh.get_mut("primitives").and_then(|p| p.as_array_mut()) else {
                continue;
            };
            for primitive in primitives {
                let Some(attributes) = primitive
                    .get_mut("attributes")
                    .and_then(|a| a.as_object_mut())
                else {
                    continue;
                };
                let custom: Vec<String> = attributes
                    .keys()
                    .filter(|key| key.starts_with('_'))
                    .cloned()
                    .collect();
                for key in custom {
                    attributes.remove(&key);
                    removed = true;
                }
            }
        }
    }

    if !removed {
        return glb;
    }

    let Ok(mut new_json) = serde_json::to_vec(&doc) else {
        return glb;
    };
    // glTF chunks must be 4-byte aligned; JSON is padded with spaces.
    while new_json.len() % 4 != 0 {
        new_json.push(b' ');
    }

    let trailing = &glb[json_end..];
    let total_len = (HEADER_LEN + CHUNK_HEADER_LEN + new_json.len() + trailing.len()) as u32;

    let mut out = Vec::with_capacity(total_len as usize);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&version.to_le_bytes());
    out.extend_from_slice(&total_len.to_le_bytes());
    out.extend_from_slice(&(new_json.len() as u32).to_le_bytes());
    out.extend_from_slice(JSON_CHUNK_TYPE);
    out.extend_from_slice(&new_json);
    out.extend_from_slice(trailing);
    out
}

/// Parse the FFL face-material naming scheme `Material_XluMask_<expr>` into its
/// expression index. The suffix matches the `Expression_<n>` variant index, so
/// it is the expression the frontend pushes via `set_gl_avatar_expression`.
fn xlu_mask_expression(name: &str) -> Option<u32> {
    name.strip_prefix("Material_XluMask_")?.parse().ok()
}

/// FFL.js (option 1b) path: build one material per expression by cloning the
/// face part's base material and swapping in that expression's mask texture.
/// The face part is the one named `FFL_MASK_MATERIAL_NAME`.
fn build_mask_expression_materials(
    context: &Context,
    model: &Model<PhysicalMaterial>,
    masks: &[MaskTexture],
) -> Result<(HashMap<u32, PhysicalMaterial>, Option<usize>), String> {
    let face_index = model
        .iter()
        .position(|part| part.material.name == FFL_MASK_MATERIAL_NAME)
        .ok_or_else(|| {
            format!("native output: face mask material '{FFL_MASK_MATERIAL_NAME}' not found in GLB")
        })?;
    let base = model[face_index].material.clone();

    let mut expression_materials = HashMap::new();
    for mask in masks {
        let cpu_texture = mask_to_cpu_texture(mask);
        let texture = Texture2DRef::from_cpu_texture(context, &cpu_texture);

        let mut material = base.clone();
        material.albedo = Srgba::WHITE;
        material.albedo_texture = Some(texture);
        material.metallic = 0.0;
        material.roughness = 1.0;
        // The mask is a translucent overlay (transparent around the features).
        material.is_transparent = true;
        material.render_states.blend = Blend::TRANSPARENCY;
        expression_materials.insert(mask.expression, material);
    }

    Ok((expression_materials, Some(face_index)))
}

/// Legacy server-GLB path: rebuild the per-expression face materials from the
/// CpuModel's `Material_XluMask_<n>` materials (three-d drops materials that no
/// primitive references, so the non-default expressions must be rebuilt).
fn build_legacy_expression_materials(
    context: &Context,
    cpu_model: &CpuModel,
    model: &Model<PhysicalMaterial>,
) -> (HashMap<u32, PhysicalMaterial>, Option<usize>) {
    let mut expression_materials = HashMap::new();
    for cpu_material in &cpu_model.materials {
        if let Some(expression) = xlu_mask_expression(&cpu_material.name) {
            let mut material = PhysicalMaterial::from_cpu_material(context, cpu_material);
            material.metallic = 0.0;
            material.roughness = 1.0;
            expression_materials.insert(expression, material);
        }
    }

    let face_part_index = model
        .iter()
        .position(|part| xlu_mask_expression(&part.material.name).is_some());
    (expression_materials, face_part_index)
}

/// Convert a raw-RGBA mask into a three-d CPU texture ready to upload.
fn mask_to_cpu_texture(mask: &MaskTexture) -> CpuTexture {
    let pixels: Vec<[u8; 4]> = mask
        .rgba
        .chunks_exact(4)
        .map(|chunk| [chunk[0], chunk[1], chunk[2], chunk[3]])
        .collect();

    CpuTexture {
        data: TextureData::RgbaU8(pixels),
        width: mask.width,
        height: mask.height,
        ..Default::default()
    }
}

/// Match scene.ts framing: uniformly scale the model so its largest axis spans
/// 1.5 units and centre it on the origin. Returns `(scale, center)` so the
/// render loop can rebuild the transform each frame with the live head pose.
fn model_framing(model: &Model<PhysicalMaterial>) -> (f32, Vec3) {
    let mut aabb = AxisAlignedBoundingBox::EMPTY;
    for part in model.iter() {
        aabb.expand_with_aabb(part.aabb());
    }

    if aabb.is_empty() {
        return (1.0, vec3(0.0, 0.0, 0.0));
    }

    let size = aabb.size();
    let max_axis = size.x.max(size.y).max(size.z).max(1.0e-6);
    let scale = 1.5 / max_axis;
    (scale, aabb.center())
}
