# MiiTuber

A desktop VTuber alternative that uses Mii-style 3D avatars instead of anime models. Users import their existing Mii data (file or QR code), point it at their webcam, and the app outputs a virtual camera feed of the Mii mirroring their face for OBS to capture.

The core insight: existing VTuber tools all use anime aesthetics, which gates a lot of streamers who don't want to be "an anime girl on Twitch." Mii-style avatars are friendly, recognizable, and serve a different audience.

**MVP scope is import-only.** No Mii creation UI in the app. Users bring their own Mii data files. This keeps scope tight and the legal posture clean (the app isn't distributing or helping create Miis, just rendering files the user brought).

---

## Tech stack

- **Shell:** Tauri (Rust + webview)
- **Frontend (webview):** TypeScript + Three.js, custom-built render view (NOT a fork of datkat21's creator UI)
- **Mii data parsing:** `PretendoNetwork/mii-js` library
- **Mii rendering backend:** `ariankordi/FFL-Testing` renderer-server (Go), bundled as a sidecar process
- **Face tracking:** MediaPipe Face Landmarker (WASM in webview, 52 ARKit-spec blendshapes output)
- **Expression mapping:** TypeScript layer mapping ARKit blendshapes → Mii expression states
- **Virtual camera output:** Rust, platform-specific (DirectShow on Windows, v4l2loopback on Linux, CMIO on macOS)

The render view will likely lift small bits of Three.js glue from `datkat21/mii-creator` (the parts that connect mii-js parsing to the FFL renderer to a Three.js scene), but the creator UI itself is out of scope.

## Build phases

The current state of the codebase should match an active phase. Always check which phase is active before suggesting changes — don't introduce phase 4 concerns into phase 2 work.

0. Validate FFL renderer locally — can hit the Go server with a Mii file via curl, get a rendered image back
1. Tauri shell with import + static render — drag in `.ffsd`/`.miic` file, parse with mii-js, render Mii in 3D, no tracking
2. Face tracking → Mii head rotation — webcam + MediaPipe, head rotation drives Mii head
3. Expression mapping — ARKit blendshapes drive Mii expressions (HARDEST PHASE)
4. Virtual camera output — rendered frames piped to a virtual camera
5. Polish — hotkeys, settings, packaging, additional import methods (QR scan)

## Decisions already made

**Tauri, not Electron:** smaller binary, easier virtual camera output from Rust, the frontend is a webview so existing TypeScript code drops in nearly unchanged.

**Import-only MVP, no Mii creator in the app:** users bring their own `.ffsd`/`.miic` files (drag and drop). The Mii creator is the largest and most UX-intensive part of the Mii ecosystem; cutting it removes huge surface area. Tradeoff: gates adoption to people who already have Mii data. Acceptable for MVP. Phase 5 can add a "make a Mii" button that opens an external creator like `mii.nxw.pw`.

**File import first, QR/NNID later:** drag-and-drop file import is the simplest, has no network dependencies, and is legally cleanest. QR code scanning (Phase 5) is a nice add. NNID/PNID server lookup is probably never — too much legal and dependency risk.

**Use mii-js for parsing, FFL server for rendering, write everything else from scratch:** don't fork datkat21/mii-creator wholesale. Lift the small Three.js glue bits that connect mii-js → FFL → Three.js scene. The creator UI is out of scope and forking it would mean understanding/maintaining 60-70% of code we don't need.

**MediaPipe, not ARKit directly:** ARKit requires iPhone TrueDepth. MediaPipe runs on any webcam, in WASM, and outputs the same 52 blendshape spec. Tradeoff: less accurate, but actually works on a streamer's existing setup.

**Self-host the FFL renderer:** depending on `mii-unsecure.ariankordi.net` in production is fragile and rude. Bundle it as a sidecar process in the Tauri app.

Maintain `DECISIONS.md` in the repo root. Every non-obvious choice gets one line: "Chose X over Y because Z." If it doesn't exist yet, create it. Update it whenever a real decision is made. Read it before suggesting anything that touches a previously-decided area. The decisions log doubles as a study aid — when Mohammed comes back to a part of the codebase weeks later, the log reminds him of *why*, which is the part that's hardest to reconstruct.

---

## Nintendo legal posture

This project operates in a gray zone. Mitigations baked into the design:
- Frame as "Wii-style avatars," not "Miis"
- No Nintendo trademarks in branding, UI copy, or repo name
- Users bring their own Mii data files; the app doesn't distribute pre-made Miis
- Open source, free, "preservation/hobbyist" framing

**If Mohammed asks about commercializing or adding Nintendo branding:** push back. Remind him of the legal posture. This is non-negotiable for the project's survival.

---

## Things to avoid suggesting

- **Switching to Electron** — already evaluated, Tauri won.
- **Adding a Mii creator UI to the app** — explicitly out of scope. Users bring their own Mii files. Resist scope creep here especially because the Mii creator is the largest source of "could be cool" tangents in this ecosystem.
- **Forking datkat21/mii-creator wholesale** — lift small render glue bits only. The creator UI is dead weight for this project.
- **Using anime VTuber rigging tools (Live2D, VRoid, VSeeFace pipelines)** — wrong aesthetic, defeats the project's premise. The Mii rendering pipeline is fundamentally different.
- **Targeting iPhone/iOS face tracking only** — desktop-first, webcam-first.
- **Cloud rendering** — desktop app, runs locally, no server dependency.
- **NNID/PNID server lookup for Mii import** — too much legal and dependency risk. File import only for now, QR scan later.
- **Adding "AI features" for the sake of it** — the project doesn't need an LLM, doesn't need generative image models. Resist scope creep here.

## Technologies NOT in this project

Don't pretend these are part of the stack. They've come up in conversation but aren't here:

- **ARKit** — iOS-only, not used. MediaPipe outputs ARKit-*spec* blendshapes (same 52 names) but ARKit itself isn't in the stack. If Mohammed wants to learn ARKit, it's a separate iOS project.
- **Live2D / VRoid / VRM** — referenced for context only, not part of the implementation. The Mii pipeline is fundamentally different.

---

## Hardest parts (where to spend extra care)

1. **Phase 3 expression mapping** is the technical heart of the project. Miis have a discrete expression set (Miitomo had ~10 expressions like normal/happy/sad/surprised/angry/wink). MediaPipe outputs 52 continuous values. The mapping needs:
   - Hysteresis on discrete expression switches so they don't flicker
   - Continuous overrides for jaw-open (talking) and eye-blink — these have to be smooth, not stepped
   - Eye gaze direction handled separately from expression
   - Reference: `https://extra-ordinary.tv/2024/01/07/getting-google-mediapipe-to-control-vrm-characters/` solved the same problem for VRM

2. **Phase 4 virtual camera output** is platform-specific and finicky. Don't try to abstract across all three OSes early. Pick one (Windows, since most streamers) and ship it before generalizing.

3. **Real-time FFL rendering performance** — confirm early in Phase 0 that the FFL renderer can sustain 30+ fps. If it can't, the whole approach needs rethinking.

---

## Working mode: LEARNING MODE

Mohammed is using this project as a learning vehicle. He has not used Tauri, MediaPipe, or done ML-adjacent work before. The goal is shipping AND coming out fluent in the technologies involved. He wants to ship, but is choosing depth over speed in the areas that matter for his career.

**Default behavior: teach while building.** For non-trivial work, explain the concepts first, then implement. Don't assume he knows the framework or library you're using. Don't dump code without context.

### Where to slow down (deep learning zones)

These are the technologies that carry transferable value and that he wants to actually understand:

1. **MediaPipe and the blendshape system.** Explain what the model is doing, what each blendshape means, why some are noisier than others. This is his entry point to ML thinking — treat it that way. Show the math when relevant.
2. **The expression mapping layer (Phase 3).** This is original work. He designs it. Walk through tradeoffs (hysteresis approaches, smoothing strategies, discrete-vs-continuous handling). Don't hand him a finished design.
3. **Tauri's IPC and process model.** When introducing Tauri concepts, explain *why* the architecture is the way it is (webview vs native, message passing vs shared memory, the security model).
4. **The face tracking → render loop.** Real-time pipelines are a transferable concept. Explain frame budgets, latency vs throughput, why dropped frames happen.
5. **Virtual camera output (Phase 4).** Systems-level work. Worth understanding the OS interfaces (DirectShow on Windows etc.), not just calling a crate.
6. **Rust ownership and borrowing** when it comes up in his code. He's a CS student, not a Rust beginner per se, but explain ownership concepts the first few times they bite.

### Where to move faster

These don't carry meaningful learning value and would slow the project down:

1. **Build configuration and tooling.** Tauri config, bundler setup, CI files, `package.json` adjustments. Generate, briefly note what it does, move on.
2. **Three.js internals.** He should be able to *use* Three.js for this project, not master it. Cover the concepts he needs (scenes, cameras, materials at a surface level) and move on.
3. **Go basics for the FFL server.** Just enough to run it and modify config. Not a Go learning project.
4. **mii-js library usage.** Read the README, use the parsing API, move on. No need to deeply understand the library's internals unless something breaks.
5. **Boilerplate syntax in any language.** Don't pause to teach standard library functions or basic syntax — he can look those up.

### Teaching style

- **Explain by analogy first, formalism second.** "Blendshapes are like sliders that morph the face — at 0 the slider is off, at 1 it's all the way on" before getting into morph target math.
- **Show, don't just tell.** When introducing a new concept, prefer a small runnable example over abstract description.
- **Quiz him gently.** After explaining something non-obvious, ask "does that make sense, or want me to go again from a different angle?" Don't just plow forward.
- **When he writes code, review it.** If he writes the implementation and asks for review, give real feedback — including style and idiomatic concerns, not just correctness.
- **Respect his existing knowledge.** He's done full-stack at LANL, built Swift apps, knows React and TypeScript well. Don't re-explain things he obviously knows. Calibrate based on his questions.

### Watch for the failure mode

Mohammed has been warned in the past about being spread too thin across too many CS subfields. The reason this project is okay despite touching many technologies is that they're all *one coherent pipeline*. If you notice him drifting into "let me also learn X because it'd be cool" where X isn't actually needed for this project, push back. Stay focused on what ships the app.

---

## Code style

- TypeScript: standard modern conventions (strict mode, ES modules). No need to match datkat21/mii-creator's style since we're not forking it.
- Rust (Tauri side): standard Rust style, `cargo fmt`, `cargo clippy`.
- No unnecessary abstractions. This is a focused single-purpose app, not a framework.
- Comments explain *why*, not *what*. Especially around the expression mapping logic — that code will be confusing without context.

## Communication preferences

- Lead with "why" and "what's next"
- No em dashes
- Direct, no over-polished framing
- Don't hedge — give a recommendation, then the tradeoffs

---

## Mii ecosystem reference

This section exists because the Mii reverse-engineering community is small, scattered, and not well represented in LLM training data. **If you're about to say something specific about Mii formats or rendering, check this section first.**

### Key projects

- **`datkat21/mii-creator`** — TypeScript/Bun Mii creator. **Reference only for this project, not a fork foundation.** The Three.js glue that connects mii-js parsing → FFL renderer → scene is worth lifting. The creator UI itself is out of scope. Custom `.miic` format extends FFSD with Switch-era colors and glasses. README marks it as "OLD OSS Version" — current `mii.nxw.pw` is closed-source and ahead.
- **`ariankordi/FFL-Testing`** (renderer-server-prototype branch) — the actual rendering backend. HTTP server taking Mii data, returning rendered images / 3D data. **This is the core dependency.** Bundled as a sidecar process. datkat21's fork `datkat21/FFL-Testing-with-hats` adds hat support if hats are wanted later.
- **`mii-unsecure.ariankordi.net`** — public instance with extras (blinn shading, Miitomo expressions, full body). Don't depend on it in production. Useful for testing/reference during development.
- **`PretendoNetwork/mii-js`** — TypeScript library for parsing/encoding Mii data. **Direct dependency for this project.** Handles `.ffsd` and related formats.
- **Pretendo Network** — community-run Nintendo Network replacement. Forum at `forum.pretendo.network` is a primary reference for Mii format details.

### Mii data formats

These are incompatible across console generations:

- **FFSD** — 3DS / Wii U format
- **AFL** — older Wii format
- **Miitomo** — mobile app, slightly extended FFSD
- **Switch Mii data** — added new colors and glasses
- **Studio data** — Mii Studio (Switch app) format
- **`.miic`** — datkat21's extended FFSD with Switch additions, can downgrade back to FFSD

**If a format is mentioned, ask which one.** Don't assume. Conversion is non-trivial and lossy in some directions.

### Why expression mapping is hard

Miis are not rigged like VTuber models. Standard VTuber pipeline:
```
webcam → MediaPipe → 52 ARKit blendshapes → applied to rigged 3D model
```

Mii pipeline as it exists:
```
Mii data → FFL renderer → swap to one of N discrete expressions
```

To bridge these for MiiTuber, the design must:
1. Map continuous blendshape values to discrete expression states with hysteresis
2. Add custom continuous overrides on top of the discrete expression — at minimum jaw-open and eye-blink. May require modifying FFL or post-processing the rendered output.
3. Drive eye gaze direction separately, since FFL supports this independently of expressions.

There's no documented "right way." It's research work. Closest reference: the Extra Ordinary blog post on MediaPipe → VRM.

### Things that look like they should work but don't

- **3D model export from `mii.nxw.pw` is currently broken** as of late 2025. Don't rely on it.
- **Direct conversion of FFSD → glTF/VRM** — no clean tool exists. The MMD conversion via Noesis + PMXEditor is the closest, and it's a multi-step manual process.
- **Switch Mii data on non-Switch platforms** — extra colors/glasses get downgraded.

### Tools you'll touch

- **Go** — for running the bundled FFL renderer-server (`go build`, `go run`). Won't write much Go, just configure and run.
- **Three.js** — Mii is rendered into a Three.js scene in the webview
- **`@mediapipe/tasks-vision`** — face tracking in the browser
- **mii-js** — parsing Mii data files imported by the user

Note: datkat21's repo uses Bun, but since we're not forking it, this project's frontend tooling can match Tauri defaults (Vite, Node, npm/pnpm) unless there's a reason to switch.

### Glossary

- **FFL** — Nintendo's internal Mii rendering library, reverse-engineered
- **FFSD** — Mii data format used by 3DS/Wii U
- **AFL** — older Wii Mii format
- **NNID** — Nintendo Network ID (Wii U / 3DS)
- **PNID** — Pretendo Network ID
- **Pretendo** — community-run Nintendo Network replacement
- **`mii-js`** — TypeScript library for working with Mii data
- **Miitomo** — discontinued mobile app, source of expanded expression set
- **Mii Studio** — Switch app, uses a different data format
- **Studio data** — the format used by Mii Studio
