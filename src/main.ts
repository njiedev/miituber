import { invoke } from "@tauri-apps/api/core";
import { mapToExpression } from "./lib/expressionMapper";
import { FaceTracker, type FaceTrackerFrame } from "./lib/faceTracker";
import { AvatarScene } from "./lib/scene";
import {
  ExpressionSignalTracker,
  ExpressionStabilizer,
  HeadRotationSmoother,
} from "./lib/smoothing";
import {
  FFL_EXPRESSION_LABELS,
  FFLExpression,
  type BlendshapeCategory,
} from "./lib/types";

const fileInput = document.querySelector<HTMLInputElement>("#mii-file");
const renderButton = document.querySelector<HTMLButtonElement>("#render-button");
const statusEl = document.querySelector<HTMLElement>("#status");
const viewerCanvas = document.querySelector<HTMLCanvasElement>("#mii-viewer");
const fileNameEl = document.querySelector<HTMLElement>("#file-name");
const rendererHealthEl = document.querySelector<HTMLElement>("#renderer-health");
const emptyPreviewEl = document.querySelector<HTMLElement>(".empty-preview");
const expressionSelect = document.querySelector<HTMLSelectElement>("#expression-select");
const debugMaterialsInput =
  document.querySelector<HTMLInputElement>("#debug-materials");
const transparentBackgroundInput = document.querySelector<HTMLInputElement>(
  "#transparent-background",
);
const startTrackingButton = document.querySelector<HTMLButtonElement>(
  "#start-tracking-button",
);
const stopTrackingButton = document.querySelector<HTMLButtonElement>(
  "#stop-tracking-button",
);
const trackingStatusEl = document.querySelector<HTMLElement>("#tracking-status");
const cameraSelect = document.querySelector<HTMLSelectElement>("#camera-select");
const debugExpressionEl = document.querySelector<HTMLElement>("#debug-expression");
const debugHeadRotationEl =
  document.querySelector<HTMLElement>("#debug-head-rotation");
const debugTrackingFpsEl = document.querySelector<HTMLElement>("#debug-tracking-fps");
const debugRenderFpsEl = document.querySelector<HTMLElement>("#debug-render-fps");
const debugDetectMsEl = document.querySelector<HTMLElement>("#debug-detect-ms");
const debugExpressionScoresEl = document.querySelector<HTMLElement>(
  "#debug-expression-scores",
);
const debugTopBlendshapesEl = document.querySelector<HTMLElement>(
  "#debug-top-blendshapes",
);

let selectedFile: File | null = null;
let avatarLoaded = false;
let avatarHasExpressionVariants = false;
let tracking = false;

type RendererStatus = {
  reachable: boolean;
  message: string;
};

function setStatus(message: string, tone: "idle" | "error" | "success" = "idle") {
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function setRendererHealth(
  message: string,
  tone: "idle" | "error" | "success" = "idle",
) {
  if (!rendererHealthEl) return;

  rendererHealthEl.textContent = message;
  rendererHealthEl.dataset.tone = tone;
}

function setTrackingStatus(
  message: string,
  tone: "idle" | "error" | "success" = "idle",
) {
  if (!trackingStatusEl) return;

  trackingStatusEl.textContent = message;
  trackingStatusEl.dataset.tone = tone;
}

function logRenderEvent(message: string, details: Record<string, unknown> = {}) {
  console.info(`[MiiTuber] ${message}`, details);
}

function validateFileExtension(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith(".ffsd") ||
    lowerName.endsWith(".miic") ||
    lowerName.endsWith(".bin") ||
    lowerName.endsWith(".dat")
  );
}

async function refreshRendererHealth() {
  try {
    const status = await invoke<RendererStatus>("check_renderer_status");
    setRendererHealth(status.message, status.reachable ? "success" : "error");
    logRenderEvent("renderer health checked", status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRendererHealth(`Could not check renderer: ${message}`, "error");
    console.error("[MiiTuber] check_renderer_status failed", { error, message });
  }
}

function setRenderButtonDisabled(disabled: boolean) {
  if (renderButton) renderButton.disabled = disabled;
}

function setTrackingButtons() {
  if (startTrackingButton) {
    startTrackingButton.disabled =
      !avatarLoaded || !avatarHasExpressionVariants || tracking;
  }

  if (stopTrackingButton) {
    stopTrackingButton.disabled = !tracking;
  }
}

function setDebugValues(
  expressionIndex: number,
  headRotation: { pitch: number; yaw: number; roll: number },
  fps: number,
  detectMs: number = 0,
  scores: string = "smile 0.00, mouth 0.00",
  topBlendshapes: string = "none",
) {
  if (debugExpressionEl) {
    debugExpressionEl.textContent = expressionLabel(expressionIndex);
  }
  if (debugHeadRotationEl) {
    debugHeadRotationEl.textContent = [
      Math.round(headRotation.pitch),
      Math.round(headRotation.yaw),
      Math.round(headRotation.roll),
    ].join(" / ");
  }
  if (debugTrackingFpsEl) debugTrackingFpsEl.textContent = String(Math.round(fps));
  if (debugDetectMsEl) {
    debugDetectMsEl.textContent = `${Math.round(detectMs)} ms`;
  }
  if (debugExpressionScoresEl) debugExpressionScoresEl.textContent = scores;
  if (debugTopBlendshapesEl) debugTopBlendshapesEl.textContent = topBlendshapes;
}

function formatExpressionScores(scores: {
  smile: number;
  mouthOpen: number;
  blinkLeft: number;
  blinkRight: number;
  anger: number;
  sorrow: number;
  surprise: number;
}) {
  return [
    `smile ${formatScore(scores.smile)}`,
    `mouth ${formatScore(scores.mouthOpen)}`,
    `blink ${formatScore(Math.max(scores.blinkLeft, scores.blinkRight))}`,
    `anger ${formatScore(scores.anger)}`,
    `sad ${formatScore(scores.sorrow)}`,
    `surprise ${formatScore(scores.surprise)}`,
  ].join(", ");
}

function formatTopBlendshapes(blendshapes: BlendshapeCategory[]) {
  const active = blendshapes
    .filter(({ score }) => score >= 0.05)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ categoryName, score }) => `${categoryName} ${formatScore(score)}`);

  return active.length > 0 ? active.join(", ") : "none";
}

function formatScore(score: number) {
  return score.toFixed(2);
}

function expressionLabel(expressionIndex: number) {
  const label = FFL_EXPRESSION_LABELS[expressionIndex as FFLExpression];
  return label ? `${expressionIndex} ${label}` : String(expressionIndex);
}

if (!viewerCanvas) {
  throw new Error("Missing #mii-viewer canvas");
}
const canvas = viewerCanvas;
const avatarScene = new AvatarScene(canvas, {
  onRenderFps: (fps) => {
    if (debugRenderFpsEl) debugRenderFpsEl.textContent = String(Math.round(fps));
  },
});
const faceTracker = new FaceTracker();
const expressionStabilizer = new ExpressionStabilizer(FFLExpression.Normal, 100);
const expressionSignalTracker = new ExpressionSignalTracker();
const headRotationSmoother = new HeadRotationSmoother(0.35);

window.addEventListener("resize", () => avatarScene.resize());
populateExpressionSelect();
resetAvatarTrackingState();
setTrackingButtons();
void refreshRendererHealth();
void refreshCameraList();

function populateExpressionSelect() {
  if (!expressionSelect) return;

  expressionSelect.textContent = "";
  for (const expression of Object.values(FFLExpression).filter(
    (value): value is FFLExpression => typeof value === "number",
  )) {
    const option = document.createElement("option");
    option.value = String(expression);
    option.textContent = expressionLabel(expression);
    expressionSelect.append(option);
  }

  expressionSelect.value = String(FFLExpression.Normal);
}

async function refreshCameraList() {
  if (!cameraSelect) return;

  try {
    const cameras = await faceTracker.listCameras();
    cameraSelect.textContent = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Default camera";
    cameraSelect.append(defaultOption);

    for (const camera of cameras) {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.textContent = camera.label;
      cameraSelect.append(option);
    }

    cameraSelect.disabled = cameras.length === 0;
    logRenderEvent("camera list refreshed", { count: cameras.length });
  } catch (error) {
    cameraSelect.disabled = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[MiiTuber] camera list refresh failed", { error, message });
  }
}

expressionSelect?.addEventListener("change", () => {
  const expressionIndex = Number(expressionSelect.value);
  avatarScene.setExpression(expressionIndex);
  logRenderEvent("manual expression selected", { expressionIndex });
});

debugMaterialsInput?.addEventListener("change", () => {
  avatarScene.setDebugMaterials(debugMaterialsInput.checked);
  logRenderEvent("debug materials toggled", {
    enabled: debugMaterialsInput.checked,
  });
});

transparentBackgroundInput?.addEventListener("change", () => {
  avatarScene.setTransparentBackground(transparentBackgroundInput.checked);
  logRenderEvent("transparent background toggled", {
    enabled: transparentBackgroundInput.checked,
  });
});

function handleTrackingFrame({ results, trackingFps, detectMs }: FaceTrackerFrame) {
  const blendshapes = results.faceBlendshapes?.[0]?.categories ?? [];
  const matrixData = results.facialTransformationMatrixes?.[0]?.data;
  const transformMatrix = matrixData ? new Float32Array(matrixData) : undefined;

  if (blendshapes.length === 0) {
    const headRotation = headRotationSmoother.update({ pitch: 0, yaw: 0, roll: 0 });
    avatarScene.setExpression(FFLExpression.Normal);
    avatarScene.setHeadRotation(headRotation);
    if (expressionSelect) expressionSelect.value = String(FFLExpression.Normal);
    setDebugValues(FFLExpression.Normal, headRotation, trackingFps, detectMs);
    setTrackingStatus("Tracking, but no face is currently detected.", "idle");
    return;
  }

  const rawMapped = mapToExpression(blendshapes, transformMatrix);
  const stabilizedSignals = expressionSignalTracker.update(rawMapped.scores);
  const mapped = mapToExpression(blendshapes, transformMatrix, stabilizedSignals);
  const expressionIndex = expressionStabilizer.update(
    mapped.expressionIndex,
    performance.now(),
  );
  const headRotation = headRotationSmoother.update(mapped.headRotation);

  avatarScene.setExpression(expressionIndex);
  avatarScene.setHeadRotation(headRotation);

  if (expressionSelect) expressionSelect.value = String(expressionIndex);
  setDebugValues(
    expressionIndex,
    headRotation,
    trackingFps,
    detectMs,
    formatExpressionScores(mapped.scores),
    formatTopBlendshapes(blendshapes),
  );

  setTrackingStatus(
    `Tracking face at ${Math.round(trackingFps)} fps. Expression ${expressionLabel(expressionIndex)}.`,
    "success",
  );
}

startTrackingButton?.addEventListener("click", async () => {
  if (!avatarLoaded) {
    setTrackingStatus("Render an avatar before starting webcam tracking.", "error");
    return;
  }

  if (!avatarHasExpressionVariants) {
    setTrackingStatus(
      "Render an avatar with expression variants before starting webcam tracking.",
      "error",
    );
    return;
  }

  try {
    tracking = true;
    setTrackingButtons();
    setTrackingStatus("Starting webcam tracking...");
    await faceTracker.start(
      {
        onFrame: handleTrackingFrame,
        onError: handleTrackingRuntimeError,
      },
      {
        deviceId: cameraSelect?.value || undefined,
        maxFps: 30,
      },
    );
    await refreshCameraList();
    setTrackingStatus("Webcam tracking started. Make a face.", "success");
  } catch (error) {
    tracking = false;
    setTrackingButtons();
    const message = formatTrackingError(error);
    console.error("[MiiTuber] face tracking failed to start", { error, message });
    setTrackingStatus(`Could not start webcam tracking: ${message}`, "error");
  }
});

function handleTrackingRuntimeError(error: unknown) {
  tracking = false;
  resetAvatarTrackingState();
  setTrackingButtons();
  const message = formatTrackingError(error);
  console.error("[MiiTuber] face tracking stopped after runtime error", {
    error,
    message,
  });
  setTrackingStatus(`Tracking stopped: ${message}`, "error");
}

function formatTrackingError(error: unknown) {
  if (!(error instanceof Error)) return String(error);

  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "camera permission was denied. Enable camera access for this app and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "no camera was found.";
    case "NotReadableError":
    case "TrackStartError":
      return "the selected camera is already in use or could not be started.";
    case "OverconstrainedError":
      return "the selected camera could not satisfy the requested 640x480 video settings.";
    case "SecurityError":
      return "camera access is blocked by the current security policy.";
    default:
      return error.message;
  }
}

stopTrackingButton?.addEventListener("click", () => {
  stopTracking("Tracking stopped. Camera released.");
});

function stopTracking(message?: string) {
  faceTracker.stop();
  tracking = false;
  resetAvatarTrackingState();
  setTrackingButtons();

  if (message) {
    setTrackingStatus(message);
  }
}

function resetAvatarTrackingState() {
  expressionSignalTracker.reset();
  headRotationSmoother.reset();
  avatarScene.setExpression(FFLExpression.Normal);
  avatarScene.setHeadRotation({ pitch: 0, yaw: 0, roll: 0 });
  if (expressionSelect) expressionSelect.value = "0";
  setDebugValues(FFLExpression.Normal, { pitch: 0, yaw: 0, roll: 0 }, 0);
}

fileInput?.addEventListener("change", () => {
  if (tracking) {
    stopTracking("Tracking stopped because the avatar file changed.");
  }

  selectedFile = fileInput.files?.[0] ?? null;
  avatarLoaded = false;
  avatarHasExpressionVariants = false;
  setTrackingButtons();

  if (!selectedFile) {
    logRenderEvent("file selection cleared");
    if (fileNameEl) fileNameEl.textContent = "No file selected";
    setRenderButtonDisabled(true);
    setStatus(
      "Choose a .ffsd or renderer-supported avatar data file. Current 128-byte .miic v4 files still need a converter.",
    );
    return;
  }

  logRenderEvent("file selected", {
    name: selectedFile.name,
    size: selectedFile.size,
    type: selectedFile.type || "(none)",
  });

  if (fileNameEl) fileNameEl.textContent = selectedFile.name;
  setRenderButtonDisabled(false);
  if (selectedFile.size === 128 && selectedFile.name.toLowerCase().endsWith(".miic")) {
    setStatus(
      "This looks like current .miic v4 data. Rendering needs a v4 converter or a .ffsd/Studio export.",
      "error",
    );
  } else {
    setStatus("Ready to render the 3D model.");
  }
});

renderButton?.addEventListener("click", async () => {
  if (!selectedFile) {
    setStatus("Choose an avatar data file first.", "error");
    return;
  }

  if (!validateFileExtension(selectedFile)) {
    setStatus(
      "Use a .ffsd, .miic, .bin, or .dat file for this import path.",
      "error",
    );
    console.warn("[MiiTuber] rejected file extension before render", {
      name: selectedFile.name,
    });
    return;
  }

  try {
    if (tracking) {
      stopTracking("Tracking stopped while reloading the avatar.");
    }

    setRenderButtonDisabled(true);
    void refreshRendererHealth();
    setStatus("Requesting GLB from the local FFL renderer...");

    const fileBuffer = await selectedFile.arrayBuffer();
    const miiBytes = Array.from(new Uint8Array(fileBuffer));
    logRenderEvent("invoking render_mii_glb", {
      name: selectedFile.name,
      byteLength: miiBytes.length,
    });

    const glbBytes = await invoke<number[]>("render_mii_glb", { miiBytes });
    const loadResult = await avatarScene.loadModelFromGlbBytes(glbBytes);

    if (expressionSelect) {
      expressionSelect.disabled = loadResult.expressionCount === 0;
      expressionSelect.value = "0";
    }
    avatarLoaded = true;
    avatarHasExpressionVariants = loadResult.expressionCount > 0;
    setTrackingButtons();

    logRenderEvent("render_mii_glb succeeded", {
      name: selectedFile.name,
      glbBytes: glbBytes.length,
      ...loadResult,
    });
    if (emptyPreviewEl) emptyPreviewEl.hidden = true;
    setStatus(
      loadResult.expressionCount > 0
        ? `Rendered GLB with ${loadResult.expressionCount} expression variants.`
        : "Rendered GLB, but no expression variants were found.",
      loadResult.expressionCount > 0 ? "success" : "idle",
    );
    setTrackingStatus(
      loadResult.expressionCount > 0
        ? "Ready to start webcam tracking."
        : "Tracking needs expression variants; this GLB can be inspected manually but cannot drive expressions.",
      loadResult.expressionCount > 0 ? "success" : "error",
    );
  } catch (error) {
    avatarLoaded = false;
    avatarHasExpressionVariants = false;
    setTrackingButtons();
    const message = error instanceof Error ? error.message : String(error);
    console.error("[MiiTuber] render_mii_glb failed", {
      name: selectedFile.name,
      size: selectedFile.size,
      error,
      message,
    });
    setStatus(message, "error");
  } finally {
    setRenderButtonDisabled(false);
  }
});

window.addEventListener("beforeunload", () => {
  faceTracker.stop();
});
