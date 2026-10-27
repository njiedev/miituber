import type { HeadRotation } from "./types";

export const MOUSE_FOLLOW_MAX_YAW = 32;
export const MOUSE_FOLLOW_MAX_PITCH = 18;
export const MOUSE_FOLLOW_GAIN = 1.6;
export const MOUSE_FOLLOW_SMOOTHING = 0.14;

type Point = { x: number; y: number };
type Size = { width: number; height: number };

export type MouseFollowGeometry = {
  cursor: Point;
  windowInnerPosition: Point;
  windowScaleFactor: number;
  monitorSize: Size;
  monitorScaleFactor: number;
  primaryScaleFactor: number;
  headCss: Point;
  isMac: boolean;
};

export function mouseFollowTarget(geometry: MouseFollowGeometry): HeadRotation {
  const {
    cursor,
    windowInnerPosition,
    windowScaleFactor,
    monitorSize,
    monitorScaleFactor,
    primaryScaleFactor,
    headCss,
    isMac,
  } = geometry;

  let cursorX: number;
  let cursorY: number;
  let headX: number;
  let headY: number;
  let halfWidth: number;
  let halfHeight: number;

  if (isMac) {
    cursorX = cursor.x / primaryScaleFactor;
    cursorY = cursor.y / primaryScaleFactor;
    headX = windowInnerPosition.x / windowScaleFactor + headCss.x;
    headY = windowInnerPosition.y / windowScaleFactor + headCss.y;
    halfWidth = monitorSize.width / monitorScaleFactor / 2;
    halfHeight = monitorSize.height / monitorScaleFactor / 2;
  } else {
    cursorX = cursor.x;
    cursorY = cursor.y;
    headX = windowInnerPosition.x + headCss.x * windowScaleFactor;
    headY = windowInnerPosition.y + headCss.y * windowScaleFactor;
    halfWidth = monitorSize.width / 2;
    halfHeight = monitorSize.height / 2;
  }

  const nx = clamp(((cursorX - headX) / Math.max(1, halfWidth)) * MOUSE_FOLLOW_GAIN);
  const ny = clamp(((cursorY - headY) / Math.max(1, halfHeight)) * MOUSE_FOLLOW_GAIN);
  return {
    pitch: ny * MOUSE_FOLLOW_MAX_PITCH,
    yaw: nx * MOUSE_FOLLOW_MAX_YAW,
    roll: 0,
  };
}

export function stepMouseFollow(
  current: HeadRotation,
  target: HeadRotation,
  dtMs: number,
): HeadRotation {
  const frames = Math.max(0, dtMs) / (1000 / 60);
  const t = 1 - Math.pow(1 - MOUSE_FOLLOW_SMOOTHING, frames);
  return {
    pitch: current.pitch + (target.pitch - current.pitch) * t,
    yaw: current.yaw + (target.yaw - current.yaw) * t,
    roll: current.roll + (target.roll - current.roll) * t,
  };
}

function clamp(value: number) {
  return Math.min(1, Math.max(-1, value));
}
