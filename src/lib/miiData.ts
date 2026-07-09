/**
 * Mii data format normalization.
 *
 * FFL.js accepts these byte lengths natively:
 *   96      FFLStoreData (.ffsd/.cfsd — 3DS/Wii U)
 *   74/76   RFLCharData/RFLStoreData (Wii)
 *   46/47   Mii Studio data (raw / URL-obfuscated)
 *
 * .miic (Mii Creator, mii.nxw.pw) comes in two generations:
 *   104/106/108  old OSS builds — Ver3StoreData + NfpStoreDataExtention.
 *                The first 96 bytes are a valid FFLStoreData (extended colors
 *                are down-mapped into the base struct), so truncation works.
 *   128          current exports — a different, undocumented layout (name at
 *                0x28, unpacked one-byte fields; NOT FFLStoreData-prefixed).
 *                No public spec or encoder exists, so these are rejected with
 *                a friendly error instead of FFL's CRC failure.
 *                See docs/research/mii-formats.md.
 */

/** Sizes FFL.js parses without help. */
const FFL_NATIVE_SIZES = new Set([46, 47, 74, 76, 96]);

const FFL_STORE_DATA_SIZE = 96;

/** Old OSS Mii Creator exports: Ver3StoreData + NfpStoreDataExtention. */
const MIIC_LEGACY_SIZES = new Set([104, 106, 108]);

/** Current (closed-source) Mii Creator export size. */
const MIIC_MODERN_SIZE = 128;

/** Thrown for recognized-but-unsupported formats; message is user-facing. */
export class UnsupportedMiiFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMiiFormatError";
  }
}

/**
 * Convert imported Mii bytes into a form FFL.js can consume. Legacy .miic
 * payloads are truncated to their valid FFLStoreData prefix (losing only the
 * extended cosmetics FFL cannot represent anyway). Bytes FFL already
 * understands — and unknown sizes, so FFL can raise its own error — pass
 * through untouched.
 */
export function normalizeMiiBytes(bytes: Uint8Array): Uint8Array {
  if (FFL_NATIVE_SIZES.has(bytes.length)) return bytes;

  if (MIIC_LEGACY_SIZES.has(bytes.length)) {
    return bytes.slice(0, FFL_STORE_DATA_SIZE);
  }

  if (bytes.length === MIIC_MODERN_SIZE) {
    throw new UnsupportedMiiFormatError(
      "This is a current-generation Mii Creator (.miic) export, which uses an " +
        "undocumented layout MiiTuber can't read yet. In Mii Creator, export " +
        "the Mii as an FFSD (.ffsd) file instead.",
    );
  }

  return bytes;
}
