# PRD: Swap the external FFL server for in-process FFL.js

**Status:** Draft · **Owner:** you · **Created:** 2026-07-02

## 1. Summary

Replace MiiTuber's dependency on an external FFL renderer HTTP server
(`127.0.0.1:5000`, the `ariankordi/FFL-Testing` Go sidecar) with
`ariankordi/FFL.js` — a JS/WASM library that renders Mii `CharModel`s directly
in the webview alongside Three.js.

The goal is a **self-contained app**: no second process, no network dependency,
works offline, and nobody else's server can break it.

## 2. Why

Today, rendering a Mii means: TS → Rust command → HTTP GET to a Go server on
port 5000 → GLB bytes back → `GLTFLoader` → Three.js. That server must be
running, bundled, and kept alive. FFL.js collapses that entire round-trip into
an in-webview WASM call.

| | Today (Go sidecar) | Target (FFL.js) |
|---|---|---|
| FFL runs where | separate `:5000` process | inside the webview (WASM) |
| Ship a server binary | yes | no |
| Works offline | yes | yes |
| Network round-trip per load | yes | no |
| Health-check / "renderer unreachable" errors | yes | gone |

## 3. Non-goals

- Not changing face tracking, lip-sync, smoothing, or the native GL output path.
- Not changing how the avatar reaches the screen conceptually — still Three.js
  drawing to a canvas. We are only replacing *who builds the head*.
- Not building a new expression system — the existing MediaPipe → expression
  mapping is reused, it just calls `charModel.setExpression()` at the end.

## 4. Current-state anchor points (what changes)

- `src-tauri/src/lib.rs:18-19` — `RENDERER_IMAGE_URL` / `RENDERER_GLB_URL`.
- `src-tauri/src/lib.rs:141` — `render_mii_glb` command (HTTP fetch + cache).
- `src-tauri/src/lib.rs` — `render_mii_png`, renderer health check.
- `src/main.ts:1995` — `renderAvatarBytes()` calls `invoke("render_mii_glb")`.
- `src/lib/scene.ts:100` — `loadModelFromGlbBytes()` + variant-material caching.
- `src/lib/scene.ts:135` — `setExpression()` swaps `KHR_materials_variants`.

## 5. Requirements

### 5.1 Functional
1. Load a Mii from the same input formats accepted today (96-byte FFSD, Switch
   CharInfo, Mii Studio data). Length-based validation must be preserved.
2. Render the Mii head in the existing Three.js `AvatarScene`.
3. Drive expressions via `FFLExpression` enum from the existing pipeline.
4. Generate thumbnails for the library (replaces `render_mii_png`).
5. Head rotation, transparent background, and framing behave as today.

### 5.2 Resource file
6. Ship / locate the `AFLResHigh_2_3.dat` resource FFL.js requires.
   - **Decision needed:** bundle it vs. have the user supply it. Bundling is
     easier UX but redistributes Nintendo asset data (see roadmap Phase 2).
   - Load it once at startup, hand the buffer to FFL.js init.

### 5.3 Non-functional
7. No external process. Remove the `:5000` dependency from the happy path.
8. Offline-capable.
9. First-render latency <= current cold render; warm renders should be faster
   (no HTTP).

## 6. Proposed approach (high level)

1. **Add FFL.js** as an ESM dependency (peer-dep `three`, already present).
2. **Init once:** on app start, fetch the `.dat`, call FFL.js init with the
   WASM module + resource buffer. Guard behind a "renderer ready" promise.
3. **New load path in `scene.ts`:** add `loadModelFromMiiBytes(bytes)` that
   builds a `CharModel` and adds its meshes to `modelRoot`, replacing the
   GLB fetch+parse for the primary path.
4. **Expressions:** replace the variant-material swap with
   `charModel.setExpression(index)`. Delete `cacheVariantMaterials` /
   `variantMaterials` once the new path is proven.
5. **Thumbnails:** render the `CharModel` to an offscreen canvas → PNG data URL,
   replacing `render_mii_png`.
6. **Rust cleanup:** once the webview path is solid, delete `render_mii_glb`,
   `render_mii_png`, the URL constants, the reqwest calls, and the health check.
   (Do this LAST — keep them as a fallback until FFL.js is verified.)

## 7. Rollout / de-risking

- **Phase A — parallel:** add FFL.js path behind a flag; keep the Go server path
  working. Compare renders side by side.
- **Phase B — default swap:** make FFL.js the default; server path becomes an
  optional fallback.
- **Phase C — remove server:** delete Rust HTTP renderer code once confident.

## 8. Open questions

- License: adopting FFL.js makes MiiTuber AGPL-3.0. **Confirmed intended** (app
  is open-source, non-commercial). Apply AGPL to the repo (see roadmap Phase 2).
- Ship the `.dat` or require user-supplied? (asset-redistribution risk)
- Does FFL.js's expression enum cover every expression the current pipeline
  emits? Verify the mapping is 1:1 or add a translation table.
- Thumbnail rendering: offscreen canvas in the same WebGL context, or a
  throwaway context?

## 9. Success criteria

- Import + render a Mii with **no `:5000` server running**.
- Expressions driven live from the webcam.
- App works fully offline.
- Rust renderer HTTP code deleted; no "renderer unreachable" error path remains.
