# MiiTuber

Local desktop VTuber prototype using Wii-style avatars. Users import their own avatar data, render it through a local FFL renderer, and drive the 3D head with webcam tracking.

## Current phase

Phase 2: webcam tracking into a Three.js avatar scene.

Implemented in this repo:

- Import `.ffsd`, Switch CharInfo, Studio data, and legacy `.miic`-like payloads
- Fetch one `.glb` with all 19 expression variants from the local FFL renderer
- Render the GLB in Three.js with orbit controls
- Manually switch expressions
- Start/stop webcam tracking with MediaPipe Face Landmarker
- Map MediaPipe blendshapes to discrete FFL expression indices
- Smooth head rotation and stabilize expression switching
- Optional transparent background for compositing
- Camera privacy note before tracking starts
- Collapsed debug panel for FPS, detection time, blendshape scores, and head pose

## Run locally

Start the FFL renderer first. The app expects it at:

```powershell
http://127.0.0.1:5000
```

Then run the Tauri app:

```powershell
npm install
npm run tauri dev
```

The Vite-only dev server is useful for UI smoke tests, but Tauri IPC, GLB rendering through Rust, and camera permission should be verified through `npm run tauri dev`.

## Phase 2 verification checklist

Use a known-good `.ffsd` file, for example `mee.ffsd` in the repo root.

1. Confirm the renderer health pill says port `5000` is reachable.
2. Run `npm run verify:renderer-glb -- mee.ffsd bridge/verify-mee.glb` and confirm it reports 19 variants and at least 19 material mappings.
3. Select the `.ffsd` file and click `Render 3D Model`.
4. Confirm the 3D avatar appears and can be orbited with the mouse.
5. Change the Expression dropdown and confirm the face texture changes.
6. Confirm the tracking controls say webcam frames stay local and are not sent to the renderer.
7. Click `Start Tracking` and approve camera permission.
8. Confirm tracking status reports a face, tracking FPS, and expression name.
9. Open `Debug tracking data` and confirm blendshape scores change when you smile, blink, open your mouth, and tilt your head.
10. Confirm the avatar head rotates with your head.
11. Click `Stop Tracking` and confirm the camera releases.

## Tests

```powershell
npm test
npm run build
npm run verify:renderer-glb -- mee.ffsd bridge/verify-mee.glb
cd src-tauri
cargo test
```

## Notes

Current 128-byte `.miic` v4 files are rejected until a real converter exists. Export `.ffsd` or renderer-supported CharInfo/Studio data for now.
