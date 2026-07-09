import { describe, expect, it } from "vitest";
import { normalizeMiiBytes, UnsupportedMiiFormatError } from "./miiData";

function bytesOf(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index % 256);
}

describe("normalizeMiiBytes", () => {
  it.each([46, 47, 74, 76, 96])(
    "passes FFL-native %i-byte data through unchanged",
    (length) => {
      const bytes = bytesOf(length);
      expect(normalizeMiiBytes(bytes)).toBe(bytes);
    },
  );

  it.each([104, 106, 108])(
    "truncates a legacy %i-byte .miic to its 96-byte FFLStoreData prefix",
    (length) => {
      const bytes = bytesOf(length);
      const normalized = normalizeMiiBytes(bytes);

      expect(normalized.length).toBe(96);
      expect(Array.from(normalized)).toEqual(Array.from(bytes.subarray(0, 96)));
    },
  );

  it("rejects the 128-byte modern .miic with a user-facing error", () => {
    expect(() => normalizeMiiBytes(bytesOf(128))).toThrow(
      UnsupportedMiiFormatError,
    );
    expect(() => normalizeMiiBytes(bytesOf(128))).toThrow(/\.ffsd/);
  });

  it("leaves unknown sizes alone so FFL.js can report its own error", () => {
    expect(normalizeMiiBytes(bytesOf(88)).length).toBe(88);
    expect(normalizeMiiBytes(bytesOf(288)).length).toBe(288);
  });
});
