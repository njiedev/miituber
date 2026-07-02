# Agent Guide

Instructions for AI coding agents working in this repo. Read this before making changes, especially to output/transparency, the renderer boundary, or the UI.

## Build, run, and test commands

Run from the repo root unless noted. This is a Windows project; the shell is bash but many commands use the `.cmd` shims.

```bash
npm install                 # install frontend deps
npm run tauri dev           # run the full app (Tauri IPC, Rust render, camera) — the real test
npm run dev                 # Vite-only UI smoke test (no Tauri backend)

npm run build               # tsc + vite production build
npm.cmd exec tsc -- --noEmit  # type-check only
npm test                    # Vitest (TypeScript logic)

npm run verify:renderer-glb -- mee.ffsd bridge/verify-mee.glb  # verify GLB variants

cd src-tauri
cargo fmt                   # format Rust
cargo fmt --check           # verify formatting
cargo check                 # compile-check
cargo test                  # Rust tests
```

The FFL renderer must be running at `http://127.0.0.1:5000` for render/tracking paths to work.

## Formatting & standards

- **Rust:** always `cargo fmt` before finishing. Keep `cargo check` clean.
- **TypeScript:** keep `npm.cmd exec tsc -- --noEmit` clean. Follow existing patterns in `src/main.ts` and `src/lib/*`.
- Keep reusable logic in `src/lib` with focused tests (expression, smoothing, lip-sync, scene, avatar library, Rust validation).
- Editing Rust triggers a full `tauri dev` restart, which drops any in-progress camera/tracking session — expect the user to re-start tracking after a Rust change.

## Absolute DOs

- **DO keep native window decorations** (`decorations: true`) on the clean-view and native output windows. Transparency comes from the alpha channel, never from a frameless window.
- **DO keep the render as the output.** The native GL output window must render directly; never publish copied frames.
- **DO keep Rust/Tauri as the renderer boundary.** Validate/normalize avatar bytes in Rust before forwarding to the FFL server.
- **DO clean up camera/mic lifecycles.** Stop streams when tracking/lip-sync ends.
- **DO preserve separation** between the main control window and the clean/native output.
- **DO update these docs** when you change architecture, commands, tokens, or constraints (see below).

## Absolute DON'Ts

- **DON'T go frameless or add custom/substitute window controls** to chase transparency. This is the user's #1 priority and was violated repeatedly. Non-negotiable.
- **DON'T reintroduce per-frame frame copying** (`readRenderTargetPixels` + Tauri IPC + GDI blit). It recreated a ~10fps bottleneck. The output must be the render itself.
- **DON'T try to OBS Game Capture the WebView2/Chromium window.** It renders in a separate GPU process (`msedgewebview2.exe`) and flattens alpha before present — it cannot carry transparency. Use the native GL window.
- **DON'T use a chroma-key / colored background** the user must key out in OBS. The target is true per-pixel alpha with zero added OBS steps.
- **DON'T call the FFL server directly from arbitrary frontend code.** Go through Rust.
- **DON'T re-add removed output paths** (Spout2 sender, localhost MJPEG/PNG server, native Media Foundation "MiiTuber Camera") without strong new evidence — all removed for lag and platform surface area.
- **DON'T claim modern 128-byte `.miic` v4 import is solved.** It is rejected until a real converter exists.
- **DON'T expand scope** into body/hand tracking, avatar creation UI, multi-avatar scenes, or viseme-level lip-sync unless explicitly asked.

## FFL GLB handling (native renderer)

When loading the FFL GLB in Rust (`gl_avatar_output.rs`):

- Strip the custom `_COLOR` vertex attribute from the GLB JSON — the Rust `gltf` crate rejects `_`-prefixed semantics (three.js tolerates them).
- Force materials diffuse (`metallic = 0`); FFL omits `metallicFactor` so glTF defaults to fully metallic → near-black without an environment map.
- Keep the `png` feature enabled on `three-d-asset` (FFL images are PNG).

## Debugging discipline (anti-loop)

Never retry a failed, equivalent, or same-root-cause fix without new evidence explaining why it should work now. If a new idea resembles a prior failed one, state the concrete difference first. Prefer measured bottlenecks over intuition; when the user gives metrics, use them. Ask for structured retest feedback (fixed / partial / failed + metrics), not "does it work now?".

## Verification checklist

For feature work, verify the relevant subset:

- `npm test`, `npm run build`, and `cd src-tauri && cargo test` pass
- Renderer health check works when the FFL server is running
- `npm run verify:renderer-glb -- mee.ffsd bridge/verify-mee.glb`
- Avatar renders from `mee.ffsd`; expression dropdown changes the face
- Webcam tracking starts and stops cleanly; camera preview reuses the tracking stream
- Mic lip-sync starts, calibrates silence, and stops cleanly
- Output window opens and follows avatar pose/expression/background

## Keeping documentation updated

Treat `docs/` as part of the code. In the same change where you:

- change directories, data flows, or entry points → update `ARCHITECTURE.md`
- change build/test commands, standards, or constraints → update this file (`AGENTS.md`)
- change UI tokens, colors, typography, or component styles → update `DESIGN.md`
- ship a notable feature, fix, or breaking change → add an entry to `CHANGELOG.md`
- change high-level goals or run instructions → update `README.md`

`MYTODO.md` in the repo root is the human owner's personal scratch list — do not reformat, restructure, or delete it.
