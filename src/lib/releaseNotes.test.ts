import { describe, expect, it } from "vitest";
import {
  hasLegacyInstallData,
  releaseNotesForVersion,
  shouldShowReleaseNotes,
} from "./releaseNotes";

describe("release notes", () => {
  it("finds bundled notes by exact installed version", () => {
    expect(releaseNotesForVersion("0.2.0")?.title).toContain("0.2.0");
    expect(releaseNotesForVersion("0.2.1")?.title).toContain("0.2.1");
    expect(releaseNotesForVersion("9.9.9")).toBeNull();
  });

  it("shows known notes once after an installed-version change", () => {
    expect(shouldShowReleaseNotes("0.2.1", "0.2.0", null)).toBe(true);
    expect(shouldShowReleaseNotes("0.2.1", "0.2.0", "0.2.1")).toBe(false);
  });

  it("does not show notes on a fresh install or ordinary launch", () => {
    expect(shouldShowReleaseNotes("0.2.0", null, null)).toBe(false);
    expect(shouldShowReleaseNotes("0.2.0", "0.2.0", null)).toBe(false);
  });

  it("shows notes on the first version-aware launch of a legacy install", () => {
    expect(shouldShowReleaseNotes("0.2.0", null, null, true)).toBe(true);
    expect(shouldShowReleaseNotes("0.2.0", null, "0.2.0", true)).toBe(false);
  });

  it("does not show a blank modal for versions without notes", () => {
    expect(shouldShowReleaseNotes("9.9.9", "9.9.8", null)).toBe(false);
  });

  it("detects existing legacy data without treating empty storage as an upgrade", () => {
    const values = new Map<string, string>([["miituber.library.v1", "[]"]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    expect(hasLegacyInstallData(storage, ["miituber.library.v1"])).toBe(true);
    expect(hasLegacyInstallData(storage, ["miituber.onboardingTour.v1"])).toBe(false);
  });
});
