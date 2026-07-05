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
│       │                       input normalization, caching
│       └── main.rs             Binary entry
├── landing/                Standalone waitlist landing page (separate Vite
│   │                       build: vite.landing.config.ts → dist-landing/)
│   ├── index.html          Faux app-window layout reusing src/styles.css
│   ├── main.ts             FFL boot, cursor-follow, hover pose, waitlist form
│   └── miiStage.ts         Slim AvatarScene cousin: idle anim plays, excited
│                           arm pose, transparent clear over CSS checkerboard
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

The active output is the **transparent Clean View webview + OBS Window Capture**: a separate WebView2 window renders the avatar on a transparent/keyable background that OBS captures as a Window source.

The **native OpenGL / OBS Game Capture** path (a Rust-rendered GL window carrying true per-pixel alpha) is **parked** — see the "Parked: Game Capture (native GL)" section in [research/roadmap.md](research/roadmap.md) for the goal, the fidelity blocker, and how to resume. The parked code is preserved on the `ffl-swap-complete` and `testing-game-capture` branches.

See [AGENTS.md](AGENTS.md) for the hard constraints around output/transparency, and [CHANGELOG.md](CHANGELOG.md) for how the output architecture evolved.

## Searchable entry points

- Frontend orchestration: `src/main.ts`
- Pose funnel: `setAvatarPose` in `src/main.ts`
- Scene / expression variants: `src/lib/scene.ts`
- Rust commands + registration: `invoke_handler!` in `src-tauri/src/lib.rs`
