import { getVersion } from "@tauri-apps/api/app";
import {
  check as checkForUpdate,
  type Update,
} from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { reportAppError } from "./appDiagnostics";
import { LIBRARY_STORAGE_KEY } from "./avatarLibrary";
import { BODY_VISIBLE_STORAGE_KEY, SHOW_DEBUG_INFO_STORAGE_KEY } from "./preferences";
import {
  hasLegacyInstallData,
  releaseNotesForVersion,
  shouldShowReleaseNotes,
} from "./releaseNotes";
import { TOUR_STORAGE_KEY } from "./tour";

const LAST_SEEN_RELEASE_NOTES_KEY = "miituber.lastSeenReleaseNotesVersion.v1";
const LAST_LAUNCHED_VERSION_KEY = "miituber.lastLaunchedVersion.v1";
const LEGACY_INSTALL_STORAGE_KEYS = [
  LIBRARY_STORAGE_KEY,
  TOUR_STORAGE_KEY,
  BODY_VISIBLE_STORAGE_KEY,
  SHOW_DEBUG_INFO_STORAGE_KEY,
] as const;

export interface UpdateExperienceDeps {
  isTauri: boolean;
  devPanelEnabled: boolean;
  onModalOpen: () => void;
  onIdle: () => void;
}

export interface UpdateExperience {
  start(): Promise<void>;
  isBlocking(): boolean;
}

export function createUpdateExperience(deps: UpdateExperienceDeps): UpdateExperience {
  const updateModal = document.querySelector<HTMLElement>("#update-modal");
  const updateCard = document.querySelector<HTMLElement>("#update-card");
  const updateModalImage =
    document.querySelector<HTMLImageElement>("#update-modal-image");
  const updateModalTitle =
    document.querySelector<HTMLElement>("#update-modal-title");
  const updateModalMessage =
    document.querySelector<HTMLElement>("#update-modal-message");
  const updateModalNotes =
    document.querySelector<HTMLUListElement>("#update-modal-notes");
  const updateModalFooterNote = document.querySelector<HTMLElement>(
    "#update-modal-footer-note",
  );
  const updateModalProgressWrap = document.querySelector<HTMLElement>(
    "#update-modal-progress-wrap",
  );
  const updateModalProgress =
    document.querySelector<HTMLProgressElement>("#update-modal-progress");
  const updateModalProgressLabel = document.querySelector<HTMLElement>(
    "#update-modal-progress-label",
  );
  const updateModalDetail =
    document.querySelector<HTMLElement>("#update-modal-detail");
  const updatePrimaryButton = document.querySelector<HTMLButtonElement>(
    "#update-primary-button",
  );
  const updateSecondaryButton = document.querySelector<HTMLButtonElement>(
    "#update-secondary-button",
  );
  const updateCloseButton = document.querySelector<HTMLButtonElement>(
    "#update-modal-close",
  );
  const updateDevPanel = document.querySelector<HTMLElement>("#update-dev-panel");
  let updateModalActive = false;
  let updateExperienceChecking = true;
  let updatePrimaryAction: (() => void) | null = null;
  let updateSecondaryAction: (() => void) | null = null;
  let updateCloseAction: (() => void) | null = null;

  async function initializeUpdateExperience() {
    wireUpdateModalControls();
    initializeUpdateDevControls();

    // Browsers cannot use Tauri's signed updater. The opt-in development panel
    // still works there, which makes every visual state easy to test with Vite.
    if (!deps.isTauri) {
      finishUpdateCheckWithoutModal();
      return;
    }

    let installedVersion: string;
    try {
      installedVersion = await getVersion();
    } catch (error) {
      reportAppError("UPDATE_FAILED", error, { action: "read installed version" });
      finishUpdateCheckWithoutModal();
      return;
    }
    const previousVersion = localStorage.getItem(LAST_LAUNCHED_VERSION_KEY);
    const legacyInstallDetected =
      previousVersion === null &&
      hasLegacyInstallData(localStorage, LEGACY_INSTALL_STORAGE_KEYS);
    localStorage.setItem(LAST_LAUNCHED_VERSION_KEY, installedVersion);

    try {
      const update = await checkForUpdate({ timeout: 10_000 });
      if (update) {
        updateExperienceChecking = false;
        showAvailableUpdate(update);
        return;
      }
    } catch (error) {
      // A background check failure should not interrupt startup. Download and
      // installation failures are shown inside the modal after the user opts in.
      reportAppError("UPDATE_FAILED", error, { action: "startup update check" });
    }

    updateExperienceChecking = false;
    showWhatsNewIfNeeded(installedVersion, previousVersion, legacyInstallDetected);
    if (!updateModalActive) deps.onIdle();
  }

  function finishUpdateCheckWithoutModal() {
    updateExperienceChecking = false;
    deps.onIdle();
  }

  function wireUpdateModalControls() {
    updatePrimaryButton?.addEventListener("click", () => updatePrimaryAction?.());
    updateSecondaryButton?.addEventListener("click", () => updateSecondaryAction?.());
    updateCloseButton?.addEventListener("click", () => updateCloseAction?.());
    updateModalImage?.addEventListener("error", () => {
      updateModalImage.hidden = true;
    });
  }

  function showAvailableUpdate(update: Update) {
    resetUpdateModal();
    setUpdateModalCopy(
      "A New Update is Available!",
      `MiiTuber ${update.version} is ready. Would you like to install it?`,
    );
    setUpdateModalButtons(
      "Update Now",
      () => void installAvailableUpdate(update),
      "Update Later",
      hideUpdateModal,
    );
    showUpdateModal();
  }

  async function installAvailableUpdate(update: Update) {
    let downloadedBytes = 0;
    let totalBytes: number | undefined;

    showDownloadingUpdate();
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          downloadedBytes = 0;
          totalBytes = event.data.contentLength;
          updateDownloadProgress(downloadedBytes, totalBytes);
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          updateDownloadProgress(downloadedBytes, totalBytes);
        } else if (event.event === "Finished") {
          showInstallingUpdate();
        }
      });
      showReadyToRestart(update.version);
    } catch (error) {
      reportAppError("UPDATE_FAILED", error, { action: "download and install" });
      showUpdateError(update, friendlyUpdateError(error));
    }
  }

  function showDownloadingUpdate(percent?: number) {
    resetUpdateModal();
    setUpdateModalCopy("Downloading Update", "You can keep this window open while MiiTuber gets ready.");
    if (updateModalProgressWrap) updateModalProgressWrap.hidden = false;
    if (updateModalProgressLabel) {
      updateModalProgressLabel.textContent =
        percent === undefined ? "Downloading…" : `Downloading… ${Math.round(percent)}%`;
    }
    if (updateModalProgress) {
      if (percent === undefined) updateModalProgress.removeAttribute("value");
      else updateModalProgress.value = percent;
    }
    setUpdateModalButtons(null, null, null, null);
    showUpdateModal();
  }

  function updateDownloadProgress(downloadedBytes: number, totalBytes?: number) {
    if (!updateModalProgress || !updateModalProgressLabel) return;
    if (!totalBytes || totalBytes <= 0) {
      updateModalProgress.removeAttribute("value");
      updateModalProgressLabel.textContent = "Downloading…";
      return;
    }

    const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
    updateModalProgress.value = percent;
    updateModalProgressLabel.textContent = `Downloading… ${percent}%`;
  }

  function showInstallingUpdate() {
    resetUpdateModal();
    setUpdateModalCopy("Installing Update", "Almost there. MiiTuber will be ready to restart shortly.");
    if (updateModalProgressWrap) updateModalProgressWrap.hidden = false;
    if (updateModalProgress) updateModalProgress.removeAttribute("value");
    if (updateModalProgressLabel) updateModalProgressLabel.textContent = "Installing…";
    setUpdateModalButtons(null, null, null, null);
    showUpdateModal();
  }

  function showReadyToRestart(version: string) {
    resetUpdateModal();
    setUpdateModalCopy("Update Ready", `MiiTuber ${version} is installed and ready to restart.`);
    setUpdateModalButtons(
      "Restart Now",
      () => void relaunch().catch((error) => {
        reportAppError("UPDATE_FAILED", error, { action: "relaunch" });
        if (updateModalDetail) {
          updateModalDetail.textContent = "MiiTuber could not restart automatically. Close and reopen the app to finish.";
          updateModalDetail.hidden = false;
        }
      }),
      "Restart Later",
      hideUpdateModal,
    );
    showUpdateModal();
  }

  function showUpdateError(update: Update | null, message: string) {
    resetUpdateModal();
    setUpdateModalCopy("Update Paused", "MiiTuber could not finish the update.");
    if (updateModalDetail) {
      updateModalDetail.textContent = message;
      updateModalDetail.hidden = false;
    }
    setUpdateModalButtons(
      update ? "Try Again" : null,
      update ? () => void installAvailableUpdate(update) : null,
      "Update Later",
      hideUpdateModal,
    );
    showUpdateModal();
  }

  function friendlyUpdateError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    if (/network|fetch|connect|offline|timed? ?out/i.test(text)) {
      return "Check your internet connection, then try again.";
    }
    if (/permission|denied|access/i.test(text)) {
      return "MiiTuber needs permission to replace the installed app. Try closing other MiiTuber windows first.";
    }
    return "Nothing was changed. You can try again now or update later.";
  }

  function showWhatsNewIfNeeded(
    installedVersion: string,
    previousVersion: string | null,
    legacyInstallDetected = false,
  ) {
    const lastSeenVersion = localStorage.getItem(LAST_SEEN_RELEASE_NOTES_KEY);
    if (!shouldShowReleaseNotes(
      installedVersion,
      previousVersion,
      lastSeenVersion,
      legacyInstallDetected,
    )) {
      return;
    }
    showWhatsNew(installedVersion, true);
  }

  function showWhatsNew(version: string, rememberOnDismiss: boolean) {
    const release = releaseNotesForVersion(version);
    if (!release) return;

    resetUpdateModal();
    if (updateCard) updateCard.dataset.kind = "whats-new";
    setUpdateModalImage(release.imageUrl);
    setUpdateModalCopy(release.title, "");
    if (updateModalMessage) updateModalMessage.hidden = true;
    if (updateModalNotes) {
      updateModalNotes.replaceChildren(
        ...release.items.map((item) => {
          const listItem = document.createElement("li");
          listItem.textContent = item;
          return listItem;
        }),
      );
      updateModalNotes.hidden = false;
    }
    if (updateModalFooterNote) {
      updateModalFooterNote.textContent = release.footer ?? "";
      updateModalFooterNote.hidden = !release.footer;
    }
    setUpdateModalButtons(null, null, null, null);
    updateCloseAction = () => {
      if (rememberOnDismiss) {
        localStorage.setItem(LAST_SEEN_RELEASE_NOTES_KEY, version);
      }
      hideUpdateModal();
    };
    if (updateCloseButton) updateCloseButton.hidden = false;
    showUpdateModal();
  }

  function setUpdateModalCopy(title: string, message: string) {
    if (updateModalTitle) updateModalTitle.textContent = title;
    if (updateModalMessage) updateModalMessage.textContent = message;
  }

  function setUpdateModalImage(imageUrl: string) {
    if (updateModalImage) {
      updateModalImage.hidden = false;
      updateModalImage.src = imageUrl;
    }
  }

  function hideUpdateModalImage() {
    if (updateModalImage) updateModalImage.hidden = true;
  }

  function setUpdateModalButtons(
    primaryLabel: string | null,
    primaryAction: (() => void) | null,
    secondaryLabel: string | null,
    secondaryAction: (() => void) | null,
  ) {
    updatePrimaryAction = primaryAction;
    updateSecondaryAction = secondaryAction;
    if (updatePrimaryButton) {
      updatePrimaryButton.hidden = primaryLabel === null;
      updatePrimaryButton.disabled = primaryAction === null;
      if (primaryLabel) updatePrimaryButton.textContent = primaryLabel;
    }
    if (updateSecondaryButton) {
      updateSecondaryButton.hidden = secondaryLabel === null;
      updateSecondaryButton.disabled = secondaryAction === null;
      if (secondaryLabel) updateSecondaryButton.textContent = secondaryLabel;
    }
  }

  function resetUpdateModal() {
    if (updateCard) updateCard.dataset.kind = "update";
    hideUpdateModalImage();
    updateCloseAction = null;
    if (updateCloseButton) updateCloseButton.hidden = true;
    if (updateModalMessage) updateModalMessage.hidden = false;
    if (updateModalNotes) {
      updateModalNotes.hidden = true;
      updateModalNotes.replaceChildren();
    }
    if (updateModalFooterNote) {
      updateModalFooterNote.hidden = true;
      updateModalFooterNote.textContent = "";
    }
    if (updateModalProgressWrap) updateModalProgressWrap.hidden = true;
    if (updateModalDetail) {
      updateModalDetail.hidden = true;
      updateModalDetail.textContent = "";
    }
    setUpdateModalButtons(null, null, null, null);
  }

  function showUpdateModal() {
    if (!updateModal) return;
    deps.onModalOpen();
    updateModalActive = true;
    updateModal.hidden = false;
    window.setTimeout(() => {
      const target = !updatePrimaryButton?.hidden
        ? updatePrimaryButton
        : updateSecondaryButton;
      target?.focus();
    }, 0);
  }

  function hideUpdateModal() {
    if (updateModal) updateModal.hidden = true;
    updateModalActive = false;
    updatePrimaryAction = null;
    updateSecondaryAction = null;
    updateCloseAction = null;
    deps.onIdle();
  }

  function initializeUpdateDevControls() {
    if (!deps.devPanelEnabled) {
      updateDevPanel?.remove();
      return;
    }
    if (updateDevPanel) updateDevPanel.hidden = false;
    updateDevPanel?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-update-test]",
      );
      const state = button?.dataset.updateTest;
      if (!state) return;
      if (state === "available") showTestAvailableUpdate();
      if (state === "downloading") showDownloadingUpdate(35);
      if (state === "installing") showInstallingUpdate();
      if (state === "ready") showReadyToRestart("0.2.2");
      if (state === "error") showUpdateError(null, "Test error: nothing was changed.");
      if (state === "whats-new") showWhatsNewIfNeeded("0.2.2", "0.2.1");
      if (state === "clear-seen") {
        localStorage.removeItem(LAST_SEEN_RELEASE_NOTES_KEY);
        button.textContent = "Cleared!";
        window.setTimeout(() => { button.textContent = "Clear seen version"; }, 900);
      }
    });
  }

  function showTestAvailableUpdate() {
    resetUpdateModal();
    setUpdateModalCopy("A New Update is Available!", "MiiTuber 0.2.2 is ready. Would you like to install it?");
    setUpdateModalButtons("Update Now", () => showDownloadingUpdate(0), "Update Later", hideUpdateModal);
    showUpdateModal();
  }

  return {
    start: initializeUpdateExperience,
    isBlocking: () => updateExperienceChecking || updateModalActive,
  };
}
