# Changelog

Notable changes to MiiTuber. This is a prototype (`0.1.0`), so entries are grouped by theme/phase rather than strict semver releases. Add new entries at the top under **Unreleased** as you ship work.

## Unreleased

### Added
- **Native OpenGL avatar output for OBS** (`src-tauri/src/gl_avatar_output.rs`): renders the avatar GLB in a native Win32 + GL window whose back buffer carries a real alpha channel, so OBS Game Capture + Allow Transparency yields true per-pixel transparency at full FPS. The render is the output — no per-frame pixel copies.
- **Native GL alpha probe** (`src-tauri/src/gl_alpha_probe.rs`): a minimal transparency test that validated the Game Capture alpha path.
- **Live head tracking into the native output**: `set_gl_avatar_pose` command pushes pitch/yaw/roll lock-free each frame; the render loop rebuilds the model transform per frame.
- **Live expression / variant sync in the native output** (`set_gl_avatar_expression` command): the tracked expression index is pushed lock-free each frame and swaps the face material. three-d's `Model` drops materials no primitive references, so the native renderer rebuilds the 19 `Material_XluMask_<expr>` face materials from the `CpuModel` itself (keyed by the name suffix, which matches the `KHR_materials_variants` `Expression_<n>` index) and swaps the face part's material on change.
- **Transparent clean-capture isolate mode** for OBS.
- **Avatar library start screen** with draggable control panels.

### Changed
- Redesigned the UI into a fixed-size, WinRAR-style utility shell.
- FFL GLB loading in the native renderer: strips the custom `_COLOR` vertex attribute (rejected by the Rust `gltf` validator), forces materials diffuse (FFL omits `metallicFactor`, which would render near-black), and enables the `png` feature on `three-d-asset`.

### Docs
- Consolidated scattered planning/process markdown (context, decisions, debug ledger, phase PRDs, agent-bridge notes) into `docs/`: `README`, `ARCHITECTURE`, `AGENTS`, `DESIGN`, `CHANGELOG`. Historical decision records and the transparency-attempt ledger were distilled into `ARCHITECTURE.md` and `AGENTS.md` (hard constraints + rejected approaches).

### Pending
- Checkerboard/preview background parity and shading/colour-fidelity match to the web preview in the native output (deferred: functional before polish).

## Phase history

- **Phase 1 — Pipeline:** Tauri shell; import-only MVP; Rust proxy/validation of avatar bytes to a local FFL renderer; SHA-256 render caching; legacy `.miic` → 96-byte FFSD truncation with recalculated CRC16. Modern 128-byte `.miic` v4 rejected (no converter yet).
- **Phase 2 — Tracking:** One all-expression GLB rendered in a Three.js `AvatarScene`; MediaPipe Face Landmarker in the webview; TypeScript expression mapper with tests; signal hysteresis + expression hold time; separate render/tracking FPS readouts.
- **Phase 3 — Expression quality:** One-Euro blendshape smoothing; JSON tuning profile (thresholds, gains, smoothing, hold time, calibration); neutral-face calibration; debug bars.
- **Phase 4 — Output:** Explored multiple OBS output paths (localhost MJPEG/PNG server, Spout2, native Media Foundation "MiiTuber Camera"). **All removed** for lag and platform-specific surface area in favor of an OBS-captured clean-view window. Added amplitude mic lip-sync with max-of-mic-and-camera mouth source and saved calibration.
- **Phase 5 — Avatar library:** Saved-avatar start screen; UI redesign into the utility shell.

## Breaking changes / migration notes

- **Output architecture:** Spout2, the localhost MJPEG/PNG output server, and the native Media Foundation virtual camera were all removed. Do not depend on them. The supported output is OBS capture of the clean view / native GL window.
- **Window transparency:** the clean-view and native output windows must keep native decorations (`decorations: true`). Frameless windows and chroma-key/colored backgrounds are rejected. See `AGENTS.md`.
