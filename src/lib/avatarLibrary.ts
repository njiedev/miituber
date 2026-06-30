export const LIBRARY_STORAGE_KEY = "miituber.library.v1";

export type LibraryAvatar = {
  id: string;
  name: string;
  bytes: number[];
  thumbnailDataUrl: string | null;
  createdAt: number;
};

export type NewAvatarInput = {
  name: string;
  bytes: number[];
  thumbnailDataUrl?: string | null;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isByteArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
  );
}

function isValidAvatar(value: unknown): value is LibraryAvatar {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    isByteArray(candidate.bytes) &&
    (candidate.thumbnailDataUrl === null ||
      typeof candidate.thumbnailDataUrl === "string") &&
    typeof candidate.createdAt === "number"
  );
}

export function parseLibrary(raw: string | null): LibraryAvatar[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidAvatar);
  } catch {
    return [];
  }
}

export function serializeLibrary(avatars: LibraryAvatar[]): string {
  return JSON.stringify(avatars);
}

export function sanitizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : "Avatar";
}

export function newAvatarId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `avatar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function readLibrary(storage: StorageLike): LibraryAvatar[] {
  return parseLibrary(storage.getItem(LIBRARY_STORAGE_KEY));
}

export function writeLibrary(
  storage: StorageLike,
  avatars: LibraryAvatar[],
): void {
  storage.setItem(LIBRARY_STORAGE_KEY, serializeLibrary(avatars));
}

export function createAvatar(input: NewAvatarInput): LibraryAvatar {
  if (!isByteArray(input.bytes)) {
    throw new Error("Avatar bytes must be a non-empty array of 0-255 values.");
  }

  return {
    id: newAvatarId(),
    name: sanitizeName(input.name),
    bytes: input.bytes,
    thumbnailDataUrl: input.thumbnailDataUrl ?? null,
    createdAt: Date.now(),
  };
}

export function addAvatar(
  storage: StorageLike,
  input: NewAvatarInput,
): LibraryAvatar {
  const avatar = createAvatar(input);
  const avatars = readLibrary(storage);
  avatars.push(avatar);
  writeLibrary(storage, avatars);
  return avatar;
}

export function removeAvatar(
  storage: StorageLike,
  id: string,
): LibraryAvatar[] {
  const avatars = readLibrary(storage).filter((avatar) => avatar.id !== id);
  writeLibrary(storage, avatars);
  return avatars;
}

export function renameAvatar(
  storage: StorageLike,
  id: string,
  name: string,
): LibraryAvatar[] {
  const avatars = readLibrary(storage).map((avatar) =>
    avatar.id === id ? { ...avatar, name: sanitizeName(name) } : avatar,
  );
  writeLibrary(storage, avatars);
  return avatars;
}

export function setAvatarThumbnail(
  storage: StorageLike,
  id: string,
  thumbnailDataUrl: string | null,
): LibraryAvatar[] {
  const avatars = readLibrary(storage).map((avatar) =>
    avatar.id === id ? { ...avatar, thumbnailDataUrl } : avatar,
  );
  writeLibrary(storage, avatars);
  return avatars;
}

export function getAvatar(
  storage: StorageLike,
  id: string,
): LibraryAvatar | undefined {
  return readLibrary(storage).find((avatar) => avatar.id === id);
}
