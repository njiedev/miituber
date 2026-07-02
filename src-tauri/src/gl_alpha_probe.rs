//! Native OpenGL alpha probe.
//!
//! Spike to answer one question before any renderer rewrite: can OBS Game
//! Capture + "Allow Transparency" pull a real alpha channel out of a native,
//! opaque (decorated) OpenGL window in this app?
//!
//! It opens a normal `WS_OVERLAPPEDWINDOW` (native title bar / controls kept,
//! per the hard constraint) whose OpenGL back buffer carries an alpha channel.
//! It paints a checkerboard with alpha = 0 and an animated opaque square with
//! alpha = 1. Because the window is opaque on the desktop, DWM ignores the
//! alpha and the user sees the checkerboard + square. OBS Game Capture hooks
//! the GL swap chain and, with "Allow Transparency", should drop the alpha=0
//! checkerboard and keep only the square. There is NO pixel readback anywhere:
//! the rendered back buffer IS the output.

#![cfg(windows)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{GetDC, ReleaseDC};
use windows_sys::Win32::Graphics::OpenGL::{
    glBegin, glClear, glClearColor, glColor4f, glDisable, glEnd, glVertex2f, glViewport,
    wglCreateContext, wglDeleteContext, wglMakeCurrent, ChoosePixelFormat, SetPixelFormat,
    SwapBuffers, GL_BLEND, GL_COLOR_BUFFER_BIT, GL_DEPTH_TEST, GL_QUADS, PFD_DOUBLEBUFFER,
    PFD_DRAW_TO_WINDOW, PFD_MAIN_PLANE, PFD_SUPPORT_OPENGL, PFD_TYPE_RGBA, PIXELFORMATDESCRIPTOR,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, LoadCursorW,
    PeekMessageW, PostQuitMessage, RegisterClassW, TranslateMessage, CS_HREDRAW, CS_OWNDC,
    CS_VREDRAW, CW_USEDEFAULT, IDC_ARROW, MSG, PM_REMOVE, WM_CLOSE, WM_DESTROY, WM_QUIT, WNDCLASSW,
    WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};

/// Guards against opening more than one probe window at a time.
static PROBE_OPEN: AtomicBool = AtomicBool::new(false);

/// Open the probe window on its own thread with its own message pump so it never
/// blocks the Tauri event loop. Returns immediately.
pub fn open() {
    if PROBE_OPEN.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(|| {
        unsafe {
            run_probe_window();
        }
        PROBE_OPEN.store(false, Ordering::SeqCst);
    });
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

unsafe fn run_probe_window() {
    let h_instance = GetModuleHandleW(std::ptr::null());
    let class_name = encode_wide("MiiTuberGlAlphaProbe");
    let title = encode_wide("MiiTuber GL Alpha Probe (OBS Game Capture test)");

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
        return;
    }

    let hdc = GetDC(hwnd);
    if hdc.is_null() {
        DestroyWindow(hwnd);
        return;
    }

    // Request a 32-bit RGBA, double-buffered pixel format WITH an alpha channel.
    // The alpha channel is what OBS Game Capture reads.
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
        return;
    }

    let gl_context = wglCreateContext(hdc);
    if gl_context.is_null() || wglMakeCurrent(hdc, gl_context) == 0 {
        ReleaseDC(hwnd, hdc);
        DestroyWindow(hwnd);
        return;
    }

    // No blending and no depth test, so each fragment's alpha is written
    // straight into the framebuffer alpha channel (0 for background, 1 for the
    // square) instead of being blended away.
    glDisable(GL_BLEND);
    glDisable(GL_DEPTH_TEST);

    let started = Instant::now();
    let mut msg: MSG = std::mem::zeroed();

    loop {
        while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
            if msg.message == WM_QUIT {
                wglMakeCurrent(std::ptr::null_mut(), std::ptr::null_mut());
                wglDeleteContext(gl_context);
                ReleaseDC(hwnd, hdc);
                return;
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let mut rect: RECT = std::mem::zeroed();
        GetClientRect(hwnd, &mut rect);
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        glViewport(0, 0, width, height);

        draw_frame(started.elapsed().as_secs_f32());

        SwapBuffers(hdc);
    }
}

/// Draw an alpha=0 checkerboard background and an animated alpha=1 opaque
/// square. Everything is in normalized device coordinates (-1..1).
unsafe fn draw_frame(time_secs: f32) {
    // Clear color carries alpha 0 so any untouched pixel is fully transparent
    // to OBS while still showing its RGB on the opaque desktop window.
    glClearColor(0.55, 0.55, 0.55, 0.0);
    glClear(GL_COLOR_BUFFER_BIT);

    // Checkerboard: 8x8 grid, two grey shades, all alpha = 0.
    const CELLS: i32 = 8;
    let step = 2.0_f32 / CELLS as f32;
    glBegin(GL_QUADS);
    for row in 0..CELLS {
        for col in 0..CELLS {
            let shade = if (row + col) % 2 == 0 { 0.78 } else { 0.55 };
            glColor4f(shade, shade, shade, 0.0);

            let x0 = -1.0 + col as f32 * step;
            let y0 = -1.0 + row as f32 * step;
            let x1 = x0 + step;
            let y1 = y0 + step;

            glVertex2f(x0, y0);
            glVertex2f(x1, y0);
            glVertex2f(x1, y1);
            glVertex2f(x0, y1);
        }
    }
    glEnd();

    // Opaque square (alpha = 1) drifting horizontally so liveness / FPS is
    // obvious. This is what should survive in OBS with Allow Transparency.
    let offset = 0.45 * time_secs.sin();
    let half = 0.28_f32;
    glBegin(GL_QUADS);
    glColor4f(0.91, 0.16, 0.20, 1.0);
    glVertex2f(offset - half, -half);
    glVertex2f(offset + half, -half);
    glVertex2f(offset + half, half);
    glVertex2f(offset - half, half);
    glEnd();
}
