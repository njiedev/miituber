# MiiTuber Agent Context

Use this file to brief any AI agent working on, describing, designing around, researching, or summarizing the MiiTuber project. It is intentionally broad: it should help with engineering tasks, UX/design work, resume bullet writing, tool comparison research, product planning, documentation, and project storytelling.

## One-Sentence Summary

MiiTuber is a local-first desktop VTuber prototype that lets a user import Wii-style Mii avatar data, render it as a 3D head through a local FFL renderer, animate it with webcam face tracking and optional microphone lip-sync, and capture a clean avatar output in OBS.

## Short Product Summary

MiiTuber is a Tauri desktop app for turning Wii-style avatar data into a live, streamable avatar. The app imports supported Mii data files, asks a local FFL renderer server for a GLB with all expression variants, displays the avatar in a Three.js scene, maps MediaPipe webcam face-tracking data to discrete Mii expressions and head rotation, optionally uses microphone amplitude for mouth movement, and provides a separate OBS Clean View window for capturing the avatar without the control UI.

The product is not an anime Live2D/VRM avatar tool. Its identity is specifically around Wii-style/Mii-style avatars and local rendering.

## Current Status

The app is a working local prototype. It has import, GLB rendering, Three.js display, manual expression switching, webcam face tracking, expression smoothing/tuning, microphone lip-sync, and an OBS Clean View window.

Current practical output path: OBS captures the separate Clean View window. Earlier virtual-camera, MJPEG, PNG, Spout, and native Windows camera experiments were explored or discussed, but the current chosen working baseline is the OBS Clean View window.

## Primary User

The primary user is a streamer, video caller, or creator who wants to appear as a Wii-style avatar in OBS, Discord, Zoom, Teams, or similar software. The user likely wants:

- A simple setup path: import avatar, render, start tracking, open output.
- Low-friction OBS capture.
- Local privacy for camera and microphone input.
- Enough tuning controls to make the avatar feel expressive and stable.
- Debug visibility when tracking or expression mapping feels wrong.

## Core Workflow

1. Start the local FFL renderer server at `http://127.0.0.1:5000`.
2. Open the MiiTuber Tauri app.
3. Confirm the renderer health indicator says the renderer on port 5000 is reachable.
4. Import a supported avatar data file.
5. Click `Render 3D Model`.
6. The Rust backend validates/normalizes the avatar bytes and requests a GLB from the local FFL renderer.
7. The frontend loads the GLB into a Three.js scene.
8. The user can orbit the model and manually switch expressions.
9. The user starts webcam tracking.
10. MediaPipe Face Landmarker reads webcam frames locally in the webview.
11. Blendshape and head-pose data are smoothed, mapped, and converted to Mii expression/head rotation.
12. The avatar updates live.
13. The user can optionally start microphone lip-sync.
14. The user can open the OBS Clean View window and capture that window in OBS.

## Supported Avatar Inputs

The app accepts avatar data that the local FFL renderer can understand:

- `.ffsd`
- Switch CharInfo-style data
- Studio data
- Legacy `.miic`-like payloads stored as `.miic`, `.bin`, or `.dat`

Important limitation:

- Current 128-byte `.miic` v4 files are rejected until a real converter exists. Agents should not imply that modern `.miic` v4 import is already solved.

## Main Features

### Import and Render

- File picker for supported avatar data files.
- Renderer health check for the local FFL server on port 5000.
- Rust-side validation and normalization of avatar bytes.
- GLB rendering through the local renderer endpoint.
- In-memory render caching keyed by avatar bytes and validation mode.
- Clear error messages for unsupported input lengths or unreachable renderer.

### 3D Preview

- Three.js canvas preview.
- One GLB contains all expression variants.
- Manual expression dropdown.
- Orbit controls for inspecting the avatar.
- Background color control.
- Transparent background toggle.
- Debug geometry colors toggle.

### Webcam Tracking

- MediaPipe Face Landmarker runs in the webview.
- Webcam frames stay local.
- Camera device selector.
- Tracking FPS selector: 24, 30, or 60 FPS.
- Start/stop tracking controls.
- Optional camera preview.
- Head pose drives avatar head rotation.
- Face blendshapes drive discrete Mii expression selection.
- Tracking and rendering FPS are shown separately.

### Expression Mapping and Tuning

Mii expressions are discrete, so the app maps continuous MediaPipe signals into expression states. The system includes:

- Signal-level gains.
- Enter/exit thresholds.
- Hysteresis to reduce flicker.
- Minimum hold time to prevent rapid expression switching.
- One Euro filtering for smoother blendshape values.
- Neutral-face calibration.
- JSON tuning profile save/load.
- Debug display for raw and smoothed blendshape bars.

### Microphone Lip-Sync

Mic lip-sync is amplitude-based, not phoneme/viseme-based. The FFL expression set only supports mouth-open/mouth-closed variants, so amplitude is the right level of detail.

Features:

- Microphone selector.
- Start/stop mic lip-sync.
- Silence calibration.
- Noise floor, speaking level, and smoothing controls.
- Mouth source selector:
  - `Mic + camera`
  - `Mic only`
  - `Camera only`
- Default product logic favors max-of-mic-and-camera so either speaking or visible jaw movement can open the mouth.

### OBS Clean View

The app has a separate Tauri window labeled `clean-output`. This window shows only the avatar output, without the main controls. It is intended for OBS Window Capture.

Important constraint:

- The Clean View window must keep native window controls/decorations enabled. Do not make it frameless to chase transparency.

Transparency note:

- The app can clear the Three.js scene, DOM, and canvas background to transparent when the transparent background option is enabled. True desktop alpha has been difficult because WebView/native backing behavior can still show a white or colored background depending on platform/windowing behavior.

## Technology Stack

- Desktop shell: Tauri 2
- Frontend: TypeScript, Vite
- Rendering: Three.js
- Face tracking: MediaPipe Tasks Vision / Face Landmarker
- Audio lip-sync: Web Audio API amplitude/RMS envelope
- Backend: Rust Tauri commands
- Local renderer dependency: FFL renderer server at `127.0.0.1:5000`
- Tests: Vitest for TypeScript logic, Cargo tests for Rust backend

## Important Files

- `README.md`: current run instructions, verification checklist, and implemented feature summary.
- `index.html`: current UI structure and control groups.
- `src/main.ts`: main app orchestration, UI event wiring, tracking, lip-sync, clean-view sync.
- `src/styles.css`: current visual styling.
- `src/lib/scene.ts`: Three.js avatar scene and expression/material handling.
- `src/lib/faceTracker.ts`: MediaPipe camera tracking wrapper.
- `src/lib/expressionPipeline.ts`: expression processing pipeline.
- `src/lib/expressionMapper.ts`: mapping from blendshapes to expression channels.
- `src/lib/tuningProfile.ts`: tuning profile structure and defaults.
- `src/lib/lipSync.ts`: microphone amplitude envelope logic.
- `src-tauri/src/lib.rs`: Rust commands for renderer status, PNG/GLB rendering, input normalization, caching.
- `src-tauri/tauri.conf.json`: Tauri windows, CSP, app configuration.
- `DECISIONS.md`: historical decisions and constraints. Read before changing output architecture.
- `DEBUG_FEEDBACK_LEDGER.md`: debugging history and rejected approaches. Read before retrying transparency/output fixes.
- `claude-prd-phase3.md` and `claude-prd-phase4.md`: product requirements for expression quality and output/lip-sync phases.

## How To Run

Start the local FFL renderer first. The app expects:

```powershell
http://127.0.0.1:5000
```

Then run:

```powershell
npm install
npm run tauri dev
```

The Vite-only dev server can help with basic UI smoke tests, but Tauri behavior, camera permissions, Rust IPC, and renderer calls should be verified with:

```powershell
npm run tauri dev
```

Useful checks:

```powershell
npm test
npm run build
npm run verify:renderer-glb -- mee.ffsd bridge/verify-mee.glb
cd src-tauri
cargo test
```

## Product Constraints and Non-Goals

Do not assume or introduce these unless explicitly requested:

- No in-app avatar creator UI.
- No body tracking.
- No hand tracking.
- No multi-avatar scene system.
- No virtual microphone/audio routing.
- No viseme-level lip-sync.
- No dependency on cloud rendering for avatar data.
- No broad networking of camera/mic frames.
- No claim that modern `.miic` v4 conversion is solved.

Keep the renderer local. The Rust backend should remain the boundary between the app and local renderer calls.

## Output Architecture Warnings

Several output paths were explored historically. Be careful before reintroducing them:

- Native Windows virtual camera was investigated but is complex.
- MJPEG/PNG localhost output had tradeoffs and transparency limitations.
- Spout2 was considered for OBS alpha output but increased platform-specific surface area.
- Frameless Clean View windows are rejected because native window controls are a hard requirement.
- Win32 copied-frame windows and WebGL readback paths caused performance problems.

Current accepted baseline:

- Use the separate OBS Clean View window as the smooth, simple output path.
- Preserve native window decorations.
- Keep transparency handling in the renderer/content layer.

Agents working on output/transparency should read `DECISIONS.md` and `DEBUG_FEEDBACK_LEDGER.md` before proposing changes.

## Privacy and Safety Framing

The app should be described as local-first:

- Avatar files are read locally.
- The FFL renderer is local on `127.0.0.1:5000`.
- Webcam frames stay local in the webview.
- Microphone input is processed locally for amplitude only.
- The app should clearly communicate camera/mic permission use.

Avoid implying the app uploads webcam, microphone, or avatar data to a cloud service.

## UX Design Guidance

The interface should feel like a creator/streaming utility, not a marketing site. The best hierarchy is:

1. Avatar preview/output as the visual center.
2. Basic workflow controls: renderer status, import, render, start tracking, start lip-sync, open OBS Clean View.
3. Scene controls: expression, background, transparency.
4. Device controls: camera, tracking FPS, microphone, mouth source.
5. Advanced tuning/debug controls inside collapsible panels.

Design priorities:

- Make the default workflow obvious.
- Keep advanced tuning accessible but not visually dominant.
- Use clear status messages for renderer, render, tracking, mic, and OBS output.
- Separate user-facing controls from debugging readouts.
- Preserve trust with camera/mic privacy messaging.
- Design desktop-first, with graceful collapse for smaller windows.

## Suggested Product Language

Good phrases:

- "Wii-style avatar"
- "Mii-style avatar"
- "local desktop VTuber prototype"
- "webcam-driven expression tracking"
- "amplitude-based mic lip-sync"
- "OBS Clean View"
- "local-first camera and microphone processing"
- "discrete expression mapping"
- "Three.js avatar preview"
- "MediaPipe face blendshape tracking"

Avoid or qualify:

- "Full virtual camera" unless discussing future/stretch work.
- "Viseme lip-sync" because the app uses amplitude mouth-open logic.
- "Cloud renderer" because rendering is local.
- "Supports all `.miic` files" because modern 128-byte `.miic` v4 is not supported yet.
- "Anime VTuber model" because the project is specifically Wii/Mii-style.

## Resume Bullet Context

If writing resume bullets, focus on engineering and product outcomes:

- Built a Tauri desktop VTuber prototype that imports Wii-style avatar data and renders live 3D avatars through a local FFL pipeline.
- Integrated Three.js GLB rendering with MediaPipe Face Landmarker to map webcam blendshapes and head pose into real-time avatar expressions.
- Designed a TypeScript expression pipeline with smoothing, hysteresis, neutral calibration, threshold tuning, and JSON profile persistence.
- Implemented local microphone amplitude lip-sync using Web Audio RMS analysis, noise-floor calibration, smoothing, and camera/mic source blending.
- Built a Rust backend for avatar payload validation, local renderer proxying, GLB/PNG fetches, SHA-256 render caching, and clear error handling.
- Developed an OBS Clean View output window for capturing a transparent avatar feed while keeping controls separate from broadcast output.
- Added automated Vitest and Cargo coverage around expression mapping, smoothing, lip-sync, scene behavior, and renderer payload validation.

Emphasize:

- Real-time systems
- Local-first privacy
- Desktop app architecture
- Rust/TypeScript boundary
- 3D rendering
- Computer vision integration
- Creator-tool UX
- Debuggability and tuning

## Similar Tools and Comparison Context

If researching similar tools, compare MiiTuber against:

- VTube Studio
- VSeeFace
- Animaze
- FaceRig
- VRoid Studio
- OBS Studio / OBS Virtual Camera
- Live2D Cubism-based workflows
- VRM avatar tools
- MediaPipe-based face tracking demos

Comparison dimensions:

- Avatar format support.
- Tracking method.
- Output method.
- Local vs cloud processing.
- Ease of OBS integration.
- Expression customization.
- Lip-sync approach.
- Performance/latency.
- Platform support.
- Creator workflow complexity.

MiiTuber's differentiator:

- It focuses on Wii-style/Mii-style avatars rather than anime Live2D or VRM models.
- It uses a local FFL renderer and a local desktop pipeline.
- It maps continuous face tracking into discrete FFL expression variants.
- It is small, hackable, and oriented around learning plus practical OBS use.

## Engineering Context for Agents

When modifying code:

- Prefer existing patterns in `src/main.ts` and `src/lib/*`.
- Keep reusable logic in `src/lib` when possible.
- Add focused tests for expression, smoothing, lip-sync, scene, or Rust validation changes.
- Avoid broad UI rewrites unless the task is explicitly design/UI implementation.
- Keep Tauri/Rust as the boundary for renderer access.
- Do not bypass renderer validation by calling the FFL server directly from arbitrary frontend code.
- Be cautious with camera/mic lifecycle cleanup.
- Make sure streams are stopped when tracking/lip-sync ends.
- Preserve the separation between the main control window and Clean View output.

## Verification Checklist for Agents

For feature work, verify the relevant subset:

- `npm test`
- `npm run build`
- `cd src-tauri && cargo test`
- Renderer health check works when the FFL server is running.
- `npm run verify:renderer-glb -- mee.ffsd bridge/verify-mee.glb`
- Avatar renders from `mee.ffsd`.
- Expression dropdown changes the avatar face.
- Webcam tracking starts and stops cleanly.
- Camera preview reuses the tracking video stream.
- Mic lip-sync starts, calibrates silence, and stops cleanly.
- OBS Clean View opens and updates with avatar pose/expression/background.

## Known Good Sample

The repo includes `mee.ffsd`, which is a useful known-good avatar file for local testing and renderer verification.

## If An Agent Is Asked To Design Around This

Give the agent the product summary, current feature list, workflow, UX design guidance, and output constraints. Make sure it knows the design must support:

- Import/render
- Main avatar preview
- Webcam tracking
- Mic lip-sync
- OBS Clean View
- Debug/tuning
- Renderer status and errors

The design should not remove advanced controls. It can reorganize them.

## If An Agent Is Asked To Write Resume Bullets

Give the agent the resume bullet context and ask for bullets tailored to the role. For software engineering roles, emphasize Rust, TypeScript, Tauri, Three.js, MediaPipe, Web Audio, tests, and real-time local processing. For product/design roles, emphasize creator workflow, privacy messaging, OBS integration, and complex control hierarchy.

## If An Agent Is Asked To Find Similar Tools

Ask it to research current VTuber, webcam avatar, face tracking, virtual camera, and OBS avatar-output tools. It should compare MiiTuber specifically as a local Wii-style avatar tool, not as a generic Live2D/VRM competitor. Because tool availability changes over time, the agent should browse current sources before making recommendations or claims.

## If An Agent Is Asked To Plan Future Work

High-value directions:

- Make setup easier around the local FFL renderer.
- Improve import format support, especially real `.miic` v4 conversion.
- Improve Clean View transparency reliability while preserving native window controls.
- Improve tuning presets for common webcams/lighting conditions.
- Add onboarding around OBS capture.
- Polish the main UI into a calmer creator-tool layout.
- Package MediaPipe assets locally instead of relying on CDN access.
- Explore a native virtual camera only after the current OBS Clean View path is stable and well understood.

Avoid over-expanding into body tracking, full scene composition, avatar creation, or multi-avatar support unless the project scope changes.
