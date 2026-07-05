import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CharModel, FFLContext } from "ffl.js";
import type { BodyModel } from "ffl.js/helpers/BodyUtilities.js";
import type { HeadRotation } from "./types";
import { FFLExpression } from "./types";
import { createCharModel } from "./fflRenderer";

/** Count of expressions FFL.js can render on demand (CharModel needs no pre-bake). */
const FFL_SUPPORTED_EXPRESSION_COUNT = Object.values(FFLExpression).filter(
  (value): value is FFLExpression => typeof value === "number",
).length;

type VariantMapping = {
  material: number;
  variants: number[];
};

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

export function expressionIndexFromVariantName(name: unknown): number | null {
  if (typeof name !== "string") return null;

  const match = /^Expression_(\d+)$/.exec(name);
  if (!match) return null;

  const index = Number(match[1]);
  return Number.isInteger(index) ? index : null;
}

/** Body GLBs live in public/body/ and are served from the web root. */
const BODY_MODEL_URLS = ["/body/male.glb", "/body/female.glb"] as const;

/**
 * Where the camera looks / orbits, as a fraction up the model's bounding box
 * (0 = feet, 1 = top of head). Below 0.5 looks lower than the geometric center,
 * which raises the avatar in the frame and puts the zoom pivot on the body
 * rather than empty space above it. Tune to taste.
 */
const FRAME_VERTICAL_FOCUS = 0.2;

export class AvatarScene {
  private static readonly DEFAULT_BACKGROUND = new THREE.Color(0xe8f0f7);

  /** THREE.Skeleton is patched with attach()/scaling once, process-wide. */
  private static skeletonExtensionsReady = false;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly loader = new GLTFLoader();
  private readonly modelRoot = new THREE.Group();
  private readonly controls: OrbitControls;
  private readonly variantMaterials = new Map<number, THREE.Material>();
  private readonly originalMaterials = new Map<MeshWithMaterial, THREE.Material | THREE.Material[]>();
  private readonly debugMaterial = new THREE.MeshNormalMaterial();

  private currentModel: THREE.Object3D | null = null;
  private charModel: CharModel | null = null;
  private bodyModel: BodyModel | null = null;
  /** What head-tracking rotates: the head group alone when a body is attached. */
  private headRoot: THREE.Object3D | null = null;
  /** Captured disposeModel() from BodyUtilities so sync teardown can use it. */
  private disposeBodyModelFn: ((model: THREE.Object3D) => void) | null = null;
  /** Shared (cached) load of both body GLB templates. */
  private bodyTemplatesPromise: Promise<[GLTF, GLTF]> | null = null;
  private currentGlbUrl: string | null = null;
  private variantMesh: MeshWithMaterial | null = null;
  private selectedExpression = 0;
  private debugMaterialsEnabled = false;
  private renderFrameCount = 0;
  private lastRenderFpsAt = performance.now();
  /** World-space point the camera orbits/points at (the framed model's center). */
  private readonly framedTarget = new THREE.Vector3();
  /** Camera distance from framedTarget that fits the model in view. */
  private framedDistance = 3;
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
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(1.8, 2.5, 2.6);
    this.scene.add(keyLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 6;

    this.resize();
    this.animate();
  }

  async loadModelFromGlbBytes(bytes: number[]): Promise<AvatarLoadResult> {
    this.disposeCurrentModel();
    this.variantMaterials.clear();
    this.originalMaterials.clear();
    this.variantMesh = null;
    this.selectedExpression = 0;

    const blob = new Blob([new Uint8Array(bytes)], { type: "model/gltf-binary" });
    this.currentGlbUrl = URL.createObjectURL(blob);

    const gltf = await this.loader.loadAsync(this.currentGlbUrl);
    this.currentModel = gltf.scene;

    let meshCount = 0;
    this.currentModel.traverse((child) => {
      const mesh = child as MeshWithMaterial;

      if (!mesh.isMesh) return;
      meshCount += 1;
      mesh.frustumCulled = false;
      this.originalMaterials.set(mesh, mesh.material);
    });

    await this.cacheVariantMaterials(gltf);
    const framing = this.frameModel(this.currentModel);
    this.modelRoot.add(this.currentModel);
    this.setExpression(0);

    return {
      meshCount,
      expressionCount: this.variantMaterials.size,
      ...framing,
    };
  }

  /**
   * Render a Mii directly from its raw bytes via in-process FFL.js, bypassing
   * the external GLB server. `ensureReady()` (fflRenderer) must have resolved;
   * pass its `FFLContext` handle in as `ffl`.
   */
  async loadModelFromMiiBytes(
    miiBytes: Uint8Array,
    ffl: FFLContext,
  ): Promise<AvatarLoadResult> {
    this.disposeCurrentModel();
    this.variantMaterials.clear();
    this.originalMaterials.clear();
    this.variantMesh = null;
    this.selectedExpression = 0;

    const charModel = await createCharModel(ffl, miiBytes, this.renderer);
    this.charModel = charModel;

    // Attach a scaled body; the head is parented onto its neck bone, so the
    // body's root is what gets added to the scene and framed.
    const body = await this.attachBody(charModel);
    this.bodyModel = body;
    this.currentModel = body.model;
    this.headRoot = charModel.meshes;

    let meshCount = 0;
    this.currentModel.traverse((child) => {
      const mesh = child as MeshWithMaterial;
      if (!mesh.isMesh) return;
      meshCount += 1;
      mesh.frustumCulled = false;
    });

    const framing = this.frameModel(this.currentModel);
    this.modelRoot.add(this.currentModel);
    this.setExpression(0);

    return {
      meshCount,
      // CharModel renders any expression on demand — no pre-baked variants.
      expressionCount: FFL_SUPPORTED_EXPRESSION_COUNT,
      ...framing,
    };
  }

  /** Load both body GLB templates once and cache the shared promise. */
  private loadBodyTemplates(): Promise<[GLTF, GLTF]> {
    if (!this.bodyTemplatesPromise) {
      this.bodyTemplatesPromise = Promise.all([
        this.loader.loadAsync(BODY_MODEL_URLS[0]),
        this.loader.loadAsync(BODY_MODEL_URLS[1]),
      ]);
    }
    return this.bodyTemplatesPromise;
  }

  /**
   * Build a gender-appropriate body for the CharModel, color/scale it from the
   * Mii's own parameters, and parent the head onto its neck bone. The body is
   * left in a static rest pose (mixer advanced to frame 0 only) so head-tracking
   * rotation of the head group never fights an idle animation.
   */
  private async attachBody(charModel: CharModel): Promise<BodyModel> {
    const [
      { prepareBodyForCharModel, attachHeadToBody, disposeModel },
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

    if (!AvatarScene.skeletonExtensionsReady) {
      addSkeletonScalingExtensions(THREE.Skeleton);
      AvatarScene.skeletonExtensionsReady = true;
    }

    const templates = await this.loadBodyTemplates();
    const gender = charModel.charInfo.gender === 1 ? 1 : 0;
    const gltf = templates[gender];

    // SkeletonUtils.clone preserves skinning bindings that Object3D.clone drops.
    const model = cloneSkinned(gltf.scene);
    const animations = gltf.animations;
    const mixer = new THREE.AnimationMixer(model);
    const clip = animations.find((a) => a.name === "Wait") ?? animations[0];
    if (clip) mixer.clipAction(clip).play();
    mixer.update(0);

    const body: BodyModel = {
      model,
      animations,
      mixer,
      scaleDesc: detectModelDesc(model),
    };

    // Clone so we don't mutate the shared PantsColor entry across avatars.
    const pantsColor = pantsColors[PantsColor.GrayNormal].clone();
    prepareBodyForCharModel(
      body,
      FFLShaderMaterial,
      charModel.favoriteColor,
      charModel.getBodyScale(),
      pantsColor,
    );

    // attachHeadToBody sets matrixAutoUpdate=false on whatever we attach and
    // rewrites its matrix from the head bone every skeleton update — so writing
    // .rotation onto the attached object is silently discarded (that's why head
    // tracking stopped once the body was added). Attach a *pivot* to the bone
    // and nest the CharModel head inside it: the pivot is bone-driven, the head
    // keeps matrixAutoUpdate=true, so head-tracking rotation on the head group
    // composes on top of the bone transform.
    const headPivot = new THREE.Group();
    headPivot.name = "head-pivot";
    headPivot.add(charModel.meshes);
    attachHeadToBody(body, headPivot);

    this.disposeBodyModelFn = disposeModel;
    return body;
  }

  setExpression(index: number) {
    this.selectedExpression = index;

    if (this.charModel) {
      if (!this.debugMaterialsEnabled) this.charModel.setExpression(index);
      return;
    }

    if (!this.variantMesh || this.debugMaterialsEnabled) return;

    const material = this.variantMaterials.get(index);
    if (material) {
      this.variantMesh.material = material;
    }
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

  setDebugMaterials(enabled: boolean) {
    this.debugMaterialsEnabled = enabled;

    if (!this.currentModel) return;

    this.currentModel.traverse((child) => {
      const mesh = child as MeshWithMaterial;

      if (!mesh.isMesh) return;

      mesh.material = enabled
        ? this.debugMaterial
        : this.originalMaterials.get(mesh) ?? mesh.material;
    });

    if (!enabled) {
      this.setExpression(this.selectedExpression);
    }
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

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private async cacheVariantMaterials(gltf: GLTF) {
    const variantNames = gltf.parser.json.extensions?.KHR_materials_variants?.variants;

    if (!Array.isArray(variantNames)) return;

    const materialPromises: Promise<void>[] = [];

    gltf.scene.traverse((child) => {
      const mesh = child as MeshWithMaterial;
      const mappings = mesh.userData.gltfExtensions?.KHR_materials_variants
        ?.mappings as VariantMapping[] | undefined;

      if (!mesh.isMesh || !Array.isArray(mappings) || mappings.length === 0) return;

      this.variantMesh = mesh;

      for (const mapping of mappings) {
        for (const variantIndex of mapping.variants) {
          const variantName = variantNames[variantIndex]?.name;
          const expressionIndex = expressionIndexFromVariantName(variantName);

          if (expressionIndex === null) continue;

          materialPromises.push(
            gltf.parser.getDependency("material", mapping.material).then((material) => {
              this.variantMaterials.set(expressionIndex, material as THREE.Material);
            }),
          );
        }
      }
    });

    await Promise.all(materialPromises);
  }

  private frameModel(model: THREE.Object3D) {
    // Frame by moving the camera, NOT by rescaling the model. The FFL body rig
    // is authored in a native ~100-unit space and the head is attached via the
    // skeleton's own world-matrix management (which assumes body world scale
    // 1.0); rescaling the root shrinks the body but not the head, producing a
    // giant head. Fitting via camera distance is scale-agnostic, so it works
    // for the ~100-unit body and the old ~1-unit head-only GLB alike.
    model.rotation.set(0, 0, 0);
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Distance so maxDim fits the vertical FOV, with 30% breathing room.
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (maxDim / 2 / Math.tan(vFov / 2)) * 1.3;

    // Look at a point a set fraction up the body (see FRAME_VERTICAL_FOCUS),
    // not the raw geometric center — keeps the avatar from sitting low with the
    // orbit pivot floating above it.
    this.framedTarget.set(
      center.x,
      box.min.y + size.y * FRAME_VERTICAL_FOCUS,
      center.z,
    );
    this.framedDistance = distance;

    // Clip planes and orbit limits scaled to the model so nothing gets culled.
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = distance * 0.3;
    this.controls.maxDistance = distance * 3;

    this.resetCameraView();

    return {
      center: center.toArray() as [number, number, number],
      size: size.toArray() as [number, number, number],
      scale: 1,
    };
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
      return;
    }

    if (!this.currentModel) return;

    this.modelRoot.remove(this.currentModel);
    this.currentModel.traverse((child) => {
      const mesh = child as MeshWithMaterial;

      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
    });
    this.currentModel = null;

    if (this.currentGlbUrl) {
      URL.revokeObjectURL(this.currentGlbUrl);
      this.currentGlbUrl = null;
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
