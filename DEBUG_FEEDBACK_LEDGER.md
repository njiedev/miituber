# Debug Feedback Ledger

## Problem
- Symptom: The OBS clean-view window does not appear as a transparent floating head in OBS. Depending on config it shows a white box (or would need a chroma/colored fill the user has rejected).
- Desired result: OBS picks up the avatar as a floating head with a genuinely transparent background, **immediately, with no added OBS steps** (no chroma key filter, no colored background of any kind).
- Current constraints:
  - Windows 11 + Tauri v2 + WebView2.
  - User has rejected: custom/substitute window controls (wants real ones), and any colored background that must be keyed out (green/white/blue).
  - "No added steps" in OBS: no per-source filters, no fighting a white box.

## Evidence
- Confirmed: User reports an earlier OBS popup had a normal Windows title bar and true desktop alpha over YouTube before OBS capture. Treat this direct observation as stronger evidence than the blanket "decorated transparency is impossible" assumption.
- Confirmed: Current behavior is white when "Transparent background" is checked and off-white when unchecked. That means the app content is clearing, then revealing a lower native/WebView backing that is still white.
- Confirmed: WebGL renderer is alpha-capable (`alpha:true`, clears with alpha 0 when transparent). App-layer (DOM + canvas) goes transparent correctly. So the white is below the renderer/DOM layer.
- Confirmed: The native Win32 layered-window probe worked with a normal Windows title bar and visibly transparent client area. This proves the clean output must move below WebView2 instead of continuing to tweak Three.js/CSS/Tauri WebView transparency.
- Ruled out (by user): chroma-key fill of any color. Must be true alpha, not a keyed color.
- Contradicted assumption: "OBS can fix/carry transparency later" is not the target. The clean popup itself must be visibly transparent on the desktop before OBS captures it.
- Ruled out: Static configured `clean-output` Tauri window as the missing piece; user retest says it is still white.

## Key insight
The color flip diagnoses the layer: unchecked off-white is app paint (`#e8f0f7`), checked white is the lower native/WebView backing. Three.js can already render only the head with alpha=0 background, but that alpha is being composited onto an opaque native/WebView backing before it reaches the desktop.

## Attempts

### Attempt 1: Frameless transparent window (original, pre-conversation)
- Hypothesis: `decorations:false, shadow:false, transparent:true` gives a transparent window OBS can capture.
- Change: Frameless transparent clean-view window + custom move-only drag strip.
- Verification: Window is see-through on the desktop.
- User feedback: OBS shows a white box; also the substitute control can only move, not close.
- Outcome: failed (for the OBS-alpha goal) / rejected (controls).
- Interpretation: Window was likely truly transparent, but the OBS source (probably BitBlt Window Capture) flattened alpha to white. The white is most likely an OBS capture-method issue, not an app issue.
- Do not retry: frameless-transparent + default BitBlt Window Capture.
- Next direction: identify/force an alpha-capable OBS source.

### Attempt 2: Native decorations + window transparency
- Hypothesis: Keep native title bar/controls and still be transparent.
- Change: `decorations:true, transparent:true`, dropped `shadow:false`.
- Verification: Ran app.
- User feedback: White on the window itself, before OBS even captures.
- Outcome: failed.
- Interpretation: Confirms tauri#8308 - native decorations force an opaque backing on Windows. Cannot have both.
- Do not retry: native decorations together with `transparent:true` on Windows.
- Next direction: decouple "real window controls" from "transparency."

### Attempt 3: Chroma-key fill + opaque native window
- Hypothesis: Skip OS transparency; render head on solid green and key it out in OBS. Keeps native controls.
- Change: `decorations:true` opaque window; "remove background" fills scene with `#00b140`; user adds OBS Chroma Key filter.
- Verification: Typecheck passed; logic gates fill on the checkbox.
- User feedback: Rejected. Wants no colored background and no added OBS filter step.
- Outcome: rejected (works technically, violates the "no added steps / no colored bg" constraint).
- Interpretation: Any approach that requires an OBS filter or a keyable color is off the table.
- Do not retry: chroma key / any colored fill the user must remove.
- Next direction: a source that is transparent with zero OBS configuration -> Browser Source (or WGC Allow Transparency as a quick probe).

### Historical (removed before this conversation, per git log + DECISIONS.md)
- Spout2 output sender - removed for added lag + platform surface area. (Note: Spout2 DOES carry alpha; removal was about complexity/lag, not capability.)
- Native Windows "MiiTuber Camera" Media Foundation virtual source - removed (lag/surface). Virtual cameras do not carry alpha anyway.
- Localhost MJPEG/PNG output server (pushing rendered frames over HTTP) - removed for lag. (Different from a Browser Source that renders client-side and only receives lightweight pose data.)

### Attempt 4: Background-less frameless window, OBS handled by user
- Hypothesis: User says OBS Window Capture handles the rest; app just needs to remove the clean-view background. No alpha infra, no chroma.
- Change: Frameless + `shadow:false` + `transparent:true`; checkbox drops scene + DOM background; re-added drag strip.
- User feedback: FAILED - and angrily. Going frameless removed the native window controls, which is the user's explicit #1 priority. "I literally told you not to change the windows controls as priority number one and you immediately did that."
- Outcome: failed (violated the hard constraint).
- Interpretation: HARD CONSTRAINT, do not violate: native window controls (`decorations:true`) must always stay. Do NOT go frameless for transparency, ever. If a transparency approach requires removing controls, that approach is wrong by definition for this user.
- Do not retry: frameless window in any form; custom/substitute control strips; chroma fills.
- Next direction: keep `decorations:true`; make only the webview CONTENT transparent and let the user's OBS handle capture.

### Attempt 5: Native controls kept, transparent webview content (CURRENT)
- Hypothesis: Keep `decorations:true` (controls intact) + `transparent:true`; clear the webview content to transparent when the checkbox is on. User insists their OBS Window Capture handles the rest ("OBS does not need an alpha capable source, window view will handle it").
- Change: Window `decorations:true`, `transparent:true`, `backgroundColor:#00000000`, boots transparent then mirrors checkbox. `updateAvatarBackground` clears scene/DOM/canvas to transparent for the clean window when checkbox on. Removed drag strip + drag capability (native title bar moves/closes). (Window-config edits were applied directly by the user; agent cleaned up dead code + stale "frameless" comments.)
- Verification: `npx tsc --noEmit` passes.
- User feedback: Failed for desktop alpha. User clarified the current checked state is white and unchecked state is off-white. The target is a visibly transparent window before OBS, not OBS-side transparency.
- Outcome: failed for true desktop alpha / partial for clearing app content.
- Interpretation: The clean renderer content is transparent, but the dynamically created decorated WebviewWindow leaves a white native/WebView backing.
- Do not retry: dynamic `new WebviewWindow` as the primary clean popup path.
- Next direction: use a statically configured hidden `clean-output` Tauri window so it is born as a native app window with its own title/label and transparent config.

### Attempt 6: Static configured clean-output window
- Hypothesis: The earlier working popup used a Tauri-configured native window that was born transparent; the current dynamic JS-created popup is the variable exposing the white backing.
- Change: Added `clean-output` to `tauri.conf.json` as a hidden, transparent, decorated window with URL `/?view=clean-output` and title `MiiTuber OBS Clean View`. The main Open OBS Clean View button now shows/focuses this existing named window instead of calling `new WebviewWindow`. Native X/Escape hide the configured window instead of destroying it, preserving the born-transparent instance. Removed the dynamic creation permission.
- Verification: `npm.cmd exec tsc -- --noEmit`, `cargo check`, and `npm.cmd run build` pass.
- User feedback: Failed. User reports it still did not work after retest.
- Outcome: failed.
- Interpretation: Dynamic-vs-static window creation was not the missing transparency layer. The white background is below Three.js/CSS and persists even for a configured decorated transparent Tauri window.
- Do not retry: Do not add custom JS controls or frameless mode if this fails; native controls remain a hard constraint.
- Next direction: If desktop alpha is still white, the remaining difference is not dynamic-vs-static window creation; inspect lower-level Windows/Tauri transparency options or a minimal Rust-created probe window.

### Attempt 7: Native Win32 alpha probe
- Hypothesis: WebView2 is the layer killing alpha; a plain native Win32 window can keep native title-bar controls while making its client area visually transparent.
- Change: Added `open_native_alpha_probe` Tauri command and an "Open Native Alpha Probe" button. The command opens a separate Win32 `WS_OVERLAPPEDWINDOW` with `WS_EX_LAYERED`, native title bar, a color-keyed transparent client background, and an opaque blue square.
- Verification: `cargo fmt --check`, `cargo check`, `cargo test`, `npm.cmd exec tsc -- --noEmit`, and `npm.cmd run build` pass.
- User feedback: Fixed for the proof window. User confirmed the native window had the desired transparency behavior.
- Outcome: fixed for native-window alpha proof / partial for full clean output.
- Interpretation: Success proves the clean output can move below WebView2 while retaining native window controls. It does not yet prove soft per-pixel Mii alpha or frame-transfer performance.
- Do not retry: If this fails, do not keep tweaking Three.js/CSS/Tauri WebView transparency for the same symptom.
- Next direction: If successful, test feeding a small RGBA/native bitmap into the same native window path before attempting live Mii frames.

### Attempt 8: Promote native clean output window
- Hypothesis: The main OBS Clean View should use the working native layered window and receive RGBA frames from the existing Three.js scene, avoiding the failed WebView clean window and avoiding a second avatar-renderer window.
- Change: Removed the visible alpha probe button and stale configured `clean-output` WebView window. `Open OBS Clean View` now calls `open_native_clean_output`, captures the existing `AvatarScene` into a 720x720 RGBA render target at up to 60fps, and publishes those frames to the native Win32 layered window. The native window keeps normal Windows controls and uses transparent pixels for background removal when the app's Transparent background checkbox is enabled.
- Verification: `npm.cmd exec tsc -- --noEmit`, `npm.cmd run build`, `npm.cmd test`, `cargo fmt --check`, `cargo check`, and `cargo test` pass.
- User feedback: Failed for FPS. User reports the view is very laggy and correctly identifies it as equivalent to the old copied-frame output path.
- Outcome: failed for output FPS / partial only for native transparency.
- Interpretation: Native transparency worked, but `readRenderTargetPixels` + Tauri IPC + GDI `StretchDIBits` recreated the same frame-copy bottleneck. The fix must make the renderer surface be the output, not publish copied frames.
- Do not retry: Do not reintroduce a WebView clean-output window, frameless titlebar, or chroma fill as the main route.
- Next direction: Try a renderer-direct clean WebView window again, but solve transparency at the native window layer with a Windows color key so WebGL renders normally and no per-frame pixels cross IPC.

### Attempt 9: Renderer-direct WebView with native color key
- Hypothesis: A decorated clean WebView window can keep browser-rendered Three.js FPS if it renders on a keyed background, while a native `WS_EX_LAYERED + LWA_COLORKEY` style punches that background out at the OS window level. This differs from rejected OBS chroma-key because no OBS filter is involved and the background should be transparent on the desktop.
- Change: Removed the copied-frame native output path from the frontend. Restored the named `clean-output` renderer WebView window, but with an opaque `#ff00ff` background when transparent output is enabled. Added `set_clean_output_color_key`, a Rust command called by the clean popup to apply/remove `WS_EX_LAYERED + LWA_COLORKEY` on that popup HWND. The clean popup now loads the avatar from stored source bytes and renders through its own Three.js scene, syncing only avatar/background/pose events from the main window.
- Verification: `npm.cmd exec tsc -- --noEmit`, `npm.cmd run build`, `npm.cmd test`, `cargo fmt --check`, `cargo check`, and `cargo test` pass.
- User feedback: Partial. User reports it is smooth, but the background is bright purple.
- Outcome: partial.
- Interpretation: Renderer-direct fixed the FPS bottleneck, but parent-window color key did not punch through the WebView2-rendered pixels. The purple is likely painted by a child/compositor HWND that is not affected by the top-level layered style.
- Do not retry: If this fails with a white box, the WebView/DComp child surface is bypassing parent color-key composition.
- Next direction: Apply the same native color key to descendant WebView HWNDs before declaring WebView2 incompatible with this route.

### Attempt 10: Color-key descendant WebView windows
- Hypothesis: The top-level clean Tauri window is color-keyed, but the WebView2 child/compositor window paints the purple pixels independently. Applying `WS_EX_LAYERED + LWA_COLORKEY` recursively to child HWNDs may punch out the actual rendered WebView surface while keeping renderer-direct FPS.
- Change: Updated `set_clean_output_color_key` to enumerate descendant child HWNDs with `EnumChildWindows` and apply/remove the same layered color-key style on each child window, while still treating child failures as non-fatal.
- Verification: `npm.cmd exec tsc -- --noEmit`, `npm.cmd run build`, `npm.cmd test`, `cargo fmt --check`, `cargo check`, and `cargo test` pass.
- User feedback: Failed for visibility. User reports smooth + transparent becomes completely black, with nothing visible.
- Outcome: failed.
- Interpretation: Applying layered color-key styles to WebView2 child/compositor HWNDs breaks the rendered surface. Parent-only keying leaves purple visible; child keying turns the WebView black. WebView2 color-keying is not a viable true-alpha route here.
- Do not retry: Do not keep applying color-key/window-layer tweaks to WebView2 parent or child HWNDs for this symptom.
- Next direction: Revert the child-HWND recursion to preserve the smooth renderer popup, then choose between a real native renderer/GPU output path or an explicit OBS-side chroma-key fallback.

### Attempt 11: WebView2 background transparency API
- Hypothesis: Native color-keying is incompatible with WebView2 composition, but Tauri exposes WebView2's own background-color control separately from the window background. Setting the clean popup's actual WebView background to transparent/null may preserve renderer-direct FPS without purple/black color-key side effects.
- Change: Not attempted. User asked to reset to the WebView2 baseline for brainstorming instead of trying another transparency lever.
- Verification: Not applicable.
- User feedback: Not applicable.
- Outcome: inconclusive / parked.
- Interpretation: Keep this as a possible future probe, but the active code is reset to the simple WebView2 clean popup.
- Do not retry: If this still shows an opaque backing, do not continue tweaking CSS/window color/key layers around WebView2.
- Next direction: Real native renderer/GPU surface, or OBS chroma-key fallback.

### Reset: WebView2 baseline for brainstorming
- Hypothesis: User needs a simple smooth Clean View baseline to reason from, without native color-key/Win32 transparency experiments altering the behavior.
- Change: Removed the native color-key Rust command/module, restored the clean-output popup to `transparent:true` + `backgroundColor:"#00000000"`, and made the clean window use the ordinary transparent Three.js/CSS path again.
- Verification: `npm.cmd exec tsc -- --noEmit`, `npm.cmd run build`, `npm.cmd test`, `cargo fmt --check`, `cargo check`, and `cargo test` pass.
- User feedback: PENDING.
- Outcome: inconclusive.
- Interpretation: This is a reset point, not a new fix attempt.
- Do not retry: Do not re-add native color-keying unless there is new evidence.
- Next direction: Brainstorm output architecture from the smooth WebView2 baseline.
