# Phase 4 Native Windows Camera Plan

Date: 2026-06-15

Goal: make `MiiTuber Camera` appear as a real Windows camera device so OBS,
Discord, Zoom, Teams, and browsers can select MiiTuber directly without using
OBS as the bridge.

## Current Boundary

The app already has the right producer side:

- Webview renders fixed-resolution frames at 30 or 60 fps.
- Rust owns output session state.
- Rust receives each published frame through `publish_virtual_camera_frame`.
- Rust stores the latest opaque, transparent, and raw RGBA frames in
  `OutputFrameStore`.
- Rust owns a managed `NativeCameraSinkState` for eventual Windows device
  detection and raw-frame sink readiness.
- Native camera state/probing/status logic now lives behind a dedicated Rust
  `native_camera` module so the Media Foundation source code has a focused home.
- On Windows, `get_native_camera_status` probes local PnP camera/media/image
  friendly names and marks `deviceInstalled` when `MiiTuber Camera` exists.
- The native status also reports `deviceProbeAvailable` so a failed Windows
  device query is not presented as "camera not installed."
- The native status reports the Windows build and whether the Windows 11
  virtual camera API floor is met before attempting device/source work.
- Raw-frame readiness is reported only when both the device is installed and the
  native sink says it is ready.
- Start Output calls `start_native_camera_sink` with the current width, height,
  and fps; Stop Output calls `stop_native_camera_sink` to clear the format,
  readiness, and frame counters.
- `publish_virtual_camera_frame` already calls the native sink handoff hook;
  today it is a no-op until `rawFrameSinkReady` is true.
- Rust tests cover both the dormant no-op path and the ready-sink path that
  requires raw RGBA frames.
- Until the Media Foundation sink exists, the lifecycle hook keeps
  `rawFrameSinkReady` false even if device probing finds a matching friendly
  name.
- The native camera module can convert webview RGBA frames into BGRA buffers,
  matching a common Windows RGB32-style memory layout for the future media
  source.
- On Windows, the native module now has a Media Foundation backend wrapper that
  can query `MFIsVirtualCameraTypeSupported` for software virtual cameras.
- Native status reports whether that backend probe succeeded and whether Media
  Foundation says software virtual cameras are supported.
- Native camera registration identity is centralized as friendly name
  `MiiTuber Camera` and source id `{8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}`.
  The source id is a COM CLSID string because `MFCreateVirtualCamera` uses it to
  activate the custom Media Foundation source.
- The Windows backend now has a guarded `MFCreateVirtualCamera` wrapper that can
  create and immediately remove a session-lifetime, current-user virtual camera
  registration for `MiiTuber Camera`. The automated test is ignored by default
  because it touches OS camera registration state.
- Native status now probes whether the source CLSID is registered under
  `HKEY_CLASSES_ROOT\CLSID\{8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}\InprocServer32`.
  This is separate from device probing because the COM source class must exist
  before Windows can activate the virtual camera source.
- The repo now has a separate `src-tauri/native-camera-source` cdylib crate for
  the COM DLL that Windows Camera Frame Server will load. It exports the standard
  COM DLL entry points, shares the same CLSID, and intentionally returns
  "not implemented / class unavailable" until the `IMFMediaSource` exists.
- When raw-frame delivery is enabled, the native sink stores the latest BGRA
  frame snapshot, including frame index, resolution, fps, stride, Media
  Foundation 100ns sample timing, and bytes, for the future source to read.
- Rust currently exposes those frames through JPEG/MJPEG/PNG HTTP endpoints for
  OBS Browser Source.

The native camera should attach at the same Rust boundary. The webview should
not know whether frames go to MJPEG, OBS, or a Windows camera device.
That means the native camera sink should consume from `OutputFrameStore`, not
from the HTTP route handlers.

## Recommended Architecture

1. Keep the OBS HTTP stream as the first proven transport.
2. Add a Windows-only native camera sink behind the Rust output session.
3. Keep Windows-specific camera registration/source code inside the
   `native_camera` module boundary.
4. Convert each frame from the webview's encoded image format into the pixel
   format required by the Windows camera sink.
5. Feed the sink on the existing fixed-FPS output cadence.
6. Report native device availability separately from OBS availability.

The webview can publish raw RGBA bytes alongside the JPEG/PNG frames. RGBA is
much larger than JPEG, so the app only captures and sends it when
`get_native_camera_status` reports `rawFrameSinkReady: true`. This gives the
future Windows sink a camera-friendly buffer without making the OBS path pay the
raw-frame cost. The output diagnostics show `Raw frames` so OBS testing can
confirm the raw path is off until the native sink exists.
The first native buffer format is BGRA because converting from webview RGBA is a
single red/blue channel swap per pixel and maps cleanly to Windows RGB32-style
buffers; NV12 can be added later if a target app or API path requires it.
The native sink keeps the latest converted BGRA frame as a snapshot so the
future source implementation can read the newest complete frame without knowing
about the webview's RGBA format. The snapshot includes stride because Windows
media buffers are copied row-by-row, and includes sample time/duration in 100ns
units because that is the Media Foundation timestamp convention.
When the native sink becomes ready, the `MiiTuber Camera` diagnostic row should
show the number of raw frames handed off and the last raw frame size.
The app refreshes native sink status immediately before Start Output so raw-frame
capture is gated by current readiness, not just the startup check.

## Windows Implementation Track

The native camera will likely need one of these approaches:

- Media Foundation virtual camera source via `MFCreateVirtualCamera`, preferred
  for Windows 11 build 22000+ because Microsoft documents it as a user-mode
  virtual camera path. The current backend wrapper probes API support, prepares
  stable registration strings, and exposes an ignored create/remove registration
  proof, but does not start a frame-producing camera source yet. The `sourceId`
  must be the registered CLSID of that source, not an arbitrary app identifier.
- DirectShow virtual source filter, older but widely supported by conferencing
  apps and a possible fallback if Windows 10 support becomes necessary.

Either path needs a real device registration story. Merely streaming MJPEG from
Rust is not enough for apps to see `MiiTuber Camera` as a webcam.

## First Milestone

- Keep `get_native_camera_status` read-only until there is a real device sink.
- Show when the current Windows build is below the Media Foundation virtual
  camera API floor.
- Show whether Media Foundation software virtual camera support is unavailable
  or explicitly unsupported.
- Show whether the MiiTuber Media Foundation source CLSID is not registered yet.
- Show `MiiTuber Camera not installed yet` in the output diagnostics.
- Show a separate "could not check" state if Windows camera probing fails.
- Use the OBS path to finish the Phase 4 live proof.
- Then replace the dormant lifecycle hook with actual Windows camera
  registration/start/stop work. The first guarded registration wrapper exists;
  the source DLL boundary now exists; the next step is implementing the class
  factory plus `IMFMediaSource` / `IMFMediaStream` so the DLL can serve BGRA
  samples when Windows activates the CLSID.

## Acceptance Proof

Native Windows camera is not done until:

1. Windows lists `MiiTuber Camera` as a camera device.
2. At least one target app can select it directly.
3. Target app self-view shows the avatar without OBS running.
4. Start/stop in MiiTuber starts and stops frame delivery cleanly.
5. Latency and frame smoothness are recorded in
   `PHASE4-OBS-VERIFICATION.md` or a native-camera successor checklist.
