import * as THREE from "three";
import {
  FFLExpression,
  type BlendshapeCategory,
  type ExpressionResult,
  type ExpressionSignals,
  type HeadRotation,
} from "./types";

const MAX_HEAD_ROTATION_DEGREES = 30;

export function mapToExpression(
  blendshapes: BlendshapeCategory[],
  transformMatrix?: Float32Array,
  stabilizedSignals?: ExpressionSignals,
): ExpressionResult {
  const scores = new Map<string, number>();
  for (const { categoryName, score } of blendshapes) {
    scores.set(categoryName, score);
  }

  const get = (name: string) => scores.get(name) ?? 0;
  const expressionScores = {
    mouthOpen: get("jawOpen"),
    smile: (get("mouthSmileLeft") + get("mouthSmileRight")) / 2,
    blinkLeft: get("eyeBlinkLeft"),
    blinkRight: get("eyeBlinkRight"),
    anger: (get("browDownLeft") + get("browDownRight")) / 2,
    sorrow: get("browInnerUp"),
    surprise: (get("eyeWideLeft") + get("eyeWideRight")) / 2,
  };

  const signals = stabilizedSignals ?? scoresToSignals(expressionScores);
  const mouthOpen = signals.mouthOpen;
  const smiling = signals.smile;
  const bothEyesBlink = signals.blinkLeft && signals.blinkRight;
  const leftWink = signals.blinkLeft && !signals.blinkRight;
  const rightWink = signals.blinkRight && !signals.blinkLeft;
  const angry = signals.anger;
  const sad = signals.sorrow && !angry;
  const surprised = signals.surprise;

  let expressionIndex = FFLExpression.Normal;

  if (bothEyesBlink && mouthOpen) expressionIndex = FFLExpression.BlinkOpenMouth;
  else if (bothEyesBlink) expressionIndex = FFLExpression.Blink;
  else if (leftWink && mouthOpen) expressionIndex = FFLExpression.WinkLeftOpenMouth;
  else if (rightWink && mouthOpen) expressionIndex = FFLExpression.WinkRightOpenMouth;
  else if (leftWink) expressionIndex = FFLExpression.WinkLeft;
  else if (rightWink) expressionIndex = FFLExpression.WinkRight;
  else if (surprised && mouthOpen) expressionIndex = FFLExpression.SurpriseOpenMouth;
  else if (surprised) expressionIndex = FFLExpression.Surprise;
  else if (angry && mouthOpen) expressionIndex = FFLExpression.AngerOpenMouth;
  else if (angry) expressionIndex = FFLExpression.Anger;
  else if (sad && mouthOpen) expressionIndex = FFLExpression.SorrowOpenMouth;
  else if (sad) expressionIndex = FFLExpression.Sorrow;
  else if (smiling && mouthOpen) expressionIndex = FFLExpression.Happy;
  else if (smiling) expressionIndex = FFLExpression.Smile;
  else if (mouthOpen) expressionIndex = FFLExpression.OpenMouth;

  return {
    expressionIndex,
    headRotation: extractHeadRotation(transformMatrix),
    scores: expressionScores,
  };
}

function scoresToSignals(scores: {
  mouthOpen: number;
  smile: number;
  blinkLeft: number;
  blinkRight: number;
  anger: number;
  sorrow: number;
  surprise: number;
}): ExpressionSignals {
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
