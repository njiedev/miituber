# Onboarding Tour — Implementation Spec

Author: Claude Fable 5 (architecture decisions final; implementer must not deviate
without flagging). Target branch: `onboarding-tour`.

## What this is

A first-run guided tour, indie-game dialogue style: a dialogue box with
character-by-character "token streaming" text, a Mii portrait whose mouth flips
open/closed while text streams, the Mii gibberish SFX playing during typing, and
a spotlight that dims the whole app except the UI element being explained.
Visual guide only — it never blocks interaction.

## Architecture (decided)

- **Chapter-based, not linear.** Two chapters:
  - `library` — auto-plays on first launch of the main window.
  - `workspace` — auto-plays the first time the user enters workspace mode.
  - Each chapter has its own completion flag; completing or skipping a chapter
    marks it done. A replay affordance re-runs the chapter for the current mode.
- **Pure logic in `src/lib/tour.ts`** (step data, navigation, persistence,
  typewriter pacing math) with co-located Vitest tests, matching existing lib
  conventions (named exports only, `StorageLike` DI for storage — see
  `src/lib/avatarLibrary.ts:17` and its test's `MemoryStorage`).
- **DOM/audio presenter in `src/lib/tourPresenter.ts`** (no test required):
  dialogue box, portrait frame-flip, typewriter loop, SFX, spotlight overlay.
  Presenter receives callbacks/elements, does not import from `main.ts`.
- **Wiring in `src/main.ts`**: start hook + mode-change hook + replay button.
- **Portrait = pre-rendered static images**, two frames (mouth closed/open) per
  emotion, in `public/tour/`. NOT a live FFL render — the tour must work before
  any avatar exists and even if FFL init fails.

## Files

| File | Content |
|---|---|
| `src/lib/tour.ts` | Types, chapter/step data, `TourController`, typewriter pacing helper, storage read/write |
| `src/lib/tour.test.ts` | Vitest tests (see Test plan) |
| `src/lib/tourPresenter.ts` | DOM presenter class `TourPresenter` |
| `src/dev/capturePortraits.ts` | Dev-only portrait capture utility (see below) |
| `src/main.ts` | Wiring (see Integration) |
| `src/styles.css` | Tour styles (see Styles) |
| `index.html` | Tour overlay container + replay `?` button in appbar |
| `public/tour/*.png` | 10 portrait images (added after capture run) |
| `public/mii-sfx.m4a` | renamed from `public/mii sfx.m4a` (git mv; no spaces in asset URLs) |

## `src/lib/tour.ts`

```ts
export type TourEmotion = "normal" | "happy" | "surprised" | "sad" | "wink";

export interface TourStep {
  id: string;
  /** CSS selector to spotlight, or null for a centered, untargeted step */
  target: string | null;
  text: string;
  emotion: TourEmotion;
}

export interface TourChapter {
  id: TourChapterId;            // "library" | "workspace"
  steps: TourStep[];
}

export const TOUR_STORAGE_KEY = "miituber.onboardingTour.v1";
// Stored value: JSON { library: boolean; workspace: boolean }
```

- `readTourState(storage: StorageLike)` / `writeTourState(storage, state)` —
  tolerate malformed/missing JSON (return `{library:false, workspace:false}`).
  Reuse the `StorageLike` type from `avatarLibrary.ts` (import it; don't redefine).
- `shouldAutoStart(chapterId, state): boolean`.
- `class TourController` — holds chapter + step index; methods `start(chapter)`,
  `next(): TourStep | null` (null = finished), `skip()`, `current()`. Emits
  nothing; presenter polls/calls. Marking complete happens in `skip()`/last
  `next()` via an injected `onComplete(chapterId)` callback.
- `charsVisible(elapsedMs: number, textLength: number, charsPerSecond = 30): number`
  — pure typewriter pacing: `min(textLength, floor(elapsedMs / 1000 * cps))`.
  Presenter drives it from `requestAnimationFrame`; tests cover it directly.

### Chapter/step data (authored copy — keep verbatim)

`library` chapter:

1. `{ id: "lib-welcome", target: null, emotion: "happy",
     text: "Hi! Welcome to MiiTuber! I'm your guide — let me show you around." }`
2. `{ id: "lib-add", target: "#add-avatar-tile", emotion: "normal",
     text: "Everything starts here. Click Add Avatar to import your Mii — .ffsd files work great." }`
3. `{ id: "lib-grid", target: "#avatar-grid", emotion: "happy",
     text: "Your Miis live here in the library. Click one any time to jump into its workspace." }`
4. `{ id: "lib-go", target: "#add-avatar-tile", emotion: "wink",
     text: "Go ahead and add your first Mii — I'll meet you in the workspace!" }`

`workspace` chapter:

1. `{ id: "ws-welcome", target: null, emotion: "happy",
     text: "Nice! This is the workspace — your Mii's stage." }`
2. `{ id: "ws-rail", target: ".side-rail", emotion: "normal",
     text: "This rail holds all your controls: scene, camera, microphone, output, and advanced settings." }`
3. `{ id: "ws-scene", target: ".rail-item[data-menu=\"scene\"]", emotion: "normal",
     text: "Scene lets you change your Mii's expression and the background — or make it transparent." }`
4. `{ id: "ws-tracking", target: "#start-tracking-button", emotion: "surprised",
     text: "Start webcam tracking here and your Mii follows your head and face. Seriously — try it!" }`
5. `{ id: "ws-mic", target: ".rail-item[data-menu=\"mic\"]", emotion: "happy",
     text: "Mic lip-sync makes your Mii's mouth move when you talk." }`
6. `{ id: "ws-output", target: "#isolate-capture-button", emotion: "normal",
     text: "When you're ready to stream, Clean View gives OBS a clean window to capture — with real transparency." }`
7. `{ id: "ws-done", target: null, emotion: "wink",
     text: "That's the tour! Replay it any time with the ? button. Have fun!" }`

## `src/lib/tourPresenter.ts`

`class TourPresenter` with constructor options
`{ root: HTMLElement; controller: TourController; sfxUrl: string; portraitBaseUrl: string }`.

- **Dialogue box**: fixed, bottom-center, dark translucent pill/card in the
  visual language of `.isolate-hint` (`src/styles.css:1121`) — dark bg,
  `backdrop-filter: blur(6px)`, rounded. Contains: portrait `<img>` (~72px),
  streaming text area, a "Next ▸" affordance (appears when line completes),
  and a "Skip tour" text button.
- **Typewriter**: rAF loop calling `charsVisible()`; renders `text.slice(0, n)`.
  Click on the dialogue box while typing → complete the line instantly;
  click when complete → `controller.next()`. `Escape` → `skip()`.
- **SFX**: single `new Audio(sfxUrl)`, `loop = true`, `volume = 0.35`. `play()`
  when a line starts typing, `pause()` + `currentTime = 0` when the line
  completes or is fast-forwarded. Autoplay may reject before user gesture —
  swallow the promise rejection; tour must work silently if audio is blocked.
- **Portrait mouth flip**: while typing, swap the `<img>` src between
  `portrait-{emotion}-closed.png` / `portrait-{emotion}-open.png` every 125 ms
  (use the same rAF loop, no extra timer). On line complete, settle on closed.
  Preload all 10 images at tour start.
- **Spotlight**: one absolutely-positioned div, `pointer-events: none`,
  `box-shadow: 0 0 0 9999px rgba(20, 28, 38, 0.55)`, `border-radius: 10px`,
  positioned over `target.getBoundingClientRect()` with ~6px padding and a
  CSS transition on top/left/width/height so it glides between steps.
  `target: null` → shrink the cutout to zero size at screen center (pure dim).
  If `querySelector` misses, treat as `null` target (never throw).
  Reposition on `window.resize`. The whole overlay root is `pointer-events:
  none`; only the dialogue box re-enables `pointer-events: auto`.
- Presenter fully removes its DOM + listeners + pauses audio on finish/skip.

## Integration (`src/main.ts`)

- End of `initializeMainWindow()` (after `wireLibraryControls()`,
  ~`src/main.ts:511`): if `shouldAutoStart("library", state)` → start tour.
  NEVER in `initializeCleanOutputWindow()` — the tour must not exist in the
  OBS window.
- Add an optional hook inside `setAppMode()` (`src/main.ts:1589`): when mode
  becomes `"workspace"` and `shouldAutoStart("workspace", state)` → start the
  workspace chapter. If a library chapter is somehow still open, end it first.
- Replay: add a small `?` icon button to the appbar (`index.html`), id
  `#tour-replay-button`, visible in both modes, that replays the chapter for
  the current mode (read mode from `.app-shell` classes).
- Storage: use `window.localStorage` via the same pattern as
  `getLibraryStorage()`.

## Styles (`src/styles.css`)

- Use existing tokens: `--panel`, `--text`, `--accent`, `--shadow`, `--font`.
  Dialogue box follows `.isolate-hint`'s dark translucent look.
- z-index: overlay root `200` (above modal-scrim's 100).
- **Required:** add the tour root class to BOTH hide rules for
  clean-output/capture-isolate modes (`src/styles.css:1032`, `:1085`) so the
  tour can never appear in an OBS capture. This is a hard constraint from
  AGENTS.md territory (output purity).
- Respect `prefers-reduced-motion`: skip the spotlight glide transition.

## Portrait capture utility (`src/dev/capturePortraits.ts`)

Dev-only, never in prod bundle:

- In `main.ts`, top-level: `if (import.meta.env.DEV &&
  new URLSearchParams(location.search).has("capture-portraits")) {
  void import("./dev/capturePortraits").then(m => m.runPortraitCapture()); }`
  (dynamic import keeps it out of the prod chunk; Vite tree-shakes on DEV).
- `runPortraitCapture()`: shows a bare file input; user drops `mee.ffsd`
  (repo root). Uses the existing `src/lib/fflRenderer` path to build the
  CharModel, then for each of the 10 (emotion, frame) pairs below sets the
  expression, renders to a 256×256 transparent-background canvas, and triggers
  a download of `portrait-{emotion}-{closed|open}.png`.
- Expression mapping (from `FFLExpression` in `src/lib/types.ts`):

| emotion | closed | open |
|---|---|---|
| normal | 0 Normal | 6 Open mouth |
| happy | 1 Smile | 7 Happy |
| surprised | 4 Surprise | 10 Surprise open mouth |
| sad | 3 Sorrow | 9 Sorrow open mouth |
| wink | 12 Wink left | 14 Wink left open mouth |

- Frame the head large in the square (head fills ~80% height, centered).
  Reuse whatever camera/scene setup `fflRenderer`/`AvatarScene` already has for
  head rendering; a slight downward camera offset is fine. Don't overbuild —
  this tool runs a handful of times ever.

## Test plan (`src/lib/tour.test.ts`)

- `readTourState`: missing key, malformed JSON, valid round-trip.
- `shouldAutoStart`: per chapter, per flag combination.
- `TourController`: start→next through all steps→null; `skip()` mid-chapter
  fires `onComplete`; last `next()` fires `onComplete` exactly once.
- `charsVisible`: 0 at t=0; monotonic; clamps at textLength; cps honored.
- Chapter data sanity: all step ids unique; all `target` values are either
  null or non-empty strings.

## Acceptance / verification

1. `npm test`, `npm.cmd exec tsc -- --noEmit`, `npm run build` all clean.
2. Fresh profile (clear `miituber.onboardingTour.v1`): library chapter
   auto-plays; spotlight lands on `#add-avatar-tile`; text streams with SFX;
   portrait mouth flips; click-to-fast-forward and click-to-advance work;
   Esc skips and persists the flag.
3. Entering workspace the first time triggers chapter 2; all six targets
   resolve; final step ends cleanly and persists.
4. `?` replay button re-runs the current mode's chapter.
5. Clean-output window and capture-isolate mode show no tour DOM.
6. Reload after completion: nothing auto-plays.

## Docs (same change)

- `CHANGELOG.md`: entry for the onboarding tour.
- `ARCHITECTURE.md`: one short paragraph — tour modules + storage key.
- `DESIGN.md`: dialogue box + spotlight styling notes if any new visual
  patterns/tokens are introduced.
- Do NOT touch `MYTODO.md`.
