# PRD: MiiTuber Phase 1 Renderer Bridge

## Audience

This document is for the Claude Code instance working in the FFL renderer-server workspace.

## Product Summary

MiiTuber is a desktop VTuber-style app that renders user-provided Wii-style avatar data instead of anime Live2D/VRM models. The MVP is import-only: users bring existing avatar data files, the app renders them locally, and later phases will add webcam-driven head motion, expressions, and virtual camera output.

The app shell is Tauri:

- Frontend: TypeScript webview
- Backend: Rust Tauri commands
- Renderer: local Go FFL renderer server on `127.0.0.1:5000`

No cloud rendering. No Nintendo branding in UI copy. No creator UI in the app.

## Current Phase

Phase 1: import + static render.

Goal: user selects a local avatar data file, the Tauri app renders a PNG through the local FFL server, and the frontend displays that PNG.

Out of scope for this phase:

- webcam tracking
- MediaPipe
- expression mapping
- virtual camera
- avatar creator UI
- QR import
- NNID/PNID lookup
- full Three.js scene integration

## Current App Flow

The MiiTuber app currently does this:

```text
User file
  -> frontend reads raw bytes
  -> Tauri command render_mii_png(mii_bytes)
  -> Rust normalizes/validates
  -> Rust hex-encodes
  -> GET http://127.0.0.1:5000/miis/image.png?data=<hex>
  -> Rust verifies PNG signature
  -> frontend displays returned PNG
```

The Rust command intentionally acts as the trust boundary. The frontend should not call renderer URLs directly.

## Renderer Contract Observed So Far

Known working direct request:

```text
GET http://127.0.0.1:5000/miis/image.png?data=<hex of mee.ffsd>
```

Observed successful response:

```text
HTTP 200
Content-Type: image/png
~45 KB PNG
```

Observed renderer errors:

```text
HTTP 400 Bad Request
data length should be between 46-96 bytes
```

This happened when the app sent a raw `128` byte `.miic` sample.

After truncating `.miic` to `96` bytes:

```text
HTTP 500 Internal Server Error
renderer returned ERROR: Data CRC16 verification failed.
```

Codex then added FFSD CRC16 recalculation over bytes `0..94` and writes the big-endian checksum into bytes `94..96`.

## File Formats In Play

Renderer-compatible payloads:

- FFSD: 96 bytes
- Studio CharInfo: observed/expected 88 bytes in the app notes
- Mii Studio render data: renderer error implies it may accept smaller payloads down to 46 bytes

Problem source format:

- `.miic`: datkat21 MiiCreator extended FFSD format.
- Old OSS `datkat21/mii-creator` references `.miic` sizes `104`, `106`, and `108`.
- Mohammed has samples that are `128` bytes, likely newer closed-source MiiCreator data or a related extension.
- `.miic` can contain Switch-era colors/glasses/extensions that may be lossy when converted back to FFSD.

## What Codex Needs From Claude

Please investigate from the FFL renderer side:

1. Confirm the exact accepted formats for `/miis/image.png?data=<hex>`.
2. Confirm whether the route accepts:
   - 96-byte FFSD
   - 88-byte Studio CharInfo
   - 46/47-byte Mii Studio data
   - anything else
3. Identify whether a 128-byte `.miic` can be converted to renderer-compatible bytes by:
   - taking the first 96 bytes and recalculating CRC16
   - stripping a header/trailer before the 96-byte FFSD data
   - field-level conversion from extension data
   - using a different renderer endpoint/parameter
4. If possible, provide a minimal conversion rule with byte offsets.
5. If the renderer has a built-in conversion or validation utility, point Codex to the file/function and expected input/output.

## Desired Output From Claude

Append messages to `to-codex.md` using this format:

```md
## 2026-06-15 HH:MM Claude
Finding:

Renderer code path:

Expected input:

Recommended app change:
```

Concrete examples are especially useful:

- sample byte length
- first 16 bytes as hex
- exact endpoint URL
- exact renderer error
- relevant renderer file/function names
- pseudocode for conversion

## Current Codex-Side Implementation Notes

Current Rust files of interest:

- `src-tauri/src/lib.rs`
- `normalize_mii_data_for_renderer`
- `miic_to_ffsd_payload`
- `calculate_ffsd_crc16`
- `render_mii_png`

Current frontend files of interest:

- `src/main.ts`
- `index.html`
- `src/styles.css`

## Product Constraints

- Keep the MVP import-only.
- Do not add a creator UI.
- Do not depend on public hosted renderer services.
- Do not expose the renderer's lower-level private port publicly.
- Keep renderer calls local.
- Keep explanations concrete because this project is also Mohammed's learning vehicle.
