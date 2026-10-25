import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ExpressionPipeline } from "./expressionPipeline";
import { extractHeadRotation } from "./expressionMapper";
import { mirrorBlendshapes, mirrorTransformMatrix } from "./mirrorTracking";
import { createDefaultTuningProfile } from "./tuningProfile";

function headMatrix(pitch: number, yaw: number, roll: number, x = 0) {
  const toRad = THREE.MathUtils.degToRad;
  const matrix = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(toRad(pitch), toRad(yaw), toRad(roll), "XYZ"),
  );
  matrix.setPosition(x, 0, -40);
  return new Float32Array(matrix.elements);
}

describe("mirrorBlendshapes", () => {
  it("swaps left and right names and keeps scores", () => {
    expect(
      mirrorBlendshapes([
        { categoryName: "eyeBlinkLeft", score: 0.9 },
        { categoryName: "mouthSmileRight", score: 0.4 },
        { categoryName: "jawOpen", score: 0.2 },
      ]),
    ).toEqual([
      { categoryName: "eyeBlinkRight", score: 0.9 },
      { categoryName: "mouthSmileLeft", score: 0.4 },
      { categoryName: "jawOpen", score: 0.2 },
    ]);
  });
});

describe("mirrorTransformMatrix", () => {
  it("reverses yaw and roll and keeps pitch", () => {
    const mirrored = extractHeadRotation(mirrorTransformMatrix(headMatrix(10, 20, 15)));

    expect(mirrored.pitch).toBeCloseTo(10);
    expect(mirrored.yaw).toBeCloseTo(-20);
    expect(mirrored.roll).toBeCloseTo(-15);
  });

  it("reverses x translation", () => {
    const mirrored = mirrorTransformMatrix(headMatrix(0, 0, 0, 5));

    expect(mirrored[12]).toBeCloseTo(-5);
    expect(mirrored[14]).toBeCloseTo(-40);
  });

  it("returns the original matrix when applied twice", () => {
    const matrix = headMatrix(10, 20, 15, 5);

    expect(mirrorTransformMatrix(mirrorTransformMatrix(matrix))).toEqual(matrix);
  });
});

describe("ExpressionPipeline mirror tracking", () => {
  it("subtracts the calibration baseline before it swaps sides", () => {
    const profile = createDefaultTuningProfile();
    profile.calibration = { eyeBlinkLeft: 0.08, eyeBlinkRight: 0.15 };
    const pipeline = new ExpressionPipeline(profile);
    pipeline.setMirrorTracking(true);

    const frame = pipeline.processFrame(
      [
        { categoryName: "eyeBlinkLeft", score: 0.5 },
        { categoryName: "eyeBlinkRight", score: 0.5 },
      ],
      undefined,
      0,
    );
    const score = (name: string) =>
      frame.calibratedBlendshapes.find((shape) => shape.categoryName === name)?.score;

    expect(score("eyeBlinkLeft")).toBeCloseTo(0.35);
    expect(score("eyeBlinkRight")).toBeCloseTo(0.42);
  });

  it("mirrors the head pose", () => {
    const pipeline = new ExpressionPipeline(createDefaultTuningProfile());
    pipeline.setMirrorTracking(true);

    const frame = pipeline.processFrame([], headMatrix(0, 20, 0), 0);

    expect(frame.mapped.headRotation.yaw).toBeCloseTo(-20);
  });
});
