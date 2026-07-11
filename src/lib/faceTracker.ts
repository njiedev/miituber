import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";

const MEDIAPIPE_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type FaceTrackerFrame = {
  results: FaceLandmarkerResult;
  trackingFps: number;
  detectMs: number;
};

export type CameraDevice = {
  deviceId: string;
  label: string;
};

export type FaceTrackerStartOptions = {
  deviceId?: string;
  maxFps?: number;
};

export type FaceTrackerCallbacks = {
  onFrame: (frame: FaceTrackerFrame) => void;
  onError?: (error: unknown) => void;
  onVideoReady?: (video: HTMLVideoElement) => void;
  onVideoStopped?: () => void;
};

export class FaceTracker {
  private faceLandmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private animationFrameId: number | null = null;
  private timeoutId: number | null = null;
  private running = false;
  private removeVisibilityListener: (() => void) | undefined;
  private lastFrameAt = 0;
  private lastDetectionAt = 0;
  private onVideoStopped: (() => void) | undefined;

  async start(
    callbacks: FaceTrackerCallbacks,
    options: FaceTrackerStartOptions = {},
  ) {
    if (this.running) return;
    this.running = true;
    this.onVideoStopped = callbacks.onVideoStopped;

    try {
      this.faceLandmarker ??= await createFaceLandmarker();
      this.stream = await requestCameraStream(options);

      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.stream;
      await this.video.play();
      callbacks.onVideoReady?.(this.video);
    } catch (error) {
      this.stop();
      throw error;
    }

    const minFrameIntervalMs = maxFpsToMinIntervalMs(options.maxFps ?? 30);

    // rAF stops entirely while the window is minimized or the webview is
    // considered hidden, which would freeze pose events to the clean-output
    // window (and thus OBS). Timers keep firing there, so fall back to
    // setTimeout whenever the document reports hidden.
    const scheduleNextFrame = () => {
      if (!this.running) return;
      if (document.hidden) {
        this.timeoutId = window.setTimeout(processFrame, minFrameIntervalMs);
      } else {
        this.animationFrameId = requestAnimationFrame(processFrame);
      }
    };

    const processFrame = () => {
      this.animationFrameId = null;
      this.timeoutId = null;
      if (!this.running || !this.video || !this.faceLandmarker) return;

      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const now = performance.now();
          if (now - this.lastDetectionAt < minFrameIntervalMs) {
            scheduleNextFrame();
            return;
          }

          const detectStartedAt = performance.now();
          const results = this.faceLandmarker.detectForVideo(this.video, now);
          const detectMs = performance.now() - detectStartedAt;
          const deltaMs = this.lastFrameAt > 0 ? now - this.lastFrameAt : 0;
          this.lastDetectionAt = now;
          this.lastFrameAt = now;

          callbacks.onFrame({
            results,
            trackingFps: deltaMs > 0 ? 1000 / deltaMs : 0,
            detectMs,
          });
        } catch (error) {
          callbacks.onError?.(error);
          this.stop();
          return;
        }
      }

      scheduleNextFrame();
    };

    scheduleNextFrame();

    const handleVisibilityChange = () => {
      // Swap the pending rAF for a timeout (or back) immediately, otherwise
      // a frame already scheduled via rAF stays parked until the window is
      // restored.
      if (!this.running) return;
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      if (this.timeoutId !== null) {
        window.clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      scheduleNextFrame();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    this.removeVisibilityListener = () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }

  stop() {
    this.running = false;
    this.removeVisibilityListener?.();
    this.removeVisibilityListener = undefined;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.video) {
      this.onVideoStopped?.();
      this.video.pause();
      this.video.srcObject = null;
      this.video.remove();
    }
    this.video = null;
    this.onVideoStopped = undefined;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    this.lastFrameAt = 0;
    this.lastDetectionAt = 0;
  }

  async listCameras(): Promise<CameraDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    let cameraNumber = 1;

    return devices
      .filter((device) => device.kind === "videoinput")
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${cameraNumber++}`,
      }));
  }
}

async function createFaceLandmarker() {
  const { FaceLandmarker, FilesetResolver } = await import(
    "@mediapipe/tasks-vision"
  );
  const filesetResolver = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

  return FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: FACE_LANDMARKER_MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    numFaces: 1,
  });
}

async function requestCameraStream(options: FaceTrackerStartOptions) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not available in this webview.");
  }

  const videoConstraints: MediaTrackConstraints = {
    width: 640,
    height: 480,
  };

  if (options.deviceId) {
    videoConstraints.deviceId = { exact: options.deviceId };
  } else {
    videoConstraints.facingMode = "user";
  }

  return navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false,
  });
}

export function maxFpsToMinIntervalMs(maxFps: number) {
  return 1000 / Math.max(1, maxFps);
}
