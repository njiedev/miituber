# PRD: MiiTuber Spout2 Output

## Audience

For the agent coding directly in the MiiTuber Tauri app. This doc is spec +
research; it does not write code. Implementation lives in `src-tauri` (Rust),
with a small C++ shim (see Architecture).

## Summary

Publish the rendered Mii as a Spout2 SENDER named "MiiTuber" so OBS (via the
Spout2 OBS plugin) can receive it as a source WITH transparency/alpha. Spout is
GPU-to-GPU frame sharing on Windows (DirectX shared textures); think
Syphon-for-Windows. This is the new active output path.

## Scope & Decisions (confirmed with Mohammed)

- Consumer: OBS ONLY for now. Spout is NOT a webcam; Zoom/Discord/Meet will NOT
  see it directly. Direct-to-app is the PARKED native-camera workstream, later.
- Implementation: Rust-owned (`src-tauri`), via a thin C++ shim over the Spout
  SDK (see Architecture / research).
- DO NOT BREAK the current working path: OBS Browser Source (MJPEG on
  127.0.0.1:49321) is how the VTuber is viewed today. Spout2 is ADDED ALONGSIDE
  it as a second output, not a replacement, until proven.
- DO NOT delete the parked native-camera code (`native-camera-source` crate,
  `native_camera*`). Keep it compiling.

## Why Spout2 over the native camera (context)

The native Windows camera path requires satisfying the full Media Foundation COM
contract (class factory, descriptors, IMFSample delivery, "registers but won't
open" traps). Spout sidesteps all of that: you create a sender and push frames.
It also carries ALPHA, which the MJPEG and camera paths cannot. Trade-off: OBS-
only reach. Accepted.

## Research Findings (grounded, use these)

Spout SDK: `leadedge/Spout2` on GitHub. Use the **SpoutDX** class
(`SPOUTSDK/SpoutDirectX/SpoutDX/SpoutDX.h`). It is the DirectX 11 sender and,
crucially, supports sending CPU-side pixel buffers, which matches our existing
frame path.

Confirmed SpoutDX sender API (signatures from the header):

```cpp
bool OpenDirectX11(ID3D11Device* pDevice = nullptr); // pass nullptr -> SpoutDX creates its own DX11 device
bool SetSenderName(const char* sendername = nullptr);
void SetSenderFormat(DXGI_FORMAT format);
bool SendImage(const unsigned char* pData, unsigned int width, unsigned int height, unsigned int pitch = 0); // CPU pixel buffer path
bool SendTexture(ID3D11Texture2D* pTexture);  // GPU texture path (later optimization)
void ReleaseSender();
void HoldFps(int fps);
```

Key implications:
- `OpenDirectX11(nullptr)` means SpoutDX OWNS the DX11 device. Rust does NOT need
  to create or manage DirectX. Big simplification.
- `SendImage` takes a CPU buffer + width/height/pitch. This is the v1 path: feed
  it our existing `latest_rgba`. (Pitch = width * 4 for 32-bit; pass 0 to let it
  compute.)
- Pixel format: SpoutDX SendImage expects 32-bit RGBA byte order. Our existing
  MJPEG path read back `latest_rgba` (RGBA). VERIFY byte order on first receive:
  if colors are swapped in OBS, switch to BGRA (`SetSenderFormat`) or swap
  channels. Do not assume; confirm visually in OBS.
- Alpha: SendImage with 32-bit data carries alpha. This is the whole point vs
  MJPEG. Ensure the frame published from the webview is genuine RGBA with a real
  alpha channel (transparent background enabled in the Three.js scene -
  `AvatarScene.setTransparentBackground(true)` exists in `src/lib/scene.ts`).

Rust binding situation (decided):
- `virtual-puppet-project/rusty-spout` exists but is minimal and unmaintained
  (6 commits, 2023, Godot-oriented, undocumented API, ships a stripped Spout2
  fork needing SpoutLibrary.dll). DO NOT depend on it.
- RECOMMENDED: write a tiny C++ shim that wraps SpoutDX and exposes a flat
  `extern "C"` API; call it from Rust via FFI (build with the `cc` crate in
  `build.rs`, or prebuild the shim DLL). This is the smallest reliable surface.
- ALTERNATIVE: FFI directly to prebuilt `SpoutLibrary.dll` (C interface via
  `GetSpout()`), but that wraps SpoutGL and pulls in OpenGL interop; the SpoutDX
  shim is cleaner for a pure DX CPU-pixel sender. Prefer the shim.

## Architecture (target)

```text
Three.js scene (webview, transparent background ON)
  -> output frames published to Rust (existing: latest_rgba, RGBA w/ alpha)
  -> NEW Rust module spout_output: calls C++ shim over FFI
  -> C++ shim: SpoutDX OpenDirectX11(nullptr) + SetSenderName("MiiTuber")
              + SendImage(latest_rgba, 1280, 720, 0) per frame
  -> OBS (Spout2 plugin) receives "MiiTuber" sender, composites with alpha
```

The C++ shim (suggested flat API the Rust side calls):

```c
void* miituber_spout_create(const char* sender_name, unsigned w, unsigned h); // returns opaque handle, opens DX11 + sets name
bool  miituber_spout_send_rgba(void* handle, const unsigned char* data, unsigned w, unsigned h); // SendImage
void  miituber_spout_destroy(void* handle); // ReleaseSender + cleanup
```

Rust owns lifecycle (create on "Start Spout Output", send each frame, destroy on
stop / app exit). Keep the FFI surface this small.

## Frame Source

Reuse the existing output frame path. The app already produces `latest_rgba`
(held in Rust for the MJPEG server, `src-tauri/src/lib.rs`). v1 sends THAT buffer
via SendImage every frame. No new capture/readback work; do not change the
webview->Rust frame publishing contract.

Performance note: this is a CPU-buffer send (not zero-copy). Acceptable for v1 at
1280x720@30. True GPU-side `SendTexture` is a LATER optimization, only if CPU/
latency becomes a problem.

## UI

- Add a "Start Spout Output" / "Stop Spout Output" control, SEPARATE from the
  existing MJPEG "Start Output". Both can run; do not couple or replace.
- Show sender state (running + sender name "MiiTuber") and basic frame counter,
  mirroring how the existing output reports state.

## Build / Packaging

- Shim built via `cc` in `build.rs` (compiles SpoutDX.cpp + shim.cpp) OR ship a
  prebuilt shim DLL. Document which.
- Spout SDK source vendored under `src-tauri` (or submodule). License: Spout2 is
  BSD-2-Clause - compatible, include the license.
- No admin/registration needed (unlike the native camera) - sender is in-process.
  Good for the plug-and-play streamer exe.
- Windows-only; guard the module so non-Windows builds still compile (the app is
  Windows-targeted, but keep the cfg gates clean like the native_camera module).

## Build Order

1. [done] Vendoring + build wiring: get SpoutDX + shim compiling and linked into the
   Tauri Rust binary.
2. [done] Implement the 3-function shim over SpoutDX.
3. [done] Rust `spout_output` module + FFI bindings; create/destroy lifecycle.
4. [done] Feed webview RGBA frames into `send_rgba` each frame; the frame loop
   now captures RGBA when Spout is running.
5. [done] UI start/stop + state.
6. VERIFY in OBS: add Spout2 source, select "MiiTuber", confirm live Mii WITH
   transparent background. Check color byte order (RGBA vs BGRA) here.
7. `verify:spout` style check if feasible (assert sender is created/active),
   mirroring `verify:output-stream`.

## Current Implementation Notes

- Spout2 SDK source is vendored at `src-tauri/vendor/Spout2` with its BSD-2-Clause
  license.
- The app compiles a Windows-only static shim from `src-tauri/src/spout`.
- Rust owns the sender lifecycle in `src-tauri/src/spout_output.rs`.
- The UI exposes separate `Start Spout Output` / `Stop Spout Output` controls,
  and the MJPEG Browser Source path remains separate.
- OBS verification is still required on a machine with the OBS Spout2 plugin
  installed.

## Definition of Done

- With the app running and a Mii loaded, OBS Spout2 source lists "MiiTuber".
- Selecting it shows the live Mii at 1280x720 ~30fps with correct colors and a
  TRANSPARENT background composited in OBS.
- Start/stop works; no crash on app close; sender released cleanly.
- The existing MJPEG OBS Browser Source path STILL works unchanged.
- The parked native-camera code still compiles.

## Open Questions / Verify During Build

- RGBA vs BGRA byte order into SendImage (confirm visually in OBS; adjust via
  SetSenderFormat or a channel swap).
- Frame pacing: drive sends from the existing frame publish cadence vs a fixed
  30fps timer using HoldFps. Prefer reusing the existing cadence to stay in sync
  with the renderer.
- Shim build method: `cc`/build.rs compile vs prebuilt DLL (pick the one that
  keeps the plug-and-play exe simplest).

## Constraints

- FFL renderer unchanged; app-side only.
- Keep MJPEG path and parked native-camera code intact.
- Keep FFI surface tiny (3 functions).
- Keep explanations concrete: this project is also Mohammed's learning vehicle.
