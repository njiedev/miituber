import { invoke } from "@tauri-apps/api/core";
import {
  averageBlendshapeSamples,
  ExpressionPipeline,
  resolveMouthOpenSource,
  type MouthOpenSource,
  zeroExpressionScores,
  zeroExpressionSignals,
} from "./lib/expressionPipeline";
import { FaceTracker, type FaceTrackerFrame } from "./lib/faceTracker";
import { LipSyncEnvelope, rootMeanSquare } from "./lib/lipSync";
import {
  OutputFrameLoop,
  type OutputFrameLoopStats,
  type OutputFrameMetadata,
} from "./lib/outputFrameLoop";
import { AvatarScene } from "./lib/scene";
import {
  FFL_EXPRESSION_LABELS,
  FFLExpression,
  type BlendshapeCategory,
  type ExpressionChannels,
  type ExpressionScores,
  type ExpressionSignals,
} from "./lib/types";
import {
  createDefaultTuningProfile,
  normalizeTuningProfile,
  parseTuningProfileJson,
  serializeTuningProfile,
  SIGNAL_NAMES,
  type SignalName,
  type TuningProfile,
} from "./lib/tuningProfile";

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
const backgroundColorInput =
  document.querySelector<HTMLInputElement>("#background-color");
const startTrackingButton = document.querySelector<HTMLButtonElement>(
  "#start-tracking-button",
);
const stopTrackingButton = document.querySelector<HTMLButtonElement>(
  "#stop-tracking-button",
);
const trackingStatusEl = document.querySelector<HTMLElement>("#tracking-status");
const cameraSelect = document.querySelector<HTMLSelectElement>("#camera-select");
const debugExpressionEl = document.querySelector<HTMLElement>("#debug-expression");
const debugChannelsEl = document.querySelector<HTMLElement>("#debug-channels");
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
const debugHoldMsEl = document.querySelector<HTMLElement>("#debug-hold-ms");
const debugHoldMeterEl = document.querySelector<HTMLElement>("#debug-hold-meter");
const debugBlendshapeCountEl = document.querySelector<HTMLElement>(
  "#debug-blendshape-count",
);
const debugBlendshapeBarsEl = document.querySelector<HTMLElement>(
  "#debug-blendshape-bars",
);
const calibrationStatusEl = document.querySelector<HTMLElement>(
  "#calibration-status",
);
const calibrateButton = document.querySelector<HTMLButtonElement>("#calibrate-button");
const saveProfileButton =
  document.querySelector<HTMLButtonElement>("#save-profile-button");
const loadProfileInput =
  document.querySelector<HTMLInputElement>("#load-profile-input");
const signalTuningControlsEl = document.querySelector<HTMLElement>(
  "#signal-tuning-controls",
);
const oneEuroMinCutoffInput = document.querySelector<HTMLInputElement>(
  "#one-euro-min-cutoff",
);
const oneEuroBetaInput = document.querySelector<HTMLInputElement>("#one-euro-beta");
const oneEuroDerivativeCutoffInput = document.querySelector<HTMLInputElement>(
  "#one-euro-derivative-cutoff",
);
const minimumHoldMsInput =
  document.querySelector<HTMLInputElement>("#minimum-hold-ms");
const lipSyncNoiseFloorInput =
  document.querySelector<HTMLInputElement>("#lip-sync-noise-floor");
const lipSyncSpeakingLevelInput = document.querySelector<HTMLInputElement>(
  "#lip-sync-speaking-level",
);
const lipSyncSmoothingInput =
  document.querySelector<HTMLInputElement>("#lip-sync-smoothing");
const outputResolutionSelect = document.querySelector<HTMLSelectElement>(
  "#output-resolution-select",
);
const outputFpsSelect =
  document.querySelector<HTMLSelectElement>("#output-fps-select");
const startOutputButton =
  document.querySelector<HTMLButtonElement>("#start-output-button");
const toggleCleanOutputButton = document.querySelector<HTMLButtonElement>(
  "#toggle-clean-output-button",
);
const stopOutputButton =
  document.querySelector<HTMLButtonElement>("#stop-output-button");
const outputStatusEl = document.querySelector<HTMLElement>("#output-status");
const debugOutputTargetEl =
  document.querySelector<HTMLElement>("#debug-output-target");
const debugOutputFpsEl = document.querySelector<HTMLElement>("#debug-output-fps");
const debugOutputFramesEl =
  document.querySelector<HTMLElement>("#debug-output-frames");
const debugOutputDroppedEl =
  document.querySelector<HTMLElement>("#debug-output-dropped");
const debugOutputUrlEl = document.querySelector<HTMLElement>("#debug-output-url");
const debugOutputTransparentUrlEl = document.querySelector<HTMLElement>(
  "#debug-output-transparent-url",
);
const copyOutputUrlButton = document.querySelector<HTMLButtonElement>(
  "#copy-output-url-button",
);
const copyTransparentOutputUrlButton = document.querySelector<HTMLButtonElement>(
  "#copy-transparent-output-url-button",
);
const debugOutputObsEl = document.querySelector<HTMLElement>("#debug-output-obs");
const debugNativeCameraEl = document.querySelector<HTMLElement>(
  "#debug-native-camera",
);
const debugOutputProbeEl =
  document.querySelector<HTMLElement>("#debug-output-probe");
const microphoneSelect =
  document.querySelector<HTMLSelectElement>("#microphone-select");
const mouthSourceSelect =
  document.querySelector<HTMLSelectElement>("#mouth-source-select");
const startLipSyncButton =
  document.querySelector<HTMLButtonElement>("#start-lip-sync-button");
const calibrateLipSyncButton = document.querySelector<HTMLButtonElement>(
  "#calibrate-lip-sync-button",
);
const stopLipSyncButton =
  document.querySelector<HTMLButtonElement>("#stop-lip-sync-button");
const lipSyncStatusEl = document.querySelector<HTMLElement>("#lip-sync-status");
const debugLipSyncMouthEl = document.querySelector<HTMLElement>(
  "#debug-lip-sync-mouth",
);

let selectedFile: File | null = null;
let avatarLoaded = false;
let avatarHasExpressionVariants = false;
let tracking = false;
let tuningProfile = createDefaultTuningProfile();
let calibrationSession: CalibrationSession | null = null;
let latestExpressionScores: ExpressionScores = zeroExpressionScores();
let latestExpressionSignals: ExpressionSignals = zeroExpressionSignals();
let outputFrameLoop: OutputFrameLoop | null = null;
let currentOutputStatus: VirtualCameraStatus | null = null;
let currentOutputUrl: string | null = null;
let currentTransparentOutputUrl: string | null = null;
let outputFrameProbePending = false;
let outputFrameProbeUrl: string | null = null;
let cleanOutputMode = false;
let lipSyncContext: AudioContext | null = null;
let lipSyncStream: MediaStream | null = null;
let lipSyncAnimationId: number | null = null;
let lipSyncMouthScore = 0;
let lipSyncRawRms = 0;
let lipSyncCalibrationSession: LipSyncCalibrationSession | null = null;
let microphoneAvailable = true;
const lipSyncEnvelope = new LipSyncEnvelope();

type CalibrationSession = {
  startedAt: number;
  samples: BlendshapeCategory[][];
};

type LipSyncCalibrationSession = {
  startedAt: number;
  rmsSamples: number[];
};

type RendererStatus = {
  reachable: boolean;
  message: string;
};

type VirtualCameraStatus = {
  running: boolean;
  supported: boolean;
  obsDetected: boolean;
  message: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  lastFrameBytes: number;
  frameUrl: string;
  pngFrameUrl: string;
  mjpegUrl: string;
  transparentSourceUrl: string;
};

type NativeCameraStatus = {
  platformSupported: boolean;
  deviceInstalled: boolean;
  deviceName: string;
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

function setCalibrationStatus(
  message: string,
  tone: "idle" | "error" | "success" = "idle",
) {
  if (!calibrationStatusEl) return;

  calibrationStatusEl.textContent = message;
  calibrationStatusEl.dataset.tone = tone;
}

function setOutputStatus(
  message: string,
  tone: "idle" | "error" | "success" = "idle",
) {
  if (!outputStatusEl) return;

  outputStatusEl.textContent = message;
  outputStatusEl.dataset.tone = tone;
}

function setLipSyncStatus(
  message: string,
  tone: "idle" | "error" | "success" = "idle",
) {
  if (!lipSyncStatusEl) return;

  lipSyncStatusEl.textContent = message;
  lipSyncStatusEl.dataset.tone = tone;
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

async function refreshNativeCameraStatus() {
  try {
    const status = await invoke<NativeCameraStatus>("get_native_camera_status");
    setNativeCameraStatus(status);
    logRenderEvent("native camera status checked", status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setNativeCameraStatus(null, `Could not check native camera: ${message}`);
    console.error("[MiiTuber] get_native_camera_status failed", { error, message });
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

function setOutputButtons() {
  const outputRunning = outputFrameLoop?.isRunning() ?? false;
  if (toggleCleanOutputButton) {
    toggleCleanOutputButton.disabled = !avatarLoaded;
    toggleCleanOutputButton.textContent = cleanOutputMode
      ? "Close OBS Clean View"
      : "Open OBS Clean View";
  }
  if (startOutputButton) startOutputButton.disabled = !avatarLoaded || outputRunning;
  if (stopOutputButton) stopOutputButton.disabled = !outputRunning;
  if (outputResolutionSelect) outputResolutionSelect.disabled = outputRunning;
  if (outputFpsSelect) outputFpsSelect.disabled = outputRunning;
}

function setLipSyncButtons(running = lipSyncContext !== null) {
  if (startLipSyncButton) startLipSyncButton.disabled = running || !microphoneAvailable;
  if (calibrateLipSyncButton) calibrateLipSyncButton.disabled = !running;
  if (stopLipSyncButton) stopLipSyncButton.disabled = !running;
  if (microphoneSelect) microphoneSelect.disabled = running;
}

function setDebugValues(
  expressionIndex: number,
  channels: string,
  holdMs: number,
  headRotation: { pitch: number; yaw: number; roll: number },
  fps: number,
  detectMs: number = 0,
  scores: string = "smile 0.00, mouth 0.00",
  topBlendshapes: string = "none",
) {
  if (debugExpressionEl) {
    debugExpressionEl.textContent = expressionLabel(expressionIndex);
  }
  if (debugChannelsEl) debugChannelsEl.textContent = channels;
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
  if (debugHoldMsEl) debugHoldMsEl.textContent = `${Math.round(holdMs)} ms`;
  if (debugHoldMeterEl) {
    const holdTotal = Math.max(1, tuningProfile.minimumHoldMs);
    debugHoldMeterEl.style.setProperty(
      "--hold-progress",
      String(clamp01(1 - holdMs / holdTotal) * 100),
    );
  }
}

function setOutputDebugValues(stats: OutputFrameLoopStats | null = null) {
  const settings = getOutputSettings();
  if (debugOutputTargetEl) {
    debugOutputTargetEl.textContent = `${settings.width} x ${settings.height} @ ${settings.fps}`;
  }
  if (debugOutputFpsEl) {
    debugOutputFpsEl.textContent = stats ? stats.actualFps.toFixed(1) : "0";
  }
  if (debugOutputFramesEl) {
    debugOutputFramesEl.textContent = stats ? String(stats.frameCount) : "0";
  }
  if (debugOutputDroppedEl) {
    debugOutputDroppedEl.textContent = stats ? String(stats.droppedFrames) : "0";
  }
}

function setOutputUrl(url: string | null) {
  currentOutputUrl = url;
  if (debugOutputUrlEl) {
    debugOutputUrlEl.textContent = url ?? "Start output to publish stream.";
  }
  if (copyOutputUrlButton) copyOutputUrlButton.disabled = !url;
}

function setTransparentOutputUrl(url: string | null) {
  currentTransparentOutputUrl = url;
  if (debugOutputTransparentUrlEl) {
    debugOutputTransparentUrlEl.textContent =
      url ?? "Enable transparent output, then start output.";
  }
  if (copyTransparentOutputUrlButton) {
    copyTransparentOutputUrlButton.disabled = !url;
  }
}

function setOutputObsDetected(detected: boolean | null) {
  if (!debugOutputObsEl) return;
  debugOutputObsEl.textContent =
    detected === null ? "Not checked." : detected ? "Yes" : "No";
}

function setNativeCameraStatus(status: NativeCameraStatus | null, error?: string) {
  if (!debugNativeCameraEl) return;

  if (error) {
    debugNativeCameraEl.textContent = error;
    return;
  }

  if (!status) {
    debugNativeCameraEl.textContent = "Not checked.";
    return;
  }

  if (status.deviceInstalled) {
    debugNativeCameraEl.textContent = `${status.deviceName} installed.`;
    return;
  }

  debugNativeCameraEl.textContent = status.platformSupported
    ? `${status.deviceName} not installed yet.`
    : "Windows-first native camera planned.";
}

function setOutputProbe(message: string) {
  if (debugOutputProbeEl) debugOutputProbeEl.textContent = message;
}

function setLipSyncDebugValue(score: number) {
  if (debugLipSyncMouthEl) debugLipSyncMouthEl.textContent = score.toFixed(2);
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

function renderBlendshapeBars(
  rawBlendshapes: BlendshapeCategory[],
  smoothedBlendshapes: BlendshapeCategory[] = rawBlendshapes,
) {
  if (debugBlendshapeCountEl) {
    debugBlendshapeCountEl.textContent = `${rawBlendshapes.length} / 52`;
  }

  if (!debugBlendshapeBarsEl) return;

  if (rawBlendshapes.length === 0) {
    debugBlendshapeBarsEl.textContent =
      "Start tracking to inspect raw vs smoothed MediaPipe face sliders.";
    return;
  }

  const smoothedScores = new Map(
    smoothedBlendshapes.map(({ categoryName, score }) => [categoryName, score]),
  );
  const fragment = document.createDocumentFragment();
  for (const { categoryName, score } of rawBlendshapes) {
    const smoothedScore = smoothedScores.get(categoryName) ?? score;
    const row = document.createElement("div");
    row.className = "blendshape-row";

    const name = document.createElement("span");
    name.className = "blendshape-name";
    name.title = categoryName;
    name.textContent = categoryName;

    const value = document.createElement("span");
    value.className = "blendshape-score";
    value.textContent = `${formatScore(score)} / ${formatScore(smoothedScore)}`;

    const rawMeter = document.createElement("div");
    rawMeter.className = "blendshape-meter";
    rawMeter.style.setProperty("--raw-score", String(clamp01(score)));
    rawMeter.append(document.createElement("span"));

    const smoothedMeter = document.createElement("div");
    smoothedMeter.className = "blendshape-meter blendshape-meter--smoothed";
    smoothedMeter.style.setProperty("--smoothed-score", String(clamp01(smoothedScore)));
    smoothedMeter.append(document.createElement("span"));

    row.append(name, value, rawMeter, smoothedMeter);
    fragment.append(row);
  }

  debugBlendshapeBarsEl.replaceChildren(fragment);
}

function expressionLabel(expressionIndex: number) {
  const label = FFL_EXPRESSION_LABELS[expressionIndex as FFLExpression];
  return label ? `${expressionIndex} ${label}` : String(expressionIndex);
}

function formatChannels(channels: ExpressionChannels) {
  return `eyes ${channels.eyes}, mouth ${channels.mouth}, emotion ${channels.emotion}`;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
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
const expressionPipeline = new ExpressionPipeline(tuningProfile);

window.addEventListener("resize", () => avatarScene.resize());
populateExpressionSelect();
populateTuningControls();
updateAvatarBackground();
resetAvatarTrackingState();
setTrackingButtons();
setOutputButtons();
setOutputDebugValues();
setLipSyncButtons();
setLipSyncDebugValue(0);
void refreshRendererHealth();
void refreshNativeCameraStatus();
void refreshCameraList();
void refreshMicrophoneList();

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

async function refreshMicrophoneList() {
  if (!microphoneSelect) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter(({ kind }) => kind === "audioinput");
    microphoneSelect.textContent = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Default microphone";
    microphoneSelect.append(defaultOption);

    let microphoneNumber = 1;
    for (const microphone of microphones) {
      const option = document.createElement("option");
      option.value = microphone.deviceId;
      option.textContent = microphone.label || `Microphone ${microphoneNumber++}`;
      microphoneSelect.append(option);
    }

    microphoneAvailable = microphones.length > 0;
    microphoneSelect.disabled = microphones.length === 0 || lipSyncContext !== null;
    setLipSyncButtons();
    if (microphones.length === 0) {
      setLipSyncStatus(
        "No microphone was found. Camera jaw tracking is still available.",
        "idle",
      );
    }
    logRenderEvent("microphone list refreshed", { count: microphones.length });
  } catch (error) {
    microphoneAvailable = false;
    setLipSyncButtons();
    microphoneSelect.disabled = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[MiiTuber] microphone list refresh failed", { error, message });
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
  updateAvatarBackground();
  updateOutputTransparencyUi();
  logRenderEvent("transparent background toggled", {
    enabled: transparentBackgroundInput.checked,
  });
});

backgroundColorInput?.addEventListener("input", () => {
  updateAvatarBackground();
  logRenderEvent("background color changed", {
    color: backgroundColorInput.value,
  });
});

outputResolutionSelect?.addEventListener("change", () => setOutputDebugValues());
outputFpsSelect?.addEventListener("change", () => setOutputDebugValues());

copyOutputUrlButton?.addEventListener("click", () => {
  void copyOutputUrl(currentOutputUrl, "Opaque OBS URL");
});

copyTransparentOutputUrlButton?.addEventListener("click", () => {
  void copyOutputUrl(currentTransparentOutputUrl, "Transparent OBS URL");
});

toggleCleanOutputButton?.addEventListener("click", () => {
  setCleanOutputMode(!cleanOutputMode);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cleanOutputMode) {
    setCleanOutputMode(false);
  }
});

startLipSyncButton?.addEventListener("click", async () => {
  try {
    await startLipSync();
  } catch (error) {
    stopLipSync();
    const message = formatMicrophoneError(error);
    console.error("[MiiTuber] lip-sync failed to start", { error, message });
    setLipSyncStatus(
      `Could not start mic lip-sync: ${message} Camera jaw tracking is still available.`,
      "error",
    );
  }
});

stopLipSyncButton?.addEventListener("click", () => {
  stopLipSync("Mic lip-sync stopped. Camera jaw tracking is still available.");
});

calibrateLipSyncButton?.addEventListener("click", () => {
  if (!lipSyncContext) {
    setLipSyncStatus("Start mic lip-sync first, then stay quiet for calibration.", "error");
    return;
  }

  lipSyncCalibrationSession = { startedAt: performance.now(), rmsSamples: [] };
  setLipSyncStatus("Calibrating silence... stay quiet for 1 second.");
});

calibrateButton?.addEventListener("click", () => {
  if (!tracking) {
    setCalibrationStatus("Start tracking first, then hold a neutral face.", "error");
    return;
  }

  calibrationSession = { startedAt: performance.now(), samples: [] };
  setCalibrationStatus("Calibrating neutral face... hold still for 2 seconds.");
});

saveProfileButton?.addEventListener("click", () => {
  const json = serializeTuningProfile(tuningProfile);
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "miituber-tuning-profile.json";
  link.click();
  URL.revokeObjectURL(url);
  setCalibrationStatus("Saved tuning profile JSON.", "success");
});

loadProfileInput?.addEventListener("change", async () => {
  const file = loadProfileInput.files?.[0];
  if (!file) return;

  try {
    applyTuningProfile(parseTuningProfileJson(await file.text()));
    setCalibrationStatus(`Loaded tuning profile from ${file.name}.`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setCalibrationStatus(`Could not load profile: ${message}`, "error");
  } finally {
    loadProfileInput.value = "";
  }
});

function populateTuningControls() {
  if (signalTuningControlsEl) {
    signalTuningControlsEl.textContent = "";
    for (const signalName of SIGNAL_NAMES) {
      signalTuningControlsEl.append(createSignalTuningRow(signalName));
    }
  }

  oneEuroMinCutoffInput?.addEventListener("change", () => {
    tuningProfile.oneEuro.minCutoff = positiveInputValue(
      oneEuroMinCutoffInput,
      tuningProfile.oneEuro.minCutoff,
    );
    applyTuningProfile(tuningProfile);
  });
  oneEuroBetaInput?.addEventListener("change", () => {
    tuningProfile.oneEuro.beta = nonNegativeInputValue(
      oneEuroBetaInput,
      tuningProfile.oneEuro.beta,
    );
    applyTuningProfile(tuningProfile);
  });
  oneEuroDerivativeCutoffInput?.addEventListener("change", () => {
    tuningProfile.oneEuro.derivativeCutoff = positiveInputValue(
      oneEuroDerivativeCutoffInput,
      tuningProfile.oneEuro.derivativeCutoff,
    );
    applyTuningProfile(tuningProfile);
  });
  minimumHoldMsInput?.addEventListener("change", () => {
    tuningProfile.minimumHoldMs = nonNegativeInputValue(
      minimumHoldMsInput,
      tuningProfile.minimumHoldMs,
    );
    applyTuningProfile(tuningProfile);
  });
  lipSyncNoiseFloorInput?.addEventListener("change", () => {
    tuningProfile.lipSync.noiseFloor = clampNumber(
      lipSyncNoiseFloorInput.valueAsNumber,
      0,
      0.5,
    );
    if (tuningProfile.lipSync.speakingLevel <= tuningProfile.lipSync.noiseFloor) {
      tuningProfile.lipSync.speakingLevel = tuningProfile.lipSync.noiseFloor + 0.001;
    }
    applyTuningProfile(tuningProfile);
  });
  lipSyncSpeakingLevelInput?.addEventListener("change", () => {
    tuningProfile.lipSync.speakingLevel = clampNumber(
      Math.max(
        lipSyncSpeakingLevelInput.valueAsNumber,
        tuningProfile.lipSync.noiseFloor + 0.001,
      ),
      0.001,
      1,
    );
    applyTuningProfile(tuningProfile);
  });
  lipSyncSmoothingInput?.addEventListener("change", () => {
    tuningProfile.lipSync.smoothing = clampNumber(
      lipSyncSmoothingInput.valueAsNumber,
      0,
      1,
    );
    applyTuningProfile(tuningProfile);
  });

  renderTuningControls();
}

function createSignalTuningRow(signalName: SignalName) {
  const row = document.createElement("div");
  row.className = "signal-tuning-row";
  row.dataset.signalRow = signalName;

  const label = document.createElement("strong");
  label.textContent = signalTuningLabel(signalName);

  const state = document.createElement("span");
  state.className = "signal-state";
  state.dataset.signalState = signalName;
  state.textContent = "off";

  const header = document.createElement("div");
  header.className = "signal-tuning-row__header";
  header.append(label, state);

  const rail = document.createElement("div");
  rail.className = "threshold-rail";
  rail.dataset.thresholdRail = signalName;
  rail.innerHTML = '<span class="threshold-band"></span><span class="threshold-marker threshold-marker--exit"></span><span class="threshold-marker threshold-marker--enter"></span><span class="threshold-score"></span>';

  row.append(
    header,
    rail,
    createSignalRangeInput(signalName, "enter", "Enter"),
    createSignalRangeInput(signalName, "exit", "Exit"),
    createSignalRangeInput(signalName, "gain", "Gain"),
  );

  return row;
}

function signalTuningLabel(signalName: SignalName) {
  if (signalName === "mouthOpen") {
    return "mouthOpen (camera/mic)";
  }

  return signalName;
}

function createSignalRangeInput(
  signalName: SignalName,
  field: "enter" | "exit" | "gain",
  labelText: string,
) {
  const label = document.createElement("label");
  label.textContent = labelText;

  const input = document.createElement("input");
  input.type = "range";
  input.step = "0.01";
  input.min = "0";
  input.max = field === "gain" ? "3" : "1";
  input.dataset.signal = signalName;
  input.dataset.field = field;
  input.addEventListener("change", () => {
    if (field === "gain") {
      tuningProfile.gains[signalName] = clampNumber(input.valueAsNumber, 0, 3);
    } else {
      tuningProfile.thresholds[signalName][field] = clampNumber(
        input.valueAsNumber,
        0,
        1,
      );
      if (
        tuningProfile.thresholds[signalName].exit >
        tuningProfile.thresholds[signalName].enter
      ) {
        tuningProfile.thresholds[signalName].exit =
          tuningProfile.thresholds[signalName].enter;
      }
    }
    applyTuningProfile(tuningProfile);
  });

  label.append(input);
  const value = document.createElement("span");
  value.className = "signal-control-value";
  value.dataset.signalValue = `${signalName}:${field}`;
  label.append(value);
  return label;
}

function applyTuningProfile(profile: TuningProfile) {
  tuningProfile = normalizeTuningProfile(profile);
  expressionPipeline.updateProfile(tuningProfile);
  lipSyncEnvelope.updateOptions(tuningProfile.lipSync);
  renderTuningControls();
}

function renderTuningControls() {
  if (oneEuroMinCutoffInput) {
    oneEuroMinCutoffInput.value = String(tuningProfile.oneEuro.minCutoff);
  }
  if (oneEuroBetaInput) oneEuroBetaInput.value = String(tuningProfile.oneEuro.beta);
  if (oneEuroDerivativeCutoffInput) {
    oneEuroDerivativeCutoffInput.value = String(
      tuningProfile.oneEuro.derivativeCutoff,
    );
  }
  if (minimumHoldMsInput) {
    minimumHoldMsInput.value = String(tuningProfile.minimumHoldMs);
  }
  if (lipSyncNoiseFloorInput) {
    lipSyncNoiseFloorInput.value = String(tuningProfile.lipSync.noiseFloor);
  }
  if (lipSyncSpeakingLevelInput) {
    lipSyncSpeakingLevelInput.value = String(tuningProfile.lipSync.speakingLevel);
  }
  if (lipSyncSmoothingInput) {
    lipSyncSmoothingInput.value = String(tuningProfile.lipSync.smoothing);
  }

  signalTuningControlsEl
    ?.querySelectorAll<HTMLInputElement>("input[data-signal][data-field]")
    .forEach((input) => {
      const signalName = input.dataset.signal as SignalName;
      const field = input.dataset.field;
      if (field === "gain") {
        input.value = String(tuningProfile.gains[signalName]);
      } else if (field === "enter" || field === "exit") {
        input.value = String(tuningProfile.thresholds[signalName][field]);
      }
    });
  renderSignalDebugState(latestExpressionScores, latestExpressionSignals);
}

function handleTrackingFrame({ results, trackingFps, detectMs }: FaceTrackerFrame) {
  const blendshapes = results.faceBlendshapes?.[0]?.categories ?? [];
  const matrixData = results.facialTransformationMatrixes?.[0]?.data;
  const transformMatrix = matrixData ? new Float32Array(matrixData) : undefined;

  if (blendshapes.length === 0) {
    avatarScene.setExpression(FFLExpression.Normal);
    avatarScene.setHeadRotation({ pitch: 0, yaw: 0, roll: 0 });
    if (expressionSelect) expressionSelect.value = String(FFLExpression.Normal);
    setDebugValues(
      FFLExpression.Normal,
      formatChannels({ eyes: "open", mouth: "closed", emotion: "normal" }),
      0,
      { pitch: 0, yaw: 0, roll: 0 },
      trackingFps,
      detectMs,
    );
    renderBlendshapeBars([]);
    setTrackingStatus("Tracking, but no face is currently detected.", "idle");
    return;
  }

  const now = performance.now();
  updateCalibrationSession(blendshapes, now);
  const pipelineFrame = expressionPipeline.processFrame(
    blendshapes,
    transformMatrix,
    now,
    getExternalMouthOpenScore(),
    getMouthOpenSource(),
  );
  latestExpressionScores = pipelineFrame.rawMapped.scores;
  latestExpressionSignals = pipelineFrame.signals;

  avatarScene.setExpression(pipelineFrame.expressionIndex);
  avatarScene.setHeadRotation(pipelineFrame.headRotation);

  if (expressionSelect) expressionSelect.value = String(pipelineFrame.expressionIndex);
  setDebugValues(
    pipelineFrame.expressionIndex,
    formatChannels(pipelineFrame.mapped.channels),
    pipelineFrame.remainingHoldMs,
    pipelineFrame.headRotation,
    trackingFps,
    detectMs,
    formatExpressionScores(pipelineFrame.mapped.scores),
    formatTopBlendshapes(blendshapes),
  );
  renderSignalDebugState(pipelineFrame.rawMapped.scores, pipelineFrame.signals);
  renderBlendshapeBars(blendshapes, pipelineFrame.smoothedBlendshapes);

  setTrackingStatus(
    `Tracking face at ${Math.round(trackingFps)} fps. Expression ${expressionLabel(pipelineFrame.expressionIndex)}.`,
    "success",
  );
}

async function startLipSync() {
  if (lipSyncContext) return;

  setLipSyncStatus("Starting microphone...");
  const selectedMicrophoneId = microphoneSelect?.value || undefined;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: selectedMicrophoneId ? { exact: selectedMicrophoneId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  lipSyncContext = context;
  lipSyncStream = stream;
  lipSyncEnvelope.updateOptions(tuningProfile.lipSync);
  lipSyncEnvelope.reset();

  const update = () => {
    analyser.getFloatTimeDomainData(samples);
    lipSyncRawRms = rootMeanSquare(samples);
    updateLipSyncCalibrationSession(lipSyncRawRms, performance.now());
    lipSyncMouthScore = lipSyncEnvelope.update(samples);
    setLipSyncDebugValue(lipSyncMouthScore);
    lipSyncAnimationId = requestAnimationFrame(update);
  };
  update();

  setLipSyncButtons(true);
  void refreshMicrophoneList();
  setLipSyncStatus("Mic lip-sync running. Mouth source controls how it blends.", "success");
}

function stopLipSync(message?: string) {
  if (lipSyncAnimationId !== null) {
    cancelAnimationFrame(lipSyncAnimationId);
    lipSyncAnimationId = null;
  }

  lipSyncStream?.getTracks().forEach((track) => track.stop());
  lipSyncStream = null;
  void lipSyncContext?.close();
  lipSyncContext = null;
  lipSyncMouthScore = 0;
  lipSyncRawRms = 0;
  lipSyncCalibrationSession = null;
  lipSyncEnvelope.reset();
  setLipSyncButtons(false);
  setLipSyncDebugValue(0);
  void refreshMicrophoneList();

  if (message) setLipSyncStatus(message);
}

function updateLipSyncCalibrationSession(rms: number, now: number) {
  if (!lipSyncCalibrationSession) return;

  lipSyncCalibrationSession.rmsSamples.push(rms);
  const elapsedMs = now - lipSyncCalibrationSession.startedAt;
  setLipSyncStatus(
    `Calibrating silence... ${Math.max(0, 1 - elapsedMs / 1000).toFixed(1)}s left.`,
  );

  if (elapsedMs < 1000) return;

  const averageRms =
    lipSyncCalibrationSession.rmsSamples.reduce((sum, sample) => sum + sample, 0) /
    Math.max(1, lipSyncCalibrationSession.rmsSamples.length);
  const noiseFloor = clampNumber(averageRms + 0.005, 0, 0.5);
  tuningProfile.lipSync.noiseFloor = noiseFloor;
  tuningProfile.lipSync.speakingLevel = Math.max(
    tuningProfile.lipSync.speakingLevel,
    noiseFloor + 0.08,
  );
  lipSyncCalibrationSession = null;
  applyTuningProfile(tuningProfile);
  setLipSyncStatus(
    `Calibrated silence floor at ${noiseFloor.toFixed(3)} RMS. Current mic RMS is ${lipSyncRawRms.toFixed(3)}.`,
    "success",
  );
}

function getExternalMouthOpenScore() {
  return getMouthOpenSource() === "camera" ? 0 : lipSyncMouthScore;
}

function getMouthOpenSource(): MouthOpenSource {
  return resolveMouthOpenSource(mouthSourceSelect?.value, lipSyncContext !== null);
}

function formatMicrophoneError(error: unknown) {
  if (!(error instanceof Error)) return String(error);

  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "microphone permission was denied. Enable microphone access and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "no microphone was found.";
    case "NotReadableError":
    case "TrackStartError":
      return "the selected microphone is already in use or could not be started.";
    case "SecurityError":
      return "microphone access is blocked by the current security policy.";
    default:
      return error.message;
  }
}

function updateCalibrationSession(blendshapes: BlendshapeCategory[], now: number) {
  if (!calibrationSession) return;

  calibrationSession.samples.push(blendshapes);
  const elapsedMs = now - calibrationSession.startedAt;
  setCalibrationStatus(
    `Calibrating neutral face... ${Math.max(0, 2 - elapsedMs / 1000).toFixed(1)}s left.`,
  );

  if (elapsedMs < 2000) return;

  tuningProfile.calibration = averageBlendshapeSamples(calibrationSession.samples);
  calibrationSession = null;
  applyTuningProfile(tuningProfile);
  setCalibrationStatus(
    `Captured neutral baseline for ${Object.keys(tuningProfile.calibration).length} blendshapes.`,
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

startOutputButton?.addEventListener("click", async () => {
  if (!avatarLoaded) {
    setOutputStatus("Render an avatar before starting output.", "error");
    return;
  }

  const settings = getOutputSettings();

  try {
    setOutputStatus("Starting output session in Rust...");
    const status = await invoke<VirtualCameraStatus>("start_virtual_camera", {
      request: settings,
    });

    outputFrameLoop = new OutputFrameLoop({
      ...settings,
      captureFrame: (width, height) => avatarScene.captureJpegFrame(width, height),
      publishFrame,
      onStats: setOutputDebugValues,
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[MiiTuber] output loop failed", { error, message });
        currentOutputStatus = null;
        setTransparentOutputUrl(null);
        setOutputStatus(`Output stopped: ${message}`, "error");
        setOutputButtons();
      },
    });
    outputFrameLoop.start();
    currentOutputStatus = status;
    outputFrameProbePending = true;
    outputFrameProbeUrl = status.frameUrl;
    setOutputButtons();
    setOutputStatus(
      outputStatusMessage(status),
      status.obsDetected ? "success" : "idle",
    );
    setOutputUrl(status.mjpegUrl);
    setTransparentOutputUrl(
      transparentBackgroundInput?.checked ? status.transparentSourceUrl : null,
    );
    setOutputObsDetected(status.obsDetected);
    logRenderEvent("virtual camera output started", settings);
  } catch (error) {
    outputFrameLoop = null;
    currentOutputStatus = null;
    setOutputButtons();
    const message = error instanceof Error ? error.message : String(error);
    console.error("[MiiTuber] virtual camera start failed", { error, message });
    setOutputStatus(`Could not start output: ${message}`, "error");
  }
});

stopOutputButton?.addEventListener("click", () => {
  void stopOutput("Output stopped.");
});

async function stopOutput(message?: string) {
  outputFrameLoop?.stop();
  outputFrameLoop = null;
  currentOutputStatus = null;
  outputFrameProbePending = false;
  outputFrameProbeUrl = null;
  setOutputButtons();
  setOutputDebugValues();
  setOutputUrl(null);
  setTransparentOutputUrl(null);
  setOutputObsDetected(null);
  setOutputProbe("Not checked.");

  try {
    await invoke<VirtualCameraStatus>("stop_virtual_camera");
  } catch (error) {
    console.warn("[MiiTuber] virtual camera stop failed", { error });
  }

  if (message) setOutputStatus(message);
}

async function publishFrame(
  frame: Uint8Array,
  metadata: OutputFrameMetadata,
) {
  const pngFrame = transparentBackgroundInput?.checked
    ? await avatarScene.capturePngFrame(metadata.width, metadata.height)
    : null;

  await invoke<VirtualCameraStatus>("publish_virtual_camera_frame", {
    request: {
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      frameIndex: metadata.frameIndex,
      jpegBytes: Array.from(frame),
      pngBytes: pngFrame ? Array.from(pngFrame) : null,
    },
  });

  if (outputFrameProbePending && outputFrameProbeUrl) {
    outputFrameProbePending = false;
    void probeOutputFrame(outputFrameProbeUrl);
  }
}

async function probeOutputFrame(url: string) {
  if (outputFrameProbeUrl !== url) return;

  setOutputProbe("Checking local JPEG endpoint...");

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (outputFrameProbeUrl !== url) return;

    if (!response.ok) {
      setOutputProbe(`HTTP ${response.status} from local frame endpoint.`);
      return;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (outputFrameProbeUrl !== url) return;

    const isJpeg =
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;

    if (!contentType.includes("image/jpeg") || !isJpeg) {
      setOutputProbe("Endpoint responded, but not with a JPEG frame.");
      return;
    }

    setOutputProbe(`OK, served ${(bytes.length / 1024).toFixed(1)} KB JPEG.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setOutputProbe(`Could not fetch local frame: ${message}`);
  }
}

async function copyOutputUrl(url: string | null, label: string) {
  if (!url) {
    setOutputStatus(`${label} is not available yet. Start output first.`, "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    setOutputStatus(`Copied ${label}.`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[MiiTuber] output URL copy failed", { error, message });
    setOutputStatus(`Could not copy ${label}: ${message}`, "error");
  }
}

function outputStatusMessage(status: VirtualCameraStatus) {
  if (transparentBackgroundInput?.checked) {
    return `${status.message} For transparent OBS compositing, use Browser Source: ${status.transparentSourceUrl}`;
  }

  return status.message;
}

function updateOutputTransparencyUi() {
  if (!currentOutputStatus) return;

  setTransparentOutputUrl(
    transparentBackgroundInput?.checked
      ? currentOutputStatus.transparentSourceUrl
      : null,
  );
  setOutputStatus(
    outputStatusMessage(currentOutputStatus),
    currentOutputStatus.obsDetected ? "success" : "idle",
  );
}

function getOutputSettings() {
  const resolution = outputResolutionSelect?.value ?? "1280x720";
  const [widthValue, heightValue] = resolution.split("x").map(Number);
  const fps = Number(outputFpsSelect?.value ?? "30");

  return {
    width: Number.isFinite(widthValue) ? widthValue : 1280,
    height: Number.isFinite(heightValue) ? heightValue : 720,
    fps: fps === 60 ? 60 : 30,
  };
}

function setCleanOutputMode(enabled: boolean) {
  cleanOutputMode = enabled;
  document.body.classList.toggle("clean-output-mode", enabled);
  updateAvatarBackground();
  avatarScene.resize();
  setOutputButtons();
  setOutputStatus(
    enabled
      ? "OBS clean view is active. Capture this window, then press Escape to return."
      : "OBS clean view closed.",
    enabled ? "success" : "idle",
  );
  logRenderEvent("OBS clean output mode toggled", { enabled });
}

function updateAvatarBackground() {
  const color = backgroundColorInput?.value ?? "#e8f0f7";
  const transparent = transparentBackgroundInput?.checked ?? false;
  avatarScene.setBackground({ color, transparent });
  document.documentElement.style.setProperty("--avatar-background", color);
}

function resetAvatarTrackingState() {
  expressionPipeline.reset();
  avatarScene.setExpression(FFLExpression.Normal);
  avatarScene.setHeadRotation({ pitch: 0, yaw: 0, roll: 0 });
  if (expressionSelect) expressionSelect.value = "0";
  setDebugValues(
    FFLExpression.Normal,
    formatChannels({ eyes: "open", mouth: "closed", emotion: "normal" }),
    0,
    { pitch: 0, yaw: 0, roll: 0 },
    0,
  );
  latestExpressionScores = zeroExpressionScores();
  latestExpressionSignals = zeroExpressionSignals();
  renderSignalDebugState(latestExpressionScores, latestExpressionSignals);
  renderBlendshapeBars([]);
}

function renderSignalDebugState(
  scores: ExpressionScores,
  signals: ExpressionSignals,
) {
  for (const signalName of SIGNAL_NAMES) {
    const thresholds = tuningProfile.thresholds[signalName];
    const score = clamp01(scores[signalName]);

    const stateEl = document.querySelector<HTMLElement>(
      `[data-signal-state="${signalName}"]`,
    );
    if (stateEl) {
      stateEl.textContent = signals[signalName] ? "on" : "off";
      stateEl.dataset.active = String(signals[signalName]);
    }

    const rail = document.querySelector<HTMLElement>(
      `[data-threshold-rail="${signalName}"]`,
    );
    if (rail) {
      rail.style.setProperty("--exit", String(thresholds.exit * 100));
      rail.style.setProperty("--enter", String(thresholds.enter * 100));
      rail.style.setProperty("--score", String(score * 100));
    }

    document
      .querySelectorAll<HTMLElement>(`[data-signal-value^="${signalName}:"]`)
      .forEach((valueEl) => {
        const field = valueEl.dataset.signalValue?.split(":")[1];
        if (field === "gain") {
          valueEl.textContent = tuningProfile.gains[signalName].toFixed(2);
        } else if (field === "enter" || field === "exit") {
          valueEl.textContent = tuningProfile.thresholds[signalName][field].toFixed(2);
        }
      });
  }
}

function positiveInputValue(input: HTMLInputElement, fallback: number) {
  return input.valueAsNumber > 0 ? input.valueAsNumber : fallback;
}

function nonNegativeInputValue(input: HTMLInputElement, fallback: number) {
  return input.valueAsNumber >= 0 ? input.valueAsNumber : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

fileInput?.addEventListener("change", () => {
  if (tracking) {
    stopTracking("Tracking stopped because the avatar file changed.");
  }

  selectedFile = fileInput.files?.[0] ?? null;
  avatarLoaded = false;
  avatarHasExpressionVariants = false;
  setTrackingButtons();
  setCleanOutputMode(false);
  void stopOutput("Output stopped because the avatar file changed.");

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
    setOutputButtons();

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
    setOutputButtons();
    setCleanOutputMode(false);
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
  outputFrameLoop?.stop();
  stopLipSync();
});
