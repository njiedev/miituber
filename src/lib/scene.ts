import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CharModel, FFLContext } from "ffl.js";
import type { BodyModel } from "ffl.js/helpers/BodyUtilities.js";
import type { HeadRotation } from "./types";
import { FFLExpression } from "./types";
import { createCharModel } from "./fflRenderer";
import { attachBodyToCharModel, computeVisualBox } from "./bodyModel";

/** Count of expressions FFL.js can render on demand (CharModel needs no pre-bake). */
const FFL_SUPPORTED_EXPRESSION_COUNT = Object.values(FFLExpression).filter(
  (value): value is FFLExpression => typeof value === "number",
).length;

type MeshWithMaterial = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.Material | THREE.Material[]
>;

export type AvatarLoadResult = {
  meshCount: number;
  expressionCount: number;
  size: [number, number, number];
  center: [number, number, number];
  scale: number;
};

export type AvatarSceneCallbacks = {
  onRenderFps?: (fps: number) => void;
};

export type AvatarBackground = {
  color: string;
  transparent: boolean;
};

/**
 * Where the camera looks, as a fraction up the model's bounding box (0 = feet,
 * 1 = top of head). 0.5 centers the whole body vertically in the frame.
 */
const FRAME_VERTICAL_FOCUS = 0.5;

/** Breathing room around the model when fitting it to the viewport. */
const FRAME_FIT_MARGIN = 1.15;

export class AvatarScene {
  private static readonly DEFAULT_BACKGROUND = new THREE.Color(0xe8f0f7);

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly modelRoot = new THREE.Group();
  private readonly controls: OrbitControls;

  private currentModel: THREE.Object3D | null = null;
  private charModel: CharModel | null = null;
  private bodyModel: BodyModel | null = null;
  /** What head-tracking rotates: the head group alone when a body is attached. */
  private headRoot: THREE.Object3D | null = null;
  /** Captured disposeModel() from BodyUtilities so sync teardown can use it. */
  private disposeBodyModelFn: ((model: THREE.Object3D) => void) | null = null;
  private bodyVisible = true;
  private renderFrameCount = 0;
  private lastRenderFpsAt = performance.now();
  /** World-space point the camera orbits/points at (the framed model's center). */
  private readonly framedTarget = new THREE.Vector3();
  /** Camera distance from framedTarget that fits the model in view. */
  private framedDistance = 3;
  /** Cached model bounds (skinning-aware) so re-framing on an aspect change
   *  never re-measures the mesh. */
  private readonly modelCenter = new THREE.Vector3();
  private readonly modelSize = new THREE.Vector3();
  private hasFraming = false;
  /** True once the user orbits/zooms away from the default view; while set,
   *  resize() keeps their camera instead of re-fitting to the model. */
  private userAdjustedView = false;
  /** Last canvas pixel size, so resize() only re-fits when the shape changes. */
  private lastViewWidth = 0;
  private lastViewHeight = 0;
  private background: AvatarBackground = {
    color: "#e8f0f7",
    transparent: false,
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: AvatarSceneCallbacks = {},
  ) {
    this.scene.background = AvatarScene.DEFAULT_BACKGROUND;
    this.scene.add(this.modelRoot);

    this.camera.position.set(0, 0.05, 3);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      canvas,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Correct colors to sRGB space.
    THREE.ColorManagement.enabled = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1.8, 2.5, 2.6);
    this.scene.add(keyLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 6;
    // "start" only fires on user input (drag/scroll), not on controls.update().
    this.controls.addEventListener("start", () => {
      this.userAdjustedView = true;
    });

    this.resize();
    this.animate();
  }

  /**
   * Render a Mii from its raw bytes via FFL.js. `ensureReady()` in
   * fflRenderer must have resolved; pass its `FFLContext` handle in as `ffl`.
   */
  async loadModelFromMiiBytes(
    miiBytes: Uint8Array,
    ffl: FFLContext,
  ): Promise<AvatarLoadResult> {
    this.disposeCurrentModel();

    const charModel = await createCharModel(ffl, miiBytes, this.renderer);
    this.charModel = charModel;

    // Attach a scaled body; the head is parented onto its neck bone, so the
    // body's root is what gets added to the scene and framed.
    const attached = await attachBodyToCharModel(charModel);
    this.bodyModel = attached.body;
    this.currentModel = attached.body.model;
    this.headRoot = attached.headRoot;
    this.disposeBodyModelFn = attached.disposeBodyModel;
    this.applyBodyVisibility();

    let meshCount = 0;
    this.currentModel.traverse((child) => {
      const mesh = child as MeshWithMaterial;
      if (!mesh.isMesh) return;
      meshCount += 1;
      mesh.frustumCulled = false;
    });

    // Skinned meshes only get valid world transforms once rendered, and the
    // bone-driven head pivot only settles onto the neck after a skeleton
    // update — so add and render one frame BEFORE framing, or the fit box
    // measures the bind pose with a mislocated head.
    this.modelRoot.add(this.currentModel);
    this.renderer.render(this.scene, this.camera);
    const framing = this.frameModel(this.currentModel);
    this.setExpression(0);

    return {
      meshCount,
      // CharModel renders any expression on demand — no pre-baked variants.
      expressionCount: FFL_SUPPORTED_EXPRESSION_COUNT,
      ...framing,
    };
  }

  setExpression(index: number) {
    this.charModel?.setExpression(index);
  }

  setHeadRotation(rotation: HeadRotation) {
    // With a body attached, rotate only the head group (childed to the neck
    // bone) so the head turns on the body; otherwise rotate the whole model.
    const target = this.headRoot ?? this.currentModel;
    if (!target) return;

    target.rotation.set(
      THREE.MathUtils.degToRad(rotation.pitch),
      THREE.MathUtils.degToRad(rotation.yaw),
      THREE.MathUtils.degToRad(rotation.roll),
    );
  }

  setBodyVisible(visible: boolean) {
    this.bodyVisible = visible;
    this.applyBodyVisibility();
  }

  private applyBodyVisibility() {
    if (!this.bodyModel) return;

    const headPivot = this.bodyModel.model.getObjectByName("head-pivot") ?? null;
    this.bodyModel.model.traverse((child) => {
      const mesh = child as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      if (headPivot && this.isDescendantOf(child, headPivot)) return;

      mesh.visible = this.bodyVisible;
    });
  }

  private isDescendantOf(child: THREE.Object3D, ancestor: THREE.Object3D) {
    let current: THREE.Object3D | null = child;
    while (current) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  }

  setBackground(background: Partial<AvatarBackground>) {
    this.background = {
      ...this.background,
      ...background,
    };

    const clearColor = new THREE.Color(this.background.color);
    this.scene.background = this.background.transparent
      ? null
      : clearColor;
    this.renderer.setClearColor(clearColor, this.background.transparent ? 0 : 1);
  }

  setTransparentBackground(enabled: boolean) {
    this.setBackground({ transparent: enabled });
  }

  setBackgroundColor(color: string) {
    this.setBackground({ color });
  }

  resetCameraView() {
    // Look at the framed model's center from `framedDistance` away, straight on
    // with a slight downward tilt. Both are set by frameModel(); defaults give
    // the pre-framing view used before any model loads.
    this.userAdjustedView = false;
    const direction = new THREE.Vector3(0, 0.05, 1).normalize();
    this.camera.position
      .copy(this.framedTarget)
      .addScaledVector(direction, this.framedDistance);
    this.controls.target.copy(this.framedTarget);
    this.controls.update();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    if (width === this.lastViewWidth && height === this.lastViewHeight) return;
    this.lastViewWidth = width;
    this.lastViewHeight = height;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Re-fit on aspect change so the model stays centered and fully in frame
    // at any window shape, not just the square it first loaded into.
    if (this.hasFraming) this.applyFraming();
  }

  private frameModel(model: THREE.Object3D) {
    // Frame by moving the camera, NOT by rescaling the model. The FFL body rig
    // is authored in a native ~100-unit space and the head is attached via the
    // skeleton's own world-matrix management (which assumes body world scale
    // 1.0); rescaling the root shrinks the body but not the head, producing a
    // giant head. Fitting via camera distance is scale-agnostic.
    model.rotation.set(0, 0, 0);
    const box = computeVisualBox(model);
    box.getCenter(this.modelCenter);
    box.getSize(this.modelSize);
    this.hasFraming = true;
    // A freshly loaded model always gets the fitted default view.
    this.userAdjustedView = false;
    this.applyFraming();

    return {
      center: this.modelCenter.toArray() as [number, number, number],
      size: this.modelSize.toArray() as [number, number, number],
      scale: 1,
    };
  }

  /**
   * Position the camera to fit the cached model bounds in the current viewport.
   * Fits BOTH axes — vertical straight from the camera FOV, horizontal via the
   * aspect-derived horizontal FOV — and takes the larger distance, so the whole
   * body stays fully visible and centered whether the window is wide or tall.
   */
  private applyFraming() {
    const size = this.modelSize;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const tanV = Math.tan(vFov / 2);
    const aspect = this.camera.aspect || 1;

    const fitHeight = size.y / 2 / tanV;
    const fitWidth = size.x / 2 / (tanV * aspect);
    const distance = Math.max(fitHeight, fitWidth, 0.01) * FRAME_FIT_MARGIN;

    this.framedTarget.set(
      this.modelCenter.x,
      this.modelCenter.y + size.y * (FRAME_VERTICAL_FOCUS - 0.5),
      this.modelCenter.z,
    );
    this.framedDistance = distance;

    // Clip planes and orbit limits scaled to the model so nothing gets culled.
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = distance * 0.3;
    this.controls.maxDistance = distance * 3;

    // Keep the user's orbit/zoom across canvas-shape changes (e.g. entering
    // isolate/clean-output mode); only snap to the fitted view while they are
    // still on the default framing.
    if (!this.userAdjustedView) this.resetCameraView();
  }

  private disposeCurrentModel() {
    if (this.charModel) {
      if (this.bodyModel) {
        // The head is a child of the body, so removing the body root detaches
        // both. Dispose the head (CharModel) and the body GLB separately.
        this.modelRoot.remove(this.bodyModel.model);
        this.charModel.dispose();
        this.disposeBodyModelFn?.(this.bodyModel.model);
        this.bodyModel.mixer.uncacheRoot(this.bodyModel.model);
        this.bodyModel = null;
      } else {
        this.modelRoot.remove(this.charModel.meshes);
        this.charModel.dispose();
      }
      this.charModel = null;
      this.currentModel = null;
      this.headRoot = null;
      this.disposeBodyModelFn = null;
      return;
    }
  }

  private animate = () => {
    const now = performance.now();
    this.renderFrameCount += 1;

    if (now - this.lastRenderFpsAt >= 1000) {
      this.callbacks.onRenderFps?.(
        (this.renderFrameCount * 1000) / (now - this.lastRenderFpsAt),
      );
      this.renderFrameCount = 0;
      this.lastRenderFpsAt = now;
    }

    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  };
}
