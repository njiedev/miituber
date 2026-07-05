# Design

The MiiTuber UI is a **fixed-size, WinRAR-style desktop utility shell** — a compact app bar over a content area, with tuning/debug controls tucked into popovers and draggable panels. It should read as a creator/streaming utility, not a marketing site.

Design tokens live in `:root` at the top of `src/styles.css`. Keep this doc in sync with that file.

## Typography

- **Font family:** `"Segoe UI", system-ui, -apple-system, sans-serif` (token `--font`)
- **Base size:** `14px` on `:root`
- **App name:** `1rem`, weight `600`, letter-spacing `0.01em`
- **Avatar name / secondary:** `0.85rem`, color `--text-soft`
- Rendering: `font-synthesis: none`, `optimizeLegibility`, antialiased smoothing

## Color tokens (hex)

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#eceef0` | App background |
| `--panel` | `#ffffff` | Panel / card surfaces |
| `--toolbar` | `#fbfbfc` | App bar / toolbar surface |
| `--border` | `#d4d7dc` | Default borders |
| `--border-strong` | `#c2c7ce` | Emphasized borders |
| `--text` | `#20242a` | Primary text |
| `--text-soft` | `#687078` | Secondary / muted text |
| `--accent` | `#2f6fb0` | Accent / interactive |
| `--error` | `#b42318` | Error status |
| `--success` | `#1d7a44` | Success status |
| `--avatar-background` | `#e8f0f7` | Default avatar preview background |

## Elevation

- `--shadow: 0 8px 24px rgba(20, 28, 38, 0.18)` for popovers / floating panels

## Layout structure

- `.app-shell` — full-height flex column
- `.appbar` — top bar: `.appbar-left` (identity/status) + `.appbar-right` (pushed right via `margin-left: auto`)
- Content area hosts the avatar preview as the visual center
- Advanced tuning/debug controls live inside collapsible popovers/panels, not inline

## Control hierarchy (priority order)

1. Avatar preview / output — the visual center
2. Core workflow — renderer status, import, render, start tracking, start lip-sync, open output
3. Scene controls — expression, background, transparency
4. Device controls — camera, tracking FPS, microphone, mouth source
5. Advanced tuning / debug — inside collapsible panels

## Onboarding tour

- The tour dialogue reuses the dark translucent, blurred style of `.isolate-hint`, with a bottom-centered card, 72px portrait frame, streaming text, and compact text actions.
- The spotlight uses a fixed overlay above modals (`z-index: 200`) with a box-shadow dimmer and a rounded cutout around the target. It introduces no new design tokens and respects reduced-motion by disabling the cutout transition.
- `.tour-root` is hidden in both clean-output and capture-isolate modes so OBS-facing output stays pure.

## Principles

- Make the default import → render → track → output workflow obvious.
- Keep advanced tuning accessible but never visually dominant.
- Use clear status messages for renderer, render, tracking, mic, and OBS output.
- Separate user-facing controls from debug readouts.
- Preserve camera/mic privacy messaging (local-first) to keep user trust.
- Design desktop-first; degrade gracefully at smaller window sizes.
- Status colors: use `--success` / `--error` tokens; never hardcode status hex values.
