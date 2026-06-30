import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import { AvatarScene } from "./lib/scene";
import {
  FFL_EXPRESSION_LABELS,
  FFLExpression,
  type BlendshapeCategory,
  type ExpressionChannels,
  type ExpressionScores,
  type ExpressionSignals,
  type HeadRotation,
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
import {
  addAvatar,
  getAvatar,
  readLibrary,
  removeAvatar,
  renameAvatar,
  sanitizeName,
  setAvatarThumbnail,
  type LibraryAvatar,
} from "./lib/avatarLibrary";

const CLEAN_OUTPUT_WINDOW_LABEL = "clean-output";
const CLEAN_OUTPUT_VIEW = "clean-output";
const CLEAN_OUTPUT_AVATAR_STORAGE_KEY = "miituber.cleanOutputAvatar.v1";
const CLEAN_OUTPUT_AVATAR_EVENT = "clean-output-avatar";
const CLEAN_OUTPUT_BACKGROUND_EVENT = "clean-output-background";
const CLEAN_OUTPUT_POSE_EVENT = "clean-output-pose";
const CLEAN_OUTPUT_READY_EVENT = "clean-output-ready";
const CLEAN_OUTPUT_HIDDEN_EVENT = "clean-output-hidden";

const isCleanOutputWindow =
  new URLSearchParams(window.location.search).get("view") === CLEAN_OUTPUT_VIEW;

const fileInput = document.querySelector<HTMLInputElement>("#mii-file");
const statusEl = document.querySelector<HTMLElement>("#status");
const viewerCanvas = document.querySelector<HTMLCanvasElement>("#mii-viewer");
const rendererHealthEl = document.querySelector<HTMLElement>("#renderer-health");
const appShellEl = document.querySelector<HTMLElement>(".app-shell");
const backToLibraryButton =
  document.querySelector<HTMLButtonElement>("#back-to-library");
const workspaceAvatarNameEl = document.querySelector<HTMLElement>(
  "#workspace-avatar-name",
);
const isolateCaptureButton = document.querySelector<HTMLButtonElement>(
  "#isolate-capture-button",
);
const avatarGridEl = document.querySelector<HTMLElement>("#avatar-grid");
const addAvatarTile = document.querySelector<HTMLButtonElement>("#add-avatar-tile");
const menuItems = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".rail-item[data-menu]"),
);
const importModal = document.querySelector<HTMLElement>("#import-modal");
const importClose = document.querySelector<HTMLButtonElement>("#import-close");
const importCancel = document.querySelector<HTMLButtonElement>("#import-cancel");
const importPick = document.querySelector<HTMLButtonElement>("#import-pick");
const importPreviewEl = document.querySelector<HTMLElement>("#import-preview");
const importNameInput = document.querySelector<HTMLInputElement>("#import-name");
const importStatusEl = document.querySelector<HTMLElement>("#import-status");
const importSaveButton = document.querySelector<HTMLButtonElement>("#import-save");
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
const trackingFpsSelect = document.querySelector<HTMLSelectElement>(
  "#tracking-fps-select",
);
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
const toggleCleanOutputButton = document.querySelector<HTMLButtonElement>(
  "#toggle-clean-output-button",
);
const outputStatusEl = document.querySelector<HTMLElement>("#output-status");
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

let pendingImport: { bytes: number[]; thumbnailDataUrl: string | null } | null = null;
let currentAvatarId: string | null = null;
let avatarLoaded = false;
let avatarHasExpressionVariants = false;
let tracking = false;
let tuningProfile = createDefaultTuningProfile();
let calibrationSession: CalibrationSession | null = null;
let latestExpressionScores: ExpressionScores = zeroExpressionScores();
let latestExpressionSignals: ExpressionSignals = zeroExpressionSignals();
let cleanOutputMode = false;
let isolateMode = false;
let currentCleanOutputAvatar: CleanOutputStoredAvatar | null = null;
let cleanOutputBackgroundOverride: CleanOutputBackgroundPayload | null = null;
let cleanOutputAvatarLoaded = false;
let latestCleanOutputPose: CleanOutputPosePayload = {
  expressionIndex: FFLExpression.Normal,
  headRotation: { pitch: 0, yaw: 0, roll: 0 },
};
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

type CleanOutputStoredAvatar = {
  name: string;
  bytes: number[];
};

type CleanOutputBackgroundPayload = {
  color: string;
  transparent: boolean;
};

type CleanOutputPosePayload = {
  expressionIndex: number;
  headRotation: HeadRotation;
};

type CleanOutputAvatarPayload = CleanOutputStoredAvatar & {
  background: CleanOutputBackgroundPayload;
  pose: CleanOutputPosePayload;
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

function setTrackingButtons() {
  if (startTrackingButton) {
    startTrackingButton.disabled =
      !avatarLoaded || !avatarHasExpressionVariants || tracking;
  }

  if (stopTrackingButton) {
    stopTrackingButton.disabled = !tracking;
  }

  if (trackingFpsSelect) {
    trackingFpsSelect.disabled = tracking;
  }
}

function getTrackingFps() {
  const fps = Number(trackingFpsSelect?.value ?? "60");
  return Number.isFinite(fps) && fps > 0 ? fps : 60;
}

function setOutputButtons() {
  if (toggleCleanOutputButton) {
    toggleCleanOutputButton.disabled = !avatarLoaded;
    toggleCleanOutputButton.textContent = cleanOutputMode
      ? "Close OBS Clean View"
      : "Open OBS Clean View";
  }
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
if (isCleanOutputWindow) {
  void initializeCleanOutputWindow();
} else {
  initializeMainWindow();
}

function initializeMainWindow() {
  populateExpressionSelect();
  populateTuningControls();
  updateAvatarBackground();
  resetAvatarTrackingState();
  setTrackingButtons();
  setOutputButtons();
  setLipSyncButtons();
  setLipSyncDebugValue(0);
  setAppMode("library");
  renderLibraryGrid();
  wireLibraryControls();
  void refreshRendererHealth();
  void refreshCameraList();
  void refreshMicrophoneList();
  void listen(CLEAN_OUTPUT_READY_EVENT, () => {
    void publishCleanOutputAvatarSnapshot();
  });
  void listen(CLEAN_OUTPUT_HIDDEN_EVENT, () => {
    cleanOutputMode = false;
    setOutputButtons();
    setOutputStatus("OBS Clean View closed.", "idle");
  });
  void WebviewWindow.getCurrent().onCloseRequested(async () => {
    const cleanWindow = await WebviewWindow.getByLabel(CLEAN_OUTPUT_WINDOW_LABEL);
    await cleanWindow?.destroy();
  });
}

async function initializeCleanOutputWindow() {
  cleanOutputMode = true;
  setAppMode("workspace");
  document.documentElement.classList.add("clean-output-mode", "clean-output-window");
  document.body.classList.add("clean-output-mode", "clean-output-window");
  if (emptyPreviewEl) emptyPreviewEl.hidden = true;

  await WebviewWindow.getCurrent().onCloseRequested((event) => {
    event.preventDefault();
    void hideCurrentCleanOutputWindow();
  });

  await listen<CleanOutputAvatarPayload>(CLEAN_OUTPUT_AVATAR_EVENT, (event) => {
    void loadCleanOutputAvatar(event.payload);
  });
  await listen<CleanOutputBackgroundPayload>(
    CLEAN_OUTPUT_BACKGROUND_EVENT,
    (event) => {
      applyCleanOutputBackground(event.payload);
    },
  );
  await listen<CleanOutputPosePayload>(CLEAN_OUTPUT_POSE_EVENT, (event) => {
    applyCleanOutputPose(event.payload);
  });

  applyCleanOutputBackground({ color: "#e8f0f7", transparent: true });
  setStatus("Waiting for the main window to send an avatar...", "idle");
  await emit(CLEAN_OUTPUT_READY_EVENT);
  window.setTimeout(() => {
    if (cleanOutputAvatarLoaded) return;

    const storedAvatar = readCleanOutputAvatar();
    if (!storedAvatar) return;

    void loadCleanOutputAvatar({
      ...storedAvatar,
      background: { color: "#e8f0f7", transparent: true },
      pose: latestCleanOutputPose,
    });
  }, 300);
}

async function openCleanOutputWindow() {
  if (!avatarLoaded) {
    setOutputStatus("Render an avatar before opening OBS Clean View.", "error");
    return;
  }

  try {
    const cleanWindow = await WebviewWindow.getByLabel(CLEAN_OUTPUT_WINDOW_LABEL);
    if (!cleanWindow) {
      throw new Error(
        "The configured clean-output window was not found. Restart the Tauri app so the window from tauri.conf.json is created.",
      );
    }

    cleanOutputMode = true;
    setOutputButtons();
    await cleanWindow.show();
    await cleanWindow.setFocus();
    await publishCleanOutputAvatarSnapshot();
    setOutputStatus(
      "OBS Clean View is open in its own renderer window.",
      "success",
    );
  } catch (error) {
    cleanOutputMode = false;
    setOutputButtons();
    const message = error instanceof Error ? error.message : String(error);
    console.error("[MiiTuber] OBS Clean View open failed", { error, message });
    setOutputStatus(`Could not open OBS Clean View: ${message}`, "error");
  }
}

async function closeCleanOutputWindow() {
  try {
    const cleanWindow = await WebviewWindow.getByLabel(CLEAN_OUTPUT_WINDOW_LABEL);
    await cleanWindow?.hide();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[MiiTuber] OBS Clean View close failed", { error, message });
    setOutputStatus(`Could not close OBS Clean View: ${message}`, "error");
    return;
  }

  cleanOutputMode = false;
  setOutputButtons();
  setOutputStatus("OBS Clean View closed.", "idle");
}

async function hideCurrentCleanOutputWindow() {
  try {
    await WebviewWindow.getCurrent().hide();
    await emit(CLEAN_OUTPUT_HIDDEN_EVENT);
  } catch (error) {
    console.warn("[MiiTuber] clean output hide failed", { error });
  }
}

async function publishCleanOutputAvatarSnapshot() {
  if (isCleanOutputWindow) return;
  if (!cleanOutputMode) return;

  const avatar = currentCleanOutputAvatar ?? readCleanOutputAvatar();
  if (!avatar) return;

  await emitTo<CleanOutputAvatarPayload>(
    CLEAN_OUTPUT_WINDOW_LABEL,
    CLEAN_OUTPUT_AVATAR_EVENT,
    {
      ...avatar,
      background: readCurrentBackground(),
      pose: latestCleanOutputPose,
    },
  );
}

function publishCleanOutputBackground() {
  if (isCleanOutputWindow) return;
  if (!cleanOutputMode) return;

  void emitTo<CleanOutputBackgroundPayload>(
    CLEAN_OUTPUT_WINDOW_LABEL,
    CLEAN_OUTPUT_BACKGROUND_EVENT,
    readCurrentBackground(),
  );
}

function publishCleanOutputPose() {
  if (isCleanOutputWindow) return;
  if (!cleanOutputMode) return;

  void emitTo<CleanOutputPosePayload>(
    CLEAN_OUTPUT_WINDOW_LABEL,
    CLEAN_OUTPUT_POSE_EVENT,
    latestCleanOutputPose,
  );
}

async function loadCleanOutputAvatar(payload: CleanOutputAvatarPayload) {
  try {
    cleanOutputAvatarLoaded = true;
    applyCleanOutputBackground(payload.background);
    const glbBytes = await invoke<number[]>("render_mii_glb", {
      miiBytes: payload.bytes,
    });
    await avatarScene.loadModelFromGlbBytes(glbBytes);
    applyCleanOutputPose(payload.pose);
    if (emptyPreviewEl) emptyPreviewEl.hidden = true;
    setStatus(`OBS Clean View rendering ${payload.name}.`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[MiiTuber] clean output avatar load failed", {
      error,
      message,
    });
    setStatus(`Could not load OBS Clean View avatar: ${message}`, "error");
  }
}

function applyCleanOutputBackground(background: CleanOutputBackgroundPayload) {
  cleanOutputBackgroundOverride = background;
  updateAvatarBackground();
}

function applyCleanOutputPose(pose: CleanOutputPosePayload) {
  latestCleanOutputPose = pose;
  avatarScene.setExpression(pose.expressionIndex);
  avatarScene.setHeadRotation(pose.headRotation);
}

function setAvatarPose(expressionIndex: number, headRotation: HeadRotation) {
  latestCleanOutputPose = { expressionIndex, headRotation };
  avatarScene.setExpression(expressionIndex);
  avatarScene.setHeadRotation(headRotation);
  publishCleanOutputPose();
}

function readCurrentBackground(): CleanOutputBackgroundPayload {
  if (cleanOutputBackgroundOverride) return cleanOutputBackgroundOverride;

  return {
    color: backgroundColorInput?.value ?? "#e8f0f7",
    transparent: isolateMode || (transparentBackgroundInput?.checked ?? false),
  };
}

function readCleanOutputAvatar(): CleanOutputStoredAvatar | null {
  try {
    const raw = localStorage.getItem(CLEAN_OUTPUT_AVATAR_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CleanOutputStoredAvatar>;
    if (typeof parsed.name !== "string" || !Array.isArray(parsed.bytes)) {
      return null;
    }
    if (
      parsed.bytes.length === 0 ||
      !parsed.bytes.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      )
    ) {
      return null;
    }

    return {
      name: parsed.name,
      bytes: parsed.bytes,
    };
  } catch (error) {
    console.warn("[MiiTuber] could not read OBS clean avatar", { error });
    return null;
  }
}

function saveCleanOutputAvatar(avatar: CleanOutputStoredAvatar) {
  currentCleanOutputAvatar = avatar;
  try {
    localStorage.setItem(CLEAN_OUTPUT_AVATAR_STORAGE_KEY, JSON.stringify(avatar));
  } catch (error) {
    console.warn("[MiiTuber] could not save OBS clean avatar", { error });
  }
}

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
  setAvatarPose(expressionIndex, latestCleanOutputPose.headRotation);
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

toggleCleanOutputButton?.addEventListener("click", () => {
  setCleanOutputMode(!cleanOutputMode);
});

isolateCaptureButton?.addEventListener("click", () => {
  setIsolateMode(true);
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (isolateMode && !isCleanOutputWindow) {
    setIsolateMode(false);
    return;
  }

  if (cleanOutputMode) {
    if (isCleanOutputWindow) {
      void hideCurrentCleanOutputWindow();
      return;
    }
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
    setAvatarPose(FFLExpression.Normal, { pitch: 0, yaw: 0, roll: 0 });
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

  setAvatarPose(pipelineFrame.expressionIndex, pipelineFrame.headRotation);

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
        maxFps: getTrackingFps(),
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

function setCleanOutputMode(enabled: boolean) {
  if (isCleanOutputWindow) {
    cleanOutputMode = enabled;
    document.documentElement.classList.toggle("clean-output-mode", enabled);
    document.body.classList.toggle("clean-output-mode", enabled);
    updateAvatarBackground();
    requestAnimationFrame(() => {
      avatarScene.resize();
      if (enabled) avatarScene.resetCameraView();
    });
    return;
  }

  if (enabled) {
    void openCleanOutputWindow();
  } else {
    void closeCleanOutputWindow();
  }
  logRenderEvent("OBS clean output popup toggled", { enabled });
}

function setIsolateMode(enabled: boolean) {
  isolateMode = enabled;
  document.documentElement.classList.toggle("capture-isolate", enabled);
  document.body.classList.toggle("capture-isolate", enabled);

  if (enabled) {
    for (const popover of Array.from(
      document.querySelectorAll<HTMLElement>(".menu-popover"),
    )) {
      popover.hidden = true;
    }
    for (const item of menuItems) {
      item.dataset.open = "false";
    }
  }

  updateAvatarBackground();
  requestAnimationFrame(() => {
    avatarScene.resize();
    if (enabled) avatarScene.resetCameraView();
  });
  logRenderEvent("capture isolate toggled", { enabled });
}

function updateAvatarBackground() {
  const background = readCurrentBackground();
  const { color, transparent } = background;

  if (isCleanOutputWindow) {
    const outputColor = transparent ? "transparent" : color;
    avatarScene.setBackground({ color, transparent });
    document.documentElement.classList.toggle("transparent-output", transparent);
    document.body.classList.toggle("transparent-output", transparent);
    document.documentElement.style.setProperty("--avatar-background", outputColor);
    document.documentElement.style.backgroundColor = outputColor;
    document.body.style.backgroundColor = outputColor;
    canvas.style.backgroundColor = outputColor;
    return;
  }

  const mainColor = transparent ? "transparent" : color;
  avatarScene.setBackground({ color, transparent });
  document.documentElement.style.setProperty("--avatar-background", mainColor);
  document.documentElement.style.backgroundColor = mainColor;
  document.body.style.backgroundColor = mainColor;
  canvas.style.backgroundColor = mainColor;
  publishCleanOutputBackground();
}

function resetAvatarTrackingState() {
  expressionPipeline.reset();
  setAvatarPose(FFLExpression.Normal, { pitch: 0, yaw: 0, roll: 0 });
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

function getLibraryStorage() {
  return window.localStorage;
}

function setAppMode(mode: "library" | "workspace") {
  if (!appShellEl) return;
  appShellEl.classList.toggle("mode-library", mode === "library");
  appShellEl.classList.toggle("mode-workspace", mode === "workspace");
}

function renderLibraryGrid() {
  if (!avatarGridEl || !addAvatarTile) return;

  for (const tile of Array.from(
    avatarGridEl.querySelectorAll(".avatar-tile"),
  )) {
    tile.remove();
  }

  const avatars = readLibrary(getLibraryStorage());
  const fragment = document.createDocumentFragment();
  for (const avatar of avatars) {
    fragment.append(createAvatarTile(avatar));
  }
  avatarGridEl.insertBefore(fragment, addAvatarTile);
}

function createAvatarTile(avatar: LibraryAvatar) {
  const tile = document.createElement("div");
  tile.className = "avatar-tile";
  tile.dataset.avatarId = avatar.id;
  tile.setAttribute("role", "button");
  tile.tabIndex = 0;
  tile.addEventListener("click", () => {
    void selectAvatar(avatar.id);
  });
  tile.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void selectAvatar(avatar.id);
    }
  });

  const thumb = document.createElement("div");
  thumb.className = "avatar-tile__thumb";
  if (avatar.thumbnailDataUrl) {
    const img = document.createElement("img");
    img.src = avatar.thumbnailDataUrl;
    img.alt = avatar.name;
    thumb.append(img);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "avatar-tile__thumb-empty";
    placeholder.textContent = "No preview";
    thumb.append(placeholder);
  }

  const name = document.createElement("span");
  name.className = "avatar-tile__name";
  name.textContent = avatar.name;

  const menu = document.createElement("div");
  menu.className = "avatar-tile__menu";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.textContent = "Rename";
  renameBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const next = window.prompt("Rename avatar", avatar.name);
    if (next === null) return;
    renameAvatar(getLibraryStorage(), avatar.id, sanitizeName(next));
    renderLibraryGrid();
    if (currentAvatarId === avatar.id && workspaceAvatarNameEl) {
      workspaceAvatarNameEl.textContent = sanitizeName(next);
    }
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!window.confirm(`Delete "${avatar.name}"?`)) return;
    removeAvatar(getLibraryStorage(), avatar.id);
    if (currentAvatarId === avatar.id) {
      currentAvatarId = null;
      if (tracking) stopTracking();
      stopLipSync();
      setAppMode("library");
    }
    renderLibraryGrid();
  });

  menu.append(renameBtn, deleteBtn);
  tile.append(thumb, name, menu);
  return tile;
}

function wireLibraryControls() {
  addAvatarTile?.addEventListener("click", () => openImportModal());
  importClose?.addEventListener("click", () => closeImportModal());
  importCancel?.addEventListener("click", () => closeImportModal());
  importModal?.addEventListener("click", (event) => {
    if (event.target === importModal) closeImportModal();
  });
  importPick?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => void handleImportFile());
  importNameInput?.addEventListener("input", () => {
    if (importSaveButton) {
      importSaveButton.disabled = !pendingImport;
    }
  });
  importSaveButton?.addEventListener("click", () => saveImportedAvatar());
  backToLibraryButton?.addEventListener("click", () => {
    if (tracking) stopTracking();
    stopLipSync();
    currentAvatarId = null;
    setAppMode("library");
    renderLibraryGrid();
  });

  menuItems.forEach((item, index) => {
    item.addEventListener("click", () => {
      const name = item.dataset.menu;
      const popover = document.querySelector<HTMLElement>(
        `.menu-popover[data-popover="${name}"]`,
      );
      if (!popover) return;
      const willOpen = popover.hidden;
      if (willOpen) {
        if (!popover.dataset.positioned) {
          const offset = index * 28;
          popover.style.left = `${110 + offset}px`;
          popover.style.top = `${70 + offset}px`;
          popover.dataset.positioned = "true";
        }
        popover.hidden = false;
        bringPopoverToFront(popover);
        makePopoverDraggable(popover);
      } else {
        popover.hidden = true;
      }
      item.dataset.open = String(willOpen);
    });
  });

  for (const closeBtn of Array.from(
    document.querySelectorAll<HTMLButtonElement>(".menu-popover__close[data-close]"),
  )) {
    closeBtn.addEventListener("click", () => {
      const name = closeBtn.dataset.close;
      const popover = document.querySelector<HTMLElement>(
        `.menu-popover[data-popover="${name}"]`,
      );
      if (popover) popover.hidden = true;
      const item = menuItems.find((entry) => entry.dataset.menu === name);
      if (item) item.dataset.open = "false";
    });
  }
}

let popoverZIndex = 40;

function bringPopoverToFront(popover: HTMLElement) {
  popoverZIndex += 1;
  popover.style.zIndex = String(popoverZIndex);
}

function makePopoverDraggable(popover: HTMLElement) {
  if (popover.dataset.draggable === "true") return;
  popover.dataset.draggable = "true";

  const handle = popover.querySelector<HTMLElement>(".menu-popover__header");
  if (!handle) return;

  handle.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest(".menu-popover__close")) return;
    event.preventDefault();
    bringPopoverToFront(popover);

    const rect = popover.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    handle.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const maxLeft = window.innerWidth - popover.offsetWidth;
      const maxTop = window.innerHeight - popover.offsetHeight;
      const left = Math.min(Math.max(0, moveEvent.clientX - offsetX), maxLeft);
      const top = Math.min(Math.max(0, moveEvent.clientY - offsetY), maxTop);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };

    const onUp = (upEvent: PointerEvent) => {
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}

function openImportModal() {
  pendingImport = null;
  if (importModal) importModal.hidden = false;
  if (importNameInput) {
    importNameInput.value = "";
    importNameInput.disabled = true;
  }
  if (importSaveButton) importSaveButton.disabled = true;
  if (importPreviewEl) {
    importPreviewEl.replaceChildren();
    const span = document.createElement("span");
    span.textContent = "No file selected";
    importPreviewEl.append(span);
  }
  setImportStatus("", "idle");
  if (fileInput) fileInput.value = "";
}

function closeImportModal() {
  if (importModal) importModal.hidden = true;
  pendingImport = null;
  if (fileInput) fileInput.value = "";
}

function setImportStatus(
  message: string,
  tone: "idle" | "error" | "success" = "idle",
) {
  if (!importStatusEl) return;
  importStatusEl.textContent = message;
  importStatusEl.dataset.tone = tone;
}

async function handleImportFile() {
  const file = fileInput?.files?.[0];
  if (!file) return;

  pendingImport = null;
  if (importSaveButton) importSaveButton.disabled = true;
  setImportStatus("Validating with the local FFL renderer...");

  try {
    const buffer = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    let thumbnailDataUrl: string | null = null;
    try {
      const pngBytes = await invoke<number[]>("render_mii_png", {
        miiBytes: bytes,
      });
      thumbnailDataUrl = bytesToPngDataUrl(pngBytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[MiiTuber] thumbnail render failed during import", {
        error,
        message,
      });
      setImportStatus(
        "Renderer unavailable; saving without a thumbnail. It will generate on first use.",
        "idle",
      );
    }

    pendingImport = { bytes, thumbnailDataUrl };
    renderImportPreview(thumbnailDataUrl);
    const defaultName = file.name.replace(/\.[^.]+$/, "");
    if (importNameInput) {
      importNameInput.disabled = false;
      importNameInput.value = sanitizeName(defaultName);
    }
    if (importSaveButton) importSaveButton.disabled = false;
    if (thumbnailDataUrl) {
      setImportStatus("Looks good. Name it and save.", "success");
    }
  } catch (error) {
    pendingImport = null;
    const message = error instanceof Error ? error.message : String(error);
    setImportStatus(`Could not read file: ${message}`, "error");
  }
}

function renderImportPreview(thumbnailDataUrl: string | null) {
  if (!importPreviewEl) return;
  importPreviewEl.replaceChildren();
  if (thumbnailDataUrl) {
    const img = document.createElement("img");
    img.src = thumbnailDataUrl;
    img.alt = "Avatar preview";
    importPreviewEl.append(img);
  } else {
    const span = document.createElement("span");
    span.textContent = "No thumbnail";
    importPreviewEl.append(span);
  }
}

function saveImportedAvatar() {
  if (!pendingImport) return;

  try {
    const name = sanitizeName(importNameInput?.value ?? "");
    addAvatar(getLibraryStorage(), {
      name,
      bytes: pendingImport.bytes,
      thumbnailDataUrl: pendingImport.thumbnailDataUrl,
    });
    closeImportModal();
    renderLibraryGrid();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setImportStatus(`Could not save avatar: ${message}`, "error");
  }
}

function bytesToPngDataUrl(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

async function selectAvatar(id: string) {
  const avatar = getAvatar(getLibraryStorage(), id);
  if (!avatar) return;

  if (tracking) stopTracking();
  currentAvatarId = id;
  if (workspaceAvatarNameEl) workspaceAvatarNameEl.textContent = avatar.name;
  setAppMode("workspace");
  requestAnimationFrame(() => avatarScene.resize());
  await renderAvatarBytes(avatar.bytes, avatar.name);

  if (!avatar.thumbnailDataUrl) {
    void backfillThumbnail(id, avatar.bytes);
  }
}

async function backfillThumbnail(id: string, bytes: number[]) {
  try {
    const pngBytes = await invoke<number[]>("render_mii_png", { miiBytes: bytes });
    setAvatarThumbnail(getLibraryStorage(), id, bytesToPngDataUrl(pngBytes));
  } catch (error) {
    console.warn("[MiiTuber] thumbnail backfill failed", { error });
  }
}

async function renderAvatarBytes(miiBytes: number[], name: string) {
  try {
    void refreshRendererHealth();
    setStatus("Requesting GLB from the local FFL renderer...");

    const glbBytes = await invoke<number[]>("render_mii_glb", { miiBytes });
    const loadResult = await avatarScene.loadModelFromGlbBytes(glbBytes);
    saveCleanOutputAvatar({ name, bytes: miiBytes });
    setAvatarPose(FFLExpression.Normal, { pitch: 0, yaw: 0, roll: 0 });

    if (expressionSelect) {
      expressionSelect.disabled = loadResult.expressionCount === 0;
      expressionSelect.value = "0";
    }
    avatarLoaded = true;
    avatarHasExpressionVariants = loadResult.expressionCount > 0;
    setTrackingButtons();
    setOutputButtons();
    void publishCleanOutputAvatarSnapshot();

    logRenderEvent("render_mii_glb succeeded", {
      name,
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
    console.error("[MiiTuber] render_mii_glb failed", { name, error, message });
    setStatus(message, "error");
  }
}

window.addEventListener("beforeunload", () => {
  faceTracker.stop();
  stopLipSync();
});
