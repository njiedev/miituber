# PRB — Fable 5: UI Cleanup, Full Hotkey System & FFL.js Expansion

**Status:** Draft
**Owner:** Mohammed Njie
**Date:** 2026-07-02
**Branch target:** off `main` (current work branch: `ffl-renderer`)

---

## 1. Overview

Fable 5 is a polish-and-capability milestone. It cleans up the user-facing UI, removes dead references to the old external FFL renderer now that we run **FFL.js in-process**, makes the 3D viewport behave correctly at all zoom levels and window sizes, and builds out a **full hotkey system** — including assignable hotkeys for the expanded FFL.js expression set and a spacebar toggle that hides the on-screen transparency control for a fully clean OBS capture.

This is a **functional-and-polish** milestone: the goal is that every listed defect is visibly fixed and the new controls work end-to-end. Shading/color fidelity tuning is explicitly out of scope.

---

## 2. Goals

1. Fix broken/illegible UI controls (rename/delete buttons, button size mismatches).
2. Replace all native OS dialogs (`window.confirm` / `window.prompt`, which render as "localhost" Windows popups) with in-app modals matching the app aesthetic.
3. Remove all "FFL renderer is not reachable" style errors and the port-5000 health check — we are on FFL.js now.
4. Make the Three.js canvas fill the full preview area (no square-crop when zoomed in).
5. Move the transparency toggle to a bottom-right overlay on top of the 3D scene that stays visible/clickable.
6. Ship a full, user-configurable hotkey system, including **expression hotkeys** for the expanded FFL.js expression set.
7. Add a **body rendering** setting (FFL.js can render bodies, not just heads).
8. Add a **spacebar** hotkey that hides the visible transparency toggle button so the capture is fully transparent.
9. Fix responsive layout: UI elements must not squish/overflow at small window sizes.

## 3. Non-Goals

- Shading, lighting, or color-fidelity tuning of the FFL.js render (parked; see memory: "Functional path before polish").
- Re-introducing the native OpenGL / Game Capture output path (parked as of commit `1e9e6dd`).
- Any change to the external FFL `:5000` server beyond removing the client-side dependency on it.

---

## 4. Workstreams

Each workstream lists the **problem**, **current state** (with file references), **requirements**, and **acceptance criteria**.

### WS-1 — Rename / Delete buttons are illegible

**Problem:** In the Me Library, the Rename and Delete buttons on each avatar tile show clipped/invisible text.

**Current state:**
- Buttons are created with word labels `"Rename"` / `"Delete"` in `src/main.ts:1662-1690` (`createAvatarTile`).
- But `.avatar-tile__menu button` is styled as a **24×24px square** (`src/styles.css:342-353`). A 24px square cannot fit the words — the text is clipped to unreadable.

**Requirements:**
1. Make the buttons legible. Choose one direction and apply consistently:
   - **Option A (preferred):** Icon buttons — replace text with clear glyphs (pencil = rename, trash = delete), keep the 24px square footprint, add `title` + `aria-label` for accessibility.
   - **Option B:** Pill buttons sized to their text (auto width, `padding: 4px 10px`, readable `font-size`).
2. Ensure adequate contrast against the tile and hover states.
3. Keep the hover/`focus-within` reveal behavior (`src/styles.css:337-340`) but ensure controls are keyboard-reachable.

**Acceptance criteria:**
- Both controls are fully legible at default and small window sizes.
- Both are reachable and operable via keyboard, with accessible names.

---

### WS-2 — Replace native OS dialogs with in-app modals

**Problem:** Deleting/renaming uses native browser dialogs that render as ugly "localhost says…" Windows popups that clash with the aesthetic.

**Current state:**
- Delete uses `window.confirm(...)` — `src/main.ts:1681`.
- Rename uses `window.prompt(...)` — `src/main.ts:1667`.
- The app **already has a styled modal pattern** we can reuse: `.modal-scrim` / `.modal` (`index.html:293-317`, styled in `src/styles.css`), used by the Add Avatar import flow.

**Requirements:**
1. Build a reusable in-app **confirm dialog** (title, message, confirm/cancel, primary/destructive button styling) matching the existing `.modal` aesthetic.
2. Build a reusable in-app **prompt/input dialog** for renaming (labeled text field, save/cancel).
3. Replace the `window.confirm` delete flow and `window.prompt` rename flow with these modals.
4. Modals must: trap focus, close on `Esc`, close on scrim click, and return a Promise (or callback) so call sites stay simple.
5. Destructive confirm (delete) should visually read as destructive (e.g. red primary button).

**Acceptance criteria:**
- No `window.confirm` / `window.prompt` / `window.alert` remain in the delete/rename paths (grep clean).
- No "localhost says" popup ever appears for these flows.

---

### WS-3 — Remove "FFL renderer is not reachable" errors (we are on FFL.js)

**Problem:** The app still checks a legacy external FFL renderer on **port 5000** and surfaces "FFL renderer is not reachable" errors. This is dead now that rendering is in-process via FFL.js.

**Current state:**
- Backend command `check_renderer_status` pings `:5000` and returns the "is reachable / is not reachable on port 5000" message — `src-tauri/src/lib.rs:202-220` (registered at `lib.rs:457`).
- Frontend calls it and paints the header `.renderer-health` badge — `src/main.ts:321-331`, element at `index.html:37-39`.

**Requirements:**
1. Remove the port-5000 reachability dependency from the user-facing path. Either:
   - Delete the `renderer-health` badge and its polling entirely, **or**
   - Repurpose the badge to reflect **FFL.js init status** (e.g. "Renderer ready" / "Loading resources…" / actual init error), driven by the in-process FFL.js lifecycle rather than an HTTP ping.
2. Remove/retire the `check_renderer_status` Tauri command and its frontend caller if no longer used (`src/main.ts:321-331`, `src-tauri/src/lib.rs:202-220,457`).
3. Audit for any other "not reachable" / port-5000 strings and remove them.

**Acceptance criteria:**
- No "not reachable" / port-5000 messaging appears anywhere in normal use.
- If the badge is kept, it accurately reflects real FFL.js state.
- `grep -ri "reachable\|port 5000"` in `src/` and `src-tauri/src/` returns only intentional results (ideally none).

**Decision (2026-07-02): remove entirely.** ✅ **Done** — badge, styles, `setRendererHealth`/`refreshRendererHealth`, the `RendererStatus` types, and the `check_renderer_status` Tauri command are all removed. Remaining "port 5000" strings live only in the legacy `render_mii_png`/`render_mii_glb` fallback commands (out of scope per Non-Goals).

---

### WS-4 — Canvas should fill the whole viewport (no square crop)

**Problem:** The 3D viewport is locked to a square. When you zoom in close on the Mii head, the head is cropped by the square frame instead of using the whole screen.

**Current state:**
- `.preview-frame` forces `aspect-ratio: 1` (`src/styles.css:395-406`), so the render area is always a square regardless of window shape.
- The canvas fills that square (`#mii-viewer` `width/height: 100%`, `src/styles.css:408-413`).
- Scene resize reads the canvas rect and sets camera aspect from it (`src/lib/scene.ts:256-264`), so it will adapt once the frame is no longer square.

**Requirements:**
1. Remove the forced square (`aspect-ratio: 1`) so the preview frame fills the full available preview panel area (full width and height).
2. Ensure `Scene.resize()` (`src/lib/scene.ts:256-264`) is driven on container resize (e.g. `ResizeObserver`) so camera aspect + renderer size stay correct — no stretching, no clipping.
3. Verify framing/auto-scale logic (`src/lib/scene.ts:301-320`) still centers the head correctly in a non-square viewport.
4. Confirm the same fix carries into the OBS Clean View output path.

**Acceptance criteria:**
- Zooming in close no longer crops the head to a square; the full panel is usable.
- No aspect-ratio distortion at wide/tall window shapes.
- Clean View output remains correct.

---

### WS-5 — Transparency toggle as a bottom-right scene overlay

**Problem:** The transparency control lives inside the Scene popover. It should be an overlay pinned to the **bottom-right, on top of the 3D scene**, and must remain visible/clickable when interacted with.

**Current state:**
- Transparency is a checkbox inside the Scene popover — `index.html:91-94`; handler `src/main.ts:876-881`; apply logic `updateAvatarBackground()` `src/main.ts:1505-1528`.

**Requirements:**
1. Add a persistent overlay control anchored bottom-right of the preview area (`position: absolute`, high `z-index`, above the canvas).
2. It must stay visible and clickable while the scene renders behind it; clicking toggles transparency (reuse `updateAvatarBackground()`).
3. Visual style: compact, legible against both transparent (checkerboard) and colored backgrounds.
4. Keep it in sync with the existing Scene-popover control (single source of truth) or move the control here entirely — avoid two diverging toggles.
5. This button is the one hidden by the spacebar hotkey in WS-7.

**Acceptance criteria:**
- Toggle is always visible bottom-right over the scene and toggles transparency on click.
- State stays consistent with any other representation of the same setting.

---

### WS-6 — Full hotkey system + expression hotkeys + body-render setting

> **Decision (2026-07-02): DEFERRED — ship as "Coming soon."** The full hotkey system and expression hotkeys are parked until the FFL/AFL expression story is settled (names for expressions 19–69 are invented by the FFL.js author, not official — owner wants to vet them first). For Fable 5, add a **"Hotkeys — coming soon"** placeholder in the settings UI. Tentative precedence when built: **sticky toggle until cleared** (not momentary hold). Body-render research is answered below; body setting is likewise deferred unless re-scoped.

**Problem:** Hotkeys are hard-coded to `Esc` only. FFL.js exposes a larger expression set and can render bodies; users want to bind expressions to keys and toggle bodies.

**Current state:**
- Only `Esc` is handled (isolate/clean-output) — `src/main.ts:898-913`.
- Expressions are chosen via a `<select>` (`index.html:83-86`; listener `src/main.ts:863-867`).
- FFL.js supports up to 19 face expressions baked today (`MAX_FACE_EXPRESSION = 18` in `src/lib/fflRenderer.ts`), switched via `CharModel.setExpression(index)` (`src/ffl-js.d.ts:52-55`); expression flags packed via `makeExpressionFlag` (`src/ffl-js.d.ts:34-39`).

**Requirements:**

*Hotkey infrastructure:*
1. Build a central hotkey manager: a registry mapping key-combos → actions, with a single `keydown` listener replacing the ad-hoc handler at `src/main.ts:898-913` (keep existing `Esc` behaviors as registered actions).
2. Support modifier combos (Ctrl/Shift/Alt) and prevent conflicts (warn on duplicate binding).
3. Ignore hotkeys while typing in inputs/modals (guard against firing during text entry).
4. Persist bindings (localStorage, same pattern as other settings).
5. Provide a **Hotkeys settings UI** (new popover or section) to view, assign, re-bind, and clear hotkeys via a "press a key" capture control.

*Expression hotkeys:*
6. Enumerate the **full** FFL.js expression set (extra expressions beyond the current baked 19 where FFL.js supports them). Confirm the authoritative list and which are bake-able (see Open Questions).
7. Let the user bind any available expression to a hotkey; pressing it calls `setExpression(...)`.
8. Ensure hotkey-driven expressions coexist sanely with live tracking-driven expressions (define precedence: momentary override vs. sticky hold — see Open Questions).

*Body rendering setting:*
9. Add a **"Render body"** setting (toggle in Scene/Settings) that enables FFL.js body rendering vs. head-only.
10. Persist it; ensure framing/auto-scale (`src/lib/scene.ts:301-320`) adapts when a body is present.

**Acceptance criteria:**
- User can open a Hotkeys UI, bind a key to an expression, press it, and see the avatar change.
- Bindings persist across app restarts.
- Body rendering can be toggled on/off and the model reframes correctly.
- Hotkeys never fire while typing in a field.

---

### WS-7 — Spacebar hides the transparency toggle (fully clean capture)

**Problem:** For a fully transparent OBS capture, even the on-screen transparency button must be hideable.

**Current state:** No such binding exists; the transparency control (post WS-5) would otherwise always be visible over the scene.

**Requirements:**
1. Register **Spacebar** in the hotkey manager (WS-6) to toggle visibility of the WS-5 transparency overlay button.
2. When hidden, nothing of that control renders into the capture (fully transparent).
3. Make the key rebindable via the Hotkeys UI (spacebar is the default, not a hard-code).
4. Guard so spacebar does not trigger while focus is in a text field or when a modal is open.

**Acceptance criteria:**
- Pressing space hides the transparency button; pressing again restores it.
- With it hidden, OBS capture shows zero UI chrome over the transparent scene.

---

### WS-8 — Responsive layout: fix squish/overflow at small window sizes

**Problem:** At small window sizes, UI elements squish/overflow. Additionally, the **Add Avatar** control is not sized consistently with the library header / "Display Me's" control.

**Current state:**
- Popovers use **hard-coded pixel** positions (`left: 110+offset`, `top: 70+offset`) — `src/main.ts:1729-1734` — which push content off-screen on small windows (they are draggable but start off-position).
- Library grid is `repeat(auto-fill, minmax(150px, 1fr))` (`src/styles.css:266-271`); the Add Avatar tile is a full `aspect-ratio: 1` tile (`src/styles.css:360-374`), which does not match the sizing of the library header action the user refers to as "Display Me's."
- Appbar has many `workspace-only` buttons (`index.html:23-40`) that can crowd/overflow the header on narrow widths.

**Requirements:**
1. Audit and fix squish/overflow across: appbar (`index.html:14-41`), side-rail (`index.html:56-62`), popovers, and the Advanced panel's dense controls (`index.html:180-288`) at small widths.
2. Replace/clamp hard-coded popover positioning (`src/main.ts:1729-1734`) so popovers always open within the viewport (clamp to bounds; consider a responsive default).
3. Normalize the **Add Avatar** control so it matches the sizing of the sibling library action ("Display Me's") — consistent height/padding/typography. (Confirm exactly which element "Display Me's" refers to — see Open Questions.)
4. Establish sensible min-width behavior and wrapping so nothing clips at small sizes; verify with a defined minimum window size.

**Acceptance criteria:**
- At the defined minimum window size, no control is clipped, overlapping, or pushed off-screen.
- Popovers always open fully within the viewport.
- Add Avatar and the "Display Me's" control are visually the same size.

---

## 5. Suggested Sequencing

1. **WS-3** (remove dead FFL health/errors) — quick, unblocks a clean baseline.
2. **WS-1 + WS-2** (button legibility + in-app modals) — self-contained UI polish; modal component is reused later.
3. **WS-4 + WS-5** (canvas fill + transparency overlay) — viewport correctness before capture polish.
4. **WS-6** (hotkey system + expression hotkeys + body setting) — the largest workstream; the manager is a prerequisite for WS-7.
5. **WS-7** (spacebar hides toggle) — small, depends on WS-5 + WS-6.
6. **WS-8** (responsive) — final pass once new controls exist, so we lay out their final state.

---

## 6. Open Questions — RESOLVED (2026-07-02)

1. **WS-3:** ~~Remove or repurpose?~~ → **Removed entirely.** Done.
2. **WS-6 (expressions):** **Answered.** FFL.js exposes **70 expressions** (indices 0–69, `FFLExpression.MAX = 70` in `node_modules/ffl.js/ffl.js:166-250`). 0–18 are the official FFL set (names from Nintendo's decompiled headers); **19–69 come from AFL and their enum names are invented by the FFL.js author** ("Enum names are completely made up", `ffl.js:195-196`) — only the numeric IDs are official. All are bake-able via `makeExpressionFlag` if `FFLModelFlag.NEW_EXPRESSIONS` is set (FFL.js sets it automatically, `ffl.js:1338`). Caveats: 49–52 (CAT/DOG) disable the nose mesh; 61–62 (BLANK) disable the mask entirely and `setExpression` silently no-ops on them. **Cost:** one 512×512 RGBA mask RenderTarget per baked expression (~1 MB VRAM each): all 70 ≈ 70 MB vs. today's ~19 MB; baking is one-time at CharModel init, runtime `setExpression` is an O(1) texture swap.
3. **WS-6 (precedence):** Tentatively **sticky — toggle until cleared** (owner leaning, not final). Moot for Fable 5 since hotkeys are deferred to "coming soon."
4. **WS-6 (body):** **Answered — yes, extra assets required.** FFL.js has a full body pipeline (`helpers/BodyUtilities.js`: `prepareBodyForCharModel`, `attachHeadToBody`, `getWholeBodyCamera`; `CharModel.getBodyScale()` uses Nintendo's official build/height formula) **but ships no body models** — the FFL resource `.dat` contains head parts only. Male + female body glTFs must be bundled or user-supplied (see `examples/nodejs-icon-body-webgpu.js:64-72`; ffl-raylib-samples repo has candidates). Pants use a fixed 4-color palette, not CharInfo. Clean View path would need the same body attach + reframing.
5. **WS-8:** **Answered.** "Display Me's" = the **Mii library screen**. The issue: the **Add Avatar** button/tile is not the same **height** as a single avatar tile in the library grid — normalize Add Avatar to match the avatar tiles.
6. **General:** Minimum window size — **still open.**

---

## 7. Out-of-Scope Follow-ups (parked)

- FFL.js shading/color fidelity tuning.
- Native GL / Game Capture output path (parked at commit `1e9e6dd`).
