# Phase 4 OBS Virtual Camera Verification

Date: 2026-06-15
Tester: Mohammed / Codex
Mii data file: `mee.ffsd` for renderer preflight
Output resolution: 1280 x 720 default, unless changed in app
Output FPS: 30 default, unless changed in app
Mouth source: not yet recorded
Background: solid background recommended for MJPEG / OBS Virtual Camera

## Preflight

- [x] `npm run verify:renderer-glb -- mee.ffsd` passes. Codex observed a GLB
  with 19 expression variants on 2026-06-15.
- [ ] MiiTuber loads the avatar and Start Output succeeds.
- [ ] In-app Frame probe reports an OK JPEG.
- [ ] `npm run verify:output-stream` reports one latest JPEG and three MJPEG frames.
  Observed verifier FPS:
- [ ] Optional stronger FPS preflight:
  `npm run verify:output-stream -- http://127.0.0.1:49321 30 --min-fps=24` passes.
- [x] OBS Browser Source displays `http://127.0.0.1:49321/stream.mjpeg`.
  User reported this works on 2026-06-15.
- [ ] If transparent background is enabled: `npm run verify:output-stream -- --transparent`
  reports an alpha-capable PNG frame and the transparent source page.
- [ ] Optional transparent OBS compositing: Browser Source displays
  `http://127.0.0.1:49321/source-transparent.html` with alpha.

## OBS Virtual Camera

- [ ] OBS Virtual Camera starts without error.
- [ ] Target app:
- [ ] Target app can select `OBS Virtual Camera`.
- [ ] MiiTuber appears in the target app self-view.
- [ ] Image is clean: no app chrome, no debug UI, no resize jank.
- [ ] Latency feels acceptable: mouth/head movement is roughly real time.
- [ ] Frame rate feels smooth, with no obvious stutter.
- [ ] MJPEG source keeps working after resizing the MiiTuber app window.
- [ ] MJPEG source keeps working after moving the MiiTuber app window.
- [ ] MJPEG source keeps working while the MiiTuber app window is partially off-screen.

## Known Limitations

- MJPEG Browser Source uses JPEG frames, so transparency is not preserved.
- Transparent OBS page uses PNG frames and is for OBS scene compositing.
- OBS Virtual Camera sends a normal opaque webcam feed to conferencing apps.
- Native Windows `MiiTuber Camera` is the next track after this OBS-first path is verified.

## Result

Result bucket:

- [ ] Pass: OBS Browser Source -> OBS Virtual Camera -> target app works.
- [ ] Partial: OBS Browser Source works, but OBS Virtual Camera or target app fails.
- [ ] Partial: Clean View capture works better than Browser Source.
- [ ] Fail: MiiTuber output stream does not work reliably enough for OBS.

Notes:

- OBS Browser Source works as an OBS input.
- Transparent background does not work through the MJPEG Browser Source because
  MJPEG uses JPEG frames and JPEG has no alpha channel.
- Remaining proof is OBS Virtual Camera -> target app, plus latency/FPS/image
  cleanliness.
- Use `PHASE4-REQUIREMENTS-AUDIT.md` before marking Phase 4 complete.
