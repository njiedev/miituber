#[cfg(target_os = "windows")]
mod windows_backend;

#[cfg(target_os = "windows")]
use std::process::Command;

pub(crate) const NATIVE_CAMERA_DEVICE_NAME: &str = "MiiTuber Camera";
pub(crate) const NATIVE_CAMERA_SOURCE_ID: &str = "{8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}";
const WINDOWS_VIRTUAL_CAMERA_MIN_BUILD: u32 = 22000;
const MEDIA_TIME_UNITS_PER_SECOND: u64 = 10_000_000;

#[derive(Clone, Default)]
pub(crate) struct NativeCameraSinkState {
    pub(crate) device_probe_available: bool,
    pub(crate) device_installed: bool,
    pub(crate) backend_probe_available: bool,
    pub(crate) backend_supported: bool,
    pub(crate) source_probe_available: bool,
    pub(crate) source_registered: bool,
    pub(crate) raw_frame_sink_ready: bool,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) fps: u32,
    pub(crate) published_frame_count: u64,
    pub(crate) last_frame_bytes: usize,
    latest_frame: Option<NativeCameraFrameSnapshot>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct NativeCameraOutputConfig {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) fps: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeCameraRegistrationDescriptor {
    pub(crate) friendly_name: &'static str,
    pub(crate) source_id: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeCameraFrameSnapshot {
    pub(crate) frame_index: u64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) fps: u32,
    pub(crate) stride_bytes: usize,
    pub(crate) sample_time_100ns: u64,
    pub(crate) sample_duration_100ns: u64,
    pub(crate) bgra_bytes: Vec<u8>,
}

impl NativeCameraSinkState {
    fn configure_output(&mut self, width: u32, height: u32, fps: u32) {
        self.width = width;
        self.height = height;
        self.fps = fps;
        self.published_frame_count = 0;
        self.last_frame_bytes = 0;
        self.latest_frame = None;
    }

    fn clear_output(&mut self) {
        self.width = 0;
        self.height = 0;
        self.fps = 0;
        self.published_frame_count = 0;
        self.last_frame_bytes = 0;
        self.latest_frame = None;
    }

    pub(crate) fn publish_raw_frame(
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

        let bgra_bytes = rgba_to_bgra_frame(rgba_bytes)?;
        let snapshot = NativeCameraFrameSnapshot {
            frame_index,
            width: self.width,
            height: self.height,
            fps: self.fps,
            stride_bytes: native_camera_bgra_stride_bytes(self.width)?,
            sample_time_100ns: native_camera_sample_time_100ns(frame_index, self.fps)?,
            sample_duration_100ns: native_camera_sample_duration_100ns(self.fps)?,
            bgra_bytes,
        };
        self.published_frame_count = frame_index;
        self.last_frame_bytes = snapshot.bgra_bytes.len();
        self.latest_frame = Some(snapshot);
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn latest_frame(&self) -> Option<NativeCameraFrameSnapshot> {
        self.latest_frame.clone()
    }

    fn expected_raw_frame_len(&self) -> Result<usize, String> {
        if self.width == 0 || self.height == 0 || self.fps == 0 {
            return Err(
                "Native camera sink is ready, but no output format is configured".to_string(),
            );
        }

        crate::expected_rgba_frame_len(self.width, self.height)
    }
}

pub(crate) fn start_native_camera_sink(
    sink: &mut NativeCameraSinkState,
    config: NativeCameraOutputConfig,
) -> Result<(), String> {
    sink.configure_output(config.width, config.height, config.fps);
    sink.raw_frame_sink_ready = native_camera_sink_ready_for_config(sink, config);
    Ok(())
}

pub(crate) fn native_camera_registration_descriptor() -> NativeCameraRegistrationDescriptor {
    NativeCameraRegistrationDescriptor {
        friendly_name: NATIVE_CAMERA_DEVICE_NAME,
        source_id: NATIVE_CAMERA_SOURCE_ID,
    }
}

pub(crate) fn stop_native_camera_sink(sink: &mut NativeCameraSinkState) {
    sink.raw_frame_sink_ready = false;
    sink.clear_output();
}

pub(crate) fn rgba_to_bgra_frame(rgba_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut chunks = rgba_bytes.chunks_exact(4);
    if !chunks.remainder().is_empty() {
        return Err(format!(
            "Raw RGBA frame had {} bytes, which is not divisible into 4-byte pixels",
            rgba_bytes.len()
        ));
    }

    let mut bgra_bytes = Vec::with_capacity(rgba_bytes.len());
    for pixel in &mut chunks {
        bgra_bytes.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
    }

    Ok(bgra_bytes)
}

pub(crate) fn native_camera_bgra_stride_bytes(width: u32) -> Result<usize, String> {
    let bytes = u64::from(width)
        .checked_mul(4)
        .ok_or_else(|| "Native camera BGRA stride overflowed".to_string())?;

    usize::try_from(bytes).map_err(|_| "Native camera BGRA stride is too large".to_string())
}

pub(crate) fn native_camera_sample_duration_100ns(fps: u32) -> Result<u64, String> {
    if fps == 0 {
        return Err("Native camera sample duration requires non-zero fps".to_string());
    }

    Ok(MEDIA_TIME_UNITS_PER_SECOND / u64::from(fps))
}

pub(crate) fn native_camera_sample_time_100ns(frame_index: u64, fps: u32) -> Result<u64, String> {
    let duration = native_camera_sample_duration_100ns(fps)?;
    frame_index
        .checked_mul(duration)
        .ok_or_else(|| "Native camera sample timestamp overflowed".to_string())
}

fn native_camera_sink_ready_for_config(
    sink: &NativeCameraSinkState,
    config: NativeCameraOutputConfig,
) -> bool {
    let _ = (sink, config);
    let _ = native_camera_backend_probe();
    let _ = native_camera_source_probe();
    let _ = native_camera_registration_ready();

    false
}

fn native_camera_registration_ready() -> bool {
    #[cfg(target_os = "windows")]
    {
        let descriptor = native_camera_registration_descriptor();
        match windows_backend::WindowsVirtualCameraRegistrationStrings::from_descriptor(&descriptor)
        {
            Ok(_) => true,
            Err(error) => {
                eprintln!("native_camera_registration_ready: {error}");
                false
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct NativeCameraBackendProbe {
    pub(crate) available: bool,
    pub(crate) supported: bool,
}

pub(crate) fn native_camera_backend_probe() -> NativeCameraBackendProbe {
    #[cfg(target_os = "windows")]
    {
        match windows_backend::software_virtual_camera_type_supported() {
            Ok(supported) => NativeCameraBackendProbe {
                available: true,
                supported,
            },
            Err(error) => {
                eprintln!("native_camera_backend_probe: {error}");
                NativeCameraBackendProbe {
                    available: false,
                    supported: false,
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        NativeCameraBackendProbe {
            available: false,
            supported: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct NativeCameraSourceProbe {
    pub(crate) available: bool,
    pub(crate) registered: bool,
}

pub(crate) fn native_camera_source_probe() -> NativeCameraSourceProbe {
    #[cfg(target_os = "windows")]
    {
        match native_camera_windows_source_registered() {
            Ok(registered) => NativeCameraSourceProbe {
                available: true,
                registered,
            },
            Err(error) => {
                eprintln!("native_camera_source_probe: {error}");
                NativeCameraSourceProbe {
                    available: false,
                    registered: false,
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        NativeCameraSourceProbe {
            available: false,
            registered: false,
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeCameraStatus {
    pub(crate) platform_supported: bool,
    pub(crate) windows_virtual_camera_api_supported: bool,
    pub(crate) windows_build: Option<u32>,
    pub(crate) backend_probe_available: bool,
    pub(crate) backend_supported: bool,
    pub(crate) source_probe_available: bool,
    pub(crate) source_registered: bool,
    pub(crate) device_probe_available: bool,
    pub(crate) device_installed: bool,
    pub(crate) raw_frame_sink_ready: bool,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) fps: u32,
    pub(crate) published_frame_count: u64,
    pub(crate) last_frame_bytes: usize,
    pub(crate) device_name: String,
    pub(crate) message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct NativeCameraDeviceProbe {
    pub(crate) available: bool,
    pub(crate) installed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct NativeCameraPlatformProbe {
    pub(crate) windows_build: Option<u32>,
    pub(crate) virtual_camera_api_supported: bool,
}

pub(crate) fn native_camera_status_from_sink(
    sink: &NativeCameraSinkState,
    windows_build: Option<u32>,
    windows_virtual_camera_api_supported: bool,
) -> NativeCameraStatus {
    let device_name = NATIVE_CAMERA_DEVICE_NAME.to_string();
    let raw_frame_sink_ready = sink.device_installed && sink.raw_frame_sink_ready;

    #[cfg(target_os = "windows")]
    {
        NativeCameraStatus {
            platform_supported: true,
            windows_virtual_camera_api_supported,
            windows_build,
            backend_probe_available: sink.backend_probe_available,
            backend_supported: sink.backend_supported,
            source_probe_available: sink.source_probe_available,
            source_registered: sink.source_registered,
            device_probe_available: sink.device_probe_available,
            device_installed: sink.device_installed,
            raw_frame_sink_ready,
            width: sink.width,
            height: sink.height,
            fps: sink.fps,
            published_frame_count: sink.published_frame_count,
            last_frame_bytes: sink.last_frame_bytes,
            device_name,
            message: native_camera_status_message(
                sink,
                raw_frame_sink_ready,
                windows_build,
                windows_virtual_camera_api_supported,
            ),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (windows_build, windows_virtual_camera_api_supported);

        NativeCameraStatus {
            platform_supported: false,
            windows_virtual_camera_api_supported: false,
            windows_build: None,
            backend_probe_available: false,
            backend_supported: false,
            source_probe_available: false,
            source_registered: false,
            device_probe_available: false,
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
pub(crate) fn native_camera_platform_probe() -> NativeCameraPlatformProbe {
    let script = "[Environment]::OSVersion.Version.Build";
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output();

    let windows_build = match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_windows_build_number(&stdout)
        }
        Ok(output) => {
            eprintln!(
                "native_camera_platform_probe: PowerShell exited with status {:?}",
                output.status.code()
            );
            None
        }
        Err(error) => {
            eprintln!("native_camera_platform_probe: could not run PowerShell: {error}");
            None
        }
    };

    NativeCameraPlatformProbe {
        windows_build,
        virtual_camera_api_supported: windows_build
            .is_some_and(|build| build >= WINDOWS_VIRTUAL_CAMERA_MIN_BUILD),
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn native_camera_platform_probe() -> NativeCameraPlatformProbe {
    NativeCameraPlatformProbe {
        windows_build: None,
        virtual_camera_api_supported: false,
    }
}

#[cfg(target_os = "windows")]
fn native_camera_status_message(
    sink: &NativeCameraSinkState,
    raw_frame_sink_ready: bool,
    windows_build: Option<u32>,
    windows_virtual_camera_api_supported: bool,
) -> String {
    if raw_frame_sink_ready {
        "Native Windows camera sink is ready for raw frames.".to_string()
    } else if !windows_virtual_camera_api_supported {
        match windows_build {
            Some(build) => format!(
                "This Windows build ({build}) is below the Windows 11 virtual camera API floor ({WINDOWS_VIRTUAL_CAMERA_MIN_BUILD}). Use the OBS Browser Source path for now."
            ),
            None => "Could not check whether this Windows version supports the native virtual camera API. Use the OBS Browser Source path for now.".to_string(),
        }
    } else if !sink.backend_probe_available {
        "Could not query Media Foundation software virtual camera support. Use the OBS Browser Source path for now.".to_string()
    } else if !sink.backend_supported {
        "Media Foundation reports software virtual cameras are not supported on this system. Use the OBS Browser Source path for now.".to_string()
    } else if !sink.source_probe_available {
        "Could not check whether the MiiTuber Media Foundation source CLSID is registered. Use the OBS Browser Source path for now.".to_string()
    } else if !sink.source_registered {
        "MiiTuber Media Foundation source CLSID is not registered yet. Use the OBS Browser Source path for now; native camera work still needs the source class.".to_string()
    } else if !sink.device_probe_available {
        "Could not check whether the native Windows camera device is installed. Use the OBS Browser Source path for now; the Windows camera sink will attach to the same output frames.".to_string()
    } else if sink.device_installed {
        "Native Windows camera device is installed, but the frame sink is not ready yet. Use the OBS Browser Source path for now.".to_string()
    } else {
        "Native Windows camera device is not installed yet. Use the OBS Browser Source path for now; the Windows camera sink will attach to the same output frames.".to_string()
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn native_camera_device_probe() -> NativeCameraDeviceProbe {
    let script = "Get-PnpDevice -Class Camera,Image,Media -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FriendlyName";
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            NativeCameraDeviceProbe {
                available: true,
                installed: native_camera_device_list_contains_miituber(&stdout),
            }
        }
        Ok(output) => {
            eprintln!(
                "native_camera_device_probe: PowerShell exited with status {:?}",
                output.status.code()
            );
            NativeCameraDeviceProbe {
                available: false,
                installed: false,
            }
        }
        Err(error) => {
            eprintln!("native_camera_device_probe: could not run PowerShell: {error}");
            NativeCameraDeviceProbe {
                available: false,
                installed: false,
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn native_camera_device_probe() -> NativeCameraDeviceProbe {
    NativeCameraDeviceProbe {
        available: false,
        installed: false,
    }
}

#[cfg(target_os = "windows")]
fn native_camera_windows_source_registered() -> Result<bool, String> {
    let escaped_source_id = NATIVE_CAMERA_SOURCE_ID.replace('\'', "''");
    let script = format!(
        "Test-Path -LiteralPath 'Registry::HKEY_CLASSES_ROOT\\CLSID\\{escaped_source_id}\\InprocServer32'"
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Ok(parse_powershell_bool(&stdout).unwrap_or(false))
        }
        Ok(output) => Err(format!(
            "PowerShell exited with status {:?} while checking source CLSID registration",
            output.status.code()
        )),
        Err(error) => Err(format!(
            "could not run PowerShell while checking source CLSID registration: {error}"
        )),
    }
}

pub(crate) fn native_camera_device_list_contains_miituber(device_list: &str) -> bool {
    device_list
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case(NATIVE_CAMERA_DEVICE_NAME))
}

pub(crate) fn parse_windows_build_number(output: &str) -> Option<u32> {
    output.lines().find_map(|line| line.trim().parse().ok())
}

pub(crate) fn parse_powershell_bool(output: &str) -> Option<bool> {
    output.lines().find_map(|line| match line.trim() {
        "True" | "true" => Some(true),
        "False" | "false" => Some(false),
        _ => None,
    })
}
