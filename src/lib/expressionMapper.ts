import * as THREE from "three";
import {
  FFLExpression,
  type BlendshapeCategory,
  type EmotionState,
  type ExpressionChannels,
  type ExpressionResult,
  type ExpressionScores,
  type ExpressionSignals,
  type HeadRotation,
} from "./types";
import type { TuningProfile } from "./tuningProfile";

const MAX_HEAD_ROTATION_DEGREES = 30;

export function mapToExpression(
  blendshapes: BlendshapeCategory[],
  transformMatrix?: Float32Array,
  stabilizedSignals?: ExpressionSignals,
  profile?: TuningProfile,
): ExpressionResult {
  const scores = new Map<string, number>();
  for (const { categoryName, score } of blendshapes) {
    scores.set(categoryName, score);
  }

  const get = (name: string) => scores.get(name) ?? 0;
  const expressionScores = applyGains(
    {
    mouthOpen: Math.max(get("jawOpen"), (get("mouthFunnel") + get("mouthPucker")) / 2),
    smile: (get("mouthSmileLeft") + get("mouthSmileRight")) / 2,
    blinkLeft: get("eyeBlinkLeft"),
    blinkRight: get("eyeBlinkRight"),
    anger: (get("browDownLeft") + get("browDownRight")) / 2,
    sorrow: (get("mouthFrownLeft") + get("mouthFrownRight") + get("browInnerUp")) / 3,
    surprise:
      (get("eyeWideLeft") + get("eyeWideRight") + get("browInnerUp") + get("jawOpen")) /
      4,
    },
    profile,
  );

  const signals = stabilizedSignals ?? scoresToSignals(expressionScores);
  const channels = classifyChannels(expressionScores, signals);

  return {
    expressionIndex: composeExpression(channels),
    headRotation: extractHeadRotation(transformMatrix),
    scores: expressionScores,
    channels,
  };
}

function applyGains(scores: ExpressionScores, profile?: TuningProfile) {
  if (!profile) return scores;

  return Object.fromEntries(
    Object.entries(scores).map(([name, score]) => [
      name,
      clamp01(score * profile.gains[name as keyof ExpressionScores]),
    ]),
  ) as ExpressionScores;
}

export function classifyChannels(
  scores: ExpressionScores,
  signals: ExpressionSignals = scoresToSignals(scores),
): ExpressionChannels {
  return {
    eyes: classifyEyes(signals),
    mouth: signals.mouthOpen ? "open" : "closed",
    emotion: classifyEmotion(scores, signals),
  };
}

export function composeExpression(channels: ExpressionChannels): FFLExpression {
  const mouthOpen = channels.mouth === "open";

  if (channels.eyes === "blink_both") {
    return mouthOpen ? FFLExpression.BlinkOpenMouth : FFLExpression.Blink;
  }

  if (channels.eyes === "wink_left") {
    return mouthOpen ? FFLExpression.WinkLeftOpenMouth : FFLExpression.WinkLeft;
  }

  if (channels.eyes === "wink_right") {
    return mouthOpen ? FFLExpression.WinkRightOpenMouth : FFLExpression.WinkRight;
  }

  switch (channels.emotion) {
    case "smile":
      return mouthOpen ? FFLExpression.Happy : FFLExpression.Smile;
    case "anger":
      return mouthOpen ? FFLExpression.AngerOpenMouth : FFLExpression.Anger;
    case "sorrow":
      return mouthOpen ? FFLExpression.SorrowOpenMouth : FFLExpression.Sorrow;
    case "surprise":
      return mouthOpen ? FFLExpression.SurpriseOpenMouth : FFLExpression.Surprise;
    case "normal":
      return mouthOpen ? FFLExpression.OpenMouth : FFLExpression.Normal;
  }
}

export function scoresToSignals(scores: ExpressionScores): ExpressionSignals {
  return {
    mouthOpen: scores.mouthOpen > 0.4,
    smile: scores.smile > 0.5,
    blinkLeft: scores.blinkLeft > 0.6,
    blinkRight: scores.blinkRight > 0.6,
    anger: scores.anger > 0.5,
    sorrow: scores.sorrow > 0.5,
    surprise: scores.surprise > 0.5,
  };
}

function classifyEyes(signals: ExpressionSignals) {
  if (signals.blinkLeft && signals.blinkRight) return "blink_both";
  if (signals.blinkLeft) return "wink_left";
  if (signals.blinkRight) return "wink_right";
  return "open";
}

function classifyEmotion(
  scores: ExpressionScores,
  signals: ExpressionSignals,
): EmotionState {
  const candidates: Array<[EmotionState, number]> = [
    ["smile", signals.smile ? scores.smile : 0],
    ["anger", signals.anger ? scores.anger : 0],
    ["sorrow", signals.sorrow ? scores.sorrow : 0],
    ["surprise", signals.surprise ? scores.surprise : 0],
  ];
  const [emotion, score] = candidates.reduce((best, candidate) =>
    candidate[1] > best[1] + Number.EPSILON ? candidate : best,
  );

  return score > 0 ? emotion : "normal";
}

export function extractHeadRotation(matrix?: Float32Array): HeadRotation {
  if (!matrix || matrix.length < 16) {
    return { pitch: 0, yaw: 0, roll: 0 };
  }

  const rotationMatrix = new THREE.Matrix4().fromArray(matrix);
  const euler = new THREE.Euler().setFromRotationMatrix(rotationMatrix, "XYZ");

  return {
    pitch: clampDegrees(THREE.MathUtils.radToDeg(euler.x)),
    yaw: clampDegrees(THREE.MathUtils.radToDeg(euler.y)),
    roll: clampDegrees(THREE.MathUtils.radToDeg(euler.z)),
  };
}

function clampDegrees(value: number) {
  return THREE.MathUtils.clamp(
    value,
    -MAX_HEAD_ROTATION_DEGREES,
    MAX_HEAD_ROTATION_DEGREES,
  );
}

function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1);
}
