# Repo Compatibility Log

## ariankordi/FFL.js — checked 2026-07-02
**Verdict:** Good fit
1. WHAT: JS/WASM bindings around the FFL (Wii U Mii renderer) decompilation that render full Mii head models in Three.js. Ships accurate per-console shaders (Wii U/3DS/Switch/Wii/Miitomo), decodes 3DS/Wii U/Wii/Mii-Studio Mii data, and exposes a `CharModel` API for icons, expressions, and mask/faceline textures. Requires an external resource file (`AFLResHigh_2_3.dat`).
2. LAYER: Mii creator/rendering — the actual avatar renderer, directly matching MiiTuber's Three.js webview + the sibling FFL-Testing Go sidecar already in use.
3. EFFORT: Adapter needed. Clean ESM library (peer-dep `three` only) that drops into the webview, but mapping MediaPipe continuous blendshapes to FFL's discrete `FFLExpression` enum via `setExpression()` must be written — FFL swaps prebaked mask textures rather than accepting per-shape weights.
4. FIT: No unusual runtime. Browser (WebGL1/2) and Node/WebGPU-headless paths provided; works under Three r144–r183. No Rust/Tauri assumptions. Needs the `.dat` resource shipped.
5. MAINTAINED: Yes — last commit 2026-04-08, active v2.2.0, typed JSDoc, ESLint/rolldown build, same author as MiiTuber's FFL-Testing dependency.
6. CONCERN: License is AGPL-3.0-only — strong copyleft with a network clause; acceptable for an open-source hobby project but forces MiiTuber (and distributed builds embedding it) to be AGPL. Confirm that's intended before adopting.

## ariankordi/my-jsfiddles (threejs-mii-accurate-body-scaling) — checked 2026-07-02
**Verdict:** Reference only
- WHAT: A ~1000-line Three.js jsfiddle that loads a Mii head glTF plus a gender-specific body glTF and applies Nintendo-accurate body scaling. Core is `getBodyScale(build, height)` — a reverse-engineering of `nn::mii::VariableIconBody` (returns a Vector3 where z always equals x) — fed into FFL.js's `applyScaleDesc` + `addSkeletonScalingExtensions` to scale the skeleton, then `attachHeadToBody` reparents the head. Also swaps FFL/LUT/Sample shader materials and maps Mii favorite colors.
- LAYER: Mii creator/rendering only (body/skeleton scaling + shader materials). Nothing for face tracking, Tauri/IPC, or virtual camera.
- EFFORT: Reference-only / heavy adapter. Browser jsfiddle glue (DOM UI, importmap, OrbitControls) with no module boundary. The valuable portable piece is the `getBodyScale` math (~10 lines, self-contained, no deps) — a clean drop-in.
- FIT: Poor. Hard-depends on FFL.js for shaders and ALL scaling helpers (`SkeletonScalingExtensions`, `ModelScaleDesc`). Pulls Three.js 0.177.0 + FFL.js v2.1.1 via esm.sh CDN, models from external CDNs. No package.json, browser-only.
- LICENSE: Repo root has NO LICENSE file (README calls it an "archive"); header says "Please credit me if you use any portion." Required dep FFL.js is AGPL-3.0-only — copyleft concern if MiiTuber vendors those helpers/shaders.
- MAINTAINED: Last repo commit 2026-05-16 (~6 weeks ago); personal jsfiddle archive, not a supported library.
