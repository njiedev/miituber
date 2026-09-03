export type ReleaseNotes = {
  version: string;
  title: string;
  items: readonly string[];
  footer?: string;
  imageUrl: string;
};

/**
 * Add one JSON file under release-notes/ when preparing each release. Vite
 * bundles every version for the in-app modal, while the release workflow reads
 * the current version's same file for the GitHub release body.
 *
 * Replace public/update-modal-mii.png with the desired bundled PNG before a
 * release. This path is intentionally independent from saved avatar data.
 */
const releaseNoteModules = import.meta.glob<{ default: ReleaseNotes }>(
  "../../release-notes/*.json",
  { eager: true },
);

export const RELEASE_NOTES: Readonly<Record<string, ReleaseNotes>> =
  Object.fromEntries(
    Object.values(releaseNoteModules).map(({ default: notes }) => [
      notes.version,
      notes,
    ]),
  );

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
