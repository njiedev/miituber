import { describe, expect, it } from "vitest";
import {
  appErrorDetails,
  friendlyErrorMessage,
  mediaErrorCode,
  type AppErrorCode,
} from "./appDiagnostics";

const ALL_CODES: AppErrorCode[] = [
  "CAMERA_PERMISSION_DENIED", "CAMERA_NOT_FOUND", "CAMERA_IN_USE",
  "CAMERA_UNSUPPORTED_SETTINGS", "CAMERA_FAILED",
  "MICROPHONE_PERMISSION_DENIED", "MICROPHONE_NOT_FOUND", "MICROPHONE_IN_USE",
  "MICROPHONE_FAILED", "AVATAR_FILE_INVALID", "AVATAR_SAVE_FAILED",
  "AVATAR_RENDER_FAILED", "CLEAN_VIEW_FAILED", "TUNING_IMPORT_INVALID",
  "TUNING_SAVE_FAILED", "UPDATE_FAILED", "UNEXPECTED_ERROR",
];

describe("application errors", () => {
  it.each(ALL_CODES)("maps %s to safe user-facing copy", (code) => {
    const details = appErrorDetails(code);
    expect(details.title).not.toMatch(/Error:|TypeError|undefined/i);
    expect(details.message.length).toBeGreaterThan(20);
    expect(friendlyErrorMessage(code)).toBe(`${details.title}. ${details.message}`);
  });

  it("classifies expected camera and microphone failures", () => {
    expect(mediaErrorCode("camera", new DOMException("busy", "NotReadableError")))
      .toBe("CAMERA_IN_USE");
    expect(mediaErrorCode("microphone", new DOMException("no", "NotFoundError")))
      .toBe("MICROPHONE_NOT_FOUND");
    expect(mediaErrorCode("camera", new Error("unknown"))).toBe("CAMERA_FAILED");
  });
});
