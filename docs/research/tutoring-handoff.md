# Tutoring Handoff — FFL.js expression fix (branch: testing-game-capture)

> **Purpose of this file:** bootstrap a fresh Claude Code conversation straight
> into **tutor mode** on this branch. Read this top-to-bottom before responding
> to the user. It captures who the user is, how they want to be taught, what is
> already built, and exactly where we paused in the lesson.
>
> The completed "answer key" implementation lives on the **`ffl-swap-complete`**
> branch. The user is intentionally hand-coding the remaining work here to learn
> it — **do NOT peek at / paste from that branch, and do NOT write the fix for
> them.** Tutor; don't solve.

## Who you're working with

**Mohammed Njie** — CS + AI student (Univ. of Nebraska Omaha). Fluent full-stack
web dev: Python, Flask, TypeScript, React, Tailwind, Swift, Postgres, Docker.
**Do not** re-explain TS/web/React basics. He is **new to this repo's domain** —
Three.js/3D, Rust, Tauri, WASM, native GL — so explain those from the ground up,
ideally by analogy to web dev.

## How he wants to be tutored (important)

He has an explicit "when to use AI" framework: for *learning* projects like this,
AI should act like a **professor in office hours** — help him get unstuck and show
him *why* he's confused, but **never hand over finished code**. Rules:

- **Make him ideate first.** Before revealing an approach, ask what he thinks it
  should be. His words: "Never jump to solutions on a new problem."
- Give the **map + concepts + file/line pointers**; he writes the actual code.
- No code blocks he could paste wholesale to solve the task. Existing code is
  fine to show for *reading*; the *fix* is his to write.
- If he explicitly flips to "just build it," then build. Default here = tutor.

## Project context

MiiTuber = desktop app (Tauri + TS + Three.js) that turns a webcam into a live
Mii avatar for OBS. We are mid-migration: replacing the external FFL renderer
HTTP server (`127.0.0.1:5000`, Go sidecar) with **in-process `ffl.js`** (WASM
`CharModel` in the webview). See `docs/research/prd-ffl-js-swap.md` and
`docs/research/roadmap.md`.

### What is already DONE (the swap — built for him earlier, "just get it working")

- `package.json` — `"ffl.js": "github:ariankordi/FFL.js#v2.2.0"` (git dep, not npm).
- `src/ffl-js.d.ts` — hand-written ambient TS types for the subset of ffl.js we
  use (ffl.js ships no .d.ts). "Menu, not kitchen": describes shapes only.
- `src/lib/fflRenderer.ts` — the seam. `ensureReady()` lazily inits FFL (dynamic
  import of ffl.js + WASM), `createCharModel()` builds a model. WASM URL + `.dat`
  bytes are injected by the caller.
- `src/lib/scene.ts` — `loadModelFromMiiBytes()` parallel to the GLB path;
  `setExpression()` / `disposeCurrentModel()` branch on `charModel` vs GLB.
- `src/main.ts` — `USE_FFL_JS = true` flag; `getFflContext()` fetches the `.dat`
  once and inits FFL; `renderAvatarBytes()` routes to `loadModelFromMiiBytes()`.
- `public/` — `AFLResHigh_2_3.dat` (gitignored, user-supplied) + `ffl-emscripten.wasm`.

Render chain now: pick avatar → `getFflContext()` fetches `/AFLResHigh_2_3.dat`
→ `ensureReady()` inits ffl.js WASM → `loadModelFromMiiBytes()` → `new CharModel`
→ `charModel.meshes` (a Three.js Object3D) → existing WebGLRenderer paints it.
No server, offline. Verified rendering works on-device.

## THE LESSON IN PROGRESS: enable expressions 0–18

**The bug:** `createCharModel` passes `FFLCharModelDescDefault`, whose
`allExpressionFlag` is `Uint32Array([1, 0, 0])` = **only NORMAL (0) enabled**.
FFL bakes one mask texture per *enabled* expression at build time; calling
`setExpression(n)` for a non-enabled `n` throws `ExpressionNotSet`. So live
face-tracking currently can't change expression past Normal — it only *looks*
like it works because load calls `setExpression(0)`.

**The goal:** build the CharModel so expressions **0–18** are enabled (restores
what the old GLB path baked). Concept: convert `[0..18]` → packed flag via the
helper → put it on a desc object → pass that desc to `CharModel`.

### Source references (in `node_modules/ffl.js/ffl.js`)
- `:166` — `FFLExpression` enum. 0–18 standard; 19–69 extra ("names made up"); `MAX = 70`.
- `:2391` — `FFLCharModelDescDefault` (the `[1,0,0]` default). Shows the desc shape:
  `{ resolution, allExpressionFlag, modelFlag }`.
- `:2408` — `makeExpressionFlag(expressions)` — array/number → `Uint32Array(3)` flag.
- `:1662` — `setExpression()` throws `ExpressionNotSet` if not enabled.

### The teaching subtlety (make sure he hits this)
`makeExpressionFlag` is **not declared in `src/ffl-js.d.ts`** yet. When he
`import { makeExpressionFlag } from "ffl.js"`, TS will error ("no exported
member") — because the `.d.ts` (the "menu") never listed it, even though the real
package (the "kitchen") has it. He must ADD it to the ambient declaration. This
is the payoff of the earlier "types are erased / menu vs kitchen" lesson.

### Where we paused (his answers to the 3 ideation questions)
1. *What to pass CharModel?* — He said "a list of numbers 1–18." **Corrections
   given:** include **0** (Normal); and it's not the raw list — it goes through
   `makeExpressionFlag` → onto a desc's `allExpressionFlag` → passed as the desc
   arg. **Still owes:** naming the two-step pipeline (list → flag → desc).
2. *What will TS complain about?* — He said "idk." **Pending.** Next nudge: have
   him open `ffl-js.d.ts`, search `makeExpressionFlag`, and predict the import
   error himself.
3. *Hardcode vs. argument?* — He said hardcode, won't change. **Accepted**, with
   footnote: the expression-hotkeys feature (roadmap item 8) will later widen
   this list, so that's the seam that changes then.

**Resume point:** he was about to (a) name the list→flag→desc pipeline and (b)
go look in `ffl-js.d.ts` to predict the TS error. Pick up there.

## After this fix (his awareness, not now)
Remaining PRD/roadmap items: native GL OBS output reconcile (task #5 — the #1
feature; it still expects GLB bytes the FFL path doesn't produce), thumbnails via
FFL.js, make FFL.js default + eventually delete the Rust HTTP renderer. See
`docs/research/roadmap.md`.

## The full curriculum / delta checklist — READ THIS
`docs/research/ffl-swap-checklist.md` is the running list of everything on the
answer-key branch (`ffl-swap-complete`) that this frozen branch must reach
parity with — i.e. the ordered hand-coding curriculum. **Part A** = the
expression 0–18 fix (the lesson in progress, above). **Part B** = native GL OBS
output made offline via **option 1b** (export one static GLB + 19 mask textures
from the CharModel; the native renderer swaps only the mask *texture* per
expression — decided over 1a's 19-material approach because it mirrors how
FFL.js's `setExpression` actually works). Part B is the next big Rust/3D lesson
after the expression fix. Keep this checklist updated as the reference branch
grows.

## Run / verify
- App: `npm run tauri dev` (toggle `USE_FFL_JS` in `src/main.ts`).
- Types: `npx tsc --noEmit`. Tests: `npx vitest run`.
