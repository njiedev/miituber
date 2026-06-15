import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { extractHeadRotation, mapToExpression } from "./expressionMapper";
import { FFLExpression, type BlendshapeCategory } from "./types";

function shapes(scores: Record<string, number>): BlendshapeCategory[] {
  return Object.entries(scores).map(([categoryName, score]) => ({
    categoryName,
    score,
  }));
}

describe("mapToExpression", () => {
  it("returns normal for neutral input", () => {
    expect(mapToExpression([]).expressionIndex).toBe(FFLExpression.Normal);
  });

  it("maps a smile to the smile expression", () => {
    const result = mapToExpression(
      shapes({ mouthSmileLeft: 0.8, mouthSmileRight: 0.8 }),
    );

    expect(result.expressionIndex).toBe(FFLExpression.Smile);
    expect(result.scores.smile).toBe(0.8);
  });

  it("prioritizes compound smile plus open mouth as happy", () => {
    const result = mapToExpression(
      shapes({
        jawOpen: 0.7,
        mouthSmileLeft: 0.8,
        mouthSmileRight: 0.8,
      }),
    );

    expect(result.expressionIndex).toBe(FFLExpression.Happy);
  });

  it("maps open mouth by itself to the open mouth expression", () => {
    const result = mapToExpression(shapes({ jawOpen: 0.7 }));

    expect(result.expressionIndex).toBe(FFLExpression.OpenMouth);
  });

  it("maps surprise and open-mouth surprise", () => {
    expect(
      mapToExpression(shapes({ eyeWideLeft: 0.8, eyeWideRight: 0.8 }))
        .expressionIndex,
    ).toBe(FFLExpression.Surprise);

    expect(
      mapToExpression(
        shapes({ jawOpen: 0.7, eyeWideLeft: 0.8, eyeWideRight: 0.8 }),
      ).expressionIndex,
    ).toBe(FFLExpression.SurpriseOpenMouth);
  });

  it("maps anger and open-mouth anger", () => {
    expect(
      mapToExpression(shapes({ browDownLeft: 0.8, browDownRight: 0.8 }))
        .expressionIndex,
    ).toBe(FFLExpression.Anger);

    expect(
      mapToExpression(
        shapes({ jawOpen: 0.7, browDownLeft: 0.8, browDownRight: 0.8 }),
      ).expressionIndex,
    ).toBe(FFLExpression.AngerOpenMouth);
  });

  it("maps sorrow and open-mouth sorrow when anger is inactive", () => {
    expect(mapToExpression(shapes({ browInnerUp: 0.8 })).expressionIndex).toBe(
      FFLExpression.Sorrow,
    );

    expect(
      mapToExpression(shapes({ jawOpen: 0.7, browInnerUp: 0.8 })).expressionIndex,
    ).toBe(FFLExpression.SorrowOpenMouth);
  });

  it("prioritizes anger over sorrow when both brow signals are active", () => {
    const result = mapToExpression(
      shapes({
        browDownLeft: 0.8,
        browDownRight: 0.8,
        browInnerUp: 0.8,
      }),
    );

    expect(result.expressionIndex).toBe(FFLExpression.Anger);
  });

  it("prioritizes blink over smile because closed eyes are visually dominant", () => {
    const result = mapToExpression(
      shapes({
        eyeBlinkLeft: 0.9,
        eyeBlinkRight: 0.9,
        mouthSmileLeft: 0.8,
        mouthSmileRight: 0.8,
      }),
    );

    expect(result.expressionIndex).toBe(FFLExpression.Blink);
  });

  it("maps asymmetric blinks to wink expressions", () => {
    expect(
      mapToExpression(shapes({ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.1 }))
        .expressionIndex,
    ).toBe(FFLExpression.WinkLeft);

    expect(
      mapToExpression(shapes({ eyeBlinkLeft: 0.1, eyeBlinkRight: 0.8 }))
        .expressionIndex,
    ).toBe(FFLExpression.WinkRight);
  });

  it("returns the derived expression scores used by the mapper", () => {
    const result = mapToExpression(
      shapes({
        jawOpen: 0.4,
        mouthSmileLeft: 0.2,
        mouthSmileRight: 0.6,
        eyeBlinkLeft: 0.1,
        eyeBlinkRight: 0.7,
        browDownLeft: 0.3,
        browDownRight: 0.5,
        browInnerUp: 0.8,
        eyeWideLeft: 0.2,
        eyeWideRight: 0.4,
      }),
    );

    expect(result.scores.mouthOpen).toBe(0.4);
    expect(result.scores.smile).toBe(0.4);
    expect(result.scores.blinkLeft).toBe(0.1);
    expect(result.scores.blinkRight).toBe(0.7);
    expect(result.scores.anger).toBe(0.4);
    expect(result.scores.sorrow).toBe(0.8);
    expect(result.scores.surprise).toBeCloseTo(0.3);
  });

  it("can use stabilized expression signals instead of raw thresholds", () => {
    const result = mapToExpression(
      shapes({ mouthSmileLeft: 0.45, mouthSmileRight: 0.45 }),
      undefined,
      {
        mouthOpen: false,
        smile: true,
        blinkLeft: false,
        blinkRight: false,
        anger: false,
        sorrow: false,
        surprise: false,
      },
    );

    expect(result.expressionIndex).toBe(FFLExpression.Smile);
  });
});

describe("extractHeadRotation", () => {
  it("returns neutral rotation when no matrix is available", () => {
    expect(extractHeadRotation()).toEqual({ pitch: 0, yaw: 0, roll: 0 });
  });

  it("extracts pitch, yaw, and roll from a matrix", () => {
    const matrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(10),
        THREE.MathUtils.degToRad(-20),
        THREE.MathUtils.degToRad(15),
        "XYZ",
      ),
    );

    const rotation = extractHeadRotation(new Float32Array(matrix.elements));

    expect(rotation.pitch).toBeCloseTo(10);
    expect(rotation.yaw).toBeCloseTo(-20);
    expect(rotation.roll).toBeCloseTo(15);
  });

  it("clamps extreme rotations to the avatar range", () => {
    const matrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(80),
        THREE.MathUtils.degToRad(0),
        THREE.MathUtils.degToRad(0),
        "XYZ",
      ),
    );

    expect(extractHeadRotation(new Float32Array(matrix.elements)).pitch).toBe(30);
  });

  it("returns neutral rotation for malformed matrix data", () => {
    expect(extractHeadRotation(new Float32Array([1, 0, 0]))).toEqual({
      pitch: 0,
      yaw: 0,
      roll: 0,
    });
  });
});
