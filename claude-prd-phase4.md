# PRD: MiiTuber Phase 4 Output + Lip-Sync

## Audience

This document is for the Claude/Codex instance working on the MiiTuber Tauri app
(frontend TypeScript webview + Rust backend), with the FFL renderer-server as a
fixed dependency on `127.0.0.1:5000`.

## Product Summary

MiiTuber is a desktop VTuber-style app that renders user-provided Wii-style
avatar data instead of anime Live2D/VRM models.

- Phase 1: import + static PNG render.
- Phase 2: live pipeline (webcam -> MediaPipe -> blendshapes -> Mii expression + head).
- Phase 3: expression mapping / acting quality (channel decomposition, smoothing,
  hysteresis, min-hold, tuning screen). DONE.

Phase 4 makes the avatar USABLE BY OTHER SOFTWARE. Until now MiiTuber performs
well only inside its own window. Phase 4 gets the Mii into OBS, Zoom, Discord,
and Teams, and makes the mouth driven by voice as well as camera.

## Current Phase

Phase 4: virtual camera output (primary) + amplitude audio lip-sync (fast-follow).

Goal: a user can select MiiTuber as their webcam in any streaming/conferencing
app and appear as their Mii, with the mouth moving in time with their voice.

Out of scope for this phase:

- viseme-level lip-sync (FFL only has open/closed mouth states; low payoff)
- virtual microphone / audio routing
- body / hand tracking
- avatar creator UI
- multi-avatar
- scenes / backgrounds beyond a single configurable background

## Scope Decisions (confirmed with Mohammed)

- Phase 4 = virtual camera PRIMARY, amplitude lip-sync FAST-FOLLOW.
- Virtual camera target: OBS Virtual Camera first (most reliable path on
  Windows). General system virtual camera (any app picks it up) is a stretch goal.
- Lip-sync is amplitude-based, not viseme-based.

## Part A: Virtual Camera Output

### The problem

The rendered Mii currently lives in the Tauri webview only. Other apps cannot
consume it. Phase 4 must publish the rendered frames as a video source the OS /
OBS can read.

### Approach

1. Lock the render loop to a stable, consistent frame rate (target 30 fps, allow
   60). Decouple capture FPS (MediaPipe) from output FPS so a dropped tracking
   frame does not drop an output frame; reuse last expression/pose.
2. Each output frame: render the Mii (Three.js client-side scene from the Phase 2
   baked .glb) to a fixed-resolution canvas (target 1280x720, configurable).
3. Publish frames to the virtual camera sink:
   - OBS Virtual Camera path first (most users already have OBS; lowest risk).
     MiiTuber feeds OBS through an OBS source; OBS Virtual Camera is what other
     apps select as the webcam.
   - Stretch: native Windows virtual camera (Media Foundation / DirectShow
     source) so the dependency on OBS is removed.
4. Frame handoff crosses the webview -> Rust boundary. Rust owns the virtual
   camera sink; the webview produces frames. Keep the Rust side as the boundary,
   consistent with prior phases.

### Requirements

- Stable output FPS with no visible stutter while expressions/head move.
- Configurable output resolution and background (solid color or transparent
  where the consuming app supports it).
- Start/stop virtual camera from the app UI; clear state indicator.
- Graceful behavior if OBS / the virtual cam driver is not installed (detect and
  tell the user what to install, do not crash).

### Open questions

- Transparency: the MJPEG Browser Source path uses JPEG frames and cannot carry
  alpha. Solid background is the default for OBS Virtual Camera / conferencing;
  transparent compositing inside OBS uses the PNG-backed transparent Browser
  Source page.
- Native virtual camera is significantly more work than the OBS path. Confirm OBS
  path ships first and native is a follow-up, not a blocker.

## Part B: Amplitude Audio Lip-Sync

### What it is

Drive the mouth from the MICROPHONE in addition to the camera. Louder mic ->
mouth more open. This is more reliable than camera jaw tracking: it works when
the user looks away, in poor lighting, and at lower latency.

### How it maps to FFL (confirmed in renderer)

The "mouth open" state is an expression-pair toggle. Each emotion has an
open-mouth twin (`server-impl/ffl-testing-web-server.go` ~1198-1207):

```text
NORMAL(0)   <-> OPEN_MOUTH(6)
SMILE(1)    <-> HAPPY(7)
ANGER(2)    <-> ANGER_OPEN_MOUTH(8)
SORROW(3)   <-> SORROW_OPEN_MOUTH(9)
SURPRISE(4) <-> SURPRISE_OPEN_MOUTH(10)
BLINK(5)    <-> BLINK_OPEN_MOUTH(11)
WINK_L(12)  <-> WINK_LEFT_OPEN_MOUTH(14)
WINK_R(13)  <-> WINK_RIGHT_OPEN_MOUTH(15)
```

So lip-sync does not pick a new expression. It only flips the MOUTH channel
(the open/closed bit) that Phase 3's composition step already consumes. The
emotion and eye channels keep coming from the camera.

### Approach

1. Capture mic input (Web Audio API in the webview, or Rust audio capture).
2. Compute a smoothed amplitude / RMS envelope per frame.
3. Calibrate a noise floor (silence) and a speaking level, like the Phase 3
   neutral calibration, so room noise does not flap the mouth.
4. Threshold with hysteresis + min-hold (reuse Phase 3 machinery) -> mouth
   open/closed.
5. Feed that into Phase 3's MOUTH channel. Add a source selector:
   camera jaw / mic / max-of-both. Default: mic for mouth, camera for the rest.

### Requirements

- Mouth tracks speech with low perceived latency (< ~100 ms).
- Silence keeps the mouth closed (no idle flapping).
- Mic device selectable; handle no-mic gracefully (fall back to camera jaw).
- Lip-sync params (threshold, hysteresis, min-hold, smoothing) exposed in the
  Phase 3 tuning screen alongside the existing channels.

### Open questions

- Source-of-truth when both camera and mic disagree: recommend `max(camera,
  mic)` so either opening the mouth or speaking opens it.
- Whether to gate lip-sync mouth-open against incompatible expressions (e.g. a
  surprise frame already implies open mouth).

## Build Order

1. Stable decoupled render/output loop at fixed FPS (foundation for the camera).
2. Render Mii to an offscreen canvas at output resolution.
3. OBS Virtual Camera sink + start/stop UI + missing-driver detection.
4. Mic capture + amplitude envelope + silence calibration.
5. Wire mic amplitude into Phase 3 MOUTH channel + source selector.
6. Add lip-sync params to the tuning screen.
7. After OBS-first verification: native Windows virtual camera source so
   MiiTuber appears as its own webcam device.

## Product Constraints

- Renderer stays a fixed local dependency. No renderer changes in Phase 4.
- All new logic lives in the Tauri app (webview TypeScript + Rust backend).
- Rust remains the boundary; it owns the virtual camera sink.
- Keep renderer calls local; do not expose the renderer's lower-level port.
- Keep explanations concrete: this project is also Mohammed's learning vehicle.
- No features beyond output + lip-sync this phase.
