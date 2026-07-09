import {
  charsVisible,
  type TourController,
  type TourEmotion,
  type TourStep,
} from "./tour";

export type TourPresenterOptions = {
  root: HTMLElement;
  controller: TourController;
  sfxUrl: string;
  portraitBaseUrl: string;
  /** Extra class applied to the root while active (e.g. the spotlight-free error variant). */
  rootClassName?: string;
  /** Label for the advance indicator; defaults to "Next ▸". */
  nextLabel?: string;
  /** Hide the skip button — single-step dialogues have nothing to skip. */
  hideSkip?: boolean;
  /** End the dialogue immediately on click instead of advancing/revealing text. */
  dismissOnDialogueClick?: boolean;
  /** Optional shared audio element, useful when callers need to unlock audio first. */
  audio?: HTMLAudioElement;
};

const PORTRAIT_EMOTIONS: TourEmotion[] = [
  "normal",
  "happy",
  "surprised",
  "sad",
  "wink",
];
const MOUTH_FLIP_MS = 125;
const SPOTLIGHT_PADDING = 6;
/** Longest the typewriter waits for audio to actually start before running anyway. */
const AUDIO_START_WAIT_MS = 300;

export class TourPresenter {
  private readonly audio: HTMLAudioElement;
  private readonly spotlightEl = document.createElement("div");
  private readonly dialogueEl = document.createElement("div");
  private readonly portraitEl = document.createElement("img");
  private readonly textEl = document.createElement("p");
  private readonly nextEl = document.createElement("span");
  private readonly skipButton = document.createElement("button");
  private readonly preloadedImages: HTMLImageElement[] = [];

  private animationId: number | null = null;
  private windowListenerTimer: number | null = null;
  private activeStep: TourStep | null = null;
  private lineStartedAt = 0;
  private awaitingAudioStart = false;
  private renderedChars = -1;
  private lineComplete = false;
  private destroyed = false;

  constructor(private readonly options: TourPresenterOptions) {
    this.audio = options.audio ?? new Audio(options.sfxUrl);
    this.audio.loop = true;
    this.audio.volume = 0.35;

    this.spotlightEl.className = "tour-spotlight";

    this.dialogueEl.className = "tour-dialogue";
    this.dialogueEl.addEventListener("click", this.handleDialogueClick);

    this.portraitEl.className = "tour-dialogue__portrait";
    this.portraitEl.alt = "Tour guide portrait";
    this.portraitEl.width = 72;
    this.portraitEl.height = 72;

    this.textEl.className = "tour-dialogue__text";
    this.textEl.setAttribute("aria-live", "polite");

    this.nextEl.className = "tour-dialogue__next";
    this.nextEl.textContent = options.nextLabel ?? "Next ▸";
    this.nextEl.hidden = true;

    this.skipButton.className = "tour-dialogue__skip";
    this.skipButton.type = "button";
    this.skipButton.textContent = "Skip tour";
    this.skipButton.hidden = options.hideSkip ?? false;
    this.skipButton.addEventListener("click", this.handleSkipClick);

    const contentEl = document.createElement("div");
    contentEl.className = "tour-dialogue__content";
    contentEl.append(this.textEl, this.nextEl);

    this.dialogueEl.append(this.portraitEl, contentEl, this.skipButton);
  }

  start(): void {
    const step = this.options.controller.current();
    if (!step) return;

    this.destroyed = false;
    this.preloadPortraits();

    this.options.root.classList.add("tour-root");
    if (this.options.rootClassName) {
      this.options.root.classList.add(this.options.rootClassName);
    }
    this.options.root.hidden = false;
    this.options.root.setAttribute("aria-hidden", "false");
    this.options.root.replaceChildren(this.spotlightEl, this.dialogueEl);

    window.addEventListener("resize", this.handleResize);
    // Deferred one tick: the click/keypress that opened the tour would
    // otherwise bubble up to these listeners and instantly advance step one.
    this.windowListenerTimer = window.setTimeout(() => {
      this.windowListenerTimer = null;
      window.addEventListener("keydown", this.handleKeyDown);
      window.addEventListener("click", this.handleWindowClick);
    }, 0);
    this.startLine(step);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.windowListenerTimer !== null) {
      window.clearTimeout(this.windowListenerTimer);
      this.windowListenerTimer = null;
    }
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("click", this.handleWindowClick);
    window.removeEventListener("resize", this.handleResize);
    this.dialogueEl.removeEventListener("click", this.handleDialogueClick);
    this.skipButton.removeEventListener("click", this.handleSkipClick);

    this.stopAudio();
    this.options.root.replaceChildren();
    if (this.options.rootClassName) {
      this.options.root.classList.remove(this.options.rootClassName);
    }
    this.options.root.hidden = true;
    this.options.root.setAttribute("aria-hidden", "true");
    this.activeStep = null;
  }

  private startLine(step: TourStep): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.activeStep = step;
    this.lineStartedAt = performance.now();
    this.renderedChars = -1;
    this.lineComplete = false;
    this.nextEl.hidden = true;
    this.textEl.textContent = "";
    this.setPortrait(step.emotion, "closed");
    this.updateSpotlight();
    this.playAudio();
    this.animationId = requestAnimationFrame(this.renderFrame);
  }

  private renderFrame = (now: number): void => {
    if (this.destroyed || !this.activeStep) return;

    if (this.awaitingAudioStart) {
      // Clock is parked until audio starts; past the cap, run without it.
      if (now - this.lineStartedAt < AUDIO_START_WAIT_MS) {
        this.animationId = requestAnimationFrame(this.renderFrame);
        return;
      }
      this.awaitingAudioStart = false;
      this.lineStartedAt = now;
    }

    const elapsedMs = now - this.lineStartedAt;
    const visible = charsVisible(elapsedMs, this.activeStep.text.length);
    this.renderText(visible);

    if (visible >= this.activeStep.text.length) {
      this.completeLine();
      return;
    }

    const frame = Math.floor(elapsedMs / MOUTH_FLIP_MS) % 2 === 0 ? "closed" : "open";
    this.setPortrait(this.activeStep.emotion, frame);
    this.animationId = requestAnimationFrame(this.renderFrame);
  };

  private renderText(chars: number): void {
    if (!this.activeStep || chars === this.renderedChars) return;

    this.renderedChars = chars;
    const { text, highlight } = this.activeStep;
    const visible = text.slice(0, chars);
    const highlightStart = highlight ? text.indexOf(highlight) : -1;

    if (!highlight || highlightStart < 0 || chars <= highlightStart) {
      this.textEl.textContent = visible;
      return;
    }

    const highlightEnd = Math.min(chars, highlightStart + highlight.length);
    const mark = document.createElement("span");
    mark.className = "tour-dialogue__highlight";
    mark.textContent = text.slice(highlightStart, highlightEnd);
    this.textEl.replaceChildren(
      text.slice(0, highlightStart),
      mark,
      text.slice(highlightEnd, chars),
    );
  }

  private completeLine(): void {
    if (this.lineComplete || !this.activeStep) return;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.renderText(this.activeStep.text.length);
    this.lineComplete = true;
    this.stopAudio();
    this.setPortrait(this.activeStep.emotion, "closed");
    this.nextEl.hidden = false;
  }

  private advance(): void {
    const step = this.options.controller.next();
    if (!step) {
      this.destroy();
      return;
    }

    this.startLine(step);
  }

  private skip(): void {
    this.options.controller.skip();
    this.destroy();
  }

  private playAudio(): void {
    // play() only makes sound after decode/autoplay checks, so hold the
    // typewriter and re-anchor its clock to when playback actually starts.
    this.awaitingAudioStart = true;
    const step = this.activeStep;
    const releaseText = () => {
      if (this.destroyed || this.activeStep !== step || !this.awaitingAudioStart) return;
      this.awaitingAudioStart = false;
      this.lineStartedAt = performance.now();
    };
    try {
      this.audio.play().then(releaseText, releaseText);
    } catch {
      // Audio is optional; autoplay/user-gesture blocking must not block the tour.
      releaseText();
    }
  }

  private stopAudio(): void {
    this.audio.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      // Some browsers reject currentTime writes before metadata is available.
    }
  }

  private updateSpotlight(): void {
    const rect = this.getTargetRect();
    const top = rect
      ? rect.top - SPOTLIGHT_PADDING
      : window.innerHeight / 2;
    const left = rect
      ? rect.left - SPOTLIGHT_PADDING
      : window.innerWidth / 2;
    const width = rect ? rect.width + SPOTLIGHT_PADDING * 2 : 0;
    const height = rect ? rect.height + SPOTLIGHT_PADDING * 2 : 0;

    this.spotlightEl.style.top = `${top}px`;
    this.spotlightEl.style.left = `${left}px`;
    this.spotlightEl.style.width = `${width}px`;
    this.spotlightEl.style.height = `${height}px`;
  }

  private getTargetRect(): DOMRect | null {
    if (!this.activeStep?.target) return null;

    try {
      const target = document.querySelector<HTMLElement>(this.activeStep.target);
      return target?.getBoundingClientRect() ?? null;
    } catch {
      return null;
    }
  }

  private preloadPortraits(): void {
    if (this.preloadedImages.length > 0) return;

    for (const emotion of PORTRAIT_EMOTIONS) {
      for (const frame of ["closed", "open"] as const) {
        const image = new Image();
        image.src = this.portraitUrl(emotion, frame);
        this.preloadedImages.push(image);
      }
    }
  }

  private setPortrait(emotion: TourEmotion, frame: "closed" | "open"): void {
    this.portraitEl.src = this.portraitUrl(emotion, frame);
  }

  private portraitUrl(emotion: TourEmotion, frame: "closed" | "open"): string {
    const base = this.options.portraitBaseUrl.endsWith("/")
      ? this.options.portraitBaseUrl
      : `${this.options.portraitBaseUrl}/`;
    return `${base}portrait-${emotion}-${frame}.png`;
  }

  private handleDialogueClick = (): void => {
    this.handleAdvanceIntent();
  };

  /** Advance on any click anywhere; the skip button stops propagation. */
  private handleWindowClick = (event: MouseEvent): void => {
    // The dialogue's own listener already handled clicks inside the bubble.
    if (this.dialogueEl.contains(event.target as Node)) return;

    this.handleAdvanceIntent();
  };

  private handleAdvanceIntent(): void {
    if (!this.activeStep) return;

    if (this.options.dismissOnDialogueClick) {
      this.skip();
      return;
    }

    if (this.lineComplete) {
      this.advance();
      return;
    }

    this.completeLine();
  }

  private handleSkipClick = (event: MouseEvent): void => {
    event.stopPropagation();
    this.skip();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.skip();
      return;
    }

    // Any other key advances, except bare modifiers and keys typed into form
    // fields (the tour overlay never owns focus, so inputs stay usable).
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(event.key)) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    ) {
      return;
    }

    event.preventDefault();
    this.handleAdvanceIntent();
  };

  private handleResize = (): void => {
    this.updateSpotlight();
  };
}
