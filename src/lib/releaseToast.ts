import { createUpdateChime } from "./updateChime";
import { versionChangeParts } from "./releaseNotes";

export function createReleaseToast() {
  const toast = document.querySelector<HTMLElement>("#release-toast");
  const version = document.querySelector<HTMLElement>("#release-toast-version");
  const message = document.querySelector<HTMLElement>("#release-toast-message");
  const close = document.querySelector<HTMLButtonElement>("#release-toast-close");
  const chime = createUpdateChime(() => !!toast && !toast.hidden && toast.dataset.leaving !== "true" && !document.hidden && !document.body.classList.contains("capture-isolate"));
  let timer: number | undefined;
  let cleanupTimer: number | undefined;
  let onDismiss: (() => void) | null = null;

  function dismiss() {
    if (!toast || toast.hidden || toast.dataset.leaving === "true") return;
    window.clearTimeout(timer);
    chime.stop();
    toast.dataset.leaving = "true";
    onDismiss?.();
    onDismiss = null;
    cleanupTimer = window.setTimeout(() => {
      toast.hidden = true;
      delete toast.dataset.leaving;
    }, 250);
  }

  function scheduleDismiss() {
    window.clearTimeout(timer);
    if (!toast?.hidden && !toast?.matches(":hover, :focus-within")) {
      timer = window.setTimeout(dismiss, 8000);
    }
  }

  close?.addEventListener("click", dismiss);
  toast?.addEventListener("mouseenter", () => window.clearTimeout(timer));
  toast?.addEventListener("mouseleave", scheduleDismiss);
  toast?.addEventListener("focusin", () => window.clearTimeout(timer));
  toast?.addEventListener("focusout", () => window.setTimeout(scheduleDismiss, 0));
  toast?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismiss();
  });

  return {
    show(from: string, to: string, note: string, remember: () => void) {
      if (!toast || !version || !message) return;
      chime.stop();
      window.clearTimeout(timer);
      window.clearTimeout(cleanupTimer);
      onDismiss = remember;
      const { unchanged, changed } = versionChangeParts(from, to);
      const highlight = document.createElement("span");
      highlight.className = "release-toast__change";
      highlight.textContent = changed;
      version.replaceChildren(`v${from} → v${unchanged}`, highlight);
      message.textContent = note;
      toast.hidden = true;
      delete toast.dataset.leaving;
      void toast.offsetWidth;
      toast.hidden = false;
      scheduleDismiss();
      chime.play();
    },
    dismiss,
  };
}
