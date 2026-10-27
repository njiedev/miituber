export const BODY_VISIBLE_STORAGE_KEY = "miituber.bodyVisible.v1";
export const AUTO_BLINK_STORAGE_KEY = "miituber.autoBlink.v1";
export const MIRROR_TRACKING_STORAGE_KEY = "miituber.mirrorTracking.v1";
export const SHOW_DEBUG_INFO_STORAGE_KEY = "miituber.showDebugInfo.v1";
export const SHADING_STYLE_STORAGE_KEY = "miituber.shadingStyle.v1";

export function readBooleanPreference(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;

    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "boolean" ? parsed : fallback;
  } catch (error) {
    console.warn("[MiiTuber] could not read preference", { key, error });
    return fallback;
  }
}

export function writeBooleanPreference(key: string, value: boolean) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("[MiiTuber] could not save preference", { key, value, error });
  }
}

export function readStringPreference(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch (error) {
    console.warn("[MiiTuber] could not read preference", { key, error });
    return null;
  }
}

export function writeStringPreference(key: string, value: string) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("[MiiTuber] could not save preference", { key, value, error });
  }
}
