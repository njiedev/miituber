use std::sync::{Arc, Mutex};

pub const SPOUT_SENDER_NAME: &str = "MiiTuber";

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpoutOutputStatus {
    pub supported: bool,
    pub running: bool,
    pub sender_name: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frame_count: u64,
    pub last_frame_bytes: usize,
    pub message: String,
}

#[derive(Clone, Copy, Debug)]
pub struct SpoutOutputConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Default)]
pub struct SpoutOutputState {
    session: Option<SpoutSession>,
    frame_count: u64,
    last_frame_bytes: usize,
}

pub type SharedSpoutOutputState = Arc<Mutex<SpoutOutputState>>;

impl SpoutOutputState {
    pub fn start(&mut self, config: SpoutOutputConfig) -> Result<(), String> {
        validate_config(config)?;
        let session = SpoutSession::start(SPOUT_SENDER_NAME, config)?;
        self.session = Some(session);
        self.frame_count = 0;
        self.last_frame_bytes = 0;
        Ok(())
    }

    pub fn stop(&mut self) {
        self.session = None;
        self.frame_count = 0;
        self.last_frame_bytes = 0;
    }

    pub fn publish_rgba(
        &mut self,
        frame_index: u64,
        rgba: Option<&[u8]>,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        let Some(session) = self.session.as_mut() else {
            return Ok(());
        };
        let rgba = rgba.ok_or_else(|| {
            "Spout output is running but no raw RGBA frame was published".to_string()
        })?;
        validate_rgba_frame(rgba, width, height)?;
        session.send_rgba(rgba, width, height)?;
        self.frame_count = frame_index;
        self.last_frame_bytes = rgba.len();
        Ok(())
    }

    pub fn status(&self) -> SpoutOutputStatus {
        let Some(session) = &self.session else {
            return SpoutOutputStatus {
                supported: platform_supported(),
                running: false,
                sender_name: SPOUT_SENDER_NAME.to_string(),
                width: 0,
                height: 0,
                fps: 0,
                frame_count: 0,
                last_frame_bytes: 0,
                message: stopped_message(),
            };
        };

        SpoutOutputStatus {
            supported: platform_supported(),
            running: true,
            sender_name: session.sender_name.clone(),
            width: session.config.width,
            height: session.config.height,
            fps: session.config.fps,
            frame_count: self.frame_count,
            last_frame_bytes: self.last_frame_bytes,
            message: format!(
                "Spout2 sender '{}' is running. In OBS, add Spout2 Capture and select '{}'.",
                session.sender_name, session.sender_name
            ),
        }
    }

    pub fn requires_rgba_frames(&self) -> bool {
        self.session.is_some()
    }
}

struct SpoutSession {
    sender_name: String,
    config: SpoutOutputConfig,
    backend: PlatformSpoutSender,
}

impl SpoutSession {
    fn start(sender_name: &str, config: SpoutOutputConfig) -> Result<Self, String> {
        Ok(Self {
            sender_name: sender_name.to_string(),
            config,
            backend: PlatformSpoutSender::create(sender_name, config)?,
        })
    }

    fn send_rgba(&mut self, rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
        if width != self.config.width || height != self.config.height {
            return Err(format!(
                "Spout output frame size changed from {}x{} to {}x{}",
                self.config.width, self.config.height, width, height
            ));
        }

        self.backend.send_rgba(rgba, width, height)
    }
}

fn validate_config(config: SpoutOutputConfig) -> Result<(), String> {
    if !platform_supported() {
        return Err("Spout2 output is Windows-only.".to_string());
    }

    if config.width == 0 || config.height == 0 {
        return Err("Spout2 output width and height must be greater than zero".to_string());
    }

    if config.fps == 0 {
        return Err("Spout2 output fps must be greater than zero".to_string());
    }

    Ok(())
}

fn validate_rgba_frame(rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
    let expected_len = expected_rgba_len(width, height)?;
    if rgba.len() != expected_len {
        return Err(format!(
            "Spout RGBA frame was {} bytes, expected {expected_len} for {width}x{height}",
            rgba.len()
        ));
    }

    Ok(())
}

fn expected_rgba_len(width: u32, height: u32) -> Result<usize, String> {
    let pixels = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Spout RGBA frame dimensions overflowed".to_string())?;
    usize::try_from(pixels).map_err(|_| "Spout RGBA frame is too large".to_string())
}

fn stopped_message() -> String {
    if platform_supported() {
        "Spout2 output is stopped. Start it, then choose sender 'MiiTuber' in OBS Spout2 Capture."
            .to_string()
    } else {
        "Spout2 output is Windows-only.".to_string()
    }
}

fn platform_supported() -> bool {
    cfg!(target_os = "windows")
}

#[cfg(target_os = "windows")]
mod platform {
    use super::SpoutOutputConfig;
    use std::{
        ffi::{c_char, c_uchar, c_void, CString},
        ptr::NonNull,
    };

    extern "C" {
        fn miituber_spout_create(
            sender_name: *const c_char,
            width: u32,
            height: u32,
        ) -> *mut c_void;
        fn miituber_spout_send_rgba(
            handle: *mut c_void,
            data: *const c_uchar,
            width: u32,
            height: u32,
        ) -> bool;
        fn miituber_spout_destroy(handle: *mut c_void);
    }

    pub struct PlatformSpoutSender {
        handle: NonNull<c_void>,
    }

    impl PlatformSpoutSender {
        pub fn create(sender_name: &str, config: SpoutOutputConfig) -> Result<Self, String> {
            let sender_name = CString::new(sender_name)
                .map_err(|_| "Spout sender name cannot contain NUL bytes".to_string())?;
            let handle =
                unsafe { miituber_spout_create(sender_name.as_ptr(), config.width, config.height) };
            let handle = NonNull::new(handle).ok_or_else(|| {
                "Could not create Spout2 sender. Confirm DirectX 11 is available.".to_string()
            })?;

            Ok(Self { handle })
        }

        pub fn send_rgba(&mut self, rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
            let sent = unsafe {
                miituber_spout_send_rgba(self.handle.as_ptr(), rgba.as_ptr(), width, height)
            };
            if sent {
                Ok(())
            } else {
                Err("Spout2 rejected the RGBA frame".to_string())
            }
        }
    }

    impl Drop for PlatformSpoutSender {
        fn drop(&mut self) {
            unsafe {
                miituber_spout_destroy(self.handle.as_ptr());
            }
        }
    }

    unsafe impl Send for PlatformSpoutSender {}
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::SpoutOutputConfig;

    pub struct PlatformSpoutSender;

    impl PlatformSpoutSender {
        pub fn create(_sender_name: &str, _config: SpoutOutputConfig) -> Result<Self, String> {
            Err("Spout2 output is Windows-only.".to_string())
        }

        pub fn send_rgba(&mut self, _rgba: &[u8], _width: u32, _height: u32) -> Result<(), String> {
            Err("Spout2 output is Windows-only.".to_string())
        }
    }
}

use platform::PlatformSpoutSender;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopped_status_uses_miituber_sender_name() {
        let state = SpoutOutputState::default();
        let status = state.status();

        assert!(!status.running);
        assert_eq!(status.sender_name, "MiiTuber");
        assert_eq!(status.supported, cfg!(target_os = "windows"));
    }

    #[test]
    fn validates_rgba_frame_size() {
        assert!(validate_rgba_frame(&[0; 16], 2, 2).is_ok());
        let error = validate_rgba_frame(&[0; 15], 2, 2).unwrap_err();

        assert!(error.contains("expected 16"));
    }

    #[test]
    fn rejects_zero_sized_output() {
        let error = validate_config(SpoutOutputConfig {
            width: 0,
            height: 720,
            fps: 30,
        })
        .unwrap_err();

        assert!(
            error.contains("Windows-only") || error.contains("width and height"),
            "{error}"
        );
    }
}
