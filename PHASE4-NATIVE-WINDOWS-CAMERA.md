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
- On Windows, `get_native_camera_status` probes local PnP camera/media/image
  friendly names and marks `deviceInstalled` when `MiiTuber Camera` exists.
- The native status also reports `deviceProbeAvailable` so a failed Windows
  device query is not presented as "camera not installed."
- The native status reports the Windows build and whether the Windows 11
  virtual camera API floor is met before attempting device/source work.
- Raw-frame readiness is reported only when both the device is installed and the
  native sink says it is ready.
- Start Output configures `NativeCameraSinkState` with the current width,
  height, and fps; Stop Output clears that format and frame counters.
- `publish_virtual_camera_frame` already calls the native sink handoff hook;
  today it is a no-op until `rawFrameSinkReady` is true.
- Rust tests cover both the dormant no-op path and the ready-sink path that
  requires raw RGBA frames.
- Rust currently exposes those frames through JPEG/MJPEG/PNG HTTP endpoints for
  OBS Browser Source.

The native camera should attach at the same Rust boundary. The webview should
not know whether frames go to MJPEG, OBS, or a Windows camera device.
That means the native camera sink should consume from `OutputFrameStore`, not
from the HTTP route handlers.

## Recommended Architecture

1. Keep the OBS HTTP stream as the first proven transport.
2. Add a Windows-only native camera sink behind the Rust output session.
3. Convert each frame from the webview's encoded image format into the pixel
   format required by the Windows camera sink.
4. Feed the sink on the existing fixed-FPS output cadence.
5. Report native device availability separately from OBS availability.

The webview can publish raw RGBA bytes alongside the JPEG/PNG frames. RGBA is
much larger than JPEG, so the app only captures and sends it when
`get_native_camera_status` reports `rawFrameSinkReady: true`. This gives the
future Windows sink a camera-friendly buffer without making the OBS path pay the
raw-frame cost. The output diagnostics show `Raw frames` so OBS testing can
confirm the raw path is off until the native sink exists.
When the native sink becomes ready, the `MiiTuber Camera` diagnostic row should
show the number of raw frames handed off and the last raw frame size.
The app refreshes native sink status immediately before Start Output so raw-frame
capture is gated by current readiness, not just the startup check.

## Windows Implementation Track

The native camera will likely need one of these approaches:

- Media Foundation virtual camera source via `MFCreateVirtualCamera`, preferred
  for Windows 11 build 22000+ because Microsoft documents it as a user-mode
  virtual camera path.
- DirectShow virtual source filter, older but widely supported by conferencing
  apps and a possible fallback if Windows 10 support becomes necessary.

Either path needs a real device registration story. Merely streaming MJPEG from
Rust is not enough for apps to see `MiiTuber Camera` as a webcam.

## First Milestone

- Keep `get_native_camera_status` read-only until there is a real device sink.
- Show when the current Windows build is below the Media Foundation virtual
  camera API floor.
- Show `MiiTuber Camera not installed yet` in the output diagnostics.
- Show a separate "could not check" state if Windows camera probing fails.
- Use the OBS path to finish the Phase 4 live proof.
- Then replace the placeholder status with actual Windows device detection and
  start/stop hooks.

## Acceptance Proof

Native Windows camera is not done until:

1. Windows lists `MiiTuber Camera` as a camera device.
2. At least one target app can select it directly.
3. Target app self-view shows the avatar without OBS running.
4. Start/stop in MiiTuber starts and stops frame delivery cleanly.
5. Latency and frame smoothness are recorded in
   `PHASE4-OBS-VERIFICATION.md` or a native-camera successor checklist.
