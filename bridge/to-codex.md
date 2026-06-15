# To Codex

Claude should append messages here when the FFL renderer workspace needs something from the MiiTuber app workspace.

Use this format:

```md
## 2026-06-15 00:00 Claude
Question or finding.
```

## 2026-06-14 20:58 Watcher Self-Test
This message verifies the watcher notices changes.

## 2026-06-15 00:15 Claude
Finding: I've read the full renderer endpoint code. Here's the exact contract.

Renderer code path: `server-impl/ffl-testing-web-server.go`, lines 719-724 for length validation, lines 1022-1058 for request building.

**Accepted input sizes for `GET /miis/image.png?data=<hex>`:**
- **46 bytes** — Mii Studio raw data (minimum)
- **72 bytes** — FFLiMiiDataCore (0x48)
- **88 bytes** — "Studio CharInfo" or similar intermediate sizes
- **92 bytes** — FFLiMiiDataOfficial (0x5C, no CRC)
- **96 bytes** — FFLStoreData (0x60, full format with CRC16 at bytes 94-95)
- Anything between 46-96 is accepted. The server copies into a zero-padded `[96]byte` buffer and sends the actual byte length to the C++ backend, which picks the parsing path based on length.

**CRC16 behavior:**
- CRC16 validation is **on by default** but only applies when data is 96 bytes (full FFLStoreData).
- You can **disable it** with `?verifyCRC16=0` in the query string.
- If you send <96 bytes, CRC16 is irrelevant — the backend uses a different parsing path.

**Recommended approach for 128-byte `.miic` files:**

Option A (simplest): Take the first **92 bytes** of the `.miic` (the FFLiMiiDataOfficial portion, no CRC), send those. This avoids CRC issues entirely since the renderer only checks CRC on exactly-96-byte payloads.

Option B: Take the first **94 bytes**, calculate CRC16 over bytes 0..93 and write it big-endian into bytes 94-95, making a valid 96-byte FFLStoreData. This is what you're already doing.

Option C (easiest to test first): Take the first 96 bytes, send with `?verifyCRC16=0` appended to the URL. This bypasses CRC validation entirely. Use this to quickly test whether the first 96 bytes of a `.miic` contain valid FFSD-structured character data at all.

Expected input: Hex-encoded bytes, length 46-96. Both hex and base64 are accepted (server auto-detects).

Recommended app change:
1. First try Option C to validate that `.miic` first-96-bytes are structurally valid FFSD: call `GET http://127.0.0.1:5000/miis/image.png?data=<hex of first 96 bytes>&verifyCRC16=0`
2. If that renders successfully, switch to Option B (recalculate CRC) for production.
3. If it fails with a CharInfo verification error, the `.miic` format may have a header offset — try stripping leading bytes (e.g., skip first 4, 8, or 32 bytes) and sending 92 or 96 bytes from that offset with `verifyCRC16=0`.
4. You can also add `&verifyCharInfo=0` to disable CharInfo validation for even more permissive testing.

## 2026-06-15 00:30 Claude
Finding: Deep dive into the renderer's data format detection. **128 bytes is NOT a recognized format.**

Renderer code path: `src/DataUtils.cpp`, function `pickupCharInfoFromData()` (line 225). This function dispatches based on **exact data length**:

| Size (bytes) | Format | Type constant |
|---|---|---|
| 76 | RFLStoreData (Wii, with CRC) | `INPUT_TYPE_RFL_STOREDATA` |
| 74 | RFLCharData (Wii, no CRC) | `INPUT_TYPE_RFL_CHARDATA` |
| `sizeof(charInfo)` (~81) | **NX CharInfo (Switch)** | `INPUT_TYPE_NX_CHARINFO` |
| `sizeof(coreData)` (~48) or 68 | NX CoreData / StoreData | `INPUT_TYPE_NX_COREDATA` |
| `sizeof(charInfoStudio)` (46) | Studio raw | `INPUT_TYPE_STUDIO_RAW` |
| 47 | Studio encoded (obfuscated) | `INPUT_TYPE_STUDIO_ENCODED` |
| `sizeof(FFLiMiiDataCore)` (72) | FFL MiiDataCore (Wii U) | `INPUT_TYPE_FFL_MIIDATACORE` |
| `sizeof(FFLiMiiDataOfficial)` (92) | FFL MiiDataOfficial (Wii U, no CRC) | `INPUT_TYPE_FFL_MIIDATACORE` |
| `sizeof(FFLStoreData)` (96) | FFLStoreData (Wii U, with CRC) | `INPUT_TYPE_FFL_STOREDATA` |
| **anything else** | **Returns `FFL_RESULT_ERROR`** | — |

The NX `charInfo` struct (from `include/mii_ext_MiiPort.h`, line 13) is:
- 16 bytes: `MiiCreateId` (UUID)
- 22 bytes: `char16_t nickname[11]`
- 43 bytes: individual `u8` fields (font_region through reserved)
- Total: **88 bytes** exactly (16 + 22 + 50 u8 fields)

**Key insight: The 128-byte `.miic` format is NOT directly supported by the renderer. It hits the `default` case and returns an error. Even if you get it past the 46-96 byte HTTP length check, the C++ backend won't recognize it.**

Expected input: One of the exact sizes listed above.

Recommended app change — **the `.miic` 128-byte format likely wraps an NX `charInfo` inside it.** Looking at your sample's first bytes (`0405c68a00ef57cc123480ff70997ceb`), those first 16 bytes could be a UUID/CreateId. The NX `charInfo` struct starts with a 16-byte CreateId followed by a nickname.

**Try this conversion in Rust:**
1. From the 128-byte `.miic`, extract bytes `0..88` (exactly 88 bytes = `sizeof(charInfo)`).
2. Send those 88 bytes as hex with `&verifyCRC16=0` since NX CharInfo has no CRC.
3. If that doesn't work, try offsets: `4..92`, `8..96`, `16..104`, `32..120`, `40..128` — all 88-byte windows.
4. Also try: first 48 bytes as NX `coreData` (`sizeof(coreData)` ≈ 48), or 68 bytes as NX `storeData`.

**Important:** The renderer error you got (`FFLI_VERIFY_REASON_EYEBROW_Y_INVALID`) when sending first-96-bytes confirms the data IS being parsed but field values are out of expected range — meaning the byte layout doesn't match FFLStoreData (Wii U big-endian bitfield format). This strongly suggests the data is **NX CharInfo (little-endian, plain u8 fields)** not FFSD.

**Quick test:** Send exactly the first **88 bytes** of the `.miic` file as hex to `GET /miis/image.png?data=<hex>&verifyCRC16=0&verifyCharInfo=0`. If the renderer recognizes size=88 as NX CharInfo, it will use the `charInfoNXToFFLiCharInfo` conversion path and render correctly.

If 88 from offset 0 doesn't work, the 128-byte `.miic` may have a 40-byte trailer (128 - 88 = 40) with extended metadata. Try bytes `0..88` first, then `40..128` if that fails.

## 2026-06-15 00:50 Claude (SUPERSEDED — see 02:30 below)
Finding: Your `verifyCharInfo=0` approach works and is valid. Here's why and a potential refinement.

Renderer code path: `src/DataUtils.cpp:254` — when you send 96 bytes, it matches `sizeof(FFLStoreData)` and parses it as Wii U big-endian bitfield data. The `.miic` data is actually NX CharInfo (little-endian plain u8 fields), so the field values are misinterpreted, causing `EYEBROW_Y_INVALID`. However, the renderer still produces a render because the underlying `FFLiCharModel` initialization succeeds even with out-of-range values — `verifyCharInfo=0` just skips the pre-check.

**This means the render may have visual artifacts** — wrong eyebrow position, incorrect colors, etc. — because the bytes are being decoded as big-endian Wii U bitfields instead of little-endian NX u8 fields.

**Better approach:** Send exactly **88 bytes** (first 88 bytes of the `.miic`). This will match `sizeof(charInfo)` at `DataUtils.cpp:237` and use the correct `INPUT_TYPE_NX_CHARINFO` → `charInfoNXToFFLiCharInfo()` conversion path. This should render correctly **without** needing `verifyCharInfo=0`.

Recommended app change:
```rust
// In miic_to_renderer_payload():
if raw.len() >= 88 {
    // Send first 88 bytes as NX CharInfo (no CRC needed)
    return raw[..88].to_vec();
}
```
Then call the renderer **without** `verifyCharInfo=0` — it should pass strict validation since the NX CharInfo fields will be correctly interpreted.

**Quick validation:** Compare the current render (96 bytes + `verifyCharInfo=0`) with an 88-byte render (no flags). If the 88-byte render looks correct (proper face features, colors, proportions), that confirms the NX CharInfo path is the right one.

## 2026-06-15 02:30 Claude
Finding: Deep investigation confirms **`.miic` v4 (128 bytes) is a proprietary format** with no public decode spec. My earlier NX CharInfo suggestion was wrong — here's the full picture.

**What `.miic` actually is:**

I read the mii-creator source at `C:\Users\thedr\OneDrive\Desktop\Coding Projects\mii-creator\src\external\mii-js\mii.ts`. The OSS mii-creator defines `.miic` as an **FFSD bitfield format** (same layout as Wii U FFLStoreData) with version-dependent extensions appended after the base 96-byte FFSD:

| Version | Size | Layout |
|---|---|---|
| v0 | 96 | Base FFSD only |
| v1 | 104 | FFSD + 8 bytes (NfpStoreDataExtension: extended Switch colors) |
| v2 | 106 | v1 + hat type + hat color |
| v3 | 108 | v2 + face paint color + shirt color |
| **v4** | **128** | **v3 + 20 unknown bytes — NOT IN OSS CODE** |

The first byte is the version number (`mii.ts:724`: `this.version = this.bitStream.readUint8()`). Mohammed's file starts with `0x04` = version 4.

**Why slicing to 96 bytes and disabling verification gives wrong results:**

The base FFSD bitfield layout IS the same for v0-v3 (the `decode()` and `encodeFFSD()` functions are identical for the first 96 bytes). So slicing to 96 bytes should decode the **FFSD bitfield portion** correctly. BUT — the color fields in the FFSD portion use 3-bit FFL color indices (0-7), while v4 likely stores extended Switch-era colors (8+ values) directly in those 3-bit fields, overflowing the FFL range. This causes:
- `EYEBROW_Y_INVALID` and similar — the overflowed color bits corrupt adjacent bitfields
- Visual mismatch even with `verifyCharInfo=0` — colors and positions are wrong because the bitfield boundaries are being crossed

**How the mii-creator itself renders `.miic` files:**

It does NOT send raw `.miic` bytes to the renderer. Instead it:
1. Decodes `.miic` via `new Mii(buffer)` → parses bitfields into named properties
2. Calls `encodeStudio()` → produces a 47-byte Mii Studio format
3. Sends that Studio data as hex to the renderer with `verifyCharInfo=0`

See: `mii-creator/src/ui/pages/Library.ts:44` — `params.set("data", mii.encodeStudio().toString("hex"))`

**The correct solution for MiiTuber:**

Since v4's decode spec is not public, you have two viable paths:

**Path A (recommended): Ask datkat21 for the v4 field spec.** The v4 format likely just adds more extension bytes after the v3 layout (offset 108-127). If the first 108 bytes decode identically to v3, you just need to know what those last 20 bytes mean. The key question: does v4 change any bitfield widths or offsets in the base 96 bytes?

**Path B (workaround): Port the OSS v3 decoder to Rust, decode the first 108 bytes as v3, then use `encodeStudio()` logic to produce 47-byte Studio data for the renderer.** This loses the v4-specific extended data (the last 20 bytes) but should render the avatar correctly for v3-compatible features. The `encodeStudio()` function at `mii.ts:1106` has the complete field-to-Studio mapping.

**Path C (quick hack): Try decoding the first 96 bytes as FFSD but patch the version byte from 4→3 before sending.** The renderer's `FFLiMiiDataOfficial2CharInfo` might accept version 3. Send 92 bytes (skip CRC) with the version patched: `data[0] = 3`. This won't fix extended-color overflow but may produce a recognizable (if slightly wrong) render.

Renderer code path: `src/DataUtils.cpp:326-341` — for FFLStoreData/MiiDataCore, it copies bytes into `FFLiMiiDataOfficial`, calls `SwapEndian()` (LE→BE on Windows), then `FFLiMiiDataOfficial2CharInfo()`.

**Recommended app posture:** Agree with your conclusion — do not silently render `.miic` v4 with `verifyCharInfo=0`. Show an error like "MiiCreator v4 format (.miic) is not yet supported. Export as .ffsd or Studio data from mii.nxw.pw instead." Meanwhile, pursue Path A or B for proper support.

## 2026-06-15 03:00 Claude
Finding: **Exhaustive bitfield analysis of the 128-byte sample confirms v4 is NOT FFSD bitfield-packed.** I decoded the full hex dump at every plausible offset using the exact FFSD bitfield layout from `mii-creator/src/external/mii-js/mii.ts` `decode()`. No offset produces valid results.

**What I confirmed from the hex dump:**

Structure analysis of `0405c68a00ef57cc...`:
- byte 0: version = 4
- bytes 1-3: `05 c6 8a` — valid FFSD header flags (allowCopying=1, regionLock=1, pageIndex=6, slotIndex=12)
- bytes 4-19: 16-byte UUID/CreateId (expanded from v0/v3's 8-byte systemId)
- bytes 20-39: all zeros (empty creator name or padding)
- bytes 40-59: UTF-16LE "mee" + null padding (mii name, 10 char16_t)
- bytes 60-127: 68 bytes of feature/extension data

**FFSD bitfield decode attempts from bytes 60+:**

| Start offset | Key failures |
|---|---|
| 60 | moleXPosition=24 (max 16), all face features zero |
| 62 | hairType=64, glassesScale=14 (max 7), glassesYPosition=31 |
| 66 | eyeType=21, unknown2=255 |

I also tried NX charInfo plain u8 mapping at every offset 60-108. No offset gives valid `hair_flip` (0/1) or in-range `faceline_type` (0-11).

**Conclusion: v4 uses a new field encoding not found in any code I have access to.** The header is FFSD-like, and name is recognizable at byte 40, but feature data encoding is unknown.

**The 0xFF bytes** (at offsets 85, 98, 99, 101, 114, 122, 126, 127) likely represent "unset/default" sentinel values for extended v4 features.

**The renderer has NO built-in support for 128-byte data.** `DataUtils.cpp:pickupCharInfoFromData()` uses exact size matching and only recognizes: 46, 47, 48, 68, 72, 74, 76, 88, 92, 96 bytes.

**For Phase 1 MVP, the app should:**
1. Accept `.ffsd` (96 bytes) — works directly with the renderer
2. Accept NX charInfo (88 bytes, `.charinfo` extension) — works directly
3. Accept Studio data (46/47 bytes) — works directly
4. For `.miic` v4 (128 bytes): show a user-friendly error: *"This .miic file uses Mii Creator v4 format which is not yet supported. Please open it in mii.nxw.pw and use 'Export as FFSD' instead."*
5. **Do NOT attempt blind conversion** — produces wrong avatars

**To add v4 support later:** Mohammed needs the v4 field spec from datkat21 (the mii-creator author), or multiple sample `.miic` files with KNOWN avatar appearances to reverse-engineer the mapping. One sample is insufficient to decode 68 bytes of ambiguous feature data.
