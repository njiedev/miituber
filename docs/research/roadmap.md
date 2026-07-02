# MiiTuber Roadmap

Two phases. **Phase 1 is "make the product actually work and feel finished."**
**Phase 2 is "the stuff a first-time shipper doesn't think about until it bites
them"** — legal, distribution, and real-user concerns.

Do Phase 1 first. Don't let Phase 2 items block you from building — but don't
ship publicly until Phase 2 is handled.

---

## Phase 1 — Get to a finished product (features)

Ordered roughly by dependency.

1. **Swap FFL server → FFL.js** (see `prd-ffl-js-swap.md`).
   Self-contained rendering, no external server. This unblocks real shipping.
2. **Resource file handling.** Decide bundle vs. user-supplied for
   `AFLResHigh_2_3.dat`; wire up loading at startup.
3. **Expression coverage pass.** Confirm the MediaPipe → `FFLExpression`
   mapping covers every face you want; fill gaps.
4. **Thumbnails via FFL.js.** Replace `render_mii_png` with an in-webview render.
5. **Native GL output / OBS Game Capture — PARKED** (see
   "Parked: Game Capture (native GL)" below). Pulled off the critical path: the
   Clean View + OBS **Window Capture** path already ships working transparency,
   so Game Capture is now a separate track, not a blocker. The code lives on
   branches `ffl-swap-complete` (pushed to origin) and `testing-game-capture`.
6. **Polish the core loop:** import → pick avatar → track → output. Make each
   step's status/errors clear.
7. **Settings persistence** — camera/mic choice, tuning profile, last avatar.
8. **Expression hotkeys (stylized faces).** Enable a few non-physical FFL
   expressions (heart eyes/LOVE 25, CAT 49, MONEY 56, SPIRAL 57, etc.) that the
   webcam can't detect, and bind them to keyboard triggers — a common VTuber
   feature. Depends on the CharModel being built with those expressions enabled
   via makeExpressionFlag. (Separate from the 0-18 face-driven fix.)
9. **Shading/color fidelity tuning** — only AFTER the functional path is solid.

**Phase 1 done =** a stranger can install it, import a Mii, and stream their
face as a transparent avatar into OBS, with no server and no internet.

---

## Parked: Game Capture (native GL)

**Status: parked.** Code preserved on branches `ffl-swap-complete` (pushed to
origin) and `testing-game-capture`. The active slate has Clean View + OBS
**Window Capture** only — no native GL.

### Goal
Get **OBS Game Capture + Allow Transparency** working: a native OpenGL window
(Rust + Win32 + WGL, three-d renderer) whose back buffer carries true per-pixel
alpha, so OBS Game Capture yields clean transparency at high FPS with no chroma
key. Game Capture's wins over the working Window Capture path: higher/steadier
FPS + lower latency (GPU-direct), per-pixel alpha without capturing the window
title bar, and robustness to occlusion/minimize.

### Problems we ran into
1. **Fidelity gap — the core blocker.** The native window re-renders an exported
   GLB with three-d's generic PBR (`PhysicalMaterial`), which does **not**
   reproduce FFL's shader (`FFLShaderMaterial`). Result vs the WebView preview:
   surfaces read **flat**, eyebrows render **grey instead of black**, and hair
   loses its specular **"glow."** Two engines, two shaders → two looks.
2. **Not a geometry bug.** A per-part `normal_spread` diagnostic confirmed the
   exported normals are correct (wide spread on every curved part), so the
   flatness is the shader-model mismatch, not bad geometry or lighting.
3. **Export pipeline was fragile** (now green + unit-tested in
   `src/lib/fflExport.test.ts`). Three bugs fixed in sequence: swizzled FFL
   textures crashed the GPU read; strict glTF parser rejected FFL's interleaved
   half-float/SNORM attributes; and `GLTFExporter` silently drops any
   `ShaderMaterial`, taking the mask mesh + its `FFLMask` name out of the GLB.
4. **Lossy transport.** `strip_custom_vertex_attributes` deletes the `_color`
   vertex attribute the FFL shader needs (per-vertex specular strength + rim
   width), and flattening to `MeshStandardMaterial` drops each part's
   `modulateType` / `modulateMode` / const colors — the data a faithful shader
   would consume.

### Next steps (to resume)
- **First, decide if it's even worth it:** measure the current Clean View +
  Window Capture **FPS/latency** and confirm its transparency looks clean in OBS.
  If it's good enough, Game Capture may stay parked indefinitely.
- **Pick the architecture:**
  - *Path A — port the FFL shader into three-d.* Best fidelity, but deep: stop
    stripping `_`-attributes, carry `_color` + `tangent` + per-part
    modulateType/mode/const colors through export + IPC, implement a custom
    three-d `Material` (port ~150 lines of GLSL: Blinn/aniso specular + rim +
    modulate switch), and fix the mask sRGB read (grey → black brows). Result:
    the capture window matches the preview, but it's still a separate window.
  - *Path B — make the native GL surface the preview itself.* Render the avatar
    natively and show that as the in-app preview → one renderer, one look, one
    Game-Capturable window. The true "one window" answer, bigger refactor.
- **Cheap early win regardless of path:** fix the mask color-space read (black
  eyebrows) — it's clearly *wrong*, not just stylistically soft, and de-risks
  the color-management question before touching a shader.

---

## Phase 2 — Shipping to real users (the non-obvious stuff)

Things that don't show up while you're coding for yourself, but matter the
moment other people run your app.

### Legal & licensing
1. **Apply AGPL-3.0 to the repo.** Add `LICENSE` file (verbatim AGPL text),
   set `"license": "AGPL-3.0-only"` in `package.json`, keep FFL.js's notices
   intact. (No signup — just files. See prior discussion.)
2. **Nintendo IP posture.** MiiTuber renders Miis via reconstructed Nintendo
   tech + Nintendo asset data. Decide:
   - Keep it non-commercial + open-source (safest).
   - **Do NOT redistribute `AFLResHigh_2_3.dat`** if avoidable — have users
     supply their own dump. Removes the clearest asset-redistribution risk.
   - Accept that a takedown is the realistic Nintendo interaction, not a buyout.
3. **Third-party licenses.** MediaPipe, Three.js, Tauri, etc. — bundle a
   credits/licenses list (many licenses require attribution).

### Distribution & trust
4. **Code signing.** Unsigned Windows apps trigger SmartScreen "unknown
   publisher" scary warnings. Decide whether to sign (costs $) or document the
   warning for users.
5. **Installer / auto-update.** How do users get it and get fixes? Tauri
   updater vs. manual downloads.
6. **Release channel.** GitHub Releases is the natural fit for an AGPL project
   (source is right there, satisfies the license too).

### Real-user reality
7. **Error handling for other people's machines.** No webcam, no mic, weird GPU,
   missing `.dat`, permission denials. Fail with a clear message, not a crash.
8. **Privacy statement.** Confirm face-tracking data never leaves the machine
   (with FFL.js, nothing does — that's a selling point; say so).
9. **First-run onboarding.** A stranger doesn't know what an FFSD file is or
   where to get one. Guide them.
10. **Basic docs / README for users** (not just devs): what it is, how to
    install, how to get a Mii in, how to set up OBS.
11. **A way to receive bug reports.** GitHub issues link in-app.

**Phase 2 done =** someone who isn't you can find it, trust the installer, run
it without hitting a wall, and you're not exposed on licensing or IP.
