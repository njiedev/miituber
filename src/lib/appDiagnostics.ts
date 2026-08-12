export type AppErrorCode =
  | "CAMERA_PERMISSION_DENIED"
  | "CAMERA_NOT_FOUND"
  | "CAMERA_IN_USE"
  | "CAMERA_UNSUPPORTED_SETTINGS"
  | "CAMERA_FAILED"
  | "MICROPHONE_PERMISSION_DENIED"
  | "MICROPHONE_NOT_FOUND"
  | "MICROPHONE_IN_USE"
  | "MICROPHONE_FAILED"
  | "AVATAR_FILE_INVALID"
  | "AVATAR_SAVE_FAILED"
  | "AVATAR_RENDER_FAILED"
  | "CLEAN_VIEW_FAILED"
  | "TUNING_IMPORT_INVALID"
  | "TUNING_SAVE_FAILED"
  | "UPDATE_FAILED"
  | "UNEXPECTED_ERROR";

export type AppErrorSeverity = "warning" | "error";

export type AppErrorDetails = {
  code: AppErrorCode;
  title: string;
  message: string;
  severity: AppErrorSeverity;
};

const ERROR_DETAILS: Record<AppErrorCode, Omit<AppErrorDetails, "code">> = {
  CAMERA_PERMISSION_DENIED: {
    title: "Camera access is off",
    message: "Allow camera access for MiiTuber in your system settings, then try again.",
    severity: "warning",
  },
  CAMERA_NOT_FOUND: {
    title: "No camera found",
    message: "Connect a camera, then try again. You can still use microphone-only mode.",
    severity: "warning",
  },
  CAMERA_IN_USE: {
    title: "Camera is busy",
    message: "Another app may be using the camera. Close it there, then try again.",
    severity: "warning",
  },
  CAMERA_UNSUPPORTED_SETTINGS: {
    title: "Camera settings are unavailable",
    message: "Choose a different camera or camera setting, then try again.",
    severity: "warning",
  },
  CAMERA_FAILED: {
    title: "Camera could not start",
    message: "Reconnect the camera or restart MiiTuber, then try again.",
    severity: "error",
  },
  MICROPHONE_PERMISSION_DENIED: {
    title: "Microphone access is off",
    message: "Allow microphone access for MiiTuber in your system settings, then try again.",
    severity: "warning",
  },
  MICROPHONE_NOT_FOUND: {
    title: "No microphone found",
    message: "Connect a microphone, then try again. Camera mouth tracking is still available.",
    severity: "warning",
  },
  MICROPHONE_IN_USE: {
    title: "Microphone is busy",
    message: "Another app may be using the microphone. Close it there, then try again.",
    severity: "warning",
  },
  MICROPHONE_FAILED: {
    title: "Microphone could not start",
    message: "Reconnect the microphone or restart MiiTuber, then try again.",
    severity: "error",
  },
  AVATAR_FILE_INVALID: {
    title: "That Mii file could not be opened",
    message: "Choose a supported, unmodified Mii data file and try again.",
    severity: "warning",
  },
  AVATAR_SAVE_FAILED: {
    title: "Avatar could not be saved",
    message: "Check that MiiTuber has storage space, then try again.",
    severity: "error",
  },
  AVATAR_RENDER_FAILED: {
    title: "Mii could not be displayed",
    message: "Try the Mii file again. If it keeps happening, restart MiiTuber.",
    severity: "error",
  },
  CLEAN_VIEW_FAILED: {
    title: "OBS Clean View could not open",
    message: "Close any existing Clean View window, restart MiiTuber, and try again.",
    severity: "error",
  },
  TUNING_IMPORT_INVALID: {
    title: "That tuning profile could not be opened",
    message: "Choose a MiiTuber tuning profile JSON file and try again.",
    severity: "warning",
  },
  TUNING_SAVE_FAILED: {
    title: "Tuning changes could not be saved",
    message: "Your changes are still active for now. Check available storage, then try again.",
    severity: "error",
  },
  UPDATE_FAILED: {
    title: "Update could not be completed",
    message: "You can keep using this version. Check your connection and try again later.",
    severity: "error",
  },
  UNEXPECTED_ERROR: {
    title: "Something went wrong",
    message: "Try that action again. If it keeps happening, restart MiiTuber.",
    severity: "error",
  },
};

export function appErrorDetails(code: AppErrorCode): AppErrorDetails {
  return { code, ...ERROR_DETAILS[code] };
}

export function friendlyErrorMessage(code: AppErrorCode): string {
  const details = appErrorDetails(code);
  return `${details.title}. ${details.message}`;
}

function errorName(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  return typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : "";
}

export function mediaErrorCode(
  source: "camera" | "microphone",
  error: unknown,
): AppErrorCode {
  const name = errorName(error);
  const prefix = source === "camera" ? "CAMERA" : "MICROPHONE";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return `${prefix}_PERMISSION_DENIED` as AppErrorCode;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return `${prefix}_NOT_FOUND` as AppErrorCode;
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return `${prefix}_IN_USE` as AppErrorCode;
  }
  if (source === "camera" && name === "OverconstrainedError") {
    return "CAMERA_UNSUPPORTED_SETTINGS";
  }
  return source === "camera" ? "CAMERA_FAILED" : "MICROPHONE_FAILED";
}

export function reportAppError(
  code: AppErrorCode,
  error: unknown,
  context: Record<string, unknown> = {},
): AppErrorDetails {
  const details = appErrorDetails(code);
  console[details.severity === "error" ? "error" : "warn"](
    `[MiiTuber] ${code}`,
    error,
    context,
  );
  return details;
}
