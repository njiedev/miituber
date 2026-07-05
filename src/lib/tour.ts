import type { StorageLike } from "./avatarLibrary";

export type TourEmotion = "normal" | "happy" | "surprised" | "sad" | "wink";
export type TourChapterId = "library" | "workspace";

export interface TourStep {
  id: string;
  /** CSS selector to spotlight, or null for a centered, untargeted step */
  target: string | null;
  text: string;
  emotion: TourEmotion;
}

export interface TourChapter {
  id: TourChapterId;
  steps: TourStep[];
}

export type TourState = Record<TourChapterId, boolean>;

export const TOUR_STORAGE_KEY = "miituber.onboardingTour.v1";

const DEFAULT_TOUR_STATE: TourState = {
  library: false,
  workspace: false,
};

export const TOUR_CHAPTERS: Record<TourChapterId, TourChapter> = {
  library: {
    id: "library",
    steps: [
      {
        id: "lib-welcome",
        target: null,
        emotion: "happy",
        text: "Hi! Welcome to MiiTuber! I'm your guide — let me show you around.",
      },
      {
        id: "lib-add",
        target: "#add-avatar-tile",
        emotion: "normal",
        text: "Everything starts here. Click Add Avatar to import your Mii — .ffsd files work great.",
      },
      {
        id: "lib-grid",
        target: "#avatar-grid",
        emotion: "happy",
        text: "Your Miis live here in the library. Click one any time to jump into its workspace.",
      },
      {
        id: "lib-go",
        target: "#add-avatar-tile",
        emotion: "wink",
        text: "Go ahead and add your first Mii — I'll meet you in the workspace!",
      },
    ],
  },
  workspace: {
    id: "workspace",
    steps: [
      {
        id: "ws-welcome",
        target: null,
        emotion: "happy",
        text: "Nice! This is the workspace — your Mii's stage.",
      },
      {
        id: "ws-rail",
        target: ".side-rail",
        emotion: "normal",
        text: "This rail holds all your controls: scene, camera, microphone, output, and advanced settings.",
      },
      {
        id: "ws-scene",
        target: '.rail-item[data-menu="scene"]',
        emotion: "normal",
        text: "Scene lets you change your Mii's expression and the background — or make it transparent.",
      },
      {
        id: "ws-tracking",
        target: "#start-tracking-button",
        emotion: "surprised",
        text: "Start webcam tracking here and your Mii follows your head and face. Seriously — try it!",
      },
      {
        id: "ws-mic",
        target: '.rail-item[data-menu="mic"]',
        emotion: "happy",
        text: "Mic lip-sync makes your Mii's mouth move when you talk.",
      },
      {
        id: "ws-output",
        target: "#isolate-capture-button",
        emotion: "normal",
        text: "When you're ready to stream, Clean View gives OBS a clean window to capture — with real transparency.",
      },
      {
        id: "ws-done",
        target: null,
        emotion: "wink",
        text: "That's the tour! Replay it any time with the ? button. Have fun!",
      },
    ],
  },
};

export function readTourState(storage: StorageLike): TourState {
  const raw = storage.getItem(TOUR_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_TOUR_STATE };

  try {
    const parsed = JSON.parse(raw) as Partial<Record<TourChapterId, unknown>>;
    return {
      library: parsed.library === true,
      workspace: parsed.workspace === true,
    };
  } catch {
    return { ...DEFAULT_TOUR_STATE };
  }
}

export function writeTourState(
  storage: StorageLike,
  state: TourState,
): void {
  storage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
}

export function shouldAutoStart(
  chapterId: TourChapterId,
  state: TourState,
): boolean {
  return !state[chapterId];
}

export function charsVisible(
  elapsedMs: number,
  textLength: number,
  charsPerSecond = 30,
): number {
  const visible = Math.floor((Math.max(0, elapsedMs) / 1000) * charsPerSecond);
  return Math.min(Math.max(0, textLength), Math.max(0, visible));
}

export class TourController {
  private chapter: TourChapter | null = null;
  private stepIndex = 0;
  private completeEmitted = false;

  constructor(private readonly onComplete: (chapterId: TourChapterId) => void) {}

  start(chapter: TourChapter): void {
    this.chapter = chapter;
    this.stepIndex = 0;
    this.completeEmitted = false;
  }

  next(): TourStep | null {
    if (!this.chapter) return null;

    if (this.stepIndex < this.chapter.steps.length - 1) {
      this.stepIndex += 1;
      return this.current();
    }

    this.complete();
    return null;
  }

  skip(): void {
    this.complete();
  }

  current(): TourStep | null {
    return this.chapter?.steps[this.stepIndex] ?? null;
  }

  private complete(): void {
    if (!this.chapter || this.completeEmitted) return;

    const chapterId = this.chapter.id;
    this.completeEmitted = true;
    this.chapter = null;
    this.stepIndex = 0;
    this.onComplete(chapterId);
  }
}
