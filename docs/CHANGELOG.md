# Changelog

Notable changes to MiiTuber. This is a prototype (`0.1.0`), so entries are grouped by theme/phase rather than strict semver releases. Add new entries at the top under **Unreleased** as you ship work.

## Unreleased

### Added
- **First-run onboarding tour** with separate library and workspace chapters, a replay `?` button, typewriter dialogue, Mii portrait frame-flips, optional Mii SFX, and a spotlight overlay. Completion is stored per chapter under `miituber.onboardingTour.v1`, and the overlay is hidden from clean-output/capture-isolate modes.
- **Waitlist landing page** (`landing/`, built via `npm run dev:landing` / `build:landing`). A one-viewport faux MiiTuber window styled with the app's own tokens: live FFL.js Mii over the OBS alpha checkerboard, cursor-following head, heart-eyes (26) + arms-up pose on waitlist-button hover, BIG_SMILE (32) on signup success / CRY (30) on failure, idle `Wait00` animation, wink-on-poke easter egg, and an X/Twitter link chip in the appbar. Extended expressions ride a new opt-in `extraExpressions` param on `createCharModel` (app behavior unchanged — extras must be baked at CharModel creation). Waitlist endpoint is a placeholder const (`WAITLIST_ENDPOINT` in `landing/main.ts`) with a mailto fallback. Rig note: the body GLB's real arm chain is `chest → arm_l1 → arm_l2 → wrist`; the `shoulder_*`/`elbow_*` nodes are leaf helper joints.
- **Transparent clean-capture isolate mode** for OBS.
- **Avatar library start screen** with draggable control panels.

### Changed
- Redesigned the UI into a fixed-size, WinRAR-style utility shell.

### Removed
- **Native OpenGL avatar output + GL alpha probe (parked).** The native Win32 + GL renderer (`gl_avatar_output.rs`, `gl_alpha_probe.rs`), its Tauri commands (`open_gl_avatar_output`, `open_gl_alpha_probe`, `set_gl_avatar_pose`, `set_gl_avatar_expression`), the frontend export path (`src/lib/fflExport.ts`), and the `three-d`/`three-d-asset`/`gltf`/`windows-sys` dependencies were removed from the active build. The path is **parked, not abandoned** — it hit a fidelity blocker (three-d's generic PBR can't reproduce FFL's shader: flat surfaces, grey eyebrows, no hair glow). Goal, root cause, and resume plan are in `docs/research/roadmap.md`; the code is preserved on the `ffl-swap-complete` and `testing-game-capture` branches. The active OBS output is Clean View + Window Capture.

### Docs
- Consolidated scattered planning/process markdown (context, decisions, debug ledger, phase PRDs, agent-bridge notes) into `docs/`: `README`, `ARCHITECTURE`, `AGENTS`, `DESIGN`, `CHANGELOG`. Historical decision records and the transparency-attempt ledger were distilled into `ARCHITECTURE.md` and `AGENTS.md` (hard constraints + rejected approaches).

## Phase history

- **Phase 1 — Pipeline:** Tauri shell; import-only MVP; Rust proxy/validation of avatar bytes to a local FFL renderer; SHA-256 render caching; legacy `.miic` → 96-byte FFSD truncation with recalculated CRC16. Modern 128-byte `.miic` v4 rejected (no converter yet).
- **Phase 2 — Tracking:** One all-expression GLB rendered in a Three.js `AvatarScene`; MediaPipe Face Landmarker in the webview; TypeScript expression mapper with tests; signal hysteresis + expression hold time; separate render/tracking FPS readouts.
- **Phase 3 — Expression quality:** One-Euro blendshape smoothing; JSON tuning profile (thresholds, gains, smoothing, hold time, calibration); neutral-face calibration; debug bars.
- **Phase 4 — Output:** Explored multiple OBS output paths (localhost MJPEG/PNG server, Spout2, native Media Foundation "MiiTuber Camera"). **All removed** for lag and platform-specific surface area in favor of an OBS-captured clean-view window. Added amplitude mic lip-sync with max-of-mic-and-camera mouth source and saved calibration.
- **Phase 5 — Avatar library:** Saved-avatar start screen; UI redesign into the utility shell.

## Breaking changes / migration notes

- **Output architecture:** Spout2, the localhost MJPEG/PNG output server, and the native Media Foundation virtual camera were all removed. Do not depend on them. The supported output is OBS capture of the clean view / native GL window.
- **Window transparency:** the clean-view and native output windows must keep native decorations (`decorations: true`). Frameless windows and chroma-key/colored backgrounds are rejected. See `AGENTS.md`.
