import {
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";
import {
  mouseFollowTarget,
  stepMouseFollow,
  type MouseFollowGeometry,
} from "./mouseFollow";
import type { HeadRotation } from "./types";

const GEOMETRY_REFRESH_MS = 500;
const UNSUPPORTED_AFTER_MS = 2000;

type WindowGeometry = Omit<MouseFollowGeometry, "cursor" | "headCss">;

export type MouseTrackerCallbacks = {
  getHeadClientPosition: () => { x: number; y: number } | null;
  onRotation: (rotation: HeadRotation) => void;
  onUnsupported: () => void;
  onError: (error: unknown) => void;
};

export class MouseTracker {
  private running = false;
  private frameId: number | null = null;
  private geometry: WindowGeometry | null = null;
  private geometryReadAt = -Infinity;
  private startedAt = 0;
  private sawNonZeroCursor = false;
  private lastFrameAt = 0;
  private rotation: HeadRotation = { pitch: 0, yaw: 0, roll: 0 };
  private callbacks: MouseTrackerCallbacks | null = null;

  start(callbacks: MouseTrackerCallbacks, initialRotation: HeadRotation) {
    this.stop();
    this.callbacks = callbacks;
    this.running = true;
    this.rotation = { ...initialRotation };
    this.geometry = null;
    this.geometryReadAt = -Infinity;
    this.startedAt = performance.now();
    this.sawNonZeroCursor = false;
    this.lastFrameAt = this.startedAt;
    this.scheduleFrame();
  }

  stop() {
    this.running = false;
    this.callbacks = null;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  isRunning() {
    return this.running;
  }

  private scheduleFrame() {
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      void this.tick();
    });
  }

  private async tick() {
    const callbacks = this.callbacks;
    if (!this.running || !callbacks) return;

    try {
      const now = performance.now();
      const [cursor, geometry] = await Promise.all([
        cursorPosition(),
        this.readGeometry(now),
      ]);
      if (!this.running || callbacks !== this.callbacks) return;

      if (cursor.x !== 0 || cursor.y !== 0) this.sawNonZeroCursor = true;
      if (!this.sawNonZeroCursor && now - this.startedAt > UNSUPPORTED_AFTER_MS) {
        this.stop();
        callbacks.onUnsupported();
        return;
      }

      const headCss = callbacks.getHeadClientPosition();
      if (headCss) {
        const target = mouseFollowTarget({ ...geometry, cursor, headCss });
        this.rotation = stepMouseFollow(this.rotation, target, now - this.lastFrameAt);
        callbacks.onRotation(this.rotation);
      }
      this.lastFrameAt = now;
    } catch (error) {
      this.stop();
      callbacks.onError(error);
      return;
    }

    this.scheduleFrame();
  }

  private async readGeometry(now: number): Promise<WindowGeometry> {
    if (this.geometry && now - this.geometryReadAt < GEOMETRY_REFRESH_MS) {
      return this.geometry;
    }

    const appWindow = getCurrentWindow();
    const [innerPosition, scaleFactor, monitor, primary] = await Promise.all([
      appWindow.innerPosition(),
      appWindow.scaleFactor(),
      currentMonitor(),
      primaryMonitor(),
    ]);
    const screen = monitor ?? primary;
    this.geometry = {
      windowInnerPosition: { x: innerPosition.x, y: innerPosition.y },
      windowScaleFactor: scaleFactor,
      monitorSize: {
        width: screen?.size.width ?? window.screen.width * scaleFactor,
        height: screen?.size.height ?? window.screen.height * scaleFactor,
      },
      monitorScaleFactor: screen?.scaleFactor ?? scaleFactor,
      primaryScaleFactor: primary?.scaleFactor ?? scaleFactor,
      isMac: /Mac/i.test(navigator.userAgent),
    };
    this.geometryReadAt = now;
    return this.geometry;
  }
}
