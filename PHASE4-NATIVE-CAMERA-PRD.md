# PRD: MiiTuber Native Windows Camera ("MiiTuber Camera" device)

## Audience

For the Claude/Codex instance working on the MiiTuber Tauri app native camera
layer (Rust: `src-tauri/native-camera-source` crate + `src-tauri/src/native_camera*`).

## Summary

Make MiiTuber appear as its OWN selectable webcam device in Windows, exactly like
VTube Studio. Any app (Zoom, Discord, Meet, OBS) should be able to pick
"MiiTuber Camera" from its camera list and receive the live Mii video, with NO
OBS in the loop.

This is the Phase 4 Part A STRETCH goal that became its own workstream. The
OBS-first path (Browser Source MJPEG / Clean View window capture, see
`PHASE4-SPIKE.md`) already covers users who have OBS. This PRD is for users who do
not, and for a more professional plug-and-play experience.

## Why this is genuinely hard (context, not excuse)

Adding an output option in the app was easy (MJPEG server on 127.0.0.1:49321).
Becoming a camera DEVICE is not. Windows must recognize, trust, and drive the
source through Media Foundation / DirectShow contracts: register a COM class,
expose a stable CLSID, describe the stream (presentation + stream descriptors),
advertise formats, deliver samples on demand, and handle start/stop/shutdown plus
apps probing in unpredictable orders. Registration can succeed while the device
still never appears or refuses to open, because consuming apps require a correct
MF contract before trusting it. This is why it is built in layers, not one shot.

## Current State (grounded in the repo)

Already committed:

- Guarded native virtual camera registration wrapper.
- Stable identity: `MIITUBER_CAMERA_SOURCE_CLSID = {8F9F43F5-5B8C-4C4B-A8A9-26B4E58D2F8B}`
  (`native-camera-source/src/lib.rs`).
- Probe tooling: `NativeCameraSinkState` exposes `device_probe_available`,
  `backend_probe_available`, `source_probe_available`, `source_registered`,
  `raw_frame_sink_ready` (`src-tauri/src/native_camera.rs`).
- Native source DLL scaffold (`native-camera-source` crate).
- Hand-rolled COM `ClassFactory` + vtables for `MediaSource` and `MediaStream`.
- MF media source + media stream skeletons.
- Video format contract: RGB32, 1280x720, 30fps, stream id 1
  (`SourceVideoFormat`, `DEFAULT_WIDTH/HEIGHT/FPS`).
- Descriptor models (pure, tested): `SourceMediaTypeModel` ->
  `SourceStreamDescriptorModel` -> `SourcePresentationDescriptorModel`.
- `windows_backend.rs`: `software_virtual_camera_type_supported()` and
  `create_and_remove_session_virtual_camera()` (modern MFCreateVirtualCamera path).
- Frame plumbing partial: `publish_raw_frame()` validates length, converts
  RGBA->BGRA, computes 100ns sample timestamps; `latest_rgba` already held by the
  output server (`src-tauri/src/lib.rs`, addr 127.0.0.1:49321).
- Source crate tests pass (19).

Uncommitted at time of writing: the pure descriptor model addition above
(presentation descriptor = one selected video stream, 1280x720@30 RGB32).
Pending: rustfmt, docs, full test/build, then commit/push.

## What is still missing (the actual remaining work)

1. Real Media Foundation presentation/stream descriptor COM objects (turn the
   pure descriptor MODELS into live `IMFPresentationDescriptor` /
   `IMFStreamDescriptor` / `IMFMediaType` the OS consumes).
2. Live sample delivery: Tauri renderer frames (`latest_rgba`) ->
   `publish_raw_frame` -> the MF media stream -> `IMFSample`s handed to the app on
   request, paced to 30fps with correct timestamps.
3. Registration/install flow that makes the device appear (and uninstall cleanly).
4. End-to-end verification: device appears AND opens in Windows Camera, OBS,
   Discord, Zoom, Meet.

## CRITICAL DECISION: which Windows API path

The repo currently has TWO half-present approaches. Pick ONE before going further:

- Path 1 - Classic hand-rolled MF media source DLL (the `native-camera-source`
  crate, vtables, class factory). Maximum control, works on Windows 10, but you
  implement the entire MF source contract by hand in unsafe Rust. This is the
  long, finicky road.
- Path 2 - Modern `MFCreateVirtualCamera` (Windows 11 22000+, hinted by
  `windows_backend.rs`). Dramatically less COM plumbing: you still provide a
  registered media source, but Windows owns the device lifetime/registration and
  frame-server integration. Far fewer ways to fail the "appears but won't open"
  trap.

Recommendation: confirm the minimum Windows version you must support. If
Windows 11 is acceptable for the native-camera feature (with OBS path as the
Windows 10 fallback), strongly prefer Path 2 and treat the hand-rolled vtable
work as the source object that Path 2 wraps, not as the whole device. Decide this
explicitly and record it; it determines how much of the classic skeleton is even
needed.

## Frame Pipeline (target)

```text
Three.js scene (webview)
  -> output frames published to Rust (existing, 127.0.0.1:49321 + latest_rgba)
  -> native_camera publish_raw_frame (RGBA -> BGRA, 100ns timestamps)  [exists]
  -> MF media stream delivers IMFSample on request @ 30fps             [MISSING]
  -> Windows frame server / device                                     [MISSING/Path-dependent]
  -> any app selects "MiiTuber Camera"                                 [GOAL]
```

Note: native camera carries no alpha (BGRA/RGB32 opaque). Transparency stays an
OBS-only feature via the Clean View path.

## Build Order (remaining)

1. Decide API path (Path 1 vs Path 2) and record the Windows-version target.
2. Land the uncommitted descriptor model chunk (fmt, docs, tests, build, push).
3. Build live MF descriptor COM objects from the descriptor models.
4. Wire sample delivery: latest_rgba -> media stream -> IMFSample at 30fps.
5. Registration/install + uninstall flow; verify `source_registered` reflects reality.
6. End-to-end open test in Windows Camera, then OBS, Discord, Zoom, Meet.
7. Probe/verify tooling: a `verify:native-camera` style check that asserts
   registered + openable + delivering frames, mirroring `verify:output-stream`.

## Definition of Done

- "MiiTuber Camera" appears in the camera list of Windows Camera, OBS, Discord,
  Zoom, and Meet.
- Selecting it shows the live Mii at 1280x720 ~30fps with acceptable latency.
- Survives app probing order, start/stop, and app close/reopen without orphaned
  state.
- Clean install and uninstall; no leftover COM registration after uninstall.

## Constraints

- Renderer (FFL server) unchanged; this is app-side native work only.
- Keep the OBS-first path working as the fallback (and the only path on
  unsupported Windows versions).
- Distribution note: native camera registration needs an installer with the right
  privileges; account for this in the streamer plug-and-play exe (see distribution
  notes). Do not regress the "just run it" goal.
- Keep explanations concrete: this project is also Mohammed's learning vehicle.
