# FFL.js Swap — delta checklist (frozen branch → `ffl-swap-complete`)

> **What this is.** The running list of everything that differs between the
> frozen learning branch **`testing-game-capture`** and the reference/answer-key
> branch **`ffl-swap-complete`**. Each item is a change the frozen branch must
> eventually make to reach parity — i.e. Mohammed's hand-coding curriculum. As
> we add more to the reference branch, add it here so tutoring stays in sync.
>
> Status keys: **[x]** done on reference · **[ ]** not started · **[~]** partial.
> "Tutorable" = intended as a hand-coded lesson on the frozen branch.

---

## Part A — Expression coverage (roadmap #1) · Tutorable

Enable FFLExpression 0–18 so live face-tracking can change expression past
Normal (the `[1,0,0]` default only bakes NORMAL, so `setExpression(1..18)`
throws `ExpressionNotSet`).

- [x] Declare `makeExpressionFlag` + `FFLCharModelDesc` in `src/ffl-js.d.ts`
      (the intentional "menu vs kitchen" gap — the real package exports it, the
      ambient `.d.ts` didn't).
- [x] In `src/lib/fflRenderer.ts` `createCharModel`, build a desc from
      `{ ...FFLCharModelDescDefault, allExpressionFlag: makeExpressionFlag([0..18]) }`
      and pass it to `new CharModel(...)`.
- [x] Verify: `npx tsc --noEmit` + `npx vitest run` green.

**Frozen-branch lesson:** name the list→flag→desc pipeline, predict the TS
import error before adding the declaration, then write both edits. See
`tutoring-handoff.md`.

---

## Part B — Native GL OBS output, offline (roadmap #5, option 1b) · Tutorable

**Goal:** the native OpenGL output window (OBS Game Capture + alpha) works with
**no `:5000` server** — fed entirely from the in-webview FFL.js CharModel.

**Why 1b (texture swap), not 1a (19 materials):** FFL.js already models an
expression change as a single texture swap — `setExpression(n)` just does
`maskMesh.material.map = _maskTargets[n].texture` (ffl.js ~L1662–1687). Head,
body, hair, and every material are identical across expressions; only the face
**mask** texture differs. So we export ONE static GLB + the 19 mask textures,
and the native side rebinds the mask mesh's texture per expression. Less data
over IPC, and it mirrors how FFL.js actually thinks.

### B1 — Webview export module (`src/lib/fflExport.ts`) · DONE, tsc/vitest green
- [x] New module `exportCharModelForNativeOutput(charModel, renderer, expressions)`
      → `{ glb: Uint8Array, maskTextures: MaskTexture[] }` where `MaskTexture =
      { expression, width, height, rgba: Uint8Array }`.
- [x] Read each enabled mask: `charModel._maskTargets[n]` render target →
      `renderer.readRenderTargetPixels(target, 0,0, w,h, buf)` → raw RGBA.
      (Same textures `setExpression` binds; internals typed via a local cast.)
- [x] Static GLB: `ModelTexturesConverter.convModelTargetsToDataTex` (ffl.js
      ~L3287) → `GLTFExporter.parseAsync(charModel.meshes, { binary: true })`.
- [x] Mark the mask mesh via **material name** `FFL_MASK_MATERIAL_NAME = "FFLMask"`
      (material names survive glTF round-trip; the old native code already found
      the face by material name, so three-d exposes it).

**Open design questions for B2–B4 (need Mohammed's call):**
- **Eager vs lazy export.** Export mutates the model (RenderTargets → DataTextures),
  so do it on a *throwaway* CharModel (rebuild from mii bytes) to avoid touching
  the live preview. Do it **lazily** on the output-button click (avoid the GPU
  read + GLTF cost on every avatar load). Leaning lazy + throwaway.
- **Dual native path.** Keep `open_gl_avatar_output` backward-compatible: empty
  `mask_textures` ⇒ legacy server-GLB material-swap (the disabled fallback);
  non-empty ⇒ new 1b texture-swap. Slightly more Rust, preserves the fallback.
- **IPC payload size.** Passing `glb` + 19 masks as `number[]` (JSON) is ~5 MB/load.
  Fine once, but a later optimization is Tauri v2 raw-bytes (`tauri::ipc`).

### B2 — Rust command surface (`src-tauri/src/lib.rs`) · DONE
- [x] `open_gl_avatar_output` now takes a `tauri::ipc::Request` and reads the raw
      body (`InvokeBody::Raw`) — Tauri v2 raw bytes, not a JSON `number[]`.
- [x] Delegates to `gl_avatar_output::open_from_payload(bytes)`.

### B3 — Native renderer (`src-tauri/src/gl_avatar_output.rs`) · DONE (cargo check green)
- [x] `parse_payload` unpacks the binary container into `(glb, Vec<MaskTexture>)`.
- [x] `build_mask_expression_materials`: clone the face part's material (found by
      material name `"FFLMask"`) and swap in each expression's mask texture
      (`Texture2DRef::from_cpu_texture`), transparent-blended. This is the 1b swap.
- [x] `build_legacy_expression_materials`: keep the old `Material_XluMask_<n>`
      path for the empty-mask (server GLB) case. `strip_custom_vertex_attributes`
      kept (defensive; harmless if the exported GLB has no `_`-attributes).
- [x] Render loop rebinds the face part's material per expression, as before.
- [x] `set_gl_avatar_expression` / pose semantics unchanged.

### B4 — Wire + retire the stopgap (`src/main.ts`) · DONE
- [x] Removed `tryFetchNativeOutputGlb`; FFL path sets `latestGlbBytes = null`.
- [x] Output button exports lazily (`avatarScene.exportForNativeOutput` on a
      throwaway CharModel), packs via `packNativeOutputPayload`, invokes with the
      raw `ArrayBuffer`. Non-FFL path packs the server GLB with zero masks.

### B5 — Verify
- [x] `npx tsc --noEmit` + `npx vitest run` (77) green.
- [x] `cargo check` (in `src-tauri`) green.
- [ ] **On-device only (Mohammed):** `npm run tauri dev` → open native output →
      OBS Game Capture + Allow Transparency. Confirm and, if needed, tweak:
  - **Transparency/alpha:** avatar opaque over transparent bg in OBS.
  - **Mask orientation:** if the face is upside-down/mirrored, the mask needs a
    vertical (V) flip — `readRenderTargetPixels` is bottom-left origin, three-d
    may expect top-left. Flip rows in `mask_to_cpu_texture` if so.
  - **Mask color/blend:** features show with correct color (albedo forced WHITE +
    `Blend::TRANSPARENCY`); adjust if washed out or hard-edged.
  - **Expression swaps 0–18 + head tracking** track the webcam live.

**Frozen-branch lesson(s):** likely split into (i) the webview export module and
(ii) the native texture-swap rewrite — the Rust/3D piece is the deeper learning
target.

---

## Part C — Not started / later (parity + roadmap tail)
- [ ] Thumbnails via FFL.js (roadmap #4) — replace `render_mii_png` in-webview
      (`ModelIcon` in ffl.js) so thumbnails are offline too.
- [ ] Remove the `:5000` server path (Rust `render_mii_glb`/`render_mii_png` +
      reqwest) once B and C no longer need it. Deliberately kept for now.
- [ ] Expression hotkeys / stylized faces (roadmap #8) — widen the
      `makeExpressionFlag` list to include heart-eyes/cat/etc. Depends on Part A.
