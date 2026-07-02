# Architecture

A birds-eye map of MiiTuber. For low-level details, read the entry-point files linked below.

## Stack

- **Desktop shell:** Tauri 2
- **Frontend:** TypeScript + Vite
- **3D preview:** Three.js (webview)
- **Native avatar output:** Rust + Win32 + OpenGL (via `three-d` / `glow`)
- **Face tracking:** MediaPipe Tasks Vision (Face Landmarker), in the webview
- **Lip-sync:** Web Audio API amplitude/RMS envelope
- **Backend:** Rust Tauri commands
- **External dependency:** local FFL renderer server at `127.0.0.1:5000`
- **Tests:** Vitest (TypeScript), Cargo tests (Rust)

## Directory map

```
miituber/
├── index.html              UI structure and control groups
├── src/                    Frontend (TypeScript)
│   ├── main.ts             App orchestration: UI wiring, tracking, lip-sync,
│   │                       clean-view/native-output sync (searchable entry point)
│   ├── styles.css          Visual styling + design tokens (see DESIGN.md)
│   └── lib/
│       ├── scene.ts            Three.js AvatarScene: model load, expression
│       │                       variants (KHR_materials_variants), framing, lights
│       ├── faceTracker.ts      MediaPipe camera tracking wrapper
│       ├── expressionPipeline.ts  Per-frame blendshape -> expression pipeline
│       ├── expressionMapper.ts    Blendshape -> expression channel mapping
│       ├── smoothing.ts           One-Euro filtering
│       ├── tuningProfile.ts       Tuning profile structure + defaults
│       ├── lipSync.ts             Microphone amplitude envelope
│       ├── avatarLibrary.ts       Saved-avatar library
│       └── types.ts               Shared types
├── src-tauri/              Backend (Rust)
│   └── src/
│       ├── lib.rs              Tauri commands: renderer status, GLB/PNG render,
│       │                       input normalization, caching, native-output cmds
│       ├── gl_avatar_output.rs Native Win32+GL avatar renderer window (OBS output)
│       ├── gl_alpha_probe.rs   Native GL alpha/transparency test probe
│       └── main.rs             Binary entry
├── scripts/verify-renderer-glb.mjs   GLB variant verification tool
├── mee.ffsd                Known-good sample avatar
└── docs/                   This documentation set
```

## Core data flow (import → live avatar)

1. User starts the local FFL renderer at `http://127.0.0.1:5000`.
2. User imports a supported avatar data file in the app.
3. Frontend calls the Rust `render_mii_glb` command (`src-tauri/src/lib.rs`).
4. Rust **validates/normalizes** the avatar bytes, then requests a GLB (all 19 expression variants) from the local renderer. Results are SHA-256 cached in memory.
5. Frontend loads the GLB into the Three.js `AvatarScene` (`src/lib/scene.ts`).
6. User starts webcam tracking — MediaPipe reads frames **locally** in the webview.
7. Blendshapes + head pose flow through `expressionPipeline.ts` (smoothing, hysteresis, hold time, calibration) into a discrete expression index + head rotation.
8. `setAvatarPose()` in `main.ts` updates the preview scene and fan-outs pose to any open output windows.

The **Rust backend is the boundary** between the app and the local renderer. Frontend code must not call the FFL server directly.

## Output paths (OBS)

The active direction is a **native OpenGL window** rendered by Rust that OBS captures via **Game Capture + Allow Transparency** for true per-pixel alpha (VCFace-style: the window looks opaque to the eye but its back buffer carries a real alpha channel).

- `gl_avatar_output.rs` renders the avatar GLB in a native GL window; the render **is** the output — no per-frame pixel readback/IPC/GDI copies.
- Head pose is pushed lock-free from the frontend via the `set_gl_avatar_pose` command each frame.
- `gl_alpha_probe.rs` is a minimal transparency test used to validate the Game Capture alpha path.

The earlier **transparent Clean View webview + OBS Window Capture** remains a fallback. See [AGENTS.md](AGENTS.md) for the hard constraints and rejected approaches around output/transparency, and [CHANGELOG.md](CHANGELOG.md) for how the output architecture evolved.

## FFL GLB quirks (important when touching the native renderer)

The FFL renderer GLB has traits that the strict Rust `gltf` crate handles differently than three.js:

- **Custom `_COLOR` vertex attribute** (FFL per-vertex modulate color) — rejected by the Rust `gltf` validator as an invalid semantic. Stripped from the GLB JSON before loading.
- **Materials omit `metallicFactor`/`roughnessFactor`** — glTF defaults them to fully metallic, which renders near-black without an environment map. The native renderer forces materials diffuse.
- Embedded images are **PNG** — three-d-asset needs its `png` feature enabled.

## Searchable entry points

- Frontend orchestration: `src/main.ts`
- Pose funnel: `setAvatarPose` in `src/main.ts`
- Scene / expression variants: `src/lib/scene.ts`
- Rust commands + registration: `invoke_handler!` in `src-tauri/src/lib.rs`
- Native OBS output: `src-tauri/src/gl_avatar_output.rs`
