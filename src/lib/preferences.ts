export const IDLE_SWAY_STORAGE_KEY = "miituber.idleSway.v1";
export const UPPER_BODY_INTENSITY_STORAGE_KEY = "miituber.upperBodyIntensity.v1";
export const UPPER_BODY_FOLLOW_STORAGE_KEY = "miituber.upperBodyFollow.v1";
export const BODY_VISIBLE_STORAGE_KEY = "miituber.bodyVisible.v1";
export const BLINK_MODE_STORAGE_KEY = "miituber.blinkMode.v1";
export const AUTO_BLINK_OPTIONS_STORAGE_KEY = "miituber.autoBlinkOptions.v1";
export const MIRROR_TRACKING_STORAGE_KEY = "miituber.mirrorTracking.v1";
export const SHOW_DEBUG_INFO_STORAGE_KEY = "miituber.showDebugInfo.v1";
export const SHADING_STYLE_STORAGE_KEY = "miituber.shadingStyle.v1";
export const TRACKING_SOURCE_STORAGE_KEY = "miituber.trackingSource.v1";

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

export function readJsonPreference(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch (error) {
    console.warn("[MiiTuber] could not read preference", { key, error });
    return null;
  }
}

export function writeJsonPreference(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("[MiiTuber] could not save preference", { key, value, error });
  }
}
