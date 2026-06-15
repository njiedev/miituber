# PRD: MiiTuber Phase 3 Expression Mapping

## Audience

This document is for the Claude/Codex instance working on the MiiTuber Tauri app
(frontend TypeScript webview + Rust backend), with the FFL renderer-server as a
fixed dependency on `127.0.0.1:5000`.

## Product Summary

MiiTuber is a desktop VTuber-style app that renders user-provided Wii-style
avatar data instead of anime Live2D/VRM models. Phase 1 shipped import + static
PNG render. Phase 2 proved the live pipeline:

```text
webcam -> MediaPipe Face Landmarker -> 52 blendshape scores -> Mii expression + head movement
```

Phase 3 makes that pipeline feel like acting, not just reacting. The avatar
already responds to smile/blink/mouth-open/head-tilt; Phase 3 tunes it into
stable, expressive, natural-feeling performance across different faces and
lighting.

## Current Phase

Phase 3: expression mapping and acting quality.

Goal: turn noisy continuous face tracking into stable, expressive, flicker-free
Mii acting, with a live tuning/debug screen so tuning is observable instead of
guesswork.

Out of scope for this phase:

- audio / lip-sync
- virtual camera output
- avatar creator UI
- body/hand tracking
- multi-avatar

## The Core Design Problem

Two incompatible representations must be bridged:

- MediaPipe: 52 continuous blendshape values, each `0.0`-`1.0`.
- FFL/Mii: a small fixed set of discrete expression textures.

This is fundamentally a **classifier + state machine**, not a blend. The only
continuous channel is head pose (rotation), which passes through separately.

## Renderer Contract (Confirmed)

The renderer is a FIXED dependency in Phase 3. No renderer changes are required.
It already supports everything Phase 3 needs.

FFL expression indices (`server-impl/ffl-testing-web-server.go` lines ~1192-1210):

```text
0  NORMAL                 10 SURPRISE_OPEN_MOUTH
1  SMILE                  11 BLINK_OPEN_MOUTH
2  ANGER                  12 WINK_LEFT
3  SORROW                 13 WINK_RIGHT
4  SURPRISE               14 WINK_LEFT_OPEN_MOUTH
5  BLINK                  15 WINK_RIGHT_OPEN_MOUTH
6  OPEN_MOUTH             16 LIKE
7  HAPPY                  17 LIKE_WINK_RIGHT
8  ANGER_OPEN_MOUTH       18 FRUSTRATED
9  SORROW_OPEN_MOUTH
```

Relevant endpoints:

- `GET /miis/image.glb?data=<hex>&expression=0,1,2,...` returns a glTF with
  multiple expression variants baked in. This is the Phase 2 startup fetch.
- Head pose at request time: `characterXRotate`, `characterYRotate`,
  `characterZRotate` (degrees). For live use, head rotation is applied
  client-side in Three.js, not by re-fetching.

### Two structural facts about the expression set

1. The set is a CONSTRAINED GRID, not a clean product of (emotion x mouth x eye).
   Most emotions have an open-mouth twin:
   - NORMAL <-> OPEN_MOUTH (6)
   - SMILE (1) <-> HAPPY (7)        (note: smile's open-mouth variant is HAPPY)
   - ANGER (2) <-> ANGER_OPEN_MOUTH (8)
   - SORROW (3) <-> SORROW_OPEN_MOUTH (9)
   - SURPRISE (4) <-> SURPRISE_OPEN_MOUTH (10)
   - WINK_LEFT (12) <-> WINK_LEFT_OPEN_MOUTH (14)
   - WINK_RIGHT (13) <-> WINK_RIGHT_OPEN_MOUTH (15)
   BUT blink only combines with NORMAL (BLINK 5, BLINK_OPEN_MOUTH 11). There is
   no "smile + blink". A blink during an emotional expression cannot be
   represented without dropping the emotion. This is a real design tension; see
   Open Design Questions.

2. Wink direction is INVERTED relative to MediaPipe's perspective. The renderer's
   own `expressionMap` swaps wink_left/wink_right
   (`server-impl/ffl-testing-web-server.go` ~1238-1256). Treat left/right as a
   known bug source and verify against a live face.

## Required Architecture: Channel Decomposition

Do NOT map 52 -> 19 directly. Decompose the face into independent channels,
decide each, then compose into the nearest legal FFL index.

Channels:

- Eyes  <- eyeBlinkLeft, eyeBlinkRight        -> {open, blink_both, wink_left, wink_right}
- Mouth <- jawOpen (+ mouthFunnel/Pucker)     -> {closed, open}
- Emotion <- argmax over candidate scores     -> {normal, smile, anger, sorrow, surprise}
    - smile    <- mouthSmileLeft + mouthSmileRight
    - anger    <- browDownLeft + browDownRight
    - sorrow   <- mouthFrownLeft + mouthFrownRight + browInnerUp
    - surprise <- eyeWideLeft + eyeWideRight + browInnerUp + jawOpen

Then a composition step picks the single FFL index that best represents
(emotion, mouth, eyes), with documented fallbacks for impossible combos.

## Per-Frame Pipeline

```text
raw 52 blendshapes
  -> calibration   (subtract per-user neutral baseline)
  -> smoothing     (One-Euro filter: low jitter at rest, low lag in motion)
  -> thresholds    (per channel, WITH HYSTERESIS: separate on/off levels)
  -> state machine (MIN-HOLD time per state, debounce)
  -> composition   (channels -> FFL index 0..18)

head pose (pitch/yaw/roll)
  -> smoothed separately (continuous)
  -> applied as model rotation in Three.js
```

The four anti-flicker / naturalness tools, concretely:

- Calibration: capture a neutral baseline so a resting face reads as NORMAL, not
  accidentally sorrow/anger/surprise. Store as part of the tuning profile.
- One-Euro filter: smoothing that stays responsive. Preferred over a flat moving
  average, which feels laggy.
- Hysteresis: e.g. smile turns ON at 0.60 and OFF at 0.40. Kills chatter at the
  threshold boundary.
- Minimum hold time: once a state is chosen, hold it >= N ms before switching.
  Kills rapid state swapping during transitions.

## Primary Deliverable: Expression Tuning / Debug Screen

Build this FIRST. It makes every later step observable instead of guesswork.

Must show, live at frame rate:

- All 52 raw blendshape values as labelled bars.
- Raw vs smoothed value for each (so filter behavior is visible).
- Current per-channel decision (eyes / mouth / emotion).
- Active thresholds with on/off (hysteresis) markers, editable via sliders.
- Min-hold timers per state (visualize why a state is or isn't switching).
- The final chosen FFL expression index + name, in real time.
- Head pose readout (pitch/yaw/roll).

Must support:

- Live editing of every tunable: thresholds, hysteresis gaps, min-hold ms,
  One-Euro params (min cutoff, beta), per-channel gains.
- Calibration flow: "hold neutral for 2s" -> capture baseline.
- Save / load a tuning profile to JSON.

## Build Order

1. Debug overlay (read-only): 52 live blendshape bars + head pose. Just see data.
2. Pure mapper functions: channel classifiers as testable pure functions
   (blendshapes -> channel states), no UI coupling.
3. Smoothing layer: One-Euro on raw values; show raw vs smoothed in overlay.
4. State machine: hysteresis + min-hold; visualize hold timers and on/off levels.
5. Composition -> index: the 19-state lookup table with documented fallbacks.
6. Calibration flow: neutral baseline capture.
7. Live tuning UI: sliders for every param + JSON profile save/load.

## Open Design Questions (decide using the tuning screen)

- Blink vs emotion conflict: when the user blinks mid-smile, do we (a) ignore the
  blink while emoting, (b) drop briefly to BLINK(5) and lose the emotion, or
  (c) treat blink as a very short transient override only when emotion is NORMAL?
  Recommendation to validate: (a) or (c), since dropping a smile to blink looks
  worse than a missed blink.
- Wink intent: real winks are rare and easily confused with single-eye tracking
  noise. Consider requiring a higher threshold + longer min-hold for winks.
- LIKE (16) / LIKE_WINK_RIGHT (17) / FRUSTRATED (18): no clean MediaPipe analog.
  Leave unmapped in auto mode, or bind to manual hotkeys.
- Surprise vs open-mouth: surprise depends heavily on jawOpen + browInnerUp;
  decide priority so a yawn doesn't read as surprise.

## Product Constraints

- Renderer stays a fixed local dependency. No renderer changes in Phase 3.
- All mapping logic lives client-side in the Tauri webview (TypeScript).
- Keep renderer calls local; do not expose the renderer's lower-level port.
- The Rust command remains the trust boundary for any data sent to the renderer.
- Keep explanations concrete: this project is also Mohammed's learning vehicle.
- No new features beyond mapping/acting quality this phase.
