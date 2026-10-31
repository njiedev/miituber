import { normalizeBodyIntensity, normalizeBodyMaxTurn } from "./lib/upperBodyFollow";
import { appDataDir, join } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import {
  averageBlendshapeSamples,
  ExpressionPipeline,
  resolveMouthOpenSource,
  type MouthOpenSource,
  zeroExpressionScores,
  zeroExpressionSignals,
} from "./lib/expressionPipeline";
import { FaceTracker, type FaceTrackerFrame } from "./lib/faceTracker";
import { MouseTracker } from "./lib/mouseTracker";
import { AvatarPoseCoordinator } from "./lib/avatarPoseCoordinator";
import {
  AutoBlinker,
  type AutoBlinkOptions,
  type BlinkMode,
  DEFAULT_BLINK_MODE,
  isBlinkMode,
  normalizeAutoBlinkOptions,
  usesAutoBlink,
  withBlink,
} from "./lib/autoBlink";
import { LipSyncEnvelope, rootMeanSquare } from "./lib/lipSync";
import { AvatarScene, type AvatarBackground } from "./lib/scene";
import { ensureReady, type FFLContext } from "./lib/fflRenderer";
import { normalizeMiiBytes } from "./lib/miiData";
import { renderMiiThumbnailDataUrl } from "./lib/miiThumbnail";
import {
  friendlyErrorMessage,
  mediaErrorCode,
  reportAppError,
  type AppErrorCode,
} from "./lib/appDiagnostics";

const FFL_RESOURCE_FILE_NAME = "AFLResHigh_2_3.dat";
const FFL_RESOURCE_URL = "/AFLResHigh_2_3.dat";
const FFL_WASM_URL = "/ffl-emscripten.wasm";
const FFL_RESOURCE_MIN_BYTES = 1_000_000;
const FFL_RESOURCE_MAX_BYTES = 16_000_000;

let fflContextPromise: Promise<FFLContext> | null = null;

async function getFflContext(): Promise<FFLContext> {
  if (!fflContextPromise) {
    fflContextPromise = (async () => {
      const resource = await loadFflResource();
      return ensureReady({ resource, wasmUrl: FFL_WASM_URL });
    })().catch((error) => {
      fflContextPromise = null;
      throw error;
    });
  }
  return fflContextPromise;
}

// Load the resource before import so the setup gate appears at startup.
async function prewarmFflRenderer(): Promise<void> {
  try {
    await getFflContext();
  } catch (error) {
    console.error("[MiiTuber] FFL renderer warm-up failed", error);
  }
}

async function loadFflResource(): Promise<ArrayBuffer> {
  if (!isRunningInTauri()) {
    return (await fetch(FFL_RESOURCE_URL)).arrayBuffer();
  }

  const installed = await tryReadInstalledFflResource();
  if (installed) return toArrayBuffer(installed);

  const publicResource = await tryFetchPublicFflResource();
  if (publicResource) return publicResource;

  return promptForFflResource();
}

function isRunningInTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function tryReadInstalledFflResource(): Promise<Uint8Array | null> {
  try {
    const appDataPath = await fflResourceAppDataPath();
    const bytes = await readFile(appDataPath);
    validateFflResource(bytes);
    console.info("[MiiTuber] loaded FFL resource from app data", {
      path: appDataPath,
      bytes: bytes.byteLength,
    });
    return bytes;
  } catch (error) {
    console.info("[MiiTuber] no usable app-data FFL resource found", { error });
    return null;
  }
}

async function tryFetchPublicFflResource(): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(FFL_RESOURCE_URL);
    if (!response.ok) return null;

    const bytes = await response.arrayBuffer();
    validateFflResource(new Uint8Array(bytes));
    console.info("[MiiTuber] loaded FFL resource from Vite public fallback", {
      url: FFL_RESOURCE_URL,
      bytes: bytes.byteLength,
    });
    return bytes;
  } catch (error) {
    console.info("[MiiTuber] no usable public FFL resource found", { error });
    return null;
  }
}

// The Mii resource file is a hard prerequisite: without AFLResHigh_2_3.dat the
// app can't render anything, so a new user can't even add their first Mii (the
// import flow renders a preview). When it is missing, the app shows a blocking,
// non-dismissable first-run gate OVER the library — the user must supply the
// file before they can reach anything else.
async function promptForFflResource(): Promise<ArrayBuffer> {
  showResourceGate();

  while (true) {
    await waitForResourceGatePick();

    const selectedPath = await openDialog({
      title: "Choose AFLResHigh_2_3.dat",
      multiple: false,
      directory: false,
      filters: [
        { name: "Mii resource file", extensions: ["dat"] },
        { name: "All files", extensions: ["*"] },
      ],
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      // No file chosen — keep the gate up and let them try again.
      continue;
    }

    try {
      const bytes = await readFile(selectedPath);
      validateFflResource(bytes);
      await installFflResource(bytes);
      hideResourceGate();
      setStatus("Mii resource file saved. Starting renderer...", "success");
      return toArrayBuffer(bytes);
    } catch (error) {
      // Invalid file — keep the gate up (text-only, no red error) and let them
      // choose again. Render-surface errors surface on the workspace status.
      console.warn("[MiiTuber] rejected Mii resource file", { error });
    }
  }
}

function showResourceGate(): void {
  const gate = document.querySelector<HTMLElement>("#resource-gate");
  if (gate) gate.hidden = false;
}

function hideResourceGate(): void {
  const gate = document.querySelector<HTMLElement>("#resource-gate");
  if (gate) gate.hidden = true;
  const error = document.querySelector<HTMLElement>("#resource-gate-error");
  if (error) error.hidden = true;
}

// Resolves when the user clicks the gate's "Choose file" button. Re-enables the
// button on each loop and disables it while the OS file dialog is open so a
// double-click can't stack dialogs.
async function waitForResourceGatePick(): Promise<void> {
  const button =
    document.querySelector<HTMLButtonElement>("#resource-gate-pick");
  if (!button) return;
  button.disabled = false;
  await new Promise<void>((resolve) => {
    button.addEventListener("click", () => resolve(), { once: true });
  });
  button.disabled = true;
}

async function installFflResource(bytes: Uint8Array) {
  const appDataPath = await appDataDir();
  await mkdir(appDataPath, { recursive: true });

  const resourcePath = await fflResourceAppDataPath();
  await writeFile(resourcePath, bytes);
  console.info("[MiiTuber] installed FFL resource into app data", {
    path: resourcePath,
    bytes: bytes.byteLength,
  });
}

async function fflResourceAppDataPath(): Promise<string> {
  return join(await appDataDir(), FFL_RESOURCE_FILE_NAME);
}

function validateFflResource(bytes: Uint8Array) {
  if (bytes.byteLength < FFL_RESOURCE_MIN_BYTES) {
    throw new Error("the file is too small.");
  }

  if (bytes.byteLength > FFL_RESOURCE_MAX_BYTES) {
    throw new Error("the file is much larger than expected.");
  }

  const hasFfraHeader =
    bytes[0] === 0x46 && bytes[1] === 0x46 && bytes[2] === 0x52 && bytes[3] === 0x41;
  if (!hasFfraHeader) {
    throw new Error("it does not start with the expected FFRA resource header.");
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
import {
  FFLExpression,
  type BlendshapeCategory,
  type ExpressionScores,
  type ExpressionSignals,
  type HeadRotation,
} from "./lib/types";
import {
  createDefaultTuningProfile,
  normalizeTuningProfile,
  oneEuroParamsFromSmoothing,
  parseTuningProfileJson,
  serializeTuningProfile,
  SIGNAL_NAMES,
  smoothingFromOneEuroParams,
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
import {
  readTourState,
  shouldAutoStart,
  TOUR_CHAPTERS,
  TourController,
  writeTourState,
  type TourChapterId,
} from "./lib/tour";
import { TourPresenter } from "./lib/tourPresenter";
import {
  AUTO_BLINK_OPTIONS_STORAGE_KEY,
  BLINK_MODE_STORAGE_KEY,
  BODY_VISIBLE_STORAGE_KEY,
  UPPER_BODY_FOLLOW_STORAGE_KEY,
  UPPER_BODY_INTENSITY_STORAGE_KEY,
  UPPER_BODY_MAX_TURN_STORAGE_KEY,
  MIRROR_TRACKING_STORAGE_KEY,
  readBooleanPreference,
  readJsonPreference,
  readStringPreference,
  SHADING_STYLE_STORAGE_KEY,
  SHOW_DEBUG_INFO_STORAGE_KEY,
  TRACKING_SOURCE_STORAGE_KEY,
  writeBooleanPreference,
  writeJsonPreference,
  writeStringPreference,
} from "./lib/preferences";
import {
  DEFAULT_SHADING_STYLE,
  isShadingStyle,
  type ShadingStyle,
} from "./lib/shadingStyle";
import {
  expressionLabel,
  formatChannels,
  formatExpressionScores,
  formatScore,
  formatTopBlendshapes,
} from "./lib/debugFormat";
import { clamp01, clampNumber } from "./lib/math";
import { openPopover } from "./lib/popover";
import { TuningProfileStore } from "./lib/tuningProfileStore";
import { createUpdateExperience } from "./lib/updateExperience";
import {
  ErrorSpeaker,
  miiAvatarLoadErrorLine,
  miiCameraErrorLine,
  miiMicrophoneErrorLine,
  type MiiErrorLine,
} from "./lib/errorSpeaker";

const AUTO_BLINK_TICK_MS = 30;
const BLINK_MODE_HINTS: Record<BlinkMode, string> = {
  camera: "Your Mii blinks only when you blink.",
  both: "Adds natural blinks and hides quick camera blinks. Eyes you hold closed still show.",
  auto: "Ignores the camera for your eyes. Try this if glasses or glare cause false blinks.",
};

const searchParams = new URLSearchParams(window.location.search);

const fileInput = document.querySelector<HTMLInputElement>("#mii-file");
const statusEl = document.querySelector<HTMLElement>("#status");
const viewerCanvas = document.querySelector<HTMLCanvasElement>("#mii-viewer");
const appShellEl = document.querySelector<HTMLElement>(".app-shell");
const tourRootEl = document.querySelector<HTMLElement>("#tour-root");
const tourReplayButton =
  document.querySelector<HTMLButtonElement>("#tour-replay-button");
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
const previewFrameEl = document.querySelector<HTMLElement>(".preview-frame");
const expressionSelect = document.querySelector<HTMLSelectElement>("#expression-select");
const upperBodyIntensityInput = document.querySelector<HTMLInputElement>("#upper-body-intensity");
const upperBodyIntensityValue = document.querySelector<HTMLInputElement>("#upper-body-intensity-value");
const upperBodyMaxTurnInput = document.querySelector<HTMLInputElement>("#upper-body-max-turn");
const upperBodyMaxTurnValue = document.querySelector<HTMLInputElement>("#upper-body-max-turn-value");
const bodyMovementReset = document.querySelector<HTMLButtonElement>("#body-movement-reset");
const upperBodyFollowInput = document.querySelector<HTMLInputElement>("#upper-body-follow");
const bodyVisibleInput = document.querySelector<HTMLInputElement>("#body-visible");
const blinkModeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="blink-mode"]'),
);
const blinkModeHintEl = document.querySelector<HTMLElement>("#blink-mode-hint");
const blinkModeFieldEl = blinkModeHintEl?.closest<HTMLElement>(".field") ?? null;
const blinkRateInput = document.querySelector<HTMLInputElement>("#blink-rate");
const blinkRateValueEl = document.querySelector<HTMLOutputElement>("#blink-rate-value");
const blinkDurationInput = document.querySelector<HTMLInputElement>("#blink-duration");
const blinkDurationValueEl = document.querySelector<HTMLOutputElement>(
  "#blink-duration-value",
);
const mirrorTrackingInput = document.querySelector<HTMLInputElement>("#mirror-tracking");
const shadingStyleSelect = document.querySelector<HTMLSelectElement>(
  "#shading-style-select",
);
const transparentBackgroundInput = document.querySelector<HTMLInputElement>(
  "#transparent-background",
);
const isolateHintEl = document.querySelector<HTMLElement>("#isolate-hint");
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
const trackingSourceSelect = document.querySelector<HTMLSelectElement>(
  "#tracking-source-select",
);
const cameraTrackingFieldsEl = document.querySelector<HTMLElement>(
  "#camera-tracking-fields",
);
const mouseTrackingNoteEl = document.querySelector<HTMLElement>("#mouse-tracking-note");
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
const resetProfileButton = document.querySelector<HTMLButtonElement>(
  "#reset-profile-button",
);
const saveProfileButton =
  document.querySelector<HTMLButtonElement>("#save-profile-button");
const loadProfileButton =
  document.querySelector<HTMLButtonElement>("#load-profile-button");
const tuningStorageNoteEl = document.querySelector<HTMLElement>(
  "#tuning-storage-note",
);
const signalTuningControlsEl = document.querySelector<HTMLElement>(
  "#signal-tuning-controls",
);
const oneEuroSmoothingInput = document.querySelector<HTMLInputElement>(
  "#one-euro-smoothing",
);
const oneEuroSmoothingValueEl = document.querySelector<HTMLOutputElement>(
  "#one-euro-smoothing-value",
);
const HEAD_ROTATION_AXES = ["pitch", "roll", "yaw"] as const;
const headRotationOffsetControls = HEAD_ROTATION_AXES.map((axis) => ({
  axis,
  input: document.querySelector<HTMLInputElement>(`#head-rot-${axis}-offset`),
  valueEl: document.querySelector<HTMLOutputElement>(
    `#head-rot-${axis}-offset-value`,
  ),
}));
const showDebugInfoInput =
  document.querySelector<HTMLInputElement>("#show-debug-info");
const advancedDebugInfoEl = document.querySelector<HTMLElement>(
  "#advanced-debug-info",
);
const minimumHoldMsInput =
  document.querySelector<HTMLInputElement>("#minimum-hold-ms");
const micMouthTuningControlEl = document.querySelector<HTMLElement>(
  "#mic-mouth-tuning-control",
);
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
const libraryActionModal =
  document.querySelector<HTMLElement>("#library-action-modal");
const libraryActionTitle =
  document.querySelector<HTMLElement>("#library-action-title");
const libraryActionClose =
  document.querySelector<HTMLButtonElement>("#library-action-close");
const libraryActionBody =
  document.querySelector<HTMLElement>("#library-action-body");
const libraryActionFooter =
  document.querySelector<HTMLElement>("#library-action-footer");
let pendingImport: { bytes: number[]; thumbnailDataUrl: string | null } | null = null;
let currentAvatarId: string | null = null;
let avatarLoaded = false;
let avatarHasExpressionVariants = false;
let tracking = false;
let tuningProfile = createDefaultTuningProfile();
const tuningProfileStore = new TuningProfileStore(isRunningInTauri());
let calibrationSession: CalibrationSession | null = null;
let latestExpressionScores: ExpressionScores = zeroExpressionScores();
let latestExpressionSignals: ExpressionSignals = zeroExpressionSignals();
let latestCameraMouthScore = 0;
let latestCameraMouthSignal = false;
let latestMicrophoneMouthScore = 0;
let latestMicrophoneMouthSignal = false;
let isolateMode = false;
let currentAvatarPose: AvatarPose = {
  expressionIndex: FFLExpression.Normal,
  headRotation: { pitch: 0, yaw: 0, roll: 0 },
};
let baseExpressionIndex: number = FFLExpression.Normal;
const autoBlinker = new AutoBlinker();
let blinkMode: BlinkMode = DEFAULT_BLINK_MODE;
let autoBlinkClosed = false;
// When the tracker loses the face, hold the last pose briefly (so blinks of
// detection don't move the avatar), then ease the head back to neutral.
// NOTE: must be declared before the module-level init call below runs
// resetAvatarTrackingState(), which writes faceLostAt.
const FACE_LOST_HOLD_MS = 1000;
const FACE_LOST_EASE_TAU_MS = 700;
let faceLostAt: number | null = null;
let faceLostLastFrameAt = 0;
let lipSyncContext: AudioContext | null = null;
let lipSyncStream: MediaStream | null = null;
let lipSyncAnimationId: number | null = null;
let lipSyncMouthScore = 0;
let lipSyncRawRms = 0;
let lipSyncCalibrationSession: LipSyncCalibrationSession | null = null;
let microphoneAvailable = true;
const lipSyncEnvelope = new LipSyncEnvelope();
let activeTourController: TourController | null = null;
let activeTourPresenter: TourPresenter | null = null;
let activeTourChapterId: TourChapterId | null = null;
let errorSpeaker: ErrorSpeaker | null = null;
let rendererPrewarmFinished = false;
const updateExperience = createUpdateExperience({
  isTauri: isRunningInTauri(),
  devPanelEnabled: import.meta.env.DEV && searchParams.get("test-updates") === "1",
  onModalOpen: endActiveTour,
  onIdle: () => {
    if (!rendererPrewarmFinished) return;
    startTourIfNeeded(appShellEl?.classList.contains("mode-workspace") ? "workspace" : "library");
  },
});

type CalibrationSession = {
  startedAt: number;
  samples: BlendshapeCategory[][];
};

type LipSyncCalibrationSession = {
  startedAt: number;
  rmsSamples: number[];
};

type AvatarPose = {
  expressionIndex: number;
  headRotation: HeadRotation;
};

function setStatus(message: string, tone: "idle" | "error" | "success" = "idle") {
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
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

function setLipSyncStatus(
  message: string,
  tone: "idle" | "error" | "success" = "idle",
) {
  if (!lipSyncStatusEl) return;

  lipSyncStatusEl.textContent = message;
  lipSyncStatusEl.dataset.tone = tone;
}

function userFacingError(
  code: AppErrorCode,
  error: unknown,
  context: Record<string, unknown> = {},
): string {
  reportAppError(code, error, context);
  return friendlyErrorMessage(code);
}

function logRenderEvent(message: string, details: Record<string, unknown> = {}) {
  console.info(`[MiiTuber] ${message}`, details);
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

  if (trackingSourceSelect) {
    trackingSourceSelect.disabled = tracking;
  }
}

type TrackingSource = "camera" | "mouse";

function getTrackingSource(): TrackingSource {
  return trackingSourceSelect?.value === "mouse" ? "mouse" : "camera";
}

function showTrackingSourceFields(source: TrackingSource) {
  if (cameraTrackingFieldsEl) cameraTrackingFieldsEl.hidden = source !== "camera";
  if (mouseTrackingNoteEl) mouseTrackingNoteEl.hidden = source !== "mouse";
  if (blinkModeFieldEl) blinkModeFieldEl.hidden = source !== "camera";
}

function getTrackingFps() {
  const fps = Number(trackingFpsSelect?.value ?? "60");
  return Number.isFinite(fps) && fps > 0 ? fps : 60;
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
const mouseTracker = new MouseTracker();
const expressionPipeline = new ExpressionPipeline(tuningProfile);
const avatarPoseCoordinator = new AvatarPoseCoordinator(expressionPipeline);

window.addEventListener("resize", () => avatarScene.resize());
void initializeMainWindow();

async function initializeMainWindow() {
  await initializeTuningProfilePersistence();
  populateExpressionSelect();
  populateTuningControls();
  updateAvatarBackground();
  initializeBodyVisibleToggle();
  initializeAutoBlink();
  initializeMirrorTracking();
  initializeTrackingSource();
  initializeShadingStyle();
  initializeDebugInfoToggle();
  resetAvatarTrackingState();
  setTrackingButtons();
  setLipSyncButtons();
  setLipSyncDebugValue(0);
  setAppMode("library");
  renderLibraryGrid();
  wireLibraryControls();
  wireTourControls();
  navigator.mediaDevices?.addEventListener("devicechange", () => {
    void refreshCameraList();
  });
  void refreshCameraList();
  void updateExperience.start();
  void refreshMicrophoneList();
  // Warm the renderer first: on first run this raises the blocking resource
  // gate. The library tour starts only after the resource is present, keeping
  // the tour from appearing behind the gate.
  void prewarmFflRenderer().then(() => {
    rendererPrewarmFinished = true;
    startTourIfNeeded("library");
  });
}

function setAvatarPose(expressionIndex: number, headRotation: HeadRotation) {
  baseExpressionIndex = expressionIndex;
  const displayedExpressionIndex = autoBlinkClosed
    ? withBlink(expressionIndex)
    : expressionIndex;
  currentAvatarPose = { expressionIndex: displayedExpressionIndex, headRotation };
  avatarScene.setExpression(displayedExpressionIndex);
  avatarScene.setHeadRotation({
    pitch: headRotation.pitch + tuningProfile.headRotationOffset.pitch,
    roll: headRotation.roll + tuningProfile.headRotationOffset.roll,
    yaw: headRotation.yaw + tuningProfile.headRotationOffset.yaw,
  }, headRotation.yaw);
}

function applyExpressionPose(expressionIndex: number, headRotation: HeadRotation) {
  setAvatarPose(expressionIndex, headRotation);
  syncExpressionSelect(expressionIndex);
  return expressionIndex;
}

function syncExpressionSelect(expressionIndex: number) {
  if (expressionSelect) expressionSelect.value = String(expressionIndex);
}

function readCurrentBackground(): AvatarBackground {
  return {
    color: backgroundColorInput?.value ?? "#e8f0f7",
    transparent: isolateMode || (transparentBackgroundInput?.checked ?? false),
  };
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

let cameraRefreshSequence = 0;

async function refreshCameraList(options: { primePermission?: boolean } = {}) {
  if (!cameraSelect) return;

  const refreshSequence = ++cameraRefreshSequence;
  const selectedDeviceId = cameraSelect.value;

  try {
    const cameras = await faceTracker.listCameras(options);
    if (refreshSequence !== cameraRefreshSequence) return;

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

    if (cameras.some((camera) => camera.deviceId === selectedDeviceId)) {
      cameraSelect.value = selectedDeviceId;
    }
    cameraSelect.disabled = false;
    logRenderEvent("camera list refreshed", { count: cameras.length });
  } catch (error) {
    if (refreshSequence !== cameraRefreshSequence) return;
    cameraSelect.disabled = cameraSelect.options.length <= 1;
    reportAppError(mediaErrorCode("camera", error), error, { action: "list devices" });
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
    reportAppError(mediaErrorCode("microphone", error), error, { action: "list devices" });
  }
}

expressionSelect?.addEventListener("change", () => {
  const expressionIndex = Number(expressionSelect.value);
  applyExpressionPose(expressionIndex, currentAvatarPose.headRotation);
  logRenderEvent("manual expression selected", { expressionIndex });
});

for (const input of blinkModeInputs) {
  input.addEventListener("change", () => {
    if (!input.checked || !isBlinkMode(input.value)) return;
    writeStringPreference(BLINK_MODE_STORAGE_KEY, input.value);
    applyBlinkMode(input.value);
    logRenderEvent("blink mode changed", { mode: input.value });
  });
}

for (const input of [blinkRateInput, blinkDurationInput]) {
  input?.addEventListener("input", () => {
    const options = readAutoBlinkInputs();
    writeJsonPreference(AUTO_BLINK_OPTIONS_STORAGE_KEY, options);
    applyAutoBlinkOptions(options);
  });
}

trackingSourceSelect?.addEventListener("change", () => {
  const source = getTrackingSource();
  writeStringPreference(TRACKING_SOURCE_STORAGE_KEY, source);
  showTrackingSourceFields(source);
  applyBlinkMode(blinkMode);
  logRenderEvent("tracking source changed", { source });
});

mirrorTrackingInput?.addEventListener("change", () => {
  const enabled = mirrorTrackingInput.checked;
  writeBooleanPreference(MIRROR_TRACKING_STORAGE_KEY, enabled);
  expressionPipeline.setMirrorTracking(enabled);
  logRenderEvent("mirror tracking toggled", { enabled });
});

shadingStyleSelect?.addEventListener("change", () => {
  const style = shadingStyleSelect.value;
  if (isShadingStyle(style)) void applyShadingStyle(style);
});

for (const input of [upperBodyIntensityInput, upperBodyIntensityValue]) {
  input?.addEventListener("input", () => {
    if (!Number.isFinite(input.valueAsNumber)) return;
    const intensity = normalizeBodyIntensity(input.valueAsNumber * 100);
    applyBodyIntensity(intensity);
    writeJsonPreference(UPPER_BODY_INTENSITY_STORAGE_KEY, intensity);
  });
}

for (const input of [upperBodyMaxTurnInput, upperBodyMaxTurnValue]) {
  input?.addEventListener("input", () => {
    if (!Number.isFinite(input.valueAsNumber)) return;
    const value = normalizeBodyMaxTurn(input.valueAsNumber);
    applyBodyMaxTurn(value);
    writeJsonPreference(UPPER_BODY_MAX_TURN_STORAGE_KEY, value);
  });
}

bodyMovementReset?.addEventListener("click", () => {
  applyBodyIntensity(100);
  applyBodyMaxTurn(30);
  writeJsonPreference(UPPER_BODY_INTENSITY_STORAGE_KEY, 100);
  writeJsonPreference(UPPER_BODY_MAX_TURN_STORAGE_KEY, 30);
});

upperBodyFollowInput?.addEventListener("change", () => {
  const enabled = upperBodyFollowInput.checked;
  setBodyMovementControlsEnabled(enabled);
  avatarScene.setUpperBodyFollow(enabled);
  writeBooleanPreference(UPPER_BODY_FOLLOW_STORAGE_KEY, enabled);
});

bodyVisibleInput?.addEventListener("change", () => {
  const visible = bodyVisibleInput.checked;
  avatarScene.setBodyVisible(visible);
  writeBooleanPreference(BODY_VISIBLE_STORAGE_KEY, visible);
  logRenderEvent("body visibility toggled", { visible });
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

isolateCaptureButton?.addEventListener("click", () => {
  setIsolateMode(true);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isolateMode) {
    setIsolateMode(false);
  }
});

startLipSyncButton?.addEventListener("click", () => {
  void requestStartLipSync();
});

async function requestStartLipSync() {
  try {
    await startLipSync();
  } catch (error) {
    stopLipSync();
    setLipSyncStatus(userFacingError(mediaErrorCode("microphone", error), error, {
      action: "start lip sync",
    }), "error");
    speakError(miiMicrophoneErrorLine(error));
  }
}

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

resetProfileButton?.addEventListener("click", () => {
  const confirmed = window.confirm(
    "Restore all expression tuning and calibration values to their defaults?",
  );
  if (!confirmed) return;

  applyTuningProfile(createDefaultTuningProfile());
  setCalibrationStatus("Restored the default tuning profile.", "success");
});

async function initializeTuningProfilePersistence() {
  try {
    await tuningProfileStore.open();
  } catch (error) {
    setCalibrationStatus(userFacingError("TUNING_SAVE_FAILED", error, {
      action: "open automatic storage",
    }), "error");
    return;
  }
  if (tuningStorageNoteEl) {
    if (tuningProfileStore.isTauri) {
      tuningStorageNoteEl.textContent = "Changes are saved automatically inside MiiTuber.";
      tuningStorageNoteEl.title = "MiiTuber keeps a private working copy in its app data.";
    } else {
      tuningStorageNoteEl.textContent = "Changes are saved automatically in this browser.";
    }
  }

  try {
    const savedProfile = await tuningProfileStore.readWorkingCopy();
    if (savedProfile) {
      applyTuningProfile(parseTuningProfileJson(savedProfile), { persist: false });
    }
  } catch (error) {
    setCalibrationStatus(userFacingError("TUNING_IMPORT_INVALID", error, {
      action: tuningProfileStore.isTauri
        ? "load automatic working copy"
        : "load browser working copy",
    }), "error");
  }
}

function scheduleTuningProfileSave() {
  tuningProfileStore.scheduleSave(
    () => serializeTuningProfile(tuningProfile),
    (error) => {
      setCalibrationStatus(userFacingError("TUNING_SAVE_FAILED", error, {
        action: "automatic save",
      }), "error");
    },
  );
}

saveProfileButton?.addEventListener("click", async () => {
  try {
    if (await tuningProfileStore.saveCopy(serializeTuningProfile(tuningProfile))) {
      setCalibrationStatus("Saved a copy of your tuning profile.", "success");
    }
  } catch (error) {
    setCalibrationStatus(userFacingError("TUNING_SAVE_FAILED", error, {
      action: "save copy",
    }), "error");
  }
});

loadProfileButton?.addEventListener("click", async () => {
  try {
    const profileJson = await tuningProfileStore.importCopy();
    if (profileJson === null) return;

    applyTuningProfile(parseTuningProfileJson(profileJson));
    setCalibrationStatus("Imported your tuning profile.", "success");
  } catch (error) {
    setCalibrationStatus(userFacingError("TUNING_IMPORT_INVALID", error, {
      action: "import",
    }), "error");
  }
});

function populateTuningControls() {
  if (signalTuningControlsEl) {
    signalTuningControlsEl.textContent = "";
    for (const signalName of SIGNAL_NAMES) {
      signalTuningControlsEl.append(createSignalTuningRow(signalName));
    }
  }
  if (micMouthTuningControlEl) {
    micMouthTuningControlEl.replaceChildren(createMicMouthTuningRow());
  }

  oneEuroSmoothingInput?.addEventListener("input", () => {
    tuningProfile.oneEuro = oneEuroParamsFromSmoothing(
      clampNumber(oneEuroSmoothingInput.valueAsNumber, 0, 100),
    );
    applyTuningProfile(tuningProfile);
  });

  for (const { axis, input } of headRotationOffsetControls) {
    input?.addEventListener("input", () => {
      tuningProfile.headRotationOffset[axis] = clampNumber(input.valueAsNumber, -45, 45);
      applyTuningProfile(tuningProfile);
    });
  }

  showDebugInfoInput?.addEventListener("change", () => {
    setDebugInfoVisible(showDebugInfoInput.checked);
    writeBooleanPreference(SHOW_DEBUG_INFO_STORAGE_KEY, showDebugInfoInput.checked);
  });
  minimumHoldMsInput?.addEventListener("change", () => {
    tuningProfile.minimumHoldMs = nonNegativeInputValue(
      minimumHoldMsInput,
      tuningProfile.minimumHoldMs,
    );
    applyTuningProfile(tuningProfile);
  });
  renderTuningControls();
}

function createMicMouthTuningRow() {
  const row = document.createElement("div");
  row.className = "signal-tuning-row";

  const label = document.createElement("strong");
  label.textContent = "Mouth activation (microphone)";

  const state = document.createElement("span");
  state.className = "signal-state";
  state.dataset.micMouthState = "true";
  state.textContent = "off";

  const header = document.createElement("div");
  header.className = "signal-tuning-row__header";
  header.append(label, state);

  const rail = document.createElement("div");
  rail.className = "threshold-rail";
  rail.dataset.micMouthRail = "true";
  rail.innerHTML = '<span class="threshold-band"></span><span class="threshold-marker threshold-marker--exit"></span><span class="threshold-marker threshold-marker--enter"></span><span class="threshold-score"></span>';

  row.append(
    header,
    rail,
    createMicMouthRangeInput("enter", "Enter"),
    createMicMouthRangeInput("exit", "Exit"),
    createMicMouthRangeInput("gain", "Gain"),
  );
  return row;
}

function createMicMouthRangeInput(
  field: "enter" | "exit" | "gain",
  labelText: string,
) {
  const label = document.createElement("label");
  const labelTextEl = document.createElement("span");
  labelTextEl.className = "signal-control-label";
  labelTextEl.textContent = labelText;

  const input = document.createElement("input");
  input.type = "range";
  input.step = "0.01";
  input.min = "0";
  input.max = field === "gain" ? "3" : "1";
  input.dataset.micMouthField = field;
  input.addEventListener("change", () => {
    tuningProfile.lipSync.activation[field] = clampNumber(
      input.valueAsNumber,
      0,
      field === "gain" ? 3 : 1,
    );
    if (tuningProfile.lipSync.activation.exit > tuningProfile.lipSync.activation.enter) {
      tuningProfile.lipSync.activation.exit = tuningProfile.lipSync.activation.enter;
    }
    applyTuningProfile(tuningProfile);
  });

  const value = document.createElement("span");
  value.className = "signal-control-value";
  value.dataset.micMouthValue = field;
  label.append(labelTextEl, input, value);
  return label;
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
  const labels: Record<SignalName, string> = {
    mouthOpen: "Mouth open (camera)",
    smile: "Smile",
    blinkLeft: "Left eye blink",
    blinkRight: "Right eye blink",
    anger: "Anger",
    sorrow: "Sadness",
    surprise: "Surprise",
  };
  return labels[signalName];
}

function createSignalRangeInput(
  signalName: SignalName,
  field: "enter" | "exit" | "gain",
  labelText: string,
) {
  const label = document.createElement("label");

  const labelTextEl = document.createElement("span");
  labelTextEl.className = "signal-control-label";
  labelTextEl.textContent = labelText;

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
  label.append(labelTextEl, input, value);
  return label;
}

function applyTuningProfile(
  profile: TuningProfile,
  options: { persist?: boolean } = {},
) {
  tuningProfile = normalizeTuningProfile(profile);
  expressionPipeline.updateProfile(tuningProfile);
  lipSyncEnvelope.updateOptions(tuningProfile.lipSync);
  renderTuningControls();
  // Re-apply the current pose so a changed head rotation offset shows up
  // immediately, even when idle or when tracking has no face to report.
  setAvatarPose(baseExpressionIndex, currentAvatarPose.headRotation);
  if (options.persist !== false) scheduleTuningProfileSave();
}

function renderTuningControls() {
  const smoothing = smoothingFromOneEuroParams(tuningProfile.oneEuro);
  if (oneEuroSmoothingInput) {
    oneEuroSmoothingInput.value = String(smoothing);
  }
  if (oneEuroSmoothingValueEl) {
    oneEuroSmoothingValueEl.textContent = `${smoothing}%`;
  }
  if (minimumHoldMsInput) {
    minimumHoldMsInput.value = String(tuningProfile.minimumHoldMs);
  }

  for (const { axis, input, valueEl } of headRotationOffsetControls) {
    const offset = tuningProfile.headRotationOffset[axis];
    if (input) input.value = String(offset);
    if (valueEl) valueEl.textContent = formatHeadRotationValue(offset);
  }

  micMouthTuningControlEl
    ?.querySelectorAll<HTMLInputElement>("input[data-mic-mouth-field]")
    .forEach((input) => {
      const field = input.dataset.micMouthField as "enter" | "exit" | "gain";
      input.value = String(tuningProfile.lipSync.activation[field]);
    });

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
  renderSignalDebugState(
    { ...latestExpressionScores, mouthOpen: latestCameraMouthScore },
    { ...latestExpressionSignals, mouthOpen: latestCameraMouthSignal },
  );
  renderMicMouthTuningState(
    latestMicrophoneMouthScore,
    latestMicrophoneMouthSignal,
  );
}

function easeHeadTowardNeutral(now: number) {
  if (faceLostAt === null) {
    faceLostAt = now;
    faceLostLastFrameAt = now;
    return;
  }
  if (now - faceLostAt < FACE_LOST_HOLD_MS) {
    faceLostLastFrameAt = now;
    return;
  }

  const { headRotation } = currentAvatarPose;
  const { pitch, yaw, roll } = headRotation;
  if (Math.max(Math.abs(pitch), Math.abs(yaw), Math.abs(roll)) < 0.1) return;

  const dt = now - faceLostLastFrameAt;
  faceLostLastFrameAt = now;
  const keep = Math.exp(-dt / FACE_LOST_EASE_TAU_MS);
  applyExpressionPose(baseExpressionIndex, {
    pitch: pitch * keep,
    yaw: yaw * keep,
    roll: roll * keep,
  });
}

function handleTrackingFrame({ results, trackingFps, detectMs }: FaceTrackerFrame) {
  const blendshapes = results.faceBlendshapes?.[0]?.categories ?? [];
  const matrixData = results.facialTransformationMatrixes?.[0]?.data;
  const transformMatrix = matrixData ? new Float32Array(matrixData) : undefined;

  if (blendshapes.length === 0) {
    avatarPoseCoordinator.markFaceMissing();
    easeHeadTowardNeutral(performance.now());
    renderBlendshapeBars([]);
    setTrackingStatus("Tracking, but no face is currently detected.", "idle");
    return;
  }

  faceLostAt = null;
  const now = performance.now();
  updateCalibrationSession(blendshapes, now);
  const pipelineFrame = avatarPoseCoordinator.updateCamera(
    { blendshapes, transformMatrix, trackingFps, detectMs },
    now,
    getExternalMouthOpenScore(),
    getMouthOpenSource(),
  );
  const expressionIndex = applyCoordinatedAvatarPose(pipelineFrame, "camera");

  setTrackingStatus(
    `Tracking face at ${Math.round(trackingFps)} fps. Expression ${expressionLabel(expressionIndex)}.`,
    "success",
  );
}

/**
 * Applies the latest camera and microphone inputs through one expression
 * pipeline. Camera frames refresh the full face pose; microphone frames can
 * independently refresh the mouth, including when the camera is stopped or
 * temporarily cannot see a face.
 */
function applyCoordinatedAvatarPose(
  pipelineFrame: ReturnType<AvatarPoseCoordinator["updateMicrophone"]>,
  updateSource: "camera" | "microphone",
) {
  latestExpressionScores = pipelineFrame.rawMapped.scores;
  latestExpressionSignals = pipelineFrame.signals;
  latestCameraMouthScore = pipelineFrame.cameraMouthOpenScore;
  latestCameraMouthSignal = pipelineFrame.cameraMouthOpenSignal;
  latestMicrophoneMouthScore = pipelineFrame.microphoneMouthOpenScore;
  latestMicrophoneMouthSignal = pipelineFrame.microphoneMouthOpenSignal;

  // With no current face, retain the existing head pose. The camera's
  // no-face path owns the hold/ease behavior; microphone updates only change
  // the expression and must not snap the head back to an old camera matrix.
  const headRotation =
    updateSource === "microphone" && !avatarPoseCoordinator.isFaceDetected()
      ? currentAvatarPose.headRotation
      : pipelineFrame.headRotation;
  const expressionIndex = applyExpressionPose(
    pipelineFrame.expressionIndex,
    headRotation,
  );

  const cameraDebug = avatarPoseCoordinator.getCameraDebugState();
  setDebugValues(
    expressionIndex,
    formatChannels(pipelineFrame.mapped.channels),
    pipelineFrame.remainingHoldMs,
    headRotation,
    cameraDebug.trackingFps,
    cameraDebug.detectMs,
    formatExpressionScores(pipelineFrame.mapped.scores),
    formatTopBlendshapes(cameraDebug.blendshapes),
  );
  renderSignalDebugState(
    { ...pipelineFrame.rawMapped.scores, mouthOpen: pipelineFrame.cameraMouthOpenScore },
    { ...pipelineFrame.signals, mouthOpen: pipelineFrame.cameraMouthOpenSignal },
  );
  renderMicMouthTuningState(
    pipelineFrame.microphoneMouthOpenScore,
    pipelineFrame.microphoneMouthOpenSignal,
  );
  if (updateSource === "camera") {
    renderBlendshapeBars(
      cameraDebug.blendshapes,
      pipelineFrame.smoothedBlendshapes,
    );
  }
  return expressionIndex;
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
    if (getMouthOpenSource() !== "camera") {
      const pipelineFrame = avatarPoseCoordinator.updateMicrophone(
        performance.now(),
        getExternalMouthOpenScore(),
        getMouthOpenSource(),
      );
      applyCoordinatedAvatarPose(pipelineFrame, "microphone");
    }
    lipSyncAnimationId = requestAnimationFrame(update);
  };
  update();

  setLipSyncButtons(true);
  void refreshMicrophoneList();
  setLipSyncStatus("Mic lip-sync running. Mouth source controls how it blends.", "success");
}

function stopLipSync(message?: string) {
  const microphoneWasDrivingMouth = getMouthOpenSource() !== "camera";
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
  if (microphoneWasDrivingMouth) {
    const pipelineFrame = avatarPoseCoordinator.updateMicrophone(
      performance.now(),
      0,
      getMouthOpenSource(),
    );
    applyCoordinatedAvatarPose(pipelineFrame, "microphone");
  }
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

startTrackingButton?.addEventListener("click", () => {
  void startTracking();
});

async function startTracking() {
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

  if (getTrackingSource() === "mouse") {
    startMouseTracking();
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
    setTrackingStatus(userFacingError(mediaErrorCode("camera", error), error, {
      action: "start tracking",
    }), "error");
    speakError(miiCameraErrorLine(error));
  }
}

function startMouseTracking() {
  if (!isRunningInTauri()) {
    setTrackingStatus("Mouse tracking only works in the MiiTuber app.", "error");
    return;
  }

  tracking = true;
  setTrackingButtons();
  mouseTracker.start(
    {
      getHeadClientPosition: () => avatarScene.headClientPosition(),
      onRotation: (rotation) => {
        setAvatarPose(baseExpressionIndex, rotation);
      },
      onUnsupported: () => {
        tracking = false;
        resetAvatarTrackingState();
        setTrackingButtons();
        setTrackingStatus(
          "Couldn't read your cursor. On Linux, mouse tracking needs an X11 session (Wayland hides the cursor).",
          "error",
        );
      },
      onError: (error) => {
        console.error("[MiiTuber] mouse tracking failed", error);
        tracking = false;
        resetAvatarTrackingState();
        setTrackingButtons();
        setTrackingStatus("Mouse tracking stopped unexpectedly.", "error");
      },
    },
    currentAvatarPose.headRotation,
  );
  setTrackingStatus("Following your mouse.", "success");
}

function handleTrackingRuntimeError(error: unknown) {
  tracking = false;
  resetAvatarTrackingState();
  setTrackingButtons();
  setTrackingStatus(userFacingError(mediaErrorCode("camera", error), error, {
    action: "tracking runtime",
  }), "error");
}

stopTrackingButton?.addEventListener("click", () => {
  stopTracking(
    getTrackingSource() === "mouse"
      ? "Mouse tracking stopped."
      : "Tracking stopped. Camera released.",
  );
});

function stopTracking(message?: string) {
  faceTracker.stop();
  mouseTracker.stop();
  tracking = false;
  resetAvatarTrackingState();
  setTrackingButtons();

  if (message) {
    setTrackingStatus(message);
  }
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

  if (isolateHintEl) {
    // Re-trigger the fade animation each time isolate mode is entered so the
    // "Press Esc to go back" prompt reappears; it fades fully out on its own.
    isolateHintEl.classList.remove("is-visible");
    if (enabled) {
      void isolateHintEl.offsetWidth; // force reflow to restart the animation
      isolateHintEl.classList.add("is-visible");
    }
  }

  // Keep the user's orbit/zoom — entering or leaving isolate mode should only
  // change the background, never re-frame the camera.
  updateAvatarBackground();
  requestAnimationFrame(() => {
    avatarScene.resize();
  });
  logRenderEvent("capture isolate toggled", { enabled });
}

function updateAvatarBackground() {
  const { color, transparent } = readCurrentBackground();
  avatarScene.setBackground({ color, transparent });
  previewFrameEl?.classList.toggle("transparent-preview", transparent);
  document.documentElement.style.setProperty("--avatar-background", color);
  document.documentElement.style.backgroundColor = "";
  document.body.style.backgroundColor = "";
  canvas.style.backgroundColor = "";
}

function resetAvatarTrackingState() {
  faceLostAt = null;
  avatarPoseCoordinator.reset();
  const expressionIndex = applyExpressionPose(FFLExpression.Normal, {
    pitch: 0,
    yaw: 0,
    roll: 0,
  });
  setDebugValues(
    expressionIndex,
    formatChannels({ eyes: "open", mouth: "closed", emotion: "normal" }),
    0,
    { pitch: 0, yaw: 0, roll: 0 },
    0,
  );
  latestExpressionScores = zeroExpressionScores();
  latestExpressionSignals = zeroExpressionSignals();
  latestCameraMouthScore = 0;
  latestCameraMouthSignal = false;
  latestMicrophoneMouthScore = 0;
  latestMicrophoneMouthSignal = false;
  renderSignalDebugState(latestExpressionScores, latestExpressionSignals);
  renderMicMouthTuningState(0, false);
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

function renderMicMouthTuningState(score: number, active: boolean) {
  const activation = tuningProfile.lipSync.activation;
  const stateEl = micMouthTuningControlEl?.querySelector<HTMLElement>(
    "[data-mic-mouth-state]",
  );
  if (stateEl) {
    stateEl.textContent = active ? "on" : "off";
    stateEl.dataset.active = String(active);
  }

  const rail = micMouthTuningControlEl?.querySelector<HTMLElement>(
    "[data-mic-mouth-rail]",
  );
  if (rail) {
    rail.style.setProperty("--exit", String(activation.exit * 100));
    rail.style.setProperty("--enter", String(activation.enter * 100));
    rail.style.setProperty("--score", String(clamp01(score) * 100));
  }

  micMouthTuningControlEl
    ?.querySelectorAll<HTMLElement>("[data-mic-mouth-value]")
    .forEach((valueEl) => {
      const field = valueEl.dataset.micMouthValue as "enter" | "exit" | "gain";
      valueEl.textContent = activation[field].toFixed(2);
    });
}

function nonNegativeInputValue(input: HTMLInputElement, fallback: number) {
  return input.valueAsNumber >= 0 ? input.valueAsNumber : fallback;
}






function getLibraryStorage() {
  return window.localStorage;
}

function getTourStorage() {
  return window.localStorage;
}





function setBodyMovementControlsEnabled(enabled: boolean) {
  for (const input of [upperBodyIntensityInput, upperBodyIntensityValue, upperBodyMaxTurnInput, upperBodyMaxTurnValue]) {
    if (input) input.disabled = !enabled;
  }
}

function applyBodyMaxTurn(value: number) {
  if (upperBodyMaxTurnInput) upperBodyMaxTurnInput.value = String(value);
  if (upperBodyMaxTurnValue) upperBodyMaxTurnValue.value = String(value);
  avatarScene.setUpperBodyMaxTurn(value);
}

function applyBodyIntensity(intensity: number) {
  if (upperBodyIntensityInput) upperBodyIntensityInput.value = String(intensity / 100);
  if (upperBodyIntensityValue) upperBodyIntensityValue.value = String(intensity / 100);
  avatarScene.setUpperBodyIntensity(intensity);
}

function initializeBodyVisibleToggle() {
  applyBodyMaxTurn(normalizeBodyMaxTurn(readJsonPreference(UPPER_BODY_MAX_TURN_STORAGE_KEY)));
  applyBodyIntensity(normalizeBodyIntensity(readJsonPreference(UPPER_BODY_INTENSITY_STORAGE_KEY)));
  const follow = readBooleanPreference(UPPER_BODY_FOLLOW_STORAGE_KEY, false);
  if (upperBodyFollowInput) upperBodyFollowInput.checked = follow;
  setBodyMovementControlsEnabled(follow);
  avatarScene.setUpperBodyFollow(follow);
  const visible = readBooleanPreference(BODY_VISIBLE_STORAGE_KEY, true);
  if (bodyVisibleInput) bodyVisibleInput.checked = visible;
  avatarScene.setBodyVisible(visible);
}



function initializeAutoBlink() {
  const storedMode = readStringPreference(BLINK_MODE_STORAGE_KEY);
  applyAutoBlinkOptions(
    normalizeAutoBlinkOptions(readJsonPreference(AUTO_BLINK_OPTIONS_STORAGE_KEY)),
  );
  applyBlinkMode(isBlinkMode(storedMode) ? storedMode : DEFAULT_BLINK_MODE);
  window.setInterval(tickAutoBlink, AUTO_BLINK_TICK_MS);
}

function applyBlinkMode(mode: BlinkMode) {
  blinkMode = mode;
  for (const input of blinkModeInputs) input.checked = input.value === mode;
  if (blinkModeHintEl) blinkModeHintEl.textContent = BLINK_MODE_HINTS[mode];
  const autoDisabled = !autoBlinkActive();
  if (blinkRateInput) blinkRateInput.disabled = autoDisabled;
  if (blinkDurationInput) blinkDurationInput.disabled = autoDisabled;
  expressionPipeline.setBlinkMode(mode);
  tickAutoBlink();
}

function readAutoBlinkInputs(): AutoBlinkOptions {
  return normalizeAutoBlinkOptions({
    blinksPerMinute: Number(blinkRateInput?.value),
    durationMs: Number(blinkDurationInput?.value),
  });
}

function applyAutoBlinkOptions(options: AutoBlinkOptions) {
  if (blinkRateInput) blinkRateInput.value = String(options.blinksPerMinute);
  if (blinkRateValueEl) blinkRateValueEl.textContent = String(options.blinksPerMinute);
  if (blinkDurationInput) blinkDurationInput.value = String(options.durationMs);
  if (blinkDurationValueEl) blinkDurationValueEl.textContent = `${options.durationMs} ms`;
  autoBlinker.setOptions(options);
}

function initializeTrackingSource() {
  const stored = readStringPreference(TRACKING_SOURCE_STORAGE_KEY);
  const source: TrackingSource = stored === "mouse" ? "mouse" : "camera";
  if (trackingSourceSelect) trackingSourceSelect.value = source;
  showTrackingSourceFields(source);
  applyBlinkMode(blinkMode);
}

function initializeMirrorTracking() {
  const enabled = readBooleanPreference(MIRROR_TRACKING_STORAGE_KEY, false);
  if (mirrorTrackingInput) mirrorTrackingInput.checked = enabled;
  expressionPipeline.setMirrorTracking(enabled);
}

let activeShadingStyle: ShadingStyle = DEFAULT_SHADING_STYLE;

function initializeShadingStyle() {
  const stored = readStringPreference(SHADING_STYLE_STORAGE_KEY);
  activeShadingStyle = isShadingStyle(stored) ? stored : DEFAULT_SHADING_STYLE;
  if (shadingStyleSelect) shadingStyleSelect.value = activeShadingStyle;
  // No model is loaded yet, so this only sets the style the first load uses.
  void avatarScene.setShadingStyle(activeShadingStyle);
}

async function applyShadingStyle(style: ShadingStyle) {
  const previous = activeShadingStyle;
  activeShadingStyle = style;
  writeStringPreference(SHADING_STYLE_STORAGE_KEY, style);
  try {
    await avatarScene.setShadingStyle(style);
    logRenderEvent("shading style changed", { style });
  } catch (error) {
    // The rebuild failed before the old model was disposed, so the previous
    // style is still on screen. Put the picker back to match it.
    console.error("[MiiTuber] shading style change failed", { style, error });
    if (activeShadingStyle !== style) return; // A newer change superseded this one.
    activeShadingStyle = previous;
    writeStringPreference(SHADING_STYLE_STORAGE_KEY, previous);
    if (shadingStyleSelect) shadingStyleSelect.value = previous;
    void avatarScene.setShadingStyle(previous);
    setStatus("Could not switch shading style.", "error");
  }
}

function autoBlinkActive() {
  return getTrackingSource() === "mouse" || usesAutoBlink(blinkMode);
}

function tickAutoBlink() {
  const active = autoBlinkActive();
  if (!active) autoBlinker.reset();
  const closed = active && autoBlinker.update(performance.now());
  if (closed === autoBlinkClosed) return;

  autoBlinkClosed = closed;
  setAvatarPose(baseExpressionIndex, currentAvatarPose.headRotation);
}

function initializeDebugInfoToggle() {
  setDebugInfoVisible(readBooleanPreference(SHOW_DEBUG_INFO_STORAGE_KEY, false));
}

function setDebugInfoVisible(visible: boolean) {
  if (showDebugInfoInput) showDebugInfoInput.checked = visible;
  if (advancedDebugInfoEl) advancedDebugInfoEl.hidden = !visible;
}

function wireTourControls() {
  tourReplayButton?.addEventListener("click", replayCurrentTour);
}

function replayCurrentTour() {
  const chapterId: TourChapterId = appShellEl?.classList.contains("mode-workspace")
    ? "workspace"
    : "library";
  startTour(chapterId);
}

function startTourIfNeeded(chapterId: TourChapterId) {
  if (
    updateExperience.isBlocking() ||
    activeTourChapterId === chapterId
  ) return;

  const state = readTourState(getTourStorage());
  if (shouldAutoStart(chapterId, state)) {
    startTour(chapterId);
  }
}

function startTour(chapterId: TourChapterId) {
  if (!tourRootEl) return;

  endActiveTour();
  errorSpeaker?.dismiss();

  const controller = new TourController((completedChapterId) => {
    const state = readTourState(getTourStorage());
    writeTourState(getTourStorage(), {
      ...state,
      [completedChapterId]: true,
    });

    if (activeTourController === controller) {
      activeTourController = null;
      activeTourPresenter = null;
      activeTourChapterId = null;
    }
  });
  controller.start(TOUR_CHAPTERS[chapterId]);

  const presenter = new TourPresenter({
    root: tourRootEl,
    controller,
    sfxUrl: "/mii-sfx.m4a",
    portraitBaseUrl: "/tour/",
  });

  activeTourController = controller;
  activeTourPresenter = presenter;
  activeTourChapterId = chapterId;
  presenter.start();
}

function speakError(line: MiiErrorLine) {
  getErrorSpeaker()?.speak(line);
}

function getErrorSpeaker(): ErrorSpeaker | null {
  if (!tourRootEl) return null;

  errorSpeaker ??= new ErrorSpeaker({
    root: tourRootEl,
    sfxUrl: "/mii-sfx.m4a",
    portraitBaseUrl: "/tour/",
    isTourActive: () => activeTourPresenter !== null,
  });
  return errorSpeaker;
}

function endActiveTour() {
  const controller = activeTourController;
  const presenter = activeTourPresenter;

  activeTourController = null;
  activeTourPresenter = null;
  activeTourChapterId = null;

  controller?.skip();
  presenter?.destroy();
}

function setAppMode(mode: "library" | "workspace") {
  if (!appShellEl) return;
  appShellEl.classList.toggle("mode-library", mode === "library");
  appShellEl.classList.toggle("mode-workspace", mode === "workspace");

  if (mode === "workspace") {
    startTourIfNeeded("workspace");
  }
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
    void requestRenameAvatar(avatar);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void requestDeleteAvatar(avatar);
  });

  menu.append(renameBtn, deleteBtn);
  tile.append(thumb, name, menu);
  return tile;
}

async function requestRenameAvatar(avatar: LibraryAvatar) {
  const nextName = await openRenameAvatarModal(avatar.name);
  if (nextName === null) return;

  const sanitizedName = sanitizeName(nextName);
  renameAvatar(getLibraryStorage(), avatar.id, sanitizedName);
  renderLibraryGrid();
  if (currentAvatarId === avatar.id && workspaceAvatarNameEl) {
    workspaceAvatarNameEl.textContent = sanitizedName;
  }
}

async function requestDeleteAvatar(avatar: LibraryAvatar) {
  const confirmed = await openDeleteAvatarModal(avatar.name);
  if (!confirmed) return;

  removeAvatar(getLibraryStorage(), avatar.id);
  if (currentAvatarId === avatar.id) {
    currentAvatarId = null;
    if (tracking) stopTracking();
    stopLipSync();
    setAppMode("library");
  }
  renderLibraryGrid();
}

function openRenameAvatarModal(currentName: string): Promise<string | null> {
  return openLibraryActionModal<string | null>({
    title: "Rename Avatar",
    buildBody: () => {
      const label = document.createElement("label");
      label.className = "field";
      label.textContent = "Name";

      const input = document.createElement("input");
      input.type = "text";
      input.value = currentName;
      input.autocomplete = "off";
      label.append(input);

      return { body: label, focusTarget: input, getValue: () => input.value };
    },
    confirmLabel: "Save",
    confirmClassName: "btn btn--primary",
  });
}

function openDeleteAvatarModal(name: string): Promise<boolean> {
  return openLibraryActionModal<boolean>({
    title: "Delete Avatar",
    buildBody: () => {
      const message = document.createElement("p");
      message.className = "library-action-message";
      message.textContent = `Delete "${name}"?`;
      return { body: message, getValue: () => true };
    },
    confirmLabel: "Delete",
    confirmClassName: "btn btn--danger",
  }).then(Boolean);
}

type LibraryActionModalOptions<T> = {
  title: string;
  buildBody: () => {
    body: HTMLElement;
    focusTarget?: HTMLElement;
    getValue: () => T;
  };
  confirmLabel: string;
  confirmClassName: string;
};

function openLibraryActionModal<T>(
  options: LibraryActionModalOptions<T>,
): Promise<T | null> {
  if (
    !libraryActionModal ||
    !libraryActionTitle ||
    !libraryActionClose ||
    !libraryActionBody ||
    !libraryActionFooter
  ) {
    return Promise.resolve(null);
  }

  libraryActionTitle.textContent = options.title;
  libraryActionBody.textContent = "";
  libraryActionFooter.textContent = "";

  const { body, focusTarget, getValue } = options.buildBody();
  const cancelButton = document.createElement("button");
  cancelButton.className = "btn";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  const confirmButton = document.createElement("button");
  confirmButton.className = options.confirmClassName;
  confirmButton.type = "button";
  confirmButton.textContent = options.confirmLabel;

  libraryActionBody.append(body);
  libraryActionFooter.append(confirmButton, cancelButton);
  libraryActionModal.hidden = false;

  return new Promise<T | null>((resolve) => {
    let settled = false;

    const settle = (value: T | null) => {
      if (settled) return;
      settled = true;
      libraryActionModal.hidden = true;
      libraryActionClose.removeEventListener("click", onCancel);
      cancelButton.removeEventListener("click", onCancel);
      confirmButton.removeEventListener("click", onConfirm);
      libraryActionModal.removeEventListener("click", onScrimClick);
      window.removeEventListener("keydown", onKeyDown);
      resolve(value);
    };

    const onCancel = () => settle(null);
    const onConfirm = () => settle(getValue());
    const onScrimClick = (event: MouseEvent) => {
      if (event.target === libraryActionModal) onCancel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };

    libraryActionClose.addEventListener("click", onCancel);
    cancelButton.addEventListener("click", onCancel);
    confirmButton.addEventListener("click", onConfirm);
    libraryActionModal.addEventListener("click", onScrimClick);
    window.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => (focusTarget ?? confirmButton).focus());
  });
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
        openPopover(popover, index);
        if (name === "tracking") {
          void refreshCameraList({ primePermission: true });
        }
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
  setImportStatus("Rendering a preview...");

  try {
    const buffer = await file.arrayBuffer();
    const miiBytes = normalizeMiiBytes(new Uint8Array(buffer));
    const bytes = Array.from(miiBytes);
    let thumbnailDataUrl: string | null = null;
    try {
      thumbnailDataUrl = await renderMiiThumbnail(miiBytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[MiiTuber] thumbnail render failed during import", {
        error,
        message,
      });
      // Same renderer the workspace uses — if it rejects the bytes here,
      // the avatar would never load. Fail the import instead of saving it.
      throw error;
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
    setImportStatus(userFacingError("AVATAR_FILE_INVALID", error), "error");
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
    setImportStatus(userFacingError("AVATAR_SAVE_FAILED", error), "error");
  }
}

/**
 * Format a head rotation offset value (pitch, yaw, roll) for display.
 */
function formatHeadRotationValue(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
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
    const dataUrl = await renderMiiThumbnail(normalizeMiiBytes(new Uint8Array(bytes)));
    setAvatarThumbnail(getLibraryStorage(), id, dataUrl);
  } catch (error) {
    console.warn("[MiiTuber] thumbnail backfill failed", { error });
  }
}

async function renderMiiThumbnail(miiBytes: Uint8Array): Promise<string> {
  const ffl = await getFflContext();
  return renderMiiThumbnailDataUrl(ffl, miiBytes);
}

async function renderAvatarBytes(miiBytes: number[], name: string) {
  try {
    const ffl = await getFflContext();
    setStatus("Rendering with in-process FFL.js...");
    const loadResult = await avatarScene.loadModelFromMiiBytes(
      normalizeMiiBytes(new Uint8Array(miiBytes)),
      ffl,
    );
    const expressionIndex = applyExpressionPose(FFLExpression.Normal, {
      pitch: 0,
      yaw: 0,
      roll: 0,
    });

    if (expressionSelect) {
      expressionSelect.disabled = loadResult.expressionCount === 0;
      expressionSelect.value = String(expressionIndex);
    }
    avatarLoaded = true;
    avatarHasExpressionVariants = loadResult.expressionCount > 0;
    setTrackingButtons();

    logRenderEvent("avatar render succeeded", {
      name,
      renderer: "ffl.js",
      ...loadResult,
    });
    if (emptyPreviewEl) emptyPreviewEl.hidden = true;
    setStatus("");
    setTrackingStatus(
      loadResult.expressionCount > 0
        ? "Ready to start webcam tracking."
        : "Tracking needs supported avatar expressions.",
      loadResult.expressionCount > 0 ? "success" : "error",
    );
  } catch (error) {
    avatarLoaded = false;
    avatarHasExpressionVariants = false;
    setTrackingButtons();
    setStatus(userFacingError("AVATAR_RENDER_FAILED", error, {
      renderer: "ffl.js",
    }), "error");
    speakError(miiAvatarLoadErrorLine());
  }
}

window.addEventListener("beforeunload", () => {
  faceTracker.stop();
  mouseTracker.stop();
  stopLipSync();
});
