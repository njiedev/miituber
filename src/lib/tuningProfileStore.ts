import { appDataDir, join } from "@tauri-apps/api/path";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";

const TUNING_PROFILE_STORAGE_KEY = "miituber.tuningProfile.v1";
const TUNING_PROFILE_FILE_NAME = "miituber-tuning-profile.json";
const TUNING_SAVE_DEBOUNCE_MS = 400;
const JSON_FILTERS = [{ name: "JSON profile", extensions: ["json"] }];

export class TuningProfileStore {
  readonly isTauri: boolean;
  private appDataPath: string | null = null;
  private saveTimer: number | null = null;
  private writeQueue = Promise.resolve();

  constructor(isTauri: boolean) {
    this.isTauri = isTauri;
  }

  async open() {
    if (!this.isTauri) return;
    this.appDataPath = await join(await appDataDir(), TUNING_PROFILE_FILE_NAME);
  }

  async readWorkingCopy(): Promise<string | null> {
    if (!this.isTauri) return localStorage.getItem(TUNING_PROFILE_STORAGE_KEY);
    if (!this.appDataPath) return null;

    try {
      return new TextDecoder().decode(await readFile(this.appDataPath));
    } catch (error) {
      // A missing file is the normal first-run case; defaults remain active.
      console.info("[MiiTuber] no saved app-data tuning profile found", { error });
      return null;
    }
  }

  scheduleSave(getJson: () => string, onError: (error: unknown) => void) {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      const json = getJson();
      this.writeQueue = this.writeQueue
        .then(() => this.writeWorkingCopy(json))
        .catch(onError);
    }, TUNING_SAVE_DEBOUNCE_MS);
  }

  async saveCopy(json: string): Promise<boolean> {
    if (!this.isTauri) {
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = TUNING_PROFILE_FILE_NAME;
      link.click();
      URL.revokeObjectURL(url);
      return true;
    }

    const path = await saveDialog({
      title: "Save tuning profile",
      defaultPath: TUNING_PROFILE_FILE_NAME,
      filters: JSON_FILTERS,
    });
    if (!path) return false;
    await writeFile(path, new TextEncoder().encode(json));
    return true;
  }

  async importCopy(): Promise<string | null> {
    if (!this.isTauri) {
      const file = await chooseBrowserJsonFile();
      return file ? file.text() : null;
    }

    const selected = await openDialog({
      title: "Import tuning profile",
      multiple: false,
      directory: false,
      filters: JSON_FILTERS,
    });
    if (typeof selected !== "string") return null;
    return new TextDecoder().decode(await readFile(selected));
  }

  private async writeWorkingCopy(json: string) {
    if (!this.isTauri) {
      localStorage.setItem(TUNING_PROFILE_STORAGE_KEY, json);
      return;
    }

    const appDataPath = await appDataDir();
    await mkdir(appDataPath, { recursive: true });
    this.appDataPath ??= await join(appDataPath, TUNING_PROFILE_FILE_NAME);
    await writeFile(this.appDataPath, new TextEncoder().encode(json));
  }
}

function chooseBrowserJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), {
      once: true,
    });
    input.click();
  });
}
