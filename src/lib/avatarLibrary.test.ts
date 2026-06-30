import { beforeEach, describe, expect, it } from "vitest";
import {
  addAvatar,
  getAvatar,
  LIBRARY_STORAGE_KEY,
  parseLibrary,
  readLibrary,
  removeAvatar,
  renameAvatar,
  sanitizeName,
  setAvatarThumbnail,
  type StorageLike,
} from "./avatarLibrary";

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

describe("avatar library", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("starts empty", () => {
    expect(readLibrary(storage)).toEqual([]);
  });

  it("adds and persists an avatar", () => {
    const avatar = addAvatar(storage, {
      name: "Mee",
      bytes: [1, 2, 3],
      thumbnailDataUrl: "data:image/png;base64,abc",
    });

    expect(avatar.id).toBeTruthy();
    expect(avatar.createdAt).toBeGreaterThan(0);

    const persisted = readLibrary(storage);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].name).toBe("Mee");
    expect(persisted[0].bytes).toEqual([1, 2, 3]);
    expect(persisted[0].thumbnailDataUrl).toBe("data:image/png;base64,abc");
  });

  it("rejects invalid byte arrays", () => {
    expect(() => addAvatar(storage, { name: "Bad", bytes: [] })).toThrow();
    expect(() =>
      addAvatar(storage, { name: "Bad", bytes: [300] as number[] }),
    ).toThrow();
  });

  it("removes an avatar by id", () => {
    const first = addAvatar(storage, { name: "A", bytes: [1] });
    addAvatar(storage, { name: "B", bytes: [2] });

    const remaining = removeAvatar(storage, first.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe("B");
    expect(getAvatar(storage, first.id)).toBeUndefined();
  });

  it("renames an avatar", () => {
    const avatar = addAvatar(storage, { name: "Old", bytes: [1] });
    renameAvatar(storage, avatar.id, "  New Name  ");
    expect(getAvatar(storage, avatar.id)?.name).toBe("New Name");
  });

  it("updates a thumbnail after the fact", () => {
    const avatar = addAvatar(storage, { name: "A", bytes: [1] });
    expect(getAvatar(storage, avatar.id)?.thumbnailDataUrl).toBeNull();

    setAvatarThumbnail(storage, avatar.id, "data:image/png;base64,zzz");
    expect(getAvatar(storage, avatar.id)?.thumbnailDataUrl).toBe(
      "data:image/png;base64,zzz",
    );
  });

  it("falls back to a default name when blank", () => {
    expect(sanitizeName("   ")).toBe("Avatar");
    expect(sanitizeName("Luigi")).toBe("Luigi");
  });

  it("ignores corrupt or invalid stored entries", () => {
    storage.setItem(LIBRARY_STORAGE_KEY, "not json");
    expect(readLibrary(storage)).toEqual([]);

    storage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify([
        { id: "ok", name: "Good", bytes: [1], thumbnailDataUrl: null, createdAt: 1 },
        { id: "bad", name: "Missing bytes", createdAt: 2 },
      ]),
    );
    const parsed = readLibrary(storage);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("ok");
  });

  it("parseLibrary tolerates null", () => {
    expect(parseLibrary(null)).toEqual([]);
  });
});
