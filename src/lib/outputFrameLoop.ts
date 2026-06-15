export type OutputFrameLoopOptions = {
  width: number;
  height: number;
  fps: number;
  captureFrame: (width: number, height: number) => Promise<Uint8Array>;
  publishFrame: (frame: Uint8Array, metadata: OutputFrameMetadata) => Promise<void>;
  onStats?: (stats: OutputFrameLoopStats) => void;
  onError?: (error: unknown) => void;
};

export type OutputFrameMetadata = {
  width: number;
  height: number;
  fps: number;
  frameIndex: number;
  capturedAtMs: number;
};

export type OutputFrameLoopStats = {
  running: boolean;
  targetFps: number;
  actualFps: number;
  frameCount: number;
  droppedFrames: number;
  lastFrameBytes: number;
};

export class OutputFrameLoop {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private publishing = false;
  private frameCount = 0;
  private droppedFrames = 0;
  private lastFrameBytes = 0;
  private statsStartedAt = 0;

  constructor(private readonly options: OutputFrameLoopOptions) {}

  start() {
    if (this.timerId !== null) return;

    this.frameCount = 0;
    this.droppedFrames = 0;
    this.lastFrameBytes = 0;
    this.statsStartedAt = performance.now();

    const intervalMs = 1000 / Math.max(1, this.options.fps);
    this.timerId = globalThis.setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
    this.emitStats();
  }

  stop() {
    if (this.timerId === null) return;

    globalThis.clearInterval(this.timerId);
    this.timerId = null;
    this.publishing = false;
    this.emitStats();
  }

  isRunning() {
    return this.timerId !== null;
  }

  getStats(): OutputFrameLoopStats {
    const elapsedSeconds = Math.max(0.001, (performance.now() - this.statsStartedAt) / 1000);

    return {
      running: this.isRunning(),
      targetFps: this.options.fps,
      actualFps: this.frameCount / elapsedSeconds,
      frameCount: this.frameCount,
      droppedFrames: this.droppedFrames,
      lastFrameBytes: this.lastFrameBytes,
    };
  }

  private async tick() {
    if (!this.isRunning()) return;

    if (this.publishing) {
      this.droppedFrames += 1;
      this.emitStats();
      return;
    }

    this.publishing = true;
    const frameIndex = this.frameCount + 1;
    const capturedAtMs = performance.now();

    try {
      const frame = await this.options.captureFrame(
        this.options.width,
        this.options.height,
      );
      this.lastFrameBytes = frame.byteLength;
      await this.options.publishFrame(frame, {
        width: this.options.width,
        height: this.options.height,
        fps: this.options.fps,
        frameIndex,
        capturedAtMs,
      });
      this.frameCount = frameIndex;
      this.emitStats();
    } catch (error) {
      this.options.onError?.(error);
      this.stop();
    } finally {
      this.publishing = false;
    }
  }

  private emitStats() {
    this.options.onStats?.(this.getStats());
  }
}
