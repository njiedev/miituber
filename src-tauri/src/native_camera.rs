#[cfg(target_os = "windows")]
use std::process::Command;

pub(crate) const NATIVE_CAMERA_DEVICE_NAME: &str = "MiiTuber Camera";
const WINDOWS_VIRTUAL_CAMERA_MIN_BUILD: u32 = 22000;

#[derive(Default)]
pub(crate) struct NativeCameraSinkState {
    pub(crate) device_probe_available: bool,
    pub(crate) device_installed: bool,
    pub(crate) raw_frame_sink_ready: bool,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) fps: u32,
    pub(crate) published_frame_count: u64,
    pub(crate) last_frame_bytes: usize,
}

impl NativeCameraSinkState {
    pub(crate) fn configure_output(&mut self, width: u32, height: u32, fps: u32) {
        self.width = width;
        self.height = height;
        self.fps = fps;
        self.published_frame_count = 0;
        self.last_frame_bytes = 0;
    }

    pub(crate) fn clear_output(&mut self) {
        self.width = 0;
        self.height = 0;
        self.fps = 0;
        self.published_frame_count = 0;
        self.last_frame_bytes = 0;
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

        crate::expected_rgba_frame_len(self.width, self.height)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeCameraStatus {
    pub(crate) platform_supported: bool,
    pub(crate) windows_virtual_camera_api_supported: bool,
    pub(crate) windows_build: Option<u32>,
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

pub(crate) fn native_camera_device_list_contains_miituber(device_list: &str) -> bool {
    device_list
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case(NATIVE_CAMERA_DEVICE_NAME))
}

pub(crate) fn parse_windows_build_number(output: &str) -> Option<u32> {
    output.lines().find_map(|line| line.trim().parse().ok())
}
