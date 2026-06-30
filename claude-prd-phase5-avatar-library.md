# MiiTuber Phase 5 PRD — Avatar Library, Start Screen, and Overlay Controls

## Summary

Turn MiiTuber from a single-file "pick a file, click Render" tool into a
library-first app. On launch the user sees a grid of their saved avatars (like
VSeeFace) plus an **Add Avatar** tile. Selecting an avatar loads it and drops
the user into a workspace where the Mii is centered and the controls live in
collapsible panels overlaid on top of the live 3D render. Import and other
dialogs are popups that float over the still-rendering avatar.

This PRD covers UI/UX, persistence, and the small backend touchpoints. It does
not change the tracking, lip-sync, expression-mapping, or clean-view internals —
only how the user gets to them.

## Goals

1. **Avatar library as the start screen** — a grid of saved avatars + Add Avatar.
2. **Persistent avatars** — imported Miis are saved and survive app restarts.
3. **Select-then-run flow** — choose an avatar, then enter the workspace.
4. **Centered avatar workspace** — the Mii is the visual center.
5. **Collapsible "title-only" controls** — each control group shows just its
   title until expanded; expanding reveals it as a panel over the live render.
6. **Popups render the avatar behind them** — modals/overlays sit on top of a
   canvas that keeps drawing; no teardown of the scene to open a dialog.

## Non-Goals

- No in-app Mii creator/editor (still importing existing data only).
- No change to supported formats (`.ffsd`, CharInfo, Studio, legacy `.miic`);
  128-byte `.miic` v4 stays rejected.
- No cloud sync; storage is local.
- No change to the OBS Clean View window contract or native decorations.
- No body/hand tracking, multi-avatar scenes, etc.

## User Flow

1. **Launch → Library (start screen).**
   - Grid of avatar tiles: thumbnail + name.
   - One **Add Avatar** tile (the only tile if the library is empty).
   - Renderer health badge stays visible (top bar).
2. **Add Avatar → Import popup.**
   - Pick a supported file.
   - App validates + renders a thumbnail via `render_mii_png`.
   - Name field (defaults to filename without extension), editable.
   - Save → avatar persists and appears in the grid.
   - If the renderer is unreachable: allow saving the bytes, show a placeholder
     thumbnail, and generate the real thumbnail later when the renderer is up.
3. **Select avatar → Workspace.**
   - Loads the GLB (`render_mii_glb`) and centers the Mii.
   - Controls appear as collapsed, title-only panels.
4. **In Workspace.**
   - Expand any control group (title acts as the toggle) to reveal its controls
     as an overlay panel; the avatar keeps rendering behind it.
   - Start/Stop tracking, lip-sync, and Open OBS Clean View work as today.
   - **Back to Library** returns to the grid (stops tracking/lip-sync cleanly).

## UI Structure

### Top bar (persistent)
- App name, renderer health badge.
- In workspace: a **Back to Library** action + primary verbs (Start/Stop
  Tracking, Clean View). In library: nothing but the badge.

### Library screen
- Responsive grid of square tiles (thumbnail, name under it).
- Add Avatar tile (dashed, "+") opens the Import popup.
- Tile context actions (rename, delete) via a small per-tile menu or
  right-side controls. Minimal — no clutter.

### Workspace screen
- Full-bleed centered 3D canvas (reuse `.preview-frame` / `#mii-viewer`).
- A control rail (left side, proposed) listing group **titles** only:
  Scene, Camera, Microphone, Output, Advanced tuning & debug.
- Clicking a title expands that group into a floating panel over the scene
  (one open at a time, or accordion). Collapsed = title only, per the request.
- Camera preview remains available (small, dockable).

### Popups / overlays
- A single reusable modal/overlay primitive: scrim + panel, `position: fixed`,
  high z-index, ESC/backdrop to close. The WebGL canvas keeps rendering under
  the scrim (scrim is semi-transparent).
- Used by: Import, Rename, Delete-confirm, and the expandable control panels
  (control panels may be non-scrim popovers so the avatar stays fully visible).

## Persistence Design

**Chosen approach (Phase 5): `localStorage` library store.** It matches the
existing `cleanOutputAvatar` pattern, needs no Rust changes, and the data is
tiny (avatar payloads are 46–108 bytes each).

- Key: `miituber.library.v1`.
- Shape: `LibraryAvatar[]` where
  `LibraryAvatar = { id: string; name: string; bytes: number[];
  thumbnailDataUrl: string | null; createdAt: number }`.
- `id`: crypto-random (e.g., `crypto.randomUUID()`).
- Thumbnails stored as `data:image/png;base64,...` (a few KB each).
- On select, the chosen avatar also populates the existing
  `cleanOutputAvatar` store so OBS Clean View keeps working unchanged.

**Storage budget note:** localStorage is ~5 MB. Even with thumbnails this
supports dozens of avatars comfortably. If we ever outgrow it, migrate to a
Rust/disk store (see Alternatives).

### Alternative (future): Rust/disk store
- Persist a JSON manifest + raw byte files under the app data dir via Rust
  commands (`library_list`, `library_add`, `library_remove`, `library_rename`).
- More robust, larger capacity, real files. Deferred to keep Phase 5 scoped.

## Backend Touchpoints

- **No new Rust commands required** for the localStorage approach.
- Reuse `render_mii_png` for thumbnails and `render_mii_glb` for the GLB.
- Both are already cached by payload hash, so re-selecting an avatar is fast.
- (Optional, only if we pick the disk store) add the `library_*` commands above.

## Behavioral Details & Edge Cases

- **Renderer down at import:** save bytes, placeholder thumbnail, retry
  thumbnail generation on next successful renderer health check or on select.
- **Unsupported / 128-byte v4 file:** reject in the Import popup with the
  existing error copy; do not add to the library.
- **Delete avatar:** confirm; if it's the currently loaded one, return to
  library and stop tracking/lip-sync.
- **Empty library:** show only the Add Avatar tile with a short hint.
- **Back to Library:** stop tracking and lip-sync, keep the GLB cache warm.
- **Clean View open while going Back:** define behavior — proposed: keep the
  Clean View window but it shows the last avatar until a new one is selected.
- **Window size:** unchanged, fixed 1024×720.

## Implementation Phases

1. **Library data layer** — `src/lib/avatarLibrary.ts`: load/save/add/remove/
   rename against `localStorage`, with validation and unit tests (Vitest).
2. **Overlay/modal primitive** — reusable scrim+panel component and a popover
   variant; ensure the canvas keeps rendering underneath.
3. **Library start screen** — grid + Add Avatar tile + Import popup wired to the
   data layer and `render_mii_png` thumbnails.
4. **Workspace refactor** — center the avatar; convert the current group boxes
   into title-only collapsible overlay panels; add Back to Library.
5. **Wire select → render** — selecting a tile drives the existing
   `render_mii_glb` + `avatarScene.loadModelFromGlbBytes` path and seeds the
   clean-output avatar.
6. **Polish & tests** — keep one consistent font/flat aesthetic; `npm test`,
   `npm run build`, `cargo test` (no Rust change expected) all green.

## Open Decisions (need your call)

1. **Storage:** localStorage now (recommended) vs Rust/disk store now?
2. **Control rail placement:** left rail of titles (recommended) vs a bottom
   bar of titles vs a top menu? All keep the avatar centered.
3. **One panel open at a time (accordion)** vs allow multiple expanded?
4. **Control panels:** floating popovers with no scrim (avatar fully visible) vs
   dim scrim like other modals?
5. **Clean View on Back-to-Library:** keep window showing last avatar
   (recommended) vs auto-close?
6. **Per-tile actions:** hover menu vs always-visible small rename/delete.

## Acceptance Criteria

- Launching with saved avatars shows the grid; empty state shows Add Avatar.
- Importing a supported file adds a persistent, thumbnailed tile.
- Restarting the app preserves the library.
- Selecting a tile renders the centered Mii and enters the workspace.
- Control groups show titles only and expand over the live render.
- Opening any popup does not stop the avatar from rendering behind it.
- Tracking, lip-sync, and OBS Clean View behave as before once in the workspace.
- `npm test`, `npm run build`, and `cargo test` pass.
