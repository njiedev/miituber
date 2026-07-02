# MiiTuber

Local-first desktop VTuber prototype for **Wii-style / Mii-style avatars**. Import your own avatar data, render it as a live 3D head through a local FFL renderer, drive it with webcam face tracking and microphone lip-sync, and capture a clean, transparent avatar feed in OBS.

MiiTuber is intentionally *not* an anime Live2D/VRM tool. Its identity is Mii-style avatars rendered through a local pipeline, kept small and hackable.

## What it does today

- Import `.ffsd`, Switch CharInfo, Studio data, and legacy `.miic`-like payloads
- Fetch one `.glb` containing all 19 expression variants from the local FFL renderer
- Render the avatar in a Three.js scene with orbit controls and manual expression switching
- Webcam face tracking (MediaPipe Face Landmarker) mapped to discrete Mii expressions + head rotation
- Amplitude-based microphone lip-sync (mouth open/closed)
- Avatar library start screen for saving and re-loading avatars
- OBS output paths for a transparent floating-head capture (see [ARCHITECTURE](ARCHITECTURE.md))

## Run locally

Start the FFL renderer first — the app expects it at `http://127.0.0.1:5000`. Then:

```powershell
npm install
npm run tauri dev
```

The Vite-only dev server (`npm run dev`) is fine for UI smoke tests, but Tauri IPC, Rust GLB rendering, camera permissions, and OBS output must be verified through `npm run tauri dev`.

A known-good sample avatar, `mee.ffsd`, is in the repo root.

## Documentation

| Doc | Purpose |
|-----|---------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System map: directories, data flows, module relationships, entry points |
| [AGENTS.md](AGENTS.md) | Guide for AI coding agents: build/test commands, standards, dos & don'ts |
| [DESIGN.md](DESIGN.md) | UI design system: typography, hex codes, component tokens |
| [CHANGELOG.md](CHANGELOG.md) | Notable changes, phase history, and breaking changes |

> **Maintainers & agents:** keep these docs current. When you change architecture, commands, UI tokens, or constraints, update the matching doc in the same change. See [AGENTS.md](AGENTS.md#keeping-documentation-updated).

## Known limitation

Current 128-byte `.miic` v4 files are rejected until a real converter exists. Export `.ffsd` or renderer-supported CharInfo/Studio data for now.
