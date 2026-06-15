# Phase 4 Requirements Audit

Last updated: 2026-06-15

Legend:

- `Proven`: current evidence directly satisfies the requirement.
- `Partial`: implementation exists, but runtime evidence is incomplete.
- `Missing`: implementation or evidence is absent.

## Part A: Output

| Requirement | Status | Evidence | Remaining proof |
| --- | --- | --- | --- |
| Stable output FPS decoupled from MediaPipe tracking | Partial | `src/lib/outputFrameLoop.ts` publishes at fixed 30/60 fps and has drop accounting; `src/lib/outputFrameLoop.test.ts` covers frame metadata and dropped ticks. `scripts/verify-output-stream.mjs` can enforce a sampled MJPEG floor with `--min-fps=N`. | Live OBS run should confirm no visible stutter while head/expression state changes, and `npm run verify:output-stream -- http://127.0.0.1:49321 30 --min-fps=24` should pass while output is running. |
| Fixed-resolution output canvas, target 1280x720 configurable | Proven | Output size selector in `index.html`; `AvatarScene.captureJpegFrame` / `capturePngFrame` render at requested width/height; build/tests pass. | None for implementation. Runtime OBS should use matching source size. |
| Rust owns output sink boundary | Proven | Webview invokes `start_virtual_camera` / `publish_virtual_camera_frame`; Rust serves `/frame.jpg`, `/stream.mjpeg`, `/frame.png`, and `/source-transparent.html`. | Native Windows camera remains follow-up after OBS-first verification. |
| Start/stop output UI with clear state | Partial | Start/Stop buttons, output status, URL rows, OBS detection, frame probe, and stream stop behavior are implemented. Rust returns 503 when stream is requested while output is stopped. | Live run should confirm Start Output, Stop Output, and OBS behavior match UI. |
| Graceful OBS/driver missing behavior | Partial | Rust reports whether OBS is detected in common Windows install paths while still allowing portable/non-standard installs; UI shows advisory status. | Verify on a machine without OBS or with portable OBS if this becomes a release gate. |
| Configurable background, solid default, transparent opt-in | Partial | Background color picker and transparent toggle are implemented. MJPEG flattens transparency to solid color. Transparent OBS page uses PNG frames. | Live OBS test must confirm `source-transparent.html` preserves alpha. |
| OBS Browser Source ingest works | Proven | User reported OBS Browser Source displays `http://127.0.0.1:49321/stream.mjpeg` on 2026-06-15. | None for OBS ingest; target-app proof still remains. |
| OBS Virtual Camera into conferencing app | Missing | Verification template exists in `PHASE4-OBS-VERIFICATION.md`. | Select OBS Virtual Camera in Discord/Zoom/Meet and record result, latency, FPS, image cleanliness. |
| Native Windows `MiiTuber Camera` device | Missing | `get_native_camera_status` and `PHASE4-NATIVE-WINDOWS-CAMERA.md` define the boundary and implementation plan. | Implement a real Windows camera device/sink, verify it appears as `MiiTuber Camera`, and confirm a target app can select it without OBS. |

## Part B: Amplitude Lip-Sync

| Requirement | Status | Evidence | Remaining proof |
| --- | --- | --- | --- |
| Capture mic input | Partial | Web Audio `getUserMedia` path is implemented in `src/main.ts`; mic device selector is present. | Live mic permission/device test. |
| Compute smoothed RMS envelope | Proven | `src/lib/lipSync.ts` implements RMS and smoothing; `src/lib/lipSync.test.ts` covers behavior. | None for implementation. |
| Silence calibration / speaking level | Partial | Calibration button records RMS samples and updates `lipSync.noiseFloor` / `speakingLevel`. Profile save/load includes lip-sync settings. | Live calibration should confirm silence keeps mouth closed. |
| Hysteresis + min-hold for mouth channel | Proven | Mic score feeds `mouthOpen` signal; `mouthOpen (camera/mic)` Enter/Exit sliders expose hysteresis; Min hold ms is shared expression hold. Tests cover expression pipeline behavior. | None for implementation; live tuning still useful. |
| Source selector camera / mic / max | Proven | Mouth source select exists and defaults to `max`; `resolveMouthOpenSource` falls back from mic-only to camera when mic is not running; tests cover fallback. | None for implementation. |
| No-mic graceful fallback | Proven | No microphone disables mic start and leaves camera jaw available; mic-only source resolves to camera when mic is stopped/denied/unavailable. | None for implementation. |
| Lip-sync params exposed in tuning screen | Proven | Noise floor, speaking level, smoothing, mouth Enter/Exit hysteresis, and Min hold ms are visible in the tuning panel. | None for implementation. |
| Low perceived latency under 100 ms | Missing | No live measurement recorded. | Run mic lip-sync with OBS output and record perceived mouth latency. |

## Current Completion Gate

Phase 4 is not complete yet.

Required live evidence before marking complete:

1. `npm run verify:output-stream` passes while MiiTuber is publishing output.
2. `npm run verify:output-stream -- http://127.0.0.1:49321 30 --min-fps=24` passes while MiiTuber is publishing 30 fps output.
3. If transparent compositing is part of acceptance, `npm run verify:output-stream -- --transparent` passes.
4. OBS Virtual Camera starts and is selectable in at least one target app.
5. Target app self-view shows the avatar.
6. Latency, frame smoothness, image cleanliness, and resize/move behavior are recorded in `PHASE4-OBS-VERIFICATION.md`.
