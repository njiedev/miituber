import { describe, expect, it } from "vitest";
import { AvatarPoseCoordinator } from "./avatarPoseCoordinator";
import { ExpressionPipeline } from "./expressionPipeline";
import { FFLExpression, type BlendshapeCategory } from "./types";
import { createDefaultTuningProfile } from "./tuningProfile";

function shapes(scores: Record<string, number>): BlendshapeCategory[] {
  return Object.entries(scores).map(([categoryName, score]) => ({
    categoryName,
    score,
  }));
}

function coordinator() {
  const profile = createDefaultTuningProfile();
  profile.oneEuro = { minCutoff: 20, beta: 1, derivativeCutoff: 1 };
  profile.minimumHoldMs = 0;
  return new AvatarPoseCoordinator(new ExpressionPipeline(profile));
}

describe("AvatarPoseCoordinator", () => {
  it("drives an open mouth from the microphone without a camera frame", () => {
    const pose = coordinator().updateMicrophone(10, 0.9, "mic");

    expect(pose.expressionIndex).toBe(FFLExpression.OpenMouth);
    expect(pose.rawMapped.scores.mouthOpen).toBe(0.9);
  });

  it("continues to drive expressions from camera-only input", () => {
    const pose = coordinator().updateCamera(
      {
        blendshapes: shapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }),
        trackingFps: 30,
        detectMs: 8,
      },
      10,
      0,
      "camera",
    );

    expect(pose.expressionIndex).toBe(FFLExpression.Smile);
  });

  it("composes microphone mouth movement with a camera expression", () => {
    const subject = coordinator();
    subject.updateCamera(
      {
        blendshapes: shapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }),
        trackingFps: 30,
        detectMs: 8,
      },
      10,
      0,
      "max",
    );

    const pose = subject.updateMicrophone(20, 0.9, "max");

    expect(pose.expressionIndex).toBe(FFLExpression.Happy);
  });

  it("retains the last face expression when detection drops out", () => {
    const subject = coordinator();
    subject.updateCamera(
      {
        blendshapes: shapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }),
        trackingFps: 30,
        detectMs: 8,
      },
      10,
      0,
      "max",
    );
    subject.markFaceMissing();

    const pose = subject.updateMicrophone(20, 0.9, "max");

    expect(subject.isFaceDetected()).toBe(false);
    expect(pose.expressionIndex).toBe(FFLExpression.Happy);
  });

  it("clears stale camera input when tracking resets", () => {
    const subject = coordinator();
    subject.updateCamera(
      {
        blendshapes: shapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }),
        trackingFps: 30,
        detectMs: 8,
      },
      10,
      0,
      "camera",
    );

    subject.reset();
    const pose = subject.updateMicrophone(20, 0.9, "mic");

    expect(pose.expressionIndex).toBe(FFLExpression.OpenMouth);
    expect(subject.getCameraDebugState().blendshapes).toEqual([]);
  });
});
