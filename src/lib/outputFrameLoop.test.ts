import { describe, expect, it, vi } from "vitest";
import { OutputFrameLoop } from "./outputFrameLoop";

describe("OutputFrameLoop", () => {
  it("publishes frames at the configured resolution", async () => {
    vi.useFakeTimers();
    const published: unknown[] = [];
    const loop = new OutputFrameLoop({
      width: 1280,
      height: 720,
      fps: 30,
      captureFrame: async (width, height) => new Uint8Array([width / 10, height / 10]),
      publishFrame: async (frame, metadata) => {
        published.push({ frame, metadata });
      },
    });

    loop.start();
    await vi.runOnlyPendingTimersAsync();
    loop.stop();
    vi.useRealTimers();

    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({
      metadata: { width: 1280, height: 720, fps: 30, frameIndex: 1 },
    });
  });

  it("drops output ticks while a previous frame is still publishing", async () => {
    vi.useFakeTimers();
    let resolvePublish = () => {};
    const loop = new OutputFrameLoop({
      width: 640,
      height: 360,
      fps: 30,
      captureFrame: async () => new Uint8Array([1]),
      publishFrame: () =>
        new Promise<void>((resolve) => {
          resolvePublish = resolve;
        }),
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(34);

    expect(loop.getStats().droppedFrames).toBeGreaterThan(0);
    resolvePublish();
    await vi.runOnlyPendingTimersAsync();
    loop.stop();
    vi.useRealTimers();
  });
});
