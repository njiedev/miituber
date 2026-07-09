import { describe, expect, it } from "vitest";
import { miiCameraErrorLine, miiMicrophoneErrorLine } from "./errorSpeaker";

function namedError(name: string): unknown {
  return { name };
}

describe("Mii error lines", () => {
  it("distinguishes camera-in-use failures", () => {
    expect(miiCameraErrorLine(namedError("NotReadableError"))).toMatchObject({
      emotion: "surprised",
      text: expect.stringContaining("Another app is using your camera"),
    });
  });

  it("distinguishes camera permission failures", () => {
    expect(miiCameraErrorLine(namedError("NotAllowedError"))).toMatchObject({
      emotion: "sad",
      text: expect.stringContaining("enable camera access"),
    });
  });

  it("distinguishes microphone start failures", () => {
    expect(miiMicrophoneErrorLine(namedError("NotReadableError"))).toMatchObject({
      emotion: "surprised",
      text: expect.stringContaining("microphone"),
    });
  });
});
