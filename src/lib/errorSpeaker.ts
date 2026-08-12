import { TourController, type TourEmotion } from "./tour";
import { TourPresenter } from "./tourPresenter";

export type MiiErrorLine = {
  text: string;
  emotion: TourEmotion;
};

export type ErrorSpeakerOptions = {
  root: HTMLElement;
  sfxUrl: string;
  portraitBaseUrl: string;
  /** Errors never steal the overlay from a running tour; they are skipped instead. */
  isTourActive: () => boolean;
};

function errorName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";

  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

export function miiCameraErrorLine(error: unknown): MiiErrorLine {
  switch (errorName(error)) {
    case "NotReadableError":
    case "TrackStartError":
      return {
        emotion: "surprised",
        text: "Uh oh… I can't see you! Another app is using your camera.",
      };
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        emotion: "sad",
        text: "I'm not allowed to look through your camera… could you enable camera access for me?",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        emotion: "surprised",
        text: "Huh? I looked everywhere, but I couldn't find a camera!",
      };
    default:
      return {
        emotion: "sad",
        text: "Oh no… something went wrong with the camera, and now I can't see you.",
      };
  }
}

export function miiMicrophoneErrorLine(error: unknown): MiiErrorLine {
  switch (errorName(error)) {
    case "NotReadableError":
    case "TrackStartError":
      return {
        emotion: "surprised",
        text: "I can't hear you! Another app is hogging your microphone.",
      };
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        emotion: "sad",
        text: "I'm not allowed to listen… could you enable microphone access for me?",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        emotion: "sad",
        text: "I listened really hard, but I couldn't find a microphone anywhere…",
      };
    default:
      return {
        emotion: "sad",
        text: "My ears aren't working… I couldn't start listening to your microphone.",
      };
  }
}

export function miiAvatarLoadErrorLine(): MiiErrorLine {
  return {
    emotion: "sad",
    text: "Oh no… I couldn't bring that Mii to life. The file might be damaged — try importing it again?",
  };
}

/**
 * Shows a single-step, spotlight-free tour dialogue that "speaks" an error in
 * first person. Reuses TourPresenter, so it gets the typewriter, babble SFX,
 * and mouth-flap animation for free. Dismissed by click or Escape.
 */
export class ErrorSpeaker {
  private readonly audio: HTMLAudioElement;
  private activeController: TourController | null = null;
  private activePresenter: TourPresenter | null = null;

  constructor(private readonly options: ErrorSpeakerOptions) {
    this.audio = new Audio(options.sfxUrl);
    this.audio.loop = true;
    this.audio.volume = 0.35;
  }

  /** Returns false when a tour owns the overlay and the bubble was skipped. */
  speak(line: MiiErrorLine): boolean {
    if (this.options.isTourActive()) return false;

    this.dismiss();

    const controller = new TourController(() => {
      if (this.activeController !== controller) return;
      this.activeController = null;
      this.activePresenter = null;
    });
    // The chapter id is only reported back to onComplete, which ignores it;
    // this pseudo-chapter never touches persisted tour state.
    controller.start({
      id: "library",
      steps: [{ id: "error", target: null, text: line.text, emotion: line.emotion }],
    });

    const presenter = new TourPresenter({
      root: this.options.root,
      controller,
      sfxUrl: this.options.sfxUrl,
      portraitBaseUrl: this.options.portraitBaseUrl,
      audio: this.audio,
      rootClassName: "tour-root--error",
      nextLabel: "Dismiss ▸",
      hideSkip: true,
      dismissOnDialogueClick: true,
    });

    this.activeController = controller;
    this.activePresenter = presenter;
    presenter.start();
    return true;
  }

  dismiss(): void {
    const controller = this.activeController;
    const presenter = this.activePresenter;

    this.activeController = null;
    this.activePresenter = null;

    controller?.skip();
    presenter?.destroy();
  }
}
