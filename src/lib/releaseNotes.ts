export type ReleaseNotes = {
  version: string;
  title: string;
  items: readonly string[];
  footer?: string;
  imageUrl: string;
};

/**
 * Add one entry when preparing each release. Keep the reusable modal code in
 * main.ts unchanged; release-specific words and art belong here.
 *
 * Replace public/update-modal-mii.png with the desired bundled PNG before a
 * release. This path is intentionally independent from saved avatar data.
 */
export const RELEASE_NOTES: Readonly<Record<string, ReleaseNotes>> = {
  "0.1.3": {
    version: "0.1.3",
    title: "What’s New in MiiTuber 0.1.3",
    items: [
      "Added microphone-only animation for camera-free PNGTuber use.",
      "Added separate camera and microphone mouth activation controls.",
      "Added/Fixed native Save JSON and Import JSON controls for tuning profiles.",
      "Fixed a bug where microphone lip-sync would not move the Mii without the camera running.",
      "Fixed a bug where losing face detection could stop microphone mouth movement.",
      "Fixed a bug where selecting a Mii could play a brief dialogue sound with no dialogue visible.",
      "Fixed a bug where starting microphone or camera tracking could play a brief dialogue sound.",
    ],
    footer: `Thanks for 200 downloads! — 3wb <3\n\nNOTE: Mii Creator's new update brings features thatwill most likely not be compatible with MiiTuber. Avoid using custom Mii Creator features on miis while I work on a fix.`,
    imageUrl: "/update-modal-mii.png",
  },
};

export function releaseNotesForVersion(version: string): ReleaseNotes | null {
  return RELEASE_NOTES[version] ?? null;
}

export function shouldShowReleaseNotes(
  installedVersion: string,
  previousVersion: string | null,
  lastSeenVersion: string | null,
  legacyInstallDetected = false,
): boolean {
  const upgraded =
    previousVersion === null
      ? legacyInstallDetected
      : previousVersion !== installedVersion;
  return (
    upgraded &&
    lastSeenVersion !== installedVersion &&
    releaseNotesForVersion(installedVersion) !== null
  );
}

export function hasLegacyInstallData(
  storage: Pick<Storage, "getItem">,
  keys: readonly string[],
): boolean {
  return keys.some((key) => storage.getItem(key) !== null);
}
