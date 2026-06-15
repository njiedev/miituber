# Phase 4 Spike 01: Does the OBS output path work?

## Goal

Find out whether MiiTuber frames can reach OBS -> OBS Virtual Camera -> a
conferencing app (Zoom/Discord/Meet).

This de-risks all of Phase 4 Part A. If the cheap path is good enough, we may not
need to write a virtual-camera driver at all.

## Current app output path

The app now publishes output frames from the webview to Rust, and Rust serves the
latest JPEG frames locally:

- MJPEG stream: `http://127.0.0.1:49321/stream.mjpeg`
- Latest frame: `http://127.0.0.1:49321/frame.jpg`
- Transparent OBS page: `http://127.0.0.1:49321/source-transparent.html`

The intended OBS-first route is: OBS reads the local MJPEG stream, then OBS's
built-in "Start Virtual Camera" publishes it system-wide.

The fallback route is window capture of the app's OBS Clean View.

Important distinction: the Browser Source is only OBS's input. It is not the
virtual camera device. The camera device that Zoom/Discord/Meet see is OBS
Virtual Camera. A separate "MiiTuber Camera" device like VTube Studio would
require native Windows virtual camera work and stays a stretch goal unless this
OBS-first route fails.

Transparency note: the MJPEG Browser Source path uses JPEG frames, so it cannot
carry alpha. Use a solid background for OBS Virtual Camera / conferencing apps.
If the goal is transparent compositing inside OBS, enable transparent background
in MiiTuber and use the Transparent OBS page URL instead of the MJPEG URL.

## Setup (one time)

1. Install OBS Studio (free) if not already installed.
2. Confirm the local FFL renderer can produce a GLB:
   `npm run verify:renderer-glb -- mee.ffsd`.
3. Start the Tauri app.
4. Load a Mii and start tracking/lip-sync as desired.
5. Click "Start Output" in MiiTuber.
6. Run `npm run verify:output-stream`. This should report one latest JPEG frame
   and three MJPEG frames with observed FPS. If it fails, debug MiiTuber before
   opening OBS.
   Run `npm run verify:output-stream -- --help` to see all verifier options.
   For a stronger FPS preflight, run
   `npm run verify:output-stream -- http://127.0.0.1:49321 30 --min-fps=24`.
7. If testing transparent OBS compositing, enable Transparent background before
   Start Output and run `npm run verify:output-stream -- --transparent`. This
   should also report an alpha-capable PNG frame and the transparent OBS source
   page.

## The experiment

1. In OBS: Sources -> + -> Browser.
2. Set URL to `http://127.0.0.1:49321/stream.mjpeg`.
3. Set width/height to match MiiTuber output, default `1280x720`.
4. Confirm the Mii appears and animates in OBS.
5. Click "Start Virtual Camera" in OBS.
6. Open Zoom/Discord/Meet -> video settings -> select "OBS Virtual Camera".
7. Talk and move. Watch the Mii in the conferencing app's self-view.

## Transparent OBS compositing experiment

This is for OBS scenes, not conferencing apps.

1. In MiiTuber, enable Transparent background before Start Output.
2. Run `npm run verify:output-stream -- --transparent`.
3. In OBS: Sources -> + -> Browser.
4. Set URL to `http://127.0.0.1:49321/source-transparent.html`.
5. Set width/height to match MiiTuber output, default `1280x720`.
6. Confirm OBS shows the avatar with alpha over the scene background.

## Fallback experiment

If Browser Source does not display the stream:

1. In MiiTuber, click "Open OBS Clean View".
2. In OBS: Sources -> + -> Window Capture -> pick the MiiTuber window.
3. Crop/scale the source if needed.
4. Continue with OBS Virtual Camera as above.

## Pass / fail criteria

Record the actual result for each:

- [x] OBS Browser Source displays the MiiTuber MJPEG stream. User reported this
  works on 2026-06-15.
- [x] MJPEG transparency does not work. Expected limitation: MJPEG is JPEG-only
  and cannot carry alpha.
- [ ] Mii appears in the conferencing app at all.
- [ ] Latency feels acceptable (mouth/head move roughly in real time, no obvious lag).
- [ ] Frame rate is smooth (no visible stutter; note approx fps if OBS shows it).
- [ ] Image is clean (no app chrome, no debug UI, no resize jank).
- [ ] MJPEG source keeps working if the app window is resized / moved / partially off-screen.

Use `PHASE4-OBS-VERIFICATION.md` to record the full OBS Virtual Camera test run.
Use `PHASE4-REQUIREMENTS-AUDIT.md` to decide whether the whole Phase 4 PRD is complete.

## Observed result so far

2026-06-15:

- OBS Browser Source can read `http://127.0.0.1:49321/stream.mjpeg`.
- Transparent background does not work through Browser Source because the stream
  uses MJPEG/JPEG frames. This is expected and not a blocker for conferencing
  output, since OBS Virtual Camera sends an opaque webcam feed.
- Still unverified: OBS Virtual Camera selected in Zoom/Discord/Meet, perceived
  latency, sustained FPS, resize/move behavior.

## Decision tree based on result

- ALL pass with Browser Source -> Part A ships via OBS-first path. Then start the
  native Windows "MiiTuber Camera" follow-up so the app can appear as its own
  webcam device like VTube Studio.

- Browser Source fails but Clean View capture passes -> ship Clean View as the
  OBS-first path and note the Browser Source failure.

- Capture works but LATENCY/FPS is bad, OR window capture is unreliable (goes
  black when minimized, etc.) -> escalate to native virtual camera: push frames
  webview -> Rust -> a Media Foundation/DirectShow virtual cam source. This is
  the expensive path the PRD lists as a stretch goal; only do it if forced.

- Does not appear at all -> debug OBS virtual cam install first (driver), this is
  an OBS-side problem, not a MiiTuber problem.

## What to write down when done

In `to-codex.md` (or wherever Phase 4 notes live), record:

- which result bucket above you landed in
- approx latency and fps observed
- the next task implied by the decision tree
