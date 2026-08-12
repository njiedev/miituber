import {
  ExpressionPipeline,
  type ExpressionPipelineFrame,
  type MouthOpenSource,
} from "./expressionPipeline";
import type { BlendshapeCategory } from "./types";

export type CameraPoseInput = {
  blendshapes: BlendshapeCategory[];
  transformMatrix?: Float32Array;
  trackingFps: number;
  detectMs: number;
};

/**
 * Owns the latest camera input and feeds both camera and microphone updates
 * through one expression pipeline. The last detected face is retained while
 * detection is temporarily lost so microphone-driven mouth movement can be
 * composed with the held facial expression.
 */
export class AvatarPoseCoordinator {
  private blendshapes: BlendshapeCategory[] = [];
  private transformMatrix: Float32Array | undefined;
  private faceDetected = false;
  private trackingFps = 0;
  private detectMs = 0;

  constructor(private readonly pipeline: ExpressionPipeline) {}

  updateCamera(
    input: CameraPoseInput,
    nowMs: number,
    externalMouthOpenScore: number,
    mouthOpenSource: MouthOpenSource,
  ) {
    this.blendshapes = input.blendshapes;
    this.transformMatrix = input.transformMatrix;
    this.faceDetected = input.blendshapes.length > 0;
    this.trackingFps = input.trackingFps;
    this.detectMs = input.detectMs;
    return this.process(nowMs, externalMouthOpenScore, mouthOpenSource);
  }

  updateMicrophone(
    nowMs: number,
    externalMouthOpenScore: number,
    mouthOpenSource: MouthOpenSource,
  ) {
    return this.process(nowMs, externalMouthOpenScore, mouthOpenSource);
  }

  markFaceMissing() {
    this.faceDetected = false;
  }

  isFaceDetected() {
    return this.faceDetected;
  }

  getCameraDebugState() {
    return {
      blendshapes: this.blendshapes,
      trackingFps: this.trackingFps,
      detectMs: this.detectMs,
    };
  }

  reset() {
    this.blendshapes = [];
    this.transformMatrix = undefined;
    this.faceDetected = false;
    this.trackingFps = 0;
    this.detectMs = 0;
    this.pipeline.reset();
  }

  private process(
    nowMs: number,
    externalMouthOpenScore: number,
    mouthOpenSource: MouthOpenSource,
  ): ExpressionPipelineFrame {
    return this.pipeline.processFrame(
      this.blendshapes,
      this.transformMatrix,
      nowMs,
      externalMouthOpenScore,
      mouthOpenSource,
    );
  }
}
