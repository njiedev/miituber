import { beforeEach, describe, expect, it } from "vitest";
import {
  charsVisible,
  readTourState,
  shouldAutoStart,
  TOUR_CHAPTERS,
  TOUR_STORAGE_KEY,
  TourController,
  writeTourState,
  type TourChapterId,
} from "./tour";
import type { StorageLike } from "./avatarLibrary";

class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe("tour state", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("defaults missing state to incomplete chapters", () => {
    expect(readTourState(storage)).toEqual({
      library: false,
      workspace: false,
    });
  });

  it("tolerates malformed JSON", () => {
    storage.setItem(TOUR_STORAGE_KEY, "not json");
    expect(readTourState(storage)).toEqual({
      library: false,
      workspace: false,
    });
  });

  it("round-trips valid state", () => {
    writeTourState(storage, { library: true, workspace: false });
    expect(readTourState(storage)).toEqual({
      library: true,
      workspace: false,
    });
  });
});

describe("shouldAutoStart", () => {
  it.each([
    ["library", { library: false, workspace: false }, true],
    ["library", { library: true, workspace: false }, false],
    ["workspace", { library: true, workspace: false }, true],
    ["workspace", { library: false, workspace: true }, false],
  ] satisfies [TourChapterId, Record<TourChapterId, boolean>, boolean][])(
    "checks %s independently",
    (chapterId, state, expected) => {
      expect(shouldAutoStart(chapterId, state)).toBe(expected);
    },
  );
});

describe("TourController", () => {
  it("advances from start through all steps, then returns null", () => {
    const completed: TourChapterId[] = [];
    const controller = new TourController((chapterId) => completed.push(chapterId));
    const chapter = TOUR_CHAPTERS.library;

    controller.start(chapter);
    expect(controller.current()).toBe(chapter.steps[0]);

    for (let index = 1; index < chapter.steps.length; index += 1) {
      expect(controller.next()).toBe(chapter.steps[index]);
    }

    expect(controller.next()).toBeNull();
    expect(controller.current()).toBeNull();
    expect(completed).toEqual(["library"]);
  });

  it("skip mid-chapter fires onComplete", () => {
    const completed: TourChapterId[] = [];
    const controller = new TourController((chapterId) => completed.push(chapterId));

    controller.start(TOUR_CHAPTERS.workspace);
    controller.next();
    controller.skip();

    expect(controller.current()).toBeNull();
    expect(completed).toEqual(["workspace"]);
  });

  it("last next fires onComplete exactly once", () => {
    const completed: TourChapterId[] = [];
    const controller = new TourController((chapterId) => completed.push(chapterId));
    const chapter = TOUR_CHAPTERS.library;

    controller.start(chapter);
    for (let index = 1; index < chapter.steps.length; index += 1) {
      controller.next();
    }

    expect(controller.next()).toBeNull();
    expect(controller.next()).toBeNull();
    controller.skip();

    expect(completed).toEqual(["library"]);
  });
});

describe("charsVisible", () => {
  it("is zero at t=0", () => {
    expect(charsVisible(0, 12)).toBe(0);
  });

  it("is monotonic", () => {
    const samples = [0, 120, 240, 360, 480].map((elapsedMs) =>
      charsVisible(elapsedMs, 100),
    );

    expect(samples).toEqual([...samples].sort((a, b) => a - b));
  });

  it("clamps at textLength", () => {
    expect(charsVisible(10_000, 8)).toBe(8);
  });

  it("honors charsPerSecond", () => {
    expect(charsVisible(500, 20, 10)).toBe(5);
  });
});

describe("chapter data", () => {
  it("has unique step ids", () => {
    const ids = Object.values(TOUR_CHAPTERS).flatMap((chapter) =>
      chapter.steps.map((step) => step.id),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses null or non-empty target selectors", () => {
    for (const chapter of Object.values(TOUR_CHAPTERS)) {
      for (const step of chapter.steps) {
        expect(
          step.target === null ||
            (typeof step.target === "string" && step.target.length > 0),
        ).toBe(true);
      }
    }
  });
});
