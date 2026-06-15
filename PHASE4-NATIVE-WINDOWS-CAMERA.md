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

The webview now publishes raw RGBA bytes alongside the JPEG/PNG frames. This is
larger than JPEG, but it gives the future Windows sink a camera-friendly buffer
without coupling native output to MJPEG decoding.

## Windows Implementation Track

The native camera will likely need one of these approaches:

- Media Foundation virtual camera style source, preferred if it can be shipped
  without an installer-hostile driver path.
- DirectShow virtual source filter, older but widely supported by conferencing
  apps.

Either path needs a real device registration story. Merely streaming MJPEG from
Rust is not enough for apps to see `MiiTuber Camera` as a webcam.

## First Milestone

- Keep `get_native_camera_status` read-only until there is a real device sink.
- Show `MiiTuber Camera not installed yet` in the output diagnostics.
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
