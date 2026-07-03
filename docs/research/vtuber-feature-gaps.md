# MiiTuber — VTuber Feature Gaps & Feasibility

_Researched 2026-07-03 against the current stack._

## Current baseline (what MiiTuber already does)

Mii import → in-process FFL.js render (head), MediaPipe face tracking, discrete
expressions, head rotation (pitch/yaw/roll), blink/wink, mic lip-sync
(amplitude), One-Euro smoothing, idle behavior, background/transparency, OBS
clean-view output, expression hotkeys, tuning profiles, avatar library.

## Current stack (and the one thing that shapes everything)

- **Shell:** Tauri 2 (Rust backend, Tauri commands as the app/renderer boundary)
- **Frontend:** TypeScript + Vite, Three.js webview (r0.184)
- **Avatar:** `ffl.js` v2.2.0 in-process (WASM), replacing the `:5000` server
- **Tracking:** `@mediapipe/tasks-vision` (Face Landmarker today)
- **Audio:** Web Audio API RMS envelope

### The core constraint: FFL Miis are a discrete texture-swap rig

FFL.js exposes exactly one animation lever for the face: `setExpression(index)`
over 19 discrete `FFLExpression` values. Eyes, brows, and mouth are **baked
textures swapped per expression** — there is *no* continuous blendshape, no
per-eye gaze rig, no viseme mouth shapes, no exposed bones on the head. Verified:
the only face APIs in the library are `setExpression` and internal `BLINK`.

This splits every VTuber feature into two buckets:

- **Bucket A — rig-independent:** bodies, camera, props, backgrounds, stream
  events, hotkeys, plugin API. Plain Three.js/Tauri work, additive, low risk.
- **Bucket B — rig-dependent (face mesh):** visemes, continuous gaze, continuous
  emotion blending, hair/face physics. Fighting FFL's discrete texture model —
  hard-to-impossible without leaving FFL or building custom overlay geometry.

## Feasibility summary

| Feature | Bucket | Stack support today | Effort | Verdict |
|---------|--------|--------------------|--------|---------|
| Body + camera framing presets | A | FFL.js ships helpers | Low | **Do first** |
| Live outfit / favorite-color / pants swap | A | `prepareBodyForCharModel` args | Low–Med | Strong, Mii-unique |
| Props & screen effects on hotkey | A | Three.js overlays | Medium | Feasible |
| Stream event triggers (Twitch/YT) | A | Tauri HTTP/WS | Medium | Feasible |
| Plugin / WebSocket API | A | Tauri + Rust | High | Feasible, a moat |
| Hand / gesture tracking | A→B | MediaPipe already in-package | Med–High | Feasible input; **output limited by rig** |
| Physics / secondary motion (hair, sway) | B | None; Miis are rigid textured meshes | High | **Largely not feasible on FFL heads** |
| Gaze / eye tracking | B | No FFL gaze rig | High | **Not feasible without custom eye overlay** |
| Visemes (A/I/U/E/O) | B | No FFL viseme shapes | High | **Not feasible on FFL mouth** |
| Continuous emotion blending | B | Discrete `setExpression` only | High | Not feasible without cross-fade hack |

---

## Bucket A — rig-independent (recommended)

### 1. Body + camera framing presets — **Do first**
- **Needs:** a body glTF (male/female) asset; then `prepareBodyForCharModel` +
  `attachHeadToBody`, and `getWholeBodyCamera` / `getFaceCamera` /
  `adjustCameraForBodyHead` for framing.
- **Stack gives:** all helpers ship in `ffl.js/helpers/BodyUtilities.js`,
  `SkeletonScalingExtensions.js`, `ModelScaleDesc.js`. Cameras are free.
- **Gap:** source/host the body model asset; port `getBodyScale(build,height)`
  (~10 lines) from the body-scaling jsfiddle (reference-only).
- **Effort:** ~1 day of glue in `scene.ts` once a body asset exists.
- **Verdict:** highest impact-per-effort; half-body framing *is* the VTuber look.

### 2. Live outfit / favorite-color / pants swap
- **Needs:** re-run `prepareBodyForCharModel` with new `favoriteColor` /
  `pantsColor`; favorite-color changes to the head may require rebuilding the
  CharModel (`createCharModel`) since color is baked from Mii data.
- **Stack gives:** color params are first-class in the body helper.
- **Effort:** Low–Med. Verify whether head color needs a CharModel rebuild.
- **Verdict:** differentiated, Mii-native customization no generic app has.

### 3. Props & screen effects on hotkey
- **Needs:** load prop glTFs / sprite planes into the Three.js scene, parent
  hand-held props to a body bone; particle/overlay effects as separate meshes or
  CSS/canvas layers; extend the existing hotkey system beyond expressions.
- **Stack gives:** Three.js does all of this natively; hotkey infra exists.
- **Effort:** Medium (asset pipeline + trigger wiring).
- **Verdict:** VTube Studio's signature feature; fully feasible.

### 4. Stream event triggers (Twitch / YouTube)
- **Needs:** Twitch EventSub (WebSocket) / YouTube live events → map to an
  expression, prop, or effect. Best handled in Rust (Tauri command/background
  task) to keep secrets out of the webview, then emit events to the frontend.
- **Stack gives:** Tauri does HTTP/WS and event emit cleanly; the Rust boundary
  already exists.
- **Effort:** Medium (OAuth + event plumbing).
- **Verdict:** high value for real streamers; feasible.

### 5. Plugin / WebSocket API
- **Needs:** expose a local WS server (Rust) with a documented event/command
  schema so third parties can drive expressions/props.
- **Stack gives:** Tauri + Rust can host a local server; pose funnel
  (`setAvatarPose`) is a natural single injection point.
- **Effort:** High (design + docs + stability guarantees).
- **Verdict:** long-term moat, not a quick win.

---

## Bucket B — rig-dependent (constrained by FFL)

### 6. Hand / gesture tracking — feasible *input*, limited *output*
- **Input:** `@mediapipe/tasks-vision` already bundles `HandLandmarker` and
  `GestureRecognizer` — **no new dependency**. Running a second landmarker on the
  same camera stream is straightforward.
- **Output problem:** FFL exposes no arm/hand bones on the head model. Hand
  gestures could only drive **body-skeleton** poses (via
  `SkeletonScalingExtensions` / bone access on the body glTF) or trigger discrete
  props/expressions — not articulated finger animation.
- **Effort:** Med–High. **Verdict:** viable as a *trigger* (e.g. wave → emote),
  not as full hand puppeteering.

### 7. Gaze / eye tracking — **not feasible on FFL as-is**
- MediaPipe gives iris landmarks, but FFL eyes are baked textures with no gaze
  rig and no exposed eye transform. Continuous gaze would require rendering a
  **custom eye overlay** on top of the Mii face — a significant custom-geometry
  project outside FFL.
- **Verdict:** park unless you commit to custom face overlays.

### 8. Visemes (A/I/U/E/O) — **not feasible on FFL mouth**
- FFL mouth is one of a few baked expression textures (only `OpenMouth` variants
  exist). There are no phoneme mouth shapes to drive. Current open/closed
  lip-sync is already near the ceiling of what the rig supports.
- **Verdict:** not achievable without custom mouth geometry/textures.

### 9. Continuous emotion blending — constrained
- `setExpression` is a hard discrete swap; no weight blending. A cross-fade
  between two baked textures could *simulate* blending but is a hack and may
  fight FFL's mask compositing.
- **Verdict:** low priority; the discrete model is the intended FFL behavior.

### 10. Physics / secondary motion (hair, accessory sway) — **largely not feasible**
- Mii hair/accessories are part of the rigid head mesh with no separate bones;
  Three.js has no built-in physics. Spring-bone secondary motion needs a real
  bone chain the FFL head doesn't provide. Whole-**body** sway (breathing, lean)
  *is* possible via the body skeleton, but per-strand hair physics is not.
- **Verdict:** limited to body-level idle motion; skip hair physics.

---

## Recommendation

Concentrate on **Bucket A**, lead with **#1 (bodies + camera) → #2 (color/outfit)**:
they're unlocked today, mostly library-provided, and uniquely Mii-flavored.
Treat **Bucket B** (visemes, gaze, hair physics) as effectively blocked by FFL's
discrete texture-swap rig — pursue them only if you're willing to build custom
overlay geometry, which is a different project entirely.
