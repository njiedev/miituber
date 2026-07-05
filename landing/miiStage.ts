import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CharModel, FFLContext } from "ffl.js";
import type { BodyModel } from "ffl.js/helpers/BodyUtilities.js";
import { createCharModel } from "../src/lib/fflRenderer";

/**
 * Landing-page Mii stage.
 *
 * A slimmed-down cousin of src/lib/scene.ts's AvatarScene: same FFL.js
 * CharModel + body-GLB attachment (head-pivot trick included), but tuned for
 * a marketing page instead of a workspace — no orbit controls, transparent
 * clear color (the CSS checkerboard behind the canvas is the background),
 * the Wait00 idle clip actually plays, and cursor-follow / excitement poses
 * are driven every frame.
 */

const BODY_MODEL_URLS = ["/body/male.glb", "/body/female.glb"] as const;

/** Fraction up the bounding box the camera looks at (0 = feet, 1 = head top). */
const FRAME_VERTICAL_FOCUS = 0.52;
/** Breathing room multiplier when fitting the body to the vertical FOV. */
const FRAME_FIT_MARGIN = 1.18;

/** Max head yaw/pitch (degrees) when following the cursor. */
const FOLLOW_MAX_YAW = 32;
const FOLLOW_MAX_PITCH = 18;
/** Per-frame lerp factor toward the cursor target (60fps-ish feel). */
const FOLLOW_SMOOTHING = 0.14;

/**
 * How far the shoulders rotate (radians) at full excitement. Keep near 1.15:
 * much higher and the hands vanish behind big hairstyles.
 */
const EXCITED_ARM_RAISE = 1.15;
/** Elbow bend (radians) at full excitement, so hands come up, not just out. */
const EXCITED_ELBOW_BEND = 0.45;
/** Per-frame lerp factor for the excitement spring. */
const EXCITEMENT_SMOOTHING = 0.16;
/** Hop height as a fraction of the model's height. */
const HOP_HEIGHT = 0.045;
const HOP_DURATION_MS = 420;

export class MiiStage {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly loader = new GLTFLoader();
  private readonly modelRoot = new THREE.Group();
  private readonly clock = new THREE.Clock();

  private charModel: CharModel | null = null;
  private bodyModel: BodyModel | null = null;
  /** The CharModel head group, nested in a bone-driven pivot (rotatable). */
  private headRoot: THREE.Object3D | null = null;

  private shoulderL: THREE.Object3D | null = null;
  private shoulderR: THREE.Object3D | null = null;
  private elbowL: THREE.Object3D | null = null;
  private elbowR: THREE.Object3D | null = null;

  /** Cursor-follow target, radians. */
  private targetYaw = 0;
  private targetPitch = 0;
  private currentYaw = 0;
  private currentPitch = 0;
  /** Extra roll (radians) blended in by playWink(). */
  private targetRoll = 0;
  private currentRoll = 0;

  /** 0 = rest pose, 1 = arms up. Springs toward excitedTarget. */
  private excitement = 0;
  private excitedTarget = 0;

  private hopStartedAt = -1;
  private modelHeight = 1;
  private baseRootY = 0;

  private readonly reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.add(this.modelRoot);
    this.camera.position.set(0, 0.05, 3);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      canvas,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Transparent clear: the page's checkerboard shows through, the same way
    // the app's OBS clean view carries per-pixel alpha.
    this.renderer.setClearColor(0x000000, 0);

    // Same lighting rig as the app's AvatarScene.
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1.8, 2.5, 2.6);
    this.scene.add(keyLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));

    this.resize();
    this.animate();
  }

  async load(
    miiBytes: Uint8Array,
    ffl: FFLContext,
    extraExpressions: readonly number[] = [],
  ): Promise<void> {
    const charModel = await createCharModel(
      ffl,
      miiBytes,
      this.renderer,
      extraExpressions,
    );
    this.charModel = charModel;

    const body = await this.attachBody(charModel);
    this.bodyModel = body;
    this.headRoot = charModel.meshes;

    // The rig's arm chain is chest → arm_l1 (shoulder joint) → arm_l2 (elbow
    // joint) → wrist_l; the nodes literally named shoulder_/elbow_ are leaf
    // helper joints for the ball geometry and don't move the arm.
    this.shoulderL = body.model.getObjectByName("arm_l1") ?? null;
    this.shoulderR = body.model.getObjectByName("arm_r1") ?? null;
    this.elbowL = body.model.getObjectByName("arm_l2") ?? null;
    this.elbowR = body.model.getObjectByName("arm_r2") ?? null;

    body.model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.frustumCulled = false;
    });

    // Add and render one frame BEFORE framing: the skeleton (and the
    // bone-driven head pivot) only get valid world transforms during a render,
    // and the framing box must measure the posed model, not the bind pose.
    this.modelRoot.add(body.model);
    this.renderer.render(this.scene, this.camera);
    this.frameModel(body.model);
    this.setExpression(0);
  }

  /** Same body build as AvatarScene.attachBody, minus the frame-0 freeze. */
  private async attachBody(charModel: CharModel): Promise<BodyModel> {
    const [
      { prepareBodyForCharModel, attachHeadToBody },
      { detectModelDesc },
      { addSkeletonScalingExtensions },
      { PantsColor, pantsColors },
      { default: FFLShaderMaterial },
      { clone: cloneSkinned },
    ] = await Promise.all([
      import("ffl.js/helpers/BodyUtilities.js"),
      import("ffl.js/helpers/ModelScaleDesc.js"),
      import("ffl.js/helpers/SkeletonScalingExtensions.js"),
      import("ffl.js"),
      import("ffl.js/materials/FFLShaderMaterial.js"),
      import("three/examples/jsm/utils/SkeletonUtils.js"),
    ]);

    addSkeletonScalingExtensions(THREE.Skeleton);

    const gender = charModel.charInfo.gender === 1 ? 1 : 0;
    const gltf: GLTF = await this.loader.loadAsync(BODY_MODEL_URLS[gender]);

    const model = cloneSkinned(gltf.scene);
    const animations = gltf.animations;
    const mixer = new THREE.AnimationMixer(model);
    const clip = animations.find((a) => a.name === "Wait00") ?? animations[0];
    if (clip) {
      const action = mixer.clipAction(clip);
      action.loop = THREE.LoopRepeat;
      action.play();
    }
    mixer.update(0);

    const body: BodyModel = {
      model,
      animations,
      mixer,
      scaleDesc: detectModelDesc(model),
    };

    const pantsColor = pantsColors[PantsColor.GrayNormal].clone();
    prepareBodyForCharModel(
      body,
      FFLShaderMaterial,
      charModel.favoriteColor,
      charModel.getBodyScale(),
      pantsColor,
    );

    // Head-pivot trick from AvatarScene: attachHeadToBody force-writes the
    // attached object's matrix from the neck bone, so nest the head inside a
    // pivot — the pivot is bone-driven, head rotation composes on top.
    const headPivot = new THREE.Group();
    headPivot.name = "head-pivot";
    headPivot.add(charModel.meshes);
    attachHeadToBody(body, headPivot);

    return body;
  }

  setExpression(index: number) {
    // Unbaked indices throw ExpressionNotSet — swallow so a bad ?expression=
    // dev param can't kill the render loop's caller.
    try {
      this.charModel?.setExpression(index);
    } catch (error) {
      console.warn(`miiStage: expression ${index} not baked`, error);
    }
  }

  /**
   * Point the head toward a page-space cursor position. nx/ny are the cursor
   * offset from the head, normalized to [-1, 1] (x right, y down).
   */
  lookToward(nx: number, ny: number) {
    const cx = THREE.MathUtils.clamp(nx, -1, 1);
    const cy = THREE.MathUtils.clamp(ny, -1, 1);
    this.targetYaw = THREE.MathUtils.degToRad(cx * FOLLOW_MAX_YAW);
    this.targetPitch = THREE.MathUtils.degToRad(cy * FOLLOW_MAX_PITCH);
  }

  /** Arms up + shocked-happy energy while true (waitlist button hover). */
  setExcited(excited: boolean, immediate = false) {
    this.excitedTarget = excited ? 1 : 0;
    if (immediate) this.excitement = this.excitedTarget;
  }

  /** One quick full-body hop (no-op under prefers-reduced-motion). */
  hop() {
    if (this.reducedMotion) return;
    this.hopStartedAt = performance.now();
  }

  /** Head-tilt roll for the wink easter egg; call with 0 to clear. */
  tiltHead(rollDeg: number) {
    this.targetRoll = THREE.MathUtils.degToRad(rollDeg);
  }

  /** Where the head sits on the page, in canvas-relative [0..1] coords. */
  headScreenPosition(): { x: number; y: number } | null {
    if (!this.headRoot) return null;
    const world = new THREE.Vector3();
    this.headRoot.getWorldPosition(world);
    world.project(this.camera);
    return { x: (world.x + 1) / 2, y: (1 - world.y) / 2 };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Skinning-aware bounds: Box3.setFromObject uses raw geometry bounds, which
   * for this rig are wildly larger than the posed body — SkinnedMesh's own
   * computeBoundingBox applies bone transforms, so use that per mesh.
   */
  private computeVisualBox(model: THREE.Object3D): THREE.Box3 {
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    const meshBox = new THREE.Box3();
    model.traverse((child) => {
      const mesh = child as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh) {
        mesh.computeBoundingBox();
        if (!mesh.boundingBox) return;
        meshBox.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
      } else {
        meshBox.setFromObject(mesh);
      }
      box.union(meshBox);
    });
    return box;
  }

  /** Camera-fit framing (never rescale the rig — see AvatarScene.frameModel). */
  private frameModel(model: THREE.Object3D) {
    const box = this.computeVisualBox(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    this.modelHeight = size.y;
    this.baseRootY = this.modelRoot.position.y;

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (maxDim / 2 / Math.tan(vFov / 2)) * FRAME_FIT_MARGIN;

    const target = new THREE.Vector3(
      center.x,
      box.min.y + size.y * FRAME_VERTICAL_FOCUS,
      center.z,
    );
    const direction = new THREE.Vector3(0, 0.05, 1).normalize();
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.lookAt(target);

    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
  }

  private animate = () => {
    const dt = this.clock.getDelta();

    // Idle animation first, pose overrides after: the mixer rewrites bone
    // transforms every update, so additive tweaks must come afterward. Under
    // reduced motion, still update with dt=0 — that re-stamps the rest pose
    // each frame so the additive offsets below never accumulate.
    this.bodyModel?.mixer.update(this.reducedMotion ? 0 : dt);

    this.excitement +=
      (this.excitedTarget - this.excitement) * EXCITEMENT_SMOOTHING;
    if (this.excitement > 0.001) {
      // Local +x on the arm bones flexes the arm forward/up on BOTH sides
      // (the mirrored rig shares the axis sign — verified visually).
      const raise = this.excitement * EXCITED_ARM_RAISE;
      const bend = this.excitement * EXCITED_ELBOW_BEND;
      if (this.shoulderL) this.shoulderL.rotation.x += raise;
      if (this.shoulderR) this.shoulderR.rotation.x += raise;
      if (this.elbowL) this.elbowL.rotation.x += bend;
      if (this.elbowR) this.elbowR.rotation.x += bend;
    }

    if (this.headRoot) {
      this.currentYaw += (this.targetYaw - this.currentYaw) * FOLLOW_SMOOTHING;
      this.currentPitch +=
        (this.targetPitch - this.currentPitch) * FOLLOW_SMOOTHING;
      this.currentRoll +=
        (this.targetRoll - this.currentRoll) * FOLLOW_SMOOTHING;
      this.headRoot.rotation.set(
        this.currentPitch,
        this.currentYaw,
        this.currentRoll,
      );
    }

    if (this.hopStartedAt >= 0) {
      const t = (performance.now() - this.hopStartedAt) / HOP_DURATION_MS;
      if (t >= 1) {
        this.hopStartedAt = -1;
        this.modelRoot.position.y = this.baseRootY;
      } else {
        this.modelRoot.position.y =
          this.baseRootY + Math.sin(Math.PI * t) * this.modelHeight * HOP_HEIGHT;
      }
    }

    this.resize();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  };
}
